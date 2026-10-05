// Seeded randomness. Every roll the town makes (Jev's sampled answers, the stand-in's
// noise, who meets whom) comes from one generator whose state lives in the season, so a
// seed plus the recorded model outputs replays a day exactly, and saving keeps the stream.

let state = { rng: 1 };

// Point the generator at a season (its `rng` field is the stream's position).
export function bind(s) {
  if (!Number.isFinite(s.rng)) s.rng = seedFrom(s.seed ?? Date.now());
  state = s;
}

export function seedFrom(x) {
  let h = 2166136261 >>> 0;
  for (const c of String(x)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

// mulberry32
export function rand() {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const pick = (a) => a[Math.floor(rand() * a.length)];
export const shuffle = (a) => a.map((x) => [rand(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
