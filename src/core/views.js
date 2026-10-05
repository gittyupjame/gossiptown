// Her view: the only thing any Jev state or Claude prompt about a woman is built from.
// It reads her own record (who she is, her mood, memories, beliefs, feelings, goals,
// agenda, commitments and her own recent decisions) and what she can see right now, and
// lists the records it used so a decision can point back at what fed it. It never reads
// the world log, anyone else's mind, or the truth.

import { PLACES, SHOW, FASHION } from "./cast.js";
import * as M from "./mind.js";
import * as B from "./beliefs.js";
import { audience, pos } from "./space.js";

const nm = M.nm;

export function nature(v) {
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

// what everyone knows about the show itself (Primrose announces it)
export function showText(s) {
  const d = (SHOW.voteEvery - (s.day % SHOW.voteEvery)) % SHOW.voteEvery;
  const left = Object.values(s.people).filter((v) => !v.gone).length + (s.player.out ? 0 : 1);
  return `Day ${s.day} of a reality show. ${left} women left. ${d === 0 ? "The vote is TONIGHT at the firepit at 7pm." : `The next vote is in ${d} day${d > 1 ? "s" : ""}.`} At every vote the town votes one woman out. Everyone wants to be the last one standing.`;
}

export const placeName = (loc) => PLACES[loc]?.name || (loc === "home" ? "her cottage" : "the lane");
const clock = M.clock;

// Who she can see from where she is (her eyes, right now).
export function inSight(s, id) {
  const p = pos(s, id);
  if (!p || s.people[id]?.location === "home") return [];
  return audience(s, p, { exclude: [id] }).map((a) => a.id);
}

// Her sense of where she stands: who she believes is with her, who is coming for her.
export function standing(s, id) {
  const v = s.people[id];
  const allies = new Set(), threats = new Map();
  for (const a of s.alliances) if (a.members.includes(id) && a.loyal?.[id] !== false) for (const m of a.members) if (m !== id && (m === "player" || !s.people[m]?.gone)) allies.add(m);
  for (const [rid, k] of Object.entries(v.knows)) {
    if (k.conf < 0.45) continue;
    const r = s.rumors[rid];
    if (r?.prop?.pred === "votes_for" && r.prop.obj === id && (r.prop.pol ?? 1) === 1 && r.about !== id && present(s, r.about)) threats.set(r.about, r.text);
    if (r?.prop?.pred === "votes_for" && r.prop.obj !== id && (r.prop.pol ?? 1) === 1 && v.votePlan?.target === r.prop.obj && present(s, r.about)) allies.add(r.about);
  }
  for (const rec of (s.votes || []).slice(-2)) for (const [voter, t] of Object.entries(rec.ballots || {})) if (t === id && voter !== id && present(s, voter)) threats.set(voter, `voted against you on day ${rec.day}`);
  for (const t of threats.keys()) allies.delete(t);
  const n = allies.size, m = threats.size;
  const word = m >= 3 && n <= 1 ? "on the outs: several people are coming for you" : m >= 2 && n < m ? "on the bubble" : n >= 2 && m === 0 ? "fairly safe, with friends around you" : n === 0 ? "isolated: nobody is really in your corner" : "unsure";
  return { allies: [...allies], threats: [...threats.keys()], threatWhy: Object.fromEntries(threats), word };
}
const present = (s, id) => id === "player" ? !s.player.out : !!s.people[id] && !s.people[id].gone;

// The full view. `with`: people in front of her; `about`: someone the moment is about;
// `topic`: a claim the moment is about; `moment`: what is happening, as she perceives it.
export function view(s, id, { with: people = [], about = null, topic = null, moment = null, extra = {}, small = false } = {}) {
  const v = s.people[id];
  const used = { mem: [], bel: [], com: [], dec: [] };
  const focus = [...new Set([...people, about].filter((x) => x && x !== id))];
  const mems = M.recall(s, id, { with: focus, topic: topic ? s.rumors[topic]?.about : about, max: small ? 4 : 7 });
  used.mem = mems.map((m) => m.id);
  const bels = B.relevantBeliefs(s, id, { people: focus, topic, max: small ? 4 : 8 });
  used.bel = bels;
  const coms = (s.ledger || []).filter((c) => (c.by === id || c.to === id) && (c.status === "open" || s.day - (c.settledDay ?? s.day) <= 2)).slice(-6);
  used.com = coms.map((c) => c.id);
  const mine = (s.decisions || []).filter((d) => d.actor === id && d.text).slice(-4);
  used.dec = mine.map((d) => d.id);
  const st = standing(s, id);
  const sight = inSight(s, id).filter((x) => !focus.includes(x));
  const payload = {
    you: `${v.name}, the ${v.employed ? v.job : `out-of-work ${v.job}`} (${v.archetype})`,
    personality: v.traits.join(", "),
    nature: nature(v),
    ...(FASHION[v.id] && extra.clothes ? { taste_in_clothes: FASHION[v.id].text } : {}),
    mood: M.moodText(v.mood) + (v.mood.why ? ` (because ${v.mood.why})` : ""),
    where: `${placeName(v.location)}, ${clock(s.minute)}`,
    ...(sight.length ? { also_around: sight.map((x) => nm(s, x)) } : {}),
    the_show: showText(s),
    your_goals: (v.goals || []).slice(0, 3).map((g) => `${M.goalText(s, g)} (${g.why})`),
    ...(v.agenda?.length ? { you_mean_to: v.agenda.slice(0, 3).map((it) => M.agendaText(s, it)) } : {}),
    your_vote: M.votePlanText(s, v),
    where_you_stand: st.word + (st.threats.length ? `; you think ${st.threats.map((t) => nm(s, t)).join(", ")} ${st.threats.length > 1 ? "are" : "is"} against you` : "") + (st.allies.length ? `; you count on ${st.allies.map((t) => nm(s, t)).join(", ")}` : ""),
    ...(focus.length ? { people: Object.fromEntries(focus.map((p) => [nm(s, p), personLine(s, id, p)])) } : {}),
    what_you_believe: bels.map((rid) => B.beliefText(s, id, rid)),
    what_you_remember: mems.map(M.memLine),
    ...(coms.length ? { promises: M.commitmentsText(s, id, { with: people.length === 1 ? people[0] : null }) } : {}),
    ...(mine.length ? { you_recently_decided: mine.map((d) => `day ${d.day} ${clock(d.minute)}: ${d.text}`) } : {}),
    ...(moment ? { right_now: moment } : {}),
    ...extra.fields,
  };
  return { payload, used };
}

// how she sees one person: her feelings and her suspicion of them
export function personLine(s, id, other) {
  const susp = B.suspicion(s, id, other);
  const look = other === "player" && s.looks?.[id] ? `; ${lookLine(s, id)}` : "";
  return `you ${M.relText(s, id, other)}${susp >= 0.35 ? `; you suspect she lies (${Math.round(susp * 100)}%)` : ""}${look}`;
}
function lookLine(s, id) {
  const lk = s.looks[id];
  return lk ? `you thought her outfit was ${["hideous", "tacky", "plain", "cute", "stunning"][Math.round(Math.max(0, Math.min(4, lk.verdict)))]}${lk.reaction && lk.reaction !== "none" ? ` (${lk.reaction})` : ""}` : "";
}
