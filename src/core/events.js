// Primrose's daily shows. Once a day the host gathers the town somewhere for a show with
// its own rules: a toast at the tavern, the hot seat on the town hall steps, a roast at the
// smithy... A few women get the floor, and so do you. Everything said there is a public
// event: every word is in every attendee's memory, its moves are judged by every woman in
// the crowd in one reaction round (react.js), and what she decides goes into her beliefs,
// feelings, votes and agenda like anything else.
//
// Primrose is the format, not a contestant: her picks (which show, who speaks) are Jev
// decisions on public facts, and her lines are the show's own words.
//
// The page plays the show (src/client/spotlight.js) and calls these step by step:
//   lineup -> for each speaker: npcAct (Jev: what she does) -> draft (Claude: her words,
//   checked) -> deliver (committed as a public event) -> crowdReacts (everyone judges it).

import * as R from "./record.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import * as T from "./talk.js";
import * as A from "./agents.js";
import * as voice from "./voice.js";
import * as rng from "./rng.js";
import { view, showText, placeName } from "./views.js";
import { check, register, grounded } from "./moves.js";
import { round, settleClaim } from "./react.js";
import { centre, pos } from "./space.js";

const nm = M.nm;
const alive = A.alive;

// ---------- the formats ----------
// kind: "speeches" (each speaker takes the floor once) or "hotseat" (one woman answers for
// what the town is saying about her). acts: how much each kind of move suits the format.
export const FORMATS = {
  toast: {
    title: "The Toast", icon: "🥂", place: "tavern", minute: 13 * 60, kind: "speeches", speakers: 3,
    blurb: "Everyone raises a glass to someone. Sweet, or not.",
    open: ["Glasses up, ladies! Today each of you raises a glass to someone in this town.", "Drinks are on Wren! The rule is simple: toast somebody. Make it sweet. Or don't."],
    turn: (n) => [`${n}, your glass. Who are you toasting?`, `${n}, up you get. Make it a good one.`],
    you: "Raise a glass to someone…",
    acts: { praise: 3, backhanded: 1.4, call_out: 0.3, plead: 0.3 },
  },
  clear_air: {
    title: "Clear the Air", icon: "🌪️", place: "plaza", minute: 11 * 60, kind: "speeches", speakers: 2, rebuttal: true,
    blurb: "Say what's been eating you, to her face. She gets to answer.",
    open: ["Gather round the fountain! Somebody in this town has been biting her tongue. Not today.", "Today we clear the air. If somebody wronged you, say it to her face. She gets to answer."],
    turn: (n) => [`${n}. Who's been getting under your skin?`, `${n}, the floor is yours. Get it off your chest.`],
    you: "Call someone out, or keep it classy…",
    acts: { call_out: 3, apologize: 0.8, praise: 0.25 },
  },
  hot_seat: {
    title: "The Hot Seat", icon: "🪑", place: "hall", minute: 15 * 60, kind: "hotseat",
    blurb: "One woman answers for what the whole town is whispering about her.",
    open: ["Welcome to the Hot Seat! One of you is about to answer for what this whole town is whispering.", "Elder Hesper lent us her steps. Lovely. Now, who's in the chair today..."],
    you: "Answer for yourself…",
  },
  send_home: {
    title: "Who Would You Send Home?", icon: "🔥", place: "firepit", minute: 12 * 60, kind: "speeches", speakers: 3,
    blurb: "Name the woman you'd send home tonight, out loud.",
    open: ["The fire's not lit yet, but let's warm it up. Today you say it out loud: who would you send home?", "No secret ballots today, ladies. Who goes home tonight, and why?"],
    turn: (n) => [`${n}. One name.`, `${n}, who would you send packing?`],
    you: "Name who you'd send home, or dodge it…",
    acts: { name_vote: 3, dodge: 0.8, plead: 0.4 },
  },
  hot_cold: {
    title: "Hot & Cold", icon: "💋", place: "salon", minute: 14 * 60, kind: "speeches", speakers: 3, assigned: true,
    blurb: "Primrose picks your target. One compliment, one dig.",
    open: ["Welcome to Curl Up & Dye for Hot and Cold! I give you a name. You give her a compliment, and a dig.", "I pick the target, you pick the words. Something sweet, something sharp."],
    turn: (n, t) => [`${n}, you've got ${t}. Hot and cold, darling.`, `${n}... I'm giving you ${t}.`],
    you: "Say something hot and something cold to her…",
    acts: { praise: 1.2, backhanded: 2.2, roast: 1 },
  },
  tea: {
    title: "Morning Tea", icon: "🫖", place: "bakery", minute: 10 * 60, kind: "speeches", speakers: 3,
    blurb: "Cinnamon buns and the juiciest gossip, said in front of everyone.",
    open: ["Good morning, my darlings! Buns are warm, tea is hot. Now spill some.", "It's Morning Tea at Marigold's. Everybody gets a bun, and everybody shares one piece of gossip."],
    turn: (n) => [`${n}, what's the tea?`, `${n}, spill.`],
    you: "Spill some tea in front of everyone…",
    acts: { spill: 3, dodge: 0.6, praise: 0.3 },
  },
  soapbox: {
    title: "The Soapbox", icon: "📣", place: "market", minute: 14 * 60 + 30, kind: "speeches", speakers: 3,
    blurb: "Stand on a fruit crate and tell the town why you should stay.",
    open: ["Odette's lent us a crate. Up you get, one at a time, and tell this town why you deserve to stay.", "It's campaign time, ladies. The soapbox is yours."],
    turn: (n) => [`${n}, up on the crate.`, `${n}. Convince us.`],
    you: "Tell the town why you should stay…",
    acts: { plead: 3, call_out: 0.8, praise: 0.9 },
  },
  confessions: {
    title: "True Confessions", icon: "🕯️", place: "garden", minute: 12 * 60, kind: "speeches", speakers: 3,
    blurb: "A confession or an apology, among Juniper's herbs.",
    open: ["Juniper says this garden is a safe space. Adorable. Today you confess something, or say sorry to someone.", "Candles, herbs, and honesty. Who's got something to get off her conscience?"],
    turn: (n) => [`${n}, what's on your conscience?`, `${n}. Confess, darling.`],
    you: "Confess something, or apologize to someone…",
    acts: { confess: 2.2, apologize: 2, dodge: 0.5 },
  },
  roast: {
    title: "The Roast", icon: "🎤", place: "smithy", minute: 16 * 60, kind: "speeches", speakers: 3, rebuttal: true,
    blurb: "Roast someone. Make it funny. She can fire back.",
    open: ["Welcome to the Roast, down at Brenna's smithy where it's already hot! Roast somebody. Make it funny.", "It's roast day! Jokes only, ladies. If it hurts, it was meant to be funny."],
    turn: (n) => [`${n}, who are you roasting?`, `${n}, the mic is hot.`],
    you: "Roast someone…",
    acts: { roast: 3, backhanded: 0.8, praise: 0.3 },
  },
};

const pick = (a) => a[Math.floor(rng.rand() * a.length)];
const others = (s, id) => [...alive(s).map((v) => v.id), ...(s.player.out ? [] : ["player"])].filter((x) => x !== id);
const aff = (s, a, b) => s.rel[a]?.[b]?.affinity ?? 0;
const host = (s, label, qs, extra = {}) => R.decide(s, "primrose", { payload: { the_show: showText(s), ...extra }, used: null }, qs, label, "rule:show");

// ---------- picking today's show ----------
export async function planDay(s) {
  const recent = (s.shows || []).slice(-3).map((x) => x.format);
  const keys = Object.keys(FORMATS).filter((k) => !recent.includes(k));
  const vs = alive(s);
  const grudges = vs.reduce((t, a) => t + vs.filter((b) => b !== a && aff(s, a.id, b.id) < -1).length, 0);
  const left = vs.length + (s.player.out ? 0 : 1);
  const prior = {
    toast: s.day === 1 ? 3 : 1, tea: s.day === 1 ? 2.5 : 1.2, clear_air: 0.6 + grudges * 0.25, hot_seat: 0.9,
    send_home: left <= 6 ? 2 : 0.8, hot_cold: 1 + grudges * 0.1, soapbox: left <= 6 ? 2 : 0.7, confessions: 0.8, roast: 0.7 + grudges * 0.15,
  };
  const j = await host(s, "show:format", { format: { type: "choice", instructions: "Primrose, the host, produces one show for the whole town today. Which one makes the juiciest TV?", criteria: Object.fromEntries(keys.map((k) => [k, `${FORMATS[k].title}: ${FORMATS[k].blurb}`])), prior: Object.fromEntries(keys.map((k) => [k, prior[k]])) } }, { recent_shows: recent });
  const f = FORMATS[j.format.pick];
  s.event = { day: s.day, format: j.format.pick, minute: f.minute + pick([-30, -15, 0, 0, 15, 30]), place: f.place, called: false, done: false, decision: j._id };
  return s.event;
}

export const showOf = (s) => (s.event && s.event.day === s.day ? s.event : null);

// the crowd: everyone at the venue hears every word
function crowd(s, place, addressed = []) {
  const out = [];
  for (const v of alive(s)) out.push({ id: v.id, how: addressed.includes(v.id) ? "addressed" : "overheard" });
  if (!s.player.out) out.push({ id: "player", how: addressed.includes("player") ? "addressed" : "overheard" });
  return out;
}

// everyone stands at the venue for the show
export function gather(s) {
  const ev = showOf(s);
  if (!ev) return;
  for (const v of alive(s)) {
    for (const t of Object.values(s.talks)) if (t.status === "active" && (t.a === v.id || t.b === v.id)) T.end(s, t, "Primrose's show started", "rule:show");
    if (v.location !== ev.place) A.place(s, v, ev.place, "rule:show");
  }
  s.player.location = ev.place;
  if (!ev.opened) { ev.opened = R.emit(s, { type: "show_open", actor: "primrose", place: ev.place, public: true, perceivers: crowd(s, ev.place), content: { title: FORMATS[ev.format].title, format: ev.format }, cause: ev.decision || "rule:show" }).id; }
}

// ---------- who gets the floor ----------
export async function lineup(s) {
  gather(s);
  const ev = showOf(s);
  const f = FORMATS[ev.format];
  const vs = alive(s);
  const drama = (v) => 0.5 + v.mood.anger * 0.4 + v.bias.nerve * 0.6 + vs.filter((o) => o !== v && Math.abs(aff(s, v.id, o.id)) > 1).length * 0.25;
  if (f.kind === "hotseat") {
    // whoever the most-told story is about (Primrose hears what's going round)
    const pool = {};
    for (const r of Object.values(s.rumors)) {
      if ((r.harm || 0) > -0.5 || !r.about || r.kind === "liar" || (r.about !== "player" && (!s.people[r.about] || s.people[r.about].gone)) || (r.about === "player" && s.player.out)) continue;
      const spread = vs.filter((v) => v.id !== r.about && v.knows[r.id]?.conf >= 0.4).length;
      if (spread < 2) continue;
      if (!pool[r.about] || pool[r.about].score < spread * -r.harm) pool[r.about] = { rid: r.id, score: spread * -r.harm };
    }
    const cands = Object.keys(pool).length ? Object.keys(pool) : vs.map((v) => v.id);
    const j = await host(s, "show:seat", { seat: { type: "choice", instructions: "Primrose puts one woman in the Hot Seat to answer for what the town is saying about her. Who makes the best TV?", criteria: Object.fromEntries(cands.map((id) => [id, nm(s, id)])), prior: Object.fromEntries(cands.map((id) => [id, (pool[id]?.score || 0.5) + (id === "player" ? 1 : 0)])) } });
    ev.seat = j.seat.pick; ev.rumor = pool[ev.seat]?.rid || null;
    return { seat: ev.seat, rumor: ev.rumor };
  }
  const chosen = [];
  const n = Math.min(f.speakers, vs.length);
  for (let i = 0; i < n; i++) {
    const cands = vs.filter((v) => !chosen.includes(v.id));
    const j = await host(s, "show:pick", { who: { type: "choice", instructions: `Primrose picks who takes the floor at ${f.title}. Who will make it dramatic?`, criteria: Object.fromEntries(cands.map((v) => [v.id, v.name])), prior: Object.fromEntries(cands.map((v) => [v.id, drama(v)])) } });
    chosen.push(j.who.pick);
  }
  const order = [...chosen];
  if (!s.player.out) order.splice(Math.max(1, Math.floor(rng.rand() * (order.length + 1))), 0, "player");
  const assigned = {};
  if (f.assigned) for (const id of order) {
    const used = new Set(Object.values(assigned));
    const cands = others(s, id).filter((x) => !used.has(x));
    const j = await host(s, "show:assign", { target: { type: "choice", instructions: `Primrose hands ${nm(s, id)} the woman she must compliment and dig at. Bad blood makes better TV.`, criteria: Object.fromEntries(cands.map((x) => [x, nm(s, x)])), prior: Object.fromEntries(cands.map((x) => [x, 0.4 + Math.abs(aff(s, id === "player" ? x : id, id === "player" ? "player" : x)) + (x === "player" ? 0.6 : 0)])) } });
    assigned[id] = j.target.pick;
  }
  ev.order = order; ev.assigned = assigned;
  return { order, assigned };
}

// ---------- what a woman does with the floor ----------
const KIND_TEXT = {
  praise: "a sincere compliment", backhanded: "a backhanded compliment", call_out: "calling her out in public", roast: "a mean joke at her expense",
  spill: "spilling gossip in front of everyone", apologize: "a public apology", confess: "a confession about herself", plead: "begging the town to keep her",
  name_vote: "saying she'd send her home", dodge: "playing it safe and saying nothing that matters", deny: "denying the story", speak: "speaking her mind",
};
export const HOSTILE = new Set(["call_out", "roast", "backhanded", "name_vote", "spill"]);

// her grievance against someone, from her own record
function grievanceOf(s, by, x) {
  const why = (s.rel[by]?.[x]?.why || []).find((r) => r.sign < 0);
  if (why) return why.text;
  const v = s.people[by];
  const rid = v && Object.entries(v.knows).filter(([r, k]) => s.rumors[r]?.about === x && (s.rumors[r].harm || 0) < 0 && k.conf >= 0.4).sort((a, b) => (s.rumors[a[0]].harm || 0) - (s.rumors[b[0]].harm || 0))[0]?.[0];
  return rid ? { text: s.rumors[rid].text, rid } : null;
}

export async function npcAct(s, id, { assigned = null } = {}) {
  const ev = showOf(s), f = FORMATS[ev.format], v = s.people[id];
  const targets = assigned ? [assigned] : others(s, id);
  const byAff = [...targets].sort((a, b) => aff(s, id, b) - aff(s, id, a));
  const liked = byAff.slice(0, 2), hated = byAff.slice(-2).reverse();
  const crit = {}, prior = {}, meta = {};
  const add = (key, text, p, m) => { if (!(p > 0)) return; crit[key] = text; prior[key] = p; meta[key] = m; };
  const w = (k) => f.acts?.[k] || 0;
  for (const x of assigned ? targets : liked) add(`praise_${x}`, `Says something genuinely nice about ${nm(s, x)}`, w("praise") * (0.4 + Math.max(0, aff(s, id, x)) * 0.6 + v.bias.loyalty * 0.4), { kind: "praise", subject: x });
  for (const x of assigned ? targets : hated) {
    const g = grievanceOf(s, id, x);
    add(`back_${x}`, `Gives ${nm(s, x)} a backhanded compliment`, w("backhanded") * (0.4 + v.bias.scheme * 0.6 + Math.max(0, -aff(s, id, x)) * 0.3), { kind: "backhanded", subject: x });
    add(`call_${x}`, `Calls out ${nm(s, x)} in front of everyone${g ? ` about: ${g.text || g}` : ""}`, w("call_out") * (0.2 + v.bias.temper * 0.6 + Math.max(0, -aff(s, id, x)) * 0.6), { kind: "call_out", subject: x, grievance: g?.text || g, rumor: g?.rid || null });
    add(`roast_${x}`, `Roasts ${nm(s, x)} with a mean joke`, w("roast") * (0.4 + v.bias.nerve * 0.5 + Math.max(0, -aff(s, id, x)) * 0.4), { kind: "roast", subject: x });
    add(`vote_${x}`, `Says she would send ${nm(s, x)} home`, w("name_vote") * (0.3 + v.bias.nerve * 0.5 + (v.votePlan?.target === x ? 2 : 0) + Math.max(0, -aff(s, id, x)) * 0.5), { kind: "name_vote", subject: x });
  }
  if (!assigned) {
    const juicy = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid].about !== id && (s.rumors[rid].harm || 0) < 0 && s.rumors[rid].kind !== "liar" && (s.rumors[rid].about === "player" ? !s.player.out : s.people[s.rumors[rid].about] && !s.people[s.rumors[rid].about].gone)).map(([rid]) => s.rumors[rid]).sort((a, b) => a.harm - b.harm).slice(0, 2);
    for (const r of juicy) add(`spill_${r.id}`, `Tells everyone: ${r.text}`, w("spill") * (0.3 + v.bias.gossip), { kind: "spill", subject: r.about, rumor: r.id });
    const worst = hated[0];
    if (worst && aff(s, id, worst) < -0.3) add(`sorry_${worst}`, `Apologizes to ${nm(s, worst)}`, w("apologize") * (0.2 + v.bias.loyalty * 0.7 + (v.bias.scheme > 0.7 ? 0.3 : 0)), { kind: "apologize", subject: worst });
    const sec = B.secretOf(s, id);
    if (sec) add("confess", `Confesses something about herself: ${s.rumors[sec.rid].text}`, w("confess") * (0.2 + (1 - v.bias.deceit) * 0.8), { kind: "confess", subject: id, rumor: sec.rid });
    add("plead", "Asks the town to keep her around", w("plead") * (0.5 + v.mood.fear * 0.3 + ((v.goals || [])[0]?.kind === "survive" ? 0.5 : 0)), { kind: "plead", subject: null });
  }
  add("dodge", "Plays it safe and says nothing that matters", (w("dodge") || 0.15) * (0.4 + (1 - v.bias.nerve)), { kind: "dodge", subject: null });
  const a = await R.decide(s, id, view(s, id, { with: [], moment: `${f.title} (${f.blurb}) at ${placeName(ev.place)}. Primrose hands you the floor and the whole town is watching.` }), {
    act: { type: "choice", instructions: `Primrose hands ${nm(s, id)} the floor at ${f.title}. What does she do with it? She does what this woman really would in front of a crowd.`, criteria: crit, prior },
    delivery: { type: "score", instructions: "However honest she's being, how does she come across up there?", criteria: ["visibly nervous", "a little unsure", "matter-of-fact", "smooth and confident", "completely convincing"], prior: Math.max(0, Math.min(4, 1.6 + v.bias.deceit * 1.4 + v.bias.nerve * 0.6 - v.mood.fear * 0.5)) },
  }, `show:act:${id}`, ev.opened || "rule:show", (o) => `at ${f.title}, chose: ${crit[o.act.pick]?.toLowerCase()}`);
  return { ...meta[a.act.pick], by: id, decision: a._id, delivery: a.delivery.value };
}

// the words Claude is asked for
function intentFor(s, act) {
  const x = act.subject ? nm(s, act.subject) : null;
  const r = act.rumor && s.rumors[act.rumor];
  return {
    praise: `say something genuinely lovely about ${x}`, backhanded: `give ${x} a backhanded compliment`,
    call_out: `call out ${x} in front of everyone${act.grievance ? ` about this: ${act.grievance}${act.rumor ? ` [${act.rumor}]` : ""}` : ""}`,
    roast: `roast ${x} with a mean joke`, spill: r ? `tell the whole crowd this gossip [${act.rumor}]: ${r.text}` : "spill some gossip",
    apologize: `apologize to ${x}${act.grievance ? ` for this: ${act.grievance}` : ""}`, confess: r ? `confess this about yourself: ${r.text}` : "confess something about yourself",
    plead: "ask the town to keep you around", name_vote: `say you would send ${x} home tonight, and why`, dodge: "play it safe and say nothing that matters",
    deny: r ? `deny this flatly: ${r.text}` : "deny it", laugh: r ? `laugh off this story about you: ${r.text}` : "laugh it off",
    heckle: `heckle ${x} from the crowd`, defend: `stick up for ${x} from the crowd`, fire_back: `fire right back at ${x}`, hurt: `go quiet, clearly hurt, and say one short thing`,
  }[act.answer || act.kind] || "speak your mind";
}

// ---------- the words ----------
// Written from her view and her decided act; moves checked; a claim she doesn't hold (and
// didn't choose to lie about) gets the line written again. Not committed until delivered.
export async function draft(s, act, { context = "" } = {}) {
  if (act.by === "player" || !voice.available()) return null;
  const ev = showOf(s), f = FORMATS[ev.format], v = s.people[act.by];
  const lie = act.answer === "deny" && act.rumor && B.secretOf(s, act.by) && B.rootOf(s, act.rumor) === B.secretOf(s, act.by).root ? { about: act.by, content: `denies: ${s.rumors[act.rumor].text}`, truth: "it's true and she knows it" } : null;
  const setting = `${f.title} at ${placeName(ev.place)}: ${f.blurb} Primrose has handed you the floor and the whole town is listening.${context ? ` ${context}` : ""}`;
  const allowed = Object.entries(v.knows).filter(([, k]) => k.conf >= 0.3).map(([rid]) => rid);
  const vw = view(s, act.by, { with: act.subject ? [act.subject] : [], topic: act.rumor, moment: setting }).payload;
  let strict = false;
  for (let i = 0; i < 3; i++) {
    const ans = await voice.turn(s, { v, view: vw, to: ["everyone"], history: [], intent: intentFor(s, act), lie, allowed, playerName: s.player.name, setting, strict, words: "1 to 2 sentences, under 32 words, said to the whole crowd" }, { pri: "show" });
    if (!ans) return null;
    let res = ans.moves ? check(s, ans.moves, { line: ans.line, speaker: act.by, listeners: act.subject ? [act.subject] : [] }) : null;
    if (!res || res.rejects.length) {
      for (const r of res?.rejects || [{ why: "no moves came back" }]) logReject(s, act.by, ans.line, r, true);
      res = check(s, (await voice.extract(s, { line: ans.line, speaker: nm(s, act.by), listeners: ["everyone"], playerName: s.player.name, setting }, { pri: "show" })) || [], { line: ans.line, speaker: act.by, listeners: act.subject ? [act.subject] : [] });
    }
    if (res.moves.some((mv) => !grounded(s, act.by, mv, { lie }).ok)) { strict = true; logReject(s, act.by, ans.line, { why: "ungrounded claim at the show" }, true); continue; }
    return { line: ans.line, moves: res.moves, tone: res.tone, lie };
  }
  return null;
}
function logReject(s, who, line, r, retry) {
  (s.rejects ??= []).push({ who, line, why: r.why, retry, day: s.day, minute: s.minute });
  if (s.rejects.length > 200) s.rejects.shift();
}

// Said out loud: one public event everyone at the show perceives; moves registered.
export async function deliver(s, act, d) {
  const ev0 = showOf(s);
  const addressed = act.subject ? [act.subject] : [];
  const at = pos(s, act.by) || centre([]);
  const ev = R.emit(s, { type: "show_line", actor: act.by, targets: addressed, place: ev0.place, at, public: true, perceivers: crowd(s, ev0.place, addressed), content: { text: d.line, tone: d.tone, act: act.kind, format: ev0.format }, cause: act.decision || (act.by === "player" ? "player:show" : ev0.opened || "rule:show") });
  const moves = d.moves.map((mv) => register(s, { ...mv, to: mv.to?.length ? mv.to : addressed.length ? addressed : [] }, { ev: ev.id, talk: null }));
  ev.content.moves = moves.map((m) => m.id);
  for (const mv of moves) if (["claim", "accusation", "secret"].includes(mv.type)) settleClaim(s, mv, { speaker: act.by, lie: d.lie, ev: ev.id });
  if (act.by === "player") for (const mv of moves) if (mv.rid && ["claim", "accusation", "secret"].includes(mv.type)) s.player.told.push({ rid: mv.rid, to: "crowd", day: s.day, time: M.clock(s.minute), mv: mv.id });
  // promises and plans said at the show are the most public there are
  const O = addressed[0] || "everyone";
  T.speakerCommitments(s, null, act.by, O === "everyone" ? (act.subject || alive(s).find((v) => v.id !== act.by)?.id) : O, moves, ev, { lie: d.lie });
  if (act.by !== "player") await T.sincerity(s, act.by, O, { moves, ev });
  act.ev = ev.id; act.moves = moves.map((m) => m.id); act.line = d.line; act.tone = d.tone;
  return act;
}

// What the player typed in front of everyone: the same extractor, the same commit.
export async function playerAct(s, text, { assigned = null, defaultSubject = null, seatRumor = null } = {}) {
  const ev = showOf(s), f = FORMATS[ev.format];
  if (!text.trim()) return { kind: "dodge", by: "player", subject: null, line: "", answer: seatRumor ? "silent" : null };
  const raw = await voice.extract(s, { line: text, speaker: s.player.name, listeners: ["everyone"], playerName: s.player.name, setting: `${f.title} at ${placeName(ev.place)} (${f.blurb}). ${s.player.name}, the newcomer, has the floor in front of the whole town.${assigned ? ` Primrose assigned her ${nm(s, assigned)}.` : ""}${seatRumor ? ` She is in the Hot Seat answering for: "${s.rumors[seatRumor].text}"` : ""}` }, { pri: "player" });
  const res = check(s, raw || [], { line: text, speaker: "player", listeners: [assigned || defaultSubject].filter(Boolean) });
  for (const r of res.rejects) logReject(s, "player", text, r, false);
  const mv = res.moves;
  const subject = mv.find((m) => m.about && m.about !== "player")?.about || mv.find((m) => m.to?.[0] && m.to[0] !== "player")?.to?.[0] || assigned || defaultSubject || null;
  const kind = mv.some((m) => m.type === "insult" || m.type === "accusation") ? "call_out" : mv.some((m) => m.type === "apology") ? "apologize" : mv.some((m) => m.type === "compliment") ? "praise" : mv.some((m) => m.type === "claim" && m.about !== "player") ? "spill" : mv.some((m) => m.voteTarget) ? "name_vote" : "speak";
  const act = { kind, by: "player", subject: subject && (subject === "player" || s.people[subject]) ? subject : null, line: text, decision: "player:show" };
  return deliver(s, act, { line: text, moves: mv, tone: res.tone, lie: null });
}

// ---------- the hot seat ----------
export async function seatAnswer(s, id, rid) {
  const v = s.people[id], r = rid && s.rumors[rid];
  const known = r && v.knows[rid];
  const root = known?.chain?.[0]?.root;
  const source = root && s.people[root] && !s.people[root].gone && root !== id ? root : null;
  const truth = r && B.secretOf(s, id) && B.rootOf(s, rid) === B.secretOf(s, id).root;
  const crit = { deny: "Flatly denies it", admit: "Admits it, owns it", laugh: "Laughs it off" }, prior = { deny: truth ? 0.6 + v.bias.deceit * 1.6 : 3, admit: truth ? 0.4 + (1 - v.bias.deceit) : 0.05, laugh: 0.4 + v.bias.nerve * 0.6 };
  if (source) { crit.blame = `Turns on ${nm(s, source)}, who she thinks started it`; prior.blame = 0.3 + v.bias.temper + Math.max(0, -aff(s, id, source)) * 0.5; }
  const ev = showOf(s);
  const a = await R.decide(s, id, view(s, id, { topic: rid, moment: `In the Hot Seat in front of the whole town, Primrose reads out: "${r ? r.text : "everyone has a problem with you"}"` }), {
    answer: { type: "choice", instructions: `How does ${nm(s, id)} answer in the Hot Seat?`, criteria: crit, prior },
  }, `show:seat:${id}`, ev.readOut || ev.opened || "rule:show", (o) => `in the Hot Seat, chose to ${crit[o.answer.pick].toLowerCase()}`);
  const p = a.answer.pick;
  return { kind: p === "admit" ? "confess" : p === "blame" ? "call_out" : p === "laugh" ? "dodge" : "deny", answer: p === "laugh" ? "laugh" : p, by: id, subject: p === "blame" ? source : null, rumor: rid, grievance: p === "blame" ? "she started the story going round about you" : null, decision: a._id };
}

// Primrose reads the story out: now everyone has heard it (as a story, not as a fact).
export function readOut(s, rid) {
  const ev0 = showOf(s);
  if (!rid || !s.rumors[rid]) return;
  const ev = R.emit(s, { type: "announcement", actor: "primrose", place: ev0.place, public: true, perceivers: crowd(s, ev0.place), content: { text: `Word around town is: "${s.rumors[rid].text}"`, rumor: rid }, cause: ev0.opened || "rule:show" });
  ev0.readOut = ev.id;
  for (const p of ev.perceivers) if (p.id !== s.rumors[rid].about) B.learn(s, p.id, rid, { conf: Math.max(B.conf(s, p.id, rid), 0.4), from: "primrose", ev: ev.id, root: "primrose", how: "overheard", cause: ev.id });
}

// Someone in the crowd pipes up at the hot seat: heckles her or sticks up for her.
export async function pipeUp(s, seat) {
  const vs = alive(s).filter((v) => v.id !== seat);
  const ev = showOf(s);
  const res = await Promise.all(vs.map(async (v) => {
    const a0 = aff(s, v.id, seat);
    const a = await R.decide(s, v.id, view(s, v.id, { with: [seat], small: true, moment: `${nm(s, seat)} is in the Hot Seat in front of the whole town.` }), {
      pipe: { type: "choice", instructions: `Does ${nm(s, v.id)} speak up from the crowd?`, criteria: { quiet: "Stays quiet and watches", heckle: `Heckles ${nm(s, seat)}`, defend: `Sticks up for ${nm(s, seat)}` }, prior: { quiet: 4, heckle: Math.max(0, -a0) * v.bias.nerve * 2 + v.bias.temper * 0.3, defend: Math.max(0, a0) * v.bias.loyalty * 2 } },
    }, `show:pipe:${v.id}`, ev.readOut || ev.opened || "rule:show");
    return [v.id, a.pipe.pick, a._id];
  }));
  return rng.shuffle(res.filter(([, p]) => p !== "quiet")).slice(0, 2).map(([id, p, d]) => ({ kind: p === "heckle" ? "roast" : "praise", answer: p, by: id, subject: seat, decision: d }));
}

// A woman answers back after being called out or roasted.
export async function rebuttal(s, id, act) {
  const v = s.people[id];
  const a = await R.decide(s, id, view(s, id, { with: [act.by], small: true, moment: `In front of the whole town, ${nm(s, act.by)} just went for you: "${act.line || KIND_TEXT[act.kind]}"` }), {
    back: { type: "choice", instructions: `How does ${nm(s, id)} answer, right there in front of everyone?`, criteria: { fire_back: `Fires right back at ${nm(s, act.by)}`, laugh: "Laughs it off like a pro", sorry: "Apologizes", hurt: "Goes quiet, clearly hurt" }, prior: { fire_back: 0.4 + v.bias.temper + v.bias.nerve * 0.5, laugh: 0.3 + v.bias.nerve * 0.8, sorry: act.kind === "call_out" ? 0.3 * v.bias.loyalty : 0.05, hurt: 0.3 + (1 - v.bias.nerve) * 0.6 } },
  }, `show:back:${id}`, act.ev || "rule:show");
  const b = a.back.pick;
  return { kind: { fire_back: "roast", laugh: "dodge", sorry: "apologize", hurt: "dodge" }[b], answer: b === "sorry" ? null : b, by: id, subject: act.by, decision: a._id };
}

// ---------- the crowd ----------
// One reaction round over the line: every woman there judges its moves and says how it landed.
export async function crowdReacts(s, act) {
  const tally = { loved: 0, amused: 0, unmoved: 0, cringed: 0, offended: 0 };
  if (!act.ev) return { reactions: {}, snap: null, tally };
  const ev = R.evById(s, act.ev);
  const moves = (act.moves || []).map((id) => s.moves.find((m) => m.id === id)).filter(Boolean);
  const out = await round(s, { ev, moves, speaker: act.by, addressed: act.subject ? [act.subject] : [], crowd: true, delivery: act.delivery, tone: act.tone });
  for (const k of Object.values(out.crowd)) tally[k] = (tally[k] || 0) + 1;
  if (act.by === "player") s.player.showScore = (s.player.showScore || 0) + tally.loved + tally.amused * 0.5 - tally.cringed * 0.5 - tally.offended;
  return { reactions: out.crowd, snap: out.fight ? out.fight.by : null, snapAt: out.fight?.at || null, snapCause: out.fight?.cause || null, tally };
}

export function actText(s, act) {
  const x = act.subject ? nm(s, act.subject) : null;
  return ({ praise: `said something lovely about ${x}`, backhanded: `gave ${x} a backhanded compliment`, call_out: `called out ${x}`, roast: `roasted ${x}`, spill: "spilled some gossip", apologize: `apologized to ${x}`, confess: "confessed something", plead: "asked the town to keep her", name_vote: `said she'd send ${x} home`, dodge: "played it safe", deny: "denied it", speak: "spoke her mind" })[act.kind] || "spoke";
}

// The show is over: everyone is at the venue, and the clock moves on.
export function finish(s) {
  const ev = showOf(s);
  if (!ev) return;
  ev.done = true;
  (s.shows ||= []).push({ day: s.day, format: ev.format });
  s.minute = Math.max(s.minute, ev.minute + 45);
  for (const v of alive(s)) { if (v.location !== ev.place) A.place(s, v, ev.place, "rule:show"); v.until = R.now(s) + 5; }
  s.player.location = ev.place;
}
