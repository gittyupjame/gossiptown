// Runs every one of Primrose's show formats through the core with the offline stand-in.
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");
const E = await import("../src/core/events.js");
const log = [];
const ui = { headline: (t, k) => log.push(`HEADLINE[${k}] ${t}`), distance: () => 30, hearing: () => "none", fight: (a, b, o) => log.push(`FIGHT ${a} vs ${b} -> ${o?.winner}`), first: () => {}, showPlanned: (s, ev) => log.push(`PLANNED ${ev.format}`) };
const g = createGame(ui, { daySeconds: 60 });
g.newSeason("Rosie");
const s = g.state();
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };
await new Promise((r) => setTimeout(r, 50));
ok(E.showOf(s) && E.FORMATS[s.event.format], `day 1 show planned: ${s.event?.format} at ${sim.clock(s.event?.minute || 0)}`);

// some history so every format has material
for (let i = 0; i < 6; i++) { s.minute = 9 * 60 + i * 30; await sim.tick(s, ui); }

const SAYS = {
  toast: "To Wren, the sweetest woman in this town. Cheers!",
  clear_air: "Sylvie, you're a two-faced snake and everyone knows it.",
  hot_seat: "That is a lie. I never did that.",
  send_home: "Honestly? Celeste should go home tonight.",
  hot_cold: "You have gorgeous hair, but your outfit looks like a curtain. Bless her.",
  tea: "Did you know Odette secretly owes money to half the market?",
  soapbox: "Please keep me, I deserve a chance to stay!",
  confessions: "I'm sorry, Brenna. I was wrong about you.",
  roast: "Pippa's like a sunny day: rare, and we're relieved when it's over. Haha.",
};

for (const key of Object.keys(E.FORMATS)) {
  const f = E.FORMATS[key];
  s.event = { day: s.day, format: key, minute: s.minute, place: f.place, bell: true, done: false };
  const lu = await E.lineup(s);
  if (f.kind === "hotseat") {
    ok(lu.seat, `${f.title}: ${sim.nameOf(s, lu.seat)} in the hot seat over: ${lu.rumor ? s.rumors[lu.rumor].text : "(nothing specific)"}`);
    E.readOut(s, lu.rumor, ui);
    const ans = lu.seat === "player" ? await E.playerAct(s, SAYS[key], { seatRumor: lu.rumor }) : await E.seatAnswer(s, lu.seat, lu.rumor);
    const res = await E.crowdReacts(s, ans, ui, { line: SAYS[key] });
    ok(Object.keys(res.reactions).length >= 5, `  answer "${E.actText(s, ans)}" -> ${JSON.stringify(res.tally)}`);
    const pipes = await E.pipeUp(s, lu.seat);
    for (const p of pipes) { const r = await E.crowdReacts(s, p, ui); console.log(`    ${sim.firstOf(s, p.by)} ${p.pipe}s -> ${JSON.stringify(r.tally)}`); }
    continue;
  }
  ok(lu.order.includes("player") && lu.order.length === f.speakers + 1, `${f.title}: lineup ${lu.order.map((id) => sim.firstOf(s, id)).join(", ")}${f.assigned ? ` assigned ${JSON.stringify(Object.fromEntries(Object.entries(lu.assigned).map(([a, b]) => [sim.firstOf(s, a), sim.firstOf(s, b)])))}` : ""}`);
  for (const id of lu.order) {
    const act = id === "player" ? await E.playerAct(s, SAYS[key], { assigned: lu.assigned[id] }) : await E.npcAct(s, id, { assigned: lu.assigned[id] });
    if (f.assigned && act.subject && lu.assigned[id]) ok(act.subject === lu.assigned[id] || act.kind === "dodge" || act.kind === "plead", `  assigned target respected (${act.kind})`);
    const res = await E.crowdReacts(s, act, ui, { line: id === "player" ? SAYS[key] : "" });
    console.log(`    ${sim.firstOf(s, id)} ${E.actText(s, act)} -> ${JSON.stringify(res.tally)}${res.snap ? ` SNAP ${res.snap}` : ""}`);
    if (f.rebuttal && act.subject && act.subject !== "player" && ["call_out", "roast", "backhanded"].includes(act.kind)) {
      const rb = await E.rebuttal(s, act.subject, act);
      const r2 = await E.crowdReacts(s, rb, ui);
      console.log(`      ${sim.firstOf(s, act.subject)} answers: ${rb.answer} -> ${JSON.stringify(r2.tally)}`);
    }
  }
}

// your words travel and are remembered
const told = s.player.told.filter((t) => t.to === "crowd");
ok(told.length >= 1, `your public claims became rumors (${told.length})`);
ok(sim.alive(s).some((v) => v.memory.some((m) => /at (The Toast|Clear the Air|The Roast|Morning Tea)/.test(m))), "the women remember what happened at the shows");
ok(typeof s.player.showScore === "number", `crowd score so far: ${s.player.showScore?.toFixed(1)}`);

// the clock: the show starts at its minute, and finishing moves everyone on
s.phase = "day"; s.event = { day: s.day, format: "toast", minute: 12 * 60, place: "tavern", bell: false, done: false }; s.minute = 11 * 60 + 50;
let started = false; ui.showStart = () => { started = true; }; ui.showBell = () => log.push("BELL");
g.update(60);
ok(log.includes("BELL"), "the show bell rang half an hour before");
for (let i = 0; i < 20 && !started; i++) g.update(1);
ok(started && s.phase === "show", "the show started on time");
g.endShow();
ok(s.phase === "day" && s.event.done && s.minute >= 12 * 60 + 45 && sim.alive(s).every((v) => v.location === "tavern"), "after the show everyone is at the tavern and the day goes on");
const fresh = await E.planDay({ ...s, shows: [{ format: "toast" }, { format: "roast" }, { format: "tea" }] });
ok(!["toast", "roast", "tea"].includes(fresh.format), `no repeats of the last three shows (${fresh.format})`);
console.log(log.filter((l) => /HEADLINE|FIGHT/.test(l)).slice(-8).join("\n"));
