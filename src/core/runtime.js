// The things every model call goes through: the pause gate, the spend ceiling, latency
// numbers, and the journal that makes a seeded day replay exactly.
//
// Pause: while paused nothing is sent, and an answer that arrives is held until unpause,
// so no state changes while the game is paused (closing the page pauses too).
//
// Journal: in "record" mode every model answer is written down in the order it arrived,
// along with the game's own steps (clock, player actions). In "replay" mode the answers
// come from the journal instead of the network and are released in the same order, so the
// same seed gives the same day, line for line.

let paused = false;
let waiters = [];
export function setPaused(on) {
  paused = !!on;
  if (!paused) { const w = waiters; waiters = []; for (const f of w) f(); }
}
export const isPaused = () => paused;
export function gate() {
  return paused ? new Promise((r) => waiters.push(r)) : null;
}
export async function through() { while (paused) await gate(); }

// ---------- spend ceiling ----------
// Claude calls per in-game hour. Normal play should almost never reach it; when it binds,
// fewer off-screen conversations start (never faked ones).
export const budget = { perHour: 160, used: {}, bound: {} };
const hourKey = (s) => `${s.day}:${Math.floor(s.minute / 60)}`;
export function spend(s, n = 1) { const k = hourKey(s); budget.used[k] = (budget.used[k] || 0) + n; }
export function canSpend(s, need = 3) {
  const k = hourKey(s);
  const ok = (budget.used[k] || 0) + need <= budget.perHour;
  if (!ok) budget.bound[k] = (budget.bound[k] || 0) + 1;
  return ok;
}

// ---------- latency ----------
export const latency = { reply: [], jev: [], claude: [] };
export function timed(kind, ms) { const a = latency[kind]; a.push(ms); if (a.length > 400) a.shift(); }
export function p95(kind) { const a = [...latency[kind]].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.95)] : 0; }

// ---------- journal ----------
let mode = "live"; // live | record | replay
let journal = [];
let cursor = 0;
const waiting = new Map(); // key -> resolve
let seq = 0;
// a new season numbers its calls from the start, so the same seed rolls the same stand-in dice
export function newSeason() { if (mode === "live") seq = 0; }
export function startRecording() { mode = "record"; journal = []; seq = 0; }
export function stopRecording() { const j = journal; mode = "live"; return j; }
export function startReplay(j) { mode = "replay"; journal = j; cursor = 0; seq = 0; waiting.clear(); }
export const replaying = () => mode === "replay";
export function note(entry) { if (mode === "record") journal.push(entry); }

const macrotask = typeof setImmediate === "function" ? () => new Promise((r) => setImmediate(r)) : () => new Promise((r) => setTimeout(r, 0));

// A model call. `run` performs it for real; in replay the recorded answer comes back instead,
// in its recorded order. Either way the caller carries on in a fresh task, so the order in
// which callers carry on is exactly the order the journal keeps.
let pending = 0;
export const inFlight = () => pending;
export async function call(kind, run) {
  pending++;
  try { return await callInner(kind, run); } finally { pending--; }
}
async function callInner(kind, run) {
  await through();
  const key = `${kind}#${++seq}`;
  if (mode === "replay") {
    const out = await new Promise((resolve) => waiting.set(key, resolve));
    await through();
    return out;
  }
  const out = await run(key);
  await macrotask();
  await through();
  if (mode === "record") journal.push({ t: "answer", key, out: out === undefined ? null : JSON.parse(JSON.stringify(out)) });
  return out;
}

// Replay a journal: answers are handed back in order, one per task, once their call has
// been made; the game's own steps (clock, player actions) go to `steps[e.t]`.
export async function replay(steps) {
  for (cursor = 0; cursor < journal.length; cursor++) {
    const e = journal[cursor];
    if (e.t === "answer") {
      let tries = 0;
      while (!waiting.has(e.key)) {
        if (++tries > 2000) throw new Error(`replay diverged: ${e.key} was never asked (waiting: ${[...waiting.keys()].slice(0, 5).join(", ")})`);
        await macrotask();
      }
      const f = waiting.get(e.key);
      waiting.delete(e.key);
      f(e.out);
    } else await steps[e.t]?.(e);
    await macrotask();
  }
  mode = "live";
}
export const pendingKeys = () => [...waiting.keys()];
