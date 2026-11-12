// Protocol smoke test from Node: connect, log in, wait for video frames, disconnect.
// ID=123456789 PASSWORD=... ID_SERVER=ws://127.0.0.1:21118 RELAY_SERVER=ws://127.0.0.1:21119 KEY=... npm run smoke
import { Session } from "../src/core/session";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) {
    console.error(`missing env ${k}`);
    process.exit(2);
  }
  return v;
};

const session = new Session(
  env("ID"),
  { idServer: env("ID_SERVER", "ws://127.0.0.1:21118"), relayServer: env("RELAY_SERVER", "ws://127.0.0.1:21119"), key: env("KEY") },
  { agentName: "Matix KG smoke test" }
);

let frames = 0;
let keyFrames = 0;
const codecs = new Set<string>();
session
  .on("status", (s) => console.log("status:", s))
  .on("password", (wrong) => {
    console.log(wrong ? "wrong password" : "password required");
    process.exit(3);
  })
  .on("ready", (pi) => console.log("ready:", JSON.stringify({ host: pi.hostname, user: pi.username, platform: pi.platform, version: pi.version, displays: pi.displays.map((d) => `${d.width}x${d.height}@${d.x},${d.y}`) })))
  .on("video", (fs) => {
    for (const f of fs) {
      frames++;
      if (f.key) keyFrames++;
      codecs.add(f.codec);
    }
    session.videoReceived();
  })
  .on("chat", (t) => console.log("chat:", t))
  .on("closed", (r) => console.log("closed:", r));

const t0 = Date.now();
try {
  await session.connect(process.env.PASSWORD);
  console.log(`logged in after ${Date.now() - t0} ms`);
  if (process.env.CHAT) session.chat(process.env.CHAT);
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS || 6000)));
  console.log(`video: ${frames} frames (${keyFrames} key), codecs: ${[...codecs].join(",") || "none"}`);
  session.close("smoke done");
  process.exit(frames > 0 ? 0 : 4);
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}
