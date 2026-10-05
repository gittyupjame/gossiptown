// The record: one world log nobody in town can read, a decision log, and a trace of every
// change to anyone's state with the cause that produced it. Code is the only writer: Jev and
// Claude propose (answers, lines, moves); the functions here and in mind.js / beliefs.js
// commit, and every commit carries a cause pointer:
//   e12  an event in the world log        d40  a decision Jev made
//   mv7  a move read out of someone's words   i3  a logged inference
//   c5   a commitment                     rule:<name>  a rule of the world (overnight drift…)
//
// Every event lists who perceived it and how (did | addressed | overheard | partial | saw),
// and each perceiver gets her own memory of it in her own version. Nobody's prompt or Jev
// state is ever built from the world log: only from her own memories and beliefs (views.js).

import * as jev from "./jev.js";
import { audience, pos, centre, locOf } from "./space.js";

// ---------- event types (closed and versioned) ----------
export const EVENT_TYPES_VERSION = 1;
export const EVENT_TYPES = Object.freeze({
  history: "something that happened before the season (backstory)",
  arrive: "she arrived somewhere",
  depart: "she set off somewhere",
  talk_open: "a conversation started",
  line: "someone said something",
  talk_end: "a conversation ended",
  gift: "someone gave someone a gift",
  fight: "a cat fight",
  ballot: "a ballot read out at the vote",
  elimination: "someone was voted out",
  finale: "the season's winner was crowned",
  snoop: "someone went through a mailbox",
  board_post: "an anonymous note was pinned on the Whisper board",
  board_read: "someone read a note on the Whisper board",
  outfit: "the newcomer showed up in an outfit",
  show_open: "Primrose opened a show",
  show_line: "someone spoke at Primrose's show",
  outburst: "a visible reaction: a gasp, storming off, calling out",
  announcement: "Primrose announced something to everyone",
  mail: "a letter or note was delivered",
});

export const now = (s) => s.day * 1440 + s.minute;
export const stamp = (s) => ({ day: s.day, minute: s.minute });
export function nextId(s, prefix) {
  s.ids ??= {};
  s.ids[prefix] = (s.ids[prefix] || 0) + 1;
  return prefix + s.ids[prefix];
}

// ---------- hooks (tests, the inspector) ----------
const hooks = { emit: [], change: [], decide: [], violation: [] };
export function on(kind, fn) { hooks[kind].push(fn); return () => { hooks[kind] = hooks[kind].filter((f) => f !== fn); }; }
const fire = (kind, ...a) => { for (const f of hooks[kind]) try { f(...a); } catch (e) { console.error(e); } };

// ---------- visible cues ----------
// A woman's view of the newcomer just moved a lot: the page shows it over her head.
let cueSink = null;
export const setCueSink = (f) => { cueSink = f; };
export function cue(s, c) {
  const x = { ...c, day: s.day, minute: s.minute };
  (s.cues ??= []).push(x);
  if (s.cues.length > 200) s.cues.splice(0, s.cues.length - 200);
  try { cueSink?.(x); } catch (e) { console.error(e); }
  return x;
}

// ---------- violations ----------
export function violation(s, rule, detail) {
  (s.violations ??= []).push({ rule, detail, day: s.day, minute: s.minute });
  if (s.violations.length > 300) s.violations.splice(0, s.violations.length - 300);
  fire("violation", rule, detail);
}

const isCause = (c) => typeof c === "string" && /^(e|d|mv|i|c|t|a)\d+$|^rule:[a-z-]+$|^player:[a-z-]+$/.test(c);

// ---------- the trace ----------
// what: "rel" | "belief" | "mood" | "goal" | "agenda" | "commit" | "alliance" | "vote_plan" | "memory" | "trait"
export function change(s, { who, what, key = null, from = null, to = null, cause }) {
  if (!isCause(cause)) violation(s, "change-without-cause", { who, what, key, cause });
  const c = { n: (s.traceN = (s.traceN || 0) + 1), day: s.day, minute: s.minute, who, what, key, from: round(from), to: round(to), cause };
  (s.trace ??= []).push(c);
  fire("change", c);
  return c;
}
const round = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);

// keep the play link's save small: the trace of the last two days stays, older entries go
// (their causes live on in reasons, belief chains and memories)
export function pruneTrace(s, keepDays = 2) {
  if (!s.trace?.length) return;
  const cut = s.trace.findIndex((c) => c.day > s.day - keepDays);
  if (cut > 0) s.trace.splice(0, cut);
}

// ---------- the world log ----------
// perceivers: computed from where everyone is, unless given. Each perceiver remembers it.
let remember = null; // set by mind.js (avoids an import cycle at load time)
export function setRememberer(fn) { remember = fn; }

// Who perceives something happening at a point, and how. The actor "did" it; whoever it was
// said to and can hear it was "addressed"; everyone else by distance (overheard | partial | saw).
// At a public moment (the show, the vote) everyone at the place hears every word.
export function whoPerceives(s, { actor = null, targets = [], place = null, at = null, discreet = false, public: pub = false }) {
  const seen = new Map();
  if (actor && actor !== "primrose" && actor !== "truth") seen.set(actor, "did");
  if (at) for (const a of audience(s, at, { discreet, place })) {
    if (seen.has(a.id)) continue;
    let how = a.how === "full" ? "overheard" : a.how;
    if (pub && locOf(s, a.id) === place) how = "overheard";
    seen.set(a.id, targets.includes(a.id) && how !== "saw" ? "addressed" : how);
  }
  return [...seen].map(([id, how]) => ({ id, how }));
}

export function emit(s, { type, actor = null, targets = [], place = null, at = null, content = {}, cause = null, discreet = false, perceivers = null, talk = null, public: pub = false, quiet = false }) {
  if (!EVENT_TYPES[type]) violation(s, "unknown-event-type", { type });
  if (actor && actor !== "player" && actor !== "primrose" && s.people[actor]?.gone && type !== "elimination" && !content?.parting) violation(s, "gone-actor", { type, actor });
  const id = nextId(s, "e");
  place ??= actor ? locOf(s, actor) : null;
  at ??= centre([actor ? pos(s, actor) : null, ...targets.map((t) => pos(s, t))]);
  const per = perceivers || (type === "history" ? [] : whoPerceives(s, { actor, targets, place, at, discreet, public: pub }));
  const ev = { id, v: EVENT_TYPES_VERSION, day: s.day, minute: s.minute, place, type, actor, targets: [...targets], content, perceivers: per, cause, ...(talk ? { talk } : {}), ...(discreet ? { discreet: true } : {}), ...(pub ? { public: true } : {}) };
  (s.world ??= []).push(ev);
  fire("emit", ev, s);
  if (!quiet && remember) for (const p of per) remember(s, p.id, ev, p.how);
  return ev;
}

export const evById = (s, id) => (s.world || []).find((e) => e.id === id) || null;
export const perceivedBy = (ev, who) => ev?.perceivers?.find((p) => p.id === who)?.how || null;

// ---------- decisions ----------
// Every real choice goes through here: Jev answers (or the stand-in, with the same shapes),
// and the question, the options, the probabilities, the pick and what fed it are logged.
//   view: { payload, used }  from views.js (her view only)
export async function decide(s, actor, view, questions, label, cause = null, describe = null) {
  const id = nextId(s, "d");
  const payload = view?.payload ?? view ?? {};
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const out = await jev.ask(payload, questions, label);
  const entry = { id, day: s.day, minute: s.minute, actor, label, cause, used: view?.used || { fields: Object.keys(payload) }, ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0), q: {} };
  for (const [k, q] of Object.entries(questions)) {
    const a = out[k];
    if (q.type === "choice") entry.q[k] = { type: "choice", options: Object.keys(q.criteria), probs: roundAll(a.probs), pick: a.pick };
    else if (q.type === "score") entry.q[k] = { type: "score", levels: q.criteria.length, value: round(a.value) };
    else entry.q[k] = { type: "noul", p: round(a.p), yes: a.yes };
  }
  if (describe) try { entry.text = describe(out); } catch {}
  (s.decisions ??= []).push(entry);
  fire("decide", entry, payload, questions, s);
  out._id = id;
  return out;
}
const roundAll = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, round(v)]));
export const decisionById = (s, id) => (s.decisions || []).find((d) => d.id === id) || null;

// the save keeps every decision of the last two days and only the bones of older ones
export function pruneDecisions(s, keepDays = 2) {
  for (const d of s.decisions || []) if (d.day <= s.day - keepDays && d.used) { d.used = null; for (const q of Object.values(d.q)) if (q.probs) q.probs = { [q.pick]: q.probs[q.pick] }; }
}
