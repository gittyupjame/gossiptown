// Jev client for the browser. One call = one state + named questions, answered in parallel.
// Each question may carry a `prior` used only by the offline stand-in; it is stripped
// before the request goes out.
//
//   choice: { type, instructions, criteria: { key: description }, prior?: { key: weight } }
//   score:  { type, instructions, criteria: [level, ...],          prior?: index }
//   noul:   { type, instructions,                                  prior?: probability }
//
// Answers come back normalized:
//   choice -> { pick, probs }   pick is SAMPLED from Jev's probabilities, not the top option
//   score  -> { value, level }  value is 0..levels-1 (expected value)
//   noul   -> { p, yes }        yes is sampled from p
//
// Where calls go (set by the page with configure()):
//   proxy: "/api/jev"   a server that holds the key (the Node server in this repo)
//   key:   "apikey_..." call api.typesafe.ai straight from the browser
//   neither             the offline stand-in

const DIRECT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

const cfg = { proxy: null, key: null };
let failedAt = 0;
let lastError = null;

export const stats = { calls: 0, real: 0, standIn: 0, ms: 0 };
export const recent = []; // the last calls, for the debug view
let hook = null; // tests can watch every decision
export function __setAskHook(fn) { hook = fn; }

export function configure({ proxy = null, key = null } = {}) {
  cfg.proxy = proxy; cfg.key = key; failedAt = 0; lastError = null;
}

export function status() {
  if (!cfg.proxy && !cfg.key) return { live: false, label: "Offline stand-in", why: "No Jev connection set up" };
  if (failedAt) return { live: false, label: "Offline stand-in", why: `Jev unreachable: ${lastError}` };
  if (!stats.real) return { live: false, label: "Connecting to Jev", why: "waiting for the first answer" };
  return { live: true, label: "Jev", why: stats.real ? `${stats.real} live calls` : "connected" };
}

export async function ask(state, questions, label = "") {
  stats.calls++;
  const t0 = performance.now();
  let raw = null;
  const canTry = (cfg.proxy || cfg.key) && (!failedAt || Date.now() - failedAt > 60000);
  if (canTry) {
    try {
      raw = await callJev(state, questions);
      stats.real++;
      failedAt = 0;
    } catch (e) {
      failedAt = Date.now();
      lastError = e.message;
      console.warn("[jev] falling back to the stand-in:", e.message);
    }
  }
  const live = !!raw;
  if (!raw) { raw = standIn(questions); stats.standIn++; }
  stats.ms += performance.now() - t0;
  const out = {};
  for (const [k, q] of Object.entries(questions)) out[k] = normalize(q, raw[k]);
  recent.push({ label, live, state, answers: out });
  hook?.(state, questions, label, out);
  if (recent.length > 60) recent.shift();
  return out;
}

async function callJev(state, questions) {
  const qs = {};
  for (const [k, q] of Object.entries(questions)) {
    const { prior, ...rest } = q;
    qs[k] = rest;
  }
  const body = JSON.stringify({ model: MODEL, state, questions: qs });
  const headers = { "Content-Type": "application/json" };
  if (!cfg.proxy) headers.Authorization = `Bearer ${cfg.key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(cfg.proxy || DIRECT, { method: "POST", headers, body, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.answers) throw new Error("no answers in reply");
    return data.answers;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "timed out" : e.message || "network error");
  } finally {
    clearTimeout(timer);
  }
}

// ---- turning raw answers into something the game can use ----

export function sample(probs) {
  const entries = Object.entries(probs);
  const total = entries.reduce((s, [, p]) => s + p, 0) || 1;
  let r = Math.random() * total;
  for (const [k, p] of entries) { r -= p; if (r <= 0) return k; }
  return entries.at(-1)[0];
}

function normalize(q, a = {}) {
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    let probs = a.probabilities && Object.keys(a.probabilities).length ? a.probabilities : null;
    if (!probs) probs = Object.fromEntries(keys.map((k) => [k, k === a.choice ? 1 : 0]));
    probs = Object.fromEntries(keys.map((k) => [k, Number(probs[k]) || 0]));
    if (!Object.values(probs).some((p) => p > 0)) probs = Object.fromEntries(keys.map((k) => [k, 1]));
    return { pick: sample(probs), probs };
  }
  if (q.type === "score") {
    const n = q.criteria.length;
    let value;
    const probs = a.probabilities || null;
    if (probs) {
      const arr = q.criteria.map((lvl, i) => Number(probs[lvl] ?? probs[i] ?? probs[String(i)] ?? 0));
      const tot = arr.reduce((s, p) => s + p, 0);
      if (tot > 0) value = arr.reduce((s, p, i) => s + p * i, 0) / tot;
    }
    if (value === undefined) value = typeof a.score === "number" ? a.score : (n - 1) / 2;
    value = Math.max(0, Math.min(n - 1, value));
    return { value, level: q.criteria[Math.round(value)] };
  }
  const p = typeof a.noul === "number" ? a.noul : 0.5;
  return { p, yes: Math.random() < p };
}

// ---- offline stand-in: the priors with some noise, in the same shapes as Jev ----

const jitter = (x, amt) => Math.max(0.001, x * (1 + (Math.random() - 0.5) * amt));

function standIn(questions) {
  const out = {};
  for (const [k, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const w = q.prior || {};
      const probs = Object.fromEntries(keys.map((key) => [key, jitter(w[key] ?? 1, 0.6)]));
      const tot = Object.values(probs).reduce((s, p) => s + p, 0);
      for (const key of keys) probs[key] /= tot;
      out[k] = { probabilities: probs };
    } else if (q.type === "score") {
      const n = q.criteria.length;
      const center = q.prior ?? (n - 1) / 2;
      out[k] = { score: Math.max(0, Math.min(n - 1, center + (Math.random() - 0.5) * 1.2)) };
    } else {
      out[k] = { noul: Math.max(0.01, Math.min(0.99, jitter(q.prior ?? 0.5, 0.3))) };
    }
  }
  return out;
}
