// Jev client. One call = one state + named questions, answered in parallel.
// Each question may carry a `prior` used only by the offline stand-in; it is
// stripped before the request goes out.
//
//   choice: { type, instructions, criteria: { key: description }, prior?: { key: weight } }
//   score:  { type, instructions, criteria: [level, ...],          prior?: index }
//   noul:   { type, instructions,                                  prior?: probability }
//
// Answers come back normalized:
//   choice -> { pick, probs: { key: p } }   pick is SAMPLED, not the top option
//   score  -> { value, level, probs }       value is 0..levels-1 (expected value)
//   noul   -> { p, yes }                    yes is sampled from p

import { appendFileSync } from "node:fs";

const URL = process.env.JEV_URL || "https://api.typesafe.ai/v1/systemone";
const KEY = process.env.JEV_API_KEY || "";
const MODEL = process.env.JEV_MODEL || "jev-latest";
let offline = !KEY || process.env.JEV_OFFLINE === "1";
let warned = false;

export const stats = { calls: 0, real: 0, standIn: 0, ms: 0, inputTokens: 0 };
export function mode() { return offline ? "stand-in (no Jev)" : "Jev"; }

function log(line) { try { appendFileSync("log.txt", line + "\n"); } catch {} }

export async function ask(state, questions, label = "") {
  stats.calls++;
  const t0 = Date.now();
  let raw = null;
  if (!offline) {
    try {
      raw = await callJev(state, questions);
      stats.real++;
    } catch (e) {
      if (!warned) { warned = true; console.log(`\n[jev] call failed (${e.message}); using the offline stand-in from now on.`); }
      offline = true;
    }
  }
  if (!raw) { raw = standIn(questions); stats.standIn++; }
  stats.ms += Date.now() - t0;
  const out = {};
  for (const [k, q] of Object.entries(questions)) out[k] = normalize(q, raw[k]);
  log(JSON.stringify({ label, state: typeof state === "string" ? state.slice(0, 400) : state, answers: out }));
  return out;
}

async function callJev(state, questions) {
  const qs = {};
  for (const [k, q] of Object.entries(questions)) {
    const { prior, ...rest } = q;
    qs[k] = rest;
  }
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, state, questions: qs }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  stats.inputTokens += body.usage?.input_tokens || 0;
  return body.answers || {};
}

// ---- turning raw answers into something the game can use ----

function sample(probs) {
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
    // keep only known keys
    probs = Object.fromEntries(keys.map((k) => [k, Number(probs[k]) || 0]));
    return { pick: sample(probs), probs };
  }
  if (q.type === "score") {
    const n = q.criteria.length;
    let value;
    let probs = a.probabilities || null;
    if (probs) {
      // keys may be level names or indices
      const arr = q.criteria.map((lvl, i) => Number(probs[lvl] ?? probs[i] ?? probs[String(i)] ?? 0));
      const tot = arr.reduce((s, p) => s + p, 0);
      if (tot > 0) value = arr.reduce((s, p, i) => s + p * i, 0) / tot;
    }
    if (value === undefined) value = typeof a.score === "number" ? a.score : (n - 1) / 2;
    value = Math.max(0, Math.min(n - 1, value));
    return { value, level: q.criteria[Math.round(value)], probs };
  }
  // noul
  const p = typeof a.noul === "number" ? a.noul : 0.5;
  return { p, yes: Math.random() < p };
}

// ---- offline stand-in: rough priors with noise, same shapes as Jev ----

function jitter(x, amt) { return Math.max(0.001, x * (1 + (Math.random() - 0.5) * amt)); }

function standIn(questions) {
  const out = {};
  for (const [k, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const w = q.prior || {};
      const probs = Object.fromEntries(keys.map((key) => [key, jitter(w[key] ?? 1, 0.6)]));
      const tot = Object.values(probs).reduce((s, p) => s + p, 0);
      for (const key of keys) probs[key] /= tot;
      out[k] = { type: "choice", probabilities: probs };
    } else if (q.type === "score") {
      const n = q.criteria.length;
      const center = q.prior ?? (n - 1) / 2;
      out[k] = { type: "score", score: Math.max(0, Math.min(n - 1, center + (Math.random() - 0.5) * 1.2)) };
    } else {
      out[k] = { type: "noul", noul: Math.max(0.01, Math.min(0.99, jitter(q.prior ?? 0.5, 0.3))) };
    }
  }
  return out;
}
