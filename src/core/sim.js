// The living town: the clock and the systems that run on the shared record. Every mechanic
// here (talking to the newcomer, gifts, snooping, the Whisper board, cat fights, the vote)
// is just another way to put events into the world log and moves into the record; the
// women judge them through Jev (react.js), and code commits what they decide.
//
// The sim talks to the page through `ui` hooks (all optional):
//   moved(v) / arrived(v)          she set off / got somewhere (v.dest, v.spot)
//   pair(a, b)                     two people stop to talk; b walks over to a
//   exchange({ a, b, lines, full }) a line the newcomer overheard, already committed
//   toPlayer({ talk, by, text })   a woman said something to the newcomer (committed)
//   fightPlayer(id, by)            a cat fight with the newcomer: the page plays it
//   fight(a, b, { winner })        a cat fight between two women in view
//   emote(id, symbol)              a visible reaction over someone's head
//   gift(id, how)                  how a gift landed, on her face
//   heard()                        the newcomer learned something new
//   first(kind)                    something happened for the first time (tips)

import * as R from "./record.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import * as T from "./talk.js";
import * as A from "./agents.js";
import * as voice from "./voice.js";
import * as runtime from "./runtime.js";
import * as rng from "./rng.js";
import * as jev from "./jev.js";
import { view, placeName as placeNameV, inSight } from "./views.js";
import { check, register, grounded } from "./moves.js";
import { round, fanOut, settleClaim, deliveryText } from "./react.js";
import { PLACES, SHOW, ITEMS, TASTES, VILLAGERS, START_REL, START_ALLIANCES } from "./cast.js";
import { pos, dist, locOf, centre } from "./space.js";
import { mailbox, BOARD_STAND, placeAt } from "../client/layout.js";
export { deedText } from "./mind.js";

const nm = M.nm;

// ---------- small helpers the page uses ----------
export const clock = M.clock;
export const alive = A.alive;
export const placeName = placeNameV;
export const nameOf = (s, id) => (id === "player" ? s.player.name : id === "primrose" ? "Primrose" : id === "board" ? "an anonymous note" : s.people[id] ? s.people[id].name : id || "someone");
export const firstOf = (s, id) => nm(s, id);
export const daysToVote = (s) => (SHOW.voteEvery - (s.day % SHOW.voteEvery)) % SHOW.voteEvery;
export const isVoteDay = (s) => daysToVote(s) === 0;
export const feel = M.feel;
export const alliancesOf = (s, id) => s.alliances.filter((a) => a.members.includes(id) && a.members.filter((m) => m === "player" || !s.people[m]?.gone).length >= 2);
const present = (s, id) => (id === "player" ? !s.player.out : !!s.people[id] && !s.people[id].gone);
const short = (t, n = 70) => (String(t).length > n ? String(t).slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : String(t));

// What the newcomer can read off a woman: only the tone of what she has said to her face
// and the reactions she has seen, never the numbers in her head.
export function vibe(s, id) {
  const mine = (s.player.mem || []).filter((m) => m.ev && m.about?.includes(id)).slice(-12);
  let score = 0, n = 0;
  for (const m of mine) {
    const ev = R.evById(s, m.ev);
    if (!ev || ev.actor !== id) continue;
    if (ev.type === "line" && ev.targets.includes("player")) { score += { warm: 1, friendly: 0.7, "sweet-but-fake": 0, neutral: 0, guarded: -0.4, cool: -0.7, hostile: -1.2, nervous: 0 }[ev.content.tone] ?? 0; n++; }
    if (ev.type === "outburst" && ev.targets.includes("player")) { score -= 1; n++; }
    if (ev.type === "fight" && (ev.targets.includes("player") || ev.actor === "player")) { score -= 1.5; n++; }
  }
  if (!n) return "hasn't said much to you yet";
  const x = score / n;
  return x >= 0.6 ? "has been warm with you" : x >= 0.2 ? "has been friendly" : x <= -0.8 ? "has been hostile to you" : x <= -0.3 ? "has been cool with you" : "is hard to read";
}

// ---------- the season before the season ----------
// Everyone's starting knowledge is written as day-0 history events she perceived, so every
// belief has a channel: her own secret, what leaked, her old friendships and grudges, the
// pacts already made.
export function seedHistory(s) {
  rng.bind(s);
  jev.setSeed(s.seed);
  const H = (text, who, about = null) => R.emit(s, { type: "history", content: { text, about }, perceivers: who.map((id) => ({ id, how: "did" })), cause: "rule:history" });
  for (const v of VILLAGERS) {
    const p = s.people[v.id];
    for (const text of v.secrets) {
      const rid = B.newClaim(s, { about: v.id, text, origin: "truth", isTrue: true, harm: -1.5, kind: "secret", cat: "world", prop: { subject: v.id, pred: "secret", obj: null, pol: 1 } });
      const ev = H(`My secret: ${text}`, [v.id]);
      s.rumors[rid].ev = ev.id;
      B.learn(s, v.id, rid, { conf: 1, from: "self", ev: ev.id, root: "truth", how: "saw", cause: ev.id });
      B.addSecret(s, v.id, rid);
    }
  }
  // a few secrets have already leaked
  const leak = (about, to, from, conf) => {
    const sec = B.secretOf(s, about);
    const ev = H(from === "self" ? `I found out: ${s.rumors[sec.rid].text}` : `${nm(s, from)} told me: ${s.rumors[sec.rid].text}`, from === "self" ? [to] : [to, from], about);
    B.learn(s, to, sec.rid, { conf, from, ev: ev.id, root: from === "self" ? "saw" : from, how: from === "self" ? "saw" : "told", cause: ev.id });
  };
  leak("marigold", "odette", "self", 1);
  leak("marigold", "wren", "odette", 0.6);
  leak("sylvie", "tansy", "self", 0.7);
  leak("brenna", "pippa", "self", 0.2);
  // old feelings, as she remembers them, and what she thinks of people because of them
  for (const [a, b, af, , note] of START_REL) {
    const ev = H(`${nm(s, b)}: ${note}`, [a], b);
    s.rel[a][b].why = [{ text: note, day: 0, w: Math.abs(af) * 0.6, sign: Math.sign(af) || 1, cause: ev.id }];
    if (af <= -1 || af >= 1.5) {
      const tr = s.people[b].traits[af < 0 ? 1 : 0];
      const rid = B.newClaim(s, { about: b, text: `${nm(s, b)} is ${tr}.`, origin: a, isTrue: null, harm: af < 0 ? -0.8 : 0.6, kind: "gossip", cat: "trait", prop: { subject: b, pred: "is", obj: null, pol: 1 } });
      B.learn(s, a, rid, { conf: 0.65, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
    }
  }
  for (const v of A.alive(s)) {
    const ks = Object.keys(v.knows).map((r) => s.rumors[r]);
    if (!ks.some((r) => r.cat === "trait")) {
      const b = VILLAGERS.find((o) => o.id !== v.id && (s.rel[v.id][o.id].affinity ?? 0) >= 0.3) || VILLAGERS.find((o) => o.id !== v.id);
      const ev = H(`What I've always thought of ${nm(s, b.id)}`, [v.id], b.id);
      const rid = B.newClaim(s, { about: b.id, text: `${nm(s, b.id)} is ${b.traits[0]}.`, origin: v.id, isTrue: null, harm: 0.2, cat: "trait", prop: { subject: b.id, pred: "is", obj: null, pol: 1 } });
      B.learn(s, v.id, rid, { conf: 0.5, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
    }
    // what she thinks someone thinks of her: a belief about another mind
    const worst = Object.entries(s.rel[v.id]).filter(([id]) => id !== "player").sort((p, q) => p[1].affinity - q[1].affinity)[0][0];
    const ev = H(`I've always had the feeling ${nm(s, worst)} has it in for me`, [v.id], worst);
    const rid = B.newClaim(s, { about: worst, text: `${nm(s, worst)} has it in for ${nm(s, v.id)}.`, origin: v.id, isTrue: null, harm: -0.5, kind: "gossip", cat: "mind", prop: { subject: worst, pred: "dislikes", obj: v.id, pol: 1 } });
    B.learn(s, v.id, rid, { conf: 0.5, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
  }
  // the pacts already made: each is a commitment by each member, and they know it
  for (const sa of START_ALLIANCES) {
    const [m1, m2] = sa.members;
    const ev = H(`${nm(s, m1)} and ${nm(s, m2)} made a secret pact before the season: ${sa.name}`, sa.members);
    const al = { id: R.nextId(s, "al"), name: sa.name, members: [...sa.members], day: 0, terms: "vote together and look out for each other", sincere: {}, loyal: {}, commits: {}, history: [{ day: 0, minute: 0, what: "formed", cause: ev.id }] };
    for (const m of sa.members) {
      const other = sa.members.find((x) => x !== m);
      const c = M.commit(s, { by: m, to: other, kind: "pact", what: `stick together (${sa.name})`, sincere: true, sincerity: ev.id, heard: sa.members, level: 0, cause: ev.id });
      al.sincere[m] = true; al.loyal[m] = true; al.commits[m] = c.id;
      R.change(s, { who: m, what: "alliance", key: al.id, from: null, to: "member", cause: ev.id });
    }
    s.alliances.push(al);
    const rid = B.newClaim(s, { about: m1, text: `${nm(s, m1)} and ${nm(s, m2)} have a secret pact.`, origin: "truth", isTrue: true, harm: 0, kind: "pact", cat: "mind", prop: { subject: m1, pred: "allied", obj: m2, pol: 1 } });
    for (const m of sa.members) B.learn(s, m, rid, { conf: 1, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
  }
  for (const v of A.alive(s)) A.seedGoals(s, v, "rule:season-start");
}

// ---------- the clock: one tick every 5 in-game minutes ----------
// Starts what is due and returns a promise for all of it; the page doesn't wait on it (the
// town keeps moving), the headless harness does.
export function tick(s, ui) {
  if (s.phase !== "day" || s.over) return Promise.resolve();
  rng.bind(s);
  const jobs = [];
  ui = { ...ui, readBoard: (v, c) => readBoard(s, v, c, ui), postBoard: (v, it, c) => npcPost(s, v, it, c, ui) };
  A.arrivals(s, ui);
  const show = s.event && s.event.day === s.day && !s.event.done ? s.event : null;
  const bell = isVoteDay(s) && s.minute >= 19 * 60;
  if (bell) {
    if (s.bellDay !== s.day) { s.bellDay = s.day; announce(s, "The bell is ringing: everyone to the firepit for the vote!", "rule:vote-bell"); }
    for (const v of A.alive(s)) if (v.location !== "firepit" && v.dest !== "firepit" && !T.busy(s, v.id)) A.travel(s, v, "firepit", "rule:vote-bell", ui);
  } else if (show && s.minute >= show.minute - 30) {
    if (!show.called) { show.called = true; announce(s, `Primrose is gathering everyone at ${placeName(show.place)} for the show!`, "rule:show"); }
    for (const v of A.alive(s)) if (v.location !== show.place && v.dest !== show.place && !T.busy(s, v.id)) A.travel(s, v, show.place, "rule:show", ui);
  } else {
    for (const v of A.alive(s)) if (A.idle(s, v)) jobs.push(A.next(s, v, ui));
  }
  jobs.push(...T.advance(s, ui));
  jobs.push(T.flushUnjudged(s, ui));
  // a woman who walked up to the newcomer doesn't wait forever for an answer
  for (const t of Object.values(s.talks)) if (t.status === "active" && t.stage === "await_player" && R.now(s) - (t.waitFrom ??= R.now(s)) > 20) T.end(s, t, `${s.player.name} never answered`, "rule:timeout", ui);
  // every in-game hour: feelings settle a little, and everyone takes stock
  const hk = s.day * 24 + Math.floor(s.minute / 60);
  if (s.lastHour !== hk) {
    const first = s.lastHour == null;
    s.lastHour = hk;
    if (!first) { M.driftFeelings(s, 1); for (const v of A.alive(s)) M.driftMood(s, v, 1); }
    if (!bell) for (const v of A.alive(s)) jobs.push(A.reconsider(s, v, ui));
  }
  while (s.pendingFights?.length) jobs.push(fightFrom(s, s.pendingFights.shift(), ui));
  jobs.push(lookAround(s, ui));
  return Promise.all(jobs.map((p) => Promise.resolve(p).catch((e) => { console.error("tick job failed", e); R.violation(s, "job-failed", { e: String(e?.stack || e).slice(0, 300) }); })));
}

// Primrose's announcements are heard all over town
export function announce(s, text, cause) {
  const per = [...A.alive(s).map((v) => ({ id: v.id, how: "overheard" })), ...(s.player.out ? [] : [{ id: "player", how: "overheard" }])];
  return R.emit(s, { type: "announcement", actor: "primrose", content: { text }, perceivers: per, cause, place: null });
}

// women who catch sight of the newcomer in a look they haven't judged yet
let looking = false;
async function lookAround(s, ui) {
  if (looking || !s.player.debuted || s.player.out) return;
  const looks = await import("./looks.js");
  looking = true;
  try { await looks.notice(s, ui); } finally { looking = false; }
}

// ---------- talking with the newcomer ----------
export const playerTalk = (s) => T.talkOf(s, "player");

export function startTalk(s, id, ui) {
  if (!present(s, id) || T.busy(s, "player")) return T.talkOf(s, "player")?.b === id || T.talkOf(s, "player")?.a === id ? T.talkOf(s, "player") : null;
  if (T.busy(s, id)) {
    // walking up on two women talking: she breaks off to talk to the newcomer
    const t0 = T.talkOf(s, id);
    T.end(s, t0, `${s.player.name} walked up`, "player:interrupt", ui);
  }
  runtime.note({ t: "talk", id });
  return T.open(s, "player", id, { reason: "the newcomer came over to talk", cause: "player:talk", ui });
}

export function endTalk(s, reason = "the newcomer walked off", ui) {
  const t = T.talkOf(s, "player");
  if (t) T.end(s, t, reason, "player:walk-away", ui);
}

// What the newcomer types goes through the same extractor and the same judgments as
// anyone's words. Returns { reply, leaving, fight, failed }.
export async function playerSays(s, text, ui) {
  const t = T.talkOf(s, "player");
  if (!t || t.stage !== "await_player") return null;
  runtime.note({ t: "say", text });
  const O = t.a === "player" ? t.b : t.a;
  t.stage = "player_line";
  const history = t.turns.map((x) => `${x.by === "player" ? s.player.name : nm(s, x.by)}: ${x.text}`).slice(-8);
  const carrying = s.player.carrying ? ITEMS[s.player.carrying].name : null;
  const setting = `${s.player.name} (the newcomer) is talking with ${nm(s, O)} at ${placeName(t.place)}.`;
  let raw = await voice.extract(s, { line: text, speaker: s.player.name, listeners: [nm(s, O)], history, playerName: s.player.name, carrying, setting });
  if (raw == null && !voice.available()) { t.stage = "await_player"; T.end(s, t, "nobody could make out what was said (dialogue unavailable)", "rule:voice-down", ui); return { failed: true, leaving: true }; }
  let res = check(s, raw || [], { line: text, speaker: "player", listeners: [O] });
  if (res.rejects.length) {
    for (const r of res.rejects) logReject(s, "player", text, r, true);
    const again = await voice.extract(s, { line: text, speaker: s.player.name, listeners: [nm(s, O)], history, playerName: s.player.name, carrying, setting });
    const res2 = check(s, again || [], { line: text, speaker: "player", listeners: [O] });
    for (const r of res2.rejects) logReject(s, "player", text, r, false);
    if (res2.moves.length >= res.moves.length) res = res2;
  }
  // saying yes to something she asked: the newcomer's commitment takes its shape from the ask
  const lastAsk = [...t.turns].reverse().find((x) => x.by === O)?.moves.map((id) => s.moves.find((m) => m.id === id)).find((m) => m?.type === "request");
  for (const mv of res.moves) if (mv.type === "agreement" && lastAsk) { mv.kind = mv.kind || lastAsk.kind || "other"; mv.target = mv.target || lastAsk.target || null; mv.content = lastAsk.content; mv.to = [O]; }
  const L = T.commitLine(s, t, "player", O, { line: text, moves: res.moves, tone: res.tone }, { decision: "player:say", pick: null }, ui);
  for (const mv of L.moves) if (mv.rid && ["claim", "accusation", "secret"].includes(mv.type)) s.player.told.push({ rid: mv.rid, to: O, day: s.day, time: clock(s.minute), mv: mv.id });
  const gift = L.moves.find((m) => m.type === "gift");
  if (gift && s.player.carrying) await giveGift(s, "player", O, s.player.carrying, L.ev, ui);
  if (L.moves.some((m) => m.type === "attack")) { T.end(s, t, `${s.player.name} went for her`, L.ev.id, ui); return { fight: { by: "player", with: O, cause: L.ev.id }, leaving: true }; }
  const r = await round(s, {
    ev: L.ev, moves: L.moves, speaker: "player", addressed: [O], talk: t.id, tone: L.tone,
    replyFor: O, replyOptions: (Q, { visible }) => T.intentOptions(s, Q, "player", t, { replying: true, visible }),
  });
  T.commitAnswers(s, t, L, O);
  if (r.fight) {
    T.end(s, t, "it turned into a cat fight", r.fight.cause, ui);
    if (r.fight.at === "player" || r.fight.by === "player") return { fight: { by: r.fight.by, with: O, cause: r.fight.cause }, leaving: true };
    (s.pendingFights ??= []).push(r.fight);
    return { leaving: true };
  }
  const rep = r.replies[O];
  if (!rep || t.status !== "active") { if (t.status === "active") T.end(s, t, `${nm(s, O)} had nothing to say`, L.ev.id, ui); return { leaving: true, reply: null }; }
  t.plan = T.planFromReply(s, t, O, "player", rep, L);
  t.next = O; t.stage = "write"; t.waitFrom = null;
  const before = t.turns.length;
  const t0 = Date.now();
  await T.runUntil(s, t, ui);
  runtime.timed("reply", Date.now() - t0);
  const said = t.turns.slice(before).find((x) => x.by === O);
  if (t.status === "active") t.waitFrom = R.now(s);
  return { reply: said?.text || null, leaving: t.status !== "active", endReason: t.end?.reason || null };
}

function logReject(s, who, line, r, retry) {
  (s.rejects ??= []).push({ who, line, why: r.why, move: r.move ? JSON.stringify(r.move).slice(0, 200) : null, retry, day: s.day, minute: s.minute });
  if (s.rejects.length > 200) s.rejects.shift();
}

// ---------- gifts ----------
// The receiver judges taste, motive and what she owes; anyone who saw it wonders about it.
export async function giveGift(s, by, to, item, lineEv, ui) {
  const ev = R.emit(s, { type: "gift", actor: by, targets: [to], content: { item: ITEMS[item].name, key: item }, cause: lineEv?.id || `player:gift` });
  if (by === "player") s.player.carrying = null;
  const tension = isVoteDay(s) ? Math.max(0, Math.min(1, (s.minute - 8 * 60) / (11 * 60))) : 0.1;
  const taste = TASTES[to] || {};
  const gn = nm(s, by);
  const res = await fanOut(s, {
    ev,
    build: (P, how) => {
      const v = s.people[P];
      if (P === to) {
        const loves = taste.loves === item, hates = taste.hates === item;
        // a present from someone she barely knows, on vote day, looks more like a bribe
        const rB = s.rel[P][by] || M.newRel(0, 0);
        const stranger = Math.max(0, 1 - (v.mem || []).filter((m) => m.about?.includes(by)).length / 6 - (Math.abs(rB.affinity) + Math.abs(rB.trust)) / 3);
        return {
          view: view(s, P, { with: [by], moment: `${gn} just handed you ${ITEMS[item].name}.${isVoteDay(s) ? " The vote is tonight." : ""}` }),
          label: `gift:${P}<-${by}`,
          qs: {
            like: { type: "score", instructions: `${gn} gives ${nm(s, P)} ${ITEMS[item].name}. How much does she like it, by her own taste?`, criteria: ["Hates it", "Doesn't care for it", "It's fine", "Likes it", "Loves it"], prior: Math.max(0, Math.min(4, (loves ? 3.7 : hates ? 0.3 : 2) + Math.max(-0.4, Math.min(0.4, (s.rel[P][by]?.affinity ?? 0) * 0.2)) * (loves || hates ? 0.5 : 1))) },
            motive: { type: "choice", instructions: `Why does ${nm(s, P)} think ${gn} gave it to her?`, criteria: { kindness: "Just being nice", favor: "Wants a favor from her", vote: "Trying to buy her vote" }, prior: { kindness: 1.4 + Math.max(0, s.rel[P][by]?.trust ?? 0) * 0.4 + Math.max(0, s.rel[P][by]?.affinity ?? 0) * 0.3, favor: 0.5 + v.bias.scheme * 0.5, vote: (0.15 + tension * 2.2 * (1 + stranger) + v.bias.scheme * 0.6) * Math.max(0.3, 1 - Math.max(0, s.rel[P][by]?.trust ?? 0) * 0.3 - Math.max(0, s.rel[P][by]?.affinity ?? 0) * 0.1) + Math.max(0, -(s.rel[P][by]?.trust ?? 0)) * 0.3 + Math.max(0, -(s.rel[P][by]?.affinity ?? 0)) * 0.3 } },
          },
        };
      }
      if (how === "saw" && dist(s, P, to) > 14) return null;
      return {
        view: view(s, P, { with: [by, to], small: true, moment: `You saw ${gn} hand ${nm(s, to)} a present.` }),
        label: `gift-seen:${P}`,
        qs: { buying: { type: "noul", instructions: `Does ${nm(s, P)} think ${gn} is trying to buy votes with presents?`, prior: Math.min(0.9, 0.08 + tension * 0.5 + v.bias.scheme * 0.2 + Math.max(0, -(s.rel[P][by]?.trust ?? 0)) * 0.1) } },
      };
    },
    commit: (P, how, a) => {
      const buyingRid = () => B.findClaim(s, { about: by, text: `${gn} is trying to buy votes with presents.` }) || B.newClaim(s, { about: by, text: `${gn} is trying to buy votes with presents.`, origin: P, isTrue: null, harm: -0.9, kind: "gossip", cat: "mind", prop: { subject: by, pred: "buys_votes", obj: null, pol: 1 } });
      if (P === to) {
        const lv = a.like.value;
        M.shift(s, P, by, { aff: (lv - 2) * 0.4, debt: lv >= 3 ? 0.9 : lv >= 2 ? 0.35 : 0, why: lv >= 3 ? `gave me ${ITEMS[item].name}, which I loved` : lv <= 1 ? `gave me ${ITEMS[item].name}, which I can't stand` : null, cause: a._id });
        if (a.motive.pick === "vote") { B.infer(s, P, { from: [], rid: buyingRid(), conf: 0.55, why: "a present right before the vote", cause: a._id }); M.shift(s, P, by, { trust: -0.35, why: "trying to buy my vote", cause: a._id }); }
        if (a.motive.pick === "favor") M.shift(s, P, by, { trust: -0.1, cause: a._id });
        M.reweigh(s, P, ev.id, lv >= 3.5 || lv <= 0.5 ? 3 : 2, a._id);
        const face = a.motive.pick === "vote" ? "suspicious" : lv >= 3 ? "delighted" : lv >= 1.5 ? "pleased" : "insulted";
        ui?.gift?.(P, face);
        return { like: lv, motive: a.motive.pick, face };
      }
      if (a.buying?.yes) B.learn(s, P, buyingRid(), { conf: 0.45, from: "self", ev: ev.id, root: "saw", how: "saw", cause: a._id });
      return { buying: !!a.buying?.yes };
    },
  });
  ui?.first?.("gift");
  return { ev, res };
}

export function pickUp(s, item, ui) {
  if (!ITEMS[item]) return null;
  s.player.carrying = item;
  runtime.note({ t: "pickup", item });
  ui?.first?.("gift");
  return ITEMS[item];
}

// ---------- mailbox snooping ----------
// The snooper learns what she finds; anyone who sees her may realize what she's doing.
const MUNDANE = ["Bills, a coupon for the salon, and a very dull letter from an aunt.", "A seed catalogue and a note that just says 'Thursday?'", "Nothing juicy. Just a recipe for lemon bars."];
export async function snoop(s, ownerId, ui) {
  const owner = s.people[ownerId];
  if (!owner) return { found: null, caught: [] };
  if (owner.gone) return { found: "An empty mailbox. She's gone.", caught: [], gone: true };
  if (s.player.snooped[ownerId] === s.day) return { found: "You already went through it today. Nothing new.", caught: [], again: true };
  runtime.note({ t: "snoop", owner: ownerId });
  s.player.snooped[ownerId] = s.day;
  const at = mailbox(ownerId)?.stand || pos(s, "player");
  const sec = B.secretOf(s, ownerId);
  const fresh = sec && !((s.player.knows || {})[sec.rid]?.conf >= 0.9);
  const per = R.whoPerceives(s, { actor: "player", at, place: "lane" });
  // her front window looks onto her mailbox
  if (owner.location === "home" && !per.some((p) => p.id === ownerId)) per.push({ id: ownerId, how: "saw" });
  const found = fresh ? s.rumors[sec.rid].text : MUNDANE[Math.floor(rng.rand() * MUNDANE.length)];
  const ev = R.emit(s, { type: "snoop", actor: "player", place: "lane", at, perceivers: per, content: { owner: ownerId, found }, cause: "player:snoop" });
  if (fresh) B.learn(s, "player", sec.rid, { conf: 0.95, from: "self", ev: ev.id, root: "saw", how: "saw", cause: ev.id });
  const pn = s.player.name, on = nm(s, ownerId);
  const caught = [];
  await fanOut(s, {
    ev, perceivers: ev.perceivers.filter((p) => p.id !== "player"),
    build: (P, how) => ({
      view: view(s, P, { with: ["player"], small: true, moment: `${P === ownerId ? "Through your window you see" : "You see"} ${pn} standing at ${P === ownerId ? "your" : `${on}'s`} mailbox.` }),
      label: `snoop-seen:${P}`,
      qs: {
        notice: { type: "noul", instructions: `Does ${nm(s, P)} realize ${pn} is going through ${P === ownerId ? "her" : `${on}'s`} mail?`, prior: Math.min(0.92, (how === "overheard" ? 0.7 : how === "partial" ? 0.55 : 0.3) + s.people[P].bias.nosy * 0.25 + (P === ownerId ? 0.2 : 0)) },
        act: P === ownerId
          ? { type: "choice", instructions: "If she noticed, what does she do about it?", criteria: { nothing: "Nothing, but she'll remember", now: `Go out and confront ${pn} right now`, later: `Confront ${pn} later` }, prior: { nothing: 1, now: s.people[P].bias.temper * 1.4, later: 1 } }
          : { type: "choice", instructions: "If she noticed, what does she do about it?", criteria: { nothing: "Keeps it to herself", warn: `Warns ${on}`, spread: "Tells people" }, prior: { nothing: 1.2, warn: 0.3 + Math.max(0, s.rel[P][ownerId]?.affinity ?? 0) * 0.6, spread: s.people[P].bias.gossip * 1.2 } },
      },
    }),
    commit: (P, how, a) => {
      if (!a.notice.yes) return;
      caught.push(P);
      const rid = B.findClaim(s, { about: "player", text: `${pn} was snooping through ${on}'s mail.` }) || B.newClaim(s, { about: "player", text: `${pn} was snooping through ${on}'s mail.`, origin: "truth", isTrue: true, harm: -1.5, kind: "gossip", cat: "world", prop: { subject: "player", pred: "snooped", obj: ownerId, pol: 1 } });
      B.learn(s, P, rid, { conf: 0.9, from: "self", ev: ev.id, root: "saw", how: "saw", cause: a._id });
      M.shift(s, P, "player", { trust: -0.8, aff: P === ownerId ? -1.4 : -0.4, why: P === ownerId ? "went through my mail" : `snooped in ${on}'s mail`, cause: a._id });
      M.reweigh(s, P, ev.id, P === ownerId ? 4 : 2.5, a._id);
      const v = s.people[P];
      if (P === ownerId) {
        M.stir(s, v, { anger: 1.5, why: `${pn} went through her mail`, cause: a._id });
        if (sec) {
          const kr = B.newClaim(s, { about: "player", text: `${pn} read ${on}'s letters and knows her secret.`, origin: P, isTrue: !!fresh, harm: -1, cat: "mind", prop: { subject: "player", pred: "knows_secret", obj: ownerId, pol: 1 } });
          B.infer(s, P, { from: [rid], rid: kr, conf: 0.7, why: "she was at my mailbox, so she read my letters", cause: a._id });
        }
        if (a.act.pick !== "nothing") M.pushAgenda(s, v, { kind: "confront", target: "player", rumor: rid, now: a.act.pick === "now", cause: { type: "reaction", id: a._id } }, { front: a.act.pick === "now" });
      } else if (a.act.pick === "warn" && present(s, ownerId)) M.pushAgenda(s, v, { kind: "warn", target: ownerId, rumor: rid, cause: { type: "reaction", id: a._id } });
      else if (a.act.pick === "spread") M.pushAgenda(s, v, { kind: "spread", target: null, rumor: rid, cause: { type: "reaction", id: a._id } });
      ui?.emote?.(P, "suspicious");
    },
  });
  ui?.first?.("snoop");
  return { found, caught, isSecret: !!fresh, ev: ev.id };
}

// ---------- the Whisper board ----------
// Posts are anonymous claims. Readers judge them and may work out who wrote one from what
// they themselves remember (who they saw at the board, who has a grudge).
export const BOARD_PLACE = placeAt(BOARD_STAND.x, BOARD_STAND.z) === "lane" ? "plaza" : placeAt(BOARD_STAND.x, BOARD_STAND.z);
export async function postNote(s, text, ui) {
  runtime.note({ t: "post", text });
  const raw = await voice.extract(s, { line: text, speaker: "An anonymous note", listeners: ["the whole town"], playerName: s.player.name, setting: `${s.player.name} (the newcomer) is writing an anonymous note to pin on the Whisper board in town.` });
  const res = check(s, raw || [], { line: text, speaker: "player", listeners: [] });
  for (const r of res.rejects) logReject(s, "player", text, r, false);
  const ev = R.emit(s, { type: "board_post", actor: "player", place: BOARD_PLACE, at: BOARD_STAND, content: { text, anon: true }, cause: "player:post" });
  const moves = res.moves.map((m) => register(s, { ...m, to: [] }, { ev: ev.id, talk: null }));
  ev.content.moves = moves.map((m) => m.id);
  for (const mv of moves) if (["claim", "accusation", "secret"].includes(mv.type)) { settleClaim(s, mv, { speaker: "player", ev: ev.id }); s.rumors[mv.rid].anon = true; s.player.told.push({ rid: mv.rid, to: "board", day: s.day, time: clock(s.minute), mv: mv.id }); }
  const note = { id: R.nextId(s, "n"), ev: ev.id, text, rids: moves.filter((m) => m.rid).map((m) => m.rid), about: moves.find((m) => m.about)?.about || null, author: "player", day: s.day, readBy: [] };
  s.notes.push(note);
  if (s.notes.length > 8) s.notes.shift();
  ui?.first?.("note");
  return { id: note.id, about: note.about };
}

// A woman reads the notes she hasn't read (agents.js sends her when she decides to).
export async function readBoard(s, v, cause, ui) {
  const live = (s.notes || []).filter((n) => s.day - n.day <= 1 && !n.readBy.includes(v.id) && n.author !== v.id).slice(0, 2);
  for (const n of live) {
    n.readBy.push(v.id);
    const ev = R.emit(s, { type: "board_read", actor: v.id, place: BOARD_PLACE, at: BOARD_STAND, content: { text: n.text, note: n.id }, cause });
    const X = n.about;
    const aboutHer = X === v.id;
    // who might have written it, from her own memories
    const cands = [...A.alive(s).map((o) => o.id), ...(s.player.out ? [] : ["player"])].filter((id) => id !== v.id && id !== X);
    const prior = { nobody: 2 };
    const crit = { nobody: "She can't tell who wrote it" };
    for (const c of cands) {
      let p = 0.15;
      for (const m of v.mem || []) {
        const e = m.ev && R.evById(s, m.ev);
        if (!e) continue;
        if (e.type === "board_post" && e.actor === c && R.now(s) - (e.day * 1440 + e.minute) < 1440) p += 3;
        if (X && (e.type === "line" || e.type === "show_line") && e.actor === c && m.about?.includes(X) && ["hostile", "cool"].includes(e.content.tone)) p += 0.8;
        if (X && e.type === "fight" && (e.actor === c || e.targets.includes(c)) && (e.actor === X || e.targets.includes(X))) p += 1.2;
      }
      p += B.suspicion(s, v.id, c) * 1.5;
      // a grudge she knows about: someone she believes has it in for the woman the note is about
      if (X) for (const [rid, k] of Object.entries(v.knows)) { const r = s.rumors[rid]; if (k.conf >= 0.4 && r.about === c && r.prop?.obj === X && (r.harm || 0) < 0 && (r.prop.pol ?? 1) === 1) p += 1.4 * k.conf; }
      if (X && (s.rel[c]?.[X]?.affinity ?? 0) <= -1 && (v.mem || []).some((m) => m.about?.includes(c) && m.about?.includes(X))) p += 0.5;
      if (p > 0.4) { crit[c] = nm(s, c); prior[c] = p; }
    }
    const qs = { author: { type: "choice", instructions: `Who does ${nm(s, v.id)} think wrote this anonymous note: "${n.text}"?`, criteria: crit, prior } };
    n.rids.forEach((rid, i) => { if (s.rumors[rid]) qs[`b${i}`] = { type: "score", instructions: `How much does she believe it: "${s.rumors[rid].text}"?`, criteria: ["Not at all", "Doubts it", "Half believes it", "Believes it", "Sure it's true"], prior: aboutHer ? (B.secretOf(s, v.id) && B.rootOf(s, rid) === B.secretOf(s, v.id).root ? 4 : 0.3) : 1.3 + v.bias.gossip * 0.5 - v.bias.scheme * 0.4 }; });
    const a = await R.decide(s, v.id, view(s, v.id, { about: X, small: true, moment: `You read an anonymous note on the Whisper board: "${n.text}"` }), qs, `board:${v.id}<-${n.id}`, ev.id, (o) => `read the note "${short(n.text, 40)}"${o.author.pick !== "nobody" ? ` and thought ${nm(s, o.author.pick)} wrote it` : ""}`);
    n.rids.forEach((rid, i) => { if (a[`b${i}`]) B.learn(s, v.id, rid, { conf: [0.05, 0.2, 0.45, 0.7, 0.9][Math.round(a[`b${i}`].value)], from: "board", ev: ev.id, root: "board", how: "read", cause: a._id }); });
    const who = a.author.pick;
    if (who !== "nobody") {
      const text = `${nm(s, who)} is the one pinning anonymous notes${X ? ` about ${nm(s, X)}` : ""} on the Whisper board.`;
      const rid = B.findClaim(s, { about: who, text }) || B.newClaim(s, { about: who, text, origin: v.id, isTrue: who === n.author, harm: -1, cat: "world", prop: { subject: who, pred: "wrote_note", obj: X, pol: 1 } });
      B.infer(s, v.id, { from: n.rids.filter((r) => v.knows[r]), rid, conf: 0.6, why: "who else would write that", cause: a._id });
      if (n.rids.length) B.suspect(s, v.id, who, { by: 0.2, because: [rid], why: "writing anonymous notes", cause: a._id });
      M.shift(s, v.id, who, { trust: -0.4, why: "I think she writes those anonymous notes", cause: a._id });
      if (aboutHer) M.pushAgenda(s, v, { kind: "confront", target: who, rumor: rid, cause: { type: "reaction", id: a._id } });
    }
    if (aboutHer) { M.stir(s, v, { anger: 1, why: "an anonymous note about her", cause: a._id }); ui?.emote?.(v.id, "anger"); }
    else ui?.emote?.(v.id, "gasp");
  }
}

// A woman pins her own anonymous note: something she believes, or a lie she chose.
export async function npcPost(s, v, item, cause, ui) {
  const X = item.target;
  const mine = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid].about === X && (s.rumors[rid].harm || 0) < 0).map(([rid]) => rid);
  const a = await R.decide(s, v.id, view(s, v.id, { about: X, small: true, moment: `You're at the Whisper board with a pen, thinking about ${nm(s, X)}.` }), {
    what: { type: "choice", instructions: `What does ${nm(s, v.id)} write in her anonymous note about ${nm(s, X)}?`, criteria: { ...(mine.length ? { truth: `Something she believes: ${s.rumors[mine[0]].text}` } : {}), lie: `A damaging lie about ${nm(s, X)}`, none: "Thinks better of it" }, prior: { ...(mine.length ? { truth: 2 } : {}), lie: v.bias.deceit * 1.2, none: 0.6 + v.bias.loyalty * 0.3 } },
  }, `post:${v.id}`, cause, (o) => (o.what.pick === "none" ? "decided not to pin a note" : `pinned an anonymous note about ${nm(s, X)}`));
  M.doneAgenda(s, v, item, a.what.pick === "none" ? "dropped" : "done", a._id);
  if (a.what.pick === "none" || !voice.available()) return;
  const lie = a.what.pick === "lie" ? { about: X, content: `a made-up damaging story about ${nm(s, X)}`, truth: "she made it up" } : null;
  const intent = lie ? `write an anonymous note with a damaging lie about ${nm(s, X)}` : `write an anonymous note saying [${mine[0]}]: ${s.rumors[mine[0]].text}`;
  const ans = await voice.turn(s, { v, view: view(s, v.id, { about: X, small: true }).payload, to: ["the whole town"], history: [], intent, lie, allowed: mine, playerName: s.player.name, setting: "You are writing an anonymous note to pin on the Whisper board. Nobody must know it's you.", words: "one or two sentences, like an anonymous note" });
  if (!ans?.line) return;
  const res = check(s, ans.moves || [], { line: ans.line, speaker: v.id, listeners: [] });
  const ev = R.emit(s, { type: "board_post", actor: v.id, place: BOARD_PLACE, at: BOARD_STAND, content: { text: ans.line, anon: true }, cause: a._id });
  const moves = res.moves.filter((m) => m.type !== "claim" || m.about).map((m) => register(s, { ...m, to: [] }, { ev: ev.id, talk: null }));
  ev.content.moves = moves.map((m) => m.id);
  for (const mv of moves) if (["claim", "accusation", "secret"].includes(mv.type)) { settleClaim(s, mv, { speaker: v.id, lie, ev: ev.id }); s.rumors[mv.rid].anon = true; }
  s.notes.push({ id: R.nextId(s, "n"), ev: ev.id, text: ans.line, rids: moves.filter((m) => m.rid).map((m) => m.rid), about: X, author: v.id, day: s.day, readBy: [] });
  if (s.notes.length > 8) s.notes.shift();
}

// ---------- cat fights ----------
// Starting one is always a decision with a cause (a shove in a reaction round, or the
// newcomer's own hands). The outcome is an event everyone who saw it remembers.
async function fightFrom(s, f, ui) {
  if (!present(s, f.by) || !present(s, f.at)) return;
  if (f.by === "player" || f.at === "player") {
    const other = f.by === "player" ? f.at : f.by;
    if (ui?.fightPlayer) { ui.fightPlayer(other, f.by, f.cause); return; }
    return brawl(s, f.by, f.at, f.cause, ui);
  }
  return brawl(s, f.by, f.at, f.cause, ui);
}

// a: who started it. result (only with the newcomer): "won" | "lost" | "backed_down", hers.
export async function brawl(s, a, b, cause, ui, { result = null } = {}) {
  if (!present(s, a) || !present(s, b)) return null;
  for (const id of [a, b]) { const t = T.talkOf(s, id); if (t) T.end(s, t, "a cat fight broke out", cause, ui); }
  let winner, decision = null;
  const P = a === "player" ? a : b === "player" ? b : null;
  if (result && P) winner = result === "won" ? "player" : P === a ? b : a;
  else {
    const fa = a === "player" ? null : s.people[a], fb = b === "player" ? null : s.people[b];
    const d = await R.decide(s, "world", { payload: { fight: `${nm(s, a)} started a cat fight with ${nm(s, b)}`, fighters: [fa ? `${fa.name}: ${fa.traits.join(", ")}` : `${s.player.name}, the newcomer`, fb ? `${fb.name}: ${fb.traits.join(", ")}` : `${s.player.name}, the newcomer`] }, used: null }, {
      winner: { type: "choice", instructions: `Who comes out of it looking better?`, criteria: { a: nm(s, a), b: nm(s, b) }, prior: { a: 0.5 + (fa ? fa.bias.nerve + fa.bias.temper * 0.5 : 1) , b: 0.5 + (fb ? fb.bias.nerve + fb.bias.temper * 0.5 : 1) } },
    }, `fight:${a}+${b}`, cause);
    winner = d.winner.pick === "a" ? a : b; decision = d._id;
  }
  const loser = winner === a ? b : a;
  const ev = R.emit(s, { type: "fight", actor: a, targets: [b], content: { winner, backedDown: result === "backed_down" }, cause: decision ? cause : cause });
  const c = ev.id;
  if (a !== "player") M.shift(s, a, b, { aff: -1.3, trust: -0.3, why: `we had a cat fight (day ${s.day})`, cause: c });
  if (b !== "player") M.shift(s, b, a, { aff: -1.5, trust: -0.5, why: "she went for me in a cat fight", cause: c });
  for (const id of [a, b]) if (id !== "player") M.stir(s, s.people[id], { anger: 1, why: `the cat fight with ${nm(s, id === a ? b : a)}`, cause: c });
  if (loser !== "player") M.stir(s, s.people[loser], { cheer: -1, why: "she lost a cat fight in public", cause: c });
  if (a === "player") s.player.fights = (s.player.fights || 0) + 1; else s.people[a].fights = (s.people[a].fights || 0) + 1;
  const where = placeName(ev.place);
  const rid = B.newClaim(s, { about: a, text: `${nm(s, a)} started a cat fight with ${nm(s, b)} at ${where} on day ${s.day}${result === "backed_down" ? `, and ${nm(s, P)} backed down` : `, and ${nm(s, winner)} came out on top`}.`, origin: "truth", isTrue: true, harm: -1.1, kind: "fight", cat: "world", prop: { subject: a, pred: "fought", obj: b, pol: 1 } });
  for (const p of ev.perceivers) B.learn(s, p.id, rid, { conf: p.how === "saw" ? 0.85 : 1, from: "self", ev: ev.id, root: "saw", how: "saw", cause: c });
  ui?.fight?.(a, b, { winner });
  const sided = { you: [], her: [], neither: [] };
  await fanOut(s, {
    ev, perceivers: ev.perceivers.filter((p) => p.id !== a && p.id !== b),
    build: (W) => {
      const w = s.people[W];
      return {
        view: view(s, W, { with: [a, b], small: true, moment: `You just watched ${nm(s, a)} start a cat fight with ${nm(s, b)}. ${nm(s, winner)} came out on top.` }),
        label: `fight-seen:${W}`,
        qs: {
          side: { type: "choice", instructions: `Whose side does ${nm(s, W)} take?`, criteria: { a: `${nm(s, a)}, who started it`, b: nm(s, b), neither: "Neither: they're both embarrassing" }, prior: { a: Math.max(0.05, 0.3 + (s.rel[W][a]?.affinity ?? 0) * 0.4), b: Math.max(0.05, 0.8 + (s.rel[W][b]?.affinity ?? 0) * 0.4), neither: 1 + (w.bias.loyalty < 0.4 ? 0.5 : 0) } },
          pass: { type: "noul", instructions: "Does she tell people about it later?", prior: Math.min(0.95, 0.2 + w.bias.gossip * 0.7) },
        },
      };
    },
    commit: (W, how, ans) => {
      const side = ans.side.pick;
      const S1 = side === "a" ? a : side === "b" ? b : null, S2 = side === "a" ? b : side === "b" ? a : null;
      if (S1) { M.shift(s, W, S1, { aff: 0.4, why: `I took her side in the fight with ${nm(s, S2)}`, cause: ans._id }); M.shift(s, W, S2, { aff: -0.6, why: `sided against her when she fought ${nm(s, S1)}`, cause: ans._id }); }
      else { M.shift(s, W, a, { aff: -0.3, why: `started a cat fight with ${nm(s, b)}`, cause: ans._id }); M.shift(s, W, b, { aff: -0.1, cause: ans._id }); }
      // a friend humiliated in a fight: her friends cool on whoever beat her
      if ((s.rel[W][loser]?.affinity ?? 0) >= 1 && winner !== W) M.shift(s, W, winner, { aff: -0.35, why: `humiliated ${nm(s, loser)} in a fight`, cause: ans._id });
      if (ans.pass.yes) M.pushAgenda(s, s.people[W], { kind: "spread", target: null, rumor: rid, cause: { type: "reaction", id: ans._id } });
      if (P) { const forPlayer = S1 === "player"; sided[S1 ? (forPlayer ? "you" : "her") : "neither"].push(nm(s, W)); }
    },
  });
  return { ev: ev.id, winner, sided, text: s.rumors[rid].text };
}

export async function playerFight(s, id, { by, result }, ui) {
  if (!present(s, id)) return null;
  runtime.note({ t: "fight", id, by, result });
  const a = by === "player" ? "player" : id, b = by === "player" ? id : "player";
  return brawl(s, a, b, by === "player" ? "player:fight" : s.lastShoveCause || "player:fight", ui, { result });
}

// ---------- the vote ----------
// Each ballot is a Jev decision on the voter's own view, with the reasons that weighed most
// kept with it (the page shows those, nothing else).
function ballotReasons(s, v, id, finale) {
  const out = [];
  const r = s.rel[v.id][id];
  if (!finale && v.votePlan?.target === id && v.votePlan.why) out.push(v.votePlan.why);
  for (const c of M.openBy(s, v.id, (c) => ["vote", "told_vote"].includes(c.kind) && c.target === id)) out.push(`told ${nm(s, c.to)} she would${c.sincere ? "" : " (and meant it this time)"}`);
  const why = (r?.why || []).filter((x) => (finale ? x.sign > 0 : x.sign < 0)).slice(0, 2).map((x) => x.text);
  out.push(...why);
  // what she owes her pulls the other way, and the ballot weighs both
  if (!finale && (r?.debt || 0) >= 0.4) { const good = (r.why || []).find((x) => x.sign > 0); out.push(`but she owes her${good ? ` (${good.text})` : " a favor"}`); }
  const bel = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid].about === id && (finale ? (s.rumors[rid].harm || 0) > 0 : (s.rumors[rid].harm || 0) < -0.4)).map(([rid]) => s.rumors[rid].text).slice(-1);
  out.push(...bel.map((t) => `heard: ${t}`));
  if (!out.length) out.push(finale ? `she ${M.feel(r?.affinity ?? 0)} her` : `she ${M.feel(r?.affinity ?? 0)} her and ${M.trustWord(r?.trust ?? 0)} her`);
  return [...new Set(out)].slice(0, 3);
}

export async function castVotes(s, candidates, voters, { finale = false } = {}) {
  const out = {};
  s.ballotWhy ??= {};
  await Promise.all(voters.map(async (v0) => {
    const v = typeof v0 === "string" ? s.people[v0] : v0;
    const opts = candidates.filter((id) => id !== v.id);
    if (!opts.length) return;
    const criteria = {}, prior = {};
    const st = (await import("./views.js")).standing(s, v.id);
    for (const id of opts) {
      const r = s.rel[v.id][id] || M.newRel(0, 0);
      const reasons = ballotReasons(s, v, id, finale);
      criteria[id] = `${finale ? "Crown" : "Vote out"} ${nameOf(s, id)} (${reasons.join("; ")})`;
      if (finale) prior[id] = Math.max(0.05, 1.5 + r.affinity + r.trust * 0.5 + r.respect * 0.4);
      else {
        const ally = s.alliances.find((al) => al.members.includes(v.id) && al.members.includes(id) && al.loyal?.[v.id] !== false);
        const owed = M.openBy(s, v.id, (c) => ["vote", "told_vote"].includes(c.kind) && c.target === id && c.sincere && !c.wavered);
        prior[id] = Math.max(0.05, 0.6 + Math.max(0, -r.affinity) * 1.6 + Math.max(0, -r.trust) * 0.6 + r.fear * 0.3 - (r.debt || 0) * 0.5 - (ally ? 2.5 * v.bias.loyalty : 0)
          + (v.votePlan?.target === id ? 1.5 + (v.votePlan.strength ?? 1.5) * 1.2 : 0) + owed.reduce((t, c) => t + (0.6 + c.level * 0.4 + v.bias.loyalty) * (c.kind === "vote" ? 1 : 0.5), 0)
          + (st.threats.includes(id) ? 1.2 + (1 - v.bias.loyalty) : 0) + ((id === "player" ? s.player.fights : s.people[id]?.fights) || 0) * 0.35
          + (id === "player" && s.looks?.[v.id]?.threat ? 1 + v.bias.scheme : 0) + B.suspicion(s, v.id, id) * 1.2);
      }
    }
    const a = await R.decide(s, v.id, view(s, v.id, { moment: finale ? "The finale: as a woman voted out earlier, you sit on the jury and name the woman who should win the season." : "Vote night at the firepit. You secretly name one woman to send home." }), {
      vote: { type: "choice", instructions: finale ? `Who does ${nm(s, v.id)} crown the winner? Bitterness, respect and who played her all count.` : `Who does ${nm(s, v.id)} vote out tonight? She votes the way this woman really would: strategy, grudges, fear, loyalty and her promises. Votes are read out in public.`, criteria, prior },
    }, `ballot:${v.id}`, s.votes.length ? `rule:vote` : "rule:vote", (o) => `${finale ? "crowned" : "voted out"} ${nameOf(s, o.vote.pick)}`);
    out[v.id] = a.vote.pick;
    const reasons = ballotReasons(s, v, a.vote.pick, finale);
    s.ballotWhy[v.id] = { decision: a._id, target: a.vote.pick, reasons };
    const d = R.decisionById(s, a._id);
    if (d) d.reasons = reasons;
  }));
  return out;
}

// The reveal: every ballot is read out in public, so everyone at the firepit learns who
// came for whom and judges it against what was promised.
export async function applyVote(s, ballots, outId, ui, { lines = {} } = {}) {
  const at = { x: -26, z: -37 };
  const crowd = () => [...A.alive(s).map((v) => ({ id: v.id, how: "overheard" })), ...(s.player.out ? [] : [{ id: "player", how: "overheard" }])];
  const evs = {}, pactBreaks = [];
  for (const [voter, target] of Object.entries(ballots)) {
    const why = voter === "player" ? null : s.ballotWhy?.[voter];
    const ev = R.emit(s, { type: "ballot", actor: voter, targets: [target], place: "firepit", at, public: true, perceivers: crowd(), content: { target, line: lines[voter] || null, reasons: why?.reasons || null }, cause: why?.decision || (voter === "player" ? "player:vote" : "rule:vote") });
    evs[voter] = ev;
    const said = s.ballotMoves?.[voter];
    if (said && lines[voter] && said.line === lines[voter]) sayInPublic(s, voter, ev, said.line, said.moves);
    // a ballot is a fact about a mind everyone now knows
    const rid = B.newClaim(s, { about: voter, text: `${nameOf(s, voter)} voted to send ${nameOf(s, target)} home on day ${s.day}.`, origin: "truth", isTrue: true, harm: -0.3, kind: "vote", cat: "mind", prop: { subject: voter, pred: "voted", obj: target, pol: 1 } });
    for (const p of ev.perceivers) B.learn(s, p.id, rid, { conf: 1, from: "self", ev: ev.id, root: "saw", how: "overheard", cause: ev.id });
    if (target !== "player" && s.people[target] && !s.people[target].gone) M.shift(s, target, voter, { aff: -1, trust: -0.4, why: "voted to send me home", cause: ev.id });
    const pact = s.alliances.find((al) => al.members.includes(target) && al.members.includes(voter));
    if (pact && target !== "player" && s.people[target]) {
      M.shift(s, target, voter, { trust: -1.5, aff: -0.8, why: `voted against me despite our pact (${pact.name})`, cause: ev.id });
      M.reweigh(s, target, ev.id, 5, ev.id);
      pact.members = pact.members.filter((m) => m !== voter);
      pact.history.push({ day: s.day, minute: s.minute, what: `${voter} voted against ${target}: out of the pact`, cause: ev.id });
      R.change(s, { who: voter, what: "alliance", key: pact.id, from: "member", to: "betrayed", cause: ev.id });
      pactBreaks.push({ by: voter, of: target, pact: pact.id });
      A.betrayed(s, target, ev.id);
    }
  }
  // every vote pledge is settled now, in front of everyone
  const settled = [];
  for (const c of (s.ledger || []).filter((c) => c.status === "open" && ["vote", "told_vote"].includes(c.kind))) {
    const actual = ballots[c.by];
    const ev = evs[c.by];
    if (!actual) { M.settle(s, c, "impossible", `${nameOf(s, c.by)} had no vote tonight`, "rule:vote"); continue; }
    if (c.target !== "player" && (!s.people[c.target] || s.people[c.target].gone) && c.target !== outId) { M.settle(s, c, "impossible", `${nameOf(s, c.target)} was already gone`, ev.id); continue; }
    if (actual === c.target) { M.settle(s, c, "kept", "voted as she said", ev.id); settled.push({ c, kept: true, ev }); continue; }
    const why = c.by === "player" ? `voted for ${nameOf(s, actual)} instead` : `voted for ${nameOf(s, actual)} instead${!c.sincere ? " (she never meant it)" : c.wavered ? ` (${c.wavered.why})` : ""}`;
    M.settle(s, c, "broken", why, c.by === "player" ? ev.id : c.wavered?.decision || s.ballotWhy?.[c.by]?.decision || ev.id);
    settled.push({ c, kept: false, ev, actual });
  }
  // what the pledges mean to the people who knew about them
  for (const { c, kept, ev, actual } of settled) {
    const knowers = new Set([c.to, ...c.heard]);
    const big = c.kind === "vote";
    let rid = null;
    if (!kept) rid = B.newClaim(s, { about: c.by, text: `${nameOf(s, c.by)} told ${nameOf(s, c.to)} she'd vote out ${nameOf(s, c.target)}, then voted for ${nameOf(s, actual)}.`, origin: "truth", isTrue: true, harm: -1.2, kind: "broken", cat: "world", prop: { subject: c.by, pred: "broke_word", obj: c.to, pol: 1 } });
    for (const w of knowers) {
      if (w === c.by || !present(s, w)) continue;
      if (rid) B.learn(s, w, rid, { conf: 1, from: "self", ev: ev.id, root: "saw", how: "overheard", cause: ev.id });
      if (w === "player") continue;
      if (kept) M.shift(s, w, c.by, { trust: w === c.to ? 0.3 : 0.1, why: w === c.to && big ? "kept her word at the vote" : null, cause: ev.id });
      else {
        M.shift(s, w, c.by, { trust: w === c.to ? (big ? -1.2 : -0.6) : -0.3, aff: w === c.to ? (big ? -0.5 : -0.25) : 0, why: w === c.to ? `said she'd vote out ${nameOf(s, c.target)}, then voted for ${nameOf(s, actual)}` : `broke her word to ${nameOf(s, c.to)}`, cause: ev.id });
        if (w === c.to) { M.reweigh(s, w, ev.id, big ? 4 : 3, ev.id); B.suspect(s, w, c.by, { by: 0.35, because: [rid], why: "broke her word at the vote", cause: ev.id }); A.betrayed(s, w, ev.id); }
      }
    }
  }
  // voting the same way brings women closer
  const byTarget = {};
  for (const [voter, target] of Object.entries(ballots)) (byTarget[target] ||= []).push(voter);
  for (const group of Object.values(byTarget)) for (const x of group) for (const y of group) if (x !== y && x !== "player" && present(s, x)) M.shift(s, x, y, { aff: 0.3, trust: 0.2, why: `voted the same way on day ${s.day}`, cause: evs[y].id });
  const betrayals = settled.filter((x) => !x.kept && x.c.to === "player").map((x) => ({ by: x.c.by, promised: x.c.target, voted: x.actual }));
  // the woman voted out leaves, and her knowledge with her
  const elim = R.emit(s, { type: "elimination", actor: outId === "player" ? "player" : outId, targets: [], place: "firepit", at, public: true, perceivers: crowd(), content: { out: outId }, cause: evs[Object.keys(evs)[0]]?.id || "rule:vote" });
  if (outId === "player") s.player.out = true;
  else if (s.people[outId]) {
    const v = s.people[outId];
    v.gone = true; v.out = true; v.outDay = s.day; v.location = "gone";
    for (const t of Object.values(s.talks)) if (t.status === "active" && (t.a === outId || t.b === outId)) T.end(s, t, "she was voted out", elim.id, ui);
  }
  for (const v of A.alive(s)) {
    if (v.votePlan && (v.votePlan.target === outId || ballots[v.id] === v.votePlan.target)) M.dropVotePlan(s, v, elim.id);
    for (const it of [...(v.agenda || [])]) if (it.target === outId) M.doneAgenda(s, v, it, "impossible", elim.id);
    for (const g of v.goals || []) if (g.target === outId) M.setGoal(s, v, { kind: g.kind, target: g.target, w: 0, why: "she's gone", cause: elim.id });
    v.goals = (v.goals || []).filter((g) => g.w > 0);
    if (!v.goals.length) A.seedGoals(s, v, elim.id);
  }
  for (const c of (s.ledger || []).filter((c) => c.status === "open" && (c.target === outId || c.to === outId || c.by === outId))) M.settle(s, c, "impossible", `${nameOf(s, outId)} was voted out`, elim.id);
  // her knowledge leaves with her: secrets she knew have one knower fewer
  for (const sec of Object.values(s.secrets || {})) B.syncSecrets(s, sec.rid);
  const rec = { day: s.day, ballots, out: outId, betrayals, pactBreaks, reasons: Object.fromEntries(Object.entries(s.ballotWhy || {}).filter(([id]) => ballots[id]).map(([id, w]) => [id, w.reasons])), decisions: Object.fromEntries(Object.entries(s.ballotWhy || {}).filter(([id]) => ballots[id]).map(([id, w]) => [id, w.decision])), ev: elim.id };
  s.votes.push(rec);
  s.ballotWhy = {}; s.ballotMoves = {};
  return rec;
}

// Ballot lines, written from each voter's own reasons (the decision's), said in public.
export async function ballotLines(s, ballots, { finale = false } = {}) {
  const items = Object.entries(ballots).filter(([id]) => id !== "player" && s.people[id]).map(([id, target]) => ({ v: s.people[id], target: firstOf(s, target), why: (s.ballotWhy?.[id]?.reasons || []).join("; ") || "her own reasons" }));
  const got = await voice.ballotLines(s, { items, playerName: s.player.name, finale });
  s.ballotMoves = Object.fromEntries(Object.entries(got).map(([id, x]) => [id, { line: x.line, moves: x.moves }]));
  return Object.fromEntries(Object.entries(got).map(([id, x]) => [id, x.line]));
}

// What a woman says as she's said out loud in front of everyone counts like anything else she says.
function sayInPublic(s, by, ev, line, raw) {
  const res = check(s, raw || [], { line, speaker: by, listeners: ev.targets || [] });
  for (const r of res.rejects) logReject(s, by, line, r, false);
  const moves = res.moves.filter((mv) => grounded(s, by, mv).ok).map((mv) => register(s, { ...mv, to: mv.to?.length ? mv.to : ev.targets || [] }, { ev: ev.id, talk: null }));
  ev.content.moves = moves.map((m) => m.id);
  for (const mv of moves) if (["claim", "accusation", "secret"].includes(mv.type)) settleClaim(s, mv, { speaker: by, lie: null, ev: ev.id });
  return moves;
}

// The woman voted out gets one last word on her way out: a real line, said to everyone,
// and what she says (a parting accusation, a secret spilled) lands like anything else.
export async function partingShot(s, id, ui) {
  const v = s.people[id];
  if (!v) return null;
  const last = [...s.votes].reverse().find((x) => x.out === id);
  const votedBy = last ? Object.entries(last.ballots).filter(([, t]) => t === id).map(([w]) => firstOf(s, w)) : [];
  const betrayedBy = (s.ledger || []).filter((c) => c.to === id && c.status === "broken" && c.day >= s.day - 1).map((c) => firstOf(s, c.by));
  const got = await voice.partingShot(s, { v, view: view(s, id, { moment: "voted out" }), playerName: s.player.name, votedBy, betrayedBy });
  if (!got?.line) return null;
  const crowd = [...A.alive(s).map((w) => ({ id: w.id, how: "overheard" })), ...(s.player.out ? [] : [{ id: "player", how: "overheard" }])];
  const ev = R.emit(s, { type: "line", actor: id, targets: [], place: "firepit", at: { x: -26, z: -37 }, public: true, perceivers: crowd, content: { text: got.line, parting: true }, cause: last?.ev || "rule:vote" });
  const moves = sayInPublic(s, id, ev, got.line, got.moves);
  ui?.parting?.(s, id, got.line);
  return { line: got.line, moves: moves.map((m) => m.id), ev: ev.id };
}

// ---------- the end of the day ----------
// Promises whose moment passed are closed with a cause; feelings and moods settle overnight.
export async function endOfDay(s, ui) {
  s.minute = Math.max(s.minute, 20 * 60);
  for (const t of Object.values(s.talks)) if (t.status === "active") T.end(s, t, "the day was over", "rule:clock", ui);
  await T.flushUnjudged(s, ui);
  A.lapse(s);
  M.driftFeelings(s, 10);
  for (const v of A.alive(s)) M.driftMood(s, v, 10);
  return [];
}

// Morning: everyone wakes up at home.
export function dawn(s) {
  for (const v of A.alive(s)) { A.place(s, v, "home", "rule:night"); v.until = 0; }
  s.player.location = "lane";
  s.player.talkingTo = null;
}

// keep the play link's save small: old events lose their heavy fields
export function prune(s, keepDays = 2) {
  R.pruneTrace(s, keepDays);
  R.pruneDecisions(s, keepDays);
  if (s.world.length > 6000) s.world.splice(0, s.world.length - 6000);
  if (s.moves.length > 3000) s.moves.splice(0, s.moves.length - 3000);
  if (s.decisions.length > 4000) s.decisions.splice(0, s.decisions.length - 4000);
}

// ---------- the end-of-season reveal ----------
// What was really going on, built only from the world log, the decision log and the ledger.
// Every item carries the id of the event or decision it comes from.
export function reveal(s) {
  const out = [];
  const add = (kind, text, cause, who = null) => out.push({ kind, text, cause, who });
  for (const sec of Object.values(s.secrets || {})) {
    const r = s.rumors[sec.rid];
    if (!r) continue;
    add("secret", `${nameOf(s, sec.owner)}'s secret: ${r.text}`, r.ev || "rule:history", sec.owner);
  }
  for (const l of s.lies || []) {
    if (l.by === "player") continue;
    const r = s.rumors[l.rid];
    if (!r) continue;
    const to = (l.to || []).map((x) => nameOf(s, x)).join(" and ") || "everyone";
    add("lie", `${nameOf(s, l.by)} lied to ${to} on day ${l.day}: "${r.text}" (${l.truth}).`, l.ev, l.by);
  }
  for (const c of s.ledger || []) {
    if (c.to !== "player" || c.status === "open" || c.status === "kept") continue;
    add("promise", `${nameOf(s, c.by)} told you she would ${M.deedText(s, c, { by: false })} and ${c.status === "broken" ? "didn't" : "dropped it"}${c.why ? `: ${c.why}` : ""}${c.sincere ? "" : ". She never meant it"}.`, c.settleCause || c.cause, c.by);
  }
  for (const v of s.votes || []) for (const [id, reasons] of Object.entries(v.reasons || {})) {
    add("ballot", `Night ${v.day}: ${nameOf(s, id)} voted for ${nameOf(s, v.ballots[id])} because ${reasons.join("; ")}.`, v.decisions?.[id] || v.ev, id);
  }
  const heard = new Set((s.player.heard || []).map((h) => h.rid));
  for (const r of Object.values(s.rumors)) {
    if (r.about !== "player" || heard.has(r.id)) continue;
    const knew = Object.values(s.people).filter((v) => v.knows[r.id]?.conf >= 0.4).map((v) => nameOf(s, v.id));
    if (!knew.length) continue;
    const ev = s.world.find((e) => e.content?.moves && (s.moves || []).some((m) => m.rid === r.id && e.content.moves.includes(m.id)));
    const first = Object.values(s.people).map((v) => v.knows[r.id]?.chain?.[0]?.ev).find(Boolean);
    add("behind", `Said behind your back (you never heard it): "${r.text}" Believed by ${knew.join(", ")}.`, ev?.id || r.ev || first || "rule:gossip", null);
  }
  return out;
}
