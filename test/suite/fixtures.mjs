// Shared fixtures: one long seeded season, a few shorter ones on other seeds, and fresh towns
// for scenarios.
import * as H from "./harness.mjs";
export * from "./harness.mjs";

export const CANARY = "CANARY-7Q3 the moon is made of marzipan";
const memo = {};
export async function main() {
  if (memo.main) return memo.main;
  const t0 = Date.now();
  const before = H.payloads.length;
  const writer = H.makeWriter();
  let canaryPlaced = false;
  memo.main = await H.season({ seed: 1, days: 6, writer, onDay: null, stopAt: (s) => { if (!canaryPlaced) { canaryPlaced = true; H.R.emit(s, { type: "history", content: { text: CANARY }, perceivers: [], cause: "rule:test" }); } return false; } });
  memo.main.payloads = H.payloads.slice(before);
  memo.main.ms = Date.now() - t0;
  return memo.main;
}
export async function seeds(n = 4, days = 3) {
  const k = `seeds${n}x${days}`;
  if (memo[k]) return memo[k];
  const out = [];
  for (let i = 0; i < n; i++) out.push(await H.season({ seed: 100 + i, days }));
  return (memo[k] = out);
}

// A fresh town on day 1 at 8:00, everyone at the welcome party in the plaza; the clock only
// moves if the test moves it.
export async function town(seed = 5, { name = "Rosie" } = {}) {
  const log = [];
  const ui = H.makeUi(log);
  const writer = H.makeWriter();
  H.voice.__setWriter(writer.fn);
  H.runtime.budget.used = {};
  await H.quiesce();
  const g = H.G.createGame(ui, { daySeconds: 60, store: null });
  g.newSeason(name, null, { seed });
  const s = g.state();
  writer.s = s;
  await H.settle(g);
  s.player.pos = { x: 40, z: 40 }; s.player.location = "lane"; // out of earshot unless a test moves her
  return { g, s, ui, log, writer };
}
// put someone somewhere (instantly)
export function put(ctx, id, loc, at = null) {
  const { s } = ctx;
  if (id === "player") { s.player.location = loc; s.player.pos = at || H.space.centre([]) || { x: 0, z: 0 }; return; }
  H.A.place(s, s.people[id], loc, "rule:test", { at });
}
export const at = (ctx, id) => H.space.pos(ctx.s, id);

// A woman says a line to another, the way a talk commits it: checked moves, the event, her
// sincerity on any promise, everyone's reaction round, answers to requests.
export async function speak(ctx, P, O, parts, { plan = null, delivery = null, discreet = false, replies = false } = {}) {
  const { s, ui } = ctx;
  let t = H.T.talkOf(s, P);
  if (t && !(t.a === O || t.b === O)) { H.T.end(s, t, "test", "rule:test", ui); t = null; }
  if (!t) { const o = H.T.talkOf(s, O); if (o) H.T.end(s, o, "test", "rule:test", ui); t = H.T.open(s, P, O, { reason: "a test", cause: "rule:test", ui }); }
  const line = parts.map((p) => p.text).join(" ");
  const raw = parts.flatMap((p) => (p.moves || []).map((m) => ({ span: p.text, ...m })));
  const res = H.moves.check(s, raw, { line, speaker: P, listeners: [O] });
  const L = H.T.commitLine(s, t, P, O, { line, moves: res.moves, tone: res.tone }, plan || { decision: P === "player" ? "player:say" : "rule:test", discreet, delivery }, ui);
  if (P !== "player") await H.T.sincerity(s, P, O, { ...L, moves: L.moves });
  const r = await H.react.round(s, { ev: L.ev, moves: L.moves, speaker: P, addressed: [O], talk: t.id, tone: L.tone, delivery: delivery ?? plan?.delivery });
  H.T.commitAnswers(s, t, L, O);
  return { L, r, t, rejects: res.rejects };
}
// the newcomer types a line to a woman: the real path (extract -> check -> commit -> judge)
export async function playerSay(ctx, O, text, moves) {
  const { s, g, writer } = ctx;
  writer.player.set(text, moves);
  if (!H.T.talkOf(s, "player")) g.startTalk(O);
  const t = H.T.talkOf(s, "player");
  if (t && t.stage !== "await_player") { t.stage = "await_player"; }
  const res = await g.say(text);
  await H.settle(g);
  return res;
}
export const first = (ctx, id) => ctx.s.people[id]?.name.split(" ")[0];
export const conf = (ctx, who, rid) => H.B.conf(ctx.s, who, rid);
export const rel = (ctx, a, b) => ctx.s.rel[a][b];
// average over seeds of a number a scenario returns
export async function over(seedsList, fn) {
  const xs = [];
  for (const sd of seedsList) xs.push(await fn(sd));
  return xs;
}
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export let dbg = null; export const setDbg = (f) => (dbg = f);
export const ok = (pass, detail) => ({ pass: !!pass, detail: String(detail ?? "") });

// she saw something with her own eyes (a history event only she perceived): a belief to work with
export function knowAs(ctx, who, about, text, { conf: c = 0.95, harm = -1, kind = "gossip", isTrue = true, prop = null } = {}) {
  const { s } = ctx;
  const rid = H.B.newClaim(s, { about, text, origin: "truth", isTrue, harm, kind, prop });
  const ev = H.R.emit(s, { type: "history", content: { text: `I saw it myself: ${text}` }, perceivers: (Array.isArray(who) ? who : [who]).map((id) => ({ id, how: "did" })), cause: "rule:test" });
  for (const w of Array.isArray(who) ? who : [who]) H.B.learn(s, w, rid, { conf: c, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
  return rid;
}

// let the town run for some minutes (ticks, talks, decisions); a show that comes due is skipped
export async function run(ctx, minutes) {
  const { g, s } = ctx;
  const end = Math.min(20 * 60 - 1, s.minute + minutes);
  while (s.minute < end && s.phase !== "vote") {
    if (s.phase === "show") { g.endShow(); }
    g.update(0.5);
    await H.settle(g);
  }
}
