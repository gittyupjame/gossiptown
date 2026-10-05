// Where everyone is, how long it takes to get somewhere, and who can see or hear whom.
// The core keeps its own idea of every spot (the page walks the 3D figures to these
// spots), so perception works the same in a headless season and on screen.
//
//   v.location  the place she is at, "home" (inside her cottage), or "lane" (on the way)
//   v.spot      { x, z } where she stands (her door when she is home)
//   v.dest      where she is headed while location is "lane"; v.arrive is the minute she gets there
//
// Hearing: every word within FULL metres, fragments within PART, nothing beyond. Talking
// discreetly halves both. Sight: anyone outdoors within SIGHT metres. Nobody inside a
// cottage sees or hears the street, and nobody on the street hears inside.

import { PLACE_SPOTS, homeDoor } from "../client/layout.js";
import { rand } from "./rng.js";

export const FULL = 5, PART = 11, SIGHT = 26;
export const MIN_PER_M = 0.8; // in-game minutes per metre walked

export function placeSpot(place) {
  return PLACE_SPOTS[place] || null;
}

// A free spot at a place, away from where others already stand.
export function spotIn(s, place, { near = null, avoid = [] } = {}) {
  if (place === "home") return null;
  const p = PLACE_SPOTS[place];
  if (!p) return { x: 0, z: 0 };
  for (let k = 0; k < 30; k++) {
    let x, z;
    if (near) { const a = rand() * Math.PI * 2; x = near.x + Math.cos(a) * 1.15; z = near.z + Math.sin(a) * 1.15; }
    else if (p.line) { x = p.x + (rand() - 0.5) * 1.6; z = p.z - rand() * 8; }
    else { const a = rand() * Math.PI * 2, rr = (p.inner || 0) + rand() * (p.r - (p.inner || 0)); x = p.x + Math.cos(a) * rr; z = p.z + Math.sin(a) * rr; }
    if (avoid.some((t) => t && Math.hypot(t.x - x, t.z - z) < 1.1)) continue;
    return { x: +x.toFixed(2), z: +z.toFixed(2) };
  }
  return near ? { x: near.x + 1.1, z: near.z } : { x: p.x, z: p.z };
}

export function anchor(id, place) {
  if (place === "home") return homeDoor(id);
  const p = PLACE_SPOTS[place];
  return p ? { x: p.x, z: p.z } : { x: 0, z: 26 };
}

// Where someone is right now (the player's real position comes from the page).
export function pos(s, id) {
  if (id === "player") return s.player.pos || (s.player.location && PLACE_SPOTS[s.player.location] ? anchor("player", s.player.location) : { x: 2, z: 6 });
  const v = s.people[id];
  if (!v) return null;
  if (v.location === "lane") return midway(s, v);
  return v.spot || anchor(id, v.location);
}

// partway along the road while walking
function midway(s, v) {
  const from = v.from || v.spot || anchor(v.id, "plaza"), to = v.destSpot || anchor(v.id, v.dest);
  const total = Math.max(1, (v.arrive ?? 0) - (v.leftAt ?? 0));
  const f = Math.max(0, Math.min(1, ((s.day * 1440 + s.minute) - (v.leftAt ?? 0)) / total));
  return { x: from.x + (to.x - from.x) * f, z: from.z + (to.z - from.z) * f };
}

export function locOf(s, id) {
  if (id === "player") return s.player.location || "plaza";
  return s.people[id]?.location;
}
export const indoors = (s, id) => locOf(s, id) === "home";
export const present = (s, id) => {
  if (id === "player") return !s.player.out && s.phase !== "over";
  const v = s.people[id];
  return !!v && !v.gone;
};

export function dist(s, a, b) {
  const pa = pos(s, a), pb = pos(s, b);
  if (!pa || !pb) return Infinity;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}

// How long a walk takes, in game minutes.
export function travelMinutes(from, to) {
  if (!from || !to) return 10;
  return Math.max(2, Math.round(Math.hypot(from.x - to.x, from.z - to.z) * MIN_PER_M));
}

// How well `who` perceives something happening at `at` (a point), said by `speaker`.
//   "full" | "partial" | "saw" | null
export function perceive(s, who, at, { discreet = false, place = null, sound = true } = {}) {
  if (!present(s, who)) return null;
  const loc = locOf(s, who);
  if (loc === "home") return null; // inside: sees and hears nothing outside
  if (place === "home") return null;
  const p = pos(s, who);
  if (!p || !at) return null;
  const d = Math.hypot(p.x - at.x, p.z - at.z);
  const k = discreet ? 0.5 : 1;
  if (sound && d <= FULL * k) return "full";
  if (sound && d <= PART * k) return "partial";
  if (d <= SIGHT) return "saw";
  return null;
}

// Everyone (women and the player) who could perceive something at a point.
export function audience(s, at, opts = {}) {
  const out = [];
  for (const id of [...Object.keys(s.people), "player"]) {
    if (opts.exclude?.includes(id)) continue;
    const how = perceive(s, id, at, opts);
    if (how) out.push({ id, how });
  }
  return out;
}

export const centre = (pts) => {
  const ps = pts.filter(Boolean);
  if (!ps.length) return null;
  return { x: ps.reduce((t, p) => t + p.x, 0) / ps.length, z: ps.reduce((t, p) => t + p.z, 0) / ps.length };
};
