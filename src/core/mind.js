// What each woman carries from moment to moment and day to day. Code keeps these books;
// Jev reads them (through sim.persona and sim.feelings) every time she decides anything.
//
//   feelings  affinity and trust toward everyone, plus the reasons behind them, newest
//             and biggest first. Strong feelings are hard to push further; overnight they
//             ease back toward where they started unless something keeps them there.
//   memory    the day's goings-on (short) and what she never forgets (betrayals, fights,
//             lies, votes, pacts). Overnight the small stuff fades.
//   knowledge rumors with how sure she is and who told her. Hearing it again from someone
//             else makes her surer; unconfirmed hearsay fades.
//   plans     what she means to do, in order. A new plan doesn't wipe out one she promised
//             someone; plans she never gets round to lapse.
//   vote plan who she means to vote out, how firmly, and why. A passing remark doesn't
//             override a promise or a grudge.
//   promises  the town's book of everything anyone said she would do, to whom, and whether
//             she meant it. Each one stays open until it is kept, broken or dropped, and
//             the reason is written down. The player's promises are in it too.
//   talks     what each pair actually said to each other, so the next conversation (and
//             every decision) picks up where the last one left off.

import { clamp, clock, nameOf, first, alive } from "./sim.js";

// ---------- feelings ----------

const MAX_REASONS = 5;
// Change how `a` feels about `b`. Pushing further toward an extreme gets harder; easing off
// is easy. A reason is kept when the change is big enough to matter.
export function shift(s, a, b, { aff = 0, trust = 0, why = null } = {}) {
  const r = s.rel[a]?.[b];
  if (!r) return;
  const ease = (x, d) => d * (1 - Math.max(0, Math.sign(d) * x) / 3.6);
  r.affinity = clamp(r.affinity + ease(r.affinity, aff));
  r.trust = clamp(r.trust + ease(r.trust, trust));
  const weight = Math.abs(aff) + Math.abs(trust) * 0.8;
  if (why && weight >= 0.25) {
    r.why ??= [];
    const same = r.why.find((x) => x.text === why);
    if (same) { same.w += weight; same.day = s.day; same.sign = Math.sign(aff + trust); }
    else r.why.push({ text: why, day: s.day, w: weight, sign: Math.sign(aff + trust) || -1 });
    r.why.sort((p, q) => score(s, q) - score(s, p));
    if (r.why.length > MAX_REASONS) r.why.length = MAX_REASONS;
  }
}
const score = (s, x) => x.w * (1 / (1 + (s.day - x.day) * 0.35));

// "lately: she voted against her (day 2); caught her lying (day 1)"
export function reasonsText(s, r, max = 3) {
  if (!r?.why?.length) return "";
  return r.why.slice(0, max).map((x) => `${x.text} (day ${x.day})`).join("; ");
}

// overnight: feelings ease back toward where they started; old small reasons are let go
function settleFeelings(s) {
  for (const [a, row] of Object.entries(s.rel)) {
    if (s.people[a]?.gone) continue;
    for (const r of Object.values(row)) {
      r.base ??= { affinity: r.affinity, trust: r.trust };
      const hold = (r.why || []).filter((x) => s.day - x.day <= 2).reduce((t, x) => t + x.w, 0); // fresh reasons keep feelings in place
      const k = 0.12 / (1 + hold);
      r.affinity += (r.base.affinity - r.affinity) * k;
      r.trust += (r.base.trust - r.trust) * k * 0.6; // trust comes back slower
      if (r.why) r.why = r.why.filter((x) => x.w >= 0.9 || s.day - x.day <= 3);
    }
  }
}

// ---------- memory ----------

// importance: 1 everyday, 2 notable (a pact, a confrontation, a rumor about her),
// 3 never forgotten (betrayal, a fight, being lied to, the vote).
export function remember(v, s, text, importance = 1) {
  const line = `day ${s.day} ${clock(s.minute)}: ${text}`;
  v.memory.push(line);
  if (v.memory.length > 16) v.memory.splice(0, v.memory.length - 16);
  if (importance >= 2) {
    v.core ??= [];
    v.core.push({ line, imp: importance, day: s.day });
    if (v.core.length > 12) {
      // let go of the least important, oldest first
      const i = v.core.reduce((bi, m, j, arr) => (m.imp < arr[bi].imp || (m.imp === arr[bi].imp && m.day < arr[bi].day) ? j : bi), 0);
      v.core.splice(i, 1);
    }
  }
}
export const lasting = (v, max = 6) => (v.core || []).filter((m) => !v.memory.includes(m.line)).slice(-max).map((m) => m.line);

function sleepOn(v, s) {
  // the day's small talk fades; what mattered stays
  v.memory = v.memory.filter((l) => !/^day \d+ /.test(l) || +l.split(" ")[1] >= s.day - 1).slice(-10);
  if (v.core) v.core = v.core.filter((m) => m.imp >= 3 || s.day - m.day <= 4);
}

// ---------- knowledge ----------

// The root story a retelling came from, so versions of one rumor corroborate each other.
export function rootOf(s, rid) {
  let r = s.rumors[rid], n = 0;
  while (r?.parent && s.rumors[r.parent] && n++ < 20) r = s.rumors[r.parent];
  return r?.id || rid;
}

// She hears a rumor. conf is how much this telling convinces her (0..1). A second,
// independent source makes her surer; the same source again doesn't.
export function hear(s, v, rid, conf, from) {
  const had = v.knows[rid];
  const root = rootOf(s, rid);
  // any version of this story she already heard from someone else?
  const prior = Object.entries(v.knows).find(([id, k]) => id !== rid && k.conf >= 0.3 && rootOf(s, id) === root && k.from !== from);
  let c = conf;
  const sources = new Set([...(had?.sources || (had ? [had.from] : [])), from]);
  if (prior && from !== prior[1].from && conf >= 0.3) c = Math.max(c, 1 - (1 - prior[1].conf) * (1 - conf * 0.8));
  if (had && !(had.sources || [had.from]).includes(from) && conf >= 0.3 && had.conf >= 0.3) c = Math.max(c, 1 - (1 - had.conf) * (1 - conf * 0.8));
  if (had && c <= had.conf) { had.sources = [...sources]; return { before: had.conf, after: had.conf }; }
  v.knows[rid] = { conf: Math.min(1, c), from: had && had.conf >= c ? had.from : from, day: s.day, time: clock(s.minute), sources: [...sources] };
  return { before: had?.conf || 0, after: v.knows[rid].conf };
}

function fadeHearsay(v) {
  for (const k of Object.values(v.knows)) if (k.from !== "self" && k.conf < 0.9) k.conf *= 0.93;
}

// ---------- plans ----------

const samePlan = (p, q) => p && q && p.kind === q.kind && p.target === q.target && (p.rumor || null) === (q.rumor || null);

// Returns false when she already means to do it.
export function queuePlan(s, v, plan) {
  if (samePlan(v.intent, plan) || (v.plans || []).some((p) => samePlan(p, plan))) return false;
  v.plans ??= [];
  if (v.intent) {
    // what she promised someone, or meant to do right away, stays first
    const keep = v.intent.promisedTo || v.intent.now;
    if (keep && !plan.now) { v.plans.unshift({ ...plan, made: `day ${s.day} ${clock(s.minute)}`, day: s.day }); trim(v); return true; }
    v.plans.unshift(v.intent);
  }
  v.intent = { ...plan, made: `day ${s.day} ${clock(s.minute)}`, day: s.day };
  trim(v);
  return true;
}
function trim(v) { if (v.plans.length > 3) v.plans.length = 3; }

export function nextPlan(v) { v.intent = v.plans?.shift() || null; }

// drop plans aimed at someone who is gone
export function prunePlans(s, v) {
  const ok = (p) => !p.target || p.target === "player" ? !(p.target === "player" && s.player.out) : !!s.people[p.target] && !s.people[p.target].gone;
  for (const p of [v.intent, ...(v.plans || [])]) if (p && !ok(p) && p.commit) settle(s, byId(s, p.commit), "dropped", `${nameOf(s, p.target)} left town`);
  v.plans = (v.plans || []).filter(ok);
  if (v.intent && !ok(v.intent)) nextPlan(v);
}

function lapsePlans(s, v, lapsed) {
  const old = (p) => s.day - (p.day ?? s.day) >= (p.promisedTo ? 2 : 1);
  for (const p of [v.intent, ...(v.plans || [])].filter(Boolean).filter(old)) lapsed.push([v, p]);
  v.plans = (v.plans || []).filter((p) => !old(p));
  if (v.intent && old(v.intent)) nextPlan(v);
}

// ---------- vote plans ----------

// strength: 1 a passing thought, 1.5 agreed with someone, 2 her own decision or a promise,
// 2.5 payback for something done to her.
export function planVote(s, v, target, why, { strength = 1, promisedTo = null } = {}) {
  if (!target || target === v.id) return false;
  const cur = v.votePlan;
  if (cur && cur.target !== target && (cur.strength ?? 1.5) > strength + 0.25) {
    v.voteDoubts = [...(v.voteDoubts || []).filter((d) => d.target !== target), { target, why }].slice(-3);
    return false;
  }
  if (cur && cur.target === target) { cur.strength = Math.max(cur.strength ?? 1, strength) + 0.25; if (promisedTo) cur.promisedTo = promisedTo; cur.why = cur.why || why; return true; }
  v.votePlan = { target, why, strength, promisedTo, day: s.day };
  v.voteDoubts = (v.voteDoubts || []).filter((d) => d.target !== target);
  return true;
}

export function votePlanText(s, v) {
  const p = v.votePlan;
  if (!p) return "undecided";
  const firm = (p.strength ?? 1.5) >= 2.25 ? "firmly means to" : (p.strength ?? 1.5) >= 1.5 ? "means to" : "is leaning toward";
  const doubts = (v.voteDoubts || []).map((d) => `${nameOf(s, d.target)} (${d.why})`);
  return `${firm} vote out ${nameOf(s, p.target)}${p.why ? ` (${p.why})` : ""}${p.promisedTo ? `; promised ${nameOf(s, p.promisedTo)}` : ""}${doubts.length ? `; also considered ${doubts.join(", ")}` : ""}`;
}

// Who she has reason to think is coming for her.
export function threatsTo(s, v) {
  const out = new Map();
  for (const [rid, k] of Object.entries(v.knows)) {
    const r = s.rumors[rid];
    if (k.conf < 0.4 || r.kind !== "vote" || r.target !== v.id) continue;
    out.set(r.about, `heard ${nameOf(s, r.about)} wants her out`);
  }
  for (const rec of (s.votes || []).slice(-2)) for (const [voter, t] of Object.entries(rec.ballots)) if (t === v.id && voter !== v.id && (voter === "player" || !s.people[voter]?.gone)) out.set(voter, `${nameOf(s, voter)} voted against her on day ${rec.day}`);
  return out;
}

// ---------- promises ----------

// Anyone ("player" included) says she will do something. kind: vote, told_vote, pact, or a
// plan kind (ask, warn, confront, spread, report, make_peace, recruit, lobby, talk, other).
export function commit(s, { by, to, kind, target = null, rumor = null, what = null, sincere = true, heard = [] }) {
  s.ledger ??= [];
  const same = s.ledger.find((c) => c.status === "open" && c.by === by && c.to === to && c.kind === kind && c.target === target);
  if (same) { if (what) same.what = what; same.heard = [...new Set([...same.heard, ...heard])]; return same; } // a lie stays a lie when it's repeated
  const c = { id: "c" + (s.ledger.length + 1), by, to, kind, target, rumor, what, sincere, day: s.day, time: clock(s.minute), status: "open", heard: [...new Set([to, ...heard].filter(Boolean))] };
  s.ledger.push(c);
  return c;
}
export const openBy = (s, by, f = () => true) => (s.ledger || []).filter((c) => c.status === "open" && c.by === by && f(c));
export const byId = (s, id) => (s.ledger || []).find((c) => c.id === id);

// status: kept | broken | dropped
export function settle(s, c, status, why = null) {
  if (!c || c.status !== "open") return;
  c.status = status; c.why = why; c.settledDay = s.day;
}

export function deedText(s, c, { by = true } = {}) {
  const who = c.target ? nameOf(s, c.target) : "";
  const d = {
    vote: `vote out ${who}`, told_vote: `she's voting for ${who}`, pact: "stick together in a secret pact",
    ask: `ask ${who} about it`, warn: `warn ${who}`, confront: `confront ${who}`, spread: "pass the story on", report: "take it to Hesper",
    make_peace: `make peace with ${who}`, recruit: `get ${who} to team up`, lobby: `lobby ${who}`, talk: `go and talk to ${who}`,
  }[c.kind] || c.what || "do something";
  return by ? `${nameOf(s, c.by)} said she would ${c.kind === "told_vote" ? `vote out ${who}` : d}` : d;
}

// What she promised and what she was promised, for everything she decides.
export function commitmentsText(s, id, { with: other = null, max = 5 } = {}) {
  const mine = (s.ledger || []).filter((c) => (c.by === id || c.to === id) && (!other || c.by === other || c.to === other) && (c.status === "open" || s.day - (c.settledDay ?? s.day) <= 2));
  return mine.slice(-max).map((c) => {
    const what = deedText(s, c, { by: false }) + (c.what && !["vote", "told_vote", "pact"].includes(c.kind) ? ` ("${c.what}")` : "");
    const state = c.status === "open" ? "not done yet" : c.status === "kept" ? "kept" : c.status === "broken" ? `broken${c.why ? `: ${c.why}` : ""}` : `dropped${c.why ? `: ${c.why}` : ""}`;
    if (c.by === id) return `she told ${nameOf(s, c.to)} she would ${what} (day ${c.day}; ${c.sincere ? "she meant it" : "she was lying"}; ${state})`;
    return `${nameOf(s, c.by)} told her she would ${what} (day ${c.day}; ${state})`;
  });
}

// ---------- what was actually said ----------

// lines: [{ who: id, text }]. Kept on both sides (the player's side lives on the woman).
export function logTalk(s, a, b, lines) {
  if (!lines?.length) return;
  for (const [me, other] of [[a, b], [b, a]]) {
    const v = s.people[me];
    if (!v) continue;
    v.talks ??= {};
    const log = (v.talks[other] ??= []);
    for (const l of lines) log.push({ day: s.day, time: clock(s.minute), who: l.who, text: l.text });
    if (log.length > 14) log.splice(0, log.length - 14);
  }
}
export function talkText(s, v, other, max = 8, { skip = 0 } = {}) {
  const log = v.talks?.[other] || [];
  return log.slice(0, log.length - skip).slice(-max).map((l) => `day ${l.day} ${l.time} ${l.who === "player" ? s.player.name : nameOf(s, l.who).split(" ")[0]}: ${l.text}`);
}

// ---------- the night ----------

const planFor = (s, c) => { const v = s.people[c.by]; return v && [v.intent, ...(v.plans || [])].some((p) => p?.commit === c.id); };

export function sleep(s) {
  const lapsed = [];
  for (const v of alive(s)) {
    sleepOn(v, s);
    fadeHearsay(v);
    prunePlans(s, v);
    lapsePlans(s, v, lapsed);
    v.mood.anger *= 0.5; v.mood.fear *= 0.6; v.mood.cheer += (1 - v.mood.cheer) * 0.5;
    if (v.mood.why) v.mood.why = null;
    if (v.votePlan) v.votePlan.strength = Math.max(0.75, (v.votePlan.strength ?? 1.5) - 0.25); // resolve softens unless renewed
  }
  settleFeelings(s);
  for (const [v, p] of lapsed) if (p.promisedTo) {
    // a reason, if there is one: she fell out with whoever she promised
    const fell = p.promisedTo && s.rel[v.id]?.[p.promisedTo]?.affinity < -1;
    settle(s, byId(s, p.commit), "broken", fell ? `she fell out with ${nameOf(s, p.promisedTo)}` : "she never got round to it");
    remember(v, s, `never got round to what I told ${nameOf(s, p.promisedTo)} I'd do`, 2);
  }
  // promises with nothing to carry them (an offhand "I'll talk to her") lapse after two days
  for (const c of s.ledger || []) if (c.status === "open" && !["vote", "told_vote", "pact"].includes(c.kind) && s.day - c.day >= 2 && !planFor(s, c)) settle(s, c, "broken", c.by === "player" ? "never followed up" : "she never got round to it");
  return lapsed;
}

// ---------- mood ----------

export function stir(v, { anger = 0, fear = 0, cheer = 0, why = null } = {}) {
  v.mood.anger = Math.max(0, Math.min(3, v.mood.anger + anger));
  v.mood.fear = Math.max(0, Math.min(3, v.mood.fear + fear));
  v.mood.cheer = Math.max(0, Math.min(3, v.mood.cheer + cheer));
  if (why && (anger >= 0.5 || fear >= 0.5 || Math.abs(cheer) >= 0.5)) v.mood.why = why;
}

export { first };
