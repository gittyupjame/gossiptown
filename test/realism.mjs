// Measures how believable the town's state and decisions are over a few days with the
// offline stand-in (no page). Prints numbers to compare before and after a change.
//   node test/realism.mjs [days]
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const DAYS = +(process.argv[2] || 3);
const jev = await import("../src/core/jev.js");
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");

// watch every decision the sim asks for
const calls = [];
const realAsk = jev.ask;
jev.__setAskHook?.((state, qs, label, out) => calls.push({ label, qs, out, state }));

const ui = { headline: () => {}, hearing: () => "none", distance: () => 30, exchange: () => {}, approach: () => {}, first: () => {} };
let phase = null;
ui.voteNight = () => (phase = "vote");
ui.showStart = async () => { g.endShow(); };
ui.nightDone = () => { phase = "nightdone"; };
const g = createGame(ui, { daySeconds: 60 });
g.newSeason("Rosie");
const s = g.state();
const startRel = structuredClone(s.rel);
for (let day = 0; day < DAYS && !s.over; day++) {
  phase = null;
  while (!phase) { g.update(0.25); await new Promise((r) => setTimeout(r, 1)); while (g.busy()) await new Promise((r) => setTimeout(r, 1)); }
  if (phase === "vote") {
    g.startBallots();
    const cands = g.voteSetup().candidates.filter((c) => c !== "player");
    await g.resolveVote(cands[0]);
    if (s.over) break;
    phase = null; g.afterVote();
    while (phase !== "nightdone") await new Promise((r) => setTimeout(r, 5));
  }
  g.nextDay();
}

const pct = (a, b) => `${b ? Math.round((100 * a) / b) : 0}%`;
const alive = sim.alive(s);
// 1. relationships pinned at the extremes
let pairs = 0, pinned = 0, moved = 0;
for (const a of alive) for (const b of alive) if (a !== b) { pairs++; const x = s.rel[a.id][b.id].affinity; if (Math.abs(x) >= 2.9) pinned++; if (Math.abs(x - startRel[a.id][b.id].affinity) >= 0.5) moved++; }
console.log(`relationships pinned at the extremes   ${pct(pinned, pairs)}  (changed by 0.5+: ${pct(moved, pairs)})`);
// 2. does she still know WHY she feels the way she does about her worst enemy?
let why = 0, enemies = 0;
for (const v of alive) {
  const worst = alive.filter((o) => o !== v).sort((p, q) => s.rel[v.id][p.id].affinity - s.rel[v.id][q.id].affinity)[0];
  if (!worst || s.rel[v.id][worst.id].affinity > -0.8) continue;
  enemies++;
  // the reason has to survive the day: in how she sums the woman up, or in what she never forgets
  const f = sim.feelings(s, v, worst), lasting = JSON.stringify(sim.persona(s, v).never_forgets || []);
  if (/day \d/.test(f) || lasting.includes(sim.first(worst))) why++;
}
console.log(`women who still know why they dislike someone ${pct(why, enemies)}  (${enemies} with an enemy)`);
// 3. decisions that contradict each other inside one conversation
let talks = 0, clash = 0;
const meet = new Map();
for (const c of calls) {
  if (c.label.startsWith("meet:")) meet.set(c.label + "#" + calls.indexOf(c), c);
}
for (const c of calls.filter((c) => c.label.startsWith("meet:") && c.out.topic)) {
  const follow = c.out.warmth ? c : calls.find((d, i) => i > calls.indexOf(c) && d.label === c.label.replace("meet:", "meet2:"));
  if (!follow?.out?.warmth || (c.out.talk && !c.out.talk.yes)) continue;
  talks++;
  const t = c.out.topic.pick, w = follow.out.warmth.value;
  if ((t === "argue" && w >= 1.8) || (t === "make_up" && w < 2.2) || (t === "alliance" && follow.out.agree?.yes && w < 2.2)) clash++;
}
console.log(`conversations whose outcome contradicts what happened ${pct(clash, talks)}  (${talks} talks)`);
// 4. plans
const withPlans = alive.filter((v) => v.intent).length;
console.log(`women with a plan at the end            ${withPlans}/${alive.length}; queued: ${alive.reduce((t, v) => t + (v.plans?.length || 0), 0)}`);
console.log(`women with a vote plan                  ${alive.filter((v) => v.votePlan).length}/${alive.length}`);
// 5. votes: do they form blocs, and does each vote have a reason the voter knows?
let share = 0, rounds = 0, reasoned = 0, ballots = 0;
for (const rec of s.votes) {
  const n = Object.keys(rec.ballots).length, tally = {};
  for (const t of Object.values(rec.ballots)) tally[t] = (tally[t] || 0) + 1;
  share += Math.max(...Object.values(tally)) / n; rounds++;
}
for (const c of calls.filter((c) => c.label.startsWith("vote:"))) {
  ballots++;
  const desc = c.qs.vote.criteria[c.out.vote.pick] || "";
  if (/(hates|dislikes|is cool toward|distrusts|doubts|why:|wants her out|voted against|heard)/.test(desc) || /vote out/.test(JSON.stringify(c.state.vote_plan || ""))) reasoned++;
}
console.log(`biggest bloc's share of each vote        ${pct(share, rounds)}`);
console.log(`ballots cast for a reason she can name   ${pct(reasoned, ballots)}`);
// 6. what a vote decision is based on
const votes = calls.filter((c) => c.label.startsWith("vote:"));
console.log(`decisions made: ${calls.length}; votes cast: ${votes.length}; days played: ${s.day}`);
console.log(`memory lines kept for Celeste: ${s.people.celeste?.memory.length}, lasting: ${s.people.celeste?.core?.length ?? 0}`);
