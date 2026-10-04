// Plays one of Primrose's shows in headless Chromium, typing the player's turns.
//   FORMAT=toast node test/show.mjs [shots dir] [url]
import { chromium } from "playwright-core";
const out = process.argv[2] || "/tmp/claude-0/shots";
const url = (process.argv[3] || "http://127.0.0.1:4747/") + "?fast";
const FORMAT = process.env.FORMAT || "toast";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.type() + ": " + m.text()); });
const st = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await page.goto(url);
await page.waitForTimeout(3000);
await page.click("#t-new");
await page.fill("#name-in", "Rosie");
await page.keyboard.press("Enter");
for (let i = 0; i < 150; i++) { if (await st(() => window.__gossiptown.mode) === "play") break; await page.keyboard.press("Enter"); await page.waitForTimeout(300); }
const tips = async () => { for (let i = 0; i < 3; i++) { if (await st(() => !!document.querySelector("#tip.show"))) { await page.click("#tip-ok"); await page.waitForTimeout(250); } } };
await tips();
// today's show, starting in a few game minutes
await st((f) => { const s = window.__gossiptown.game.state(); s.event = { day: s.day, format: f, minute: s.minute + 35, place: { toast: "tavern", clear_air: "plaza", hot_seat: "hall", send_home: "firepit", hot_cold: "salon", tea: "bakery", soapbox: "market", confessions: "garden", roast: "smithy" }[f], bell: false, done: false }; }, FORMAT);
await page.waitForTimeout(1500); await tips();
await shot(`50-${FORMAT}-pill`);
const SAY = ["To Wren! The only woman in this town with a heart. Cheers!", "Sylvie, you're a two-faced snake and everyone here knows it.", "That's a lie and you know it.", "Honestly? Celeste should go home tonight."];
let typed = 0, n = 0, sawShow = false;
for (let i = 0; i < 400; i++) {
  await tips();
  const m = await st(() => window.__gossiptown.mode);
  if (m === "show") sawShow = true;
  if (sawShow && m === "play") break;
  const typing = await st(() => !!document.querySelector(".bubble.typing:not(.locked)"));
  if (typing) {
    await shot(`5${n++ % 10}-${FORMAT}-typing`);
    await page.keyboard.type(SAY[typed++ % SAY.length]);
    await page.keyboard.press("Enter");
  }
  if (i % 12 === 5 && sawShow) await shot(`5${n++ % 10}-${FORMAT}-${i}`);
  await page.waitForTimeout(400);
}
const res = await st(() => { const s = window.__gossiptown.game.state(); return { mode: window.__gossiptown.mode, done: s.event?.done, minute: s.minute, phase: s.phase, score: s.player.showScore, mem: Object.values(s.people).map((v) => v.memory.filter((m) => /at (The |Clear|Who|Hot|Morning|True)/.test(m)).length).reduce((a, b) => a + b, 0), log: s.log.slice(-6).map((l) => l.text) }; });
console.log(JSON.stringify(res, null, 1));
console.log("typed", typed, "errors", errors.length ? errors.slice(0, 6) : "none");
await shot(`59-${FORMAT}-after`);
await browser.close();
