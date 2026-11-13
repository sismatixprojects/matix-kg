// node --test matix/server/gate/
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createGate } from "./gate.mjs";

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

// Stand-in for hbbs/hbbr's WebSocket port: answers 101, records the handshake, echoes bytes.
function fakeUpstream() {
  const seen = [];
  const srv = net.createServer((s) => {
    let buf = "";
    s.on("data", function onData(d) {
      buf += d.toString("latin1");
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      seen.push(buf.slice(0, end));
      s.off("data", onData);
      s.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      const rest = buf.slice(end + 4);
      if (rest) s.write(rest, "latin1");
      s.pipe(s);
    });
  });
  return { srv, seen };
}

// Stand-in for agents.matix.one /me.
function fakeAuth() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    calls.push(req.headers.authorization);
    const okTok = req.headers.authorization === "Bearer good";
    res.writeHead(okTok ? 200 : 401, { "Content-Type": "application/json" }).end(JSON.stringify({ success: okTok }));
  });
  return { srv, calls };
}

function handshake(port, path, headers) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("\r\n\r\n")) {
        const status = Number(buf.split(" ")[1]);
        if (status === 101) {
          s.write("ping");
          s.once("data", (e) => {
            resolve({ status, echo: e.toString() });
            s.destroy();
          });
          const rest = buf.slice(buf.indexOf("\r\n\r\n") + 4);
          if (rest) {
            resolve({ status, echo: rest });
            s.destroy();
          }
        } else {
          resolve({ status });
          s.destroy();
        }
      }
    });
    s.on("error", () => resolve({ status: 0 }));
    const h = Object.entries({ Host: "x", Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13", ...headers })
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join("");
    s.write(`GET ${path} HTTP/1.1\r\n${h}\r\n`);
  });
}

test("gate", async (t) => {
  const id = fakeUpstream();
  const auth = fakeAuth();
  const idPort = await listen(id.srv);
  const authPort = await listen(auth.srv);
  const gate = createGate({
    upstreams: { "/ws/id": `127.0.0.1:${idPort}`, "/ws/relay": `127.0.0.1:${idPort}` },
    authUrl: `http://127.0.0.1:${authPort}/me`,
    origins: "https://bridge.matix.one",
    log: () => {},
  });
  const port = await listen(gate);
  const origin = { Origin: "https://bridge.matix.one" };

  await t.test("no sign-in → 401", async () => {
    assert.equal((await handshake(port, "/ws/id", origin)).status, 401);
  });
  await t.test("bad token → 401", async () => {
    assert.equal((await handshake(port, "/ws/id", { ...origin, Cookie: "mb_t=bad" })).status, 401);
  });
  await t.test("other site → 403, even with a good token", async () => {
    assert.equal((await handshake(port, "/ws/id", { Origin: "https://evil.example", Cookie: "mb_t=good" })).status, 403);
    assert.equal((await handshake(port, "/ws/id", { Cookie: "mb_t=good" })).status, 403);
  });
  await t.test("unknown path → 404", async () => {
    assert.equal((await handshake(port, "/ws/other", { ...origin, Cookie: "mb_t=good" })).status, 404);
  });
  await t.test("signed in → through to the server, cookie not forwarded", async () => {
    const before = auth.calls.length;
    const r = await handshake(port, "/ws/id", { ...origin, Cookie: "a=1; mb_t=good", "X-Real-IP": "203.0.113.7" });
    assert.equal(r.status, 101);
    assert.equal(r.echo, "ping");
    const hs = id.seen.at(-1);
    assert.match(hs, /^GET \/ HTTP\/1.1/);
    assert.doesNotMatch(hs, /cookie|mb_t/i);
    assert.match(hs, /X-Real-IP: 203\.0\.113\.7/);
    assert.equal((await handshake(port, "/ws/relay", { ...origin, Cookie: "mb_t=good" })).status, 101);
    assert.equal(auth.calls.length - before, 1, "second socket uses the cached check");
  });
  await t.test("agents.matix.one down → 503 (fail closed)", async () => {
    auth.srv.close();
    assert.equal((await handshake(port, "/ws/id", { ...origin, Cookie: "mb_t=other" })).status, 503);
  });

  gate.close();
  id.srv.close();
});
