// What each woman carries: feelings, mood, memories, commitments, goals and her agenda.
// Beliefs live in beliefs.js. Every change here goes through record.change with a cause.
//
//   rel[a][b]   how a sees b, one way: affinity (liking), trust, respect, fear, debt (what
//               a owes b). Each has its own number; reasons are kept with their causes.
//               Feelings drift back toward where they started, slower after strong events.
//   mood        anger, fear, cheer (0..3), with why and the cause.
//   mem         one memory per event she perceived, in her own version, with a weight
//               (how intense, how much it concerned her, how surprising). Light memories
//               fade and get folded into summaries; heavy ones are kept all season.
//   ledger      the town's book of commitments: who said she would do what, to whom, by
//               when, who heard, whether she meant it (a Jev decision), and how it ended.
//   goals       what she is trying to get (survive the vote, sink a rival, protect an ally…)
//   agenda      what she means to do next, each item citing the goal, commitment or
//               reaction behind it.

import { change, nextId, setRememberer, now, violation, cue } from "./record.js";

const nm = (s, id) => (id === "player" ? s.player.name : id === "primrose" ? "Primrose" : id === "board" ? "an anonymous note" : s.people[id]?.name?.split(" ")[0] || id || "someone");
export const clamp = (x, lo = -3, hi = 3) => Math.max(lo, Math.min(hi, x));
const pad = (n) => String(n).padStart(2, "0");
export const clock = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// ---------- feelings ----------

export const DIMS = ["affinity", "trust", "respect", "fear", "debt"];
const MAX_REASONS = 6;

export function newRel(affinity = 0.3, trust = 0.3, note = "neighbors") {
  return { affinity, trust, respect: 0, fear: 0, debt: 0, note, why: [], base: { affinity, trust, respect: 0, fear: 0, debt: 0 } };
}

// Change how `a` sees `b`. Pushing toward an extreme gets harder; easing off is easy.
export function shift(s, a, b, { aff = 0, trust = 0, respect = 0, fear = 0, debt = 0, why = null, cause }) {
  const r = s.rel[a]?.[b];
  if (!r) return null;
  const d = { affinity: aff, trust, respect, fear, debt };
  const ease = (x, dx) => dx * (1 - Math.max(0, Math.sign(dx) * x) / 3.6);
  for (const k of DIMS) {
    if (!d[k]) continue;
    const before = r[k] ?? 0;
    r[k] = clamp(before + (k === "debt" ? d[k] : ease(before, d[k])), k === "fear" || k === "debt" ? (k === "debt" ? -3 : 0) : -3, 3);
    change(s, { who: a, what: "rel", key: `${b}.${k}`, from: before, to: r[k], cause });
  }
  const weight = Math.abs(aff) + Math.abs(trust) * 0.8 + Math.abs(respect) * 0.5 + Math.abs(fear) * 0.5 + Math.abs(debt) * 0.5;
  // a big change in how she sees the newcomer shows on her face
  if (b === "player" && !/^rule:/.test(cause || "") && Math.abs(aff) + Math.abs(trust) * 0.8 >= 0.4) cue(s, { who: a, kind: aff >= 0.25 ? "heart" : aff <= -0.25 ? "anger" : trust < 0 ? "suspicious" : "flower", cause });
  if (why && weight >= 0.2) {
    r.why ??= [];
    const same = r.why.find((x) => x.text === why);
    const sign = Math.sign(aff + trust + respect * 0.5 + debt * 0.3 - fear * 0.3) || -1;
    if (same) { same.w += weight; same.day = s.day; same.sign = sign; same.cause = cause; }
    else r.why.push({ text: why, day: s.day, w: weight, sign, cause });
    r.why.sort((p, q) => reasonScore(s, q) - reasonScore(s, p));
    if (r.why.length > MAX_REASONS) r.why.length = MAX_REASONS;
  }
  return r;
}
const reasonScore = (s, x) => x.w / (1 + (s.day - x.day) * 0.35);

export function reasonsText(s, r, max = 3) {
  if (!r?.why?.length) return "";
  return r.why.slice(0, max).map((x) => `${x.text} (day ${x.day})`).join("; ");
}

const LIKE = ["hates", "dislikes", "is cool toward", "is neutral about", "likes", "is fond of", "adores"];
const TRUST = ["completely distrusts", "distrusts", "doubts", "is unsure about", "mostly trusts", "trusts", "trusts completely"];
export const feel = (x) => LIKE[Math.round(clamp(x) + 3)];
export const trustWord = (x) => TRUST[Math.round(clamp(x) + 3)];

// "likes her, mostly trusts her, is a little afraid of her, owes her a favor"
export function relText(s, a, b, { reasons = true } = {}) {
  const r = s.rel[a]?.[b];
  if (!r) return "";
  const bits = [`${feel(r.affinity)} her`, `${trustWord(r.trust)} her`];
  if (r.respect >= 1) bits.push("respects her"); else if (r.respect <= -1) bits.push("has no respect for her");
  if (r.fear >= 1.5) bits.push("is afraid of her"); else if (r.fear >= 0.6) bits.push("is a little wary of her");
  if (r.debt >= 0.6) bits.push("owes her a favor"); else if (r.debt <= -0.6) bits.push("thinks she is owed a favor");
  const why = reasons ? reasonsText(s, r) : "";
  return `${bits.join(", ")}${r.note ? ` (${r.note})` : ""}${why ? `; lately: ${why}` : ""}`;
}

// An in-game hour passes: feelings ease back toward where they started. Fresh, heavy
// reasons hold them in place, so a slight is mostly gone in two days and a betrayal isn't.
export function driftFeelings(s, hours = 1) {
  for (const [a, row] of Object.entries(s.rel)) {
    if (s.people[a]?.gone) continue;
    for (const [b, r] of Object.entries(row)) {
      r.base ??= { affinity: r.affinity, trust: r.trust, respect: 0, fear: 0, debt: 0 };
      const hold = (r.why || []).filter((x) => s.day - x.day <= 2).reduce((t, x) => t + Math.max(0, x.w - 0.6), 0);
      const k = (0.022 / (1 + hold * 1.4)) * hours;
      for (const dim of ["affinity", "trust", "respect", "fear"]) {
        const before = r[dim] ?? 0, base = r.base[dim] ?? 0;
        const after = before + (base - before) * (dim === "trust" ? k * 0.6 : dim === "fear" ? k * 1.5 : k);
        if (Math.abs(after - before) >= 0.0005) { r[dim] = after; change(s, { who: a, what: "rel", key: `${b}.${dim}`, from: before, to: after, cause: "rule:drift" }); }
      }
    }
  }
}

// ---------- mood ----------

export function stir(s, v, { anger = 0, fear = 0, cheer = 0, why = null, cause }) {
  const m = v.mood;
  for (const [k, d] of [["anger", anger], ["fear", fear], ["cheer", cheer]]) {
    if (!d) continue;
    const before = m[k];
    m[k] = Math.max(0, Math.min(3, m[k] + d));
    change(s, { who: v.id, what: "mood", key: k, from: before, to: m[k], cause });
  }
  if (why && (anger >= 0.5 || fear >= 0.5 || Math.abs(cheer) >= 0.5)) { m.why = why; m.cause = cause; }
}

export function driftMood(s, v, hours = 1) {
  const m = v.mood, base = v.moodBase || { anger: 0, fear: 0, cheer: 1 };
  for (const k of ["anger", "fear", "cheer"]) {
    const before = m[k];
    m[k] += (base[k] - m[k]) * Math.min(1, 0.1 * hours);
    if (Math.abs(m[k] - before) >= 0.001) change(s, { who: v.id, what: "mood", key: k, from: before, to: m[k], cause: "rule:drift" });
  }
  if (m.anger < 0.6 && m.fear < 0.6) m.why = null;
}

export const moodText = (m) => [m.anger >= 2 ? "furious" : m.anger >= 1 ? "irritated" : null, m.fear >= 2 ? "scared" : m.fear >= 1 ? "uneasy" : null, m.cheer >= 2 ? "cheerful" : m.cheer <= 0.3 ? "glum" : null].filter(Boolean).join(", ") || "calm";

// ---------- memory ----------

export const MEM_CAP = 70;   // memories kept one by one; the rest live on in summaries
export const HEAVY = 3;      // weight from which a memory is never summarized

const BASE_W = { history: 2, arrive: 0.1, depart: 0.1, talk_open: 0.3, line: 1, talk_end: 0.2, gift: 1.5, fight: 3, ballot: 2, elimination: 3, finale: 3, snoop: 1.5, board_post: 1, board_read: 0.8, outfit: 0.6, show_open: 0.4, show_line: 1.2, outburst: 1.4, announcement: 1, mail: 1 };

// the record of someone (a woman or the player) who perceives things
export const actor = (s, id) => (id === "player" ? s.player : s.people[id]);

// Every perceived event becomes a memory, in her version of it.
export function perceived(s, id, ev, how) {
  const v = actor(s, id);
  if (!v || (id !== "player" && v.gone)) return null;
  v.mem ??= [];
  const concerns = ev.actor === id || ev.targets.includes(id) || ev.content?.about === id;
  const w = (BASE_W[ev.type] ?? 1) * (concerns ? 2 : 1) * (how === "saw" ? 0.6 : how === "partial" ? 0.8 : 1);
  const m = { id: nextId(s, "m"), ev: ev.id, how, text: memText(s, ev, how, id), w: Math.round(w * 100) / 100, day: s.day, minute: s.minute, about: [...new Set([ev.actor, ...ev.targets, ev.content?.about].filter((x) => x && x !== id))] };
  if (ev.type === "line" || ev.type === "show_line") {
    if (how === "partial") m.words = ev.content.heardAs?.[id] ?? fragment(s, ev.content.text, id, ev.id);
    else if (how !== "saw") m.words = ev.content.text;
  }
  v.mem.push(m);
  compress(s, v);
  return m;
}
setRememberer(perceived);

// a few words of a line heard from too far away (the same few every time for the same ear)
export function fragment(s, text, id, evId) {
  let h = 0;
  for (const c of `${s?.seed ?? ""}|${id}|${evId}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const words = String(text).split(/\s+/);
  const kept = words.map((w, i) => (((h >> (i % 24)) & 3) < 2 ? w : null));
  return kept.map((w) => w || "…").join(" ").replace(/(…\s*)+/g, "… ").trim();
}

export function memText(s, ev, how, me) {
  const A = ev.actor === me ? "I" : nm(s, ev.actor), c = ev.content || {};
  const T = (ev.targets || []).map((t) => (t === me ? "me" : nm(s, t))).join(" and ");
  const at = ev.place && ev.place !== "lane" ? ` at ${placeWord(ev.place)}` : "";
  switch (ev.type) {
    case "line":
    case "show_line": {
      if (how === "saw") return `saw ${A} ${ev.discreet ? "whispering with" : "talking to"} ${T || "someone"}${at}`;
      if (how === "partial") return `caught part of what ${A} said to ${T || "someone"}${at}: "${c.heardAs?.[me] ?? fragment(s, c.text, me, ev.id)}"`;
      return `${A === "I" ? "I said" : `${A} said`} to ${T || "everyone"}${at}: "${c.text}"`;
    }
    case "talk_open": return ev.actor === me ? `went to talk to ${T}${c.reason ? ` (${c.reason})` : ""}` : `${A} came over to talk to ${T}${at}`;
    case "talk_end": return `${A} and ${T} finished talking${c.reason && (ev.actor === me || ev.targets.includes(me)) ? ` (${c.reason})` : ""}`;
    case "arrive": return ev.actor === me ? `got to ${placeWord(ev.place)}` : `saw ${A} arrive${at}`;
    case "depart": return ev.actor === me ? `left for ${placeWord(c.to)}` : `saw ${A} leave${at}`;
    case "gift": return how === "saw" ? `saw ${A} hand ${T} something${at}` : `${A} gave ${T} ${c.item}${at}`;
    case "fight": return `${A} and ${T} had a cat fight${at}${c.winner ? `; ${c.winner === me ? "I" : nm(s, c.winner)} came out on top` : ""}`;
    case "ballot": return `${A} voted to send ${c.target === me ? "me" : nm(s, c.target)} home`;
    case "elimination": return `${c.out === me ? "I was" : `${nm(s, c.out)} was`} voted out`;
    case "finale": return `${nm(s, c.winner)} won the season`;
    case "snoop": return how === "did" ? `went through ${nm(s, c.owner)}'s mailbox${c.found ? ` and found: ${c.found}` : ""}` : `saw ${A} going through ${c.owner === me ? "my" : `${nm(s, c.owner)}'s`} mailbox`;
    case "board_post": return how === "did" ? `pinned an anonymous note on the Whisper board: "${c.text}"` : `saw ${A} pin something on the Whisper board`;
    case "board_read": return ev.actor === me ? `read an anonymous note on the Whisper board: "${c.text}"` : `saw ${A} reading the Whisper board`;
    case "outfit": return ev.actor === me ? `wore ${c.look}` : `saw ${A} wearing ${c.look}`;
    case "show_open": return `Primrose opened ${c.title}${at}`;
    case "outburst": return `${A} ${c.what}${at}`;
    case "announcement": return `Primrose announced: ${c.text}`;
    case "history": return c.text;
    case "mail": return `${A} sent ${T} a note: "${c.text}"`;
    default: return `${A} ${ev.type}${T ? ` ${T}` : ""}`;
  }
}
const PLACE_WORDS = { plaza: "the plaza", bakery: "the bakery", salon: "the salon", tavern: "the tavern", gazette: "the Whisper office", market: "the market", hall: "the town hall", smithy: "the smithy", garden: "the herb garden", dock: "the dock", firepit: "the firepit", home: "home", lane: "the lane" };
export const placeWord = (p) => PLACE_WORDS[p] || p;

// A judgment made it matter more (or less) to her.
export function reweigh(s, id, evId, w, cause) {
  const v = actor(s, id);
  const m = v?.mem?.find((x) => x.ev === evId);
  if (!m) return;
  const before = m.w;
  m.w = Math.max(m.w, Math.round(w * 100) / 100);
  if (m.w !== before) change(s, { who: id, what: "memory", key: m.id, from: before, to: m.w, cause });
}

// Something she did or decided herself (she perceives her own decisions).
export function note(s, id, text, { w = 1, cause, about = [] }) {
  const v = actor(s, id);
  if (!v) return null;
  if (!cause) violation(s, "memory-without-cause", { id, text });
  v.mem ??= [];
  const m = { id: nextId(s, "m"), self: true, cause, text, w, day: s.day, minute: s.minute, about };
  v.mem.push(m);
  compress(s, v);
  return m;
}

// Memory is bounded: the oldest light memories fold into a summary that cites them.
function compress(s, v) {
  if (v.mem.length <= MEM_CAP) return;
  // heavy memories are never folded away, so with too few light ones she keeps a few extra
  const light = v.mem.filter((m) => m.w < HEAVY).slice(0, Math.max(14, v.mem.length - MEM_CAP));
  if (light.length < 2) return;
  const ids = new Set(light.map((m) => m.id));
  v.mem = v.mem.filter((m) => !ids.has(m.id));
  const people = {};
  for (const m of light) for (const p of m.about || []) people[p] = (people[p] || 0) + 1;
  const top = Object.entries(people).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${nm(s, p)} (${n})`);
  const d0 = light[0], d1 = light.at(-1);
  const sum = {
    id: nextId(s, "sum"), day: d1.day,
    text: `day ${d0.day} ${clock(d0.minute)} to day ${d1.day} ${clock(d1.minute)}: ${light.length} small moments${top.length ? `, mostly with ${top.join(", ")}` : ""}; e.g. ${light.slice(-3).map((m) => m.text.slice(0, 80)).join(" / ")}`,
    cites: light.map((m) => m.id), evs: light.map((m) => m.ev || null).filter(Boolean), w: Math.max(...light.map((m) => m.w)), about: Object.keys(people),
  };
  (v.summaries ??= []).push(sum);
  if (v.summaries.length > 30) {
    const [a, b] = v.summaries.splice(0, 2);
    v.summaries.unshift({ id: nextId(s, "sum"), day: b.day, text: `${a.text} || ${b.text}`.slice(0, 600), cites: [...a.cites, ...b.cites], evs: [...a.evs, ...b.evs], w: Math.max(a.w, b.w), about: [...new Set([...a.about, ...b.about])] });
  }
}

// Vividness: light memories fade within a day, heavy ones over days. Recalling one makes it vivid again.
export function vivid(s, m) {
  const age = (now(s) - ((m.used ?? m.day * 1440 + m.minute))) / 1440;
  const tau = m.w >= HEAVY ? 6 : m.w >= 2 ? 2 : 0.6;
  return m.w * Math.exp(-age / tau);
}

// The memories that come to mind: relevant to who is here and the topic, weighty, recent.
export function recall(s, id, { with: people = [], topic = null, max = 6, mark = true } = {}) {
  const v = actor(s, id);
  if (!v?.mem) return [];
  const scored = v.mem.map((m) => {
    let rel = 0;
    for (const p of people) if (m.about?.includes(p)) rel += 3;
    if (topic && (m.about?.includes(topic) || (typeof topic === "string" && m.text.includes(topic)))) rel += 2;
    return [m, rel + vivid(s, m)];
  }).sort((a, b) => b[1] - a[1]).slice(0, max).map(([m]) => m);
  if (mark) for (const m of scored) m.used = now(s);
  return scored.sort((a, b) => a.day * 1440 + a.minute - (b.day * 1440 + b.minute));
}
export const memLine = (m) => `day ${m.day} ${clock(m.minute)}: ${m.text}`;

// what someone said to her (or she said to them), word for word
export function wordsWith(s, id, other, max = 8) {
  const v = actor(s, id);
  return (v?.mem || []).filter((m) => m.words && (m.about?.includes(other))).slice(-max).map((m) => `day ${m.day} ${clock(m.minute)}: ${m.text}`);
}

// ---------- commitments ----------
// kind: vote | pact | keep_quiet | talk | ask | warn | confront | spread | report | make_peace
//       | recruit | lobby | defend | gift | other
// level: how public it was: 0 whispered, 1 said in company, 2 said at the show / to the crowd
export function commit(s, { by, to, kind, target = null, topic = null, what = null, sincere = true, sincerity = null, heard = [], deadline = null, level = 0, cause, cover = null }) {
  s.ledger ??= [];
  const same = s.ledger.find((c) => c.status === "open" && c.by === by && c.to === to && c.kind === kind && c.target === target);
  if (same) {
    if (what) same.what = what;
    same.heard = [...new Set([...same.heard, ...heard])];
    same.level = Math.max(same.level, level);
    same.repeats = (same.repeats || 1) + 1;
    // said again: whether she means it now is the latest decision (kept with the earlier ones)
    if (sincerity && sincerity !== same.sincerity) { same.sincerities = [...(same.sincerities || [same.sincerity]), sincerity]; same.sincerity = sincerity; same.sincere = sincere; if (cover || sincere) same.cover = sincere ? null : cover; }
    change(s, { who: by, what: "commit", key: same.id, from: "open", to: "open", cause });
    return same;
  }
  const c = {
    id: nextId(s, "c"), by, to, kind, target, topic, what, sincere, sincerity, cover, level, repeats: 1,
    day: s.day, minute: s.minute, deadline: deadline ?? defaultDeadline(s, kind), status: "open",
    heard: [...new Set([to, ...heard].filter(Boolean))], cause,
  };
  s.ledger.push(c);
  change(s, { who: by, what: "commit", key: c.id, from: null, to: "open", cause });
  return c;
}
// votes are due at tonight's (or the next) vote; errands by the end of the next day
function defaultDeadline(s, kind) {
  if (kind === "vote" || kind === "told_vote") return s.day * 1440 + 19 * 60 + 30;
  if (kind === "pact" || kind === "keep_quiet") return null; // standing
  return (s.day + 1) * 1440 + 20 * 60;
}
export const openBy = (s, by, f = () => true) => (s.ledger || []).filter((c) => c.status === "open" && c.by === by && f(c));
export const byId = (s, id) => (s.ledger || []).find((c) => c.id === id);

// status: kept | broken | abandoned | impossible. Anything but kept needs a cause
// (what changed her mind, the stronger goal, the lie from the start, or why it can't be done).
export function settle(s, c, status, why, cause) {
  if (!c || c.status !== "open") return;
  if (status !== "kept" && !cause) violation(s, "settle-without-cause", { c: c.id, status });
  c.status = status; c.why = why || null; c.settledDay = s.day; c.settledMinute = s.minute; c.settleCause = cause || null;
  change(s, { who: c.by, what: "commit", key: c.id, from: "open", to: status, cause: cause || c.cause });
}

export function deedText(s, c, { by = true } = {}) {
  const who = c.target ? nm(s, c.target) : "";
  const top = c.topic ? ` about ${c.topic}` : "";
  const d = {
    vote: `vote out ${who}`, told_vote: `vote out ${who}`, pact: "stick together in a secret pact", keep_quiet: `keep quiet${c.topic ? ` about ${c.topic}` : ""}`,
    ask: `ask ${who}${top}`, warn: `warn ${who}${top}`, confront: `confront ${who}${top}`, spread: `pass it on${top}`, report: `take it to Hesper${top}`,
    threat: `make ${who} regret it`, make_peace: `make peace with ${who}`, recruit: `get ${who} to team up`, lobby: `lobby ${who}${top}`, talk: `talk to ${who}${top}`, defend: `stick up for ${who}`, gift: `bring ${who} something`,
  }[c.kind] || c.what || "do something";
  return by ? `${nm(s, c.by)} said she would ${d}` : d;
}

// What she promised and was promised, for anything she decides or says.
export function commitmentsText(s, id, { with: other = null, max = 6 } = {}) {
  const mine = (s.ledger || []).filter((c) => (c.by === id || c.to === id || (c.heard.includes(id) && c.level >= 1)) && (!other || c.by === other || c.to === other) && (c.status === "open" || s.day - (c.settledDay ?? s.day) <= 2));
  return mine.slice(-max).map((c) => {
    const what = deedText(s, c, { by: false }) + (c.what && !["vote", "told_vote", "pact"].includes(c.kind) ? ` ("${c.what}")` : "");
    const state = c.status === "open" ? "not done yet" : c.status === "kept" ? "kept" : `${c.status}${c.why && c.by === id ? `: ${c.why}` : ""}`;
    if (c.by === id) return `you told ${nm(s, c.to)} you would ${what} (day ${c.day}; ${c.sincere ? "you meant it" : `you were lying${c.cover ? `; your cover story: ${c.cover}` : ""}`}; ${state})`;
    if (c.to === id) return `${nm(s, c.by)} told you she would ${what} (day ${c.day}; ${state})`;
    return `you heard ${nm(s, c.by)} tell ${nm(s, c.to)} she would ${what} (day ${c.day}; ${state})`;
  });
}

// ---------- goals ----------
// kind: survive | sink | protect | ally | guard_secret | expose | win_favor | revenge
export function setGoal(s, v, { kind, target = null, w, why, cause }) {
  v.goals ??= [];
  let g = v.goals.find((x) => x.kind === kind && x.target === target);
  const before = g ? g.w : 0;
  if (!g) { g = { id: nextId(s, "g"), kind, target, w, why, since: s.day }; v.goals.push(g); }
  // nobody stops wanting to stay in the game altogether
  g.w = Math.max(kind === "survive" ? 0.25 : 0, Math.min(3, w)); g.why = why || g.why; g.cause = cause;
  change(s, { who: v.id, what: "goal", key: `${kind}${target ? ":" + target : ""}`, from: before, to: g.w, cause });
  v.goals.sort((a, b) => b.w - a.w);
  return g;
}
export function goalText(s, g) {
  const t = g.target ? nm(s, g.target) : "";
  return { survive: "survive the next vote", sink: `get ${t} voted out`, protect: `protect ${t}`, ally: `win ${t} over as an ally`, guard_secret: "keep her secret from getting out", expose: `expose ${t}`, win_favor: "win the town over", revenge: `get back at ${t}` }[g.kind] || g.kind;
}

// ---------- agenda ----------
// item: { kind, target, rumor, topic, cause: { type: goal|commit|reaction|decision, id }, now, commit }
export function pushAgenda(s, v, item, { front = false } = {}) {
  if (!item.cause?.id) { violation(s, "agenda-without-cause", { v: v.id, kind: item.kind }); return null; }
  v.agenda ??= [];
  const dup = v.agenda.find((x) => x.kind === item.kind && x.target === item.target && (x.rumor || null) === (item.rumor || null));
  if (dup) {
    if (item.commit && !dup.commit) dup.commit = item.commit;
    if (front || item.now) { v.agenda = [dup, ...v.agenda.filter((x) => x !== dup)]; dup.now = dup.now || item.now; }
    return dup;
  }
  const it = { id: nextId(s, "a"), ...item, made: now(s) };
  if (front || item.now) v.agenda.unshift(it); else v.agenda.push(it);
  if (v.agenda.length > 6) {
    const drop = v.agenda.filter((x) => !x.commit).at(-1);
    if (drop) v.agenda = v.agenda.filter((x) => x !== drop);
  }
  change(s, { who: v.id, what: "agenda", key: it.id, from: null, to: it.kind, cause: it.cause.id });
  return it;
}
export function doneAgenda(s, v, it, status, cause) {
  if (!it) return;
  v.agenda = (v.agenda || []).filter((x) => x !== it && x.id !== it.id);
  change(s, { who: v.id, what: "agenda", key: it.id, from: it.kind, to: status, cause });
}

export function agendaText(s, it) {
  const who = it.target ? nm(s, it.target) : "";
  const r = it.rumor && s.rumors[it.rumor] ? `"${s.rumors[it.rumor].text}"` : it.topic || "";
  return ({
    ask: `ask ${who} whether this is true: ${r}`, confront: `confront ${who}${r ? ` about ${r}` : ""}`, warn: `warn ${who}${r ? `: ${r}` : ""}`,
    report: `take this to Hesper: ${r}`, spread: `pass this on: ${r}`, make_peace: `make peace with ${who}`, recruit: `ask ${who} to team up for the vote`,
    lobby: `get ${who} to vote out ${nm(s, it.voteTarget)}`, talk: `talk to ${who}${r ? ` about ${r}` : ""}`, pledge_check: `find out where ${who} stands`,
    defend: `stick up for ${who}`, deny: `set the record straight with ${who}`, post_note: `pin an anonymous note about ${who} on the Whisper board`,
    gift: `bring ${who} a little something`, keep_away: `stay away from ${who}`, find: `find ${who}`,
  }[it.kind] || `${it.kind.replace(/_/g, " ")} ${who}`.trim());
}

// ---------- vote plans ----------
// strength: 1 a passing thought, 1.5 agreed with someone, 2 her own decision or a promise, 2.5 payback
export function planVote(s, v, target, why, { strength = 1, promisedTo = null, cause }) {
  if (!target || target === v.id) return false;
  const cur = v.votePlan;
  if (cur && cur.target !== target && (cur.strength ?? 1.5) > strength + 0.25) {
    v.voteDoubts = [...(v.voteDoubts || []).filter((d) => d.target !== target), { target, why, cause }].slice(-3);
    return false;
  }
  const before = cur?.target || null;
  if (cur && cur.target === target) { cur.strength = Math.min(3, Math.max(cur.strength ?? 1, strength) + 0.25); if (promisedTo) cur.promisedTo = promisedTo; cur.why = cur.why || why; cur.cause = cause; }
  else { v.votePlan = { target, why, strength, promisedTo, day: s.day, cause }; v.voteDoubts = (v.voteDoubts || []).filter((d) => d.target !== target); }
  change(s, { who: v.id, what: "vote_plan", key: "target", from: before, to: target, cause });
  return true;
}
export function dropVotePlan(s, v, cause) {
  if (!v.votePlan) return;
  change(s, { who: v.id, what: "vote_plan", key: "target", from: v.votePlan.target, to: null, cause });
  v.votePlan = null;
}
export function votePlanText(s, v) {
  const p = v.votePlan;
  if (!p) return "undecided";
  const firm = (p.strength ?? 1.5) >= 2.25 ? "firmly mean to" : (p.strength ?? 1.5) >= 1.5 ? "mean to" : "are leaning toward";
  const doubts = (v.voteDoubts || []).map((d) => `${nm(s, d.target)} (${d.why})`);
  return `you ${firm} vote out ${nm(s, p.target)}${p.why ? ` (${p.why})` : ""}${p.promisedTo ? `; you promised ${nm(s, p.promisedTo)}` : ""}${doubts.length ? `; you also considered ${doubts.join(", ")}` : ""}`;
}

export { nm };
