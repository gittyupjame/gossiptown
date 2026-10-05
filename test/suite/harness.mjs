// Headless seasons for the requirement suite: the real game loop, the offline Jev stand-in,
// and the test writer in place of Claude. No page.
globalThis.localStorage ??= { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } };
globalThis.window ??= {};

export const G = await import("../../src/core/game.js");
export const sim = await import("../../src/core/sim.js");
export const E = await import("../../src/core/events.js");
export const R = await import("../../src/core/record.js");
export const M = await import("../../src/core/mind.js");
export const B = await import("../../src/core/beliefs.js");
export const T = await import("../../src/core/talk.js");
export const A = await import("../../src/core/agents.js");
export const V = await import("../../src/core/views.js");
export const voice = await import("../../src/core/voice.js");
export const jev = await import("../../src/core/jev.js");
export const runtime = await import("../../src/core/runtime.js");
export const react = await import("../../src/core/react.js");
export const moves = await import("../../src/core/moves.js");
export const space = await import("../../src/core/space.js");
export const looks = await import("../../src/core/looks.js");
export const cast = await import("../../src/core/cast.js");
export const I = await import("../../src/core/inspect.js");
import { makeWriter } from "./writer.mjs";

export const tick = () => new Promise((r) => setImmediate(r));
// let whatever an earlier town still had in flight finish before a new one starts, so no
// test inherits another's background work (the dice and ids would shift)
export async function quiesce() {
  // idle for a stretch, not just a moment: a chain of calls can pause between links
  for (let i = 0, quiet = 0; i < 40000 && quiet < 60; i++) { await tick(); quiet = T.stepping() || runtime.inFlight() ? 0 : quiet + 1; }
}
export async function settle(g) { for (let i = 0; i < 20000 && (g.busy() || T.stepping()); i++) await tick(); await tick(); }

// What the game hands Jev, as it hands it: kept per decision for the leak audits.
export const payloads = [];
R.on("decide", (entry, payload, questions) => { payloads.push({ id: entry.id, actor: entry.actor, label: entry.label, payload: JSON.stringify(payload), q: Object.keys(questions) }); if (payloads.length > 30000) payloads.shift(); });

export function makeUi(log) {
  return {
    toPlayer: (x) => log.push({ k: "toPlayer", ...x }),
    exchange: (x) => log.push({ k: "exchange", ...x }),
    emote: (id, kind) => log.push({ k: "emote", id, kind }),
    fight: (a, b, o) => log.push({ k: "fight", a, b, ...o }),
    first: () => {},
    moved: () => {}, arrived: () => {}, pair: () => {},
    lookJudged: (v, rec) => log.push({ k: "look", id: v.id, rec }),
  };
}

// A whole season (or some days of one). The player wanders to where women are, chats now and
// then with lines the test writer can read, plays her turn at the show and votes.
export async function season({ seed = 1, days = 3, name = "Rosie", player = defaultPlayer, writer = makeWriter(), onDay = null, stopAt = null, spectate = true } = {}) {
  const log = [];
  const ui = makeUi(log);
  voice.__setWriter(writer.fn);
  runtime.budget.used = {}; runtime.budget.bound = {};
  let phase = null;
  await quiesce();
  const g = G.createGame(ui, { daySeconds: 60, store: null });
  ui.voteNight = () => (phase = "vote");
  ui.nightDone = () => (phase = "nightdone");
  ui.showStart = () => (phase = "show");
  g.newSeason(name, null, { seed });
  const s = g.state();
  writer.s = s;
  await settle(g);
  await g.firstLooks({ where: "the welcome party" });
  const ctx = { g, s, log, writer, ui, snaps: new Map() };
  const snap = () => { for (const e of s.world) if (!ctx.snaps.has(e.id)) ctx.snaps.set(e.id, JSON.stringify(e)); };
  for (let d = 0; d < days && !s.over; d++) {
    phase = null;
    let lastMove = -1;
    while (!phase) {
      g.update(0.5);
      await settle(g);
      snap();
      if (s.phase === "day" && Math.floor(s.minute / 30) !== lastMove) { lastMove = Math.floor(s.minute / 30); await player.walk?.(ctx); }
      if (stopAt && stopAt(s)) return ctx;
      if (s.phase === "show" && phase !== "show") phase = "show";
    }
    if (phase === "show") {
      await playShow(ctx, player);
      phase = null;
      while (!phase) { g.update(0.5); await settle(g); if (s.phase === "day" && Math.floor(s.minute / 30) !== lastMove) { lastMove = Math.floor(s.minute / 30); await player.walk?.(ctx); } }
    }
    if (phase === "show") { await playShow(ctx, player); phase = null; while (!phase) { g.update(0.5); await settle(g); } }
    if (phase === "vote") {
      g.startBallots();
      await g.ballotLines();
      const cands = g.voteSetup().candidates.filter((c) => c !== "player");
      const res = await g.resolveVote(player.vote ? player.vote(ctx, cands) : cands[0]);
      ctx.lastVote = res;
      if (res.out && res.out !== "player") await g.partingShot(res.out);
      // the newcomer voted out: the season carries on without her, for the audits
      if (s.over && spectate && s.over.reason === "voted out") { ctx.playerOutDay = s.day; s.over = null; s.phase = "vote"; }
      if (s.over) break;
      phase = null;
      g.afterVote();
      while (phase !== "nightdone") { await tick(); }
    } else await settle(g);
    snap();
    await onDay?.(ctx);
    g.nextDay();
    await settle(g);
  }
  return ctx;
}

export async function playShow(ctx, player) {
  const { s, g } = ctx;
  const lu = await E.lineup(s);
  const f = E.FORMATS[s.event.format];
  const sayP = async (text, opts) => { const a = await E.playerAct(s, text, opts); await E.crowdReacts(s, a); };
  if (f.kind === "hotseat") {
    E.readOut(s, lu.rumor);
    if (lu.seat === "player") await sayP(player.show?.(ctx, "seat") || "", { seatRumor: lu.rumor });
    else { const a = await E.seatAnswer(s, lu.seat, lu.rumor); const d = await E.draft(s, a); if (d) { await E.deliver(s, a, d); await E.crowdReacts(s, a); } }
    for (const p of await E.pipeUp(s, lu.seat)) { const d = await E.draft(s, p); if (d) { await E.deliver(s, p, d); await E.crowdReacts(s, p); } }
  } else {
    const npcs = lu.order.filter((id) => id !== "player");
    const acts = Object.fromEntries(await Promise.all(npcs.map(async (id) => [id, await E.npcAct(s, id, { assigned: lu.assigned[id] })])));
    for (const id of lu.order) {
      if (id === "player") { await sayP(player.show?.(ctx, "turn", lu.assigned.player) || "", { assigned: lu.assigned.player }); continue; }
      if (s.people[id]?.gone) continue;
      const d = await E.draft(s, acts[id]);
      if (!d) continue;
      await E.deliver(s, acts[id], d);
      const res = await E.crowdReacts(s, acts[id]);
      if (res.snap && res.snapAt !== "player" && res.snap !== "player") await sim.brawl(s, res.snap, res.snapAt || id, res.snapCause || acts[id].ev, ctx.ui);
    }
  }
  g.endShow();
  await settle(g);
}

// The default newcomer: follows the crowd, now and then talks to someone.
export const defaultPlayer = {
  async walk(ctx) {
    const { s, g } = ctx;
    if (s.player.out) return;
    const vs = A.alive(s).filter((v) => v.location !== "home" && v.location !== "lane");
    if (!vs.length) return;
    const v = vs[Math.floor(s.rng ? (s.minute * 7919 + s.day * 104729) % vs.length : 0)];
    const p = space.pos(s, v.id);
    if (!T.talkOf(s, "player")) { s.player.pos = { x: p.x + 1.2, z: p.z + 0.4 }; s.player.location = v.location; }
    if (s.minute % 120 < 30 && !T.talkOf(s, "player") && !T.busy(s, v.id)) {
      const t = g.startTalk(v.id);
      if (t) { await g.say("Hi! What's the gossip today?"); await settle(g); g.endTalk(); await settle(g); }
    }
  },
};
export { makeWriter };
