// MatixBridge sign-in gate: sits between the web proxy (Apache/nginx) and the WebSocket ports of
// hbbs (/ws/id) and hbbr (/ws/relay). A browser gets through only with a valid MatixBridge sign-in
// from agents.matix.one, sent as the "mb_t" cookie (browsers cannot set headers on a WebSocket).
// Together with the patched hbbs (matix/server/hbbs/agents-only.patch), which refuses sessions that
// do not come in over its WebSocket port, only signed-in Matix staff can start a session.
//
// The sign-in is checked when a socket opens, against agents.matix.one's /api/v1/matixbridge/me
// (which also refuses disabled agents and suspended organisations). An open session is not cut
// when the agent is disabled later. No dependencies: node gate.mjs.
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

export function createGate(opts = {}) {
  const env = process.env;
  const cfg = {
    upstreams: opts.upstreams || {
      "/ws/id": env.GATE_ID_UPSTREAM || "127.0.0.1:21118",
      "/ws/relay": env.GATE_RELAY_UPSTREAM || "127.0.0.1:21119",
    },
    authUrl: opts.authUrl || env.GATE_AUTH_URL || "http://127.0.0.1:3001/api/v1/matixbridge/me",
    origins: new Set((opts.origins || env.GATE_ORIGINS || "https://bridge.matix.one,https://kg.matix.one").split(",").map((s) => s.trim()).filter(Boolean)),
    cacheMs: Number(opts.cacheMs ?? env.GATE_CACHE_MS ?? 60_000),
    authTimeoutMs: Number(opts.authTimeoutMs ?? 5000),
    log: opts.log || ((...a) => console.log(new Date().toISOString(), ...a)),
  };

  // sha256(token) -> time until which the sign-in counts as checked. A session opens 2-4 sockets.
  const ok = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, t] of ok) if (t <= now) ok.delete(k);
  }, 60_000);
  sweep.unref();

  async function verify(token) {
    const key = crypto.createHash("sha256").update(token).digest("hex");
    if ((ok.get(key) || 0) > Date.now()) return 200;
    let r;
    try {
      r = await fetch(cfg.authUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(cfg.authTimeoutMs) });
    } catch {
      return 503; // agents.matix.one unreachable: fail closed
    }
    const j = await r.json().catch(() => ({}));
    if (r.status === 200 && j.success !== false) {
      if (ok.size > 10_000) ok.clear();
      ok.set(key, Date.now() + cfg.cacheMs);
      return 200;
    }
    return r.status === 401 || r.status === 403 ? 401 : 503;
  }

  const reasons = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 503: "Service Unavailable" };
  const refuse = (socket, code) => {
    socket.end(`HTTP/1.1 ${code} ${reasons[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  function cookie(header, name) {
    for (const part of (header || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === name) {
        try {
          return decodeURIComponent(part.slice(i + 1).trim());
        } catch {
          return "";
        }
      }
    }
    return "";
  }

  const server = http.createServer((req, res) => res.writeHead(426, { Connection: "close" }).end());
  server.on("upgrade", async (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const path = (req.url || "").split("?")[0].replace(/\/+$/, "");
    const upstream = cfg.upstreams[path];
    const ip = req.headers["x-real-ip"] || req.socket.remoteAddress;
    if (!upstream) return refuse(socket, 404);
    if (!cfg.origins.has(req.headers.origin || "")) {
      cfg.log("refused", path, ip, "origin", req.headers.origin || "-");
      return refuse(socket, 403);
    }
    const token = cookie(req.headers.cookie, "mb_t");
    const status = token ? await verify(token) : 401;
    if (status !== 200) {
      cfg.log("refused", path, ip, status === 401 ? "not signed in" : "sign-in check unavailable");
      return refuse(socket, status);
    }
    if (socket.destroyed) return;

    // Forward the handshake unchanged except: path "/", no Cookie (the token stays here).
    const [host, port] = [upstream.slice(0, upstream.lastIndexOf(":")), Number(upstream.slice(upstream.lastIndexOf(":") + 1))];
    const up = net.connect(port, host);
    let lines = `${req.method} / HTTP/1.1\r\n`;
    let hasRealIp = false;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const lower = name.toLowerCase();
      if (lower === "cookie") continue;
      if (lower === "x-real-ip") hasRealIp = true;
      lines += `${name}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    if (!hasRealIp && req.socket.remoteAddress) lines += `X-Real-IP: ${req.socket.remoteAddress.replace(/^::ffff:/, "")}\r\n`;
    up.on("connect", () => {
      up.write(lines + "\r\n");
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    up.on("close", () => socket.destroy());
    socket.on("close", () => up.destroy());
  });
  server.on("close", () => clearInterval(sweep));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.GATE_PORT || 21120);
  const host = process.env.GATE_HOST || "127.0.0.1";
  createGate().listen(port, host, () => console.log(`matixbridge-gate listening on ${host}:${port}`));
}
