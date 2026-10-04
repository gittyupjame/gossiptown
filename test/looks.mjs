// The outfit chooser in headless Chromium: dress for arrival on a budget, first
// impressions at the welcome party, then a change of look at the salon's clothes rack.
//   node test/looks.mjs [shots dir] [url]
import { chromium } from "playwright-core";
const out = process.argv[2] || "/tmp/claude-0/shots";
const url = (process.argv[3] || "http://127.0.0.1:4747/") + "?fast";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => { if (m.type() === "error" && !/502|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const st = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
await page.goto(url);
await page.waitForTimeout(3000);
await page.click("#t-new");
await page.fill("#name-in", "Rosie");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
ok(await st(() => document.querySelector("#wardrobe")?.classList.contains("show")), "the wardrobe opens after you pick a name");
await shot("60-wardrobe");
await page.click('[data-item="tea"]');
await page.click('[data-color="#7fbf8f"]');
await page.click('[data-tab="hat"]'); await page.click('[data-item="tiara"]');
await page.click('[data-tab="neck"]'); await page.click('[data-item="pearls"]');
ok(await st(() => document.getElementById("wd-ok").disabled), "a tiara and pearls on top blow the budget, so you can't arrive in it");
await shot("61-over-budget");
await page.click('[data-tab="hat"]'); await page.click('[data-item="sunhat"]');
await page.click('[data-tab="shoes"]'); await page.click('[data-item="boots"]');
await page.click('[data-tab="neck"]'); await page.click('[data-item="locket"]');
await page.click('[data-tab="bag"]'); await page.click('[data-item="basket"]');
await page.click('[data-tab="hair"]'); await page.click('[data-item="braid"]');
await shot("62-dressed");
const purse = await st(() => document.getElementById("wd-purse").textContent);
ok(/150/.test(purse), "the purse shows spend against the budget: " + purse.trim());
await page.keyboard.press("Enter");
let sawLooks = false;
for (let i = 0; i < 200; i++) {
  if (await st(() => window.__gossiptown.mode) === "play") break;
  const n = await st(() => Object.keys(window.__gossiptown.game?.state()?.looks || {}).length);
  if (n >= 10 && !sawLooks) { sawLooks = true; await page.waitForTimeout(1500); await shot("63a"); await page.waitForTimeout(2500); await shot("63-first-impressions"); }
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
}
const s1 = await st(() => { const s = window.__gossiptown.game.state(); return { coins: s.player.coins, outfit: s.player.outfit, looks: Object.fromEntries(Object.entries(s.looks).map(([k, v]) => [k, [v.verdict.toFixed(1), v.reaction]])) }; });
ok(s1.outfit.dress === "tea" && s1.outfit.hat === "sunhat", "she arrives in what you picked");
ok(s1.coins === 150 - (40 + 15 + 30 + 20 + 5 + 10), `the purse was charged (${s1.coins} left)`);
ok(Object.keys(s1.looks).length === 10, "all ten women sized her up at the welcome party: " + JSON.stringify(s1.looks));
for (let i = 0; i < 3; i++) { if (await st(() => !!document.querySelector("#tip.show"))) { await page.click("#tip-ok"); await page.waitForTimeout(250); } }
await shot("64-play");
ok(await st(() => document.getElementById("hud-coins").textContent) == s1.coins, "the HUD shows your coins");
// walk to the rack (with a couple of mornings' stipend in the purse)
await st(() => { window.__gossiptown.game.state().player.coins += 80; });
await st(() => { const g = window.__gossiptown; g.me.walker.x = 9.4; g.me.walker.z = -8.3; g.me.walker.stop(); });
await page.waitForTimeout(500);
await shot("65-rack");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
ok(await st(() => document.querySelector("#wardrobe")?.classList.contains("show")), "the clothes rack opens the wardrobe");
const owned = await st(() => document.querySelector('[data-tab="dress"]') && [...document.querySelectorAll(".wd-item")].find((b) => b.dataset.item === "tea")?.textContent);
ok(/Owned/.test(owned), "pieces you own are marked Owned");
await page.click('[data-item="leather"]');
await page.click('[data-color="#2a2430"]');
await page.click('[data-tab="hat"]'); await page.click('[data-item="nohat"]');
const t0 = await st(() => window.__gossiptown.game.state().minute);
await page.waitForTimeout(1500);
ok(await st(() => window.__gossiptown.game.state().minute) === t0, "time stops while you're choosing");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
const s2 = await st(() => { const s = window.__gossiptown.game.state(); return { coins: s.player.coins, dress: s.player.outfit.dress }; });
ok(s2.dress === "leather" && s2.coins === s1.coins + 80 - 75, `changed into the leather jacket (${s2.coins} coins left)`);
await shot("66-new-look");
// let the town notice
for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); }
const seen = await st(() => { const s = window.__gossiptown.game.state(); return Object.values(s.looks).filter((l) => l.key.startsWith("leather")).length; });
console.log(`  ${seen} women have seen the new look so far`);
await shot("67-later");
console.log("errors", errors.length ? errors.slice(0, 6) : "none");
ok(!errors.length, "no page errors");
await browser.close();
