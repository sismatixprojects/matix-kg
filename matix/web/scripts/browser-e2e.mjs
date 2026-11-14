// Browser end-to-end check (CI): open the built web client in headless Chromium, connect to a
// real RustDesk peer, wait for decoded video on the canvas, then type into the remote xterm and
// check that the picture changes.  URL, ID, PASSWORD come from the environment.
import { chromium } from "playwright";
import http from "node:http";

const { URL: url, ID: id, PASSWORD: password, SHOT_DIR: shots = "." } = process.env;
// Team phase (TEAM_API_PORT set, and config.json's agentsUrl points at it): a stand-in for
// agents.matix.one's /api/v1/matixbridge that records what the web client sends. The real routes
// are tested in the agents.matix.one repo; this checks the web client's side of the contract.
const calls = [];
let teamApi;
if (process.env.TEAM_API_PORT) {
  teamApi = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url.replace("/api/v1/matixbridge", "");
      const json = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, path, body: json, auth: req.headers.authorization || "" });
      console.log(`team api: ${req.method} ${path} ${body}`);
      const send = (o, st = 200) => res.writeHead(st, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(o));
      if (path === "/auth/exchange") return json?.code === "ci-code" ? send({ success: true, token: "ci-token", expires_in: 3600, agent: { id: 1, username: "ci", full_name: "CI Agent", role: "agent" }, org: { id: 1, name: "CI Org" } }) : send({ success: false, message: "expired" }, 401);
      if (req.headers.authorization !== "Bearer ci-token") return send({ success: false }, 401);
      if (path === "/me") return send({ success: true, agent: { id: 1, username: "ci", full_name: "CI Agent", role: "agent" }, org: { id: 1, name: "CI Org" } });
      if (path === "/devices") return send({ success: true, devices: [] });
      if (path === "/sessions") return send({ success: true, session_id: 7, device: { id: json.device_id, name: "", host: json.host } });
      if (path === "/sessions/7/end") return send({ success: true });
      send({ success: false, message: "not found" }, 404);
    });
  });
  await new Promise((r) => teamApi.listen(Number(process.env.TEAM_API_PORT), "127.0.0.1", r));
}
const waitFor = async (pred, ms, what) => {
  for (let t = 0; t < ms; t += 250) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => console.log(`page[${m.type()}]: ${m.text()}`));
page.on("pageerror", (e) => console.log(`page error: ${e.message}`));

const litPixels = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c || c.width < 100) return { lit: 0, hash: 0, w: 0, h: 0 };
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    let hash = 0;
    for (let i = 0; i < d.length; i += 4 * 61) {
      const v = d[i] + d[i + 1] + d[i + 2];
      if (v > 30) lit++;
      hash = (hash * 31 + v) | 0;
    }
    return { lit, hash, w: c.width, h: c.height };
  });

try {
  // Arabic is the default: a first visit reads right to left, in Arabic.
  await page.goto(url);
  await page.waitForSelector(".lang-switch");
  const first = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, text: document.body.innerText }));
  if (first.dir !== "rtl" || first.lang !== "ar" || !/الدعم الفني عن بُعد/.test(first.text)) throw new Error(`Not Arabic by default: ${JSON.stringify({ dir: first.dir, lang: first.lang })}`);
  console.log("first visit: Arabic, right to left");
  // The checks below read English text: switch with the button, which is remembered.
  await page.click(".lang-switch");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.goto(url);
  if ((await page.evaluate(() => document.documentElement.dir)) !== "ltr") throw new Error("The English choice was not remembered");
  if (teamApi) {
    // agentsUrl set: signing in is required, and the server's gate (in front of the ID and relay
    // WebSocket ports here, as in production) lets the browser through only with the sign-in cookie.
    await page.waitForSelector(".team-signin");
    if (await page.$("#peer-id")) throw new Error("The connect form is shown without signing in");
    console.log("signed out: only the sign-in button is shown");
    await page.goto("about:blank");
    await page.goto(`${url}#code=ci-code`);
    await page.waitForSelector(".team-dot");
    await page.context().clearCookies();
    await page.fill("#peer-id", id);
    await page.fill("#peer-pw", password);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => /Cannot reach the ID server/.test(document.querySelector(".error")?.textContent || ""), null, { timeout: 30000 });
    console.log("without the gate cookie the server refuses the browser:", await page.textContent(".error"));
    await page.reload(); // signed in (localStorage): the cookie is set again at boot
    await page.waitForSelector(".team-dot");
  }
  await page.fill("#peer-id", id);
  await page.fill("#peer-pw", password);
  await page.fill("#agent", "CI e2e");
  await page.click("button[type=submit]");
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas");
      if (!c || c.width < 100) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4 * 61) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      return lit > 50;
    },
    null,
    { timeout: 45000 }
  );
  const before = await litPixels();
  console.log("video on canvas:", JSON.stringify(before));
  await page.screenshot({ path: `${shots}/e2e-video.png` });

  // The whole remote screen stays visible in a short window (the bottom used to be cut off).
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const c = document.querySelector("canvas").getBoundingClientRect();
    const s = document.querySelector(".stage").getBoundingClientRect();
    return { canvas: [c.left, c.top, c.right, c.bottom].map(Math.round), stage: [s.left, s.top, s.right, s.bottom].map(Math.round) };
  });
  const [cl, ct, cr, cb] = fit.canvas, [sl, st, sr, sb] = fit.stage;
  if (cl < sl - 1 || ct < st - 1 || cr > sr + 1 || cb > sb + 1) throw new Error(`The remote screen does not fit the window: ${JSON.stringify(fit)}`);
  console.log("whole remote screen fits a short window:", JSON.stringify(fit));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);

  // Keyboard + mouse: click into the remote xterm and type a command that fills the screen.
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("seq 1 200", { delay: 30 });
  await page.keyboard.press("Enter");
  let after = before;
  for (let i = 0; i < 40 && after.hash === before.hash; i++) {
    await page.waitForTimeout(250);
    after = await litPixels();
  }
  await page.screenshot({ path: `${shots}/e2e-typed.png` });
  console.log("after typing:", JSON.stringify(after));
  if (after.hash === before.hash) throw new Error("The remote picture did not change after typing");
  const saved = await page.evaluate((peer) => JSON.parse(localStorage.getItem("matixbridge.book") || "[]").find((d) => d.id === peer), id);
  console.log("address book entry:", JSON.stringify(saved));
  if (!saved || !saved.host) throw new Error("The connected device was not saved to the address book");
  console.log("BROWSER E2E OK");

  if (teamApi) {
    // Launched from a ticket in agents.matix.one: single-use code + device + ticket in the fragment.
    calls.length = 0; // the session above was logged too (signed in); check only the ticket launch
    await page.goto("about:blank");
    await page.goto(`${url}#code=ci-code&id=${id}&ticket=10`);
    // Without a password the session waits for the customer to click Accept, which this headless
    // peer cannot do. Cancel, then connect with the password like an agent would: the ticket stays
    // attached to this device.
    await page.waitForSelector("text=Waiting for the customer to accept", { timeout: 45000 });
    if (page.url().includes("#")) throw new Error("The sign-in code was left in the address bar");
    await page.click('button[title="Disconnect"]');
    await page.waitForSelector(".team-ticket", { timeout: 10000 });
    if ((await page.inputValue("#peer-id")).replace(/\D/g, "") !== id) throw new Error("The device ID was not kept");
    await page.fill("#peer-pw", password);
    await page.click("form.card button[type=submit]");
    await waitFor(() => calls.some((c) => c.path === "/sessions"), 45000, "the session to be logged");
    const start = calls.find((c) => c.path === "/sessions");
    console.log("logged session:", JSON.stringify(start.body));
    if (start.body.device_id !== id || start.body.ticket_id !== "10" || start.body.kind !== "control" || !start.body.host) throw new Error("The logged session is missing the device, ticket or computer name");
    await page.click('button[title="Disconnect"]');
    await waitFor(() => calls.some((c) => c.path === "/sessions/7/end"), 15000, "the session end to be logged");
    await page.waitForSelector(".team-ticket", { timeout: 10000 });
    const bar = await page.textContent(".team-bar");
    if (!/Signed in as CI Agent/.test(bar)) throw new Error(`Unexpected team bar: ${bar}`);
    await page.screenshot({ path: `${shots}/e2e-team.png` });
    console.log("TEAM E2E OK");
    teamApi.close();
  }
  await browser.close();
} catch (e) {
  console.error("BROWSER E2E FAILED:", e.message);
  await page.screenshot({ path: `${shots}/e2e-failure.png` }).catch(() => {});
  teamApi?.close();
  await browser.close();
  process.exit(1);
}
