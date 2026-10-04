// Primrose's daily shows. Once a day the host gathers the town somewhere for a show
// with its own rules: a toast at the tavern, the hot seat on the town hall steps, a roast
// at the smithy... A few women get the floor, and so do you. What anyone says in front
// of the crowd lands with every woman listening, and Jev decides how: loved, laughed at,
// cringed at, or never forgiven. It all goes into their memories, beliefs and votes.
//
// The page plays the show (see src/client/spotlight.js) and calls these step by step.

import * as jev from "./jev.js";
import { lookText } from "./looks.js";
import * as sim from "./sim.js";
import * as M from "./mind.js";
import { read as readLine } from "./reading.js";

const { first, firstOf, nameOf, alive, clamp } = sim;

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

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const others = (s, id) => [...alive(s).map((v) => v.id), ...(s.player.out ? [] : ["player"])].filter((x) => x !== id);
const rel = (s, a, b) => s.rel[a]?.[b];
const aff = (s, a, b) => rel(s, a, b)?.affinity ?? 0;
const secretOf = (s, id) => Object.values(s.rumors).find((r) => r.origin === "truth" && r.day === 0 && r.about === id);

// ---------- picking today's show ----------
// Primrose (as a producer, through Jev) picks the show most likely to make good TV today,
// never one the town has had in the last three days.
export async function planDay(s) {
  const recent = (s.shows || []).slice(-3).map((x) => x.format);
  const keys = Object.keys(FORMATS).filter((k) => !recent.includes(k));
  const vs = alive(s);
  const grudges = vs.reduce((t, a) => t + vs.filter((b) => b !== a && aff(s, a.id, b.id) < -1).length, 0);
  const juicy = Object.values(s.rumors).filter((r) => r.harm <= -1 && vs.filter((v) => v.knows[r.id]?.conf >= 0.5).length >= 2).length;
  const left = vs.length + (s.player.out ? 0 : 1);
  const prior = {
    toast: s.day === 1 ? 3 : 1, tea: s.day === 1 ? 2.5 : 1 + juicy * 0.15, clear_air: 0.6 + grudges * 0.25, hot_seat: 0.6 + juicy * 0.3,
    send_home: left <= 6 ? 2 : 0.8, hot_cold: 1 + grudges * 0.1, soapbox: left <= 6 ? 2 : 0.7, confessions: 0.8, roast: 0.7 + grudges * 0.15,
  };
  const j = await jev.ask({ the_show: sim.showText(s), cast: vs.map((v) => `${v.name}: ${sim.moodText(v.mood)}`), grudges_in_town: grudges, juicy_rumors_going_round: juicy },
    { format: { type: "choice", instructions: "Primrose, the host, produces one show for the whole town today. Which one makes the juiciest TV given where the drama is right now?", criteria: Object.fromEntries(keys.map((k) => [k, `${FORMATS[k].title}: ${FORMATS[k].blurb}`])), prior: Object.fromEntries(keys.map((k) => [k, prior[k]])) } },
    "show:format");
  const f = FORMATS[j.format.pick];
  // a little wobble so shows don't always start on the same minute
  s.event = { day: s.day, format: j.format.pick, minute: f.minute + pick([-30, -15, 0, 0, 15, 30]), place: f.place, bell: false, done: false };
  return s.event;
}

export const showOf = (s) => (s.event && s.event.day === s.day ? s.event : null);

// ---------- who gets the floor ----------
export async function lineup(s) {
  const ev = showOf(s);
  const f = FORMATS[ev.format];
  const vs = alive(s);
  const drama = (v) => 0.5 + v.mood.anger * 0.4 + v.bias.nerve * 0.6 + vs.filter((o) => o !== v && Math.abs(aff(s, v.id, o.id)) > 1).length * 0.25 + (sim.popularity(s, v.id) < 0 ? 0.5 : 0);
  if (f.kind === "hotseat") {
    // whoever the juiciest story going round is about, the newcomer included
    const pool = {};
    for (const r of Object.values(s.rumors)) {
      if (r.harm > -0.5 || !r.about || (r.about !== "player" && (!s.people[r.about] || s.people[r.about].gone)) || (r.about === "player" && s.player.out)) continue;
      const spread = vs.filter((v) => v.id !== r.about && v.knows[r.id]?.conf >= 0.4).length;
      if (spread < 2) continue;
      if (!pool[r.about] || pool[r.about].score < spread * -r.harm) pool[r.about] = { rid: r.id, score: spread * -r.harm };
    }
    const cands = Object.keys(pool).length ? Object.keys(pool) : vs.map((v) => v.id);
    const j = await jev.ask({ the_show: sim.showText(s), stories: Object.entries(pool).map(([id, x]) => `${nameOf(s, id)}: ${s.rumors[x.rid].text}`) },
      { seat: { type: "choice", instructions: "Primrose puts one woman in the Hot Seat to answer for what the town is saying about her. Who makes the best TV?", criteria: Object.fromEntries(cands.map((id) => [id, nameOf(s, id)])), prior: Object.fromEntries(cands.map((id) => [id, (pool[id]?.score || 0.5) + (id === "player" ? 1 : 0)])) } }, "show:seat");
    const seat = j.seat.pick;
    ev.seat = seat; ev.rumor = pool[seat]?.rid || null;
    return { seat, rumor: ev.rumor };
  }
  const chosen = [];
  const n = Math.min(f.speakers, vs.length);
  for (let i = 0; i < n; i++) {
    const cands = vs.filter((v) => !chosen.includes(v.id));
    const j = await jev.ask({ the_show: sim.showText(s), format: `${f.title}: ${f.blurb}`, already_picked: chosen.map((id) => nameOf(s, id)) },
      { who: { type: "choice", instructions: `Primrose picks who takes the floor at ${f.title}. Who will make it dramatic?`, criteria: Object.fromEntries(cands.map((v) => [v.id, `${v.name}: ${sim.moodText(v.mood)}`])), prior: Object.fromEntries(cands.map((v) => [v.id, drama(v)])) } }, "show:pick");
    chosen.push(j.who.pick);
  }
  // you always get the floor, somewhere in the middle or at the end
  const order = [...chosen];
  if (!s.player.out) order.splice(Math.max(1, Math.floor(Math.random() * (order.length + 1))), 0, "player");
  const assigned = {};
  if (f.assigned) for (const id of order) assigned[id] = await assign(s, id, assigned);
  ev.order = order; ev.assigned = assigned;
  return { order, assigned };
}

// Hot & Cold: Primrose hands each speaker a target, preferably one with bad blood.
async function assign(s, id, taken) {
  const used = new Set(Object.values(taken));
  const cands = others(s, id).filter((x) => !used.has(x));
  if (!cands.length) return others(s, id)[0];
  const j = await jev.ask({ the_show: sim.showText(s), speaker: id === "player" ? `${s.player.name}, the newcomer` : nameOf(s, id) },
    { target: { type: "choice", instructions: `Primrose hands ${firstOf(s, id)} the woman she must compliment and dig at. Bad blood makes better TV.`, criteria: Object.fromEntries(cands.map((x) => [x, nameOf(s, x)])), prior: Object.fromEntries(cands.map((x) => [x, 0.4 + Math.abs(aff(s, id === "player" ? x : id, id === "player" ? "player" : x)) + (x === "player" ? 0.6 : 0)])) } }, "show:assign");
  return j.target.pick;
}

// ---------- what a woman does with the floor ----------
// An act: { kind, by, subject, rumor, grievance }.
const KIND_TEXT = {
  praise: "a sincere compliment", backhanded: "a backhanded compliment", call_out: "calling her out in public", roast: "a mean joke at her expense",
  spill: "spilling gossip in front of everyone", apologize: "a public apology", confess: "a confession about herself", plead: "begging the town to keep her",
  name_vote: "saying she'd send her home", dodge: "playing it safe and saying nothing that matters",
};

function grievanceOf(s, by, x) {
  const note = rel(s, by, x)?.note;
  if (note && note.length > 24 && !/blank slate|new girl/.test(note)) return note;
  const v = s.people[by];
  const r = v && Object.entries(v.knows).filter(([rid, k]) => s.rumors[rid]?.about === x && s.rumors[rid].harm < 0 && k.conf >= 0.4).map(([rid]) => s.rumors[rid]).sort((a, b) => a.harm - b.harm)[0];
  return r ? r.text : null;
}

export async function npcAct(s, id, { assigned = null } = {}) {
  const ev = showOf(s), f = FORMATS[ev.format], v = s.people[id];
  const targets = assigned ? [assigned] : others(s, id);
  const byAff = [...targets].sort((a, b) => aff(s, id, b) - aff(s, id, a));
  const liked = byAff.slice(0, 2), hated = byAff.slice(-2).reverse();
  const crit = {}, prior = {}, meta = {};
  const add = (key, text, p, m) => { if (p <= 0) return; crit[key] = text; prior[key] = p; meta[key] = m; };
  const w = (k) => f.acts[k] || 0;
  for (const x of assigned ? targets : liked) add(`praise_${x}`, `Says something genuinely nice about ${nameOf(s, x)}`, w("praise") * (0.4 + Math.max(0, aff(s, id, x)) * 0.6 + v.bias.loyalty * 0.4), { kind: "praise", subject: x });
  for (const x of assigned ? targets : hated) {
    const g = grievanceOf(s, id, x);
    add(`back_${x}`, `Gives ${nameOf(s, x)} a backhanded compliment`, w("backhanded") * (0.4 + v.bias.scheme * 0.6 + Math.max(0, -aff(s, id, x)) * 0.3), { kind: "backhanded", subject: x });
    add(`call_${x}`, `Calls out ${nameOf(s, x)} in front of everyone${g ? ` about: ${g}` : ""}`, w("call_out") * (0.2 + v.bias.temper * 0.6 + Math.max(0, -aff(s, id, x)) * 0.6), { kind: "call_out", subject: x, grievance: g });
    add(`roast_${x}`, `Roasts ${nameOf(s, x)} with a mean joke`, w("roast") * (0.4 + v.bias.nerve * 0.5 + Math.max(0, -aff(s, id, x)) * 0.4), { kind: "roast", subject: x });
    add(`vote_${x}`, `Says she would send ${nameOf(s, x)} home`, w("name_vote") * (0.3 + v.bias.nerve * 0.5 + (v.votePlan?.target === x ? 2 : 0) + Math.max(0, -aff(s, id, x)) * 0.5), { kind: "name_vote", subject: x });
  }
  if (!assigned) {
    const juicy = Object.entries(v.knows).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid].about !== id && s.rumors[rid].harm < 0 && (s.rumors[rid].about === "player" || s.people[s.rumors[rid].about] && !s.people[s.rumors[rid].about].gone)).map(([rid]) => s.rumors[rid]).sort((a, b) => a.harm - b.harm).slice(0, 2);
    for (const r of juicy) add(`spill_${r.id}`, `Tells everyone: ${r.text}`, w("spill") * (0.3 + v.bias.gossip), { kind: "spill", subject: r.about, rumor: r.id });
    const worst = hated[0];
    if (worst && aff(s, id, worst) < -0.3) add(`sorry_${worst}`, `Apologizes to ${nameOf(s, worst)}`, w("apologize") * (0.2 + v.bias.loyalty * 0.7 + (v.bias.scheme > 0.7 ? 0.3 : 0)), { kind: "apologize", subject: worst, grievance: rel(s, id, worst)?.note });
    const sec = secretOf(s, id);
    if (sec) add("confess", `Confesses something about herself: ${sec.text}`, w("confess") * (0.2 + (1 - v.bias.deceit) * 0.8), { kind: "confess", subject: id, rumor: sec.id });
    add("plead", "Asks the town to keep her around", w("plead") * (0.5 + Math.max(0, -sim.popularity(s, id)) + v.mood.fear * 0.3), { kind: "plead", subject: null });
  }
  add("dodge", "Plays it safe and says nothing that matters", (w("dodge") || 0.15) * (0.4 + (1 - v.bias.nerve)), { kind: "dodge", subject: null });
  const j = await jev.ask({ ...sim.persona(s, v), the_moment: `${f.title} (${f.blurb}) at ${sim.placeName(ev.place)}. The whole town is watching ${first(v)}.`, on_newcomer: sim.feelings(s, v, "player") },
    { act: { type: "choice", instructions: `Primrose hands ${first(v)} the floor at ${f.title}. What does she do with it? She does what this woman really would in front of a crowd.`, criteria: crit, prior } }, `show:act:${id}`);
  return { ...meta[j.act.pick], by: id };
}

// What the player said, read for what it does. Jev reads it; obvious words steer the offline stand-in.
const RX = {
  praise: /\b(love|adore|amazing|gorgeous|beautiful|kind|sweet|best|queen|thank|thanks|cheers|proud|incredible|talented|lovely|wonderful|brilliant|icon)\b/i,
  call_out: /\b(liar|lied|lying|fake|snake|two-?faced|backstab\w*|stole|steal|cheat\w*|hate|sick of|nasty|rude|bully|mean|jealous|trash)\b/i,
  roast: /\b(lol|haha|joke|at least|looks like|smells like|ugly|old|hair|outfit|dressed|bless her)\b/i,
  apologize: /\b(sorry|apolog\w*|forgive|my bad|i was wrong)\b/i,
  confess: /\b(confess|admit|truth is|honestly,? i|i lied|i've been|i have been)\b/i,
  plead: /\b(keep me|vote for me|don't vote|dont vote|please|stay|deserve|give me a chance|i belong)\b/i,
  name_vote: /\b(send (her|.+) home|vote (her|.+) out|should go|has to go|gotta go|voting for|my vote)\b/i,
  deny: /\b(not true|lie|lies|never|didn't|did not|false|made (it|that) up|nonsense|ridiculous|absurd)\b/i,
  spill: /\b(heard|rumou?r|apparently|word is|did you know|saw her|secret|everyone knows)\b/i,
};
export async function playerAct(s, text, { assigned = null, defaultSubject = null, seatRumor = null } = {}) {
  const ev = showOf(s), f = FORMATS[ev.format];
  if (!text.trim()) return { kind: "dodge", by: "player", subject: null, line: "", answer: seatRumor ? "silent" : null };
  const lower = text.toLowerCase();
  const subs = others(s, "player");
  const named = subs.filter((id) => new RegExp(`\\b${firstOf(s, id).toLowerCase()}\\b`).test(lower));
  const kinds = [...Object.keys(KIND_TEXT), ...(seatRumor ? ["deny"] : [])];
  const kPrior = Object.fromEntries(kinds.map((k) => [k, (RX[k]?.test(text) ? 6 : 0.08) * (f.acts?.[k] ? 1.4 : 1)]));
  kPrior.dodge = 0.2;
  if (seatRumor) { kPrior.confess *= 2; kPrior.deny = RX.deny.test(text) ? 9 : 1.2; }
  // keywords miss tone and negation ("she's not fake"); the reading sets the direction
  const rd = readLine(text, { names: Object.fromEntries(subs.filter((id) => id !== "player").map((id) => [id, firstOf(s, id)])) });
  const warm = Math.max(rd.toSubject, rd.toListener), cold = Math.min(rd.toSubject, rd.toListener);
  if (warm > 0.3 && cold > -0.2) { kPrior.praise *= 3; kPrior.call_out *= 0.15; kPrior.roast *= 0.5; }
  if (cold < -0.3 && warm < 0.2) { kPrior.call_out *= 1.8; kPrior.praise *= 0.15; }
  if (warm > 0.3 && cold < -0.3) kPrior.backhanded = (kPrior.backhanded || 0.1) * 4; // sweet and nasty at once
  if (rd.acts.apology > 0.5) kPrior.apologize = Math.max(kPrior.apologize, 6);
  if (rd.acts.vote_pitch > 0.5) kPrior.name_vote = Math.max(kPrior.name_vote, 8);
  if (rd.acts.plead > 0.5) kPrior.plead = Math.max(kPrior.plead, 6);
  const sCrit = { none: "Nobody in particular / the whole town", ...Object.fromEntries(subs.map((id) => [id, nameOf(s, id)])) };
  const sPrior = { none: named.length || assigned || defaultSubject ? 0.2 : 3, ...Object.fromEntries(subs.map((id) => [id, named.includes(id) ? 8 : id === assigned || id === defaultSubject ? 4 : 0.1])) };
  const j = await jev.ask({ the_moment: `${f.title} (${f.blurb}). ${s.player.name}, the newcomer, has the floor in front of the whole town.`, said: text, ...(assigned ? { primrose_assigned: nameOf(s, assigned) } : {}) }, {
    kind: { type: "choice", instructions: seatRumor ? `${s.player.name} is in the Hot Seat answering for this story: "${s.rumors[seatRumor].text}". What is she doing with what she said?` : `What is ${s.player.name} doing with what she said?`, criteria: Object.fromEntries(kinds.map((k) => [k, k === "deny" ? "denying the story" : k === "confess" && seatRumor ? "admitting the story is true" : KIND_TEXT[k]])), prior: kPrior },
    subject: { type: "choice", instructions: `Who is ${s.player.name} talking about or to?`, criteria: sCrit, prior: sPrior },
  }, "show:you");
  // a name she says, or the woman Primrose handed her, settles who it's about
  let kind = j.kind.pick, subject = named[0] || assigned || defaultSubject || (j.subject.pick === "none" ? null : j.subject.pick);
  if (["praise", "backhanded", "call_out", "roast", "apologize", "name_vote"].includes(kind) && !subject) subject = assigned || defaultSubject || named[0] || null;
  if (!subject && kind !== "plead" && kind !== "confess" && kind !== "spill") kind = kind === "praise" ? "plead" : kind;
  let rumor = null;
  if (seatRumor && (kind === "deny" || kind === "confess")) return { kind, by: "player", subject: null, rumor: seatRumor, line: text, answer: kind === "deny" ? "deny" : "admit" };
  if ((kind === "spill" || kind === "call_out") && subject) {
    rumor = sim.newRumor(s, { about: subject, text: `${s.player.name} said in front of everyone at ${f.title}: "${text.slice(0, 160)}"`, origin: "player", isTrue: null, harm: kind === "spill" ? -1.2 : -0.8, kind: "show" });
    s.player.told.push({ rid: rumor, to: "crowd", day: s.day, time: sim.clock(s.minute), believed: null });
  }
  if (kind === "confess") rumor = sim.newRumor(s, { about: "player", text: `${s.player.name} confessed at ${f.title}: "${text.slice(0, 160)}"`, origin: "player", isTrue: true, harm: -0.4, kind: "show" });
  return { kind, by: "player", subject, rumor, line: text };
}

// ---------- the hot seat ----------
export async function seatAnswer(s, id, rid) {
  const v = s.people[id], r = rid && s.rumors[rid];
  const source = r && s.people[r.origin] && !s.people[r.origin].gone && r.origin !== id ? r.origin : null;
  const crit = { deny: "Flatly denies it", admit: "Admits it, owns it", laugh: "Laughs it off" }, prior = { deny: 1 + v.bias.deceit, admit: r?.isTrue ? 0.4 + (1 - v.bias.deceit) : 0.15, laugh: 0.4 + v.bias.nerve * 0.6 };
  if (source) { crit.blame = `Turns on ${nameOf(s, source)}, who she thinks started it`; prior.blame = 0.3 + v.bias.temper + Math.max(0, -aff(s, id, source)) * 0.5; }
  const j = await jev.ask({ ...sim.persona(s, v), the_moment: `In the Hot Seat in front of the whole town, Primrose reads out: "${r ? r.text : "everyone has a problem with you"}"` },
    { answer: { type: "choice", instructions: `How does ${first(v)} answer in the Hot Seat?`, criteria: crit, prior } }, `show:seat:${id}`);
  const a = j.answer.pick;
  return { kind: a === "admit" ? "confess" : a === "blame" ? "call_out" : a === "laugh" ? "dodge" : "deny", answer: a, by: id, subject: a === "blame" ? source : null, rumor: rid, grievance: a === "blame" ? `she started the story going round about her` : null };
}

// Primrose reads the story out: now everyone has heard it.
export function readOut(s, rid, ui) {
  if (!rid || !s.rumors[rid]) return;
  for (const v of alive(s)) if (v.id !== s.rumors[rid].about) sim.learn(s, v, rid, Math.max(v.knows[rid]?.conf || 0, 0.5), "primrose");
  if (s.rumors[rid].about !== "player") sim.playerHears(s, rid, "primrose", "heard at the show", ui);
}

// Someone in the crowd pipes up at the hot seat: heckles her or sticks up for her.
export async function pipeUp(s, seat, exclude = []) {
  const vs = alive(s).filter((v) => v.id !== seat && !exclude.includes(v.id));
  const res = await Promise.all(vs.map(async (v) => {
    const a = aff(s, v.id, seat);
    const j = await jev.ask({ ...sim.persona(s, v), the_moment: `${firstOf(s, seat)} is in the Hot Seat in front of the whole town`, on_her: seat === "player" ? sim.feelings(s, v, "player") : sim.feelings(s, v, s.people[seat]) },
      { pipe: { type: "choice", instructions: `Does ${first(v)} speak up from the crowd?`, criteria: { quiet: "Stays quiet and watches", heckle: `Heckles ${firstOf(s, seat)}`, defend: `Sticks up for ${firstOf(s, seat)}` }, prior: { quiet: 4, heckle: Math.max(0, -a) * v.bias.nerve * 2 + v.bias.temper * 0.3, defend: Math.max(0, a) * v.bias.loyalty * 2 } } }, `show:pipe:${v.id}`);
    return [v.id, j.pipe.pick];
  }));
  return res.filter(([, p]) => p !== "quiet").sort(() => Math.random() - 0.5).slice(0, 2).map(([id, p]) => ({ kind: p === "heckle" ? "roast" : "praise", by: id, subject: seat, pipe: p }));
}

// A woman answers back after being called out or roasted.
export async function rebuttal(s, id, act) {
  const v = s.people[id];
  const j = await jev.ask({ ...sim.persona(s, v), the_moment: `In front of the whole town, ${firstOf(s, act.by)} just went for ${first(v)}: ${KIND_TEXT[act.kind]}${act.grievance ? ` (${act.grievance})` : ""}`, on_her: act.by === "player" ? sim.feelings(s, v, "player") : sim.feelings(s, v, s.people[act.by]) },
    { back: { type: "choice", instructions: `How does ${first(v)} answer, right there in front of everyone?`, criteria: { fire_back: `Fires right back at ${firstOf(s, act.by)}`, laugh: "Laughs it off like a pro", sorry: "Apologizes", hurt: "Goes quiet, clearly hurt" }, prior: { fire_back: 0.4 + v.bias.temper + v.bias.nerve * 0.5, laugh: 0.3 + v.bias.nerve * 0.8, sorry: act.kind === "call_out" ? 0.3 * v.bias.loyalty : 0.05, hurt: 0.3 + (1 - v.bias.nerve) * 0.6 } } }, `show:back:${id}`);
  const b = j.back.pick;
  return { kind: { fire_back: "roast", laugh: "dodge", sorry: "apologize", hurt: "dodge" }[b], answer: b, by: id, subject: b === "fire_back" || b === "sorry" ? act.by : null };
}

// ---------- the crowd ----------
const EFFECT = { loved: 0.6, amused: 0.3, unmoved: 0, cringed: -0.35, offended: -0.8 };
const HOSTILE = new Set(["call_out", "roast", "backhanded", "name_vote", "spill"]);

export function actText(s, act) {
  const x = act.subject ? nameOf(s, act.subject) : null;
  const r = act.rumor && s.rumors[act.rumor];
  return {
    praise: `said something lovely about ${x}`, backhanded: `gave ${x} a backhanded compliment`, call_out: `called out ${x} in front of everyone${act.grievance ? ` about: ${act.grievance}` : ""}`,
    roast: `roasted ${x} with a mean joke`, spill: `told the whole crowd: ${r ? r.text : "some gossip"}`, apologize: `apologized to ${x}`,
    confess: `confessed: ${r ? r.text : "something about herself"}`, plead: "begged the town to keep her", name_vote: `said she would send ${x} home`,
    dodge: act.answer === "hurt" ? "went quiet, clearly hurt" : act.answer === "laugh" ? "laughed it off" : "played it safe and said nothing much", deny: `denied it: ${r ? r.text : "the story"}`,
  }[act.kind] || "spoke";
}

// Every woman listening decides how it landed. Returns { reactions: { id: kind }, snap, tally }.
export async function crowdReacts(s, act, ui, { line = "" } = {}) {
  const ev = showOf(s), f = FORMATS[ev.format];
  const by = act.by, x = act.subject, what = actText(s, act);
  const listeners = alive(s).filter((v) => v.id !== by);
  const claim = act.rumor && (act.kind === "spill" || act.kind === "call_out" || act.kind === "deny");
  const speakerName = firstOf(s, by);
  let snap = null;
  const out = {};
  await Promise.all(listeners.map(async (L) => {
    const toS = aff(s, L.id, by), toX = x && x !== L.id ? aff(s, L.id, x) : 0, isX = x === L.id, b = L.bias;
    const k = act.kind;
    const p = { loved: 0.6 + Math.max(0, toS) * 0.6, amused: 0.5 + b.gossip * 0.4, unmoved: 1.4, cringed: 0.4 + Math.max(0, -toS) * 0.4, offended: 0.15 + Math.max(0, -toS) * 0.3 };
    if (k === "praise") { p.loved += isX ? 3 : Math.max(0, toX) * 1.2; p.cringed += Math.max(0, -toX) * 1.2; }
    else if (k === "backhanded" || k === "roast") { p.amused += Math.max(0, -toX) * 1.2 + b.nerve * 0.4; p.offended += isX ? 3 - b.nerve : Math.max(0, toX) * 1.0; p.cringed += b.loyalty * 0.3; }
    else if (k === "call_out") { p.loved += Math.max(0, -toX) * 1.2; p.offended += isX ? 3.5 : Math.max(0, toX) * 1.3; p.cringed += 0.4 + b.loyalty * 0.4; }
    else if (k === "spill") { p.amused += b.gossip * 1.2; p.cringed += b.loyalty * 0.6 + (1 - b.gossip) * 0.5; p.offended += isX ? 3.5 : Math.max(0, toX) * 1.0; }
    else if (k === "apologize") { p.loved += b.loyalty * 0.8 + (isX ? b.loyalty * 2 : 0); p.cringed += b.scheme * 0.5; p.unmoved += isX ? Math.max(0, -toS) : 0; }
    else if (k === "confess") { p.loved += (1 - b.deceit) * 1.2; p.cringed += b.scheme * 0.4; p.amused += b.gossip * 0.6; }
    else if (k === "plead") { p.loved += Math.max(0, toS) * 1.0; p.cringed += 0.5 + Math.max(0, -toS) * 0.8; }
    else if (k === "name_vote") { p.loved += Math.max(0, -toX) * 1.4 + (L.votePlan?.target === x ? 1.5 : 0); p.offended += isX ? 4 : Math.max(0, toX) * 1.4; }
    else if (k === "dodge") { p.unmoved += 1.5; p.cringed += b.scheme * 0.6; p.loved = 0.1; }
    else if (k === "deny") { p.unmoved += 0.5; p.loved += Math.max(0, toS) * 0.6; p.cringed += Math.max(0, -toS) * 0.6; }
    const qs = { react: { type: "choice", instructions: `${first(L)} is in the crowd at ${f.title}. ${speakerName} just ${what}${line ? ` (her words: "${line.slice(0, 160)}")` : ""}. How does it land with ${first(L)}?`, criteria: { loved: `She loves it and warms to ${speakerName}`, amused: "She's entertained", unmoved: "It does nothing for her", cringed: `She cringes; it makes ${speakerName} look bad`, offended: `She's offended and turns on ${speakerName}` }, prior: p } };
    if (claim && !isX) qs.believe = { type: "noul", instructions: `Does ${first(L)} believe it?`, prior: Math.max(0.05, Math.min(0.95, 0.45 + (rel(s, L.id, by)?.trust ?? 0) * 0.12 + (act.kind === "deny" ? 0 : -toX * 0.1))) };
    if (isX && HOSTILE.has(k)) {
      qs.snap = { type: "noul", instructions: `${first(L)} is so stung that she storms over to ${speakerName} and a cat fight breaks out right there in front of everyone.`, prior: Math.min(0.45, b.temper * (0.06 + L.mood.anger * 0.06 + Math.max(0, -toS) * 0.05)) };
      qs.payback = { type: "noul", instructions: `${first(L)} decides ${speakerName} has to be voted out for this.`, prior: Math.min(0.8, 0.15 + b.scheme * 0.3 + Math.max(0, -toS) * 0.15) };
    }
    const persona = sim.persona(s, L);
    const j = await jev.ask({ ...persona, ...(by === "player" && s.player.outfit ? { speaker_look: lookText(s) } : {}), on_speaker: by === "player" ? sim.feelings(s, L, "player") : sim.feelings(s, L, s.people[by]), ...(x && !isX ? { on_subject: x === "player" ? sim.feelings(s, L, "player") : sim.feelings(s, L, s.people[x]) } : {}) }, qs, `show:crowd:${L.id}`);
    const reaction = j.react.pick;
    out[L.id] = reaction;
    // how she feels about the speaker now
    const r = rel(s, L.id, by);
    if (r) {
      let d = EFFECT[reaction] * (isX ? 1.6 : 1);
      if (isX && k === "praise" && reaction !== "offended") d = Math.max(d, 0.8);
      M.shift(s, L.id, by, { aff: d, trust: reaction === "offended" ? -0.3 : 0, why: Math.abs(d) >= (isX ? 0.3 : 0.45) ? `${isX ? "about me, " : ""}${sim.short(what, 60)} at ${f.title}` : null });
    }
    if (isX && HOSTILE.has(k)) M.stir(L, { anger: reaction === "offended" ? 1 : 0.5, why: `${speakerName} went after her at ${f.title}` });
    // a story told in front of everyone travels to everyone
    if (claim && act.rumor && !isX) {
      if (act.kind === "deny") { const k0 = L.knows[act.rumor]; if (k0 && j.believe.yes) k0.conf = Math.max(0.1, k0.conf - 0.3); }
      else sim.learn(s, L, act.rumor, j.believe.yes ? 0.8 : 0.3, by);
    }
    if (act.kind === "confess" && act.rumor) sim.learn(s, L, act.rumor, 1, by);
    if (isX && j.payback?.yes) M.planVote(s, L, by, `${speakerName} ${sim.short(what, 60)} at ${f.title}`, { strength: 2.5 });
    if (isX && j.snap?.yes && !snap) snap = L.id;
    sim.remember(L, s, `at ${f.title}, ${speakerName} ${what}; I ${{ loved: "loved it", amused: "was entertained", unmoved: "wasn't moved", cringed: "cringed", offended: "was offended" }[reaction]}`, isX ? 3 : Math.abs(EFFECT[reaction]) >= 0.4 ? 2 : 1);
  }));
  // a public vote naming is a vote plot everyone knows about
  if (act.kind === "name_vote" && x) {
    if (by !== "player") M.planVote(s, s.people[by], x, "she said so in front of everyone", { strength: 2.5 });
    const vid = sim.newRumor(s, { about: by, text: `${nameOf(s, by)} said in front of everyone that she'd send ${nameOf(s, x)} home.`, origin: "truth", isTrue: true, harm: -0.5, kind: "vote", target: x });
    for (const L of listeners) sim.learn(s, L, vid, 1, "self");
    if (by !== "player") sim.playerHears(s, vid, by, "heard at the show", ui);
  }
  if (claim && by !== "player" && act.rumor && act.kind !== "deny") sim.playerHears(s, act.rumor, by, "heard at the show", ui);
  if (act.kind === "confess" && act.rumor && by !== "player") sim.playerHears(s, act.rumor, by, "heard at the show", ui);
  const tally = { loved: 0, amused: 0, unmoved: 0, cringed: 0, offended: 0 };
  for (const k of Object.values(out)) tally[k]++;
  if (by === "player") s.player.showScore = (s.player.showScore || 0) + tally.loved + tally.amused * 0.5 - tally.cringed * 0.5 - tally.offended;
  const warm = tally.loved + tally.amused, cold = tally.cringed + tally.offended;
  if (by !== "player" && (warm >= 5 || cold >= 4)) sim.headline(s, warm >= 5 ? `The crowd ate up ${speakerName}'s moment at ${f.title}.` : `${speakerName} bombed at ${f.title}. The crowd turned on her.`, warm >= 5 ? "info" : "drama", ui, { witnessed: false });
  return { reactions: out, snap, tally };
}

// The show is over: everyone is at the venue, and the clock moves on.
export function finish(s) {
  const ev = showOf(s);
  if (!ev) return;
  ev.done = true;
  (s.shows ||= []).push({ day: s.day, format: ev.format });
  s.minute = Math.max(s.minute, ev.minute + 45);
  for (const v of alive(s)) { v.location = ev.place; v.approaching = false; }
  s.player.location = ev.place;
  sim.headline(s, `${FORMATS[ev.format].title} is over. The whole town is talking.`, "info", { headline: () => {} }, { witnessed: false });
}
