// How you look, and what the women make of it. Code describes the outfit in words and
// keeps the books (coins, what you own); Jev decides how each woman sizes it up, whether
// she talks about it, and whether it makes you a threat. Those verdicts then sit in every
// later Jev state about you (see sim.feelings), so a look keeps mattering all season.

import * as jev from "./jev.js";
import * as voice from "./voice.js";
import { FASHION } from "./cast.js";
import * as W from "./wardrobe.js";
import { alive, first, clamp, remember, newRumor, learn, persona, feelings, clock } from "./sim.js";

export const VERDICTS = ["hideous", "tacky", "plain", "cute", "stunning"];
const REACTIONS = {
  admires: "Genuinely admires it",
  approves: "Approves, quietly",
  shrugs: "Barely notices, clothes aren't her thing",
  sneers: "Sneers at it",
  envious: "Jealous: the newcomer looks better than she does",
  copycat: "Offended: the newcomer is copying her look",
  suspicious: "Suspicious: wonders how the newcomer could afford it",
};
const EMOTE = { admires: "heart", approves: "sparkle", shrugs: null, sneers: "cringe", envious: "anger", copycat: "anger", suspicious: "suspicious" };

// ---------- the books ----------

export function setUp(s) {
  s.player.outfit ??= { ...W.STARTER };
  s.player.owned ??= [];
  s.player.coins ??= W.BUDGET;
  s.player.outfitSince ??= s.day;
  s.looks ??= {};
  s.player.debuted ??= s.day > 1 || s.minute > 8 * 60 + 30; // seasons saved before outfits are well under way
  voice.setLook(lookText(s, { short: true }));
}

// What the new outfit costs on top of what she already owns.
export function bill(s, outfit) {
  return W.SLOTS.reduce((t, sl) => t + (W.owns(s.player.owned, outfit[sl.key]) ? 0 : W.ITEMS[outfit[sl.key]]?.price || 0), 0);
}

// Put it on and pay for what's new. Returns { ok, spent, changed }.
export function dress(s, outfit) {
  const spent = bill(s, outfit);
  if (spent > s.player.coins) return { ok: false, spent, changed: false };
  const before = W.outfitKey(s.player.outfit);
  s.player.coins -= spent;
  for (const sl of W.SLOTS) { const id = outfit[sl.key]; if (!W.owns(s.player.owned, id)) s.player.owned.push(id); }
  s.player.outfit = { ...outfit };
  const changed = W.outfitKey(outfit) !== before;
  if (changed) s.player.outfitSince = s.day;
  voice.setLook(lookText(s, { short: true }));
  return { ok: true, spent, changed };
}

export function payday(s) { s.player.coins = (s.player.coins || 0) + W.STIPEND; }

// ---------- describing it ----------

// The woman she most looks like, if she is close to a copy of someone's signature look.
export function lookalike(s) {
  const o = s.player.outfit;
  let best = null, bestScore = 1.5;
  for (const v of alive(s)) {
    let sc = 0;
    if (colorNear(o.color, v.look.outfit, 70)) sc += 1;
    if (W.ITEMS[o.hair]?.style === v.look.hairStyle) sc += 1;
    if (colorNear(W.ITEMS[o.dye]?.color, v.look.hair, 60)) sc += 0.8;
    const acc = v.look.accessory, picked = [W.ITEMS[o.hat]?.hat, W.ITEMS[o.neck]?.neck, W.ITEMS[o.ears]?.ears, W.ITEMS[o.face]?.face];
    if (acc && picked.includes(acc)) sc += 0.7;
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return best;
}
function colorNear(a, b, d) {
  if (!a || !b) return false;
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < d;
}

export function lookText(s, { short = false } = {}) {
  const o = s.player.outfit;
  const cost = W.outfitCost(o), tags = Object.entries(W.tagsOf(o)).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 3);
  const base = `${W.itemsText(o)}; hair: ${W.hairText(o)}`;
  if (short) return base;
  const days = s.day - (s.player.outfitSince ?? s.day);
  const twin = lookalike(s);
  return `${s.player.name} is wearing ${base}. Overall style: ${tags.join(", ") || "plain"}; it looks ${W.priceWord(cost)} (about ${cost} coins).${days >= 1 ? ` She has worn this exact outfit ${days + 1} days running.` : ""}${twin ? ` She is dressed a lot like ${twin.name}.` : ""}`;
}

// What she thinks of the look, for other Jev states and the HUD.
export function opinionText(s, id) {
  const r = s.looks?.[id];
  if (!r) return null;
  const stale = r.key !== W.outfitKey(s.player.outfit);
  return `${stale ? "thought her last outfit was" : "thinks her look is"} ${VERDICTS[Math.round(r.verdict)]}${r.reaction === "envious" ? " and is jealous of it" : r.reaction === "copycat" ? " and thinks she is copying her" : r.reaction === "suspicious" ? " and wonders how she paid for it" : ""}${r.threat ? "; sees her as a threat" : ""}`;
}

// ---------- sizing her up ----------

export async function judge(s, v, ui, { where = "in town" } = {}) {
  const F = FASHION[v.id] || { loves: [], hates: [], vain: 0.3, worth: 80, text: "has ordinary taste" };
  const o = s.player.outfit, key = W.outfitKey(o);
  const tags = W.tagsOf(o), cost = W.outfitCost(o);
  const twin = lookalike(s);
  const prevRec = s.looks[v.id];
  const fit = F.loves.reduce((t, x) => t + (tags[x] || 0), 0) - F.hates.reduce((t, x) => t + (tags[x] || 0), 0) * 1.2;
  const money = v.id === "odette" || v.id === "celeste" ? (cost - 80) / 90 : 0;
  const prior = Math.max(0, Math.min(4, 2 + fit * 0.35 + money));
  const outshines = cost > F.worth && prior >= 2.5;
  const r = s.rel[v.id].player;
  const j = await jev.ask({
    ...persona(s, v),
    her_taste_in_clothes: F.text,
    her_own_look: `${v.name} usually wears an outfit worth about ${F.worth} coins`,
    newcomer_look: lookText(s),
    ...(prevRec ? { what_she_thought_before: `${opinionText(s, v.id)}` } : {}),
    on_newcomer: feelings(s, v, "player"),
    where,
  }, {
    verdict: { type: "score", instructions: `${first(v)} gets a good look at ${s.player.name}'s outfit. Judged by ${first(v)}'s own taste, how does it look to her?`, criteria: ["Hideous", "Tacky", "Plain", "Cute", "Stunning"], prior },
    reaction: { type: "choice", instructions: `How does ${first(v)} react to ${s.player.name}'s look?`, criteria: REACTIONS,
      prior: { admires: Math.max(0.02, prior - 2.4) ** 1.5 * 2.5, approves: 0.2 + Math.max(0, prior - 1.8), shrugs: 1.6 - F.vain * 1.2, sneers: Math.max(0.02, 2.2 - prior) * (0.8 + F.vain), envious: outshines ? F.vain * 3 : 0.05, copycat: twin?.id === v.id ? 6 : 0.02, suspicious: cost >= 150 ? 0.4 + v.bias.nosy * 0.6 + (v.id === "odette" ? 1.5 : 0) : 0.05 } },
    gossip: { type: "noul", instructions: `${first(v)} talks about ${s.player.name}'s outfit behind her back.`, prior: Math.min(0.85, 0.08 + v.bias.gossip * 0.3 + F.vain * 0.25 + Math.abs(prior - 2) * 0.08) },
    threat: { type: "noul", instructions: `Seeing how ${s.player.name} looks, ${first(v)} decides she is a real threat to win the show: everybody notices her.`, prior: Math.min(0.7, prior >= 3 ? 0.05 + F.vain * 0.25 + v.bias.scheme * 0.2 : 0.02) },
  }, `look:${v.id}`);
  const verdict = j.verdict.value, reaction = j.reaction.pick;
  // a woman who doesn't care about clothes doesn't change her mind much over them
  let d = (verdict - 2) * 0.3 * (0.4 + F.vain);
  d += { admires: 0.3, approves: 0.1, shrugs: 0, sneers: -0.3, envious: -0.5, copycat: -0.8, suspicious: 0 }[reaction] ?? 0;
  if (prevRec?.key === key) d *= 0.3; // she has seen it before
  r.affinity = clamp(r.affinity + d);
  if (reaction === "suspicious") r.trust = clamp(r.trust - 0.3);
  const item = W.standout(o);
  const rec = { key, verdict, reaction, threat: j.threat.yes, day: s.day, time: clock(s.minute), said: false, item };
  s.looks[v.id] = rec;
  remember(v, s, `sized up ${s.player.name}'s look (${item}): ${VERDICTS[Math.round(verdict)]}${reaction === "shrugs" ? "" : `, ${REACTIONS[reaction].toLowerCase()}`}`);
  if (j.threat.yes) remember(v, s, `decided ${s.player.name} is a threat: everybody notices her`);
  let rid = null;
  if (j.gossip.yes && reaction !== "shrugs") {
    const P = s.player.name, Fn = first(v);
    const text = {
      admires: `${Fn} says ${P}'s ${item} is the best thing she's seen in this town.`,
      approves: `${Fn} thinks ${P} has lovely taste.`,
      sneers: `${Fn} says ${P}'s ${item} looks ${verdict < 1.5 ? "hideous" : "cheap and tacky"}.`,
      envious: `${Fn} is telling everyone ${P} is trying way too hard with that ${item}.`,
      copycat: `${Fn} says ${P} is copying her look, right down to the hair.`,
      suspicious: `${Fn} wants to know how the new girl paid for that ${item}.`,
    }[reaction];
    const harm = { admires: 1, approves: 0.5, sneers: -1, envious: -1, copycat: -1.2, suspicious: -0.8 }[reaction];
    rid = newRumor(s, { about: "player", text, origin: v.id, isTrue: true, harm, kind: "look" });
    learn(s, v, rid, 1, "self");
  }
  ui.emote?.(v.id, EMOTE[reaction]);
  ui.lookJudged?.(v, rec, rid);
  return rec;
}

// Each tick, women close enough to see a new outfit size it up (a few at a time).
export async function notice(s, ui, { max = 3, range = 9 } = {}) {
  if (!s.player.outfit || !s.player.debuted || s.player.out || !ui.distance) return [];
  const key = W.outfitKey(s.player.outfit);
  const who = alive(s).filter((v) => s.looks[v.id]?.key !== key && !v.judging && ui.distance(v) < range).slice(0, max);
  for (const v of who) v.judging = true;
  try { return await Promise.all(who.map((v) => judge(s, v, ui))); }
  finally { for (const v of who) v.judging = false; }
}

// Everyone at once (the welcome party).
export async function judgeAll(s, ui, opts) {
  s.player.debuted = true;
  return Promise.all(alive(s).map((v) => judge(s, v, ui, opts)));
}

// a quick remark she'd make out loud when she first clocks it (no Claude call, it's instant)
export function remark(s, v, rec) {
  const it = rec.item, P = s.player.name;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    admires: pick([`Oh! That ${it}!`, `${P}, you look divine.`, `Now THAT is an entrance.`]),
    approves: pick([`Cute ${it}.`, `Not bad, new girl.`, `Somebody has taste.`]),
    shrugs: pick([`Hm.`, `Welcome, I suppose.`, `Nice to meet you.`]),
    sneers: pick([`Is that a ${it}? Bold.`, `Did she get dressed in the dark?`, `Oh, sweetie. No.`]),
    envious: pick([`Well. Somebody's trying hard.`, `Must be nice.`, `Who does she think she is?`]),
    copycat: pick([`Excuse me, is she wearing MY look?`, `Copycat.`, `Flattering. And creepy.`]),
    suspicious: pick([`And how did she pay for THAT?`, `That ${it} cost a fortune.`, `New money, hm?`]),
  }[rec.reaction];
}

// for the HUD: a cue, never numbers
export function lookCue(s, id) {
  const r = s.looks?.[id];
  if (!r) return null;
  if (r.key !== W.outfitKey(s.player.outfit)) return "hasn't seen your new look";
  if (r.reaction === "copycat") return "thinks you copied her";
  if (r.reaction === "envious") return "is jealous of your look";
  if (r.reaction === "suspicious") return "wonders how you paid for it";
  return { 0: "thinks you look hideous", 1: "thinks you look tacky", 2: "thinks you look plain", 3: "likes your look", 4: "loves your look" }[Math.round(r.verdict)];
}

