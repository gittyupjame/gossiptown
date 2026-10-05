// Conversations, turn by turn. Either side can open one, always for a reason in her state.
// Before each line Jev picks what the speaker is doing with it (from her view: confide,
// probe, lie about her vote, recruit, call someone out…); Claude writes the words from her
// view and that intent; code checks the moves, commits the line and its moves, and every
// woman who heard it judges it in a reaction round (react.js), which also picks how the
// next speaker answers. A talk takes in-game time, can be interrupted (someone walks up,
// the show, the 7pm vote), and always ends for a stored reason.
//
// Talks are plain data in s.talks, advanced a step at a time, so a save in the middle of
// one picks up where it left off.

import * as R from "./record.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import * as voice from "./voice.js";
import * as runtime from "./runtime.js";
import { view, placeName, inSight } from "./views.js";
import { check, register, grounded, SUBSTANTIVE } from "./moves.js";
import { round, settleClaim, mindClaim, deliveryText } from "./react.js";
import { spotIn, pos, dist, centre, FULL } from "./space.js";
import { ITEMS, SHOW } from "./cast.js";

const nm = M.nm;
export const MAX_LINES = 16;       // technical viability cap for talks between women; logged when it binds
export const MAX_PLAYER_LINES = 40; // the same for a talk with the newcomer
export const MIN_PER_LINE = 2;     // in-game minutes a line takes to say
export const stats = { lines: 0, small: 0, regenerated: 0, ungroundedFinal: 0, reextracted: 0, rejected: 0, capped: 0, cancelled: 0, failed: 0, talks: 0, offscreenLines: 0, onscreenLines: 0, offscreenMoves: 0, onscreenMoves: 0, budgetSkipped: 0 };

const isWoman = (s, id) => !!s.people[id] && !s.people[id].gone;
const present = (s, id) => (id === "player" ? !s.player.out : isWoman(s, id));
export const busy = (s, id) => !!Object.values(s.talks || {}).find((t) => t.status === "active" && (t.a === id || t.b === id));
export const talkOf = (s, id) => Object.values(s.talks || {}).find((t) => t.status === "active" && (t.a === id || t.b === id)) || null;
const other = (t, id) => (t.a === id ? t.b : t.a);

// ---------- opening ----------
export function open(s, a, b, { reason, cause, agenda = null, ui }) {
  if (!present(s, a) || !present(s, b) || busy(s, a) || busy(s, b)) return null;
  if (a !== "player" && b !== "player" && !runtime.canSpend(s, 3)) { stats.budgetSkipped++; return null; }
  const id = R.nextId(s, "t");
  // she walks over: they stand close enough to talk
  if (b !== "player") {
    const vb = s.people[b];
    const near = pos(s, a);
    if (a !== "player" || dist(s, a, b) > 2.2) { vb.spot = spotIn(s, s.people[b].location, { near }); vb.location = a === "player" ? s.player.location : s.people[a].location; }
  }
  if (a !== "player" && b === "player") { const va = s.people[a]; va.spot = spotIn(s, s.player.location, { near: pos(s, "player") }); va.location = s.player.location; }
  ui?.pair?.(s.people[a] || { id: a }, s.people[b] || { id: b });
  const ev = R.emit(s, { type: "talk_open", actor: a, targets: [b], content: { reason }, cause, talk: id });
  const t = { id, a, b, place: a === "player" ? s.player.location : s.people[a].location, opened: ev.id, cause, reason, agenda, turns: [], next: a, stage: a === "player" ? "await_player" : "intent", nextAt: R.now(s), status: "active", around: aroundNow(s, a, b), startedAt: R.now(s) };
  (s.talks ??= {})[id] = t;
  stats.talks++;
  return t;
}

// who is within earshot, to notice when someone walks up
function aroundNow(s, a, b) {
  const at = centre([pos(s, a), pos(s, b)]);
  return R.whoPerceives(s, { at, place: null }).filter((p) => p.how !== "saw" && p.id !== a && p.id !== b).map((p) => p.id);
}

export function end(s, t, reason, cause, ui) {
  if (!t || t.status !== "active") return;
  t.status = "ended";
  // a line already said is judged by everyone who heard it, even if the talk stops here
  if (t.lastLine && (t.stage === "sincere" || t.stage === "react")) (s.unjudged ??= []).push({ talk: t.id, stage: t.stage, line: t.lastLine, P: R.evById(s, t.lastLine.ev)?.actor, O: R.evById(s, t.lastLine.ev)?.targets?.[0] });
  const ev = R.emit(s, { type: "talk_end", actor: t.a, targets: [t.b], content: { reason }, cause: cause || t.opened, talk: t.id });
  t.end = { reason, ev: ev.id, cause };
  for (const id of [t.a, t.b]) { const v = s.people[id]; if (v) { delete v.leaving; v.until = R.now(s) + 5; } }
  // whatever either of them meant to raise with the other and did, is done
  const finished = new Set();
  for (const x of t.turns.filter((x) => x.carried)) {
    const v = s.people[x.by];
    const id = x.item ?? (x.by === t.a ? t.agenda : null);
    const it = id && v?.agenda?.find((y) => y.id === id);
    if (it && !finished.has(it)) { finished.add(it); finishAgenda(s, v, it, ev.id); }
  }
  ui?.talkEnded?.(t);
  // keep the save small: finished talks keep their bones
  const done = Object.values(s.talks).filter((x) => x.status === "ended");
  if (done.length > 40) for (const x of done.slice(0, done.length - 40)) delete s.talks[x.id];
}

function finishAgenda(s, v, it, cause) {
  M.doneAgenda(s, v, it, "done", cause);
  const c = it.commit && M.byId(s, it.commit);
  if (c && c.status === "open" && !["vote", "told_vote", "pact", "keep_quiet"].includes(c.kind)) M.settle(s, c, "kept", "she did it", cause);
}

// ---------- what she's doing with her line ----------
// Options from her own state. `meta` says what each one means for the words.
export function intentOptions(s, P, O, t, { replying = false, visible = [] } = {}) {
  const v = s.people[P];
  const crit = {}, prior = {}, meta = {};
  const add = (k, text, p, m) => { if (!(p > 0)) return; crit[k] = text; prior[k] = p; meta[k] = m; };
  const rPO = s.rel[P][O] || M.newRel(0, 0);
  const on = nm(s, O);
  const voteDay = s.minute >= 12 * 60 ? 1.6 : 1;
  const lines = t ? t.turns.length : 0;
  // what she came to do comes first: carried out by default
  const carried = t && t.turns.some((x) => x.by === P && x.carried);
  const it = t && t.agenda && t.a === P && !carried ? v.agenda?.find((x) => x.id === t.agenda) : null;
  if (it) add("agenda", `Do what she came to do: ${M.agendaText(s, it)}`, 9, { kind: "agenda", item: it.id });
  // she meant to raise something with this very woman, and here they are talking
  const meant = !it && t && !carried ? v.agenda?.find((x) => x.target === O && x.kind !== "keep_away" && x.kind !== "gift" && x.kind !== "post_note") : null;
  if (meant) add("agenda", `Bring up what she meant to: ${M.agendaText(s, meant)}`, meant.commit ? 8 : 5, { kind: "agenda", item: meant.id });
  add("small_talk", "Chat and trade a little shade about nothing much", (replying ? 0.6 : 1) * (0.5 + v.bias.social * 0.6 + v.mood.cheer * 0.2) / (1 + lines * 0.4), { kind: "small_talk" });
  // gossip she could pass on
  const kept = new Set((s.ledger || []).filter((c) => c.by === P && c.status === "open" && c.kind === "keep_quiet").flatMap((c) => c.rids || []));
  const juicy = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.4 && s.rumors[rid].about !== P && s.rumors[rid].about !== O && s.rumors[rid].kind !== "liar" && present(s, s.rumors[rid].about))
    .map(([rid, k]) => { const r = s.rumors[rid]; const age = s.day - (r.day || s.day) + (s.minute - toMin(r.time)) / 1440; return [rid, (Math.abs(r.harm || 0) + (r.kind === "secret" ? 1.2 : 0) + (r.prop?.pred === "votes_for" ? 0.6 : 0)) * k.conf / (1 + Math.max(0, age) * 0.8)]; })
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [rid, j] of juicy) {
    const r = s.rumors[rid];
    const loyal = s.rel[P][r.about]?.affinity >= 1.2 ? v.bias.loyalty * 1.2 : 0;
    add(`spread_${rid}`, `Tell her: ${r.text}`, Math.max(0.02, v.bias.gossip * (0.3 + j) * (1 + Math.max(0, rPO.trust) * 0.2) - loyalty(loyal) - (kept.has(rid) || kept.has(B.rootOf(s, rid)) ? 1.2 * v.bias.loyalty : 0)), { kind: "spread", rumor: rid, embellish: v.bias.deceit * 0.5 + v.bias.gossip * 0.2 });
  }
  // something going round about her
  const aboutO = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.35 && s.rumors[rid].about === O && s.rumors[rid].kind !== "liar").map(([rid]) => rid).slice(-2);
  for (const rid of aboutO) {
    add(`ask_${rid}`, `Ask her straight out whether this is true: ${s.rumors[rid].text}`, v.bias.nosy * 0.7, { kind: "ask", rumor: rid });
    if ((s.rumors[rid].harm || 0) < -0.4 && rPO.affinity < 0) add(`confront_${rid}`, `Have it out with her about: ${s.rumors[rid].text}`, v.bias.temper * (0.4 + Math.max(0, -rPO.affinity) * 0.5) * (1 + v.mood.anger * 0.3), { kind: "confront", rumor: rid });
    if ((s.rumors[rid].harm || 0) < -0.4 && rPO.affinity >= 1) add(`warn_${rid}`, `Warn her what people are saying: ${s.rumors[rid].text}`, 0.8 + v.bias.loyalty, { kind: "warn", rumor: rid });
  }
  // what she makes of someone else, the newcomer above all: the talk of the town
  const others = candidates(s, P).filter((x) => x !== O && present(s, x));
  const strong = others.map((x) => { const r = s.rel[P][x] || M.newRel(0, 0); return [x, r, Math.abs(r.affinity) + Math.abs(r.trust) * 0.5 + (x === "player" ? (s.day <= 2 ? 0.6 : 0.25) + (s.looks?.[P] ? 0.2 : 0) : 0)]; })
    .filter(([, , w]) => w >= 0.5).sort((a, b) => b[2] - a[2]).slice(0, 2);
  for (const [x, r, w] of strong) {
    const sign = r.affinity + r.trust * 0.5 >= 0 ? 1 : -1;
    const why = (r.why || []).filter((y) => y.sign === sign).slice(-1)[0]?.text;
    add(`dish_${x}`, `Tell her what you really make of ${nm(s, x)}${x === "player" ? " (the newcomer)" : ""}`, (0.15 + v.bias.gossip * 0.5) * Math.min(2.5, w) * (x === "player" ? 1.3 : 1), { kind: "dish", target: x, sign, why });
  }
  // grievances
  const grudge = (rPO.why || []).find((x) => x.sign < 0 && x.w >= 0.8);
  if (grudge && !aboutO.length) add("confront", `Have it out with her about this: ${grudge.text}`, v.bias.temper * (0.3 + Math.max(0, -rPO.affinity) * 0.5) * (1 + v.mood.anger * 0.3), { kind: "confront", topic: grudge.text });
  // the vote
  if (O !== "player" || !s.player.out) {
    add("probe", "Find out who she's voting for and where her loyalties are", (0.3 + v.bias.scheme * 0.7) * voteDay * (O === "player" ? 1.2 : 1), { kind: "probe" });
    if (v.votePlan) {
      add("reveal_vote", `Tell her who you're voting out (${nm(s, v.votePlan.target)}) and try to get her on board`, (0.2 + v.bias.scheme * 0.5 + Math.max(0, rPO.trust) * 0.3) * voteDay * (v.votePlan.target === O ? 0 : 1), { kind: "lobby", target: v.votePlan.target, truthful: true });
      const decoys = candidates(s, P).filter((x) => x !== v.votePlan.target && x !== O && x !== P);
      if (decoys.length) {
        const decoy = decoys.sort((a, b) => (s.rel[P][a]?.affinity ?? 0) - (s.rel[P][b]?.affinity ?? 0))[0];
        add("lie_vote", `Lie about your vote: say you're voting out ${nm(s, decoy)} (you really mean to vote out ${nm(s, v.votePlan.target)})`, v.bias.deceit * v.bias.scheme * 0.9 * voteDay * (rPO.trust < 0.5 ? 1.4 : 0.7), { kind: "lie_vote", target: decoy, truth: v.votePlan.target });
      }
    }
  }
  if (O !== "player" && !s.alliances.some((a) => a.members.includes(P) && a.members.includes(O))) add("recruit", "Propose a secret pact to vote together", v.bias.scheme * Math.max(0.1, rPO.affinity + 0.8) * (isolated(s, P) ? 1.8 : 0.6), { kind: "recruit" });
  if (O === "player" && !s.alliances.some((a) => a.members.includes(P) && a.members.includes("player"))) add("recruit", "Propose a secret pact with the newcomer", v.bias.scheme * Math.max(0.1, rPO.affinity + 0.8) * (isolated(s, P) ? 1.6 : 0.5), { kind: "recruit" });
  // making things up about a rival
  const rival = candidates(s, P).filter((x) => x !== O && x !== P).sort((a, b) => (s.rel[P][a]?.affinity ?? 0) - (s.rel[P][b]?.affinity ?? 0))[0];
  if (rival && (s.rel[P][rival]?.affinity ?? 0) < -0.5) add("plant", `Make up a damaging story about ${nm(s, rival)} and tell it as true`, v.bias.deceit * v.bias.scheme * 0.45 * (1 + Math.max(0, -(s.rel[P][rival]?.affinity ?? 0)) * 0.3), { kind: "plant", target: rival });
  if (rPO.affinity < -0.8) add("insult", `Get a dig in at ${on}`, v.bias.temper * 0.6 * (1 + v.mood.anger * 0.4), { kind: "insult" });
  if (rPO.affinity < -1.2 && v.bias.temper > 0.5) add("threaten", `Threaten ${on}`, v.bias.temper * v.bias.scheme * 0.4, { kind: "threaten" });
  add("flatter", `Butter ${on} up`, 0.15 + v.bias.scheme * 0.4 * (v.votePlan || isolated(s, P) ? 1.3 : 0.6), { kind: "flatter" });
  if ((rPO.debt || 0) <= -0.6) add("call_favor", `Call in the favor ${on} owes you`, 0.5 + v.bias.scheme, { kind: "call_favor" });
  const wronged = (v.mem || []).some((m) => m.ev && m.about?.includes(O) && m.w >= 2.5 && /I said/.test(m.text));
  if (wronged || rPO.affinity < -1) add("apologize", `Apologize to ${on}`, v.bias.loyalty * 0.4 + (wronged ? 0.3 : 0), { kind: "apologize" });
  // answering what was just said
  if (replying) {
    const aboutMe = visible.filter((mv) => mv.rid && s.rumors[mv.rid]?.about === P && (s.rumors[mv.rid].harm || 0) < -0.2);
    for (const mv of aboutMe.slice(0, 1)) {
      const truth = B.secretOf(s, P) && B.rootOf(s, mv.rid) === B.secretOf(s, P).root;
      add("deny", `Deny it flatly${truth ? " (it's actually true: that would be a lie)" : ""}`, truth ? 0.4 + v.bias.deceit * 2 : 4, { kind: "deny", rumor: mv.rid, lie: !!truth });
      if (truth) add("admit", "Own it: admit it's true", 0.3 + (1 - v.bias.deceit) * 1.2, { kind: "admit", rumor: mv.rid });
      add("laugh_off", "Laugh it off", 0.3 + v.bias.nerve * 0.6, { kind: "laugh_off", rumor: mv.rid });
    }
    // she said something different before: the earlier words, to throw back at her
    let quote = null;
    for (const mv of visible.filter((m) => m.rid)) {
      const was = [...(s.moves || [])].reverse().find((m) => m.by === O && m.rid && m.ev !== mv.ev && (m.to || []).includes(P) && B.contradicts(s, m.rid, mv.rid));
      if (was) { quote = `"${was.span}" (${was.day === s.day ? "earlier today" : was.day === s.day - 1 ? "yesterday" : `on day ${was.day}`})`; break; }
    }
    if (B.suspicion(s, P, O) >= 0.35 || quote) add("call_out", quote ? `Call ${on} out: she told you something different, ${quote}` : `Call ${on} out: you think she's lying to you`, 0.3 + B.suspicion(s, P, O) * 2 + v.bias.temper * 0.4 + (quote ? 1 + v.bias.nosy * 0.5 : 0), { kind: "call_out", quote });
    add("end", "Wrap it up and walk away", 0.15 + lines * 0.25 + Math.max(0, -rPO.affinity) * 0.3 + (v.leaving ? 3 : 0), { kind: "end" });
  } else if (lines >= 2) add("end", "Wrap it up and walk away", 0.3 + lines * 0.3, { kind: "end" });
  return { criteria: crit, prior, meta };
}
const loyalty = (x) => x;
const toMin = (hhmm) => { const [h, m] = String(hhmm || "08:00").split(":").map(Number); return h * 60 + (m || 0); };
export const candidates = (s, P) => [...Object.values(s.people).filter((o) => !o.gone).map((o) => o.id), ...(s.player.out ? [] : ["player"])].filter((x) => x !== P);
function isolated(s, P) {
  const mine = s.alliances.filter((a) => a.members.includes(P) && a.members.filter((m) => present(s, m)).length >= 2);
  return !mine.length;
}

// the words Claude is asked for, from what she decided
function intentText(s, P, O, pick, meta, extra = []) {
  const on = nm(s, O);
  const r = meta?.rumor && s.rumors[meta.rumor];
  const it = meta?.item && s.people[P].agenda?.find((x) => x.id === meta.item);
  const base = {
    agenda: it ? (it.kind === "talk" && it.topic ? `raise ${it.topic} with her: share what you know about it and find out what she thinks` : M.agendaText(s, it)) : "say what you came to say",
    small_talk: "chat and trade a little shade about nothing much (no news, no claims)",
    spread: r ? `pass on this gossip [${meta.rumor}]: ${r.text}${meta.embellishing ? " (exaggerate it a little as you tell it)" : ""}` : "pass on some gossip",
    ask: r ? `ask her straight out whether this is true: ${r.text}` : "ask her something",
    confront: r ? `have it out with her about: ${r.text}` : `have it out with her about this: ${meta?.topic || "what she did"}`,
    warn: r ? `warn her what people are saying about her [${meta.rumor}]: ${r.text}` : "warn her",
    probe: "find out who she's voting for and where her loyalties lie, without giving much away",
    lobby: `tell her you're voting out ${nm(s, meta?.target)} and try to get her to vote the same way`,
    lie_vote: `tell her you're voting out ${nm(s, meta?.target)} (a lie: you really mean to vote out ${nm(s, meta?.truth)})`,
    recruit: "propose a secret pact to vote together and look out for each other",
    plant: `make up a damaging story about ${nm(s, meta?.target)} and tell it to her as true`,
    insult: `get a dig in at ${on}`, threaten: `threaten ${on}`, flatter: `butter ${on} up`,
    call_favor: `remind ${on} she owes you a favor and ask for something in return (her vote, or her help)`,
    apologize: `apologize to ${on}`,
    dish: `tell her what you really make of ${nm(s, meta?.target)}${meta?.target === "player" ? ", the newcomer" : ""}: you ${M.feel(s.rel[P][meta?.target]?.affinity ?? 0)} her and ${M.trustWord(s.rel[P][meta?.target]?.trust ?? 0)} her${meta?.why ? ` (${meta.why})` : ""}. Speak your own opinion, then find out what she makes of her`,
    deny: r ? `deny this flatly: ${r.text}` : "deny it",
    admit: r ? `admit this is true: ${r.text}` : "admit it",
    laugh_off: r ? `laugh off this story about you: ${r.text}` : "laugh it off",
    call_out: `call ${on} out: you think she's lying to you${meta?.quote ? `, and you remember her telling you before: ${meta.quote}` : ""}`,
    end: "wrap it up and leave",
  }[meta?.kind || pick] || pick;
  return [...extra, base].join(". Then ");
}

// Lines whose talk was cut short before everyone reacted: their reaction rounds run now.
let flushing = null;
export function flushUnjudged(s, ui) {
  if (flushing) return flushing;
  if (!s.unjudged?.length) return Promise.resolve();
  flushing = (async () => {
    while (s.unjudged.length) {
      const u = s.unjudged.shift();
      const L = { ev: R.evById(s, u.line.ev), moves: u.line.moves.map((id) => s.moves.find((m) => m.id === id)).filter(Boolean), delivery: u.line.delivery, tone: u.line.tone, priorRids: u.line.priorRids || [] };
      if (!L.ev || !u.P) continue;
      if (u.stage === "sincere" && s.people[u.P] && !s.people[u.P].gone) await sincerity(s, u.P, u.O, L);
      const res = await round(s, { ev: L.ev, moves: L.moves, speaker: u.P, addressed: [u.O], talk: u.talk, delivery: L.delivery, tone: L.tone });
      commitAnswers(s, null, L, u.O);
      if (res.fight) (s.pendingFights ??= []).push(res.fight);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

// ---------- driving a talk ----------
// keyed by the talk's own state object, so a new season (or a loaded one) starts clear
const running = new WeakSet();
let inflight = 0;
const hold = (t) => { running.add(t); inflight++; };
const release = (t) => { if (running.has(t)) { running.delete(t); inflight--; } };
export function advance(s, ui) {
  const out = [];
  for (const t of Object.values(s.talks || {})) {
    if (t.status !== "active" || running.has(t) || t.stage === "await_player") continue;
    if (R.now(s) < t.nextAt) continue;
    const why = interrupted(s, t);
    if (why) { end(s, t, why.reason, why.cause, ui); continue; }
    hold(t);
    out.push(step(s, t, ui).catch((e) => { console.error("talk step failed", e); stats.failed++; end(s, t, "something went wrong", t.opened, ui); }).finally(() => release(t)));
  }
  return out;
}
export const stepping = () => inflight;

// Drive one talk until it's the newcomer's turn or it ends (the page waits on this).
export async function runUntil(s, t, ui) {
  if (running.has(t)) { while (running.has(t)) await new Promise((r) => setTimeout(r, 30)); }
  hold(t);
  try {
    for (let i = 0; i < 6 && t.status === "active" && t.stage !== "await_player"; i++) {
      const why = interrupted(s, t);
      if (why) { end(s, t, why.reason, why.cause, ui); break; }
      await step(s, t, ui);
    }
  } catch (e) { console.error("talk step failed", e); stats.failed++; end(s, t, "something went wrong", t.opened, ui); }
  finally { release(t); }
}

function interrupted(s, t) {
  if (!present(s, t.a) || !present(s, t.b)) return { reason: "one of them left town", cause: t.opened };
  if (s.phase !== "day") return { reason: "the day was over", cause: "rule:clock" };
  if ((s.day % SHOW.voteEvery === 0) && s.minute >= 19 * 60) return { reason: "the vote bell rang", cause: "rule:vote-bell" };
  if (s.event && s.event.day === s.day && !s.event.done && s.minute >= s.event.minute - 30 && t.a !== "player" && t.b !== "player") return { reason: "Primrose was gathering everyone for the show", cause: "rule:show" };
  if (t.turns.length >= (t.a === "player" || t.b === "player" ? MAX_PLAYER_LINES : MAX_LINES)) { stats.capped++; return { reason: "they talked themselves out", cause: "rule:talk-length" }; }
  const v = s.people[t.next];
  if (v?.leaving && t.next !== "player") return { reason: `${nm(s, t.next)} stormed off`, cause: v.leaving };
  return null;
}

async function step(s, t, ui) {
  // nothing is read or built while paused: even the view a request is written from waits
  await runtime.through();
  if (t.status !== "active") return;
  const P = t.next, O = other(t, P);
  if (P === "player") { t.stage = "await_player"; return; }
  // someone new within earshot changes what she says
  const nowAround = aroundNow(s, t.a, t.b);
  const arrived = nowAround.filter((x) => !t.around.includes(x));
  if (arrived.length) {
    t.interrupts = [...(t.interrupts || []), ...arrived.map((x) => ({ who: x, at: R.now(s) }))]; t.around = nowAround;
    // whoever is about to speak knows they're being overheard now
    if (t.stage === "write" && t.plan) t.plan.arrived = [...new Set([...(t.plan.arrived || []), ...arrived])];
  }
  if (t.stage === "intent") {
    t.plan = await chooseIntent(s, t, P, O, arrived);
    t.stage = "write";
    if (t.plan.pick === "end" && !t.turns.length) { end(s, t, `${nm(s, P)} thought better of it`, t.plan.decision, ui); return; }
  }
  if (t.stage === "write") {
    const line = await write(s, t, P, O, t.plan, ui);
    if (!line) { stats.cancelled++; end(s, t, line === null ? "the words wouldn't come (dialogue unavailable)" : "she couldn't keep her story straight", t.plan?.decision || t.opened, ui); return; }
    // committed: from here on a reload carries on, it never says the line twice
    t.lastLine = { ev: line.ev.id, moves: line.moves.map((m) => m.id), delivery: line.delivery, tone: line.tone, priorRids: line.priorRids };
    t.stage = "sincere";
  }
  if (t.stage === "sincere") {
    await sincerity(s, P, O, lastLine(s, t));
    t.stage = "react";
    if (t.plan?.pick === "end") { end(s, t, `${nm(s, P)} wrapped it up`, t.lastLine.ev, ui); return; }
    t.nextAt = R.now(s) + MIN_PER_LINE;
  }
  if (t.stage === "react") {
    const L = lastLine(s, t);
    const res = await round(s, {
      ev: L.ev, moves: L.moves, speaker: P, addressed: [O], talk: t.id, delivery: L.delivery, tone: L.tone,
      replyFor: O === "player" ? null : O,
      replyOptions: O === "player" ? null : (Q, { visible }) => intentOptions(s, Q, P, t, { replying: true, visible }),
    });
    commitAnswers(s, t, L, O);
    t.stage = "reacted";
    if (res.fight) { end(s, t, "it turned into a cat fight", res.fight.cause, ui); (s.pendingFights ??= []).push(res.fight); return; }
    if (O === "player") { t.next = "player"; t.stage = "await_player"; return; }
    const rep = res.replies[O];
    if (!rep) { end(s, t, `${nm(s, O)} had nothing to say`, L.ev.id, ui); return; }
    t.plan = planFromReply(s, t, O, P, rep, L);
    t.next = O;
    t.stage = "write";
  }
}

// the last committed line, read back from the record
export function lastLine(s, t) {
  const l = t.lastLine;
  return { ev: R.evById(s, l.ev), moves: l.moves.map((id) => s.moves.find((m) => m.id === id)).filter(Boolean), delivery: l.delivery, tone: l.tone, priorRids: l.priorRids || [] };
}

// the opener decides what she's doing (later turns are decided in the reaction round)
export async function chooseIntent(s, t, P, O, arrived = []) {
  const opts = intentOptions(s, P, O, t, { replying: false });
  const v = s.people[P];
  const around = t.around.filter((x) => x !== "player" || true);
  const qs = { intent: { type: "choice", instructions: `${v.name.split(" ")[0]} is talking with ${nm(s, O)}. What does she do with what she says next?`, criteria: opts.criteria, prior: opts.prior } };
  if (around.length) qs.discreet = { type: "noul", instructions: `${around.map((x) => nm(s, x)).join(", ")} ${around.length > 1 ? "are" : "is"} close enough to hear. Does she lower her voice and keep it between the two of them?`, prior: Math.min(0.9, 0.15 + v.bias.scheme * 0.3 + (arrived.length ? 0.25 : 0)) };
  qs.delivery = { type: "score", instructions: "However honest or not she is being, how does she come across? (Her skill at keeping a straight face, her nerves, what's at stake today.)", criteria: ["visibly nervous and shifty", "a little unsure of herself", "matter-of-fact", "smooth and confident", "completely convincing"], prior: Math.max(0, Math.min(4, 1.6 + v.bias.deceit * 1.6 - v.mood.fear * 0.5 - (s.minute >= 17 * 60 ? 0.4 : 0) + Math.min(0.6, (repeats(s, P) * 0.2)))) };
  const moment = `You are talking with ${nm(s, O)} at ${placeName(t.place)}.${arrived.length ? ` ${arrived.map((x) => nm(s, x)).join(" and ")} just walked up and can hear you.` : ""}${t.reason ? ` You came over because ${t.reason}.` : ""}`;
  const a = await R.decide(s, P, view(s, P, { with: [O], moment }), qs, `intent:${P}->${O}`, t.opened, (o) => `talking to ${nm(s, O)}, chose to ${opts.criteria[o.intent.pick]?.toLowerCase()}`);
  const pick = a.intent.pick;
  const meta = { ...(opts.meta[pick] || { kind: pick }) };
  if (meta.kind === "spread" && meta.embellish) meta.embellishing = (meta.embellish > 0.45);
  return { pick, meta, discreet: !!a.discreet?.yes, delivery: a.delivery.value, decision: a._id, arrived };
}
const repeats = (s, P) => (s.lies || []).filter((l) => l.by === P).length;

export function planFromReply(s, t, P, O, rep, L) {
  const opts = rep.meta || { kind: rep.pick };
  const req = [];
  let lie = null;
  for (const { mv: mid, answer } of rep.answers || []) {
    const mv = s.moves.find((x) => x.id === mid);
    if (!mv) continue;
    if (mv.type === "request" && answer.yes != null) req.push(answer.yes ? `say yes to what she asked ("${mv.span}")${answer.sincere ? "" : " even though you don't mean it"}` : `turn down what she asked ("${mv.span}")`);
    if (mv.type === "question" && answer.mode) {
      const v = s.people[P];
      const aboutVote = /vot|send .* home|going home/i.test(mv.content);
      if (answer.mode === "truth") req.push(aboutVote ? (v.votePlan ? `answer her question honestly: you mean to vote out ${nm(s, v.votePlan.target)}` : "answer honestly: you haven't decided who to vote for") : `answer her question ("${mv.span}") honestly, from what you know`);
      else if (answer.mode === "lie") {
        if (aboutVote) {
          const decoy = candidates(s, P).filter((x) => x !== v.votePlan?.target && x !== O)[0];
          req.push(`answer her question with a lie: say you're voting out ${nm(s, decoy)}`);
          lie = { about: P, content: `${nm(s, P)} means to vote out ${nm(s, decoy)}`, target: decoy, truth: v.votePlan ? `she really means to vote out ${nm(s, v.votePlan.target)}` : "she hasn't decided" };
        } else req.push(`answer her question ("${mv.span}") with a lie`);
      } else req.push(`dodge her question ("${mv.span}")`);
    }
  }
  const meta = { ...opts };
  if (meta.kind === "call_out") {
    // what she remembers this woman telling her before that doesn't fit
    const q = (s.people[P].mem || []).filter((m) => m.words && m.about?.includes(O) && m.ev !== L.ev.id).find((m) => L.moves.some((mv) => mv.rid && Object.keys(s.people[P].knows).some((rid) => B.contradicts(s, rid, mv.rid) && s.people[P].knows[rid].chain.some((c) => c.ev === m.ev))));
    if (q) meta.quote = `"${q.words}" (day ${q.day} ${M.clock(q.minute)})`;
  }
  if (meta.kind === "deny" && meta.lie) lie = { about: P, content: `denies: ${s.rumors[meta.rumor]?.text}`, truth: "it's true and she knows it", rumor: meta.rumor };
  if (meta.kind === "lie_vote") lie = { about: P, content: `${nm(s, P)} means to vote out ${nm(s, meta.target)}`, target: meta.target, truth: `she really means to vote out ${nm(s, meta.truth)}` };
  if (meta.kind === "plant") lie = { about: meta.target, content: `a made-up damaging story about ${nm(s, meta.target)}`, truth: "she made it up" };
  return { pick: rep.pick, meta, req, lie, delivery: rep.delivery, decision: rep.decision, discreet: t.plan?.discreet };
}

// a woman answers what was asked of her: her yes/no becomes a commitment
export function commitAnswers(s, t, L, O) {
  if (O === "player") return;
  for (const mv of L.moves) {
    const ans = mv.answer?.[O];
    if (mv.type !== "request" || !ans?.yes) continue;
    const kind = mv.kind || "other";
    const c = M.commit(s, { by: O, to: mv.by, kind, target: mv.target || null, topic: mv.topic || null, what: mv.content, sincere: ans.sincere, sincerity: ans.decision, cover: ans.sincere ? null : coverText(ans.cover), heard: L.ev.perceivers.filter((p) => p.how === "addressed" || p.how === "overheard").map((p) => p.id), level: L.ev.discreet ? 0 : L.ev.perceivers.length > 2 ? 1 : 0, cause: ans.decision });
    // what she agreed to keep quiet: whatever was told before the ask, and in the same breath
    if (kind === "keep_quiet") c.rids = [...new Set([...(L.priorRids || []), ...L.moves.filter((m) => m.rid).map((m) => m.rid)])];
    // a pact binds the one who proposed it too: her proposal was her own decision
    if (kind === "pact") {
      const own = M.commit(s, { by: mv.by, to: O, kind: "pact", what: mv.content, sincere: true, sincerity: mv.by === "player" ? "player" : L.ev.cause, heard: c.heard, level: c.level, cause: mv.id });
      joinPact(s, mv.by, O, own);
    }
    afterCommit(s, s.people[O], c, ans.decision);
  }
}
const coverText = (k) => ({ changed: "say something she learned changed her mind", never: "say she never really promised", blame: "say someone else talked her out of it", forgot: "say it slipped her mind" }[k] || "say she changed her mind");

// what a commitment means for her: a sincere one goes on her agenda (or into her vote)
export function afterCommit(s, v, c, cause) {
  if (c.kind === "pact") { joinPact(s, c.by, c.to, c); return; }
  if (!v || v.id === "player") return;
  if (c.kind === "vote" && c.target) { if (c.sincere) M.planVote(s, v, c.target, `promised ${nm(s, c.to)}`, { strength: 2, promisedTo: c.to, cause: c.id }); return; }
  if (!c.sincere || ["keep_quiet", "other"].includes(c.kind)) return;
  const kind = { threat: "confront", talk: "talk", ask: "ask", warn: "warn", confront: "confront", spread: "spread", defend: "defend", gift: "gift", make_peace: "make_peace", recruit: "recruit", lobby: "lobby", report: "report" }[c.kind];
  if (!kind) return;
  if (kind !== "spread" && kind !== "report" && (!c.target || !present(s, c.target))) return;
  M.pushAgenda(s, v, { kind, target: c.target, topic: c.topic, commit: c.id, cause: { type: "commit", id: c.id } });
}

// alliances are commitments: members, terms, a start, and each member's own commitment and
// private loyalty. c is the commitment of the woman (or newcomer) joining; she joins the
// group of the one she made it to.
export function joinPact(s, by, with_, c) {
  let al = s.alliances.find((x) => x.members.includes(by) && x.members.includes(with_));
  if (!al) al = s.alliances.find((x) => x.members.includes(with_) && x.members.length < 4 && x.members.every((m) => present(s, m)));
  if (!al) {
    const names = ["the Fountain Pact", "the Bun Club", "the Blowout Bunch", "the Last Call", "the Inkwells", "the Price Fixers", "the Back Benchers", "the Anvils", "the Weeds", "the Dock Pact", "the Embers", "the Porch Pact"];
    const used = new Set(s.alliances.map((x) => x.name));
    al = { id: "al" + (s.alliances.length + 1), name: names.find((n) => !used.has(n)) || `the Pact ${s.alliances.length + 1}`, members: [with_], day: s.day, terms: "vote together and look out for each other", sincere: {}, loyal: {}, commits: {}, history: [] };
    s.alliances.push(al);
  }
  const fresh = !al.members.includes(by);
  if (fresh) al.members.push(by);
  al.sincere ??= {}; al.loyal ??= {}; al.commits ??= {};
  al.sincere[by] = c.sincere; al.loyal[by] = c.sincere; al.commits[by] = c.id;
  (al.history ??= []).push({ day: s.day, minute: s.minute, what: `${by} ${fresh ? "joined" : "renewed her word"}`, cause: c.id });
  R.change(s, { who: by, what: "alliance", key: al.id, from: fresh ? null : "member", to: "member", cause: c.id });
  return al;
}

// ---------- writing a line ----------
async function write(s, t, P, O, plan, ui) {
  const v = s.people[P];
  const history = lineHistory(s, t, P);
  const intent = intentText(s, P, O, plan.pick, plan.meta, plan.req || []);
  const moment = `You are talking with ${nm(s, O)} at ${placeName(t.place)}.${(plan.arrived || []).length ? ` ${(plan.arrived).map((x) => nm(s, x)).join(" and ")} just walked up and can hear you.` : ""}${plan.discreet ? " You keep your voice down." : ""}`;
  const vw = view(s, P, { with: [O], topic: plan.meta?.rumor, about: plan.meta?.target, moment });
  const allowed = Object.entries(v.knows).filter(([, k]) => k.conf >= 0.3).map(([rid]) => rid);
  const ctx = { v, view: vw.payload, to: [nm(s, O)], history, intent, lie: plan.lie, allowed, playerName: s.player.name, setting: moment, plan, talk: t.id, listener: O };
  let got = null, tries = 0, strict = false, why = null;
  while (tries < 3) {
    tries++;
    const ans = await voice.turn(s, { ...ctx, strict });
    if (!ans) return null; // Claude unavailable: nothing is shown, the talk is cancelled with a cause
    let raw = ans.moves;
    let res = raw ? check(s, raw, { line: ans.line, speaker: P, listeners: [O] }) : null;
    if (!res || res.rejects.length) {
      // the moves didn't check out: read them out of the words again
      for (const r of res?.rejects || [{ why: "no moves came back" }]) logReject(s, P, ans.line, r, true);
      stats.reextracted++;
      const again = await voice.extract(s, { line: ans.line, speaker: nm(s, P), listeners: [nm(s, O)], history, playerName: s.player.name }, { pri: "talk" });
      res = check(s, again || [], { line: ans.line, speaker: P, listeners: [O] });
      for (const r of res.rejects) logReject(s, P, ans.line, r, false);
    }
    const bad = res.moves.filter((mv) => !grounded(s, P, mv, { lie: plan.lie }).ok);
    if (bad.length) { stats.regenerated++; strict = true; why = grounded(s, P, bad[0], { lie: plan.lie }).why; logReject(s, P, ans.line, { move: bad[0], why }, true); continue; }
    got = { line: ans.line, moves: res.moves, tone: res.tone };
    break;
  }
  if (!got) { stats.ungroundedFinal++; return false; }
  return commitLine(s, t, P, O, got, plan, ui);
}
function logReject(s, who, line, r, retry) {
  stats.rejected++;
  (s.rejects ??= []).push({ who, line, why: r.why, move: r.move ? JSON.stringify(r.move).slice(0, 200) : null, retry, day: s.day, minute: s.minute });
  if (s.rejects.length > 200) s.rejects.shift();
}

// what she has heard in this talk, word for word
function lineHistory(s, t, P) {
  return t.turns.map((x) => `${x.by === "player" ? s.player.name : nm(s, x.by)}: ${x.text}`).slice(-8);
}

// ---------- committing a line ----------
export function commitLine(s, t, P, O, got, plan, ui) {
  const at = centre([pos(s, P), pos(s, O)]);
  const discreet = !!plan?.discreet;
  const place = t.place;
  const per = R.whoPerceives(s, { actor: P, targets: [O], place, at, discreet });
  const heardAs = {};
  for (const p of per) if (p.how === "partial") heardAs[p.id] = M.fragment(s, got.line, p.id, `${s.day}:${s.minute}:${t.id}`);
  const ev = R.emit(s, { type: "line", actor: P, targets: [O], place, at, discreet, perceivers: per, content: { text: got.line, heardAs, tone: got.tone, intent: plan?.pick || null }, cause: plan?.decision || t.opened, talk: t.id });
  const moves = got.moves.map((mv) => register(s, mv, { ev: ev.id, talk: t.id }));
  ev.content.moves = moves.map((m) => m.id);
  for (const mv of moves) if (["claim", "accusation", "secret"].includes(mv.type)) settleClaim(s, mv, { speaker: P, lie: plan?.lie, ev: ev.id });
  // telling what she promised to keep quiet about breaks that promise, whoever she tells
  for (const mv of moves.filter((m) => m.rid && ["claim", "accusation", "secret"].includes(m.type))) {
    const root = B.rootOf(s, mv.rid);
    for (const c of (s.ledger || []).filter((c) => c.by === P && c.status === "open" && c.kind === "keep_quiet" && c.to !== O)) {
      if ((c.rids || []).some((r) => r === mv.rid || B.rootOf(s, r) === root)) M.settle(s, c, "broken", `told ${nm(s, O)} anyway`, ev.id);
    }
  }
  // her own promises and plans go in the book, with whether she meant them
  const priorRids = t.turns.flatMap((x) => x.rids || []);
  const sinc = speakerCommitments(s, t, P, O, moves, ev, plan);
  const turn = { by: P, text: got.line, ev: ev.id, moves: moves.map((m) => m.id), rids: moves.filter((m) => m.rid).map((m) => m.rid), intent: plan?.pick || null, carried: plan?.pick === "agenda" || (plan?.meta?.item != null), item: plan?.meta?.item ?? null };
  t.turns.push(turn);
  stats.lines++;
  const substantive = moves.filter((m) => SUBSTANTIVE.has(m.type) && m.type !== "question" || (m.type === "question" && m.about)).length;
  if (!substantive) stats.small++;
  const playerHears = per.find((p) => p.id === "player" && p.how !== "saw");
  if (P === "player" || O === "player" || playerHears) { stats.onscreenLines++; stats.onscreenMoves += substantive; } else { stats.offscreenLines++; stats.offscreenMoves += substantive; }
  // the page shows it only now, after it is committed
  if (O === "player") ui?.toPlayer?.({ talk: t.id, by: P, text: got.line, ev: ev.id });
  if (playerHears && P !== "player" && O !== "player") ui?.exchange?.({ a: P, b: O, lines: [{ id: P, text: playerHears.how === "partial" ? heardAs.player : got.line }], full: playerHears.how !== "partial", talk: t.id });
  if (plan?.pick === "agenda" && t.agenda) {
    const it = s.people[P]?.agenda?.find((x) => x.id === t.agenda);
    if (it) turn.carried = true;
  }
  return { ev, moves, delivery: plan?.delivery, tone: got.tone, priorRids, sinc };
}

// promises and plans in her own words: Jev decides whether she meant each one, and a sincere
// one goes on her agenda
export function speakerCommitments(s, t, P, O, moves, ev, plan) {
  const out = [];
  for (const mv of moves.filter((m) => m.type === "promise" || m.type === "plan" || m.type === "threat" || (m.type === "agreement" && P === "player"))) {
    // a threat is a promise too: to make someone regret it
    // the newcomer's yes is a yes to whatever was just asked of her
    const asked = mv.type === "agreement" && !mv.kind ? [...t.turns].reverse().filter((x) => x.by === O).flatMap((x) => x.moves).map((id) => s.moves.find((m) => m.id === id)).find((m) => m?.type === "request" && (m.to || []).includes(P)) : null;
    if (asked) { mv.kind = asked.kind; mv.target = asked.target; mv.topic = asked.topic; mv.answers = asked.id; }
    const kind = mv.type === "threat" ? "threat" : mv.kind || (mv.voteTarget ? "vote" : "other");
    const target = mv.type === "threat" ? mv.about || mv.to?.[0] || O : mv.target || mv.voteTarget || null;
    const heard = ev.perceivers.filter((p) => p.how === "addressed" || p.how === "overheard").map((p) => p.id);
    const level = ev.type === "show_line" ? 2 : ev.discreet ? 0 : heard.length > 2 ? 1 : 0;
    if (P === "player") {
      const c = M.commit(s, { by: "player", to: mv.to?.[0] || O, kind, target, topic: mv.topic || null, what: mv.content, sincere: true, sincerity: "player", heard, level, cause: mv.id });
      mv.commit = c.id; out.push(c);
      if (kind === "pact" && mv.answers) {
        // she said yes to a woman's pact: the woman's own proposal binds her too
        const asker = s.moves.find((m) => m.id === mv.answers)?.by;
        if (asker && present(s, asker)) { joinPact(s, "player", asker, c); joinPact(s, asker, "player", M.commit(s, { by: asker, to: "player", kind: "pact", what: mv.content, sincere: true, sincerity: R.evById(s, s.moves.find((m) => m.id === mv.answers)?.ev)?.cause || "rule:pact", heard, level, cause: mv.answers })); }
      }
      continue;
    }
    // the lie she chose is not a promise she means; anything else Jev decides now
    const lieVote = plan?.lie && kind === "vote" && target === plan.lie.target;
    mv.pendingCommit = { kind, target, level, heard, lieVote };
  }
  return out;
}

// After the line: settle the speaker's own promises with a sincerity decision each.
export async function sincerity(s, P, O, L) {
  for (const mv of L.moves.filter((m) => m.pendingCommit)) {
    const { kind, target, level, heard, lieVote } = mv.pendingCommit;
    delete mv.pendingCommit;
    let sincere = !lieVote, cover = null, did = null;
    if (!lieVote) {
      const v = s.people[P];
      const a = await R.decide(s, P, view(s, P, { with: [O], small: true, moment: `You just told ${nm(s, O)}: "${mv.span}"` }), {
        meant: { type: "noul", instructions: `${v.name.split(" ")[0]} just said: "${mv.span}". Does she actually mean to do it?`, prior: Math.max(0.05, Math.min(0.97, 0.85 - v.bias.deceit * 0.45 + (kind === "vote" && target && (s.rel[P][target]?.affinity ?? 0) < 0 ? 0.1 : 0) - (kind === "vote" && target && (s.rel[P][target]?.affinity ?? 0) > 1 ? 0.4 : 0))) },
        cover: { type: "choice", instructions: "If she doesn't mean it, what will she say later if called on it?", criteria: { changed: "That something she learned changed her mind", never: "That she never really promised", blame: "That someone else talked her out of it", forgot: "That it slipped her mind" }, prior: { changed: 1.2, never: v.bias.deceit, blame: v.bias.scheme * 0.8, forgot: 0.5 } },
      }, `sincere:${P}`, mv.id, (o) => `${o.meant.yes ? "meant" : "didn't mean"} it when she said "${mv.span}"`);
      sincere = a.meant.yes; cover = sincere ? null : coverText(a.cover.pick); did = a._id;
    } else did = L.ev.cause;
    const c = M.commit(s, { by: P, to: mv.to?.[0] || O, kind, target, topic: mv.topic || null, what: mv.content, sincere, sincerity: did, cover: cover || (lieVote ? "say something she learned changed her mind" : null), heard, level, cause: mv.id });
    mv.commit = c.id;
    afterCommit(s, s.people[P], c, did);
  }
}
