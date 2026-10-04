// Outfits through the core with the offline stand-in: the budget, first impressions,
// gossip about your look, and the look showing up in later decisions.
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");
const W = await import("../src/core/wardrobe.js");
const L = await import("../src/core/looks.js");
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };
const emotes = [];
const ui = { headline: () => {}, distance: () => 5, hearing: () => "none", first: () => {}, emote: (id, k) => emotes.push([id, k]) };

const glam = { ...W.STARTER, dress: "sequin", shoes: "flats", hair: "long", dye: "chestnut", color: "#ff8fb8" };
const g = createGame(ui, { daySeconds: 60 });
const s = g.newSeason("Rosie", glam);
ok(s.player.coins === W.BUDGET - 130, `budget pays for the outfit: ${s.player.coins} coins left`);
ok(s.player.owned.includes("sequin") && W.lookOf(s.player.outfit).dress === "sequin", "she owns and wears the sequin dress");
ok(!g.dress({ ...glam, dress: "gown" }).ok, "can't afford the ballgown on what's left");
console.log("  " + L.lookText(s));

await g.firstLooks({ where: "the welcome party" });
ok(Object.keys(s.looks).length === 10, "every woman sized her up at the welcome party");
for (const v of sim.alive(s)) console.log(`    ${sim.first(v).padEnd(9)} ${L.lookCue(s, v.id)}  (${s.looks[v.id].reaction})  affinity ${s.rel[v.id].player.affinity.toFixed(2)}`);
const glamFans = ["celeste", "pippa"].map((id) => s.looks[id].verdict), plainFans = ["brenna", "juniper"].map((id) => s.looks[id].verdict);
ok(glamFans.reduce((a, b) => a + b) > plainFans.reduce((a, b) => a + b), `taste matters: glam lovers ${glamFans.map((x) => x.toFixed(1))} vs. Brenna/Juniper ${plainFans.map((x) => x.toFixed(1))}`);
ok(emotes.length >= 5, `reactions show over their heads (${emotes.length})`);
const lookRumors = Object.values(s.rumors).filter((r) => r.kind === "look");
ok(lookRumors.length >= 1, `the look became gossip: ${lookRumors.map((r) => r.text).join(" / ")}`);
ok(/thinks her look is/.test(sim.feelings(s, s.people.celeste, "player")), "the verdict is in every later state about her: " + sim.feelings(s, s.people.celeste, "player"));

// a frumpy copy of Celeste
const copy = { ...W.STARTER, dress: "frock", hair: "bigcurls", dye: "platinum", color: "#ff8fb8", face: "shades" };
s.player.coins = 500;
const r = g.dress(copy);
ok(r.ok && r.changed && r.spent === 85, `changing costs only the new pieces (${r.spent})`);
ok(L.lookalike(s)?.id === "celeste", "dressed like Celeste: " + L.lookalike(s)?.name);
await L.notice(s, ui, { max: 10 });
ok(s.looks.celeste.key === W.outfitKey(copy), `they notice the new outfit; Celeste: ${s.looks.celeste.reaction}`);

// payday and the vote
const coins = s.player.coins;
g.nextDay();
ok(s.player.coins === coins + W.STIPEND, "the producers pay a stipend each morning");
ok(/wearing/.test(L.lookText(s)) && /days running/.test((s.player.outfitSince = s.day - 2, L.lookText(s))), "wearing the same thing for days is noticed");
const votes = await sim.castVotes(s, [...sim.alive(s).map((v) => v.id), "player"], sim.alive(s));
ok(Object.keys(votes).length === 10, `the vote still works with looks in it (${Object.values(votes).filter((x) => x === "player").length} for Rosie)`);
