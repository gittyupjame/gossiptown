// The living town. Every decision a villager makes goes through Jev; code keeps
// the numbers, applies the results, and remembers everything.

import * as jev from "./jev.js";
import * as llm from "./llm.js";
import { PLACES } from "./world.js";

// ---------- small helpers ----------

export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const first = (v) => v.name.replace(/^Elder /, "").split(" ")[0];
const clamp = (x, lo = -3, hi = 3) => Math.max(lo, Math.min(hi, x));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

export const alive = (s) => Object.values(s.people).filter((v) => !v.gone);
export const at = (s, place) => alive(s).filter((v) => v.location === place);
export function nameOf(s, id) { return id === "player" ? "the newcomer" : s.people[id] ? s.people[id].name : id; }

export function findPerson(s, text) {
  const t = text.toLowerCase().trim();
  return alive(s).find((v) => v.id === t || v.name.toLowerCase().includes(t) || first(v).toLowerCase() === t) || null;
}

const FEEL = ["hates", "dislikes", "is cool toward", "is neutral about", "likes", "is fond of", "adores"];
const TRUST = ["completely distrusts", "distrusts", "doubts", "is unsure about", "mostly trusts", "trusts", "trusts completely"];
const feel = (x) => FEEL[Math.round(clamp(x) + 3)];
const trust = (x) => TRUST[Math.round(clamp(x) + 3)];
const MOODS = (m) => [m.anger >= 2 ? "angry" : m.anger >= 1 ? "irritated" : null, m.fear >= 2 ? "frightened" : m.fear >= 1 ? "uneasy" : null, m.cheer >= 2 ? "cheerful" : m.cheer <= 0 ? "glum" : null].filter(Boolean).join(", ") || "calm";

function remember(v, s, text) {
  v.memory.push(`${clock(s.minute)} ${text}`);
  if (v.memory.length > 14) v.memory.splice(0, v.memory.length - 14);
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
  if (r.about && r.about !== v.id && v.id !== "player" && (!had || conf > had.conf)) {
    const delta = (r.harm / 2) * (conf - (had?.conf || 0));
    const rel = s.rel[v.id][r.about];
    if (rel) { rel.affinity = clamp(rel.affinity + delta); rel.trust = clamp(rel.trust + delta * 0.6); }
  }
}

// What a villager knows, as short lines for a Jev state.
function knowledge(s, v, max = 6) {
  return Object.entries(v.knows)
    .filter(([, k]) => k.conf >= 0.3)
    .sort((p, q) => q[1].conf - p[1].conf)
    .slice(0, max)
    .map(([id, k]) => `${s.rumors[id].text} (${k.conf >= 0.8 ? "sure" : k.conf >= 0.5 ? "believes" : "half-believes"}; heard from ${k.from === "self" ? "own knowledge" : nameOf(s, k.from)})`);
}

function persona(s, v) {
  return {
    who: `${v.name}, the ${v.employed ? v.job : `out-of-work ${v.job}`}`,
    personality: v.traits.join(", "),
    mood: MOODS(v.mood),
    where: PLACES[v.location]?.name || "home",
    time: `day ${s.day}, ${clock(s.minute)}`,
    knows: knowledge(s, v),
    recent: v.memory.slice(-6),
  };
}

function feelings(s, a, b) {
  const r = s.rel[a.id][b === "player" ? "player" : b.id];
  const name = b === "player" ? "the newcomer" : b.name;
  return `${first(a)} ${feel(r.affinity)} ${name} and ${trust(r.trust)} them (${r.note})`;
}

// ---------- the world tick (every 15 game minutes) ----------

function routineAt(v, hour) {
  let place = "home";
  for (const h of Object.keys(v.schedule).map(Number).sort((p, q) => p - q)) if (h <= hour) place = v.schedule[h];
  return place;
}

export async function tick(s, ui) {
  await deliverNotes(s, ui);
  const hour = Math.floor(s.minute / 60);
  await Promise.all(alive(s).map((v) => move(s, v, hour, ui)));

  // encounters: up to two pairs per place
  const jobs = [];
  for (const place of Object.keys(PLACES)) {
    const here = shuffle(at(s, place));
    for (let i = 0; i + 1 < here.length && i < 4; i += 2) jobs.push(encounter(s, here[i], here[i + 1], place, ui));
  }
  await Promise.all(jobs);

  // a villager with business with the newcomer walks up
  for (const v of at(s, s.player.location)) {
    if (v.intent?.target === "player" && v.intent.kind === "confront") { v.intent = null; await approachPlayer(s, v, ui); }
  }
  s.player.listening = false;
}

async function move(s, v, hour, ui) {
  const routine = routineAt(v, hour);
  const criteria = { routine: `Stick to the usual routine: be at ${routine === "home" ? "home" : PLACES[routine].name}` };
  const prior = { routine: 15 };
  for (const [k, p] of Object.entries(PLACES)) if (k !== routine) { criteria[k] = `Go to ${p.name} instead`; prior[k] = 0.3; }
  criteria.home = "Go home and stay out of sight"; prior.home = routine === "home" ? 8 : 0.2 + v.mood.fear * 0.8;
  const it = v.intent;
  if (it && it.target && it.target !== "player" && s.people[it.target] && !s.people[it.target].gone) {
    const t = s.people[it.target];
    criteria.seek = `Go find ${t.name} (to ${it.kind === "report" ? "report something" : it.kind === "spread" ? "tell them some news" : "have it out with them"})`;
    prior.seek = 3 + v.mood.anger;
  }
  if (it?.target === "player") { criteria.seek = "Go find the newcomer"; prior.seek = 2; }
  if (v.mood.anger >= 2) prior.tavern = (prior.tavern || 0.3) + 1.5;
  const a = await jev.ask({ ...persona(s, v), intentions: it ? `${it.kind} ${nameOf(s, it.target)}` : "none" },
    { go: { type: "choice", instructions: `Where does ${first(v)} go for the next quarter hour?`, criteria, prior } }, `move:${v.id}`);
  let dest = a.go.pick;
  if (dest === "routine") dest = routine;
  if (dest === "seek") dest = it.target === "player" ? s.player.location : s.people[it.target].location;
  if (!PLACES[dest] && dest !== "home") dest = routine;
  if (dest !== v.location) {
    if (s.player.location === v.location && dest !== "home") ui.say(`${v.name} heads off toward ${PLACES[dest].name}.`);
    else if (s.player.location === v.location) ui.say(`${v.name} heads home.`);
    if (s.player.location === dest) ui.say(`${v.name} arrives.`);
    if (s.player.following === v.id && dest !== "home") { s.player.location = dest; ui.say(`You follow ${first(v)} to ${PLACES[dest].name}.`); }
    v.location = dest;
  }
  // moods drift back toward calm
  v.mood.anger = Math.max(0, v.mood.anger - 0.15);
  v.mood.fear = Math.max(0, v.mood.fear - 0.1);
  v.mood.cheer += (1 - v.mood.cheer) * 0.1;
}

const WARMTH = ["much colder toward each other", "a bit colder", "about the same", "a bit warmer", "much warmer toward each other"];

async function encounter(s, a, b, place, ui) {
  if (b.intent?.target === a.id && a.intent?.target !== b.id) [a, b] = [b, a];
  const rAB = s.rel[a.id][b.id], rBA = s.rel[b.id][a.id];
  const playerHere = s.player.location === place;
  const shareable = Object.entries(a.knows).filter(([, k]) => k.conf >= 0.4).map(([id]) => s.rumors[id]).filter((r) => r.about !== a.id || Math.random() < 0.15).slice(-6);
  const rumorCriteria = { none: "Nothing in particular" };
  const rumorPrior = { none: 2 };
  for (const r of shareable) {
    rumorCriteria[r.id] = `${r.text} (about ${nameOf(s, r.about)})`;
    rumorPrior[r.id] = 1 + (a.traits.some((t) => /gossip|nosy|chatty/.test(t)) ? 1.5 : 0) + (a.intent?.rumor === r.id ? 3 : 0);
  }
  const grudge = a.intent?.kind === "confront" && a.intent.target === b.id;
  const state = {
    a: persona(s, a), b: persona(s, b),
    between_them: [feelings(s, a, b), feelings(s, b, a)],
    newcomer: playerHere ? (s.player.listening ? "standing close, clearly listening" : "nearby") : "not here",
    a_wants: grudge ? `${first(a)} came to have it out with ${first(b)}` : a.intent ? `${a.intent.kind} ${nameOf(s, a.intent.target)}` : "nothing special",
  };
  const qs = {
    talk: { type: "noul", instructions: `${first(a)} and ${first(b)} stop to talk with each other.`, prior: grudge ? 0.95 : 0.45 + rAB.affinity * 0.08 },
    topic: {
      type: "choice", instructions: `What does ${first(a)} bring up?`,
      criteria: { small_talk: "Weather, work, small talk", share_rumor: "Passes on a piece of gossip", argue: `Picks an argument with ${first(b)}`, complain: "Complains about someone else", make_up: `Tries to patch things up with ${first(b)}` },
      prior: { small_talk: 2, share_rumor: shareable.length ? 1.5 : 0.05, argue: grudge ? 6 : Math.max(0.05, -rAB.affinity * 0.6 + a.mood.anger * 0.8), complain: 0.6, make_up: rAB.affinity < 0 ? 0.4 : 0.05 },
    },
    rumor: { type: "choice", instructions: `If ${first(a)} passes on gossip, which piece?`, criteria: rumorCriteria, prior: rumorPrior },
    warmth: { type: "score", instructions: `After this talk, how do ${first(a)} and ${first(b)} feel about each other?`, criteria: WARMTH, prior: 2 + rAB.affinity * 0.2 },
    escalate: { type: "noul", instructions: `If they argue, it turns into a shoving fight.`, prior: Math.min(0.9, 0.05 + (a.mood.anger + b.mood.anger) * 0.12 + (rAB.affinity < -1 ? 0.15 : 0)) },
  };
  if (playerHere && s.player.listening) qs.notice = { type: "noul", instructions: "They notice the newcomer eavesdropping on them.", prior: 0.35 };
  const j = await jev.ask(state, qs, `meet:${a.id}+${b.id}`);
  if (!j.talk.yes) return;

  let topic = j.topic.pick;
  let rumor = topic === "share_rumor" && j.rumor.pick !== "none" ? s.rumors[j.rumor.pick] : null;
  if (topic === "share_rumor" && !rumor) topic = "small_talk";
  if (grudge) a.intent = null;
  let outcome = WARMTH[Math.round(j.warmth.value)];
  const dw = (j.warmth.value - 2) * 0.35;
  rAB.affinity = clamp(rAB.affinity + dw); rBA.affinity = clamp(rBA.affinity + dw);

  if (rumor) {
    if (a.intent?.rumor === rumor.id) a.intent = null;
    const aboutB = rumor.about === b.id;
    const r2 = await jev.ask({ listener: persona(s, b), teller: feelings(s, b, a), gossip: rumor.text, about: aboutB ? `${first(b)} themself` : feelings(s, b, rumor.about === "player" ? "player" : s.people[rumor.about] || "player") },
      {
        believe: { type: "noul", instructions: `${first(b)} believes this gossip.`, prior: 0.35 + rBA.trust * 0.1 },
        react: { type: "choice", instructions: `What does ${first(b)} do about it?`,
          criteria: { nothing: "Files it away", spread: "Will pass it on to someone else", confront: `Goes to confront ${nameOf(s, rumor.about)}`, report: "Takes it to Elder Hesper", deny_angrily: "Angrily denies it (only if it is about them)" },
          prior: { nothing: 2, spread: b.traits.some((t) => /gossip|nosy|chatty/.test(t)) ? 2.5 : 0.8, confront: aboutB ? 0.05 : 0.4, report: 0.3, deny_angrily: aboutB ? 4 : 0.01 } },
        embellish: { type: "noul", instructions: `${first(a)} exaggerates the story while telling it.`, prior: 0.25 },
      }, `rumor:${rumor.id}->${b.id}`);
    let rid = rumor.id;
    if (r2.embellish.yes) {
      // gossip mutates as it travels
      const text = await llm.retell({ teller: a, rumorText: rumor.text });
      if (text && text !== "...") rid = newRumor(s, { about: rumor.about, text, origin: a.id, isTrue: rumor.isTrue, harm: clamp(rumor.harm * 1.3, -2, 2), parent: rumor.id });
      rumor = s.rumors[rid];
    }
    if (aboutB) {
      b.mood.anger += 1.5; rBA.affinity = clamp(rBA.affinity - 1); rBA.trust = clamp(rBA.trust - 0.5);
      outcome = `${first(b)} is upset to hear what people are saying about them`;
      b.intent = { kind: "confront", target: rumor.origin !== "truth" && rumor.origin !== b.id && s.people[rumor.origin] ? rumor.origin : a.id };
    } else {
      learn(s, b, rid, r2.believe.yes ? 0.5 + r2.believe.p * 0.5 : r2.believe.p * 0.3, a.id);
      const rk = r2.react.pick;
      if (r2.believe.yes && rk !== "nothing" && rk !== "deny_angrily") b.intent = { kind: rk, target: rk === "spread" ? null : rk === "report" ? "hesper" : rumor.about, rumor: rid };
      if (b.intent?.kind === "spread") b.intent.target = null;
      if (b.intent?.target === b.id) b.intent = null;
    }
    remember(a, s, `told ${first(b)}: ${rumor.text}`);
    remember(b, s, `${first(a)} told me: ${rumor.text}`);
  } else {
    remember(a, s, `${topic.replace("_", " ")} with ${first(b)} at ${PLACES[place].name}`);
    remember(b, s, `${topic.replace("_", " ")} with ${first(a)} at ${PLACES[place].name}`);
  }

  let fight = false;
  if (topic === "argue" || (rumor && rumor.about === b.id)) {
    a.mood.anger += 1; b.mood.anger += 1;
    if (j.escalate.yes) fight = true;
  }

  if (playerHere) {
    const topicText = { small_talk: "small talk", share_rumor: "gossip", argue: `an argument; ${first(a)} is picking a fight`, complain: `${first(a)} complains about someone`, make_up: "trying to make up after bad feelings" }[topic];
    s.player.seen[`${a.id}|${b.id}`] = outcome;
    const listening = s.player.listening;
    const noticed = j.notice?.yes;
    llm.overheard({ a, b, topic: topicText, rumorText: rumor?.text, aboutName: rumor ? nameOf(s, rumor.about) : null, outcome: fight ? "it turns into a shoving match" : outcome })
      .then((text) => {
        ui.say(`\n[${first(a)} and ${first(b)}, ${listening ? "you listen in" : "you catch part of it"}]`);
        ui.say(listening ? text : muffle(text));
        if (rumor) s.player.journal.push(`Day ${s.day} ${clock(s.minute)}: overheard ${first(a)} tell ${first(b)} that ${rumor.text}`);
      });
    if (noticed) {
      ui.say(`${first(a)} and ${first(b)} notice you hovering and give you a hard look.`);
      for (const v of [a, b]) { s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - 0.5); remember(v, s, "caught the newcomer eavesdropping"); }
      const rid = newRumor(s, { about: "player", text: `The newcomer was caught eavesdropping on ${first(a)} and ${first(b)}.`, origin: a.id, isTrue: true, harm: -1 });
      learn(s, a, rid, 1, "self"); learn(s, b, rid, 1, "self");
    }
  }

  if (fight) await brawl(s, a, b, place, ui);
}

async function brawl(s, a, b, place, ui) {
  s.rel[a.id][b.id].affinity = clamp(s.rel[a.id][b.id].affinity - 1.5);
  s.rel[b.id][a.id].affinity = clamp(s.rel[b.id][a.id].affinity - 1.5);
  s.rel[a.id][b.id].note = s.rel[b.id][a.id].note = `fought on day ${s.day}`;
  a.mood.anger = Math.min(3, a.mood.anger + 1); b.mood.anger = Math.min(3, b.mood.anger + 1);
  const text = `${a.name} and ${b.name} get into a shoving fight at ${PLACES[place].name}!`;
  const witnesses = event(s, place, text, ui);
  const rid = newRumor(s, { about: a.id, text: `${a.name} and ${b.name} came to blows at ${PLACES[place].name} on day ${s.day}.`, origin: "truth", isTrue: true, harm: -1 });
  for (const w of witnesses) learn(s, s.people[w], rid, 1, "self");
  if (s.player.location === place) s.player.journal.push(`Day ${s.day} ${clock(s.minute)}: saw ${first(a)} and ${first(b)} fight`);
  remember(a, s, `fought ${first(b)}`); remember(b, s, `fought ${first(a)}`);
  s.fights = (s.fights || 0) + 1;
}

// A villager comes to the newcomer with a grievance.
async function approachPlayer(s, v, ui) {
  const r = s.rel[v.id].player;
  const why = v.memory.filter((m) => /newcomer/.test(m)).slice(-3).join("; ") || "something they heard";
  const line = await llm.ask(`You are ${v.name}, the ${v.job} (${v.traits.join(", ")}; speaks: ${v.voice}). You ${feel(r.affinity)} the newcomer and ${trust(r.trust)} them.
You walk up to the newcomer to confront them about: ${why}. Say it in 1 to 2 short sentences.`);
  ui.say(`\n${v.name} walks straight up to you: ${line}`);
  remember(v, s, "confronted the newcomer");
}

function muffle(text) {
  return text.split("\n").map((line) => {
    const [who, ...rest] = line.split(":");
    if (!rest.length) return line;
    const words = rest.join(":").trim().split(/\s+/);
    const kept = words.map((w) => (Math.random() < 0.55 ? w : "…")).join(" ").replace(/(… )+…/g, "…");
    return `${who}: ${kept}`;
  }).join("\n");
}

// ---------- the player talks ----------

const INTENTS = {
  small_talk: "Small talk, greetings, pleasantries",
  question: "Asks a question or asks about someone",
  tell_news: "Claims something about another person (news, gossip, accusation)",
  compliment: "Compliments or flatters the listener",
  insult: "Insults or mocks the listener",
  request: "Asks the listener to do something",
  threat: "Threatens the listener",
  apology: "Apologizes",
  about_self: "Talks about themself",
};
const SHIFT = ["much worse", "worse", "about the same", "better", "much better"];

export async function playerSays(s, v, line, ui) {
  const conv = (s.player.convo ||= { with: v.id, lines: [] });
  if (conv.with !== v.id) { conv.with = v.id; conv.lines = []; }
  const subjects = { none: "Nobody in particular", self: `${first(v)} themself`, player: "The newcomer (the speaker)" };
  for (const o of alive(s)) if (o.id !== v.id) subjects[o.id] = o.name;
  const r = s.rel[v.id].player;
  const aboutPlayer = Object.entries(v.knows).filter(([id, k]) => s.rumors[id].about === "player" && k.conf >= 0.3).map(([id]) => s.rumors[id].text);
  const mentions = alive(s).some((o) => o.id !== v.id && line.toLowerCase().includes(first(o).toLowerCase()));
  const state = {
    listener: persona(s, v),
    listener_on_newcomer: `${feel(r.affinity)} the newcomer and ${trust(r.trust)} them. Heard about the newcomer: ${aboutPlayer.join(" | ") || "nothing"}`,
    listener_feelings: alive(s).filter((o) => o.id !== v.id).map((o) => feelings(s, v, o)),
    conversation: conv.lines.slice(-6),
    newcomer_says: line,
  };
  const j = await jev.ask(state, {
    intent: { type: "choice", instructions: "What is the newcomer doing with this line?", criteria: INTENTS, prior: { small_talk: 2, question: 1.5, tell_news: /\b(saw|seen|heard|told|said|says|stole|steal|stealing|pocket\w*|cheat\w*|crooked|lie[sd]?|lying|owes?|secret|hates?|plans?)\b/i.test(line) ? (mentions ? 12 : 4) : 0.3, compliment: 0.5, insult: 0.3, request: 0.5, threat: 0.1, apology: 0.2, about_self: 0.5 } },
    subject: { type: "choice", instructions: "Who is the line mainly about?", criteria: subjects, prior: Object.fromEntries(Object.keys(subjects).map((k) => [k, k !== "none" && k !== "self" && k !== "player" && line.toLowerCase().includes(first(s.people[k]).toLowerCase()) ? 6 : k === "none" ? 1 : 0.2])) },
    harm: { type: "score", instructions: "If this is a claim about someone, how does it make them look?", criteria: ["Very damaging", "Somewhat damaging", "Neutral", "Somewhat flattering", "Very flattering"], prior: 2 },
    plausible: { type: "score", instructions: `How plausible does this sound to ${first(v)}, given what they know?`, criteria: ["Absurd", "Doubtful", "Plausible", "Very believable"], prior: 1.5 },
    believe: { type: "noul", instructions: `${first(v)} believes what the newcomer is claiming.`, prior: 0.35 + r.trust * 0.1 },
    caught_lie: { type: "noul", instructions: `${first(v)} knows, or is nearly sure from what they already know, that the newcomer is lying.`, prior: 0.1 },
    feel: { type: "score", instructions: `After this line, how does ${first(v)} feel about the newcomer?`, criteria: SHIFT, prior: 2 },
    stance: { type: "choice", instructions: `How does ${first(v)} respond?`, criteria: { warm: "Warmly", polite: "Politely", guarded: "Guarded, careful", curious: "Curious, wants more", dismissive: "Dismissive", hostile: "Hostile" }, prior: { warm: 0.5 + r.affinity * 0.3, polite: 2, guarded: 1.2 - r.trust * 0.3, curious: 1, dismissive: 0.4, hostile: 0.1 } },
    act: { type: "choice", instructions: `What does ${first(v)} decide to do after hearing this?`, criteria: { nothing: "Nothing for now", tell_others: "Pass it on to others", confront_subject: "Go confront the person it is about", avoid_subject: "Avoid the person it is about", report_to_elder: "Take it to Elder Hesper", end_conversation: "End this conversation" }, prior: { nothing: 4, tell_others: v.traits.some((t) => /gossip|nosy|chatty/.test(t)) ? 1.5 : 0.4, confront_subject: 0.3, avoid_subject: 0.3, report_to_elder: 0.2, end_conversation: 0.3 } },
  }, `talk:${v.id}`);

  const intent = j.intent.pick, subject = j.subject.pick;
  r.affinity = clamp(r.affinity + (j.feel.value - 2) * 0.4);
  let believes = null;
  let rid = null;
  const isClaim = intent === "tell_news" && !["none", "self", "player"].includes(subject);
  if (isClaim) {
    const harm = j.harm.value - 2;
    rid = newRumor(s, { about: subject, text: line, origin: "player", isTrue: null, harm });
    s.player.claims = s.player.claims || [];
    s.player.claims.push({ rid, to: v.id, day: s.day, time: clock(s.minute) });
    believes = j.believe.yes && !j.caught_lie.yes;
    learn(s, v, rid, believes ? 0.45 + j.believe.p * 0.5 : j.believe.p * 0.25, "player");
    r.trust = clamp(r.trust + (believes ? 0.15 : -0.1));
  }
  if (j.caught_lie.yes && (isClaim || intent === "about_self")) {
    r.trust = clamp(r.trust - 1.2); r.affinity = clamp(r.affinity - 0.6);
    const lid = newRumor(s, { about: "player", text: `The newcomer lied to ${first(v)}'s face.`, origin: v.id, isTrue: true, harm: -1.5 });
    learn(s, v, lid, 1, "self");
    v.intent = { kind: "spread", target: null, rumor: lid };
    remember(v, s, "caught the newcomer in a lie");
  }
  if (intent === "insult" || intent === "threat") { v.mood.anger += 1; r.affinity = clamp(r.affinity - 0.5); }
  if (intent === "threat") { v.mood.fear += 1; }

  const act = j.act.pick;
  if (believes && rid) {
    if (act === "tell_others") v.intent = { kind: "spread", target: null, rumor: rid };
    if (act === "confront_subject") v.intent = { kind: "confront", target: subject, rumor: rid };
    if (act === "report_to_elder" && v.id !== "hesper") v.intent = { kind: "report", target: "hesper", rumor: rid };
    if (act === "avoid_subject") { s.rel[v.id][subject].affinity = clamp(s.rel[v.id][subject].affinity - 0.5); }
  }
  remember(v, s, `the newcomer said: ${line}`);

  const reply = await llm.villagerReply({
    v, history: conv.lines, line, stance: j.stance.pick, believes, caughtLie: j.caught_lie.yes && (isClaim || intent === "about_self"),
    act, knownAboutPlayer: `${feel(r.affinity)}, ${trust(r.trust)}`, mood: MOODS(v.mood),
  });
  conv.lines.push(`Newcomer: ${line}`, `${first(v)}: ${reply}`);
  if (act === "end_conversation") s.player.talkingTo = null;
  return { reply, debug: { intent, subject: nameOf(s, subject), believes, caughtLie: j.caught_lie.yes, stance: j.stance.pick, act, trust: r.trust.toFixed(1), affinity: r.affinity.toFixed(1) } };
}

// ---------- other things the player can do ----------

export async function give(s, v, item) {
  const j = await jev.ask({ receiver: persona(s, v), on_newcomer: feelings(s, v, "player"), gift: item },
    { pleased: { type: "score", instructions: `How does ${first(v)} take the gift?`, criteria: ["Offended", "Unmoved", "Pleased", "Delighted"], prior: 1.8 },
      suspicious: { type: "noul", instructions: `${first(v)} suspects the gift is a bribe or a trick.`, prior: 0.2 } }, `gift:${v.id}`);
  const r = s.rel[v.id].player;
  r.affinity = clamp(r.affinity + (j.pleased.value - 1) * 0.5);
  if (j.suspicious.yes) r.trust = clamp(r.trust - 0.4);
  remember(v, s, `the newcomer gave me ${item}`);
  return `${first(v)} looks ${j.pleased.level.toLowerCase()}${j.suspicious.yes ? ", and a little suspicious" : ""}.`;
}

export function leaveNote(s, v, text) {
  (s.notes ||= []).push({ to: v.id, text, day: s.day, time: clock(s.minute), place: v.location });
}

export async function deliverNotes(s, ui) {
  const notes = s.notes || [];
  s.notes = [];
  for (const n of notes) {
    const v = s.people[n.to];
    if (!v || v.gone) continue;
    const subjects = { none: "Nobody in particular" };
    for (const o of alive(s)) if (o.id !== v.id) subjects[o.id] = o.name;
    const j = await jev.ask({ reader: persona(s, v), note: n.text, signed: "unsigned, left where they would find it" }, {
      subject: { type: "choice", instructions: "Who is the note about?", criteria: subjects, prior: Object.fromEntries(Object.keys(subjects).map((k) => [k, k !== "none" && n.text.toLowerCase().includes(first(s.people[k]).toLowerCase()) ? 6 : 0.3])) },
      harm: { type: "score", instructions: "How does the note make that person look?", criteria: ["Very damaging", "Somewhat damaging", "Neutral", "Somewhat flattering", "Very flattering"], prior: 1 },
      believe: { type: "noul", instructions: `${first(v)} believes the anonymous note.`, prior: 0.3 },
      suspect_newcomer: { type: "noul", instructions: `${first(v)} suspects the newcomer wrote it.`, prior: 0.3 },
      react: { type: "choice", instructions: `What does ${first(v)} do?`, criteria: { nothing: "Throws it away", spread: "Tells others about it", confront: "Confronts the person it is about", report: "Takes it to Elder Hesper" }, prior: { nothing: 2, spread: 1, confront: 0.6, report: 0.6 } },
    }, `note:${v.id}`);
    remember(v, s, `found an unsigned note: ${n.text}`);
    if (j.subject.pick !== "none") {
      const rid = newRumor(s, { about: j.subject.pick, text: n.text, origin: j.suspect_newcomer.yes ? "player" : "anonymous", harm: j.harm.value - 2 });
      learn(s, v, rid, j.believe.yes ? 0.6 : 0.15, "anonymous");
      const k = j.react.pick;
      if (j.believe.yes && k !== "nothing") v.intent = { kind: k, target: k === "spread" ? null : k === "report" ? "hesper" : j.subject.pick, rumor: rid };
    }
    if (j.suspect_newcomer.yes) {
      s.rel[v.id].player.trust = clamp(s.rel[v.id].player.trust - 0.8);
      const lid = newRumor(s, { about: "player", text: "The newcomer has been leaving nasty unsigned notes.", origin: v.id, isTrue: true, harm: -1.5 });
      learn(s, v, lid, 0.7, "self");
    }
  }
}

export async function doAction(s, text, ui) {
  const here = at(s, s.player.location);
  const j = await jev.ask({ place: PLACES[s.player.location].name, people_present: here.map((v) => `${v.name} (${v.traits.slice(0, 3).join(", ")})`), newcomer_does: text }, {
    kind: { type: "choice", instructions: "What kind of act is this?", criteria: { harmless: "Ordinary, harmless", kind: "A kind or helpful deed", rude: "Rude or disrespectful", suspicious: "Suspicious or sneaky", destructive: "Damaging, violent or criminal" }, prior: { harmless: 3, kind: 1, rude: 0.5, suspicious: 0.5, destructive: 0.3 } },
    ...Object.fromEntries(here.map((v) => [v.id, { type: "score", instructions: `How does ${first(v)} feel about the newcomer after seeing this?`, criteria: SHIFT, prior: 2 }])),
  }, "act");
  for (const v of here) {
    const r = s.rel[v.id].player;
    r.affinity = clamp(r.affinity + (j[v.id].value - 2) * 0.4);
    remember(v, s, `saw the newcomer ${text}`);
  }
  if (["rude", "suspicious", "destructive"].includes(j.kind.pick) && here.length) {
    const rid = newRumor(s, { about: "player", text: `The newcomer was seen ${text} at ${PLACES[s.player.location].name}.`, origin: "truth", isTrue: true, harm: j.kind.pick === "destructive" ? -2 : -1 });
    for (const v of here) learn(s, v, rid, 1, "self");
  }
  const said = await llm.ask(`The newcomer, at ${PLACES[s.player.location].name}, does this: ${text}. People present: ${here.map((v) => `${v.name}, the ${v.job} (${v.traits.slice(0, 3).join(", ")})`).join("; ") || "nobody"}. It reads as ${j.kind.pick}.
Narrate what happens in one or two plain sentences in second person ("You ..."), including any visible reaction from the people present.`);
  event(s, s.player.location, `The newcomer: ${text}`, { say() {} });
  return said;
}

// ---------- end of the day: the big decisions ----------

export async function endOfDay(s, ui) {
  const lines = [];
  const opinion = (v) => s.rel[v.id].player;
  const outcomes = await Promise.all(alive(s).map(async (v) => {
    const criteria = { carry_on: "Carries on as usual tomorrow" };
    const prior = { carry_on: 6 };
    if (v.employer && v.employed) { criteria.quit = `Quits working for ${s.people[v.employer].name}`; prior.quit = s.rel[v.id][v.employer].affinity < -1 ? 1 : 0.1; }
    const staff = alive(s).filter((o) => o.employer === v.id && o.employed);
    for (const e of staff) {
      const bad = Object.entries(v.knows).some(([id, k]) => s.rumors[id].about === e.id && s.rumors[id].harm <= -1 && k.conf >= 0.5);
      criteria[`fire_${e.id}`] = `Fires ${e.name}`; prior[`fire_${e.id}`] = bad ? 2.5 : s.rel[v.id][e.id].affinity < -1 ? 0.6 : 0.05;
    }
    criteria.move_away = "Decides to leave Thistlewick for good";
    const townAgainst = Object.values(s.rel).filter((r) => r[v.id] && r[v.id].affinity < -1).length;
    prior.move_away = 0.02 + townAgainst * 0.12 + (v.mood.fear >= 2 ? 0.3 : 0);
    criteria.want_newcomer_gone = "Wants the elder to run the newcomer out of town";
    prior.want_newcomer_gone = opinion(v).affinity < -1.5 || opinion(v).trust < -1.5 ? 1.5 : 0.05;
    const worst = alive(s).filter((o) => o.id !== v.id).sort((p, q) => s.rel[v.id][p.id].affinity - s.rel[v.id][q.id].affinity)[0];
    if (worst && s.rel[v.id][worst.id].affinity < -1) { criteria.make_peace = `Decides to make peace with ${worst.name}`; prior.make_peace = 0.3; }
    const j = await jev.ask({ ...persona(s, v), day_summary: v.memory.slice(-10), on_newcomer: feelings(s, v, "player"), how_many_in_town_dislike_them: townAgainst },
      { outcome: { type: "choice", instructions: `Lying awake tonight, what does ${first(v)} decide?`, criteria, prior } }, `night:${v.id}`);
    return [v, j.outcome.pick, worst];
  }));

  let banishVotes = 0;
  for (const [v, out, worst] of outcomes) {
    if (out === "quit") { v.employed = false; lines.push(`${v.name} quit working for ${s.people[v.employer].name}.`); }
    else if (out.startsWith("fire_")) { const e = s.people[out.slice(5)]; e.employed = false; e.mood.anger += 2; s.rel[e.id][v.id].affinity = clamp(s.rel[e.id][v.id].affinity - 2); lines.push(`${v.name} fired ${e.name}.`); }
    else if (out === "move_away") { v.gone = true; v.location = "gone"; lines.push(`${v.name} packed up and left Thistlewick.`); }
    else if (out === "want_newcomer_gone") { banishVotes++; lines.push(`${v.name} wants you gone.`); }
    else if (out === "make_peace" && worst) { s.rel[v.id][worst.id].affinity = clamp(s.rel[v.id][worst.id].affinity + 1.5); v.intent = { kind: "make_peace", target: worst.id }; lines.push(`${v.name} decided to make peace with ${worst.name}.`); }
  }

  // The elder weighs the town's mood about the newcomer.
  const hesper = s.people.hesper;
  let banished = false;
  if (hesper && !hesper.gone) {
    const avg = (k) => alive(s).reduce((t, v) => t + s.rel[v.id].player[k], 0) / alive(s).length;
    const j = await jev.ask({ elder: persona(s, hesper), town_affinity_for_newcomer: avg("affinity").toFixed(1), town_trust_in_newcomer: avg("trust").toFixed(1), villagers_asking_for_banishment: banishVotes, of: alive(s).length },
      { banish: { type: "noul", instructions: "The elder orders the newcomer to leave Thistlewick.", prior: Math.min(0.95, banishVotes * 0.2 + (avg("trust") < -1.5 ? 0.3 : 0)) } }, "elder:verdict");
    if (banishVotes >= 2 && j.banish.yes) { banished = true; lines.push("Elder Hesper has ordered you out of Thistlewick. The game is over."); }
  }
  s.banished = banished;
  return lines;
}

// ---------- what the player can see ----------

export function socialMap(s) {
  const out = [];
  for (const [key, label] of Object.entries(s.player.seen)) {
    const [a, b] = key.split("|");
    out.push(`${nameOf(s, a)} & ${nameOf(s, b)}: last seen ${label}`);
  }
  for (const v of alive(s)) {
    const r = s.rel[v.id].player;
    if (Math.abs(r.affinity) > 0.4 || Math.abs(r.trust + 0.5) > 0.4) out.push(`${v.name} seems to ${r.affinity > 0.4 ? "like" : r.affinity < -0.4 ? "dislike" : "feel unsure about"} you${r.trust < -1 ? ", and doesn't trust you" : ""}.`);
  }
  return out.length ? out : ["You don't know much about anyone yet. Talk to people and listen."];
}

export { feel, trust };
