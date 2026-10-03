// Jumps straight to the first vote night and plays the ceremony through.
import { chromium } from "playwright-core";
const out = process.argv[2] || "/tmp/claude-0/shots";
const url = (process.argv[3] || "http://127.0.0.1:4747/") + "?fast";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.type() + ": " + m.text()); });
const T = () => page.evaluate(() => window.__gossiptown);
const st = (fn) => page.evaluate(fn);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const step = process.env.STEP || "all";
await page.goto(url);
await page.waitForTimeout(3000);
await page.click("#t-new");
await page.fill("#name-in", "Rosie");
await page.keyboard.press("Enter");
for (let i = 0; i < 150; i++) { if (await st(() => window.__gossiptown.mode) === "play") break; await page.keyboard.press("Enter"); await page.waitForTimeout(300); }
console.log("mode", await st(() => window.__gossiptown.mode));
for (let i = 0; i < 3; i++) { if (await st(() => !!document.querySelector("#tip.show"))) await page.click("#tip-ok"); await page.waitForTimeout(200); }
// jump to the vote
if (process.env.FINALE) await st(() => { const s = window.__gossiptown.game.state(); const t = window.__gossiptown; for (const id of ["odette","wren","sylvie","marigold","pippa","brenna","juniper","hesper"]) { s.people[id].out = true; s.people[id].gone = true; s.people[id].outDay = 2; t.people[id].gone = true; t.people[id].model.root.visible = false; } });
await st(() => { const s = window.__gossiptown.game.state(); s.day = 3; s.minute = 19 * 60 + 58; });
for (let i = 0; i < 40; i++) { if (await st(() => window.__gossiptown.mode) === "vote-pick") break; await page.waitForTimeout(500); if (await st(() => !!document.querySelector("#tip.show"))) await page.click("#tip-ok"); else await page.keyboard.press("Enter"); }
console.log("mode", await st(() => window.__gossiptown.mode));
await page.waitForTimeout(500);
for (let i = 0; i < 2; i++) { if (await st(() => !!document.querySelector("#tip.show"))) { await page.click("#tip-ok"); await page.waitForTimeout(300); } }
await shot("20-vote-pick");
// walk to odette's seat
await st(() => { const t = window.__gossiptown; const w = t.people.odette.walker; const me = t.people.player.walker; const dx = -26 - w.x, dz = -37 - w.z, d = Math.hypot(dx, dz); me.x = w.x + dx / d * 1.2; me.z = w.z + dz / d * 1.2; });
await page.waitForTimeout(600);
for (let i = 0; i < 20 && (await st(() => window.__gossiptown.mode)) === "vote-pick"; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(700); if (i === 1) await shot("21-vote-confirm"); }
await page.waitForTimeout(4000);
await shot("22-reveal");
for (let i = 0; i < 80; i++) { const m = await st(() => window.__gossiptown.mode); if (m === "night" || m === "end") break; await page.waitForTimeout(600); if (i % 3 === 0) await shot("23-reveal-" + (i / 3)); if (i % 4 === 3) await page.keyboard.press("Enter"); }
await page.waitForTimeout(3000);
await shot("24-after-vote");
console.log("mode", await st(() => window.__gossiptown.mode), "votes", JSON.stringify(await st(() => window.__gossiptown.game.state().votes)));
for (let i = 0; i < 6; i++) { if (await st(() => !!document.querySelector("#tip.show"))) await page.click("#tip-ok"); else await page.keyboard.press("Enter"); await page.waitForTimeout(800); }
await page.waitForTimeout(3000);
await shot("25-next");
console.log("mode", await st(() => window.__gossiptown.mode), "day", await st(() => window.__gossiptown.game.state().day), "over", JSON.stringify(await st(() => window.__gossiptown.game.state().over)));
console.log(errors.filter((e) => !/Failed to load resource/.test(e)).slice(0, 30).join("\n"));
await browser.close();
