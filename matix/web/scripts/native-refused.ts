// CI check of the agents-only hbbs patch (matix/server/hbbs/agents-only.patch): a native
// controller talking to hbbs over plain TCP (port 21116), with the right key, must not reach the
// peer, while the same request over the WebSocket port (behind the sign-in gate in production)
// still does. Env: IP, ID (the registered peer), KEY, HBBR_LOG (hbbr's log file).
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";
import { hbb as R } from "../src/proto/rendezvous.js";

const { IP = "", ID = "", KEY = "", HBBR_LOG = "" } = process.env;
if (!IP || !ID || !KEY || !HBBR_LOG) {
  console.error("missing env IP, ID, KEY or HBBR_LOG");
  process.exit(2);
}

// hbb_common BytesCodec: little-endian length << 2, low two bits = header length - 1.
function frame(body: Uint8Array): Buffer {
  const n = body.length;
  let head: Buffer;
  if (n <= 0x3f) head = Buffer.from([n << 2]);
  else if (n <= 0x3fff) (head = Buffer.alloc(2)).writeUInt16LE((n << 2) | 1);
  else (head = Buffer.alloc(4)).writeUInt32LE(((n << 2) | 3) >>> 0);
  return Buffer.concat([head, Buffer.from(body)]);
}

/** Sends one message over TCP 21116; resolves with the first reply (or null) once the server closes or 5 s pass. */
function tcp(msg: R.IRendezvousMessage): Promise<R.RendezvousMessage | null> {
  return new Promise((resolve) => {
    const s = net.connect(21116, IP);
    let buf = Buffer.alloc(0);
    let reply: R.RendezvousMessage | null = null;
    const done = () => {
      s.destroy();
      resolve(reply);
    };
    s.on("connect", () => s.write(frame(R.RendezvousMessage.encode(msg).finish())));
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const hl = (buf[0] & 3) + 1;
      if (buf.length < hl) return;
      const n = buf.readUIntLE(0, hl) >>> 2;
      if (buf.length < hl + n) return;
      reply = R.RendezvousMessage.decode(buf.subarray(hl, hl + n));
      done();
    });
    s.on("close", done);
    s.on("error", done);
    setTimeout(done, 5000);
  });
}

function ws(msg: R.IRendezvousMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://${IP}:21118`);
    w.binaryType = "arraybuffer";
    w.onopen = () => {
      w.send(R.RendezvousMessage.encode(msg).finish());
      setTimeout(() => (w.close(), resolve()), 1500);
    };
    w.onerror = () => reject(new Error("WebSocket to hbbs failed"));
  });
}

const relayed = (uuid: string) => fs.readFileSync(HBBR_LOG, "utf8").includes(uuid);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed = true;
};

// 1. PunchHoleRequest over TCP: refused with the MatixBridge message.
const ph = await tcp({ punch_hole_request: { id: ID, licence_key: KEY, nat_type: R.NatType.SYMMETRIC, conn_type: R.ConnType.DEFAULT_CONN, version: "1.4.0", force_relay: true } });
console.log("TCP punch_hole_request reply:", JSON.stringify(ph?.punch_hole_response ?? ph));
check(!!ph?.punch_hole_response?.other_failure?.includes("agents.matix.one"), "TCP punch_hole_request is refused with the agents.matix.one message");

// 2. RequestRelay over TCP: the peer must never be asked to join the relay.
const tcpUuid = crypto.randomUUID();
await tcp({ request_relay: { id: ID, uuid: tcpUuid, licence_key: KEY, relay_server: `${IP}:21117`, conn_type: R.ConnType.DEFAULT_CONN } });
// 3. Control: the same request over the WebSocket port does reach the peer (it joins hbbr).
const wsUuid = crypto.randomUUID();
await ws({ request_relay: { id: ID, uuid: wsUuid, licence_key: KEY, relay_server: `${IP}:21117`, conn_type: R.ConnType.DEFAULT_CONN } });
for (let i = 0; i < 40 && !relayed(wsUuid); i++) await sleep(250);
check(relayed(wsUuid), "control: WebSocket request_relay reaches the peer (it joined hbbr)");
check(!relayed(tcpUuid), "TCP request_relay never reaches the peer");

if (failed) {
  console.error("NATIVE REFUSAL CHECK FAILED");
  process.exit(1);
}
console.log("NATIVE CONTROLLERS REFUSED OK");
