// The living town. Every decision a villager makes goes through Jev; code keeps
// the numbers, applies the results, and remembers everything. Claude only writes words,
// and only after Jev has decided what those words have to do.
//
// Jev never sees the `prior` numbers on questions; they only feed the offline stand-in.
// Everything Jev should weigh has to be in the state or the question text.

import * as jev from "./jev.js";
import * as llm from "./llm.js";
import { PLACES } from "./world.js";

// ---------- small helpers ----------

export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const first = (v) => v.name.split(" ")[0];
const clamp = (x, lo = -3, hi = 3) => Math.max(lo, Math.min(hi, x));
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

export const alive = (s) => Object.values(s.people).filter((v) => !v.gone);
export const at = (s, place) => alive(s).filter((v) => v.location === place);
export function nameOf(s, id) { return id === "player" ? "the newcomer" : s.people[id] ? s.people[id].name : id || "nobody"; }
const firstOf = (s, id) => (id === "player" ? "the newcomer" : s.people[id] ? first(s.people[id]) : id);

export function findPerson(s, text) {
  const t = text.toLowerCase().trim();
  return alive(s).find((v) => v.id === t || v.name.toLowerCase().includes(t) || first(v).toLowerCase() === t) || null;
}

const FEEL = ["hates", "dislikes", "is cool toward", "is neutral about", "likes", "is fond of", "adores"];
const TRUST = ["completely distrusts", "distrusts", "doubts", "is unsure about", "mostly trusts", "trusts", "trusts completely"];
export const feel = (x) => FEEL[Math.round(clamp(x) + 3)];
export const trust = (x) => TRUST[Math.round(clamp(x) + 3)];
const MOODS = (m) => [m.anger >= 2 ? "furious" : m.anger >= 1 ? "irritated" : null, m.fear >= 2 ? "scared" : m.fear >= 1 ? "uneasy" : null, m.cheer >= 2 ? "smug and cheerful" : m.cheer <= 0 ? "sulky" : null].filter(Boolean).join(", ") || "calm";

export const placeName = (loc) => PLACES[loc]?.name || (loc === "home" ? "home" : "the lane between places");

export function remember(v, s, text) {
  v.memory.push(`day ${s.day} ${clock(s.minute)} ${text}`);
  if (v.memory.length > 16) v.memory.splice(0, v.memory.length - 16);
}

export function event(s, place, text, ui) {
  const witnesses = at(s, place).map((v) => v.id);
  s.events.push({ day: s.day, time: clock(s.minute), place, text, witnesses });
  if (s.player.location === place) ui.say(`* ${text}`);
  return witnesses;
}

function newRumor(s, { about, text, origin, isTrue = null, harm = 0, parent = null }) {
  const id = "r" + s.nextRumor++;
  s.rumors[id] = { id, about, text, origin, isTrue, harm, parent, day: s.day, time: clock(s.minute) };
  return id;
}

function learn(s, v, rumorId, conf, from) {
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

// The player finds something out. Kept for the rumor tracker.
function playerLearns(s, rid, from, how, ui) {
  if (!rid || s.player.knows[rid]) return;
  s.player.knows[rid] = { from, how, day: s.day, time: clock(s.minute) };
  ui.learned?.({ rid, text: s.rumors[rid].text, about: s.rumors[rid].about, from });
}

// What a villager knows, as short lines for a Jev state.
function knowledge(s, v, max = 6) {
  return Object.entries(v.knows)
    .filter(([, k]) => k.conf >= 0.3)
    .sort((p, q) => q[1].conf - p[1].conf)
    .slice(0, max)
    .map(([id, k]) => `${s.rumors[id].text} (${k.conf >= 0.8 ? "sure" : k.conf >= 0.5 ? "believes" : "half-believes"}; heard from ${k.from === "self" ? "own knowledge" : nameOf(s, k.from)})`);
}

const VOTE_EVERY = Number(process.env.VOTE_EVERY || 3);
export const voteDay = (day) => Math.ceil(day / VOTE_EVERY) * VOTE_EVERY;

// her side deals, as she knows them (including the ones she is faking)
function dealsOf(s, v) {
  return Object.entries(v.allies || {}).filter(([id]) => id === "player" || (s.people[id] && !s.people[id].gone))
    .map(([id, d]) => `agreed to team up with ${nameOf(s, id)} on day ${d.day}${d.real ? "" : " (she is only pretending)"}`);
}

function persona(s, v) {
  const left = alive(s).length + (s.player.gone ? 0 : 1);
  const vd = voteDay(s.day);
  return {
    who: `${v.name}, ${v.job}`,
    personality: v.traits.join(", "),
    game_plan: v.agenda,
    mood: MOODS(v.mood),
    where: placeName(v.location),
    works_at: PLACES[v.work]?.name,
    plan: planText(s, v.intent),
    wants_voted_out: v.target ? nameOf(s, v.target) : "has not decided",
    deals: dealsOf(s, v),
    time: `day ${s.day}, ${clock(s.minute)}`,
    next_vote: vd === s.day ? "tonight at six, in the town square" : `in ${vd - s.day} day${vd - s.day > 1 ? "s" : ""}, at six in the evening`,
    still_in_town: `${left} women including the newcomer; one is voted out at each vote, last one standing wins`,
    knows: knowledge(s, v),
    recent: v.memory.slice(-7),
  };
}

function feelings(s, a, b) {
  const r = s.rel[a.id][b === "player" ? "player" : b.id];
  const name = b === "player" ? "the newcomer" : b.name;
  return `${first(a)} ${feel(r.affinity)} ${name} and ${trust(r.trust)} her (${r.note})`;
}

// ---------- plans ----------
// A plan is something a villager has decided to do: { kind, target, rumor, why, promisedTo, now }.
// Jev makes the decision; the plan is then in every later Jev state for her (where to go,
// what to bring up) until she carries it out.

export function planText(s, it) {
  if (!it) return "nothing in particular";
  const who = nameOf(s, it.target);
  const r = it.rumor && s.rumors[it.rumor] ? `"${s.rumors[it.rumor].text}"` : "";
  const text = {
    ask: `ask ${who} whether this is true: ${r}`,
    confront: `confront ${who}${r ? ` about: ${r}` : ""}`,
    warn: `warn ${who} what people are saying: ${r}`,
    spread: `pass this on to someone: ${r}`,
    recruit: `get ${who} to team up with her for the vote`,
    campaign: `get ${who} to vote out ${nameOf(s, it.against)}`,
    make_peace: `make peace with ${who}`,
  }[it.kind] || `${it.kind.replace(/_/g, " ")} ${it.target ? who : ""}`.trim();
  return text + (it.why ? ` (because ${it.why})` : "");
}

function setPlan(s, v, plan) {
  if (plan.target === v.id) return;
  if (plan.target && plan.target !== "player" && (!s.people[plan.target] || s.people[plan.target].gone)) return;
  v.intent = { ...plan, made: `day ${s.day} ${clock(s.minute)}` };
  remember(v, s, `decided to ${planText(s, v.intent)}${plan.promisedTo ? `, and told ${nameOf(s, plan.promisedTo)} so` : ""}`);
}

function doneWithPlan(s, v) {
  if (!v.intent) return;
  remember(v, s, `did what I meant to: ${planText(s, v.intent)}`);
  v.intent = null;
}

// Someone who just decided to act right away sets off, unless the person she needs is right here.
export async function setOff(s, v, ui) {
  const t = v.intent?.target;
  if (t && t !== "player" && s.people[t]?.location === v.location) return;
  await move(s, v, ui);
}

// ---------- the world tick (every 15 game minutes) ----------

export async function tick(s, ui) {
  // The person you are talking to stays put until you say goodbye. Someone who has
  // found the person she was looking for stays to talk to her.
  const found = (v) => v.intent?.target && v.intent.target !== "player" && s.people[v.intent.target]?.location === v.location;
  await Promise.all(alive(s).filter((v) => v.id !== s.player.talkingTo && v.id !== s.approaching && !found(v)).map((v) => move(s, v, ui)));

  // who meets whom: people who came looking for someone talk to her first,
  // then up to two other pairs per place
  const jobs = [];
  for (const place of Object.keys(PLACES)) {
    const here = shuffle(at(s, place).filter((v) => v.id !== s.player.talkingTo && v.id !== s.approaching));
    const used = new Set();
    const pairs = [];
    for (const a of here) {
      const b = a.intent?.target && here.find((o) => o.id === a.intent.target);
      if (b && !used.has(a.id) && !used.has(b.id)) { pairs.push([a, b]); used.add(a.id); used.add(b.id); }
    }
    const rest = here.filter((v) => !used.has(v.id));
    for (let i = 0; i + 1 < rest.length && i < 4; i += 2) pairs.push([rest[i], rest[i + 1]]);
    for (const [a, b] of pairs) jobs.push(encounter(s, a, b, place, ui));
  }
  await Promise.all(jobs);
  s.player.listening = false;
}

const PURPOSES = {
  get_to_know: "Size up the newcomer and get to know her",
  fish: "Fish for gossip: find out what the newcomer knows or who she is voting for",
  recruit: "Try to get the newcomer to team up with her for the vote",
  ask_vote: "Ask the newcomer to vote out the person she wants gone",
  spill: "Tell the newcomer a juicy piece of gossip",
  warn: "Warn the newcomer about someone",
  confront: "Have it out with the newcomer about something she did or said",
};

// Where a villager goes next, and whether she walks up to the newcomer to start a talk.
// Jev decides from who she is, the time, her job, her plans and the game.
export async function move(s, v, ui) {
  const criteria = { stay: `Stay at ${placeName(v.location)}` };
  for (const [k, p] of Object.entries(PLACES)) if (k !== v.location) criteria[k] = `Go to ${p.name}${k === v.work ? `, where ${first(v)} works` : ""}`;
  if (v.location !== "home") criteria.home = "Go home";
  for (const o of alive(s)) if (o.id !== v.id) criteria[`find_${o.id}`] = `Go and find ${o.name}`;
  if (!s.player.gone) criteria.find_player = "Go and find the newcomer";
  const it = v.intent;

  // she can walk up to the newcomer if she is close by, free, and has not just done so
  const near = !s.player.gone && !s.player.talkingTo && !s.approaching && (ui.isNear ? ui.isNear(v) : v.location === s.player.location);
  // nobody walks up to her twice in a row: at least an hour between any two, and 3 hours for the same woman
  const canApproach = near && s.minute - v.lastApproach >= 180 && s.minute - (s.lastApproach ?? -999) >= 60 && !s.ceremony;
  const shareable = Object.entries(v.knows).filter(([id, k]) => k.conf >= 0.4 && s.rumors[id].about !== v.id).map(([id]) => s.rumors[id]).slice(-6);

  const qs = {
    go: {
      type: "choice",
      instructions: `It is ${clock(s.minute)}. Decide where ${first(v)} goes for the next quarter hour, the way this woman really would: her job and the time of day, how she feels, who she wants to work on or avoid before the vote, and any plan she has made. People follow through on plans, most of all ones they told someone about. This is a small town: people usually stay where they are for a good while, and only go somewhere else when they have a reason.`,
      criteria,
    },
  };
  if (canApproach) {
    qs.chat = { type: "noul", instructions: `The newcomer is a few steps away. ${first(v)} walks over and starts a conversation with her right now.`, prior: 0.25 };
    qs.why = { type: "choice", instructions: `If ${first(v)} goes over to the newcomer, what does she want from the talk?`, criteria: PURPOSES };
    if (shareable.length) qs.spill = { type: "choice", instructions: `If she tells the newcomer some gossip, which piece?`, criteria: Object.fromEntries(shareable.map((r) => [r.id, `${r.text} (about ${nameOf(s, r.about)})`])) };
  }
  const a = await jev.ask({
    ...persona(s, v),
    plan: planText(s, it) + (it?.promisedTo ? `. ${first(v)} told ${nameOf(s, it.promisedTo)} she would do this${it.now ? " right away" : ""}` : ""),
    on_newcomer: feelings(s, v, "player"),
    people_here: at(s, v.location).filter((o) => o.id !== v.id).map((o) => o.name),
    where_people_are: alive(s).filter((o) => o.id !== v.id).map((o) => `${o.name}: ${placeName(o.location)}`).concat(s.player.gone ? [] : [`the newcomer: ${placeName(s.player.location)}`]),
  }, qs, `move:${v.id}`);

  if (canApproach && a.chat.yes && !s.player.talkingTo && !s.approaching) {
    const purpose = a.why.pick;
    const rumor = purpose === "spill" && a.spill ? s.rumors[a.spill.pick] : null;
    await approachPlayer(s, v, purpose, rumor, ui);
    return;
  }

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
  v.mood.anger = Math.max(0, v.mood.anger - 0.15);
  v.mood.fear = Math.max(0, v.mood.fear - 0.1);
  v.mood.cheer += (1 - v.mood.cheer) * 0.1;
}

// A villager walks up to the newcomer and opens a conversation.
async function approachPlayer(s, v, purpose, rumor, ui) {
  s.approaching = v.id;
  v.lastApproach = s.lastApproach = s.minute;
  if (PLACES[s.player.location]) v.location = s.player.location;
  ui.approach?.(v);
  const r = s.rel[v.id].player;
  const want = { ask_vote: v.target ? `get the newcomer to vote out ${nameOf(s, v.target)}` : null }[purpose] || PURPOSES[purpose].toLowerCase();
  const line = await llm.opener({ v, want, rumorText: rumor?.text, feelings: `${feel(r.affinity)} the newcomer and ${trust(r.trust)} her`, recent: v.memory.slice(-4) });
  s.approaching = null;
  if (s.player.talkingTo || s.ceremony || s.player.gone) return;
  if (rumor) playerLearns(s, rumor.id, v.id, "told", ui);
  remember(v, s, `walked up to the newcomer to ${want}, and said: ${line}`);
  const conv = (s.player.convo = { with: v.id, lines: [`${first(v)}: ${line}`] });
  s.player.talkingTo = v.id;
  ui.opened?.(v, line, conv);
  ui.say(`${first(v)}: ${line}`);
}

const WARMTH = ["much colder toward each other", "a bit colder", "about the same", "a bit warmer", "much warmer toward each other"];

const REACTIONS = (aboutName) => ({
  nothing: "Does nothing about it",
  spread: "Will pass it on to someone else",
  ask_subject: `Will go and ask ${aboutName} whether it is true`,
  warn_subject: `Will go and warn ${aboutName} what people are saying`,
  confront: `Will go and confront ${aboutName}`,
});

const DEAL = { agree: "Says yes and means it", pretend: "Says yes but has no intention of keeping it", refuse: "Turns it down" };

async function encounter(s, a, b, place, ui) {
  // the one who came with a plan for the other leads
  if (b.intent?.target === a.id && a.intent?.target !== b.id) [a, b] = [b, a];
  const rAB = s.rel[a.id][b.id], rBA = s.rel[b.id][a.id];
  ui.pair?.(a, b, place);
  // How much the player hears: "full", "part" or "none". The map version decides by distance.
  const hear = s.player.gone ? "none" : ui.hearing ? ui.hearing(a, b, place) : s.player.location === place ? (s.player.listening ? "full" : "part") : "none";
  const playerHere = hear !== "none";
  const listening = hear === "full";
  const plan = a.intent && (a.intent.target === b.id || a.intent.kind === "spread") ? a.intent : null;
  const planRumor = plan?.rumor && s.rumors[plan.rumor];

  const shareable = Object.entries(a.knows).filter(([id, k]) => k.conf >= 0.4 || id === plan?.rumor).map(([id]) => s.rumors[id]).filter((r) => r.about !== a.id || Math.random() < 0.15).slice(-6);
  const rumorCriteria = { none: "Nothing in particular" };
  for (const r of shareable) rumorCriteria[r.id] = `${r.text} (about ${nameOf(s, r.about)})`;
  const state = {
    a: persona(s, a), b: persona(s, b),
    between_them: [feelings(s, a, b), feelings(s, b, a)],
    newcomer: playerHere ? (listening ? "standing close, clearly listening" : "nearby") : "not here",
    a_came_to: plan ? planText(s, plan) : "nothing in particular",
  };
  const topics = {
    small_talk: "Small talk and pleasantries, with a little edge",
    share_rumor: "Passes on a piece of gossip",
    argue: `Picks a fight with ${first(b)}`,
    complain: "Bitches about someone else",
    make_up: `Tries to patch things up with ${first(b)}`,
    recruit: `Asks ${first(b)} to team up with her for the vote`,
  };
  const against = a.target && a.target !== b.id ? a.target : null;
  if (against) topics.campaign = `Pushes ${first(b)} to vote out ${nameOf(s, against)}`;
  if (plan) topics.plan = `Does what ${first(a)} came to do: ${planText(s, plan)}`;
  const qs = {
    topic: { type: "choice", instructions: `What does ${first(a)} bring up with ${first(b)}? This is a catty reality show and everyone is playing to win.`, criteria: topics },
    rumor: { type: "choice", instructions: `If ${first(a)} passes on gossip, which piece?`, criteria: rumorCriteria },
    warmth: { type: "score", instructions: `After this talk, how do ${first(a)} and ${first(b)} feel about each other?`, criteria: WARMTH },
    escalate: { type: "noul", instructions: `If they argue, it turns into a screaming match in public.` },
    deal: { type: "choice", instructions: `If ${first(a)} asks ${first(b)} to team up or to vote someone out, how does ${first(b)} answer?`, criteria: DEAL },
  };
  // someone who came looking for b always talks; otherwise Jev decides if they stop at all
  if (!(plan && plan.target === b.id)) qs.talk = { type: "noul", instructions: `${first(a)} and ${first(b)} stop to talk with each other.` };
  if (listening) qs.notice = { type: "noul", instructions: "They notice the newcomer eavesdropping on them." };
  const j = await jev.ask(state, qs, `meet:${a.id}+${b.id}`);
  if (qs.talk && !j.talk.yes) return;

  let topic = j.topic.pick;
  let rumor = null;
  if (topic === "plan") {
    const k = plan.kind;
    topic = k === "confront" ? "argue" : k === "make_peace" ? "make_up" : k === "recruit" ? "recruit" : k === "campaign" ? "campaign" : planRumor ? "share_rumor" : "small_talk";
    rumor = planRumor || null;
    doneWithPlan(s, a);
  } else if (topic === "share_rumor") {
    rumor = j.rumor.pick !== "none" ? s.rumors[j.rumor.pick] : planRumor || null;
    if (!rumor) topic = "small_talk";
    else if (plan?.kind === "spread" && plan.rumor === rumor.id) doneWithPlan(s, a);
  }
  if (topic === "campaign" && !against && plan?.against) topic = "small_talk";
  const campaignAgainst = topic === "campaign" ? (plan?.kind === "campaign" ? plan.against : against) : null;

  let outcome = WARMTH[Math.round(j.warmth.value)];
  const dw = (j.warmth.value - 2) * 0.35;
  rAB.affinity = clamp(rAB.affinity + dw); rBA.affinity = clamp(rBA.affinity + dw);

  const next = []; // plans and deals that came out of this talk, so the written words can match them
  let mood = { small_talk: "neutral", share_rumor: "smug", argue: "angry", complain: "smug", make_up: "happy", recruit: "sly", campaign: "sly" }[topic];

  // deals: teaming up, or agreeing to vote someone out
  if (topic === "recruit" || topic === "campaign") {
    const d = j.deal.pick;
    if (d !== "refuse") {
      if (topic === "recruit") {
        (a.allies ||= {})[b.id] = { real: true, day: s.day };
        (b.allies ||= {})[a.id] = { real: d === "agree", day: s.day };
        next.push(`they agree to team up for the vote`);
      } else {
        if (d === "agree") b.target = campaignAgainst;
        next.push(`${first(b)} agrees to vote out ${nameOf(s, campaignAgainst)}`);
      }
      remember(a, s, topic === "recruit" ? `${first(b)} agreed to team up with me` : `${first(b)} said she'd vote out ${nameOf(s, campaignAgainst)}`);
      remember(b, s, topic === "recruit" ? `agreed to team up with ${first(a)}${d === "pretend" ? " (I don't mean it)" : ""}` : `told ${first(a)} I'd vote out ${nameOf(s, campaignAgainst)}${d === "pretend" ? " (I won't)" : ""}`);
      outcome += d === "pretend" ? `; ${first(b)} says yes, but she is lying` : `; ${first(b)} says yes`;
      ui.emote?.(a.id, "handshake"); ui.emote?.(b.id, d === "pretend" ? "sly" : "handshake");
    } else {
      outcome += `; ${first(b)} turns her down`;
      remember(a, s, `${first(b)} turned me down`);
      ui.emote?.(a.id, "annoyed");
    }
  }

  if (rumor) {
    const aboutB = rumor.about === b.id;
    const aboutName = nameOf(s, rumor.about);
    let r2;
    if (aboutB) {
      // b hears what is being said about her. b knows the truth; a decides who to believe.
      r2 = await jev.ask({ listener: persona(s, b), teller: persona(s, a), between_them: [feelings(s, a, b), feelings(s, b, a)], what_is_said_about_b: rumor.text, it_started_with: rumor.origin === "player" ? "the newcomer" : nameOf(s, rumor.origin) }, {
        answer: { type: "choice", instructions: `${first(b)} hears this said about her. How does ${first(b)} answer? ${first(b)} knows whether it is true.`, criteria: { admit: "Admits it is true", deny: "Denies it, and it really is false", lie: "Denies it, but it is actually true", dodge: "Dodges the question" } },
        a_believes_after: { type: "noul", instructions: `After ${first(b)}'s answer, ${first(a)} still believes the story about ${first(b)}.` },
        react: { type: "choice", instructions: `What does ${first(b)} decide to do about the story going round?`, criteria: { nothing: "Lets it go", confront_source: `Will go and confront whoever started it (${rumor.origin === "player" ? "the newcomer" : nameOf(s, rumor.origin)})`, target_source: `Decides to get whoever started it voted out` } },
      }, `rumor:${rumor.id}->${b.id}`);
      const ans = r2.answer.pick;
      b.mood.anger += ans === "admit" ? 0.5 : 1.5;
      rBA.affinity = clamp(rBA.affinity - 0.6);
      learn(s, a, rumor.id, r2.a_believes_after.yes ? 0.9 : 0.1, b.id);
      if (!r2.a_believes_after.yes) a.knows[rumor.id].conf = 0.1;
      outcome = `${first(b)} ${{ admit: "admits it", deny: "denies it", lie: "denies it", dodge: "dodges the question" }[ans]}, and ${first(a)} ${r2.a_believes_after.yes ? "is not convinced" : "believes her"}`;
      remember(a, s, `asked ${first(b)} about "${rumor.text}"; ${first(b)} ${ans === "admit" ? "admitted it" : ans === "dodge" ? "dodged" : "denied it"}`);
      remember(b, s, `${first(a)} brought up what people say about me: ${rumor.text}`);
      ui.emote?.(b.id, "angry");
      mood = "angry";
      // finding out the newcomer made it up
      if (rumor.origin === "player" && !r2.a_believes_after.yes && (ans === "deny" || ans === "lie")) {
        s.rel[a.id].player.trust = clamp(s.rel[a.id].player.trust - 1);
        s.rel[b.id].player.trust = clamp(s.rel[b.id].player.trust - 1);
        s.rel[b.id].player.affinity = clamp(s.rel[b.id].player.affinity - 1);
        const lid = newRumor(s, { about: "player", text: `The newcomer has been spreading lies about ${b.name}.`, origin: a.id, isTrue: true, harm: -1.5 });
        learn(s, a, lid, 0.9, "self"); learn(s, b, lid, 1, "self");
        remember(a, s, `found out the newcomer lied to me about ${first(b)}`);
      }
      const src = rumor.origin === "player" ? "player" : s.people[rumor.origin] && !s.people[rumor.origin].gone ? rumor.origin : null;
      const rk = r2.react.pick;
      if (rk === "confront_source" && src) { setPlan(s, b, { kind: "confront", target: src, rumor: rumor.id, why: `of what is being said about ${first(b)}` }); next.push(`${first(b)} means to go and confront ${nameOf(s, src)} about it`); }
      else if (rk === "target_source" && src) { b.target = src; remember(b, s, `want ${nameOf(s, src)} voted out for spreading lies about me`); next.push(`${first(b)} decides ${nameOf(s, src)} is going home at the next vote`); }
    } else {
      r2 = await jev.ask({ listener: persona(s, b), teller: feelings(s, b, a), gossip: rumor.text, about: feelings(s, b, rumor.about === "player" ? "player" : s.people[rumor.about] || "player") }, {
        believe: { type: "noul", instructions: `${first(b)} believes this gossip.` },
        react: { type: "choice", instructions: `What does ${first(b)} decide to do about it?`, criteria: REACTIONS(aboutName) },
        embellish: { type: "noul", instructions: `${first(a)} exaggerates the story while telling it.` },
      }, `rumor:${rumor.id}->${b.id}`);
      let rid = rumor.id;
      if (r2.embellish.yes) {
        // gossip mutates as it travels
        const text = await llm.retell({ teller: a, rumorText: rumor.text });
        if (text && text !== "...") rid = newRumor(s, { about: rumor.about, text, origin: a.id, isTrue: rumor.isTrue, harm: clamp(rumor.harm * 1.3, -2, 2), parent: rumor.id });
        rumor = s.rumors[rid];
      }
      learn(s, b, rid, r2.believe.yes ? 0.5 + r2.believe.p * 0.5 : r2.believe.p * 0.3, a.id);
      const rk = r2.react.pick;
      const subj = rumor.about;
      const canReach = subj === "player" ? !s.player.gone : s.people[subj] && !s.people[subj].gone;
      if (rk === "spread") { setPlan(s, b, { kind: "spread", target: null, rumor: rid, why: `${first(a)} told her` }); next.push(`${first(b)} means to pass it on`); }
      else if (["ask_subject", "warn_subject", "confront"].includes(rk) && canReach && subj !== b.id) {
        const kind = { ask_subject: "ask", warn_subject: "warn", confront: "confront" }[rk];
        setPlan(s, b, { kind, target: subj, rumor: rid, why: `${first(a)} told her` });
        next.push(`${first(b)} means to go and ${kind} ${aboutName}`);
      }
      outcome += r2.believe.yes ? `; ${first(b)} believes it` : `; ${first(b)} doubts it`;
      ui.emote?.(b.id, r2.believe.yes ? "shocked" : "doubt");
    }
    remember(a, s, `told ${first(b)}: ${rumor.text}`);
    if (!aboutB) remember(b, s, `${first(a)} told me: ${rumor.text}`);
  } else if (topic !== "recruit" && topic !== "campaign") {
    remember(a, s, `${topic.replace("_", " ")} with ${first(b)} at ${placeName(place)}`);
    remember(b, s, `${topic.replace("_", " ")} with ${first(a)} at ${placeName(place)}`);
  }
  if (topic === "make_up") { ui.emote?.(a.id, "heart"); ui.emote?.(b.id, "heart"); }

  let fight = false;
  if (topic === "argue" || (rumor && rumor.about === b.id)) {
    a.mood.anger += 1; b.mood.anger += 1;
    ui.emote?.(a.id, "angry");
    if (j.escalate.yes) fight = true;
  }

  if (playerHere) {
    const topicText = {
      small_talk: "small talk with a catty edge",
      share_rumor: rumor?.about === b.id ? `${first(a)} asks ${first(b)} about what people are saying about her` : "juicy gossip",
      argue: `a fight; ${first(a)} is picking it${plan?.kind === "confront" ? ` about: ${planRumor?.text || "an old grudge"}` : ""}`,
      complain: `${first(a)} trashes someone who isn't there`,
      make_up: "trying to patch things up",
      recruit: `${first(a)} quietly asks ${first(b)} to team up for the vote`,
      campaign: `${first(a)} pushes ${first(b)} to vote out ${nameOf(s, campaignAgainst)}`,
    }[topic];
    s.player.seen[`${a.id}|${b.id}`] = outcome;
    const noticed = j.notice?.yes;
    llm.overheard({ a, b, topic: topicText, rumorText: rumor?.text, aboutName: rumor ? nameOf(s, rumor.about) : null, outcome: fight ? "it turns into a screaming match" : outcome, next })
      .then((text) => {
        ui.overheard?.({ a: a.id, b: b.id, text: listening ? text : muffle(text), full: listening, mood: fight ? "angry" : mood });
        if (!ui.overheard) { ui.say(`\n[${first(a)} and ${first(b)}, ${listening ? "you listen in" : "you catch part of it"}]`); ui.say(listening ? text : muffle(text)); }
        if (rumor && listening) playerLearns(s, rumor.id, a.id, "overheard", ui);
        if (listening && (topic === "recruit" || topic === "campaign")) s.player.journal.push({ day: s.day, time: clock(s.minute), text: `Overheard ${first(a)} and ${first(b)}: ${outcome}` });
      });
    if (noticed) {
      ui.emote?.(a.id, "exclaim"); ui.emote?.(b.id, "exclaim");
      for (const v of [a, b]) { s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - 0.5); remember(v, s, "caught the newcomer eavesdropping"); }
      const rid = newRumor(s, { about: "player", text: `The newcomer was caught eavesdropping on ${first(a)} and ${first(b)}.`, origin: a.id, isTrue: true, harm: -1 });
      learn(s, a, rid, 1, "self"); learn(s, b, rid, 1, "self");
    }
  }

  if (fight) scene(s, a, b, place, ui);
}

function scene(s, a, b, place, ui) {
  s.rel[a.id][b.id].affinity = clamp(s.rel[a.id][b.id].affinity - 1.5);
  s.rel[b.id][a.id].affinity = clamp(s.rel[b.id][a.id].affinity - 1.5);
  s.rel[a.id][b.id].note = s.rel[b.id][a.id].note = `had a screaming match on day ${s.day}`;
  a.mood.anger = Math.min(3, a.mood.anger + 1); b.mood.anger = Math.min(3, b.mood.anger + 1);
  const witnesses = event(s, place, `${a.name} and ${b.name} have a screaming match at ${placeName(place)}!`, ui);
  const rid = newRumor(s, { about: a.id, text: `${a.name} and ${b.name} had a screaming match at ${placeName(place)} on day ${s.day}.`, origin: "truth", isTrue: true, harm: -1 });
  for (const w of witnesses) learn(s, s.people[w], rid, 1, "self");
  remember(a, s, `had a screaming match with ${first(b)}`); remember(b, s, `had a screaming match with ${first(a)}`);
  ui.emote?.(a.id, "angry"); ui.emote?.(b.id, "angry");
  s.fights = (s.fights || 0) + 1;
}

function muffle(text) {
  return text.split("\n").map((line) => {
    const [who, ...rest] = line.split(":");
    if (!rest.length) return line;
    const words = rest.join(":").trim().split(/\s+/);
    const kept = words.map((w) => (Math.random() < 0.5 ? w : "…")).join(" ").replace(/(… )+…/g, "…");
    return `${who}: ${kept}`;
  }).join("\n");
}

// ---------- the player talks ----------

const INTENTS = {
  small_talk: "Small talk, greetings, pleasantries",
  question: "Asks a general question",
  tell_news: "Claims something about another person (news, gossip, accusation)",
  ask_info: "Asks what she knows, what people are saying, or who she wants voted out",
  propose_alliance: "Asks her to team up with the newcomer for the vote",
  ask_vote: "Asks her to vote out a particular person",
  compliment: "Compliments or flatters her",
  insult: "Insults or mocks her",
  threat: "Threatens her",
  apology: "Apologizes",
  about_self: "Talks about herself",
};
const ACTS = {
  nothing: "Nothing for now",
  ask_subject: "Go and ask the person it is about whether it is true",
  warn_subject: "Go and warn the person it is about",
  confront_subject: "Go and confront the person it is about",
  tell_others: "Pass it on to others",
  target_subject: "Decide to get the person it is about voted out",
  target_newcomer: "Decide the newcomer is a threat who should be voted out",
  end_conversation: "End this conversation",
};
const SHIFT = ["much worse", "worse", "about the same", "better", "much better"];

export async function playerSays(s, v, line, ui) {
  const conv = (s.player.convo ||= { with: v.id, lines: [] });
  if (conv.with !== v.id) { conv.with = v.id; conv.lines = []; }
  const subjects = { none: "Nobody in particular", self: `${first(v)} herself`, player: "The newcomer (the speaker)" };
  for (const o of alive(s)) if (o.id !== v.id) subjects[o.id] = o.name;
  const r = s.rel[v.id].player;
  const aboutPlayer = Object.entries(v.knows).filter(([id, k]) => s.rumors[id].about === "player" && k.conf >= 0.3).map(([id]) => s.rumors[id].text);
  const mentions = alive(s).some((o) => o.id !== v.id && line.toLowerCase().includes(first(o).toLowerCase()));
  const shareable = Object.entries(v.knows).filter(([id, k]) => k.conf >= 0.4 && s.rumors[id].about !== v.id).map(([id]) => s.rumors[id]).slice(-6);
  const others = alive(s).filter((o) => o.id !== v.id);
  const state = {
    listener: persona(s, v),
    listener_on_newcomer: `${feel(r.affinity)} the newcomer and ${trust(r.trust)} her. Heard about the newcomer: ${aboutPlayer.join(" | ") || "nothing"}`,
    listener_feelings: others.map((o) => feelings(s, v, o)),
    conversation: conv.lines.slice(-8),
    newcomer_says: line,
  };
  const j = await jev.ask(state, {
    intent: { type: "choice", instructions: "What is the newcomer doing with this line?", criteria: INTENTS, prior: { small_talk: 2, question: 1, tell_news: mentions ? 3 : 0.3, ask_info: 1, propose_alliance: /team|alliance|together|side/i.test(line) ? 6 : 0.2, ask_vote: /vote/i.test(line) ? 5 : 0.2, compliment: 0.5, insult: 0.3, threat: 0.1, apology: 0.2, about_self: 0.5 } },
    subject: { type: "choice", instructions: "Who is the line mainly about (or who should be voted out, if she is asked)?", criteria: subjects, prior: Object.fromEntries(Object.keys(subjects).map((k) => [k, s.people[k] && line.toLowerCase().includes(first(s.people[k]).toLowerCase()) ? 6 : k === "none" ? 1 : 0.2])) },
    harm: { type: "score", instructions: "If this is a claim about someone, how does it make them look?", criteria: ["Very damaging", "Somewhat damaging", "Neutral", "Somewhat flattering", "Very flattering"], prior: 2 },
    believe: { type: "noul", instructions: `${first(v)} believes what the newcomer is claiming.`, prior: 0.35 + r.trust * 0.1 },
    caught_lie: { type: "noul", instructions: `${first(v)} knows, or is nearly sure from what she already knows, that the newcomer is lying.`, prior: 0.1 },
    feel: { type: "score", instructions: `After this line, how does ${first(v)} feel about the newcomer?`, criteria: SHIFT, prior: 2 },
    stance: { type: "choice", instructions: `How does ${first(v)} respond?`, criteria: { warm: "Warmly", sweet_fake: "Sweet on the surface, mocking underneath", guarded: "Guarded, careful", curious: "Curious, wants more", dismissive: "Dismissive", hostile: "Hostile" } },
    deal: { type: "choice", instructions: `If the newcomer asked her to team up, or to vote someone out, how does ${first(v)} answer?`, criteria: { not_asked: "She wasn't asked", ...DEAL } },
    share: { type: "choice", instructions: `Does ${first(v)} tell the newcomer a piece of gossip (because she was asked, or to stir trouble or win her over)? Which piece?`, criteria: { none: "She shares nothing", ...Object.fromEntries(shareable.map((x) => [x.id, `${x.text} (about ${nameOf(s, x.about)})`])) }, prior: { none: 3 } },
    reveal: { type: "choice", instructions: `If asked who she wants voted out, what does ${first(v)} say?`, criteria: { not_asked: "She wasn't asked", truth: "Tells the truth", lie: "Names someone else to throw the newcomer off", dodge: "Won't say" } },
    decoy: { type: "choice", instructions: `If ${first(v)} lies about who she wants out, who does she name?`, criteria: Object.fromEntries(others.map((o) => [o.id, o.name])) },
    act: { type: "choice", instructions: `What does ${first(v)} decide to do after this? Only pick a step about another person if the line was about her.`, criteria: ACTS, prior: { nothing: 4, ask_subject: 0.5, warn_subject: 0.3, confront_subject: 0.3, tell_others: v.traits.some((t) => /gossip|secret|nosy|mouth/.test(t)) ? 1.5 : 0.4, target_subject: 0.3, target_newcomer: 0.2, end_conversation: 0.3 } },
    now: { type: "noul", instructions: `${first(v)} goes to do it right away, ending this conversation, rather than later.`, prior: 0.35 },
  }, `talk:${v.id}`);

  const intent = j.intent.pick, subject = j.subject.pick;
  r.affinity = clamp(r.affinity + (j.feel.value - 2) * 0.4);
  const aboutSomeone = !["none", "self", "player"].includes(subject) && s.people[subject] && !s.people[subject].gone;
  let believes = null;
  let rid = null;
  if (intent === "tell_news" && aboutSomeone) {
    rid = newRumor(s, { about: subject, text: line, origin: "player", isTrue: null, harm: j.harm.value - 2 });
    s.player.claims.push({ rid, to: v.id, day: s.day, time: clock(s.minute) });
    believes = j.believe.yes && !j.caught_lie.yes;
    learn(s, v, rid, believes ? 0.45 + j.believe.p * 0.5 : j.believe.p * 0.25, "player");
    r.trust = clamp(r.trust + (believes ? 0.15 : -0.1));
    // the story gets passed on as a sentence that stands on its own, not the player's exact words
    const r0 = s.rumors[rid];
    llm.asStory({ line, aboutName: s.people[subject].name, history: conv.lines }).then((text) => { if (text && text !== "...") r0.text = text; });
  }
  const caughtLie = j.caught_lie.yes && (!!rid || intent === "about_self");
  if (caughtLie) {
    r.trust = clamp(r.trust - 1.2); r.affinity = clamp(r.affinity - 0.6);
    const lid = newRumor(s, { about: "player", text: `The newcomer lied to ${first(v)}'s face.`, origin: v.id, isTrue: true, harm: -1.5 });
    learn(s, v, lid, 1, "self");
    remember(v, s, "caught the newcomer in a lie");
  }
  if (intent === "insult" || intent === "threat") { v.mood.anger += 1; r.affinity = clamp(r.affinity - 0.5); }
  if (intent === "threat") { v.mood.fear += 1; }

  // deals with the newcomer
  const promise = (s.player.promises[v.id] ||= { ally: false, voteFor: null, saysTarget: null, day: s.day });
  let dealText = null;
  const deal = j.deal.pick;
  if (intent === "propose_alliance" && deal !== "not_asked") {
    if (deal === "refuse") dealText = "You turn down the newcomer's offer to team up.";
    else {
      (v.allies ||= {}).player = { real: deal === "agree", day: s.day };
      promise.ally = true; promise.day = s.day;
      remember(v, s, `agreed to team up with the newcomer${deal === "pretend" ? " (I don't mean it)" : ""}`);
      dealText = "You agree to team up with the newcomer for the vote." + (deal === "pretend" ? " You do not mean it, but she must not be able to tell." : "");
    }
  }
  if (intent === "ask_vote" && aboutSomeone && deal !== "not_asked") {
    if (deal === "refuse") dealText = `You refuse to vote out ${s.people[subject].name}.`;
    else {
      promise.voteFor = subject; promise.day = s.day;
      if (deal === "agree") v.target = subject;
      remember(v, s, `told the newcomer I'd vote out ${first(s.people[subject])}${deal === "pretend" ? " (I won't)" : ""}`);
      dealText = `You agree to vote out ${s.people[subject].name}.` + (deal === "pretend" ? " You have no intention of doing it, but you sound convincing." : "");
    }
  }
  let revealText = null;
  if (j.reveal.pick !== "not_asked" && (intent === "ask_info" || intent === "question")) {
    if (j.reveal.pick === "truth") { promise.saysTarget = v.target; revealText = v.target ? `If it comes up, you admit you want ${nameOf(s, v.target)} out.` : "If it comes up, you admit you haven't decided who you want out."; }
    else if (j.reveal.pick === "lie") { promise.saysTarget = j.decoy.pick; revealText = `If it comes up, you claim you want ${nameOf(s, j.decoy.pick)} out (not true).`; }
    else revealText = "If it comes up, you won't say who you want out.";
  }
  // gossip she hands over
  const shared = j.share.pick !== "none" ? s.rumors[j.share.pick] : null;
  if (shared) { playerLearns(s, shared.id, v.id, "told", ui); remember(v, s, `told the newcomer: ${shared.text}`); }

  // what she decided to do becomes a plan she carries out
  let act = j.act.pick;
  const kind = { ask_subject: "ask", warn_subject: "warn", confront_subject: "confront", tell_others: "spread" }[act];
  const story = kind ? rid || newRumor(s, { about: aboutSomeone ? subject : subject === "player" ? "player" : null, text: line, origin: "player", isTrue: null, harm: 0 }) : null;
  if (kind && kind !== "spread" && !aboutSomeone) act = "nothing";
  else if (kind) setPlan(s, v, { kind, target: kind === "spread" ? null : subject, rumor: story, why: "of what the newcomer said", promisedTo: "player", now: j.now.yes });
  if (act === "target_subject" && aboutSomeone) { v.target = subject; remember(v, s, `want ${first(s.people[subject])} voted out after what the newcomer told me`); }
  if (act === "target_newcomer") { v.target = "player"; remember(v, s, "decided the newcomer has to go"); }
  const leaving = act === "end_conversation" || (!!kind && act !== "nothing" && j.now.yes);
  remember(v, s, `the newcomer said: ${line}`);

  const STANCE_MOOD = { warm: "happy", sweet_fake: "smug", guarded: "suspicious", curious: "curious", dismissive: "smug", hostile: "angry" };
  const reply = await llm.villagerReply({
    v, history: conv.lines, line, stance: j.stance.pick, believes, caughtLie,
    plan: act === "end_conversation" ? "end this conversation now" : kind && act !== "nothing" ? planText(s, v.intent) + (leaving ? ", and you leave right now to do it" : ", later") : null,
    otherPlan: !kind && v.intent ? planText(s, v.intent) : null,
    deal: dealText, reveal: revealText, gossip: shared?.text,
    knownAboutPlayer: `${feel(r.affinity)}, ${trust(r.trust)}`, mood: MOODS(v.mood),
  });
  conv.lines.push(`Newcomer: ${line}`, `${first(v)}: ${reply}`);
  remember(v, s, `I said to the newcomer: ${reply}`);
  if (leaving) s.player.talkingTo = null;
  if (deal === "agree" || deal === "pretend") ui.emote?.(v.id, "handshake");
  if (caughtLie) ui.emote?.(v.id, "angry");
  return { reply, leaving, mood: caughtLie ? "angry" : STANCE_MOOD[j.stance.pick], debug: { intent, subject: nameOf(s, subject), believes, caughtLie, stance: j.stance.pick, deal, reveal: j.reveal.pick, shared: shared?.text, act, now: j.now.yes, plan: v.intent ? planText(s, v.intent) : null, trust: r.trust.toFixed(1), affinity: r.affinity.toFixed(1) } };
}

// ---------- night: scheming ----------

export async function endOfDay(s, ui) {
  const lines = [];
  const candidates = (v) => alive(s).filter((o) => o.id !== v.id).concat(s.player.gone ? [] : ["player"]);
  await Promise.all(alive(s).map(async (v) => {
    const cands = candidates(v);
    const j = await jev.ask({
      ...persona(s, v),
      day_summary: v.memory.slice(-10),
      feelings: cands.map((o) => feelings(s, v, o === "player" ? "player" : o)),
    }, {
      target: { type: "choice", instructions: `Lying awake tonight, ${first(v)} plots. Who does she most want voted out at the next vote? Think like a reality-show player: threats, enemies, liars, anyone coming for her.`, criteria: Object.fromEntries(cands.map((o) => [o === "player" ? "player" : o.id, o === "player" ? "The newcomer" : o.name])) },
    }, `night:${v.id}`);
    const t = j.target.pick;
    if (t !== v.target) { v.target = t; remember(v, s, `decided tonight that ${nameOf(s, t)} has to go`); }
  }));
  return lines;
}

// ---------- the vote ----------

// Every woman still in town casts a vote. Jev decides each one.
export async function castVotes(s) {
  const voters = alive(s);
  const ballots = await Promise.all(voters.map(async (v) => {
    const cands = alive(s).filter((o) => o.id !== v.id).map((o) => o.id).concat(s.player.gone ? [] : ["player"]);
    const promisesToMe = Object.values(s.people).filter((o) => o.id !== v.id && !o.gone && o.allies?.[v.id]).map((o) => `${o.name} agreed to team up with her`);
    const j = await jev.ask({
      ...persona(s, v),
      deals: dealsOf(s, v),
      others_deals_with_her: promisesToMe,
      what_she_told_the_newcomer: s.player.promises[v.id] ? `${s.player.promises[v.id].ally ? "said she'd team up with the newcomer. " : ""}${s.player.promises[v.id].voteFor ? `said she'd vote out ${nameOf(s, s.player.promises[v.id].voteFor)}.` : ""}` : "nothing",
      feelings: cands.map((o) => feelings(s, v, o === "player" ? "player" : s.people[o])),
    }, {
      vote: { type: "choice", instructions: `It is the vote. ${first(v)} writes one name. Who does she vote to send home? She plays to win: she may keep her word or break it, protect her allies or betray them, and settle scores.`, criteria: Object.fromEntries(cands.map((o) => [o, nameOf(s, o)])) },
    }, `vote:${v.id}`);
    return { voter: v.id, target: j.vote.pick };
  }));
  return ballots;
}

// Count the ballots. A tie goes to the host, who asks Jev what the town wants.
export async function tally(s, ballots) {
  const count = {};
  for (const b of ballots) count[b.target] = (count[b.target] || 0) + 1;
  const top = Math.max(...Object.values(count));
  const tied = Object.keys(count).filter((k) => count[k] === top);
  let out = tied[0];
  if (tied.length > 1) {
    const avg = (id) => alive(s).filter((v) => v.id !== id).reduce((t, v) => t + s.rel[v.id][id === "player" ? "player" : id].affinity, 0);
    const j = await jev.ask({ tied: tied.map((id) => `${nameOf(s, id)}: the town's total warmth toward her is ${avg(id).toFixed(1)}`) }, {
      out: { type: "choice", instructions: "The vote is tied. The host breaks the tie by sending home the one the town likes least.", criteria: Object.fromEntries(tied.map((id) => [id, nameOf(s, id)])) },
    }, "vote:tie");
    out = j.out.pick;
  }
  return { count, out, tie: tied.length > 1 };
}

export function eliminate(s, id) {
  if (id === "player") { s.player.gone = true; return; }
  const v = s.people[id];
  v.gone = true; v.location = "gone";
  for (const o of alive(s)) {
    remember(o, s, `${v.name} was voted out of town`);
    if (o.target === id) o.target = null;
    if (o.intent?.target === id) o.intent = null;
    if (o.allies) delete o.allies[id];
  }
}

// ---------- what the player can see ----------

// Everything the rumor tracker shows: rumors you learned, what you told people and
// how far it went, what each woman has told you, and past votes.
export function tracker(s) {
  const knowers = (rid) => {
    const ids = new Set([rid, ...Object.values(s.rumors).filter((r) => r.parent === rid).map((r) => r.id)]);
    const list = [];
    for (const v of Object.values(s.people)) for (const id of ids) {
      const k = v.knows[id];
      if (k && k.conf >= 0.3 && k.from !== "self") { list.push({ id: v.id, from: k.from, believes: k.conf >= 0.5, twisted: id !== rid, gone: v.gone }); break; }
    }
    return list;
  };
  const learned = Object.entries(s.player.knows).map(([rid, k]) => ({ rid, text: s.rumors[rid].text, about: s.rumors[rid].about, from: k.from, how: k.how, day: k.day, time: k.time }));
  const told = s.player.claims.map((c) => ({ ...c, text: s.rumors[c.rid].text, about: s.rumors[c.rid].about, spread: knowers(c.rid), versions: Object.values(s.rumors).filter((r) => r.parent === c.rid).map((r) => r.text) }));
  const aboutYou = Object.values(s.rumors).filter((r) => r.about === "player").map((r) => ({ text: r.text, known: knowers(r.id).length + Object.values(s.people).filter((v) => v.knows[r.id]?.from === "self").length }));
  const cast = Object.values(s.people).map((v) => {
    const r = s.rel[v.id].player;
    const vibe = r.affinity >= 1.2 ? "warm" : r.affinity >= 0.3 ? "friendly" : r.affinity > -0.5 ? "unsure" : r.affinity > -1.5 ? "cold" : "hostile";
    const p = s.player.promises[v.id] || {};
    return { id: v.id, name: v.name, job: v.job, gone: v.gone, vibe, ally: !!p.ally, voteFor: p.voteFor || null, saysTarget: p.saysTarget || null };
  });
  return { learned, told, aboutYou, cast, votes: s.votes, journal: s.player.journal.slice(-30), day: s.day, nextVote: voteDay(s.day) };
}
