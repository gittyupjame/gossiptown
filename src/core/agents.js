// What each woman is trying to do, and what she does next. No schedules: her day is built
// from her goals, her commitments and what just happened to her.
//
//   goals     seeded from who she is and the record, re-weighed by Jev every in-game hour
//   agenda    what she means to do next, each item citing a goal, a commitment or a reaction
//   next      when she is free (not walking, not talking, done lingering) Jev picks her next
//             move from her view: follow up an agenda item, talk to someone in front of her
//             (always for a reason she has), go somewhere, or stay a while
//   hourly    one batched Jev call per woman reconsiders her goals, her vote and whether to
//             keep each promise; a broken or dropped promise is settled with that decision as
//             its cause

import * as R from "./record.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import * as T from "./talk.js";
import { view, placeName, inSight, standing } from "./views.js";
import { PLACES, SHOW } from "./cast.js";
import { spotIn, anchor, pos, travelMinutes, dist } from "./space.js";
import { homeDoor } from "../client/layout.js";

const nm = M.nm;
const isWoman = (s, id) => !!s.people[id] && !s.people[id].gone;
const present = (s, id) => (id === "player" ? !s.player.out : isWoman(s, id));
export const alive = (s) => Object.values(s.people).filter((v) => !v.gone);
const BOARD_PLACES = ["plaza", "salon"];

// ---------- goals ----------
export function seedGoals(s, v, cause) {
  M.setGoal(s, v, { kind: "survive", w: 1.5 + v.bias.scheme * 0.5, why: "nobody wants to go home", cause });
  const worst = Object.entries(s.rel[v.id]).filter(([id]) => id !== "player").sort((a, b) => a[1].affinity - b[1].affinity)[0];
  if (worst && worst[1].affinity <= -1) M.setGoal(s, v, { kind: "sink", target: worst[0], w: 1 + Math.abs(worst[1].affinity) * 0.4, why: worst[1].note, cause });
  const best = Object.entries(s.rel[v.id]).filter(([id]) => id !== "player").sort((a, b) => b[1].affinity - a[1].affinity)[0];
  if (best && best[1].affinity >= 1.5) M.setGoal(s, v, { kind: "protect", target: best[0], w: 0.8 + v.bias.loyalty, why: best[1].note, cause });
  if (B.secretOf(s, v.id)) M.setGoal(s, v, { kind: "guard_secret", w: 0.8 + (1 - v.bias.nerve) * 0.6, why: "if it gets out she's finished", cause });
  if (v.bias.scheme >= 0.7) M.setGoal(s, v, { kind: "win_favor", w: 0.9, why: "well-liked women win these shows", cause });
}

// ---------- moving ----------
export function travel(s, v, dest, cause, ui) {
  if (dest === v.location || (!PLACES[dest] && dest !== "home")) return false;
  const from = pos(s, v.id) || anchor(v.id, v.location);
  const destSpot = dest === "home" ? homeDoor(v.id) : spotIn(s, dest, { avoid: alive(s).filter((o) => o.location === dest).map((o) => o.spot) });
  const mins = travelMinutes(from, destSpot);
  v.prev = v.location;
  v.location = "lane"; v.dest = dest; v.from = from; v.destSpot = destSpot; v.leftAt = R.now(s); v.arrive = R.now(s) + mins; v.goCause = cause;
  (v.trail ??= []).push({ loc: "lane", at: R.now(s), to: dest, eta: v.arrive });
  if (v.trail.length > 40) v.trail.shift();
  ui?.moved?.(v);
  return true;
}
export function arrivals(s, ui) {
  for (const v of alive(s)) {
    if (v.location !== "lane" || R.now(s) < v.arrive) continue;
    v.location = v.dest; v.spot = v.dest === "home" ? null : v.destSpot; v.dest = null;
    v.until = R.now(s) + 10;
    v.trail.push({ loc: v.location, at: R.now(s) });
    R.emit(s, { type: "arrive", actor: v.id, place: v.location, content: {}, cause: v.goCause || "rule:clock" });
    ui?.arrived?.(v);
  }
}
// instantly, at the start of a day or a gathering announced to everyone
export function place(s, v, loc, cause, { at = null } = {}) {
  v.location = loc; v.dest = null;
  v.spot = loc === "home" ? null : at || spotIn(s, loc, { avoid: alive(s).filter((o) => o.location === loc && o !== v).map((o) => o.spot) });
  (v.trail ??= []).push({ loc, at: R.now(s), jump: cause });
  if (v.trail.length > 40) v.trail.shift();
}

// ---------- what she does next ----------
// keyed by the woman's own state object, so a new season (or a loaded one) starts clear
const running = new WeakSet();
export function idle(s, v) {
  return !v.gone && v.location !== "lane" && !T.busy(s, v.id) && !running.has(v) && R.now(s) >= (v.until || 0) && v.id !== s.player.talkingTo;
}

export async function next(s, v, ui) {
  running.add(v);
  try { await decideNext(s, v, ui); } finally { running.delete(v); }
}

// where she thinks someone is: in sight, where she last saw her, or where she works
export function whereIs(s, v, id) {
  if (id === "player") {
    const seen = [...(v.mem || [])].reverse().find((m) => m.ev && m.about?.includes("player"));
    return inSight(s, v.id).includes("player") ? s.player.location : seen ? R.evById(s, seen.ev)?.place || "plaza" : "plaza";
  }
  if (inSight(s, v.id).includes(id)) return s.people[id].location === "lane" ? s.people[id].dest : s.people[id].location;
  const seen = [...(v.mem || [])].reverse().find((m) => m.ev && m.about?.includes(id));
  const ev = seen && R.evById(s, seen.ev);
  if (ev?.place && PLACES[ev.place] && R.now(s) - (ev.day * 1440 + ev.minute) < 180) return ev.place;
  const o = s.people[id];
  return o?.employed && s.minute < 16 * 60 ? o.work : "plaza";
}

// the best reason she has to talk to someone right now, from her own state
export function reasonFor(s, v, o) {
  const it = (v.agenda || []).find((x) => x.target === o);
  if (it) return { why: `you mean to ${M.agendaText(s, it)}`, w: 6, agenda: it };
  const r = s.rel[v.id][o] || M.newRel(0, 0);
  const aboutO = Object.entries(v.knows).find(([rid, k]) => k.conf >= 0.45 && s.rumors[rid].about === o && (s.rumors[rid].harm || 0) <= -0.8);
  if (aboutO) return { why: `you heard something about her: ${s.rumors[aboutO[0]].text}`, w: 1 + v.bias.nosy + v.bias.temper * 0.5 };
  if ((r.debt || 0) <= -0.6) return { why: "she owes you a favor", w: 0.8 + v.bias.scheme };
  if ((r.debt || 0) >= 0.6) return { why: "you owe her one", w: 0.4 + v.bias.loyalty * 0.5 };
  const juicy = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid].about !== o && s.rumors[rid].about !== v.id && Math.abs(s.rumors[rid].harm || 0) >= 0.8 && s.day - (s.rumors[rid].day || s.day) <= 1).length;
  if (juicy && r.affinity >= 0.3) return { why: "you have news she'd want to hear", w: 0.5 + v.bias.gossip * 1.2 };
  const voteDay = s.minute >= 11 * 60;
  if (voteDay && v.bias.scheme >= 0.5) return { why: "the vote is coming and you want to know where she stands", w: 0.4 + v.bias.scheme * (o === "player" ? 1 : 0.7) };
  if (o === "player" && s.looks?.[v.id] && !s.looks[v.id].said && Math.abs(s.looks[v.id].verdict - 2) >= 1) return { why: "you have an opinion about her outfit", w: 0.4 + (s.looks[v.id].vain || 0.3) };
  if (r.affinity >= 1) return { why: "she's a friend and you feel like a chat", w: 0.3 + v.bias.social * 0.5 };
  if (r.affinity <= -1 && v.bias.temper >= 0.6) return { why: "she gets under your skin", w: v.bias.temper * 0.5 };
  return null;
}

async function decideNext(s, v, ui) {
  const crit = {}, prior = {}, meta = {};
  const add = (k, text, p, m) => { if (!(p > 0)) return; crit[k] = text; prior[k] = p; meta[k] = m; };
  const hour = s.minute / 60;
  const here = inSight(s, v.id).filter((id) => present(s, id) && dist(s, v.id, id) <= 14 && !T.busy(s, id) && (id !== "player" || (!s.player.talkingTo && !s.player.out)));
  // follow up what she means to do (commitments first)
  for (const it of (v.agenda || []).slice(0, 3)) {
    const w = it.commit ? 7 : it.now ? 12 : 3.5;
    if (it.target && here.includes(it.target)) add(`do_${it.id}`, `Go and ${M.agendaText(s, it)} now (she's right here)`, w * 1.6, { kind: "talk", to: it.target, agenda: it });
    else if (it.target && present(s, it.target)) add(`find_${it.id}`, `Go and find ${nm(s, it.target)} to ${M.agendaText(s, it)}`, w, { kind: "find", target: it.target, agenda: it });
    else if (!it.target && (it.kind === "spread" || it.kind === "deny")) {
      for (const o of here.filter((x) => x !== "player" || it.kind === "spread")) add(`tell_${it.id}_${o}`, `${it.kind === "spread" ? "Pass it on to" : "Set the record straight with"} ${nm(s, o)}`, w * 0.6 * (1 + Math.max(0, s.rel[v.id][o]?.trust || 0) * 0.3), { kind: "talk", to: o, agenda: it });
      if (!here.length) add(`go_tell_${it.id}`, "Go where people are, to pass it on", w * 0.5, { kind: "go", place: s.minute >= 15 * 60 ? "tavern" : "plaza", agenda: it });
    } else if (it.kind === "post_note") add(`note_${it.id}`, `Pin an anonymous note about ${nm(s, it.target)} on the Whisper board`, w, { kind: "post_note", agenda: it });
  }
  // somebody right in front of her, for a reason she has
  for (const o of here) {
    const r = reasonFor(s, v, o);
    if (!r || r.agenda) continue;
    add(`talk_${o}`, `Talk to ${nm(s, o)} (${r.why})`, r.w * (0.4 + v.bias.social * 0.6) * (o === "player" ? 0.6 + v.bias.nerve * 0.6 : 1), { kind: "talk", to: o, reason: r.why });
  }
  // the board
  const unread = (s.notes || []).filter((n) => s.day - n.day <= 1 && !n.readBy.includes(v.id));
  if (unread.length && BOARD_PLACES.includes(v.location)) add("read_board", "Read the anonymous notes on the Whisper board", 0.6 + v.bias.nosy * 1.5, { kind: "read_board" });
  // somewhere else
  for (const [k, p] of Object.entries(PLACES)) {
    if (k === v.location || k === "firepit") continue;
    let w = k === v.work ? (hour < 16 && v.employed ? 2.2 : 0.3) : ["plaza", "tavern", "salon", "bakery", "market"].includes(k) ? 0.25 + v.bias.social * 0.45 : 0.15;
    if (k === "tavern" && hour >= 16) w += 0.7;
    if (k === "dock" && v.mood.anger + v.mood.fear >= 1.8) w += 0.9;
    add(`go_${k}`, `Go to ${p.name}${k === v.work ? " (where she works)" : ""}`, w, { kind: "go", place: k });
  }
  if (v.location !== "home") add("home", "Go home for a while", (v.bias.social < 0.4 ? 0.35 : 0.08) + (v.mood.cheer < 0.5 ? 0.3 : 0), { kind: "go", place: "home" });
  add("stay", `Stay at ${placeName(v.location)} a while`, 3 + (v.location === v.work && hour < 16 ? 2 : 0), { kind: "stay" });
  const moment = `It's ${M.clock(s.minute)}. You're at ${placeName(v.location)}${here.length ? ` with ${here.map((x) => nm(s, x)).join(", ")} nearby` : ""}. What do you do next?`;
  const a = await R.decide(s, v.id, view(s, v.id, { with: here.slice(0, 3), moment, small: true }), {
    next: { type: "choice", instructions: `It is ${M.clock(s.minute)}. What does ${v.name.split(" ")[0]} do next? She follows through on what she said she'd do, acts on what's eating her, and otherwise goes about her day the way this woman really would.`, criteria: crit, prior },
  }, `next:${v.id}`, v.goCause && /^[ed]\d+$/.test(v.goCause) ? v.goCause : "rule:clock", (o) => crit[o.next.pick]?.toLowerCase());
  if (v.gone || T.busy(s, v.id) || v.location === "lane") return;
  const pick = a.next.pick, m = meta[pick];
  // items she could have done but didn't: a stronger pull won (kept as the cause if one lapses)
  for (const k of Object.keys(meta)) if (k !== pick && meta[k].agenda) meta[k].agenda.skippedBy = a._id;
  if (!m) return;
  if (m.kind === "stay") { v.until = R.now(s) + 20; return; }
  if (m.kind === "go") { travel(s, v, m.place, a._id, ui); return; }
  if (m.kind === "find") { const where = whereIs(s, v, m.target); if (where && where !== v.location) travel(s, v, where, a._id, ui); else v.until = R.now(s) + 15; return; }
  if (m.kind === "read_board") { await ui?.readBoard?.(v, a._id); v.until = R.now(s) + 10; return; }
  if (m.kind === "post_note") { await ui?.postBoard?.(v, m.agenda, a._id); return; }
  if (m.kind === "talk") {
    const reason = m.agenda ? `you meant to ${M.agendaText(s, m.agenda)}` : m.reason;
    const t = T.open(s, v.id, m.to, { reason, cause: a._id, agenda: m.agenda?.id || null, ui });
    if (!t) v.until = R.now(s) + 10;
  }
}

// ---------- every in-game hour ----------
export async function reconsider(s, v, ui) {
  const qs = {};
  // hearing she's a target makes staying in the game matter more than anything
  const targeted = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.45 && s.rumors[rid].prop?.pred === "votes_for" && s.rumors[rid].prop.obj === v.id && (s.rumors[rid].prop.pol ?? 1) === 1 && present(s, s.rumors[rid].about) && s.day - (s.rumors[rid].day || s.day) <= 1).length;
  for (const g of (v.goals || []).slice(0, 5)) qs[`g_${g.id}`] = { type: "score", instructions: `How much does she care right now about: ${M.goalText(s, g)}?`, criteria: ["Not at all", "A little", "Somewhat", "A lot", "It's everything"], prior: Math.min(4, g.kind === "survive" && targeted ? Math.max(g.w * 1.3, 3.3 + targeted * 0.3) : g.w * 1.3) };
  // new goals the record suggests
  const st = standing(s, v.id);
  const sug = [];
  const worst = Object.entries(s.rel[v.id]).filter(([id]) => present(s, id)).sort((a, b) => a[1].affinity - b[1].affinity)[0];
  if (worst && worst[1].affinity <= -1.2 && !(v.goals || []).some((g) => g.kind === "sink" && g.target === worst[0])) sug.push({ kind: "sink", target: worst[0], why: M.reasonsText(s, worst[1], 1) || worst[1].note });
  for (const t of st.threats) if (!(v.goals || []).some((g) => g.kind === "revenge" && g.target === t) && v.bias.temper + v.bias.scheme > 1) sug.push({ kind: "revenge", target: t, why: st.threatWhy[t] });
  if (st.allies.length === 0 && !(v.goals || []).some((g) => g.kind === "ally")) {
    const cand = Object.entries(s.rel[v.id]).filter(([id]) => present(s, id) && !st.threats.includes(id)).sort((a, b) => b[1].affinity + b[1].trust - (a[1].affinity + a[1].trust))[0];
    if (cand) sug.push({ kind: "ally", target: cand[0], why: "you have nobody in your corner" });
  }
  sug.slice(0, 2).forEach((g, i) => { qs[`new${i}`] = { type: "noul", instructions: `Does she make it a goal to ${M.goalText(s, g)}? (${g.why})`, prior: g.kind === "ally" ? 0.4 + v.bias.scheme * 0.4 : 0.3 + v.bias.scheme * 0.3 }; });
  // her vote, if anything has happened since she last thought about it
  const cands = T.candidates(s, v.id);
  const last = [...(s.decisions || [])].reverse().find((d) => d.actor === v.id && d.label.startsWith("hourly:") && d.q.vote);
  const fresh = !last || (s.trace || []).some((c) => c.who === v.id && (c.what === "rel" || c.what === "belief") && (c.day * 1440 + c.minute) > (last.day * 1440 + last.minute) && !/^rule:/.test(c.cause));
  if (fresh && cands.length) {
    const prior = {};
    for (const id of cands) prior[id] = Math.max(0.05, 0.5 + Math.max(0, -(s.rel[v.id][id]?.affinity ?? 0)) * 1.4 + Math.max(0, -(s.rel[v.id][id]?.trust ?? 0)) * 0.5 + (v.votePlan?.target === id ? 2 + (v.votePlan.strength ?? 1.5) * 1.5 : 0) + (st.threats.includes(id) ? 1.5 : 0) - (st.allies.includes(id) ? 1.5 * v.bias.loyalty : 0) + ((v.goals || []).some((g) => (g.kind === "sink" || g.kind === "revenge") && g.target === id) ? 1.2 : 0) - ((v.goals || []).some((g) => g.kind === "protect" && g.target === id) ? 2 : 0));
    prior.undecided = v.votePlan ? 0.3 : 1.5;
    qs.vote = { type: "choice", instructions: `Thinking it over, who does she mean to vote out at the next vote? She doesn't flip without a reason.`, criteria: { ...Object.fromEntries(cands.map((id) => [id, nm(s, id)])), undecided: "Hasn't decided" }, prior };
  }
  // whether to keep each open promise
  const open = M.openBy(s, v.id, (c) => c.status === "open" && c.kind !== "other");
  // she only weighs going back on her word when something pulls at it: bad blood with the
  // woman she promised, a soft spot for the one she promised to vote out, or news about either
  // since she said it
  const asked = [];
  for (const c of open.filter((c) => !c.wavered).slice(0, 4)) {
    const toRel = c.to === "player" ? s.rel[v.id].player : s.rel[v.id][c.to];
    const pressure = (toRel ? Math.max(0, -toRel.affinity) * 0.15 + Math.max(0, -toRel.trust) * 0.1 : 0) + (c.kind === "vote" && c.target && (s.rel[v.id][c.target]?.affinity ?? 0) > 0.8 ? 0.25 : 0) + (st.threats.includes(c.to) ? 0.3 : 0);
    const since = c.day * 1440 + c.minute;
    const stirred = (s.trace || []).some((x) => x.who === v.id && (x.what === "rel" || x.what === "belief") && (x.day * 1440 + x.minute) > since && !/^rule:/.test(x.cause) && [c.to, c.target].some((o) => o && (x.what === "rel" ? String(x.key).startsWith(o + ".") : s.rumors[x.key]?.about === o)));
    if (pressure < 0.15 && !stirred) continue;
    asked.push(c);
    qs[`keep_${c.id}`] = { type: "noul", instructions: `She told ${nm(s, c.to)} she would ${M.deedText(s, c, { by: false })}${c.level >= 2 ? ", in front of the whole town" : c.level === 1 ? ", with others listening" : ", privately"}${c.repeats > 1 ? `, and said it ${c.repeats} times` : ""}. Does she still mean to?`, prior: Math.max(0.03, Math.min(0.98, (c.sincere ? 0.86 : 0.12) + c.level * 0.08 + Math.min(0.12, (c.repeats - 1) * 0.04) + v.bias.loyalty * 0.08 - pressure * 0.8)) };
  }
  if (!Object.keys(qs).length) return;
  const a = await R.decide(s, v.id, view(s, v.id, { moment: `It's ${M.clock(s.minute)}. You take a moment to think about where things stand.` }), qs, `hourly:${v.id}`, "rule:hourly", (o) => [o.vote ? `means to vote out ${o.vote.pick === "undecided" ? "nobody yet" : nm(s, o.vote.pick)}` : null, ...asked.filter((c) => o[`keep_${c.id}`] && !o[`keep_${c.id}`].yes && !(c.kind === "vote" && o.vote?.pick === c.target)).map((c) => `decided not to ${M.deedText(s, c, { by: false })}`)].filter(Boolean).join("; "));
  if (v.gone) return;
  for (const g of (v.goals || []).slice(0, 5)) if (a[`g_${g.id}`]) M.setGoal(s, v, { kind: g.kind, target: g.target, w: a[`g_${g.id}`].value * 0.75, why: g.why, cause: a._id });
  sug.slice(0, 2).forEach((g, i) => { if (a[`new${i}`]?.yes) { M.setGoal(s, v, { kind: g.kind, target: g.target, w: 1.6, why: g.why, cause: a._id }); goalAgenda(s, v, g, a._id); } });
  if (a.vote && a.vote.pick !== "undecided" && a.vote.pick !== v.votePlan?.target) M.planVote(s, v, a.vote.pick, M.reasonsText(s, s.rel[v.id][a.vote.pick], 1) || "thought it over", { strength: 1.5, cause: a._id });
  for (const c of asked) {
    const k = a[`keep_${c.id}`];
    if (!k || k.yes || c.status !== "open") continue;
    if (c.kind === "vote" && a.vote?.pick === c.target) continue; // she just decided to vote that way anyway
    const why = c.sincere ? "changed her mind" : "never meant it";
    // a vote pledge is settled by her ballot at the reveal, in front of everyone; until then
    // she has only gone off it in her head
    if (c.kind === "vote") {
      c.wavered = { decision: a._id, why, day: s.day, minute: s.minute };
      R.change(s, { who: v.id, what: "commit", key: c.id, from: "open", to: "wavering", cause: a._id });
      if (v.votePlan?.target === c.target && v.votePlan.promisedTo === c.to) { v.votePlan.promisedTo = null; v.votePlan.strength = 1; }
      continue;
    }
    M.settle(s, c, c.kind === "vote" || c.kind === "pact" ? "broken" : "abandoned", why, a._id);
    if (c.kind === "vote" && v.votePlan?.target === c.target && v.votePlan.promisedTo === c.to) { v.votePlan.promisedTo = null; v.votePlan.strength = 1; }
    if (c.kind === "pact") leavePact(s, v.id, c.to, a._id);
    const it = (v.agenda || []).find((x) => x.commit === c.id);
    if (it) M.doneAgenda(s, v, it, "dropped", a._id);
  }
}

function goalAgenda(s, v, g, cause) {
  if (g.kind === "ally" && g.target) M.pushAgenda(s, v, { kind: "recruit", target: g.target, cause: { type: "goal", id: cause } });
  if (g.kind === "sink" && g.target && v.bias.deceit >= 0.6 && v.bias.scheme >= 0.6) M.pushAgenda(s, v, { kind: "post_note", target: g.target, cause: { type: "goal", id: cause } });
  if (g.kind === "revenge" && g.target) M.pushAgenda(s, v, { kind: "confront", target: g.target, cause: { type: "goal", id: cause } });
}

export function leavePact(s, id, with_, cause) {
  for (const al of s.alliances.filter((x) => x.members.includes(id) && x.members.includes(with_))) {
    al.loyal ??= {}; al.loyal[id] = false;
    (al.history ??= []).push({ day: s.day, minute: s.minute, what: `${id} stopped meaning it`, cause });
    R.change(s, { who: id, what: "alliance", key: al.id, from: "member", to: "disloyal", cause });
  }
}

// ---------- arcs ----------
// Who she is only changes through heavy events: the second betrayal hardens her (less
// trusting and loyal, more calculating), logged with the betrayal that did it.
export function betrayed(s, id, cause) {
  const v = s.people[id];
  if (!v || v.gone) return null;
  v.betrayals = (v.betrayals || 0) + 1;
  if (v.betrayals < 2 || v.hardened >= 2) return null;
  v.hardened = (v.hardened || 0) + 1;
  const arc = { day: s.day, minute: s.minute, what: "hardened after being betrayed", cause, from: { ...v.bias } };
  const set = (k, x) => { const before = v.bias[k]; v.bias[k] = Math.max(0, Math.min(1, +(before + x).toFixed(2))); R.change(s, { who: id, what: "trait", key: k, from: before, to: v.bias[k], cause }); };
  set("loyalty", -0.15); set("scheme", 0.1); set("nerve", 0.05);
  arc.to = { ...v.bias };
  (v.arcs ??= []).push(arc);
  M.note(s, id, `I have been betrayed twice now. I am done trusting people so easily.`, { w: 4, cause, about: [id] });
  return arc;
}

// ---------- overnight ----------
// Commitments whose moment has passed are closed with a cause; feelings and moods settle.
export function lapse(s) {
  for (const c of s.ledger || []) {
    if (c.status !== "open" || c.deadline == null || R.now(s) < c.deadline) continue;
    if (["vote", "told_vote"].includes(c.kind)) continue; // settled at the ballot
    if (c.target && !present(s, c.target)) { M.settle(s, c, "impossible", `${nm(s, c.target)} left town`, s.votes.at(-1)?.ev || "rule:elimination"); continue; }
    if (c.by === "player") { M.settle(s, c, "broken", "never followed up", "rule:deadline"); continue; }
    const v = s.people[c.by];
    const it = v?.agenda?.find((x) => x.commit === c.id);
    if (!c.sincere) M.settle(s, c, "broken", "she never meant it", c.sincerity || c.cause);
    else M.settle(s, c, "abandoned", it?.skippedBy ? "something else always came first" : "she never got round to it", it?.skippedBy || c.sincerity || "rule:deadline");
    if (it) M.doneAgenda(s, v, it, "lapsed", c.settleCause);
  }
  // agenda items nothing carries any more go stale after a day
  for (const v of alive(s)) for (const it of [...(v.agenda || [])]) if (!it.commit && R.now(s) - it.made > 1440) M.doneAgenda(s, v, it, "stale", "rule:stale");
}
