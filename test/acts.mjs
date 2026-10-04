// Walks through the things to do around town and a cat fight in headless Chromium.
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
const tips = async () => { for (let i = 0; i < 3; i++) { if (await st(() => !!document.querySelector("#tip.show"))) { await page.click("#tip-ok"); await page.waitForTimeout(250); } } };
const tp = (x, z) => st(([x, z]) => { const me = window.__gossiptown.people.player.walker; me.x = x; me.z = z; }, [x, z]);
await tips();
// park everyone far away so nobody wanders into the shots
await st(() => { const t = window.__gossiptown; for (const id of ["celeste","odette","wren","sylvie","marigold","pippa","brenna","juniper","hesper","tansy"]) { t.game.state().people[id].location = "garden"; } });
// a gift from the bakery
await page.evaluate(() => { const t = window.__gossiptown; const me = t.people.player.walker; me.x = -11.6; me.z = -8.6; });
await page.waitForTimeout(900);
await shot("30-pickup-hint");
await page.keyboard.press("Enter"); await page.waitForTimeout(900); await tips();
await shot("31-carrying");
console.log("carrying", await st(() => window.__gossiptown.game.state().player.carrying));
// the notice board
await page.evaluate(() => { const me = window.__gossiptown.people.player.walker; me.x = 6.2; me.z = -7.7; me.heading = Math.PI; });
await page.waitForTimeout(900);
await shot("32-board-hint");
await page.keyboard.press("Enter"); await page.waitForTimeout(600);
await page.keyboard.type("Odette Crane waters down her perfume and sells it as new.");
await shot("33-board-typing");
await page.keyboard.press("Enter"); await page.waitForTimeout(2500); await tips();
await shot("34-board-pinned");
console.log("notes", await st(() => JSON.stringify(window.__gossiptown.game.state().notes)));
// a mailbox
await page.evaluate(() => { const me = window.__gossiptown.people.player.walker; me.x = 11.6; me.z = 25.7; });
await page.waitForTimeout(900);
await shot("35-mail-hint");
await page.keyboard.press("Enter"); await page.waitForTimeout(3000); await tips();
await shot("36-mail-result");
console.log("heard", await st(() => window.__gossiptown.game.state().player.heard.map((h) => h.rid).join(",")));
// a cat fight between two women near the player
await page.evaluate(() => { const t = window.__gossiptown; const me = t.people.player.walker; me.x = 0; me.z = 8; for (const [id, x] of [["wren", -1], ["sylvie", 1]]) { const p = t.people[id]; p.inside = false; p.gone = false; p.model.root.visible = true; p.walker.x = x; p.walker.z = 4; p.walker.stop(); } t.cam.pos.set(0, 14, 24); t.ui.fight("wren", "sylvie", { winner: "wren" }); });
await page.waitForTimeout(2500); await tips();
await shot("37-npc-fight");
await page.waitForTimeout(2500);
// she comes for you
await page.evaluate(() => { const t = window.__gossiptown; const me = t.people.player.walker; me.x = 0; me.z = 5.4; });
await page.waitForTimeout(600);
await page.keyboard.press("Enter"); await page.waitForTimeout(800); await tips();
await page.keyboard.type("Fight me, I'll pull your hair out!");
await page.keyboard.press("Enter");
for (let i = 0; i < 200 && (await st(() => window.__gossiptown.mode)) !== "fight"; i++) { await page.waitForTimeout(300); await tips(); }
console.log("mode", await st(() => window.__gossiptown.mode));
await tips();
await shot("38-player-fight");
for (let i = 0; i < 150 && (await st(() => window.__gossiptown.mode)) === "fight"; i++) { for (let k = 0; k < 3; k++) await page.keyboard.press("Enter"); await page.waitForTimeout(120); if (i === 4) await shot("39-player-fight-mid"); }
await page.waitForTimeout(2500);
await shot("40-after-fight");
console.log("fights", await st(() => window.__gossiptown.game.state().player.fights), "log", await st(() => window.__gossiptown.game.state().log.slice(-3).map((l) => l.text).join(" | ")));
console.log(errors.filter((e) => !/Failed to load resource/.test(e)).slice(0, 20).join("\n"));
await browser.close();
