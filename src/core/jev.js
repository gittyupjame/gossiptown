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

import { rand, seedFrom } from "./rng.js";
import * as runtime from "./runtime.js";

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

// Every call goes through the runtime: held while paused, recorded for replay, and the
// sampling happens after the answer is in, from the season's seeded dice.
export async function ask(state, questions, label = "") {
  stats.calls++;
  const t0 = performance.now();
  let live = false;
  const raw = await runtime.call("jev", async (key) => {
    const canTry = (cfg.proxy || cfg.key) && (!failedAt || Date.now() - failedAt > 60000);
    if (canTry) {
      try {
        const r = await callJev(state, questions);
        stats.real++; failedAt = 0; live = true;
        return r;
      } catch (e) {
        failedAt = Date.now();
        lastError = e.message;
        console.warn("[jev] falling back to the stand-in:", e.message);
      }
    }
    stats.standIn++;
    return standIn(questions, key);
  });
  const ms = performance.now() - t0;
  stats.ms += ms;
  runtime.timed("jev", ms);
  const out = {};
  for (const [k, q] of Object.entries(questions)) out[k] = normalize(q, raw?.[k]);
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
  let r = rand() * total;
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
  return { p, yes: rand() < p };
}

// ---- offline stand-in: the priors with some noise, in the same shapes as Jev ----

// its own dice, seeded from the season and the call, so it never shifts the town's own dice
let seed = "gossiptown";
export function setSeed(x) { seed = String(x); }
function dice(key) {
  let st = seedFrom(`${seed}|${key}`);
  return () => {
    let t = (st = (st + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standIn(questions, key = "") {
  const r = dice(key);
  const jitter = (x, amt) => Math.max(0.001, x * (1 + (r() - 0.5) * amt));
  const out = {};
  for (const [k, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const w = q.prior || {};
      const probs = Object.fromEntries(keys.map((key2) => [key2, jitter(Math.max(0, w[key2] ?? 1), 0.6)]));
      const tot = Object.values(probs).reduce((s, p) => s + p, 0);
      for (const key2 of keys) probs[key2] /= tot;
      out[k] = { probabilities: probs };
    } else if (q.type === "score") {
      const n = q.criteria.length;
      const center = q.prior ?? (n - 1) / 2;
      out[k] = { score: Math.max(0, Math.min(n - 1, center + (r() - 0.5) * 1.2)) };
    } else {
      out[k] = { noul: Math.max(0.01, Math.min(0.99, jitter(q.prior ?? 0.5, 0.3))) };
    }
  }
  return out;
}
