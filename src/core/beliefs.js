// What each woman (and the player) believes. A belief is never a copy of the truth: it is
// her guess at a claim, with a confidence, the chain of how it reached her, and when.
//
//   s.rumors[rid]   a claim anyone might hold: { about, text, origin, isTrue, harm, kind,
//                   cat: world | trait | mind, prop: { subject, pred, obj, pol }, parent }
//                   (a retelling that changed the story is a new claim pointing at its parent)
//   v.knows[rid]    { conf, from, chain: [{ ev, from, root, how } | { inf, how: "inferred" }],
//                     formed: { day, minute }, partial }
//   s.inferences    beliefs she worked out from other beliefs, citing them
//   s.secrets       each secret's owner, its true claim, and who knows it
//
// Confidence only moves on new evidence (a telling, a sighting, an inference, a contradiction
// resolved), never with time. Independent sources raise it more than one source repeating itself.

import { change, nextId, violation } from "./record.js";
import { actor, nm, clock } from "./mind.js";
import { overlap } from "./reading.js";

// ---------- claims ----------

export function newClaim(s, { about = null, text, origin, isTrue = null, harm = 0, parent = null, kind = "gossip", cat = "world", prop = null, ev = null, target = null }) {
  const id = "r" + (s.nextRumor = (s.nextRumor || 1)) ;
  s.nextRumor++;
  s.rumors[id] = { id, about, text, origin, isTrue, harm, parent, kind, cat, prop: prop || { subject: about, pred: kind, obj: target, pol: 1 }, day: s.day, time: clock(s.minute), ev, ...(target ? { target } : {}) };
  return id;
}

export function rootOf(s, rid) {
  let r = s.rumors[rid], n = 0;
  while (r?.parent && s.rumors[r.parent] && n++ < 30) r = s.rumors[r.parent];
  return r?.id || rid;
}
export const versionsOf = (s, rid) => { const root = rootOf(s, rid); return Object.keys(s.rumors).filter((id) => rootOf(s, id) === root); };

// an existing claim that says the same thing, so retellings don't multiply stories
const words = (x) => Math.max(1, (String(x).toLowerCase().match(/[a-z']{3,}/g) || []).length);
export function findClaim(s, { about, text, kind = null, obj = undefined, pol = 1 }) {
  let best = null, bo = 0;
  for (const r of Object.values(s.rumors)) {
    if (r.about !== about || (r.prop?.pol ?? 1) !== pol) continue;
    if (kind && r.kind !== kind && !(r.kind === "gossip" || kind === "gossip")) continue;
    if (obj !== undefined && (r.prop?.obj ?? null) !== obj) continue;
    // the same story: most words shared, and not a short line swallowed by a longer one
    const o = overlap(r.text, text) * Math.min(1, 2 * Math.min(words(r.text), words(text)) / Math.max(words(r.text), words(text)));
    if (o > bo) { bo = o; best = r; }
  }
  return bo >= 0.7 ? best.id : null;
}

// "X tends to lie": what suspicion is, as a belief like any other
export function liarClaim(s, subject) {
  const found = Object.values(s.rumors).find((r) => r.kind === "liar" && r.about === subject);
  if (found) return found.id;
  return newClaim(s, { about: subject, text: `${nm(s, subject)} lies to people's faces.`, origin: "inference", kind: "liar", cat: "trait", harm: -1.2, prop: { subject, pred: "lies", obj: null, pol: 1 } });
}

// ---------- holding beliefs ----------

export const conf = (s, who, rid) => actor(s, who)?.knows?.[rid]?.conf || 0;
export const holders = (s, rid, min = 0.5) => [...Object.values(s.people).filter((v) => !v.gone && (v.knows[rid]?.conf || 0) >= min).map((v) => v.id), ...((s.player.knows?.[rid]?.conf || 0) >= min ? ["player"] : [])];

// She takes something in. conf is how convincing this telling or sighting was to her (decided
// by Jev for tellings, by perception for sightings). Returns how her confidence moved and
// which of her beliefs now clash with it.
//   from: who it came from ("self" for her own eyes), ev: the event she perceived,
//   root: where the story started (the first teller, or "saw"), how: told | overheard | partial | saw | inferred
export function learn(s, who, rid, { conf: c, from, ev = null, root = null, how = "told", partial = false, inf = null, cause }) {
  const v = actor(s, who);
  const r = s.rumors[rid];
  if (!v || !r) return { before: 0, after: 0, conflicts: [] };
  if (!ev && !inf) violation(s, "belief-without-channel", { who, rid });
  v.knows ??= {};
  const k = v.knows[rid];
  const before = k?.conf || 0;
  root ??= r.origin && r.origin !== "truth" ? r.origin : from;
  const link = inf ? { inf, how: "inferred" } : { ev, from, root, how };
  c = Math.max(0, Math.min(1, c));
  let after;
  if (!k) {
    // another version of the same story she heard from an unconnected source corroborates
    const other = Object.entries(v.knows).find(([id, x]) => id !== rid && x.conf >= 0.3 && rootOf(s, id) === rootOf(s, rid) && !x.chain?.some((l) => l.root === root));
    after = other && c >= 0.3 ? Math.max(c, 1 - (1 - other[1].conf) * (1 - c * 0.7)) * 0.95 : c;
    v.knows[rid] = { conf: after, from, chain: [link], formed: { day: s.day, minute: s.minute }, day: s.day, time: clock(s.minute), ...(partial ? { partial: true } : {}) };
  } else {
    const sameRoot = k.chain.some((l) => (l.root && l.root === root) || (l.from && l.from === from && from !== "self"));
    if (sameRoot) after = Math.max(k.conf, c * 0.9) + (c >= 0.3 ? 0.03 * (1 - k.conf) : 0); // the same teller again adds little
    else after = c >= 0.3 && k.conf >= 0.2 ? 1 - (1 - k.conf) * (1 - c * 0.8) : Math.max(k.conf, c);
    after = Math.min(1, after);
    k.conf = after;
    k.chain.push(link);
    if (k.chain.length > 8) k.chain.splice(1, k.chain.length - 8);
    if (!partial && k.partial) delete k.partial;
    if (after > before) { k.from = from; k.day = s.day; k.time = clock(s.minute); }
  }
  if (Math.abs(after - before) > 1e-6 || !k) change(s, { who, what: "belief", key: rid, from: before, to: after, cause });
  syncSecrets(s, rid);
  if (who === "player") playerHeard(s, rid, from, how, ev);
  return { before, after, conflicts: after >= 0.3 ? clashes(s, who, rid) : [] };
}

// Revising a belief: she decides it's false, or less sure. Needs a cause like anything else.
export function revise(s, who, rid, to, cause) {
  const k = actor(s, who)?.knows?.[rid];
  if (!k) return;
  const before = k.conf;
  k.conf = Math.max(0, Math.min(1, to));
  if (Math.abs(k.conf - before) > 1e-6) change(s, { who, what: "belief", key: rid, from: before, to: k.conf, cause });
  k.revised = cause;
  syncSecrets(s, rid);
}

// ---------- contradictions ----------

export function contradicts(s, a, b) {
  const ra = s.rumors[a], rb = s.rumors[b];
  if (!ra || !rb || a === b || ra.about !== rb.about || !ra.about) return false;
  const pa = ra.prop || {}, pb = rb.prop || {};
  if (pa.pred === "votes_for" && pb.pred === "votes_for") {
    if ((pa.pol ?? 1) === (pb.pol ?? 1)) return pa.obj !== pb.obj && Math.abs((ra.day || 0) - (rb.day || 0)) <= 1 && (pa.pol ?? 1) === 1;
    return pa.obj === pb.obj;
  }
  if ((pa.pol ?? 1) !== (pb.pol ?? 1)) return pa.pred === pb.pred && (pa.obj ?? null) === (pb.obj ?? null) && (overlap(ra.text, rb.text) >= 0.45 || rootOf(s, a) === rootOf(s, b) || ["votes_for", "allied", "liar", "pledged"].includes(pa.pred));
  return false;
}
export function clashes(s, who, rid, { from = null } = {}) {
  const v = actor(s, who);
  // a vote plan she heard from the woman herself counts even if she doubted it
  const heardFromHer = (id, k) => s.rumors[id]?.prop?.pred === "votes_for" && k.chain?.some((l) => l.from === s.rumors[id].about);
  // and when the woman herself says otherwise, even a story she half-believed has to be squared
  const subj = s.rumors[rid]?.about;
  const ownWord = !!subj && (from === subj || (v?.knows[rid]?.chain || []).some((l) => l.from === subj));
  return Object.entries(v?.knows || {}).filter(([id, k]) => id !== rid && (k.conf >= 0.3 || heardFromHer(id, k) || (ownWord && k.conf >= 0.15)) && contradicts(s, rid, id)).map(([id]) => id);
}

// ---------- inference ----------
// "She was at my mailbox, so she read my letter." Logged, citing the beliefs it came from,
// and never as sure as seeing it.
export function infer(s, who, { from = [], rid, conf: c, why, cause }) {
  const id = nextId(s, "i");
  const base = Math.min(...from.map((f) => conf(s, who, f)).filter((x) => x > 0), 1);
  const capped = Math.min(c, 0.85, Math.max(0.05, base * 0.95));
  (s.inferences ??= []).push({ id, by: who, from, rid, conf: capped, why, cause, day: s.day, minute: s.minute });
  if (s.inferences.length > 800) s.inferences.splice(0, s.inferences.length - 800);
  return { id, ...learn(s, who, rid, { conf: capped, from: "self", how: "inferred", inf: id, cause: cause || id }) };
}

// suspicion of someone is her belief that they lie, raised or lowered by evidence
export const suspicion = (s, who, subject) => conf(s, who, liarClaim(s, subject));
export function suspect(s, who, subject, { by = 0.25, because = [], why, cause }) {
  if (who === subject) return null;
  const rid = liarClaim(s, subject);
  const cur = conf(s, who, rid);
  const target = Math.max(0, Math.min(0.95, by >= 0 ? cur + (1 - cur) * by : cur + by));
  if (by < 0) { revise(s, who, rid, target, cause); return { rid, conf: target }; }
  const ev = because.find((b) => /^e\d+$/.test(b));
  const beliefs = because.filter((b) => s.rumors[b]);
  if (beliefs.length) return { rid, ...infer(s, who, { from: beliefs, rid, conf: target, why, cause }) };
  return { rid, ...learn(s, who, rid, { conf: target, from: "self", ev, how: "saw", cause }) };
}

// ---------- secrets ----------

export function addSecret(s, owner, rid) {
  s.secrets ??= {};
  const id = "s" + (Object.keys(s.secrets).length + 1);
  s.secrets[id] = { id, owner, rid, root: rootOf(s, rid), knowers: [] };
  s.rumors[rid].secret = id;
  syncSecrets(s, rid);
  return id;
}
export function secretKnowers(s, sec) {
  const vs = versionsOf(s, sec.rid);
  return holders(s, sec.rid, 0.5).concat(...vs.filter((x) => x !== sec.rid).map((x) => holders(s, x, 0.5))).filter((x, i, a) => a.indexOf(x) === i).sort();
}
export function syncSecrets(s, rid) {
  if (!s.secrets) return;
  const root = rootOf(s, rid);
  for (const sec of Object.values(s.secrets)) if (sec.root === root) sec.knowers = secretKnowers(s, sec);
}
export const secretOf = (s, owner) => Object.values(s.secrets || {}).find((x) => x.owner === owner) || null;

// ---------- the player ----------

function playerHeard(s, rid, from, how, ev) {
  s.player.heard ??= [];
  if (s.player.heard.some((h) => h.rid === rid)) return;
  s.player.heard.push({ rid, from, how: { told: "told", overheard: "overheard", partial: "overheard part", saw: "saw", inferred: "worked out" }[how] || how, day: s.day, time: clock(s.minute), ev });
  s.player.unread = (s.player.unread || 0) + 1;
}

// ---------- reach and words ----------

export function reach(s, rid) {
  const out = { believe: [], doubt: [], heard: [] };
  for (const v of [...Object.values(s.people).filter((x) => !x.gone), { id: "player", knows: s.player.knows || {} }]) {
    const k = v.knows?.[rid];
    if (!k) continue;
    out.heard.push(v.id);
    if (k.conf >= 0.5) out.believe.push(v.id); else if (k.conf < 0.3) out.doubt.push(v.id);
  }
  return out;
}

const SURE = (c) => (c >= 0.85 ? "you're sure" : c >= 0.6 ? "you believe it" : c >= 0.35 ? "you half-believe it" : "you doubt it");
// "Sylvie has been stealing from the till [r4] (you believe it; Wren told you, who had it from Tansy)"
export function beliefText(s, who, rid, { tag = false } = {}) {
  const k = actor(s, who)?.knows?.[rid], r = s.rumors[rid];
  if (!k || !r) return "";
  const last = k.chain.at(-1) || {};
  const src = last.how === "inferred" ? "you worked it out" : last.how === "saw" || k.from === "self" ? (r.origin === who ? "you know it first-hand" : "you saw it yourself") : last.how === "partial" ? `you overheard part of it from ${nm(s, last.from)}` : `${nm(s, last.from)} told you${last.root && last.root !== last.from && !["saw", "truth", "inference", "self"].includes(last.root) ? `, and it started with ${nm(s, last.root)}` : ""}`;
  return `${r.text}${tag ? ` [${rid}]` : ""} (${SURE(k.conf)}; ${src}${k.partial ? "; you only heard part of it" : ""})`;
}

// the beliefs that matter now: about the people involved or the topic, surest first
export function relevantBeliefs(s, who, { people = [], topic = null, max = 7, min = 0.3 } = {}) {
  const v = actor(s, who);
  return Object.entries(v?.knows || {})
    .filter(([, k]) => k.conf >= min)
    .map(([rid, k]) => {
      const r = s.rumors[rid];
      let score = k.conf + Math.abs(r.harm || 0) * 0.2;
      if (people.includes(r.about) || people.includes(r.prop?.obj)) score += 2;
      if (topic && (r.about === topic || rid === topic || rootOf(s, rid) === rootOf(s, topic))) score += 3;
      if (r.kind === "liar" && people.includes(r.about)) score += 1;
      return [rid, score];
    })
    .sort((a, b) => b[1] - a[1]).slice(0, max).map(([rid]) => rid);
}
