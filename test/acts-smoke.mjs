// Exercises the things to do around town and the cat fights with the offline stand-in.
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");
const log = [];
const ui = { headline: (t, k) => log.push(`HEADLINE[${k}] ${t}`), distance: (v) => (v.location === "plaza" ? 5 : 30), hearing: () => "none", fight: (a, b, o) => log.push(`FIGHT ${a} vs ${b} -> ${o?.winner}`), gift: (id, how) => log.push(`GIFT ${id} ${how}`), first: () => {} };
const g = createGame(ui, { daySeconds: 60 });
g.newSeason("Rosie");
const s = g.state();
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };

// a gift
ok(g.pickUp("cupcake")?.icon === "🧁", "picked up a cupcake");
g.startTalk("pippa");
const before = s.rel.pippa.player.affinity;
const r1 = await g.say("I brought you a cupcake, here!");
ok(s.player.carrying === null, `gift handed over (${r1.debug.intent})`);
ok(log.some((l) => l.startsWith("GIFT pippa")), "gift reaction recorded: " + log.find((l) => l.startsWith("GIFT")));
console.log("    affinity", before.toFixed(2), "->", s.rel.pippa.player.affinity.toFixed(2));

// the player starts a fight
g.startTalk("sylvie");
const r2 = await g.say("Fight me. I'll slap that smirk right off you!");
ok(r2.fight?.by === "player", `slapping starts a fight (${r2.debug.intent})`);
s.people.wren.location = "plaza"; s.people.celeste.location = "plaza";
const f = await g.fight("sylvie", { by: "player", result: "won" });
ok(s.player.fights === 1, "the player now has a fight on her record");
ok(f && /cat fight/.test(f.text), "fight story: " + f?.text);
console.log("    sides", JSON.stringify(f.sided));

// snooping
const sn = await g.snoop("hesper");
ok(sn.isSecret, "first snoop finds Hesper's secret: " + sn.found);
const sn2 = await g.snoop("hesper");
ok(sn2.again, "second snoop the same day finds nothing new");

// an anonymous note, read by people at the plaza
const note = await g.postNote("Odette Crane waters down her perfume and sells it as new.");
ok(note.about === "odette", "note is about Odette");
for (const v of sim.alive(s)) v.location = "plaza";
for (let i = 0; i < 6; i++) g.update(4); // a few ticks
await new Promise((r) => setTimeout(r, 200));
while (g.busy()) await new Promise((r) => setTimeout(r, 20));
ok(s.notes[0].readBy.length > 0, `walked past the note: ${s.notes[0].readBy.join(", ")}`);

// fights between the women over a few days
let fights = 0;
for (let d = 0; d < 6 && !s.over; d++) {
  for (let i = 0; i < 400 && s.phase === "day"; i++) { g.update(0.25); while (g.busy()) await new Promise((r) => setTimeout(r, 1)); }
  fights = log.filter((l) => l.startsWith("FIGHT")).length;
  if (s.phase === "vote") { g.startBallots(); await g.resolveVote(g.voteSetup().candidates.find((c) => c !== "player")); if (!s.over) g.afterVote(); await new Promise((r) => setTimeout(r, 50)); }
  if (!s.over) g.nextDay();
}
console.log("    cat fights between the women over the season:", fights, log.filter((l) => l.startsWith("FIGHT")).slice(0, 3).join(" | "));
