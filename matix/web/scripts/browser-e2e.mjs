// Browser end-to-end check (CI): open the built web client in headless Chromium, connect to a
// real RustDesk peer, wait for decoded video on the canvas, then type into the remote xterm and
// check that the picture changes.  URL, ID, PASSWORD come from the environment.
import { chromium } from "playwright";

const { URL: url, ID: id, PASSWORD: password, SHOT_DIR: shots = "." } = process.env;
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
  await page.goto(url);
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
  await browser.close();
} catch (e) {
  console.error("BROWSER E2E FAILED:", e.message);
  await page.screenshot({ path: `${shots}/e2e-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
}
