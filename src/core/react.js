// Living reactions. Every committed line or event starts a reaction round: one Jev request
// per woman who perceived it, holding every question it raises for her (believe it? sense a
// lie? how does it feel? act now or later? tell someone? change my vote?). All requests go
// out together, the answers are sampled, then code commits them in a fixed order (whoever
// was spoken to first, then by distance) and settles clashes: if two women both decide to
// go after the same person right now, the first one does and the second reacts to that.
// A visible reaction (a gasp, storming off, a shove) is itself an event and starts the next
// round, down to a safety depth that should almost never bind.

import { decide, emit, nextId, change, violation, now } from "./record.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import { view } from "./views.js";
import { register, grounded } from "./moves.js";
import { overlap } from "./reading.js";
import { dist } from "./space.js";

const nm = M.nm;
export const MAX_DEPTH = 4;
export const stats = { rounds: 0, requests: 0, depthBound: 0, cascades: 0, maxDepth: 0, clashes: 0 };

const CONF = [0.05, 0.22, 0.48, 0.74, 0.93];
const SURE = ["Not at all: she thinks it's rubbish", "Doubts it", "Half believes it", "Believes it", "Is sure it's true"];
const FEEL5 = ["much worse", "worse", "about the same", "better", "much better"];
const DELIVERY = ["visibly nervous and shifty", "a little unsure of herself", "matter-of-fact", "smooth and confident", "completely convincing"];
export const deliveryText = (x) => DELIVERY[Math.round(Math.max(0, Math.min(4, x ?? 2)))];

const isWoman = (s, id) => !!s.people[id] && !s.people[id].gone;
const levelOf = (how) => (how === "addressed" ? 1 : how === "overheard" ? 0.85 : how === "partial" ? 0.5 : 0);
const vote = (s) => (s.minute >= 15 * 60 ? 1 : 0.5); // tension rises toward the vote

// ---------- what the claim is, before anyone judges it ----------
// Fixes which story a claim move is (an existing one, a retelling that changed it, a new
// one, or a lie) and stores lies with the speaker's real belief.
export function settleClaim(s, mv, { speaker, lie = null, ev }) {
  const g = grounded(s, speaker, mv, { lie });
  const X = mv.about;
  const pol = mv.pol ?? 1;
  const isVote = !!mv.voteTarget;
  const prop = { subject: X, pred: isVote ? "votes_for" : mv.type === "secret" ? "secret" : "did", obj: mv.voteTarget || null, pol };
  const truthNow = isVote && X && X !== "player" && s.people[X] ? (s.people[X].votePlan?.target === mv.voteTarget) === (pol === 1) : null;
  let rid = null, mutated = false;
  if (g.rid) {
    const base = s.rumors[g.rid];
    if (overlap(base.text, mv.content) >= 0.6 && (base.prop?.pol ?? 1) === pol) rid = g.rid;
    else { rid = B.newClaim(s, { about: X, text: mv.content, origin: base.origin, isTrue: (base.prop?.pol ?? 1) === pol ? base.isTrue : base.isTrue == null ? null : !base.isTrue, harm: base.harm, parent: g.rid, kind: base.kind, cat: base.cat, prop: { ...base.prop, pol }, ev }); mutated = true; }
  } else {
    rid = B.findClaim(s, { about: X, text: mv.content, pol, obj: isVote ? mv.voteTarget : undefined });
    if (!rid) rid = B.newClaim(s, { about: X, text: mv.content, origin: speaker, isTrue: g.lie ? false : truthNow, harm: harmOf(mv), kind: isVote ? "vote" : mv.type === "secret" ? "secret" : "gossip", cat: isVote ? "mind" : /\b(is|she's|always|never)\b.*\b(fake|liar|snake|mean|kind|sweet|nasty|two-faced|jealous|loyal|honest)\b/i.test(mv.content) ? "trait" : "world", prop, ev, target: mv.voteTarget });
  }
  if (g.lie || (speaker !== "player" && g.self && lie)) {
    (s.lies ??= []).push({ id: nextId(s, "L"), by: speaker, to: mv.to, rid, truth: lie?.truth || "she knows it isn't so", mv: mv.id, ev, day: s.day, minute: s.minute });
    s.rumors[rid].isTrue = false;
  }
  if (speaker === "player") {
    // the player's lies are kept like anyone's: a claim with nothing she perceived behind it,
    // or one that goes against what she knows
    const pk = s.player.knows || {};
    const backed = Object.entries(pk).some(([id, k]) => k.conf >= 0.5 && (id === rid || B.rootOf(s, id) === B.rootOf(s, rid)));
    const against = Object.entries(pk).some(([id, k]) => k.conf >= 0.5 && B.contradicts(s, id, rid));
    if (!backed && X !== "player") (s.lies ??= []).push({ id: nextId(s, "L"), by: "player", to: mv.to, rid, truth: against ? "goes against what she heard" : "nothing she saw or heard backs it", basis: against ? "against" : "none", mv: mv.id, ev, day: s.day, minute: s.minute });
  }
  mv.rid = rid;
  mv.grounds = g.ok ? (g.lie ? "lie" : g.self ? "self" : g.opinion ? "opinion" : g.rid ? `belief:${g.rid}` : "ok") : speaker === "player" ? "player" : "ungrounded";
  if (mutated) mv.mutated = true;
  return rid;
}
function harmOf(mv) {
  if (mv.type === "accusation") return -1.2;
  if (mv.type === "secret") return -1.3;
  if (mv.voteTarget) return -0.6;
  return mv.harm ?? -0.4;
}

// what she knows about a claim about herself
export function selfTruth(s, P, rid) {
  const r = s.rumors[rid];
  if (!r) return null;
  if (r.prop?.pred === "votes_for") return (s.people[P]?.votePlan?.target === r.prop.obj) === ((r.prop.pol ?? 1) === 1);
  const sec = B.secretOf(s, P);
  if (sec && (B.rootOf(s, rid) === sec.root || overlap(s.rumors[sec.rid].text, r.text) >= 0.45)) return (r.prop?.pol ?? 1) === 1;
  if (r.isTrue != null) return r.isTrue;
  return false; // something nobody saw her do: she knows she didn't
}

// ---------- one round ----------
// ctx: { ev, moves (committed), speaker, addressed: [ids], talk, depth, delivery, crowd,
//        replyFor: id (the woman who answers next), replyOptions: (P) => {criteria, prior, meta} }
export async function round(s, ctx) {
  const { ev, moves, speaker, depth = 0 } = ctx;
  stats.rounds++;
  if (depth > stats.maxDepth) stats.maxDepth = depth;
  const perceivers = ev.perceivers.filter((p) => p.id !== speaker && (p.id === "player" || isWoman(s, p.id)));
  // the player takes in what she heard (she judges it herself)
  for (const p of perceivers.filter((p) => p.id === "player")) playerTakesIn(s, ev, moves, p.how);
  const women = perceivers.filter((p) => p.id !== "player");
  const reqs = women.map((p) => build(s, p.id, p.how, ctx)).filter(Boolean);
  const started = [];
  const answers = await Promise.all(reqs.map((r) => { started.push(Date.now()); stats.requests++; return decide(s, r.P, r.view, r.qs, r.label, ev.id, r.describe); }));
  (s.rounds ??= []).push({ ev: ev.id, n: reqs.length, spread: started.length ? Math.max(...started) - Math.min(...started) : 0, depth, day: s.day, minute: s.minute });
  if (s.rounds.length > 500) s.rounds.shift();
  // commit in a fixed order: spoken to first, then nearest
  const order = reqs.map((r, i) => [r, answers[i]]).sort(([a], [b]) => (b.how === "addressed") - (a.how === "addressed") || dist(s, a.P, speaker) - dist(s, b.P, speaker) || (a.P < b.P ? -1 : 1));
  const out = { replies: {}, crowd: {}, outbursts: [], agenda: [], judged: {} };
  const nowTargets = new Map(); // who someone is already going after right now
  for (const [r, a] of order) apply(s, r, a, ctx, out, nowTargets);
  // visible reactions are events too: the next round
  for (const o of out.outbursts) {
    if (depth + 1 > MAX_DEPTH) { stats.depthBound++; violation(s, "cascade-depth-cap", { ev: ev.id }); break; }
    stats.cascades++;
    const oev = emit(s, { type: "outburst", actor: o.by, targets: o.at ? [o.at] : [], content: { what: o.what, kind: o.kind, about: o.about || null }, cause: o.cause });
    o.ev = oev.id;
    if (o.kind === "shove") out.fight = { by: o.by, at: o.at, cause: oev.id };
    else await round(s, { ev: oev, moves: [], speaker: o.by, depth: depth + 1, outburst: o });
  }
  return out;
}

// ---------- building one woman's request ----------
function build(s, P, how, ctx) {
  const { ev, moves, speaker, talk, delivery, crowd, outburst } = ctx;
  const v = s.people[P];
  const lvl = levelOf(how);
  const visible = moves.filter((mv) => lvl >= 0.85 || (lvl > 0 && heardSpan(ev, P, mv, s)));
  const S = speaker, sn = nm(s, S);
  const rSP = s.rel[P]?.[S] || M.newRel(0, 0);
  const qs = {}, meta = [];
  const heard = how === "partial" ? (ev.content.heardAs?.[P] || "") : ev.content.text;
  for (const [i, mv] of visible.entries()) {
    const k = `m${i}`;
    meta.push({ k, mv });
    if (mv.rid && ["claim", "accusation", "secret"].includes(mv.type)) claimQs(s, P, S, mv, k, qs, { how, ev, delivery, rSP });
    else if (mv.type === "promise" || mv.type === "plan") {
      qs[`${k}_sincere`] = { type: "noul", instructions: `Does ${v.name.split(" ")[0]} believe ${sn} means it when she says: "${mv.span}"?`, prior: clamp01(0.45 + rSP.trust * 0.15 - B.suspicion(s, P, S) * 0.5 + trackRecord(s, S) * 0.2) };
      // a vote plan she hears makes her think about her own
      const T = mv.kind === "vote" && mv.target;
      if (T && T !== P && (T === "player" ? !s.player.out : isWoman(s, T)) && v.votePlan?.target !== T) qs[`${k}_join`] = { type: "noul", instructions: `${sn} means to vote out ${nm(s, T)}. Does ${v.name.split(" ")[0]} lean that way too now?`, prior: clamp01(0.08 + Math.max(0, -(s.rel[P][T]?.affinity ?? 0)) * 0.15 + Math.max(0, rSP.affinity) * 0.06 + (v.votePlan ? -0.05 : 0.08) - Math.max(0, s.rel[P][T]?.affinity ?? 0) * 0.1) };
    }
    else if (mv.type === "request" && mv.to.includes(P)) requestQs(s, P, S, mv, k, qs, rSP);
    else if (mv.type === "question" && mv.to.includes(P) && ctx.replyFor === P) qs[`${k}_answer`] = { type: "choice", instructions: `${sn} asked: "${mv.span}". How does she answer?`, criteria: { truth: "Tells the truth", lie: "Lies", dodge: "Dodges it" }, prior: { truth: Math.max(0.1, 1.3 - v.bias.deceit * 0.9 + rSP.trust * 0.25), lie: v.bias.deceit * (1 + Math.max(0, -rSP.trust) * 0.4) + (/vot/i.test(mv.content) && v.bias.scheme > 0.6 ? 0.4 : 0), dodge: 0.4 + v.bias.scheme * 0.6 } };
    else if (["insult", "threat"].includes(mv.type) && aimedAt(mv, P)) {
      // overheard being run down behind her back: what she does about it
      if (how === "overheard" || how === "partial") {
        qs[`${k}_payback`] = { type: "choice", instructions: `${v.name.split(" ")[0]} overheard ${sn} say that about her behind her back. What does she do about it?`, criteria: { nothing: "Lets it go", confront_now: `Drops what she's doing and has it out with ${sn} right now`, confront_later: `Means to have it out with ${sn} later`, vote_out: `Decides ${sn} has to go at the vote` }, prior: { nothing: 1.8 - v.bias.temper, confront_now: v.bias.temper * 0.9 + v.mood.anger * 0.3 + v.bias.nerve * 0.3, confront_later: 0.3 + v.bias.temper * 0.4, vote_out: v.bias.scheme * 0.6 } };
      }
      if (mv.type === "threat") qs[`${k}_fear`] = { type: "score", instructions: `How much does that threat scare her?`, criteria: ["Not at all", "A little", "Somewhat", "A lot", "She's terrified"], prior: 1 + (s.rel[P][S]?.fear || 0) * 0.5 + (1 - v.bias.nerve) * 1.2 };
    } else if (mv.type === "insult" && friendHit(s, P, S, mv)) {
      const f = friendHit(s, P, S, mv);
      qs[`${k}_payback`] = { type: "choice", instructions: `${v.name.split(" ")[0]} just saw ${sn} be nasty to her friend ${nm(s, f)}. What does she do about it?`, criteria: { nothing: "Stays out of it", confront_now: `Steps in and has it out with ${sn} right now`, confront_later: `Means to have a word with ${sn} about it later`, vote_out: `Decides ${sn} has to go at the vote` }, prior: { nothing: 2.2 - v.bias.loyalty * 0.6, confront_now: v.bias.loyalty * 0.4 + v.bias.temper * 0.5 + v.bias.nerve * 0.2, confront_later: 0.4 + v.bias.loyalty * 0.5, vote_out: v.bias.scheme * 0.3 } };
    } else if (mv.type === "compliment" && aimedAt(mv, P)) qs[`${k}_flattery`] = { type: "noul", instructions: `Does she think ${sn} is just buttering her up?`, prior: clamp01(0.08 + v.bias.scheme * 0.35 + Math.max(0, -rSP.trust) * 0.15) };
    else if (mv.type === "apology" && mv.to.includes(P)) qs[`${k}_forgive`] = { type: "noul", instructions: `Does she accept ${sn}'s apology?`, prior: clamp01(0.3 + v.bias.loyalty * 0.4 + rSP.affinity * 0.1 - v.mood.anger * 0.1) };
    // an opinion about someone who isn't being spoken to: does it rub off on how she sees her?
    const X = mv.about;
    if (["insult", "compliment"].includes(mv.type) && X && X !== P && X !== S && !mv.to.includes(X) && present(s, X)) {
      const rPX = s.rel[P][X] || M.newRel(0, 0);
      qs[`${k}_sway`] = { type: "noul", instructions: `${sn} ${mv.type === "insult" ? "ran down" : "spoke well of"} ${nm(s, X)}: "${short(mv.span, 80)}". Does it change how ${v.name.split(" ")[0]} sees ${nm(s, X)}?`, prior: clamp01(0.12 + Math.max(0, rSP.trust) * 0.14 + Math.max(0, rSP.affinity) * 0.06 + v.bias.gossip * 0.15 - Math.min(0.25, Math.abs(rPX.affinity) * 0.08) - (rSP.trust < -0.5 ? 0.1 : 0)) };
    }
  }
  // how she feels about the speaker now, and whether it shows
  const feelPrior = 2 + visible.reduce((t, mv) => t + ({ compliment: 0.6, insult: aimedAt(mv, P) ? -1.4 : -0.3, threat: -1.6, accusation: mv.about === P ? -1.3 : 0, apology: 0.5, agreement: 0.3, refusal: -0.3, promise: 0.2 }[mv.type] || 0), 0) + ((ctx.tone === "hostile" ? -0.4 : ctx.tone === "warm" || ctx.tone === "friendly" ? 0.2 : 0));
  if (visible.length || outburst) qs.feel = { type: "score", instructions: `After this, how does ${v.name.split(" ")[0]} feel about ${sn}?`, criteria: FEEL5, prior: Math.max(0, Math.min(4, feelPrior + (outburst ? (outburst.kind === "storm_off" ? -0.2 : 0) : 0))) };
  const stung = visible.some((mv) => ["insult", "threat", "accusation"].includes(mv.type) && aimedAt(mv, P));
  // someone's outburst aimed at her (laughing at her, scoffing at her) can set her off in turn
  const provoked = outburst && outburst.at === P && ["laugh", "scoff", "storm_off"].includes(outburst.kind);
  if ((visible.length || provoked) && lvl >= 0.85 && !depthOk(ctx)) stats.depthBound++; // the safety cap held back a reaction
  if ((visible.length || provoked) && (lvl >= 0.85) && depthOk(ctx)) qs.show = { type: "choice", instructions: `Does it show? Anything she does right now, in front of everyone`, criteria: { nothing: "Keeps a straight face", gasp: "Gasps out loud", laugh: "Laughs at it", scoff: "Scoffs and rolls her eyes", storm_off: "Storms off", shove: `Shoves ${sn}: a cat fight starts` }, prior: { nothing: provoked ? 4 : 6, gasp: visible.some((m) => m.type === "claim" || m.type === "secret") ? 0.4 + v.bias.gossip * 0.4 : 0.1, laugh: visible.some((m) => m.type === "insult" && m.about !== P && !m.to.includes(P)) ? 0.4 : 0.1, scoff: 0.15 + Math.max(0, -rSP.affinity) * 0.2 + (provoked ? 0.3 + v.bias.temper * 0.4 : 0), storm_off: stung || provoked ? 0.2 + v.mood.anger * 0.2 : 0.02, shove: stung && S !== "primrose" ? Math.min(0.6, 0.004 + v.bias.temper * (0.02 + v.mood.anger * 0.05 + Math.max(0, -rSP.affinity) * 0.04)) : 0 } };
  if (crowd) qs.crowd = { type: "choice", instructions: `${v.name.split(" ")[0]} is in the crowd. How does ${sn}'s moment land with her?`, criteria: { loved: `She loves it and warms to ${sn}`, amused: "She's entertained", unmoved: "It does nothing for her", cringed: `She cringes; it makes ${sn} look bad`, offended: `She's offended and turns on ${sn}` }, prior: crowdPrior(s, P, S, visible) };
  // the answer she gives next, if it's her turn
  let replyMeta = null;
  if (ctx.replyFor === P && ctx.replyOptions) {
    replyMeta = ctx.replyOptions(P, { visible, rSP });
    if (replyMeta) {
      qs.reply = { type: "choice", instructions: `It's ${v.name.split(" ")[0]}'s turn to answer ${sn}. What does she do with it?`, criteria: replyMeta.criteria, prior: replyMeta.prior };
      qs.delivery = { type: "score", instructions: `However she answers, how does she come across? (Her skill at keeping a straight face, her nerves, what's at stake.)`, criteria: DELIVERY, prior: Math.max(0, Math.min(4, 1.6 + v.bias.deceit * 1.6 - v.mood.fear * 0.5 - (s.minute >= 17 * 60 ? 0.4 : 0))) };
    }
  }
  if (outburst && !Object.keys(qs).length) return null;
  if (!Object.keys(qs).length) return null;
  const vw = view(s, P, { with: [S], about: visible.find((m) => m.about)?.about, topic: visible.find((m) => m.rid)?.rid, small: true, moment: momentText(s, P, how, ev, visible, heard, delivery, outburst) });
  return { P, how, qs, meta, view: vw, label: `react:${P}<-${ev.id}`, replyMeta, visible, describe: (o) => describeJudgment(s, P, S, meta, o) };
}
const depthOk = (ctx) => (ctx.depth || 0) < MAX_DEPTH;
const clamp01 = (x) => Math.max(0.02, Math.min(0.98, x));

// what a half-hearer caught: enough of the words, or the name of who it was about plus a
// few words more (she knows who they're talking about, and fills in the rest)
function heardSpan(ev, P, mv, s = null) {
  const got = String(ev.content.heardAs?.[P] || "").toLowerCase();
  const ws = String(mv.span).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!ws.length) return false;
  const share = ws.filter((w) => got.includes(w)).length / ws.length;
  const name = s && mv.about && (mv.about === "player" ? s.player.name : s.people[mv.about]?.name.split(" ")[0]);
  return share >= 0.4 || (share >= 0.25 && !!name && got.includes(name.toLowerCase()));
}

function momentText(s, P, how, ev, visible, heard, delivery, outburst) {
  const S = nm(s, ev.actor);
  if (outburst) return `${S} ${outburst.what}`;
  const to = ev.targets.map((t) => (t === P ? "you" : nm(s, t))).join(" and ") || "everyone";
  const w = how === "partial" ? `You only caught part of it: "${heard}"` : `"${heard}"`;
  return `${S} just said to ${to}${ev.type === "show_line" ? " in front of the whole crowd" : ""}: ${w}${delivery != null ? `. She came across ${deliveryText(delivery)}` : ""}.`;
}

function claimQs(s, P, S, mv, k, qs, { how, delivery, rSP }) {
  const v = s.people[P], r = s.rumors[mv.rid];
  const X = r.about, aboutMe = X === P;
  const pn = v.name.split(" ")[0];
  const clashes = B.clashes(s, P, mv.rid, { from: S });
  // a second, independent source: the same story already heard from someone else
  const corroborates = Object.entries(v.knows).some(([id, kk]) => id !== mv.rid && kk.conf >= 0.4 && B.rootOf(s, id) === B.rootOf(s, mv.rid) && !kk.chain.some((l) => l.from === S)) || (v.knows[mv.rid]?.chain || []).some((l) => l.from && l.from !== S && l.from !== "self" && l.from !== P);
  const nervous = delivery != null ? (2 - delivery) * 0.12 : 0;
  const susp = B.suspicion(s, P, S);
  const tension = (s.minute >= 15 * 60 ? 0.04 : 0) + v.mood.anger * 0.03 + (s.event?.day === s.day && !s.event.done ? 0 : 0);
  if (aboutMe) {
    const truth = selfTruth(s, P, mv.rid);
    qs[`${k}_believe`] = { type: "score", instructions: `${nm(s, S)} says this about ${pn} herself: "${r.text}". She knows her own life. How true is it?`, criteria: SURE, prior: truth ? 3.8 : 0.3 };
    qs[`${k}_liar`] = { type: "noul", instructions: `Does ${pn} think ${nm(s, S)} is lying about her (rather than just repeating something)?`, prior: truth ? 0.04 : clamp01(0.35 + susp * 0.4 + v.bias.scheme * 0.15 + nervous) };
    qs[`${k}_payback`] = { type: "choice", instructions: `What does ${pn} decide to do about it?`, criteria: { nothing: "Lets it go", deny_around: "Sets the record straight with people later", confront_root: `Has it out with whoever started it`, vote_out: `Decides ${nm(s, S)} has to go at the vote` }, prior: { nothing: 1.6 - v.bias.temper, deny_around: truth ? 0.1 : 0.6, confront_root: v.bias.temper * 1.3 + v.mood.anger * 0.3, vote_out: (r.harm || 0) < -0.5 ? v.bias.scheme * 0.9 : 0.1 } };
    qs[`${k}_now`] = { type: "noul", instructions: `If she does something about it, does she drop what she was doing and do it right away?`, prior: clamp01(0.15 + v.bias.temper * 0.35 + v.mood.anger * 0.1 + (how === "overheard" ? 0.1 : 0)) };
    return;
  }
  const friendOfX = (s.rel[P][X]?.affinity || 0) >= 1.2, enemyOfX = (s.rel[P][X]?.affinity || 0) <= -1;
  const harm = r.harm || 0;
  const plausible = (clashes.length ? -1.6 : 0) + (corroborates ? 1 : 0) + (harm < 0 && enemyOfX ? 0.5 : 0) + (harm < 0 && friendOfX ? -0.7 : 0);
  qs[`${k}_believe`] = { type: "score", instructions: `${nm(s, S)} says: "${r.text}". How much does ${pn} believe it?`, criteria: SURE, prior: Math.max(0, Math.min(4, 1.6 + rSP.trust * 0.45 + plausible - susp * 1.2 + (P === "pippa" ? 0.6 : 0) - v.bias.scheme * 0.3 - nervous * 3 - (how === "partial" ? 0.5 : 0))) };
  qs[`${k}_liar`] = { type: "noul", instructions: `Does ${pn} sense ${nm(s, S)} is lying to her about this?`, prior: clamp01(0.03 + (clashes.length ? 0.45 : 0) + susp * 0.45 + nervous + v.bias.nosy * 0.05 + tension + (friendOfX && harm < 0 ? 0.1 : 0)) };
  if (clashes.length) {
    // two different vote plans from the same woman: maybe she's telling everyone something different
    const votes = r.prop?.pred === "votes_for" && X && X !== P && X !== S && clashes.some((c) => s.rumors[c].prop?.pred === "votes_for");
    const straight = votes && [mv.rid, ...clashes].some((c) => (c === mv.rid ? s.people[S]?.knows?.[c] : v.knows[c])?.chain?.some((l) => l.from === X));
    // who the old story came from, and whether the woman it's about is the one saying otherwise
    const oldFrom = v.knows[clashes[0]]?.chain?.[0]?.from;
    const rOld = oldFrom && oldFrom !== "self" && oldFrom !== P ? s.rel[P][oldFrom] : null;
    const selfSays = S === X;
    // she heard one promise from X herself and the teller heard the other from X herself
    // the teller saw it herself, and the old story was only hearsay
    const eyewitness = (s.people[S]?.knows?.[mv.rid]?.chain || []).some((l) => l.from === "self" || l.how === "saw") && !firstHand(s, P, clashes);
    const bothFromX = votes && (s.people[S]?.knows?.[mv.rid]?.chain || []).some((l) => l.from === X) && clashes.some((c) => (v.knows[c]?.chain || []).some((l) => l.from === X));
    qs[`${k}_clash`] = { type: "choice", instructions: `This goes against what ${pn} already believed: ${clashes.map((c) => `"${s.rumors[c].text}"`).join("; ")}. What does she make of it?`, criteria: { keep: "Sticks with what she believed", switch: "Changes her mind: the new story is right", suspect_new: `Decides ${nm(s, S)} is lying`, suspect_old: "Decides whoever told her the old story lied", ...(votes ? { two_faced: `Decides ${nm(s, X)} is telling different people different things` } : {}) }, prior: { keep: 1.2 + (B.conf(s, P, clashes[0]) || 0) + (rOld ? rOld.trust * 0.3 : 0) - (selfSays ? 0.6 : 0) - (bothFromX ? 0.8 : 0) - (eyewitness ? 0.7 : 0), switch: 0.5 + rSP.trust * 0.3 + (selfSays ? 0.6 : 0) + (eyewitness ? 0.9 + Math.max(0, rSP.trust) * 0.3 : 0), suspect_new: 0.4 + susp + Math.max(0, -rSP.trust) * 0.3 + (firstHand(s, P, clashes) ? 1.2 : 0), suspect_old: 0.25 + (eyewitness ? 0.3 : 0) + (selfSays ? 0.35 + Math.max(0, -(rOld?.trust ?? 0)) * 0.5 + (rOld && rOld.trust < 0.2 ? 0.2 : 0) : 0), ...(votes ? { two_faced: 0.5 + (straight ? 2.6 : 0) + v.bias.scheme * 0.4 + B.suspicion(s, P, X) } : {}) } };
  }
  if (Math.abs(harm) >= 0.4 && X && X !== S) qs[`${k}_onX`] = { type: "score", instructions: `If she believes it, how does it change how ${pn} feels about ${nm(s, X)}?`, criteria: FEEL5, prior: Math.max(0, Math.min(4, 2 + harm * 0.6 + (friendOfX ? 0.4 : 0))) };
  if (X && X !== S) {
    const juicy = Math.abs(harm) + (r.kind === "secret" ? 1 : 0) + (r.prop?.pred === "votes_for" ? 0.5 : 0);
    const age = s.day - (r.day || s.day);
    qs[`${k}_pass`] = { type: "choice", instructions: `Will ${pn} pass this on?`, criteria: { keep: "Keeps it to herself", later: "Tells someone later" }, prior: { keep: 1.5 + (friendOfX ? v.bias.loyalty * 1.5 : 0) + (mv.keepQuiet ? 1.5 : 0), later: Math.max(0.05, v.bias.gossip * 1.8 * (0.4 + juicy * 0.6) / (1 + age * 0.7)) } };
    const canReach = X === "player" ? !s.player.out : isWoman(s, X);
    if (canReach) qs[`${k}_act`] = { type: "choice", instructions: `What else does ${pn} decide to do about it?`, criteria: { nothing: "Nothing", ask: `Ask ${nm(s, X)} if it's true`, warn: `Warn ${nm(s, X)} what's being said`, confront: `Confront ${nm(s, X)}`, vote_out: `Decide ${nm(s, X)} has to go at the vote`, defend: `Stick up for ${nm(s, X)}` }, prior: { nothing: 3, ask: v.bias.nosy * 0.4, warn: friendOfX && harm < 0 ? 1.2 : 0.05, confront: harm < -0.5 ? v.bias.temper * (0.5 + v.mood.anger * 0.3) + (enemyOfX ? 0.3 : 0) : 0.02, vote_out: harm < -0.5 && X !== P ? v.bias.scheme * 0.5 + (enemyOfX ? 0.4 : 0) : 0.02, defend: friendOfX && harm < 0 ? v.bias.loyalty * 0.6 : 0.02 } };
    if (canReach) qs[`${k}_now`] = { type: "noul", instructions: `If she does something about it, does she do it right away rather than later?`, prior: clamp01(0.15 + v.bias.temper * 0.3 + v.mood.anger * 0.1) };
  }
  if (r.prop?.pred === "votes_for" && r.prop.obj === P && (r.prop.pol ?? 1) === 1) qs[`${k}_revenge`] = { type: "noul", instructions: `${pn} just heard ${nm(s, X)} wants HER voted out. Does she turn her own vote on ${nm(s, X)}?`, prior: clamp01(0.25 + v.bias.scheme * 0.3 + Math.max(0, -(s.rel[P][X]?.affinity || 0)) * 0.1) };
}

function requestQs(s, P, S, mv, k, qs, rSP) {
  const v = s.people[P];
  const t = mv.target;
  const toT = t && s.rel[P][t] ? s.rel[P][t].affinity : 0;
  const voteBoost = mv.kind === "vote" && t ? (t === P ? -3 : toT <= -1 || v.votePlan?.target === t ? 0.35 : toT >= 1.2 ? -0.35 : 0) : 0;
  const pactBoost = mv.kind === "pact" ? (s.alliances.some((a) => a.members.includes(P) && a.members.includes(S)) ? 0.3 : !s.alliances.some((a) => a.members.includes(P)) ? 0.15 : 0) : 0;
  // saying yes costs little when the ask is small: whether she means it is the real question
  const cheap = mv.kind === "keep_quiet" ? 0.45 : ["talk", "ask", "warn", "other"].includes(mv.kind) ? 0.15 : 0;
  qs[`${k}_accept`] = { type: "noul", instructions: `${nm(s, S)} asks ${v.name.split(" ")[0]}: "${mv.span}". Does she say yes?`, prior: clamp01(0.22 + cheap + rSP.affinity * 0.13 + rSP.trust * 0.08 + (rSP.debt || 0) * 0.22 - v.mood.anger * 0.1 + voteBoost + pactBoost) };
  qs[`${k}_sincere`] = { type: "noul", instructions: `If she says yes, does she actually mean it (rather than lying to ${nm(s, S)}'s face)?`, prior: clamp01(0.95 - v.bias.deceit * 0.7 + rSP.trust * 0.08 - (mv.kind === "keep_quiet" ? v.bias.gossip * 0.35 : 0)) };
  qs[`${k}_cover`] = { type: "choice", instructions: `If she says yes without meaning it, what will she say later if called on it?`, criteria: { changed: "That something she learned changed her mind", never: "That she never really promised", blame: "That someone else talked her out of it", forgot: "That it slipped her mind" }, prior: { changed: 1.2, never: v.bias.deceit, blame: v.bias.scheme * 0.8, forgot: 0.5 } };
}

function crowdPrior(s, P, S, visible) {
  const toS = s.rel[P]?.[S]?.affinity ?? 0, b = s.people[P].bias;
  const p = { loved: 0.6 + Math.max(0, toS) * 0.6, amused: 0.5 + b.gossip * 0.4, unmoved: 1.4, cringed: 0.4 + Math.max(0, -toS) * 0.4, offended: 0.15 + Math.max(0, -toS) * 0.3 };
  for (const mv of visible) {
    const X = mv.about || mv.to?.[0], isX = X === P, toX = X && !isX ? (s.rel[P]?.[X]?.affinity ?? 0) : 0;
    if (mv.type === "compliment") { p.loved += isX ? 3 : Math.max(0, toX) * 1.2; p.cringed += Math.max(0, -toX) * 1.2; }
    if (mv.type === "insult") { p.amused += Math.max(0, -toX) * 1.2 + b.nerve * 0.4; p.offended += isX ? 3 - b.nerve : Math.max(0, toX); }
    if (mv.type === "accusation") { p.loved += Math.max(0, -toX) * 1.2; p.offended += isX ? 3.5 : Math.max(0, toX) * 1.3; p.cringed += 0.4 + b.loyalty * 0.4; }
    if (mv.type === "claim" || mv.type === "secret") { p.amused += b.gossip * 1.2; p.cringed += b.loyalty * 0.6; p.offended += isX ? 3.5 : Math.max(0, toX); }
    if (mv.type === "apology") { p.loved += b.loyalty * 0.8 + (isX ? b.loyalty * 2 : 0); p.cringed += b.scheme * 0.5; }
    if (mv.type === "request" && /keep me|stay|vote/i.test(mv.content)) { p.loved += Math.max(0, toS); p.cringed += 0.5 + Math.max(0, -toS) * 0.8; }
  }
  return p;
}

// ---------- committing one woman's answers ----------
function apply(s, r, a, ctx, out, nowTargets) {
  const { P, how, meta } = r;
  const v = s.people[P];
  const { ev, speaker: S } = ctx;
  const did = a._id;
  let n = 0; // state changes this judgment caused
  const pn = v.name.split(" ")[0];
  let weight = 0;
  for (const { k, mv } of meta) {
    const m = (s.moves || []).find((x) => x.id === mv.id) || mv;
    m.judged[P] = did;
    const before = n;
    if (m.rid && ["claim", "accusation", "secret"].includes(m.type)) {
      const rr = s.rumors[m.rid];
      const X = rr.about, aboutMe = X === P;
      const bel = a[`${k}_believe`];
      let c = bel ? CONF[Math.round(bel.value)] : 0.4;
      if (how === "partial") c *= 0.6;
      // attribution travels: the story started with whoever told the teller
      const sk = s.people[S]?.knows?.[m.rid];
      const root = sk?.chain?.[0]?.root && !["saw", "self", "truth", "inference"].includes(sk.chain[0].root) ? sk.chain[0].root : S;
      let rid = m.rid;
      if (how === "partial") rid = garble(s, m, P, ev);
      const res = B.learn(s, P, rid, { conf: c, from: S, ev: ev.id, root, how: how === "addressed" ? "told" : how, partial: how === "partial", cause: m.id });
      n++;
      if (res.after >= 0.4 && res.after > res.before + 0.12) n += clearedBy(s, P, rid, S, did, res.after - res.before);
      // a story that someone lies or goes back on her word: if she buys it, she trusts her less
      const pred = s.rumors[rid]?.prop?.pred, X0 = s.rumors[rid]?.about;
      if (["lied", "lies", "two_faced", "broke_word"].includes(pred) && X0 && X0 !== P && res.after >= 0.4 && res.after > res.before) {
        if (pred !== "lies") B.suspect(s, P, X0, { by: (res.after - res.before) * 0.4, because: [rid], why: `heard she ${pred === "lied" ? "lies" : "goes back on her word"}`, cause: m.id });
        if (X0 !== "player" && s.rel[P][X0]) M.shift(s, P, X0, { trust: -(res.after - res.before) * 0.5, cause: m.id });
        n++;
      }
      if (aboutMe) {
        // she knows her own life: a false story about her means someone lied. The teller, if she
        // thinks this one is lying; whoever it came from in any case (the attribution travels)
        if (!selfTruth(s, P, m.rid)) {
          if (a[`${k}_liar`]?.yes) { B.suspect(s, P, S, { by: 0.35, because: [rid], why: `said something about her she knows isn't true`, cause: m.id }); caughtLie(s, P, S, rid, ev.id, did); n++; }
          if (root !== S && present(s, root)) { B.suspect(s, P, root, { by: a[`${k}_liar`]?.yes ? 0.15 : 0.35, because: [rid], why: `started a story about her she knows isn't true`, cause: m.id }); n++; }
        }
        const pb = a[`${k}_payback`]?.pick;
        if (pb === "confront_root" && present(s, root)) { queueAct(s, v, { kind: "confront", target: root, rumor: rid }, did, nowTargets, out, a[`${k}_now`]?.yes); n++; }
        if (pb === "deny_around") { M.pushAgenda(s, v, { kind: "deny", target: null, rumor: rid, cause: { type: "reaction", id: did } }); n++; }
        if (pb === "vote_out" && present(s, S)) { M.planVote(s, v, S, `${nm(s, S)} said "${short(rr.text)}" about me`, { strength: 2, cause: did }); n++; }
        weight += 2;
      } else {
        // she was asked how to square it with what she believed: that answer is applied however
        // much she believed the new story
        const conflicts = res.conflicts?.length ? res.conflicts : B.clashes(s, P, rid);
        if (conflicts.length && a[`${k}_clash`]) { resolve(s, P, rid, conflicts, a[`${k}_clash`].pick, { teller: root, cause: did, ev: ev.id }); n++; weight += 1; }
        if (a[`${k}_liar`]?.yes && !["switch", "two_faced"].includes(a[`${k}_clash`]?.pick)) { B.suspect(s, P, S, { by: 0.3, because: [rid], why: `didn't buy what she said about ${nm(s, X)}`, cause: m.id }); B.revise(s, P, rid, Math.min(B.conf(s, P, rid), 0.15), m.id); n++; weight += 1; }
        const onX = a[`${k}_onX`];
        if (onX && X && X !== P && s.rel[P][X] && B.conf(s, P, rid) >= 0.4) { M.shift(s, P, X, { aff: (onX.value - 2) * 0.32, trust: (onX.value - 2) * 0.12, why: `heard: ${short(rr.text, 60)}`, cause: m.id }); n++; }
        if (a[`${k}_pass`]?.pick === "later" && B.conf(s, P, rid) >= 0.3) { M.pushAgenda(s, v, { kind: "spread", target: null, rumor: rid, cause: { type: "reaction", id: did } }); n++; }
        const act = a[`${k}_act`]?.pick;
        if (act && act !== "nothing" && present(s, X)) {
          if (act === "vote_out") { M.planVote(s, v, X, `of what ${nm(s, S)} told her: ${short(rr.text, 50)}`, { strength: 1.25, cause: did }); n++; }
          else { queueAct(s, v, { kind: act, target: X, rumor: rid }, did, nowTargets, out, a[`${k}_now`]?.yes); n++; }
        }
        if (a[`${k}_revenge`]?.yes && present(s, X)) { M.planVote(s, v, X, `heard ${nm(s, X)} wants her out`, { strength: 2, cause: did }); M.setGoal(s, v, { kind: "survive", w: 3, why: `heard ${nm(s, X)} wants her out`, cause: did }); n++; }
        if (rr.prop?.pred === "votes_for" && rr.prop.obj === P && (rr.prop.pol ?? 1) === 1 && B.conf(s, P, rid) >= 0.45) { M.setGoal(s, v, { kind: "survive", w: Math.min(3, Math.max(((v.goals || []).find((g) => g.kind === "survive")?.w || 1) + 0.8, (v.goals?.[0]?.w || 0) + 0.1)), why: `heard ${nm(s, X)} means to vote her out`, cause: m.id }); n++; }
        weight += Math.abs(rr.harm || 0) * 0.5 + (X === P ? 1 : 0);
      }
    } else if (m.type === "promise" || m.type === "plan") {
      const sincere = a[`${k}_sincere`];
      const rid = mindClaim(s, S, m);
      if (rid) { B.learn(s, P, rid, { conf: (sincere?.yes ? 0.7 : 0.25) * (how === "partial" ? 0.6 : 1), from: S, ev: ev.id, root: S, how: how === "addressed" ? "told" : how, cause: m.id }); n++; }
      if (m.to.includes(P) && sincere) { M.shift(s, P, S, { trust: sincere.yes ? 0.12 : -0.1, cause: m.id }); n++; }
      if (a[`${k}_join`]?.yes && present(s, m.target)) { M.planVote(s, v, m.target, `${nm(s, S)} is voting her out too`, { strength: 1.1, cause: did }); n++; }
      if (m.kind === "vote" && m.target === P && rid && B.conf(s, P, rid) >= 0.45) { M.setGoal(s, v, { kind: "survive", w: 3, why: `${nm(s, S)} said she'd vote her out`, cause: m.id }); n++; }
    } else if (m.type === "request" && m.to.includes(P)) {
      const yes = a[`${k}_accept`]?.yes, sincere = a[`${k}_sincere`]?.yes !== false;
      m.answer = m.answer || {};
      m.answer[P] = { yes: !!yes, sincere, cover: sincere ? null : a[`${k}_cover`]?.pick, decision: did };
      n++;
    } else if (m.type === "question" && a[`${k}_answer`]) {
      m.answer = m.answer || {};
      m.answer[P] = { mode: a[`${k}_answer`].pick, decision: did };
      n++;
    } else if (m.type === "threat" && aimedAt(m, P)) {
      const f = a[`${k}_fear`]?.value ?? 1;
      M.shift(s, P, S, { fear: 0.25 + f * 0.3, aff: -0.35, why: `threatened me: "${short(m.span, 50)}"`, cause: m.id }); n++;
      M.stir(s, v, { fear: f * 0.3, anger: 0.4, why: `${nm(s, S)} threatened her`, cause: m.id });
      weight += 2;
      n += payback(s, v, S, a[`${k}_payback`]?.pick, did, nowTargets, out);
    } else if (m.type === "insult" && aimedAt(m, P)) {
      M.shift(s, P, S, { aff: -0.45, respect: -0.15, why: `insulted me: "${short(m.span, 50)}"`, cause: m.id }); n++;
      M.stir(s, v, { anger: 0.8, cheer: -0.3, why: `${nm(s, S)} insulted her`, cause: m.id });
      weight += 2;
      n += payback(s, v, S, a[`${k}_payback`]?.pick, did, nowTargets, out);
    } else if (m.type === "insult" && friendHit(s, P, S, m)) {
      // seeing a friend humiliated spills over onto whoever did it
      M.shift(s, P, S, { aff: -0.3, why: `was nasty about ${nm(s, friendHit(s, P, S, m))}`, cause: m.id }); n++;
      n += payback(s, v, S, a[`${k}_payback`]?.pick, did, nowTargets, out);
    } else if (m.type === "insult") {
      // overhearing someone be nasty colors how you see her, a little
      const target = m.about || m.to.find((x) => x !== P);
      const fr = target && (s.rel[P][target]?.affinity || 0);
      M.shift(s, P, S, { aff: -0.1 - Math.max(0, fr) * 0.08, respect: v.bias.temper > 0.6 ? 0.05 : -0.05, why: fr >= 0.5 ? `was nasty to ${nm(s, target)}` : null, cause: m.id }); n++;
    } else if (m.type === "compliment" && aimedAt(m, P)) {
      const fl = a[`${k}_flattery`]?.yes;
      M.shift(s, P, S, fl ? { trust: -0.1, why: "buttered me up", cause: m.id } : { aff: 0.25, why: `said something nice: "${short(m.span, 40)}"`, cause: m.id }); n++;
    }
    if (a[`${k}_sway`]?.yes && m.about) {
      const bad = m.type === "insult", X = m.about;
      M.shift(s, P, X, { aff: (bad ? -1 : 1) * (0.2 + Math.max(0, s.rel[P][S]?.trust || 0) * 0.1), trust: bad ? -0.08 : 0.04, why: `${nm(s, S)} says "${short(m.span, 50)}"`, cause: m.id }); n++;
    }
    if (m.rid && ["claim", "accusation", "secret"].includes(m.type)) {
      // handled with the stories above
    } else if (m.type === "apology" && m.to.includes(P)) {
      const yes = a[`${k}_forgive`]?.yes;
      M.shift(s, P, S, yes ? { aff: 0.4, trust: 0.15, why: "apologized and I accepted", cause: m.id } : { aff: -0.05, why: "apologized; I'm not buying it", cause: m.id }); n++;
    } else if (m.type === "agreement" || m.type === "refusal") {
      // the agreement itself was committed by whoever made it (talk.js); listeners just note it
      M.shift(s, P, S, { aff: m.type === "agreement" ? 0.1 : -0.1, cause: m.id }); n++;
    } else if (m.type === "secret") {
      n++;
    }
    m.effects[P] = n - before || "dismissed";
  }
  const f = a.feel;
  if (f) {
    const d = (f.value - 2) * 0.32;
    if (Math.abs(d) >= 0.02) { M.shift(s, P, S, { aff: d, why: Math.abs(d) >= 0.25 ? whyFrom(s, meta, P) : null, cause: meta[0]?.mv.id || ev.id }); n++; }
    weight += Math.abs(f.value - 2);
  }
  const show = a.show?.pick;
  if (show && show !== "nothing") out.outbursts.push({ by: P, at: S, kind: show, what: { gasp: "gasped out loud", laugh: "laughed out loud", scoff: "scoffed and rolled her eyes", storm_off: "stormed off", shove: `shoved ${nm(s, S)}` }[show], cause: did, about: meta.find((x) => x.mv.about)?.mv.about });
  if (show === "storm_off") stormOff(s, v, did);
  if (a.crowd) out.crowd[P] = a.crowd.pick;
  if (r.replyMeta && a.reply) out.replies[P] = { pick: a.reply.pick, meta: r.replyMeta.meta?.[a.reply.pick] || null, delivery: a.delivery?.value ?? 2, decision: did, answers: meta.map(({ mv }) => ({ mv: mv.id, answer: s.moves?.find((x) => x.id === mv.id)?.answer?.[P] })).filter((x) => x.answer) };
  if (ctx.crowd && a.crowd) {
    const eff = { loved: 0.5, amused: 0.25, unmoved: 0, cringed: -0.3, offended: -0.7 }[a.crowd.pick];
    if (eff) { M.shift(s, P, S, { aff: eff, trust: a.crowd.pick === "offended" ? -0.2 : 0, why: Math.abs(eff) >= 0.45 ? `${a.crowd.pick === "loved" ? "won me over" : "offended me"} at the show` : null, cause: ev.id }); n++; }
  }
  // how much it mattered to her
  M.reweigh(s, P, ev.id, Math.min(6, 1 + weight), did);
  out.judged[P] = { decision: did, changes: n };
}

const present = (s, id) => (id === "player" ? !s.player.out : isWoman(s, id));
const short = (t, n = 60) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));

function whyFrom(s, meta, P) {
  const m = meta.map((x) => x.mv).find((mv) => ["insult", "threat", "accusation", "compliment", "apology"].includes(mv.type)) || meta[0]?.mv;
  if (!m) return null;
  return `${{ insult: "insulted", threat: "threatened", accusation: "accused", compliment: "flattered", apology: "apologized to", claim: "told", request: "asked", promise: "promised", question: "asked" }[m.type] || "said"} ${m.to?.includes(P) ? "me" : nm(s, m.to?.[0])}: "${short(m.span, 50)}"`;
}

function describeJudgment(s, P, S, meta, o) {
  const bits = [];
  for (const { k, mv } of meta) {
    if (o[`${k}_believe`]) bits.push(`${SURE[Math.round(o[`${k}_believe`].value)].toLowerCase()} what ${nm(s, S)} said ("${short(mv.span, 40)}")`);
    if (o[`${k}_liar`]?.yes) bits.push(`suspected ${nm(s, S)} was lying`);
    if (o[`${k}_accept`]) bits.push(`${o[`${k}_accept`].yes ? "agreed" : "refused"} when ${nm(s, S)} asked "${short(mv.span, 40)}"`);
  }
  if (o.feel) bits.push(`felt ${FEEL5[Math.round(o.feel.value)]} about ${nm(s, S)}`);
  return bits.join("; ");
}

// a few words heard from too far away become her own, vaguer version of the story
function garble(s, m, P, ev) {
  const r = s.rumors[m.rid];
  const got = String(ev.content.heardAs?.[P] || "").replace(/…/g, "").trim();
  if (!got) return m.rid;
  const text = `Overheard ${nm(s, m.by)} saying something about ${nm(s, r.about)}: "…${got}…"`;
  const existing = Object.values(s.rumors).find((x) => x.parent === m.rid && x.text === text);
  if (existing) return existing.id;
  return B.newClaim(s, { about: r.about, text, origin: r.origin, isTrue: r.isTrue, harm: (r.harm || 0) * 0.7, parent: m.rid, kind: r.kind, cat: r.cat, prop: { ...r.prop }, ev: ev.id });
}

// "S means to vote out X" / "S means to talk to X": a belief about S's mind
export function mindClaim(s, S, m) {
  if (!S || S === "primrose") return null;
  const isVote = m.kind === "vote" && m.target;
  const prop = isVote ? { subject: S, pred: "votes_for", obj: m.target, pol: 1 } : { subject: S, pred: "plans", obj: m.target || null, pol: 1 };
  const text = isVote ? `${nm(s, S)} means to vote out ${nm(s, m.target)}.` : `${nm(s, S)} means to ${m.content.replace(/^(i'?ll|i will|i'm going to|i am going to)\s+/i, "").replace(/[.!?]+$/, "")}.`;
  const found = Object.values(s.rumors).find((r) => r.about === S && r.prop?.pred === prop.pred && (r.prop.obj ?? null) === (prop.obj ?? null) && r.day === s.day && (isVote || overlap(r.text, text) >= 0.6));
  if (found) return found.id;
  return B.newClaim(s, { about: S, text, origin: S, isTrue: isVote ? null : null, harm: isVote ? -0.4 : 0, kind: isVote ? "vote" : "plan", cat: "mind", prop, target: m.target || null });
}

// contradictions get resolved and the resolution is kept
// she saw it with her own eyes (or worked it out herself), not just heard it
const firstHand = (s, P, rids) => rids.some((c) => (s.people[P]?.knows?.[c]?.chain || []).some((l) => l.root === "saw" || l.how === "saw"));
// does she really have open vote promises to different people for different women?
function twoFaced(s, X) {
  const vs = (s.ledger || []).filter((c) => c.by === X && c.kind === "vote" && c.status === "open");
  return new Set(vs.map((c) => c.target)).size > 1;
}
function resolve(s, P, rid, conflicts, pick, { teller, cause, ev = null }) {
  const rec = { id: nextId(s, "res"), by: P, claim: rid, against: conflicts, pick, cause, day: s.day, minute: s.minute };
  (s.resolutions ??= []).push(rec);
  // two stories can't both be right: whoever's story she drops told her something wrong,
  // a small mark against them (mistaken or lying)
  const oldTeller = (c) => s.people[P].knows[c]?.chain?.find((l) => l.from && l.from !== "self")?.from;
  if (pick === "keep") { B.revise(s, P, rid, Math.min(B.conf(s, P, rid), 0.18), cause); if (teller && teller !== P) { B.suspect(s, P, teller, { by: firstHand(s, P, conflicts) ? 0.25 : 0.12, because: conflicts, why: "told me something that doesn't fit what I know", cause }); rec.doubted = teller; } }
  else if (pick === "switch") for (const c of conflicts) {
    // the new story takes the old one's place
    if (B.conf(s, P, rid) < B.conf(s, P, c)) B.revise(s, P, rid, B.conf(s, P, c), cause);
    // the mark against the old teller rests on the story that showed hers wrong
    B.revise(s, P, c, Math.min(B.conf(s, P, c), 0.15), cause); const o = oldTeller(c); if (o && o !== P) { B.suspect(s, P, o, { by: 0.12, because: [rid], why: "her story turned out wrong", cause }); rec.doubted = o; } }
  else if (pick === "suspect_new") { B.revise(s, P, rid, Math.min(B.conf(s, P, rid), 0.12), cause); B.suspect(s, P, teller, { by: 0.4, because: conflicts, why: "her story didn't match what I knew", cause }); rec.suspected = teller; if (ev && conflicts.some((c) => (s.people[P].knows[c]?.chain || []).some((l) => l.root === "saw" || l.how === "saw"))) caughtLie(s, P, teller, rid, ev, cause); }
  else if (pick === "two_faced") {
    // both stories stand: the woman they're about is playing both sides
    const X = s.rumors[rid].about;
    const d = B.newClaim(s, { about: X, text: `${nm(s, X)} is telling different people she'll vote out different women.`, origin: P, isTrue: twoFaced(s, X), harm: -1.1, kind: "gossip", cat: "trait", prop: { subject: X, pred: "two_faced", obj: null, pol: 1 } });
    // what she has is that both were said, not that either is true: it rests on what she heard
    B.learn(s, P, d, { conf: 0.8, from: "self", ev, root: P, how: "inferred", cause });
    B.suspect(s, P, X, { by: 0.4, because: [ev], why: "promised different people different votes", cause });
    M.shift(s, P, X, { trust: -0.5, why: "plays both sides at the vote", cause });
    rec.suspected = X;
  }
  else if (pick === "suspect_old") {
    for (const c of conflicts) {
      // she takes the new story instead, and whoever told her the old one lied to her
      if (B.conf(s, P, rid) < B.conf(s, P, c)) B.revise(s, P, rid, B.conf(s, P, c), cause);
      B.revise(s, P, c, Math.min(B.conf(s, P, c), 0.12), cause);
      const old = oldTeller(c);
      if (old && old !== P) { B.suspect(s, P, old, { by: 0.4, because: [rid], why: "her story turned out wrong", cause }); rec.suspected = old; }
    }
  }
  return rec;
}

// one reaction at a time per target: the first to go after someone does it now; the others
// see that happen and go later
// She has caught someone lying (the evidence contradicts what she was told): a heavy
// memory, less trust, and a story of its own to pass on.
function caughtLie(s, P, liar, rid, ev, cause) {
  if (!liar || liar === P || !s.rumors[rid] || (liar !== "player" && !isWoman(s, liar))) return null;
  const r = s.rumors[rid];
  const real = (s.lies || []).some((l) => l.by === liar && (l.rid === rid || B.rootOf(s, l.rid) === B.rootOf(s, rid)));
  const text = `${nm(s, liar)} lied about ${r.about === liar ? "herself" : nm(s, r.about)}: "${short(r.text, 70)}"`;
  const id = Object.keys(s.rumors).find((x) => s.rumors[x].about === liar && s.rumors[x].prop?.pred === "lied" && s.rumors[x].text === text) || B.newClaim(s, { about: liar, text, origin: P, isTrue: real, harm: -1.2, kind: "gossip", cat: "world", prop: { subject: liar, pred: "lied", obj: r.about || null, pol: 1 } });
  B.learn(s, P, id, { conf: 0.75, from: "self", ev, root: P, how: "inferred", cause });
  M.reweigh(s, P, ev, 4, cause);
  if (liar !== "player") M.shift(s, P, liar, { trust: -0.6, aff: -0.3, why: `lied to me about ${r.about === liar ? "herself" : nm(s, r.about)}`, cause });
  const v = s.people[P];
  if (v.bias.gossip >= 0.4) M.pushAgenda(s, v, { kind: "spread", target: null, rumor: id, cause: { type: "reaction", id: cause } });
  (s.exposures ??= []).push({ by: P, liar, rid, claim: id, real, ev, cause, day: s.day, minute: s.minute });
  return id;
}
// what a woman said that she doubted turns out to be backed by someone else: she was
// telling the truth, and whoever doubted her takes it back
function clearedBy(s, P, rid, S, cause, gain = 0.3) {
  const root = B.rootOf(s, rid);
  const doubted = new Set((s.moves || []).filter((m) => m.rid && m.by !== S && m.by !== P && m.judged?.[P] && (m.rid === rid || B.rootOf(s, m.rid) === root)).map((m) => m.by));
  let n = 0;
  for (const T of doubted) {
    if (B.suspicion(s, P, T) < 0.15) continue;
    B.suspect(s, P, T, { by: -Math.min(0.5, gain * 0.9), why: "she was telling the truth after all", cause });
    if (T !== "player" && s.rel[P][T]) M.shift(s, P, T, { trust: Math.min(0.5, gain * 0.9), why: `she was telling the truth about ${nm(s, s.rumors[rid].about)} after all`, cause });
    n++;
  }
  return n;
}
// a friend of hers on the receiving end of someone's nastiness (not her)
function friendHit(s, P, S, mv) {
  const f = mv.about && mv.about !== P ? mv.about : (mv.to || []).find((x) => x !== P && x !== S);
  return f && f !== "player" && (s.rel[P][f]?.affinity || 0) >= 1 && !aimedAt(mv, P) ? f : null;
}
// an insult, threat or compliment is aimed at whoever it's about; with nobody named, at whoever hears it
const aimedAt = (mv, P) => (mv.about ? mv.about === P : (mv.to || []).includes(P));
// what she does about being run down behind her back
function payback(s, v, S, pick, did, nowTargets, out) {
  if (!pick || pick === "nothing" || !present(s, S)) return 0;
  if (pick === "vote_out") { M.planVote(s, v, S, `heard ${nm(s, S)} run her down behind her back`, { strength: 1.75, cause: did }); return 1; }
  queueAct(s, v, { kind: "confront", target: S }, did, nowTargets, out, pick === "confront_now");
  return 1;
}

function queueAct(s, v, item, did, nowTargets, out, now) {
  const key = item.target;
  let cause = { type: "reaction", id: did };
  if (now && nowTargets.has(key)) {
    stats.clashes++;
    const first = nowTargets.get(key);
    (s.clashes ??= []).push({ id: nextId(s, "x"), target: key, first: first.by, second: v.id, decision: did, firstDecision: first.did, day: s.day, minute: s.minute });
    now = false;
    item.after = first.by;
  }
  if (now) nowTargets.set(key, { by: v.id, did });
  M.pushAgenda(s, v, { ...item, now: !!now, cause }, { front: !!now });
  out.agenda.push({ by: v.id, ...item, now: !!now });
}

function stormOff(s, v, cause) {
  M.stir(s, v, { anger: 0.6, why: "she stormed off", cause });
  v.leaving = cause;
}

// ---------- the player takes things in ----------
function playerTakesIn(s, ev, moves, how) {
  if (how === "saw") return;
  for (const mv of moves) {
    if (!mv.rid) {
      if ((mv.type === "promise" || mv.type === "plan") && mv.to?.includes("player")) continue; // kept in the promise book
      continue;
    }
    if (how === "partial" && !heardSpan(ev, "player", mv, s)) continue;
    const rid = how === "partial" ? garble(s, mv, "player", ev) : mv.rid;
    B.learn(s, "player", rid, { conf: how === "partial" ? 0.3 : 0.5, from: ev.actor, ev: ev.id, how: how === "addressed" ? "told" : how, partial: how === "partial", cause: mv.id });
  }
}

export function trackRecord(s, id) {
  const mine = (s.ledger || []).filter((c) => c.by === id && c.status !== "open");
  if (!mine.length) return 0;
  return (mine.filter((c) => c.status === "kept").length - mine.filter((c) => c.status === "broken").length) / mine.length;
}

// ---------- event rounds (gifts, fights, ballots, snooping…) ----------
// build(P, how) -> { view, qs, label } | null ; commit(P, how, answers) in a fixed order
export async function fanOut(s, { ev, perceivers = ev.perceivers, build: mk, commit, depth = 0 }) {
  stats.rounds++;
  const reqs = [];
  for (const p of perceivers) {
    if (p.id === "player" || !isWoman(s, p.id)) continue;
    const r = mk(p.id, p.how);
    if (r) reqs.push({ P: p.id, how: p.how, ...r });
  }
  const started = [];
  const ans = await Promise.all(reqs.map((r) => { started.push(Date.now()); stats.requests++; return decide(s, r.P, r.view, r.qs, r.label, ev.id, r.describe); }));
  (s.rounds ??= []).push({ ev: ev.id, n: reqs.length, spread: started.length ? Math.max(...started) - Math.min(...started) : 0, depth, day: s.day, minute: s.minute });
  const order = reqs.map((r, i) => [r, ans[i]]).sort(([a], [b]) => (a.P < b.P ? -1 : 1));
  const results = {};
  for (const [r, a] of order) results[r.P] = commit(r.P, r.how, a) ?? a;
  return results;
}
