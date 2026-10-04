// The living town. Every decision a cast member makes goes through Jev; code keeps the
// numbers, applies the results, and remembers everything.
//
// The sim talks to the page through `ui` hooks (all optional):
//   moved(v)                      her destination changed
//   pair(a, b, place)             two women stop to talk; b walks over to a
//   hearing(a, b)                 "full" | "part" | "none": how much the player hears
//   distance(v)                   metres from the player
//   exchange({ a, b, lines, full }) play an overheard conversation as speech bubbles
//   headline(text, kind)          something happened that the player sees
//   emote(id, symbol)             a little symbol over someone's head
//   approach(v, line, purpose)    she walks up to the player and starts talking
//   first(kind, data)             something happened for the first time (for tips)

import * as jev from "./jev.js";
import * as voice from "./voice.js";
import { PLACES, SHOW, ITEMS, TASTES, FASHION } from "./cast.js";
import { opinionText, lookText } from "./looks.js";
import { outfitKey } from "./wardrobe.js";

// ---------- small helpers ----------

export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const first = (v) => v.name.split(" ")[0];
export const clamp = (x, lo = -3, hi = 3) => Math.max(lo, Math.min(hi, x));
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

export const alive = (s) => Object.values(s.people).filter((v) => !v.gone);
export const at = (s, place) => alive(s).filter((v) => v.location === place);
export const nameOf = (s, id) => (id === "player" ? s.player.name : id === "board" ? "an anonymous note" : s.people[id] ? s.people[id].name : id || "someone");
export const firstOf = (s, id) => (id === "player" ? s.player.name : s.people[id] ? first(s.people[id]) : id || "someone");
export const daysToVote = (s) => (SHOW.voteEvery - (s.day % SHOW.voteEvery)) % SHOW.voteEvery;
export const isVoteDay = (s) => daysToVote(s) === 0;

const FEEL = ["hates", "dislikes", "is cool toward", "is neutral about", "likes", "is fond of", "adores"];
const TRUST = ["completely distrusts", "distrusts", "doubts", "is unsure about", "mostly trusts", "trusts", "trusts completely"];
export const feel = (x) => FEEL[Math.round(clamp(x) + 3)];
export const trust = (x) => TRUST[Math.round(clamp(x) + 3)];
export const moodText = (m) => [m.anger >= 2 ? "furious" : m.anger >= 1 ? "irritated" : null, m.fear >= 2 ? "scared" : m.fear >= 1 ? "uneasy" : null, m.cheer >= 2 ? "cheerful" : m.cheer <= 0 ? "glum" : null].filter(Boolean).join(", ") || "calm";

function nature(v) {
  const b = v.bias, out = [];
  if (b.gossip > 0.7) out.push("can't resist passing on gossip"); else if (b.gossip < 0.3) out.push("rarely gossips");
  if (b.deceit > 0.7) out.push("lies easily and well"); else if (b.deceit < 0.3) out.push("hates lying");
  if (b.loyalty > 0.75) out.push("fiercely loyal to her allies"); else if (b.loyalty < 0.4) out.push("drops allies the moment it suits her");
  if (b.temper > 0.7) out.push("explosive temper"); else if (b.temper < 0.25) out.push("avoids fights");
  if (b.scheme > 0.75) out.push("plays the game ruthlessly"); else if (b.scheme < 0.3) out.push("doesn't really play the game");
  if (b.nosy > 0.75) out.push("pries into everything");
  if (b.social > 0.8) out.push("always looking for company"); else if (b.social < 0.4) out.push("likes being left alone");
  return out.join(", ");
}

export function remember(v, s, text) {
  v.memory.push(`day ${s.day} ${clock(s.minute)}: ${text}`);
  if (v.memory.length > 16) v.memory.splice(0, v.memory.length - 16);
}

export function headline(s, text, kind, ui, { place, witnessed = true } = {}) {
  s.log.push({ day: s.day, time: clock(s.minute), text, kind });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  if (place) s.events.push({ day: s.day, time: clock(s.minute), place, text, witnesses: at(s, place).map((v) => v.id) });
  if (witnessed) ui.headline?.(text, kind);
}

export function newRumor(s, { about, text, origin, isTrue = null, harm = 0, parent = null, kind = "gossip", target }) {
  const id = "r" + s.nextRumor++;
  s.rumors[id] = { id, about, text, origin, isTrue, harm, parent, kind, day: s.day, time: clock(s.minute), ...(target ? { target } : {}) };
  return id;
}

export function learn(s, v, rumorId, conf, from) {
  const had = v.knows[rumorId];
  if (!had || had.conf < conf) v.knows[rumorId] = { conf, from, day: s.day, time: clock(s.minute) };
  // believing bad news about someone changes how you feel about them
  const r = s.rumors[rumorId];
  if (r.about && r.about !== v.id && (!had || conf > had.conf)) {
    const delta = (r.harm / 2) * (conf - (had?.conf || 0));
    const rel = s.rel[v.id][r.about];
    if (rel) { rel.affinity = clamp(rel.affinity + delta); rel.trust = clamp(rel.trust + delta * 0.6); }
  }
}

// The player hears a story. Kept for the rumor tracker.
export function playerHears(s, rid, from, how, ui) {
  if (!rid || !s.rumors[rid]) return;
  if (s.player.heard.some((h) => h.rid === rid)) return;
  s.player.heard.push({ rid, from, how, day: s.day, time: clock(s.minute) });
  ui.first?.("rumor", { rid });
  ui.heard?.(rid);
}

function knowledge(s, v, max = 6) {
  return Object.entries(v.knows)
    .filter(([, k]) => k.conf >= 0.3)
    .sort((p, q) => q[1].conf - p[1].conf)
    .slice(0, max)
    .map(([id, k]) => `${s.rumors[id].text} (${k.conf >= 0.8 ? "sure" : k.conf >= 0.5 ? "believes" : "half-believes"}; ${k.from === "self" ? "knows first-hand" : `heard from ${nameOf(s, k.from)}`})`);
}

export const alliancesOf = (s, id) => s.alliances.filter((a) => a.members.includes(id) && a.members.filter((m) => m === "player" || !s.people[m]?.gone).length >= 2);

function allianceLines(s, v) {
  return alliancesOf(s, v.id).map((a) => {
    const others = a.members.filter((m) => m !== v.id && (m === "player" || !s.people[m].gone)).map((m) => nameOf(s, m));
    return `secret pact "${a.name}" with ${others.join(" and ")}${a.sincere[v.id] ? "" : " (she is only pretending)"}`;
  });
}

export function showText(s) {
  const d = daysToVote(s);
  const left = alive(s).length + (s.player.out ? 0 : 1);
  return `Day ${s.day} of a reality show. ${left} women left. ${d === 0 ? "The vote is TONIGHT at the firepit." : `The next vote is in ${d} day${d > 1 ? "s" : ""}.`} At every vote the town votes one woman out. Everyone wants to be the last one standing.`;
}

export function persona(s, v) {
  return {
    who: `${v.name}, the ${v.employed ? v.job : `out-of-work ${v.job}`} (${v.archetype})`,
    personality: v.traits.join(", "),
    ...(FASHION[v.id] ? { taste_in_clothes: FASHION[v.id].text } : {}),
    nature: nature(v),
    mood: moodText(v.mood),
    where: placeName(v.location),
    works_at: PLACES[v.work]?.name,
    plan: planText(s, v.intent),
    vote_plan: v.votePlan ? `vote out ${nameOf(s, v.votePlan.target)}${v.votePlan.why ? ` (${v.votePlan.why})` : ""}` : "undecided",
    alliances: allianceLines(s, v),
    the_show: showText(s),
    knows: knowledge(s, v),
    recent: v.memory.slice(-6),
  };
}

export function feelings(s, a, b) {
  const id = b === "player" ? "player" : b.id;
  const r = s.rel[a.id][id];
  const look = id === "player" ? opinionText(s, a.id) : null;
  return `${first(a)} ${feel(r.affinity)} ${nameOf(s, id)} and ${trust(r.trust)} her (${r.note})${look ? `; ${look}` : ""}`;
}

const candidatesFor = (s, v) => [...alive(s).filter((o) => o.id !== v.id).map((o) => o.id), ...(s.player.out ? [] : ["player"])];

// How dangerous someone is to keep around: well liked people win these shows.
export function popularity(s, id) {
  const vs = alive(s).filter((v) => v.id !== id);
  return vs.reduce((t, v) => t + s.rel[v.id][id].affinity, 0) / Math.max(1, vs.length);
}

// ---------- plans ----------
// A plan is something a cast member has decided to do: { kind, target, rumor, why, promisedTo, now }.
// The plan is in every later Jev state for her until she carries it out.

export const placeName = (loc) => PLACES[loc]?.name || (loc === "home" ? "her cottage" : "the lane");

export function planText(s, it) {
  if (!it) return "nothing in particular";
  const who = nameOf(s, it.target);
  const r = it.rumor && s.rumors[it.rumor] ? `"${s.rumors[it.rumor].text}"` : "";
  const text = {
    ask: `ask ${who} whether this is true: ${r}`,
    confront: `confront ${who}${r ? ` about: ${r}` : ""}`,
    warn: `warn ${who} what people are saying: ${r}`,
    report: `take this to Hesper: ${r}`,
    spread: `pass this on to someone: ${r}`,
    make_peace: `make peace with ${who}`,
    recruit: `ask ${who} to team up for the vote`,
    lobby: `get ${who} to vote out ${nameOf(s, it.voteTarget)}`,
  }[it.kind] || `${it.kind.replace(/_/g, " ")} ${it.target ? who : ""}`.trim();
  return text + (it.why ? ` (because ${it.why})` : "");
}

export function setPlan(s, v, plan) {
  if (plan.target === v.id) return;
  if (plan.kind === "report") plan.target = "hesper";
  if (plan.target === "hesper" && (v.id === "hesper" || s.people.hesper?.gone)) return;
  v.intent = { ...plan, made: `day ${s.day} ${clock(s.minute)}` };
  remember(v, s, `decided to ${planText(s, v.intent)}${plan.promisedTo ? `, and told ${nameOf(s, plan.promisedTo)} so` : ""}`);
}

function doneWithPlan(s, v) {
  if (!v.intent) return;
  remember(v, s, `did what I meant to: ${planText(s, v.intent)}`);
  v.intent = null;
}

function joinAlliance(s, a, b, sincereB, place) {
  let al = alliancesOf(s, a).find((x) => x.members.length < 4);
  if (al && al.members.includes(b)) { al.sincere[b] = sincereB; return al; }
  if (!al) {
    const names = { plaza: "the Fountain Pact", bakery: "the Bun Club", salon: "the Blowout Bunch", tavern: "the Last Call", gazette: "the Inkwells", market: "the Price Fixers", hall: "the Back Benchers", smithy: "the Anvils", garden: "the Weeds", dock: "the Dock Pact", firepit: "the Embers", home: "the Porch Pact" };
    al = { id: "a" + s.nextAlliance++, name: names[place] || "the Pact", members: [a], day: s.day, sincere: { [a]: true } };
    if (s.alliances.some((x) => x.name === al.name)) al.name += ` ${["II", "III", "IV", "V"][Math.min(3, s.nextAlliance % 4)]}`;
    s.alliances.push(al);
  }
  al.members.push(b);
  al.sincere[b] = sincereB;
  return al;
}

// ---------- the world tick (every 15 game minutes) ----------

export async function setOff(s, v, ui) {
  const t = v.intent?.target;
  if (t && t !== "player" && s.people[t]?.location === v.location) return;
  await move(s, v, ui);
}

let approachBusy = false;

export async function tick(s, ui) {
  // the vote bell: on vote days everyone heads to the firepit at 19:00
  if (isVoteDay(s) && s.minute >= 19 * 60) {
    for (const v of alive(s)) if (v.location !== "firepit" && v.id !== s.player.talkingTo) { v.location = "firepit"; ui.moved?.(v); }
    return;
  }
  // Primrose's show: half an hour before, everyone heads over
  const ev = s.event && s.event.day === s.day && !s.event.done ? s.event : null;
  if (ev && s.minute >= ev.minute - 30) {
    for (const v of alive(s)) if (v.location !== ev.place && v.id !== s.player.talkingTo) { v.location = ev.place; ui.moved?.(v); }
    return;
  }
  const found = (v) => v.intent?.target && v.intent.target !== "player" && s.people[v.intent.target]?.location === v.location;
  await Promise.all(alive(s).filter((v) => v.id !== s.player.talkingTo && !found(v)).map((v) => move(s, v, ui)));

  // who meets whom: people who came looking for someone talk to them first, then up to two more pairs per place
  const jobs = [];
  for (const place of Object.keys(PLACES)) {
    const here = shuffle(at(s, place).filter((v) => v.id !== s.player.talkingTo && !v.approaching));
    const used = new Set(), pairs = [];
    for (const a of here) {
      const b = a.intent?.target && here.find((o) => o.id === a.intent.target);
      if (b && !used.has(a.id) && !used.has(b.id)) { pairs.push([a, b]); used.add(a.id); used.add(b.id); }
    }
    const rest = here.filter((v) => !used.has(v.id));
    for (let i = 0; i + 1 < rest.length && i < 4; i += 2) pairs.push([rest[i], rest[i + 1]]);
    for (const [a, b] of pairs) jobs.push(encounter(s, a, b, place, ui));
  }
  await Promise.all(jobs);
  await readNotes(s, ui);
  // walk-ups run alongside the clock so a slow opening line never stalls the town
  if (!approachBusy) { approachBusy = true; approaches(s, ui).catch((e) => console.error(e)).finally(() => { approachBusy = false; }); }
}

// Where she goes next. Jev decides from who she is, the time, her job, her plans and the show.
export async function move(s, v, ui) {
  const criteria = { stay: `Stay at ${placeName(v.location)}` };
  const prior = { stay: 5 };
  const hour = s.minute / 60;
  for (const [k, p] of Object.entries(PLACES)) {
    if (k === v.location || k === "firepit") continue;
    criteria[k] = `Go to ${p.name}${k === v.work ? `, where ${first(v)} works` : ""}`;
    prior[k] = k === v.work ? (hour < 16 && v.employed ? 2.5 : 0.4) : ["plaza", "tavern", "salon", "bakery"].includes(k) ? 0.3 + v.bias.social * 0.5 : 0.25;
    if (k === "tavern" && hour >= 16) prior[k] += 0.8;
    if (k === "dock" && v.mood.anger + v.mood.fear >= 2) prior[k] += 1;
  }
  if (v.location !== "home") { criteria.home = `Go home to ${first(v)}'s cottage`; prior.home = v.bias.social < 0.4 ? 0.4 : 0.1; }
  for (const o of alive(s)) if (o.id !== v.id) {
    criteria[`find_${o.id}`] = `Go and find ${o.name}`;
    prior[`find_${o.id}`] = v.intent?.target === o.id ? (v.intent.now ? 30 : 8) : 0.05;
  }
  criteria.find_player = `Go and find ${s.player.name}, the newcomer`;
  prior.find_player = v.intent?.target === "player" ? 8 : 0.05 + v.bias.nerve * 0.1;
  const it = v.intent;
  const a = await jev.ask({
    ...persona(s, v),
    plan: planText(s, it) + (it?.promisedTo ? `. ${first(v)} told ${nameOf(s, it.promisedTo)} she would do this${it.now ? " right away" : ""}` : ""),
    time: `${clock(s.minute)} (the day ends at 20:00)`,
    people_here: at(s, v.location).filter((o) => o.id !== v.id).map((o) => o.name),
    where_people_are: alive(s).filter((o) => o.id !== v.id).map((o) => `${o.name}: ${placeName(o.location)}`).concat(`${s.player.name} (the newcomer): ${placeName(s.player.location)}`),
  }, {
    go: {
      type: "choice",
      instructions: `It is ${clock(s.minute)}. Decide where ${first(v)} goes for the next quarter hour, the way this woman really would: her job and the time of day, her mood, who she wants to see, work on or avoid, and any plan she has made. People follow through on plans, most of all ones they told someone about. This is a slow, calm village: people usually stay where they are for a good while and only move when they have a reason.`,
      criteria, prior,
    },
  }, `move:${v.id}`);
  let dest = a.go.pick;
  if (dest === "stay") dest = v.location;
  if (dest.startsWith("find_")) {
    const id = dest.slice(5);
    dest = id === "player" ? s.player.location : s.people[id]?.location;
  }
  if (!PLACES[dest] && dest !== "home") dest = v.location;
  if (dest !== v.location) {
    v.location = dest;
    ui.moved?.(v);
  }
  // moods drift back toward calm
  v.mood.anger = Math.max(0, v.mood.anger - 0.12);
  v.mood.fear = Math.max(0, v.mood.fear - 0.08);
  v.mood.cheer += (1 - v.mood.cheer) * 0.08;
}

const WARMTH = ["much colder toward each other", "a bit colder", "about the same", "a bit warmer", "much warmer toward each other"];

const REACTIONS = (aboutName) => ({
  nothing: "Does nothing about it",
  spread: "Will pass it on to someone else",
  ask_subject: `Will go and ask ${aboutName} whether it is true`,
  warn_subject: `Will go and warn ${aboutName} what people are saying`,
  confront: `Will go and confront ${aboutName}`,
  report: "Will take it to Hesper, the elder",
  vote_out: `Decides ${aboutName} has to be voted out`,
});

async function encounter(s, a, b, place, ui) {
  if (b.intent?.target === a.id && a.intent?.target !== b.id) [a, b] = [b, a];
  const rAB = s.rel[a.id][b.id], rBA = s.rel[b.id][a.id];
  ui.pair?.(a, b, place);
  const hear = ui.hearing ? ui.hearing(a, b) : "none";
  const playerHere = hear !== "none";
  const listening = hear === "full";
  const plan = a.intent && (a.intent.target === b.id || a.intent.kind === "spread") ? a.intent : null;
  const planRumor = plan?.rumor && s.rumors[plan.rumor];
  const allied = alliancesOf(s, a.id).some((x) => x.members.includes(b.id));

  const shareable = Object.entries(a.knows).filter(([id, k]) => k.conf >= 0.4 || id === plan?.rumor).map(([id]) => s.rumors[id]).filter((r) => r.about !== a.id || Math.random() < 0.1).slice(-7);
  const rumorCriteria = { none: "Nothing in particular" }, rumorPrior = { none: 1 };
  for (const r of shareable) {
    rumorCriteria[r.id] = `${r.text} (about ${nameOf(s, r.about)})`;
    rumorPrior[r.id] = 1 + (r.about && r.about !== "player" && s.rel[a.id][r.about] ? Math.max(0, -s.rel[a.id][r.about].affinity) : 0.5) + (r.id === plan?.rumor ? 5 : 0) - (r.about === b.id ? 0.5 : 0);
  }
  const targets = candidatesFor(s, a).filter((id) => id !== b.id);
  const voteCriteria = Object.fromEntries(targets.map((id) => [id, nameOf(s, id)]));
  const votePrior = Object.fromEntries(targets.map((id) => [id, 0.5 + Math.max(0, -s.rel[a.id][id].affinity) * 1.5 + (a.votePlan?.target === id ? 4 : 0) + Math.max(0, popularity(s, id)) * a.bias.scheme]));

  const state = {
    a: persona(s, a), b: persona(s, b),
    between_them: [feelings(s, a, b), feelings(s, b, a), allied ? "they are secret allies" : "not allies"],
    newcomer: playerHere ? (listening ? `${s.player.name} is standing close, clearly listening` : `${s.player.name} is nearby`) : "not around",
    a_came_to: plan ? planText(s, plan) : "nothing in particular",
  };
  const topics = { small_talk: "Small talk and shade about nothing", share_rumor: "Passes on a piece of gossip", argue: `Picks a fight with ${first(b)}`, complain: "Trash-talks someone who isn't there", make_up: `Tries to patch things up with ${first(b)}`, alliance: `Proposes a secret alliance with ${first(b)} for the votes`, vote_talk: `Talks about who should be voted out next` };
  const topicPrior = {
    small_talk: 1.2, share_rumor: shareable.length ? 0.6 + a.bias.gossip * 2.2 : 0, argue: rAB.affinity < -1 ? a.bias.temper * 2 : a.bias.temper * 0.15,
    complain: 0.3 + a.bias.gossip * 0.8, make_up: rAB.affinity < -1 ? a.bias.loyalty * 0.5 : 0.05,
    alliance: allied ? 0.05 : Math.max(0, rAB.affinity + 0.5) * a.bias.scheme * (daysToVote(s) <= 1 ? 1.5 : 0.7),
    vote_talk: (allied ? 1.5 : 0.4) * (0.4 + a.bias.scheme) * (daysToVote(s) === 0 ? 2.5 : daysToVote(s) === 1 ? 1.5 : 0.6),
  };
  if (plan) { topics.plan = `Does what ${first(a)} came to do: ${planText(s, plan)}`; topicPrior.plan = 10; }
  const qs = {
    topic: { type: "choice", instructions: `What does ${first(a)} bring up with ${first(b)}?`, criteria: topics, prior: topicPrior },
    rumor: { type: "choice", instructions: `If ${first(a)} passes on gossip, which piece?`, criteria: rumorCriteria, prior: rumorPrior },
    vote_target: { type: "choice", instructions: `If ${first(a)} talks about the vote, who does she want voted out?`, criteria: voteCriteria, prior: votePrior },
    agree: { type: "noul", instructions: `If ${first(a)} proposes an alliance or a vote, ${first(b)} says yes.`, prior: 0.3 + Math.max(0, rBA.affinity) * 0.15 + (allied ? 0.3 : 0) },
    sincere: { type: "noul", instructions: `If ${first(b)} says yes, she actually means it (rather than lying to ${first(a)}'s face).`, prior: Math.max(0.1, 1 - b.bias.deceit * 0.7 + Math.max(0, rBA.trust) * 0.1) },
    warmth: { type: "score", instructions: `After this talk, how do ${first(a)} and ${first(b)} feel about each other?`, criteria: WARMTH, prior: 2 },
    escalate: { type: "noul", instructions: `If they argue, it gets physical: a hair-pulling, shoving cat fight right there in public. Only when the grudge, the insult or the temper is real.`, prior: Math.min(0.8, 0.02 + (a.bias.temper + b.bias.temper) * 0.12 + Math.max(0, -rAB.affinity) * 0.05 + (a.mood.anger + b.mood.anger) * 0.05 + (plan?.kind === "confront" ? 0.1 : 0)) },
  };
  if (!(plan && plan.target === b.id)) qs.talk = { type: "noul", instructions: `${first(a)} and ${first(b)} stop to talk with each other.`, prior: 0.25 + a.bias.social * 0.35 + (allied ? 0.2 : 0) };
  if (listening) qs.notice = { type: "noul", instructions: `They notice ${s.player.name} eavesdropping on them.`, prior: 0.12 + a.bias.nosy * 0.15 };
  const j = await jev.ask(state, qs, `meet:${a.id}+${b.id}`);
  if (qs.talk && !j.talk.yes) return;

  let topic = j.topic.pick;
  let rumor = null;
  if (topic === "plan") {
    const k = plan.kind;
    topic = k === "confront" ? "argue" : k === "make_peace" ? "make_up" : k === "recruit" ? "alliance" : k === "lobby" ? "vote_talk" : planRumor ? "share_rumor" : "small_talk";
    rumor = planRumor || null;
    doneWithPlan(s, a);
  } else if (topic === "share_rumor") {
    rumor = j.rumor.pick !== "none" ? s.rumors[j.rumor.pick] : planRumor || null;
    if (!rumor) topic = "small_talk";
    else if (plan?.kind === "spread" && plan.rumor === rumor.id) doneWithPlan(s, a);
  }
  let outcome = WARMTH[Math.round(j.warmth.value)];
  const dw = (j.warmth.value - 2) * 0.35;
  rAB.affinity = clamp(rAB.affinity + dw); rBA.affinity = clamp(rBA.affinity + dw);

  const next = []; // plans that came out of this talk, so the written words can match them
  let voteTarget = null;
  if (rumor) {
    const aboutB = rumor.about === b.id;
    const aboutName = nameOf(s, rumor.about);
    if (aboutB) {
      // b hears what is being said about her. b knows the truth; a decides who to believe.
      const src = rumor.origin === "player" ? s.player.name : nameOf(s, rumor.origin);
      const r2 = await jev.ask({ listener: persona(s, b), teller: persona(s, a), between_them: [feelings(s, a, b), feelings(s, b, a)], what_is_said_about_b: rumor.text, it_started_with: rumor.origin === "truth" ? "nobody knows" : src }, {
        answer: { type: "choice", instructions: `${first(b)} hears this said about her. How does she answer? She knows whether it is true.`, criteria: { admit: "Admits it is true", deny: "Denies it, and it really is false", lie: "Denies it, but it is actually true", dodge: "Dodges the question" }, prior: rumor.isTrue ? { admit: 1 - b.bias.deceit, lie: b.bias.deceit * 2, dodge: 1 } : { deny: 4, dodge: 0.5 } },
        a_believes_after: { type: "noul", instructions: `After ${first(b)}'s answer, ${first(a)} still believes the story about her.`, prior: 0.45 },
        react: { type: "choice", instructions: `What does ${first(b)} decide to do about the story going round?`, criteria: { nothing: "Lets it go", confront_source: `Will go and confront whoever started it (${src})`, report: "Will take it to Hesper, the elder", vote_out: `Decides ${first(a)} has to be voted out` }, prior: { nothing: 1.5 - b.bias.temper, confront_source: b.bias.temper * 2, report: 0.3, vote_out: b.bias.scheme } },
      }, `rumor:${rumor.id}->${b.id}`);
      const ans = r2.answer.pick;
      b.mood.anger += ans === "admit" ? 0.5 : 1.5;
      rBA.affinity = clamp(rBA.affinity - 0.6);
      learn(s, a, rumor.id, r2.a_believes_after.yes ? 0.9 : 0.1, b.id);
      if (!r2.a_believes_after.yes) a.knows[rumor.id].conf = 0.1;
      outcome = `${first(b)} ${{ admit: "admits it", deny: "denies it", lie: "denies it", dodge: "dodges the question" }[ans]}, and ${first(a)} ${r2.a_believes_after.yes ? "is not convinced" : "believes her"}`;
      remember(a, s, `asked ${first(b)} about "${rumor.text}"; she ${ans === "admit" ? "admitted it" : ans === "dodge" ? "dodged" : "denied it"}`);
      remember(b, s, `${first(a)} brought up what people say about me: ${rumor.text}`);
      // finding out the newcomer made it up
      if (rumor.origin === "player" && !r2.a_believes_after.yes && (ans === "deny" || ans === "lie")) {
        for (const [v, t, f] of [[a, 1, 0.3], [b, 1.2, 1.2]]) { s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - t); s.rel[v.id].player.affinity = clamp(s.rel[v.id].player.affinity - f); }
        const lid = newRumor(s, { about: "player", text: `${s.player.name} has been spreading lies about ${b.name}.`, origin: a.id, isTrue: true, harm: -1.5 });
        learn(s, a, lid, 0.9, "self"); learn(s, b, lid, 1, "self");
        setPlan(s, a, { kind: "spread", rumor: lid, why: "the new girl is a liar" });
        remember(a, s, `found out ${s.player.name} lied to me about ${first(b)}`);
        next.push(`${first(a)} realizes the newcomer made the story up`);
      }
      const rk = r2.react.pick;
      if (rk === "confront_source") {
        const src2 = rumor.origin === "player" ? "player" : s.people[rumor.origin] && !s.people[rumor.origin].gone ? rumor.origin : null;
        if (src2) { setPlan(s, b, { kind: "confront", target: src2, rumor: rumor.id, why: `of what is being said about ${first(b)}` }); next.push(`${first(b)} means to confront ${nameOf(s, src2)} about it`); }
      } else if (rk === "report") { setPlan(s, b, { kind: "report", rumor: rumor.id, why: "it is a lie about her" }); next.push(`${first(b)} means to take it to Hesper`); }
      else if (rk === "vote_out") { b.votePlan = { target: a.id, why: `${first(a)} threw that story in her face` }; }
    } else {
      const r2 = await jev.ask({ listener: persona(s, b), teller: feelings(s, b, a), gossip: rumor.text, about: rumor.about ? feelings(s, b, rumor.about === "player" ? "player" : s.people[rumor.about] || "player") : "nobody in particular" }, {
        believe: { type: "noul", instructions: `${first(b)} believes this gossip.`, prior: 0.35 + rBA.trust * 0.1 + (b.id === "pippa" ? 0.3 : 0) },
        react: { type: "choice", instructions: `What does ${first(b)} decide to do about it?`, criteria: REACTIONS(aboutName), prior: { nothing: 2, spread: b.bias.gossip * 3, ask_subject: b.bias.nosy * 0.6, warn_subject: rumor.about && s.rel[b.id][rumor.about]?.affinity > 1 ? 1.5 : 0.1, confront: b.bias.temper * 0.6, report: b.id === "hesper" ? 0 : 0.2, vote_out: rumor.about ? b.bias.scheme * 0.8 : 0 } },
        embellish: { type: "noul", instructions: `${first(a)} exaggerates the story while telling it.`, prior: a.bias.deceit * 0.35 + a.bias.gossip * 0.15 },
      }, `rumor:${rumor.id}->${b.id}`);
      let rid = rumor.id;
      if (r2.embellish.yes) {
        // gossip mutates as it travels
        const text = await voice.retell({ teller: a, rumorText: rumor.text, playerName: s.player.name });
        if (text) rid = newRumor(s, { about: rumor.about, text, origin: rumor.origin, isTrue: rumor.isTrue, harm: clamp(rumor.harm * 1.3, -2.5, 2), parent: rumor.id, kind: rumor.kind });
        rumor = s.rumors[rid];
      }
      learn(s, b, rid, r2.believe.yes ? 0.5 + r2.believe.p * 0.5 : r2.believe.p * 0.3, a.id);
      const rk = r2.react.pick;
      const subj = rumor.about;
      const canReach = subj === "player" || (s.people[subj] && !s.people[subj].gone);
      if (rk === "spread") { setPlan(s, b, { kind: "spread", target: null, rumor: rid, why: `${first(a)} told her` }); next.push(`${first(b)} means to pass it on`); }
      else if (rk === "report") { setPlan(s, b, { kind: "report", rumor: rid, why: `${first(a)} told her` }); next.push(`${first(b)} means to take it to Hesper`); }
      else if (rk === "vote_out" && canReach && subj !== b.id) { b.votePlan = { target: subj, why: `of what ${first(a)} told her: ${rumor.text}` }; next.push(`${first(b)} decides ${aboutName} should be voted out`); }
      else if (["ask_subject", "warn_subject", "confront"].includes(rk) && canReach && subj !== b.id) {
        const kind = { ask_subject: "ask", warn_subject: "warn", confront: "confront" }[rk];
        setPlan(s, b, { kind, target: subj, rumor: rid, why: `${first(a)} told her` });
        next.push(`${first(b)} means to go and ${kind} ${aboutName}`);
      }
      outcome += r2.believe.yes ? `; ${first(b)} believes it` : `; ${first(b)} doubts it`;
    }
    remember(a, s, `told ${first(b)}: ${rumor.text}`);
    if (!aboutB) remember(b, s, `${first(a)} told me: ${rumor.text}`);
  } else if (topic === "alliance") {
    const yes = j.agree.yes, sincere = j.sincere.yes;
    if (yes) {
      const al = joinAlliance(s, a.id, b.id, sincere, place);
      outcome = `${first(b)} agrees to the alliance${sincere ? "" : " (but is secretly lying)"}`;
      remember(a, s, `made a secret pact with ${first(b)}`);
      remember(b, s, sincere ? `made a secret pact with ${first(a)}` : `pretended to join ${first(a)}'s pact`);
      if (!sincere && b.bias.gossip > 0.4) {
        const lid = newRumor(s, { about: a.id, text: `${a.name} is quietly building an alliance to control the votes.`, origin: b.id, isTrue: true, harm: -1, kind: "alliance" });
        learn(s, b, lid, 1, "self");
        setPlan(s, b, { kind: "spread", rumor: lid, why: `${first(a)} is getting too powerful` });
      }
      if (playerHere) s.player.knownAlliances = [...new Set([...(s.player.knownAlliances || []), al.id])];
    } else outcome = `${first(b)} turns the alliance down`;
  } else if (topic === "vote_talk") {
    voteTarget = j.vote_target.pick;
    const yes = j.agree.yes, sincere = j.sincere.yes;
    a.votePlan = { target: voteTarget, why: a.votePlan?.target === voteTarget ? a.votePlan.why : "she wants her gone" };
    if (yes && sincere) b.votePlan = { target: voteTarget, why: `agreed with ${first(a)}`, promisedTo: a.id };
    outcome = yes ? `${first(b)} agrees to vote out ${nameOf(s, voteTarget)}${sincere ? "" : " (but is lying)"}` : `${first(b)} won't commit`;
    remember(a, s, `told ${first(b)} I want ${nameOf(s, voteTarget)} gone`);
    remember(b, s, `${first(a)} wants ${nameOf(s, voteTarget)} voted out; I ${yes ? (sincere ? "agreed" : "pretended to agree") : "didn't commit"}`);
    // word of a vote plot is gossip too
    const vid = newRumor(s, { about: a.id, text: `${a.name} is trying to get ${nameOf(s, voteTarget)} voted out.`, origin: b.id, isTrue: true, harm: -0.7, kind: "vote" });
    learn(s, b, vid, 1, "self");
    if (!(yes && sincere) && voteTarget !== "player" && s.rel[b.id][voteTarget]?.affinity > 0.5) { setPlan(s, b, { kind: "warn", target: voteTarget, rumor: vid, why: `${first(a)} is coming for her` }); next.push(`${first(b)} means to warn ${nameOf(s, voteTarget)}`); }
  } else {
    remember(a, s, `${topic.replace("_", " ")} with ${first(b)} at ${placeName(place)}`);
    remember(b, s, `${topic.replace("_", " ")} with ${first(a)} at ${placeName(place)}`);
  }

  let fight = false;
  if (topic === "argue" || (rumor && rumor.about === b.id)) {
    a.mood.anger += 1; b.mood.anger += 1;
    ui.emote?.(a.id, "anger"); ui.emote?.(b.id, "anger");
    if (j.escalate.yes) fight = true;
  } else if (topic === "alliance" || topic === "vote_talk") { ui.emote?.(a.id, "whisper"); }
  else if (rumor) { ui.emote?.(b.id, "gasp"); }

  if (playerHere) {
    const topicText = {
      small_talk: "small talk, with a little shade",
      share_rumor: rumor?.about === b.id ? `${first(a)} asks ${first(b)} about what people are saying about her` : "juicy gossip",
      argue: `an argument; ${first(a)} is picking a fight${plan?.kind === "confront" ? ` about: ${planRumor?.text || "an old grievance"}` : ""}`,
      complain: `${first(a)} trash-talks someone who isn't there`,
      make_up: "trying to patch things up after bad feelings",
      alliance: `${first(a)} secretly proposes they team up for the votes`,
      vote_talk: `${first(a)} talks about who to vote out next`,
    }[topic];
    s.player.seen[`${a.id}|${b.id}`] = { outcome, day: s.day };
    if (topic === "alliance" && listening) s.player.overheardAlliance = true;
    const noticed = j.notice?.yes;
    voice.exchange({ a, b, playerName: s.player.name, topic: topicText, rumorText: rumor?.text, aboutName: topic === "vote_talk" ? nameOf(s, voteTarget) : rumor ? nameOf(s, rumor.about) : null, outcome: fight ? "it turns into a hair-pulling cat fight" : outcome, next })
      .then((lines) => {
        ui.exchange?.({ a: a.id, b: b.id, lines: listening ? lines : muffle(lines), full: listening });
        if (rumor) playerHears(s, rumor.id, a.id, listening ? "overheard" : "overheard part", ui);
        if (topic === "vote_talk" && listening && voteTarget) {
          const vr = Object.values(s.rumors).filter((r) => r.kind === "vote" && r.about === a.id).at(-1);
          if (vr) playerHears(s, vr.id, a.id, "overheard", ui);
        }
        if (topic === "alliance" && listening) ui.first?.("alliance-overheard", {});
      });
    if (noticed) {
      ui.emote?.(a.id, "suspicious"); ui.emote?.(b.id, "suspicious");
      headline(s, `${first(a)} and ${first(b)} caught you eavesdropping.`, "bad", ui);
      for (const v of [a, b]) { s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - 0.5); remember(v, s, `caught ${s.player.name} eavesdropping`); }
      const rid = newRumor(s, { about: "player", text: `${s.player.name} was caught eavesdropping on ${first(a)} and ${first(b)}.`, origin: a.id, isTrue: true, harm: -1 });
      learn(s, a, rid, 1, "self"); learn(s, b, rid, 1, "self");
      ui.first?.("caught", {});
    }
  }

  if (fight) await brawl(s, a, b, place, ui, playerHere);
}

// A cat fight between two cast members. Jev decides who comes out on top and which
// side everyone who saw it takes; the fight then travels as gossip and counts at the vote.
export async function brawl(s, a, b, place, ui, seen) {
  const watchers = at(s, place).filter((v) => v.id !== a.id && v.id !== b.id);
  const qs = {
    winner: { type: "choice", instructions: `${first(a)} started a cat fight with ${first(b)}. Who comes out of it looking better?`, criteria: { a: `${first(a)}, the one who started it`, b: first(b) }, prior: { a: 0.5 + a.bias.nerve + a.bias.temper * 0.5, b: 0.5 + b.bias.nerve + b.bias.temper * 0.5 } },
  };
  for (const w of watchers) qs[`side_${w.id}`] = sideQuestion(s, w, a, b.id);
  const j = await jev.ask({ fighters: [persona(s, a), persona(s, b)], between_them: [feelings(s, a, b), feelings(s, b, a)], where: placeName(place), watching: watchers.map((w) => persona(s, w)) }, qs, `fight:${a.id}+${b.id}`);
  const win = j.winner.pick === "a" ? a : b, lose = win === a ? b : a;
  s.rel[a.id][b.id].affinity = clamp(s.rel[a.id][b.id].affinity - 1.5);
  s.rel[b.id][a.id].affinity = clamp(s.rel[b.id][a.id].affinity - 1.5);
  s.rel[a.id][b.id].note = s.rel[b.id][a.id].note = `had a cat fight on day ${s.day}`;
  a.mood.anger = Math.min(3, a.mood.anger + 1); b.mood.anger = Math.min(3, b.mood.anger + 1);
  lose.mood.cheer = Math.max(0, lose.mood.cheer - 1);
  a.fights = (a.fights || 0) + 1;
  takeSides(s, watchers, j, a.id, b.id);
  ui.fight?.(a.id, b.id, { winner: win.id });
  const text = `${first(a)} and ${first(b)} got into a hair-pulling cat fight at ${placeName(place)}, and ${first(win)} came out on top!`;
  headline(s, text, "drama", ui, { place, witnessed: seen });
  const rid = newRumor(s, { about: a.id, text: `${a.name} started a cat fight with ${b.name} at ${placeName(place)} on day ${s.day}, and ${first(win)} came out on top.`, origin: "truth", isTrue: true, harm: -1, kind: "fight" });
  for (const w of [a, b, ...watchers]) learn(s, w, rid, 1, "self");
  if (seen) playerHears(s, rid, "self", "saw", ui);
  remember(a, s, `started a cat fight with ${first(b)} and ${win === a ? "won it" : "lost it"}`);
  remember(b, s, `${first(a)} attacked me and I ${win === b ? "won" : "lost"}`);
}

function sideQuestion(s, w, aggressor, otherId) {
  const other = otherId === "player" ? "player" : s.people[otherId];
  const ra = s.rel[w.id][aggressor === "player" ? "player" : aggressor.id], ro = s.rel[w.id][otherId];
  return {
    type: "choice", instructions: `${first(w)} saw the fight. Whose side does she take?`,
    criteria: { aggressor: `${aggressor === "player" ? s.player.name : first(aggressor)}, who started it`, other: firstOf(s, otherId), neither: "Neither: she thinks they are both embarrassing" },
    prior: { aggressor: Math.max(0.05, 0.3 + ra.affinity * 0.4), other: Math.max(0.05, 0.8 + ro.affinity * 0.4), neither: 1 + (w.bias.loyalty < 0.4 ? 0.5 : 0) },
  };
}

function takeSides(s, watchers, j, aggId, otherId) {
  const sides = {};
  for (const w of watchers) {
    const side = j[`side_${w.id}`]?.pick || "neither";
    sides[w.id] = side;
    const relTo = (id) => s.rel[w.id][id];
    if (side === "aggressor") { relTo(aggId).affinity = clamp(relTo(aggId).affinity + 0.4); relTo(otherId).affinity = clamp(relTo(otherId).affinity - 0.6); }
    else if (side === "other") { relTo(otherId).affinity = clamp(relTo(otherId).affinity + 0.4); relTo(aggId).affinity = clamp(relTo(aggId).affinity - 0.6); relTo(aggId).trust = clamp(relTo(aggId).trust - 0.3); }
    else { relTo(aggId).affinity = clamp(relTo(aggId).affinity - 0.3); relTo(otherId).affinity = clamp(relTo(otherId).affinity - 0.15); }
    remember(w, s, `watched ${firstOf(s, aggId)} fight ${firstOf(s, otherId)} and sided with ${side === "aggressor" ? firstOf(s, aggId) : side === "other" ? firstOf(s, otherId) : "neither of them"}`);
  }
  return sides;
}

function muffle(lines) {
  return lines.map((l, i) => ({ ...l, text: i % 2 && Math.random() < 0.4 ? "…" : l.text.split(/\s+/).map((w) => (Math.random() < 0.55 ? w : "…")).join(" ").replace(/(… )+…/g, "…") }));
}

// ---------- cast members walking up to the player ----------

const PURPOSES = (s, v) => ({
  none: "Leaves the newcomer alone for now",
  spill: `Walks up to ${s.player.name} to spill some gossip`,
  recruit: `Walks up to ${s.player.name} to propose teaming up for the vote`,
  lobby: `Walks up to ${s.player.name} to push her to vote someone out`,
  fish: `Walks up to ${s.player.name} to pump her for information`,
  outfit: `Walks up to ${s.player.name} to tell her what she thinks of her outfit`,
});

// how keen she is to say something about the newcomer's outfit (stand-in prior)
function lookTalk(s, v) {
  const lk = s.looks?.[v.id];
  if (!lk || lk.said || !s.player.outfit || lk.key !== outfitKey(s.player.outfit)) return 0;
  const strong = Math.abs(lk.verdict - 2) >= 1 || ["envious", "copycat", "suspicious"].includes(lk.reaction);
  return strong ? 0.6 + (FASHION[v.id]?.vain || 0.3) * 2.5 : 0;
}

async function approaches(s, ui) {
  if (s.player.talkingTo || s.player.out || (s.cooldown || 0) > s.minute + s.day * 1440) return;
  // someone with business with the player comes first
  const near = alive(s).filter((v) => !v.approaching && ui.distance && ui.distance(v) < 22);
  let chosen = near.find((v) => v.intent?.target === "player");
  let purpose = null, detail = null, rid = null, voteTarget = null, attack = false;
  if (chosen) {
    const it = chosen.intent;
    purpose = it.kind === "confront" ? "confront her" : it.kind === "warn" ? "warn her" : it.kind === "ask" ? "ask her whether something is true" : it.kind === "recruit" ? "propose teaming up" : "talk";
    detail = it.rumor && s.rumors[it.rumor] ? s.rumors[it.rumor].text : null;
    if (it.kind === "confront" && chosen.mood.anger >= 1) {
      const r0 = s.rel[chosen.id].player;
      const a = await jev.ask({ ...persona(s, chosen), on_newcomer: feelings(s, chosen, "player"), grievance: detail || it.why || "something the newcomer did" }, {
        attack: { type: "noul", instructions: `${first(chosen)} is so furious that she storms up to ${s.player.name} and shoves her before saying a word, starting a cat fight in public.`, prior: Math.min(0.5, chosen.bias.temper * (0.05 + chosen.mood.anger * 0.07 + Math.max(0, -r0.affinity) * 0.04)) },
      }, `attack:${chosen.id}`);
      if (a.attack.yes) attack = true;
    }
    doneWithPlan(s, chosen);
  } else {
    const pool = shuffle(near).slice(0, 3);
    if (!pool.length) return;
    const res = await Promise.all(pool.map(async (v) => {
      const r = s.rel[v.id].player;
      const juicy = Object.entries(v.knows).filter(([id, k]) => k.conf >= 0.5 && s.rumors[id].about !== v.id && s.rumors[id].about !== "player");
      const j = await jev.ask({ ...persona(s, v), on_newcomer: feelings(s, v, "player"), newcomer_distance: `${Math.round(ui.distance(v))} steps away` }, {
        purpose: { type: "choice", instructions: `${first(v)} is near ${s.player.name}, the newcomer. Does she walk up to her, and why? Only approach with a real reason.`, criteria: PURPOSES(s, v),
          prior: { none: 14, spill: juicy.length ? v.bias.gossip * (1 + Math.max(0, r.affinity)) : 0, recruit: v.bias.scheme * Math.max(0.1, r.affinity + 1) * (alliancesOf(s, v.id).some((a) => a.members.includes("player")) ? 0.1 : 0.6), lobby: v.votePlan ? v.bias.scheme * 1.2 * (daysToVote(s) <= 1 ? 2 : 0.6) : 0, fish: v.bias.nosy * 0.8, outfit: lookTalk(s, v) } },
      }, `approach:${v.id}`);
      return [v, j.purpose.pick, juicy];
    }));
    const hit = res.find(([, p]) => p !== "none");
    if (!hit) return;
    let juicy;
    [chosen, purpose, juicy] = hit;
    if (purpose === "spill" && juicy.length) {
      rid = juicy[Math.floor(Math.random() * juicy.length)][0];
      detail = s.rumors[rid].text;
      purpose = "spill some juicy gossip";
    } else if (purpose === "recruit") purpose = "propose teaming up for the vote, a secret alliance";
    else if (purpose === "lobby" && chosen.votePlan) { voteTarget = chosen.votePlan.target; purpose = `get her to vote out ${nameOf(s, voteTarget)}`; detail = chosen.votePlan.why; }
    else if (purpose === "fish") purpose = "fish for gossip and find out who she is voting for";
    else if (purpose === "outfit" && s.looks?.[chosen.id]) {
      const lk = s.looks[chosen.id];
      lk.said = true;
      purpose = lk.verdict >= 2.6 ? (lk.reaction === "envious" ? `pay her a sweet compliment on her ${lk.item} that is secretly a dig` : `gush over her ${lk.item}`) : lk.reaction === "copycat" ? "call her out for copying your look" : lk.reaction === "suspicious" ? `ask, a little too sweetly, how she afforded her ${lk.item}` : `make a snide remark about her ${lk.item}`;
      detail = `you think her look is ${opinionText(s, chosen.id).replace(/^thinks her look is /, "")}`;
    }
    else return;
  }
  s.cooldown = s.minute + s.day * 1440 + 90; // at most one walk-up every hour and a half
  chosen.approaching = true;
  const r = s.rel[chosen.id].player;
  const line = await voice.opener({ v: chosen, playerName: s.player.name, purpose, detail, opinion: `${feel(r.affinity)}, ${trust(r.trust)}${s.looks?.[v.id] ? `; ${opinionText(s, v.id)}` : ""}` });
  chosen.approaching = false;
  if (s.player.talkingTo || s.paused || s.phase !== "day" || s.over) return;
  const conv = (s.player.convo = { with: chosen.id, lines: [`${first(chosen)}: ${line}`], opener: { purpose, rid, voteTarget } });
  if (rid) playerHears(s, rid, chosen.id, "told", ui);
  remember(chosen, s, `walked up to ${s.player.name} to ${purpose} and said: ${line}`);
  ui.approach?.(chosen, line, purpose, conv, { attack });
}

// ---------- the player talks ----------

const INTENTS = (s) => ({
  small_talk: "Small talk, greetings, pleasantries",
  question: "Asks a question, or asks about someone or what's going on",
  tell_news: "Claims something about another person (news, gossip, accusation)",
  compliment: "Compliments or flatters the listener",
  insult: "Insults or mocks the listener",
  propose_alliance: "Proposes teaming up or a secret alliance",
  vote_pitch: "Asks the listener to vote someone out",
  ask_vote: "Asks who the listener is voting for",
  threat: "Threatens the listener",
  apology: "Apologizes",
  about_self: `Talks about herself (${s.player.name})`,
  get_physical: "Physically attacks the listener: slaps, shoves or pulls her hair",
  ...(s.player.carrying ? { give_gift: `Gives her the ${ITEMS[s.player.carrying].name} she is carrying` } : {}),
});
const ACTS = {
  nothing: "Nothing for now",
  ask_subject: "Go and ask the person it is about whether it is true",
  warn_subject: "Go and warn the person it is about",
  confront_subject: "Go and confront the person it is about",
  tell_others: "Pass it on to others",
  report_to_elder: "Take it to Hesper, the elder",
  end_conversation: "End this conversation",
};
const SHIFT = ["much worse", "worse", "about the same", "better", "much better"];

export async function playerSays(s, v, line, ui, onText) {
  const conv = s.player.convo?.with === v.id ? s.player.convo : (s.player.convo = { with: v.id, lines: [] });
  const subjects = { none: "Nobody in particular", self: `${first(v)} herself`, player: `${s.player.name} herself` };
  for (const o of alive(s)) if (o.id !== v.id) subjects[o.id] = o.name;
  const r = s.rel[v.id].player;
  const aboutPlayer = Object.entries(v.knows).filter(([id, k]) => s.rumors[id].about === "player" && k.conf >= 0.3).map(([id]) => s.rumors[id].text);
  const low = line.toLowerCase();
  const mentioned = alive(s).filter((o) => o.id !== v.id && low.includes(first(o).toLowerCase()));
  const juicy = Object.entries(v.knows).filter(([id, k]) => k.conf >= 0.45 && s.rumors[id].about !== "player").map(([id]) => s.rumors[id]).filter((x) => x.about !== v.id || v.bias.deceit < 0.2).slice(-6);
  const shareCriteria = { none: "Shares no gossip" }, sharePrior = { none: 3 };
  for (const x of juicy) { shareCriteria[x.id] = `Tells her: ${x.text}`; sharePrior[x.id] = v.bias.gossip * (0.6 + Math.max(0, r.trust + 0.5)) * (mentioned.some((o) => o.id === x.about) ? 4 : 1); }
  const myAlliance = alliancesOf(s, v.id).find((a) => a.members.includes("player"));
  const state = {
    listener: persona(s, v),
    newcomer_look: s.player.outfit ? lookText(s) : undefined,
    listener_on_newcomer: `${feel(r.affinity)} ${s.player.name} and ${trust(r.trust)} her${s.looks?.[v.id] ? `; ${opinionText(s, v.id)}` : ""}. Heard about her: ${aboutPlayer.join(" | ") || "nothing"}${myAlliance ? `. They have a secret pact${myAlliance.sincere[v.id] ? "" : " (she is only pretending)"}` : ""}`,
    listener_feelings: alive(s).filter((o) => o.id !== v.id).map((o) => feelings(s, v, o)),
    conversation: conv.lines.slice(-6),
    newcomer_says: line,
  };
  // handing over a gift or going for her are things the player does, not things to guess
  const physical = /\b(slap|smack|punch|hit|shove|push|kick|scratch|claw|tackle|deck|slug)\w*\s+(you|ya|u|your)\b|\bfight me\b|\bpull your hair\b|\*(slaps|shoves|punches|pushes|hits)\b/i.test(line);
  const item = s.player.carrying ? ITEMS[s.player.carrying] : null;
  const gifty = !!item && /\b(here|for you|gift|present|brought|got you|have (a|this|some)|take (it|this)|treat)\b/i.test(line + " ") || (item && line.toLowerCase().includes(item.name.split(" ").at(-1)));
  const taste = TASTES[v.id] || {};
  const claimy = /\b(saw|seen|heard|told|said|says|stole|steal|stealing|cheat\w*|crooked|lie[sd]?|lying|liar|owes?|secret|hates?|plans?|plotting|fake|backstab\w*|wants? you (out|gone))\b/i.test(line);
  const j = await jev.ask(state, {
    intent: { type: "choice", instructions: `What is ${s.player.name} doing with this line?`, criteria: INTENTS(s), prior: { small_talk: 2, question: /\?|who|what|why|how/i.test(line) ? 3 : 0.8, tell_news: claimy ? (mentioned.length ? 12 : 4) : 0.3, compliment: /love|pretty|great|amazing|beautiful|nice/i.test(line) ? 3 : 0.4, insult: /ugly|stupid|idiot|hate you|fake|loser/i.test(line) ? 3 : 0.2, propose_alliance: /team|ally|alliance|together|stick together|partner|pact/i.test(line) ? 12 : 0.1, vote_pitch: /vote|send .* home|get rid|kick .* out/i.test(line) && mentioned.length ? 12 : 0.1, ask_vote: /who .* vot|voting for/i.test(line) ? 12 : 0.1, threat: 0.1, apology: /sorry|apolog/i.test(line) ? 5 : 0.1, about_self: 0.4, get_physical: physical ? 12 : 0.02, ...(s.player.carrying ? { give_gift: gifty ? 12 : 0.2 } : {}) } },
    subject: { type: "choice", instructions: "Who is the line mainly about? For a vote pitch, who she wants voted out.", criteria: subjects, prior: Object.fromEntries(Object.keys(subjects).map((k) => [k, mentioned.some((o) => o.id === k) ? 8 : k === "none" ? 1 : 0.2])) },
    harm: { type: "score", instructions: "If this is a claim about someone, how does it make them look?", criteria: ["Very damaging", "Somewhat damaging", "Neutral", "Somewhat flattering", "Very flattering"], prior: claimy ? 0.8 : 2 },
    believe: { type: "noul", instructions: `${first(v)} believes what ${s.player.name} is claiming.`, prior: Math.max(0.05, 0.35 + r.trust * 0.12 + (v.id === "pippa" ? 0.25 : 0) - v.bias.scheme * 0.1) },
    caught_lie: { type: "noul", instructions: `${first(v)} knows, or is nearly sure from what she already knows, that ${s.player.name} is lying.`, prior: 0.08 },
    agree: { type: "noul", instructions: `If ${s.player.name} proposes an alliance or asks her to vote someone out, ${first(v)} agrees.`, prior: 0.25 + r.affinity * 0.15 + r.trust * 0.08 },
    sincere: { type: "noul", instructions: `If ${first(v)} agrees, she actually means it rather than lying to ${s.player.name}'s face.`, prior: Math.max(0.1, 0.95 - v.bias.deceit * 0.75 + r.trust * 0.08) },
    honest_vote: { type: "noul", instructions: `If asked who she is voting for, ${first(v)} tells the truth.`, prior: Math.max(0.1, 1 - v.bias.deceit * 0.8) },
    share: { type: "choice", instructions: `Does ${first(v)} let slip a piece of gossip to ${s.player.name}? Which one?`, criteria: shareCriteria, prior: sharePrior },
    feel: { type: "score", instructions: `After this line, how does ${first(v)} feel about ${s.player.name}?`, criteria: SHIFT, prior: 2 },
    stance: { type: "choice", instructions: `How does ${first(v)} respond?`, criteria: { warm: "Warmly", sweet_fake: "Sweet on the surface, shady underneath", guarded: "Guarded, careful", curious: "Curious, wants more", dismissive: "Dismissive", hostile: "Hostile" }, prior: { warm: 0.5 + r.affinity * 0.3, sweet_fake: v.bias.deceit * 1.5, guarded: 1.2 - r.trust * 0.3, curious: v.bias.nosy * 1.5, dismissive: 0.4, hostile: 0.1 + Math.max(0, -r.affinity) * 0.4 } },
    act: { type: "choice", instructions: `What does ${first(v)} decide to do after this? Only pick a step about another person if the line was about them.`, criteria: ACTS, prior: { nothing: 4, ask_subject: 0.5, warn_subject: 0.3, confront_subject: v.bias.temper * 0.5, tell_others: v.bias.gossip * 1.5, report_to_elder: 0.15, end_conversation: 0.25 + Math.max(0, -r.affinity) * 0.3 } },
    now: { type: "noul", instructions: `${first(v)} goes to do it right away, ending this conversation, rather than later.`, prior: 0.3 },
    lunge: { type: "noul", instructions: `${first(v)} loses it and gets physical with ${s.player.name} right now: shoves her and a cat fight breaks out in public. Only if this line truly pushed her over the edge.`, prior: Math.min(0.6, 0.004 + v.bias.temper * (0.02 + Math.max(0, -r.affinity) * 0.03 + v.mood.anger * 0.04) + (physical ? 0.5 : 0) + (/\b(ugly|stupid|idiot|hate you|loser|witch|pathetic)\b/i.test(line) ? v.bias.temper * 0.12 : 0)) },
    ...(item ? { gift: { type: "choice", instructions: `If ${s.player.name} gives her ${item.name}, how does ${first(v)} take it?`, criteria: { delighted: "Delighted, it's exactly her thing", pleased: "Pleased and polite", suspicious: "Suspicious: what does the new girl want for it?", insulted: "Insulted by it" }, prior: { delighted: taste.loves === s.player.carrying ? 5 : 0.6 + r.affinity * 0.2, pleased: 1.5, suspicious: 0.3 + v.bias.scheme * 1.2 + Math.max(0, -r.trust) * 0.3, insulted: taste.hates === s.player.carrying ? 4 : 0.1 } } } : {}),
  }, `talk:${v.id}`);

  const intent = gifty ? "give_gift" : physical ? "get_physical" : j.intent.pick, subject = j.subject.pick;
  r.affinity = clamp(r.affinity + (j.feel.value - 2) * 0.4);
  const react = [];
  let believes = null, rid = null;
  const person = (id) => !["none", "self", "player"].includes(id) && s.people[id] && !s.people[id].gone;
  const isClaim = intent === "tell_news" && person(subject);
  if (isClaim) {
    rid = newRumor(s, { about: subject, text: line, origin: "player", isTrue: null, harm: j.harm.value - 2 });
    const r0 = s.rumors[rid];
    voice.asStory({ line, aboutName: s.people[subject].name, history: conv.lines, playerName: s.player.name }).then((text) => { if (text) r0.text = text; });
    believes = j.believe.yes && !j.caught_lie.yes;
    learn(s, v, rid, believes ? 0.45 + j.believe.p * 0.5 : j.believe.p * 0.25, "player");
    r.trust = clamp(r.trust + (believes ? 0.15 : -0.1));
    s.player.told.push({ rid, to: v.id, day: s.day, time: clock(s.minute), believed: believes });
    ui.first?.("told", { rid });
    react.push(believes ? `You believe what ${s.player.name} just told you.` : `You do not believe what ${s.player.name} just told you.`);
  }
  const caught = j.caught_lie.yes && (isClaim || intent === "about_self");
  if (caught) {
    r.trust = clamp(r.trust - 1.2); r.affinity = clamp(r.affinity - 0.6);
    const lid = newRumor(s, { about: "player", text: `${s.player.name} lied to ${first(v)}'s face.`, origin: v.id, isTrue: true, harm: -1.5 });
    learn(s, v, lid, 1, "self");
    remember(v, s, `caught ${s.player.name} in a lie`);
    react.length = 0;
    react.push(`You are sure ${s.player.name} just lied to you, and you let it show.`);
  }
  if (intent === "insult" || intent === "threat") { v.mood.anger += 1; r.affinity = clamp(r.affinity - 0.5); }
  if (intent === "threat") v.mood.fear += 1;
  // a gift
  if (intent === "give_gift" && item) {
    const how = j.gift.pick;
    const d = { delighted: [0.9, 0.3], pleased: [0.4, 0.1], suspicious: [0.1, -0.3], insulted: [-0.6, -0.2] }[how];
    r.affinity = clamp(r.affinity + d[0]); r.trust = clamp(r.trust + d[1]);
    react.push({ delighted: `${s.player.name} hands you ${item.name}, and you absolutely love it.`, pleased: `${s.player.name} hands you ${item.name}. It's sweet of her.`, suspicious: `${s.player.name} hands you ${item.name}. You wonder what she wants for it.`, insulted: `${s.player.name} hands you ${item.name}, and you find it insulting.` }[how]);
    remember(v, s, `${s.player.name} gave me ${item.name}; I was ${how}`);
    if (how === "suspicious" && v.bias.gossip > 0.4) {
      const gid = newRumor(s, { about: "player", text: `${s.player.name} is going around handing out presents to buy votes.`, origin: v.id, isTrue: true, harm: -0.5, kind: "vote" });
      learn(s, v, gid, 1, "self");
    }
    s.player.gifts = (s.player.gifts || 0) + 1;
    s.player.carrying = null;
    ui.gift?.(v.id, how);
  }
  // it gets physical
  let fightBy = null;
  if (intent === "get_physical") fightBy = "player";
  else if (j.lunge.yes && (r.affinity < 0 || v.mood.anger >= 1 || caught || ["insult", "threat", "vote_pitch"].includes(intent))) fightBy = v.id;
  if (fightBy === v.id) react.push(`You are so furious that you shove ${s.player.name}. A cat fight is about to start.`);
  if (fightBy === "player") react.push(`${s.player.name} just went for you physically. You are shocked and furious.`);
  if (intent === "compliment" && v.bias.scheme > 0.7) react.push("You can tell flattery when you hear it.");

  // alliances and votes
  let promise = null;
  if (intent === "propose_alliance") {
    if (j.agree.yes) {
      joinAlliance(s, "player", v.id, j.sincere.yes, v.location);
      promise = { by: v.id, kind: "alliance", target: null, day: s.day, sincere: j.sincere.yes };
      react.push(`You agree to a secret alliance with ${s.player.name}${j.sincere.yes ? " and you mean it" : ", but you are lying and have no intention of keeping it"}.`);
      remember(v, s, j.sincere.yes ? `agreed to a secret pact with ${s.player.name}` : `pretended to agree to a pact with ${s.player.name}`);
      if (!j.sincere.yes) {
        const lid = newRumor(s, { about: "player", text: `${s.player.name} is going around begging people to team up with her.`, origin: v.id, isTrue: true, harm: -0.6, kind: "alliance" });
        learn(s, v, lid, 1, "self");
        if (v.bias.gossip > 0.5) setPlan(s, v, { kind: "spread", rumor: lid, why: "the new girl is playing the game" });
      }
    } else react.push(`You turn down ${s.player.name}'s offer to team up.`);
    ui.first?.("alliance", {});
  } else if (intent === "vote_pitch" && (person(subject) || subject === "self")) {
    const target = subject === "self" ? v.id : subject;
    if (target === v.id) { react.push(`${s.player.name} just suggested voting YOU out. You are offended.`); r.affinity = clamp(r.affinity - 1); v.mood.anger += 1; }
    else if (j.agree.yes) {
      promise = { by: v.id, kind: "vote", target, day: s.day, sincere: j.sincere.yes };
      if (j.sincere.yes) v.votePlan = { target, why: `agreed with ${s.player.name}`, promisedTo: "player" };
      react.push(`You agree to vote out ${s.people[target].name}${j.sincere.yes ? " and you mean it" : ", but you are lying"}.`);
      remember(v, s, `${s.player.name} asked me to vote out ${first(s.people[target])}; I ${j.sincere.yes ? "agreed" : "pretended to agree"}`);
    } else react.push(`You won't promise to vote out ${s.people[target].name}.`);
    // a vote pitch is news worth passing on
    const vid = newRumor(s, { about: "player", text: `${s.player.name} is campaigning to get ${s.people[target]?.name || "someone"} voted out.`, origin: v.id, isTrue: true, harm: -0.5, kind: "vote" });
    learn(s, v, vid, 1, "self");
    if (!(j.agree.yes && j.sincere.yes) && target !== v.id && s.rel[v.id][target]?.affinity > 0.5) setPlan(s, v, { kind: "warn", target, rumor: vid, why: `the new girl is coming for her` });
    ui.first?.("vote-pitch", {});
  } else if (intent === "ask_vote") {
    const real = v.votePlan?.target;
    const honest = j.honest_vote.yes || !real;
    const said = honest ? real : candidatesFor(s, v).filter((id) => id !== real && id !== "player")[0];
    react.push(said ? `You tell ${s.player.name} you are voting for ${nameOf(s, said)}${honest ? "" : ", which is a lie"}.` : `You say you haven't decided who to vote for.`);
    if (said) s.player.promises.push({ by: v.id, kind: "told-vote", target: said, day: s.day, sincere: honest });
  }
  if (promise) s.player.promises.push(promise);

  // gossip she lets slip
  let shared = null;
  if (["question", "small_talk", "compliment", "ask_vote"].includes(intent) && j.share.pick !== "none") {
    shared = s.rumors[j.share.pick];
    react.push(`You let slip this gossip: "${shared.text}"`);
    playerHears(s, shared.id, v.id, "told", ui);
    remember(v, s, `told ${s.player.name}: ${shared.text}`);
  }

  // what she decided to do becomes a plan she carries out
  let act = j.act.pick;
  const kind = { ask_subject: "ask", warn_subject: "warn", confront_subject: "confront", tell_others: "spread", report_to_elder: "report" }[act];
  const story = kind ? rid || newRumor(s, { about: person(subject) ? subject : subject === "player" ? "player" : null, text: line, origin: "player", isTrue: null, harm: 0 }) : null;
  if (kind && kind !== "spread" && kind !== "report" && !person(subject)) act = "nothing";
  else if (kind === "report" && v.id === "hesper") act = "nothing";
  else if (kind) setPlan(s, v, { kind, target: kind === "spread" || kind === "report" ? null : subject, rumor: story, why: `of what ${s.player.name} said`, promisedTo: "player", now: j.now.yes });
  const leaving = act === "end_conversation" || (!!kind && act !== "nothing" && j.now.yes);
  remember(v, s, `${s.player.name} said: ${line}`);

  const stanceText = { warm: "warmly", sweet_fake: "sweet on the surface but shady underneath", guarded: "guarded and careful", curious: "curious, wanting more", dismissive: "dismissive", hostile: "hostile" }[j.stance.pick];
  const replyText = await voice.reply({
    v, playerName: s.player.name, history: conv.lines, line, stance: stanceText, react,
    plan: act === "end_conversation" ? "end this conversation now" : kind && act !== "nothing" ? planText(s, v.intent) + (leaving ? ", and you leave right now to do it" : ", later") : null,
    otherPlan: !kind && v.intent ? planText(s, v.intent) : null,
    opinion: `${feel(r.affinity)}, ${trust(r.trust)}${s.looks?.[v.id] ? `; ${opinionText(s, v.id)}` : ""}`, mood: moodText(v.mood),
  }, onText);
  conv.lines.push(`${s.player.name}: ${line}`, `${first(v)}: ${replyText}`);
  remember(v, s, `I said to ${s.player.name}: ${replyText}`);
  ui.emote?.(v.id, caught ? "suspicious" : j.stance.pick === "hostile" ? "anger" : promise?.kind === "alliance" ? "handshake" : shared ? "whisper" : believes ? "gasp" : null);
  return { reply: replyText, leaving: leaving && !fightBy, fight: fightBy ? { by: fightBy } : null, debug: { intent, subject: nameOf(s, subject), believes, caught, stance: j.stance.pick, act, now: j.now.yes } };
}

// ---------- cat fights with the player ----------
// The page plays the fight (mash Enter to hold your own, walk off to back down) and
// reports how it went. What it means for the town is decided here and by Jev.
export async function playerFight(s, v, { by, result }, ui) {
  const place = s.player.location;
  const watchers = alive(s).filter((w) => w.id !== v.id && ui.distance && ui.distance(w) < 13);
  const aggressor = by === "player" ? "player" : v;
  const qs = {};
  for (const w of watchers) qs[`side_${w.id}`] = sideQuestion(s, w, aggressor, by === "player" ? v.id : "player");
  const j = watchers.length ? await jev.ask({ fight: `${by === "player" ? s.player.name : first(v)} started a cat fight; ${result === "won" ? `${s.player.name} held her own` : result === "lost" ? `${first(v)} got the better of ${s.player.name}` : `${s.player.name} backed down and walked away`}`, fighters: [persona(s, v), `${s.player.name}, the newcomer`], watching: watchers.map((w) => persona(s, w)) }, qs, `fight:player+${v.id}`) : {};
  const r = s.rel[v.id].player;
  r.affinity = clamp(r.affinity - (result === "backed_down" ? 0.6 : 1.3));
  r.note = `had a cat fight with ${s.player.name} on day ${s.day}`;
  v.mood.anger = Math.min(3, v.mood.anger + 1);
  if (result === "won") { v.mood.fear = Math.min(3, v.mood.fear + 1); v.mood.cheer = Math.max(0, v.mood.cheer - 1); r.trust = clamp(r.trust - 0.3); }
  if (result === "lost" || result === "backed_down") v.mood.cheer = Math.min(3, v.mood.cheer + 1);
  if (by === "player") s.player.fights = (s.player.fights || 0) + 1; else v.fights = (v.fights || 0) + 1;
  const sides = takeSides(s, watchers, j, by === "player" ? "player" : v.id, by === "player" ? v.id : "player");
  // everyone who saw it now thinks a little differently about a newcomer who brawls (or runs)
  for (const w of watchers) if (result === "backed_down") s.rel[w.id].player.trust = clamp(s.rel[w.id].player.trust - 0.1);
  const pn = s.player.name, vn = first(v);
  const how = result === "won" ? `${pn} held her own` : result === "lost" ? `${vn} wiped the floor with ${pn}` : `${pn} backed down and walked off`;
  const starter = by === "player" ? `${pn} went for ${vn}` : `${vn} went for ${pn}`;
  const text = `${starter} in a cat fight at ${placeName(place)}, and ${how}.`;
  const rid = newRumor(s, { about: by === "player" ? "player" : v.id, text, origin: "truth", isTrue: true, harm: by === "player" ? -1.5 : -1, kind: "fight" });
  for (const w of [v, ...watchers]) learn(s, w, rid, 1, "self");
  playerHears(s, rid, "self", "saw", ui);
  remember(v, s, by === "player" ? `${pn} attacked me; ${how}` : `I attacked ${pn}; ${how}`);
  if (v.intent?.target === "player") doneWithPlan(s, v);
  headline(s, text, "drama", ui, { place });
  const sided = { you: [], her: [], neither: [] };
  for (const [id, side] of Object.entries(sides)) {
    const forPlayer = (side === "aggressor") === (by === "player");
    sided[side === "neither" ? "neither" : forPlayer ? "you" : "her"].push(first(s.people[id]));
  }
  return { text, sided };
}

// ---------- things to do around town ----------

export function pickUp(s, item, ui) {
  if (!ITEMS[item]) return null;
  s.player.carrying = item;
  ui.first?.("gift", {});
  return ITEMS[item];
}

// Peeking in someone's mailbox. You might find her secret; you might get seen.
export async function snoop(s, ownerId, ui) {
  const owner = s.people[ownerId];
  if (!owner) return { found: null, caught: [] };
  if (owner.gone) return { found: "An empty mailbox. She's gone.", caught: [], gone: true };
  if (s.player.snooped[ownerId] === s.day) return { found: "You already went through it today. Nothing new.", caught: [], again: true };
  s.player.snooped[ownerId] = s.day;
  const lookouts = alive(s).filter((w) => (w.id === ownerId && w.location === "home") || (ui.distance && ui.distance(w) < 12));
  const qs = {};
  for (const w of lookouts) {
    const home = w.id === ownerId && w.location === "home";
    qs[`see_${w.id}`] = { type: "noul", instructions: home ? `${first(w)} is home and glances out of the window. She sees ${s.player.name} going through her mail.` : `${first(w)} is ${Math.round(ui.distance(w))} steps away. She notices ${s.player.name} going through ${first(owner)}'s mail.`, prior: home ? 0.3 : Math.min(0.85, (0.15 + w.bias.nosy * 0.55) * (1 - ui.distance(w) / 13)) };
  }
  const j = lookouts.length ? await jev.ask({ snooping: `${s.player.name} is going through ${owner.name}'s mailbox`, around: lookouts.map((w) => persona(s, w)) }, qs, `snoop:${ownerId}`) : {};
  const caught = lookouts.filter((w) => j[`see_${w.id}`]?.yes);
  // what she finds: the secret, the first time
  const secret = Object.values(s.rumors).find((r) => r.about === ownerId && r.origin === "truth" && r.day === 0);
  let found;
  if (secret && !s.player.heard.some((h) => h.rid === secret.id)) { playerHears(s, secret.id, "self", "saw", ui); found = secret.text; }
  else found = ["Bills, a coupon for the salon, and a very dull letter from an aunt.", "A seed catalogue and a note that just says 'Thursday?'", "Nothing juicy. Just a recipe for lemon bars."][Math.floor(Math.random() * 3)];
  if (caught.length) {
    const cid = newRumor(s, { about: "player", text: `${s.player.name} was caught snooping through ${owner.name}'s mail.`, origin: caught[0].id, isTrue: true, harm: -1.5 });
    for (const w of caught) {
      learn(s, w, cid, 1, "self");
      const rw = s.rel[w.id].player;
      rw.trust = clamp(rw.trust - 0.8); rw.affinity = clamp(rw.affinity - (w.id === ownerId ? 1.4 : 0.4));
      remember(w, s, `caught ${s.player.name} snooping in ${w.id === ownerId ? "my" : `${first(owner)}'s`} mail`);
      if (w.id === ownerId) { w.mood.anger = Math.min(3, w.mood.anger + 1.5); setPlan(s, w, { kind: "confront", target: "player", rumor: cid, why: `${s.player.name} went through her mail` }); }
      else if (w.bias.gossip > 0.35 || s.rel[w.id][ownerId]?.affinity > 0.5) setPlan(s, w, { kind: "warn", target: ownerId, rumor: cid, why: `the new girl was in her mail` });
      ui.emote?.(w.id, "suspicious");
    }
    headline(s, `${caught.map(first).join(" and ")} caught you snooping in ${first(owner)}'s mail!`, "bad", ui);
  }
  ui.first?.("snoop", {});
  return { found, caught: caught.map((w) => w.id), isSecret: !!secret && found === secret.text };
}

// Pinning an anonymous note to the Whisper board. Anyone who walks by may read it,
// believe it, and work out who wrote it.
export async function postNote(s, text, ui) {
  const subjects = { none: "Nobody in particular", player: `${s.player.name} herself` };
  for (const o of alive(s)) subjects[o.id] = o.name;
  const low = text.toLowerCase();
  const j = await jev.ask({ anonymous_note: text }, {
    subject: { type: "choice", instructions: "Who is this anonymous note about?", criteria: subjects, prior: Object.fromEntries(Object.keys(subjects).map((k) => [k, k !== "none" && k !== "player" && low.includes(first(s.people[k]).toLowerCase()) ? 10 : k === "none" ? 1 : 0.1])) },
    harm: { type: "score", instructions: "How does it make them look?", criteria: ["Very damaging", "Somewhat damaging", "Neutral", "Somewhat flattering", "Very flattering"], prior: 1 },
  }, "note");
  const about = j.subject.pick === "none" ? null : j.subject.pick;
  const rid = newRumor(s, { about, text, origin: "player", isTrue: null, harm: j.harm.value - 2, kind: "note" });
  s.rumors[rid].anon = true;
  s.notes.push({ rid, day: s.day, readBy: [] });
  if (s.notes.length > 6) s.notes.shift();
  s.player.told.push({ rid, to: "board", day: s.day, time: clock(s.minute), believed: null });
  ui.first?.("note", {});
  return { rid, about };
}

const BOARD_PLACES = ["gazette", "plaza", "market"];
async function readNotes(s, ui) {
  const live = s.notes.filter((n) => s.day - n.day <= 1 && s.rumors[n.rid]);
  if (!live.length) return;
  const jobs = [];
  for (const v of alive(s).filter((v) => BOARD_PLACES.includes(v.location) && v.id !== s.player.talkingTo)) {
    const note = live.find((n) => !n.readBy.includes(v.id));
    if (!note) continue;
    note.readBy.push(v.id);
    const r = s.rumors[note.rid];
    const aboutHer = r.about === v.id;
    const fromPlayer = s.player.told.some((t) => t.to === v.id && s.rumors[t.rid]?.about === r.about && r.about);
    jobs.push(jev.ask({ reader: persona(s, v), on_newcomer: feelings(s, v, "player"), note: r.text, about: r.about ? (aboutHer ? "her" : feelings(s, v, r.about === "player" ? "player" : s.people[r.about])) : "nobody in particular" }, {
      read: { type: "noul", instructions: `${first(v)} stops to read the anonymous note pinned on the Whisper board.`, prior: 0.35 + v.bias.nosy * 0.5 },
      believe: { type: "noul", instructions: `${first(v)} believes the anonymous note.`, prior: aboutHer ? 0.02 : 0.3 + v.bias.gossip * 0.2 },
      suspect: { type: "noul", instructions: `${first(v)} works out that the newcomer, ${s.player.name}, wrote it.`, prior: Math.min(0.8, 0.05 + v.bias.nosy * 0.2 + (fromPlayer ? 0.4 : 0) + (v.id === "tansy" ? 0.15 : 0)) },
    }, `note:${v.id}`).then((a) => {
      if (!a.read.yes) return;
      learn(s, v, r.id, a.believe.yes ? 0.6 : 0.15, "board");
      remember(v, s, `read an anonymous note on the Whisper board: ${r.text}`);
      if (aboutHer) { v.mood.anger = Math.min(3, v.mood.anger + 1); ui.emote?.(v.id, "anger"); }
      else ui.emote?.(v.id, a.believe.yes ? "gasp" : "question");
      if (a.suspect.yes) {
        const sid = newRumor(s, { about: "player", text: `${s.player.name} is the one pinning anonymous notes${r.about ? ` about ${nameOf(s, r.about)}` : ""} on the Whisper board.`, origin: v.id, isTrue: true, harm: -1.2 });
        learn(s, v, sid, 0.9, "self");
        s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - 0.5);
        if (aboutHer) setPlan(s, v, { kind: "confront", target: "player", rumor: sid, why: "she wrote that note about her" });
        else if (v.bias.gossip > 0.5) setPlan(s, v, { kind: "spread", rumor: sid, why: "everyone should know who writes those notes" });
      }
      const near = ui.distance && ui.distance(v) < 14;
      if (near) headline(s, aboutHer ? `${first(v)} just read the note about her. She is livid.` : `${first(v)} is reading your note on the Whisper board.`, aboutHer ? "drama" : "info", ui);
    }));
  }
  await Promise.all(jobs);
}

// ---------- the vote ----------

// Every cast member decides who to vote out. Jev weighs pacts, promises, grudges, threat and gossip.
const brawls = (s, id) => (id === "player" ? s.player.fights : s.people[id]?.fights) || 0;
export async function castVotes(s, candidates, voters, { finale = false } = {}) {
  const out = {};
  await Promise.all(voters.map(async (v) => {
    const opts = candidates.filter((id) => id !== v.id);
    if (!opts.length) return;
    const criteria = {}, prior = {};
    for (const id of opts) {
      const r = s.rel[v.id][id];
      const ally = alliancesOf(s, v.id).find((a) => a.members.includes(id));
      const said = Object.entries(v.knows).filter(([rid, k]) => s.rumors[rid].about === id && k.conf >= 0.4).map(([rid]) => s.rumors[rid].text).slice(-2);
      criteria[id] = `${finale ? "Crown" : "Vote out"} ${nameOf(s, id)}: ${first(v)} ${feel(r.affinity)} her and ${trust(r.trust)} her${ally ? `; they have a secret pact${ally.sincere[v.id] ? "" : " she never meant"}` : ""}${said.length ? `; she has heard: ${said.join(" / ")}` : ""}${!finale ? `; how well liked she is in town: ${popularity(s, id).toFixed(1)} of 3` : ""}${id === "player" && s.looks?.[v.id] ? `; ${first(v)} ${opinionText(s, v.id)}` : ""}${brawls(s, id) ? `; she has started ${brawls(s, id)} cat fight${brawls(s, id) > 1 ? "s" : ""}` : ""}`;
      if (finale) prior[id] = Math.max(0.05, 1.5 + r.affinity + r.trust * 0.5);
      else prior[id] = Math.max(0.05, 0.6 + Math.max(0, -r.affinity) * 1.6 + Math.max(0, -r.trust) * 0.6 - (ally ? (ally.sincere[v.id] ? 2.5 * v.bias.loyalty : 0) : 0) + (v.votePlan?.target === id ? 3 + v.bias.loyalty : 0) + Math.max(0, popularity(s, id)) * v.bias.scheme * 1.2 + brawls(s, id) * 0.35 + (id === "player" && s.looks?.[v.id]?.threat ? 1 + v.bias.scheme : 0));
    }
    const promised = s.player.promises.filter((p) => p.by === v.id && p.kind === "vote" && candidates.includes(p.target)).map((p) => `told ${s.player.name} she would vote out ${nameOf(s, p.target)}${p.sincere ? "" : " (a lie)"}`);
    const j = await jev.ask({ ...persona(s, v), promises_made: promised, ballot: finale ? "the finale: as a voted-out woman on the jury, she picks who wins the season" : "tonight's vote: she secretly names one woman to send home" }, {
      vote: { type: "choice", instructions: finale ? `${first(v)} was voted out earlier and now sits on the jury. Who does she crown the winner? Bitterness, respect and who played her all count.` : `Who does ${first(v)} vote out tonight? This is a cutthroat reality show: she votes the way this woman really would, out of strategy, grudges, fear and loyalty. She may break promises and betray allies if it suits her.`, criteria, prior },
    }, `vote:${v.id}`);
    out[v.id] = j.vote.pick;
  }));
  return out;
}

// Apply the result of a vote: votes are public, so everyone now knows who came for whom.
export function applyVote(s, ballots, outId, ui) {
  for (const [voter, target] of Object.entries(ballots)) {
    if (target === "player" || !s.people[target]) continue;
    if (voter === "player") { s.rel[target].player.affinity = clamp(s.rel[target].player.affinity - 1); s.rel[target].player.note = `${s.player.name} voted for her on day ${s.day}`; }
    else { s.rel[target][voter].affinity = clamp(s.rel[target][voter].affinity - 1); s.rel[target][voter].note = `voted for her on day ${s.day}`; }
  }
  // voting alongside someone brings you closer
  const byTarget = {};
  for (const [voter, target] of Object.entries(ballots)) (byTarget[target] ||= []).push(voter);
  for (const group of Object.values(byTarget)) for (const x of group) for (const y of group) if (x !== y && x !== "player" && s.rel[x][y]) s.rel[x][y].affinity = clamp(s.rel[x][y].affinity + 0.3);
  // broken promises to the player
  const betrayals = [];
  for (const p of s.player.promises.filter((p) => p.kind === "vote" && p.day > s.day - SHOW.voteEvery)) {
    const actual = ballots[p.by];
    if (actual && actual !== p.target) betrayals.push({ by: p.by, promised: p.target, voted: actual });
  }
  for (const p of s.player.promises.filter((p) => p.kind === "alliance")) {
    if (ballots[p.by] === "player") betrayals.push({ by: p.by, promised: "alliance", voted: "player" });
  }
  // the person voted out
  if (outId === "player") {
    s.player.out = true;
  } else if (s.people[outId]) {
    const v = s.people[outId];
    v.gone = true; v.out = true; v.outDay = s.day; v.location = "gone";
    for (const o of alive(s)) if (o.votePlan?.target === outId) o.votePlan = null;
  }
  for (const v of alive(s)) if (v.votePlan && (v.votePlan.target === outId)) v.votePlan = null;
  for (const v of alive(s)) remember(v, s, `the vote sent ${nameOf(s, outId)} home; ${Object.entries(ballots).filter(([, t]) => t === v.id).map(([x]) => firstOf(s, x)).join(", ") || "nobody"} voted for me`);
  const rec = { day: s.day, ballots, out: outId, betrayals };
  s.votes.push(rec);
  headline(s, `${nameOf(s, outId)} was voted out of Gossiptown.`, "vote", ui);
  return rec;
}

// ---------- end of the day ----------

export async function endOfDay(s, ui) {
  const lines = [];
  const outcomes = await Promise.all(alive(s).map(async (v) => {
    const criteria = { carry_on: "Carries on as usual tomorrow" };
    const prior = { carry_on: 8 };
    if (v.employer && v.employed && s.people[v.employer] && !s.people[v.employer].gone) { criteria.quit = `Quits working for ${s.people[v.employer].name}`; prior.quit = s.rel[v.id][v.employer].affinity < -1 ? 1 : 0.1; }
    const staff = alive(s).filter((o) => o.employer === v.id && o.employed);
    for (const e of staff) {
      const bad = Object.entries(v.knows).some(([id, k]) => s.rumors[id].about === e.id && s.rumors[id].harm <= -1 && k.conf >= 0.5);
      criteria[`fire_${e.id}`] = `Fires ${e.name}`; prior[`fire_${e.id}`] = bad ? 2.5 : s.rel[v.id][e.id].affinity < -1 ? 0.6 : 0.05;
    }
    const worst = alive(s).filter((o) => o.id !== v.id).sort((p, q) => s.rel[v.id][p.id].affinity - s.rel[v.id][q.id].affinity)[0];
    if (worst && s.rel[v.id][worst.id].affinity < -1) {
      criteria.make_peace = `Decides to make peace with ${worst.name}`; prior.make_peace = 0.3 * v.bias.loyalty;
      criteria.target = `Decides ${worst.name} has to be voted out`; prior.target = v.bias.scheme * 1.5;
    }
    const pr = s.rel[v.id].player;
    criteria.target_player = `Decides ${s.player.name} has to be voted out`; prior.target_player = pr.affinity < -1 || pr.trust < -1.5 ? 2 : 0.1;
    const j = await jev.ask({ ...persona(s, v), day_summary: v.memory.slice(-10), on_newcomer: feelings(s, v, "player") },
      { outcome: { type: "choice", instructions: `Lying awake tonight, what does ${first(v)} decide?`, criteria, prior } }, `night:${v.id}`);
    return [v, j.outcome.pick, worst];
  }));
  for (const [v, out, worst] of outcomes) {
    if (out === "quit") { v.employed = false; lines.push(`${v.name} quit working for ${s.people[v.employer].name}.`); headline(s, `${first(v)} quit working for ${first(s.people[v.employer])}.`, "drama", ui, { witnessed: false }); }
    else if (out.startsWith("fire_")) { const e = s.people[out.slice(5)]; e.employed = false; e.mood.anger += 2; s.rel[e.id][v.id].affinity = clamp(s.rel[e.id][v.id].affinity - 2); lines.push(`${v.name} fired ${e.name}.`); headline(s, `${first(v)} fired ${first(e)}.`, "drama", ui, { witnessed: false }); }
    else if (out === "make_peace" && worst) { s.rel[v.id][worst.id].affinity = clamp(s.rel[v.id][worst.id].affinity + 1.2); setPlan(s, v, { kind: "make_peace", target: worst.id, why: "she decided overnight" }); }
    else if (out === "target" && worst) v.votePlan = { target: worst.id, why: "she can't stand her" };
    else if (out === "target_player") v.votePlan = { target: "player", why: `she has had enough of ${s.player.name}` };
  }
  return lines;
}

// What the player can read about how people feel: only visible cues, never the raw numbers.
export function vibe(s, id) {
  const r = s.rel[id]?.player;
  if (!r) return "";
  if (r.affinity >= 1.5) return "adores you";
  if (r.affinity >= 0.6) return "likes you";
  if (r.affinity <= -1.5) return "can't stand you";
  if (r.affinity <= -0.6) return "is cold to you";
  if (r.trust <= -1.2) return "doesn't trust you";
  return "unsure about you";
}
