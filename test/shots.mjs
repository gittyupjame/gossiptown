// Drives the built game in headless Chromium and saves screenshots.
import { chromium } from "playwright-core";
const out = process.argv[2] || "/tmp/claude-0/shots";
const url = process.argv[3] || "http://127.0.0.1:4747/";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
await page.goto(url);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/01-title.png` });
await page.click("#t-new");
await page.fill("#name-in", "Rosie");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/02-intro.png` });
for (let i = 0; i < 8; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(700); }
await page.screenshot({ path: `${out}/03-cast.png` });
for (let i = 0; i < 20; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(500); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/04-play.png` });
await page.keyboard.press("Enter"); // dismiss welcome tip
await page.waitForTimeout(300);
await page.keyboard.down("KeyW"); await page.waitForTimeout(900); await page.keyboard.up("KeyW");
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/05-walk.png` });
console.log(JSON.stringify(await page.evaluate(() => ({ mode: window.__gossiptown.mode, minute: window.__gossiptown.game.state().minute }))));
console.log(errors.slice(0, 30).join("\n"));
await browser.close();
