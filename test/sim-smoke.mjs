// Plays a few days of the sim with the offline stand-in and phrasebook, no page.
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");
const events = [];
const ui = {
  headline: (t) => events.push("HEADLINE " + t),
  hearing: () => (Math.random() < 0.05 ? "full" : "none"), // the player only overhears now and then
  distance: () => 10,
  exchange: ({ a, b, lines }) => events.push(`EXCHANGE ${a}/${b}: ` + lines.map((l) => `${l.id}: ${l.text}`).join(" | ")),
  approach: (v, line, p) => events.push(`APPROACH ${v.id} (${p}): ${line}`),
  first: (k) => events.push("FIRST " + k),
};
let phase = null;
ui.voteNight = () => (phase = "vote");
// Primrose's show, played without a page: every woman takes her turn, you pass
const E = await import("../src/core/events.js");
ui.showStart = async (s) => {
  const lu = await E.lineup(s);
  const acts = lu.seat ? (lu.seat === "player" ? [] : [await E.seatAnswer(s, lu.seat, lu.rumor)]) : await Promise.all(lu.order.filter((id) => id !== "player").map((id) => E.npcAct(s, id, { assigned: lu.assigned[id] })));
  for (const a of acts) { const r = await E.crowdReacts(s, a, ui); events.push(`SHOW ${E.FORMATS[s.event.format].title}: ${sim.firstOf(s, a.by)} ${E.actText(s, a)} -> ${JSON.stringify(r.tally)}`); }
  g.endShow();
};
ui.nightDone = (s, lines) => { phase = "nightdone"; events.push("NIGHT " + lines.join("; ")); };
const g = createGame(ui, { daySeconds: 60 });
g.newSeason("Rosie");
const s = g.state();
for (let day = 0; day < 9 && !s.over; day++) {
  phase = null;
  while (!phase) { g.update(0.25); await new Promise((r) => setTimeout(r, 1)); while (g.busy()) await new Promise((r) => setTimeout(r, 1)); }
  if (phase === "vote") {
    g.startBallots();
    const cands = g.voteSetup().candidates.filter((c) => c !== "player");
    const res = await g.resolveVote(cands[0]);
    events.push(`VOTE day ${s.day}: ${JSON.stringify(res.ballots)} -> out ${res.out} winner ${res.winner} rounds ${res.rounds.length}`);
    if (s.over) break;
    phase = null; g.afterVote();
    while (phase !== "nightdone") await new Promise((r) => setTimeout(r, 5));
  }
  g.nextDay();
}
const it = await import("../src/core/jev.js");
console.log(events.filter((e) => !e.startsWith("FIRST")).slice(0, 40).join("\n"));
console.log("...", events.length, "events; jev calls", it.stats.calls, "alliances", s.alliances.map((a) => a.name + ":" + a.members.join(",")).join(" "), "rumors", Object.keys(s.rumors).length, "heard", s.player.heard.length, "over", JSON.stringify(s.over), "alive", sim.alive(s).length);
console.log(events.filter((e) => e.startsWith("VOTE")).join("\n"));
