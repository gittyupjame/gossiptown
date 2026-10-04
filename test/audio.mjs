// Checks the sound in headless Chromium: the audio starts on the first key press, every
// music track renders at a sane level, the town makes its sounds, and pause suspends it.
import { chromium } from "playwright-core";
const url = (process.argv[2] || "http://127.0.0.1:4747/") + "?fast";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); if (m.type() === "warning" && /audio|Audio/.test(m.text())) errors.push("warn: " + m.text()); });
const st = (fn, a) => page.evaluate(fn, a);
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) process.exitCode = 1; };
await page.goto(url);
await page.waitForTimeout(2500);
await page.keyboard.press("Shift");
await page.waitForTimeout(500);
ok(await st(() => window.__gossiptown.audio.audioState.ctx?.state === "running"), "audio starts after the first key press");
for (const name of ["title", "day", "evening", "show", "vote", "fight", "night"]) {
  const r = await st((n) => window.__gossiptown.audio.renderTrack(n, 8), name);
  ok(r.rms > 0.01 && r.peak < 1.0, `${name.padEnd(8)} rms ${r.rms.toFixed(3)} peak ${r.peak.toFixed(2)}`);
}
for (const k of ["voice", "crowd", "drama", "showOpen", "fanfare", "eliminated"]) {
  const r = await st((n) => window.__gossiptown.audio.renderMoment(n, 3), k);
  ok(r.rms > 0.005 && r.peak < 1.0, `${k.padEnd(10)} rms ${r.rms.toFixed(3)} peak ${r.peak.toFixed(2)}`);
}
// a new game: title music, then the day
await page.click("#t-new");
await page.fill("#name-in", "Rosie");
await page.keyboard.press("Enter");
for (let i = 0; i < 150; i++) { if (await st(() => window.__gossiptown.mode) === "play") break; await page.keyboard.press("Enter"); await page.waitForTimeout(300); }
await page.waitForTimeout(1500);
// walk a little, let people talk, fire every kind of sound
await page.keyboard.down("KeyW"); await page.waitForTimeout(1500); await page.keyboard.up("KeyW");
await st(() => { const a = window.__gossiptown.audio; for (const s of ["click", "key", "send", "tip", "toast", "tea", "paper", "pickup", "pin", "creak", "whoosh", "thunk", "tally", "fizzle", "pow", "slap", "tap", "bell", "hour", "handbell", "board"]) a.sfx(s); for (const k of ["laugh", "gasp", "anger", "heart", "sparkle", "sad", "whisper", "suspicious", "cringe", "question", "wave"]) a.emote("pippa", k); a.crowd({ loved: 3, amused: 2, cringed: 1, offended: 2 }); for (const s of ["drama", "bad", "good", "showOpen", "fanfare", "sad", "eliminated", "drumroll", "morning", "nightfall"]) a.sting(s); a.voice("brenna", "What do you want? Make it quick!"); a.scuffle(1); });
await page.waitForTimeout(2500);
// pause suspends everything, unpausing brings it back
await page.keyboard.press("KeyP"); await page.waitForTimeout(400);
ok(await st(() => window.__gossiptown.audio.audioState.ctx.state === "suspended"), "pause suspends the audio");
await page.keyboard.press("KeyP"); await page.waitForTimeout(400);
ok(await st(() => window.__gossiptown.audio.audioState.ctx.state === "running"), "unpause resumes it");
await page.keyboard.press("KeyM"); await page.waitForTimeout(200);
ok(await st(() => window.__gossiptown.audio.audioState.vol.muted === true && document.getElementById("btn-mute").textContent === "🔇"), "M mutes");
await page.keyboard.press("KeyM");
ok(errors.length === 0, "no errors " + (errors.length ? JSON.stringify(errors.slice(0, 5)) : ""));
await browser.close();
