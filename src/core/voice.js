// The words. Every line anyone in town says is written by Claude from that woman's own view
// (views.js) and the intent Jev already chose for her, and comes back with the moves it
// makes (claims, promises, requests…), each pointing at the words that made it. The words
// are never shown or kept until code has validated those moves and committed them.
//
// Claude is reached through the page's `sample` capability on claude.ai, or the Node
// server's /api/say. With neither, nobody speaks: conversations don't happen rather than
// being faked.

import { VILLAGERS, HOST } from "./cast.js";
import * as runtime from "./runtime.js";

let backend = null;   // "sample" | "server" | "test" | null
let sampleFn = null;
let failures = 0;
export const stats = { calls: 0, ms: 0, failed: 0, retries: 0, regenerated: 0, reextracted: 0 };

export async function initVoice() {
  try {
    if (typeof window !== "undefined" && window.claude?.use) {
      const s = await Promise.race([window.claude.use("sample"), new Promise((r) => setTimeout(() => r(null), 10000))]);
      if (s) { sampleFn = s; backend = "sample"; return backend; }
    }
  } catch {}
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    if (r.ok && (await r.json()).say) { backend = "server"; return backend; }
  } catch {}
  backend = null;
  return backend;
}

// tests: write the words with a function (prompt, meta) instead of Claude
let testFn = null;
export function __setWriter(fn) { testFn = fn; backend = fn ? "test" : null; }
export const available = () => !!backend;

export function voiceStatus() {
  if (backend === "sample") return { live: failures < 3, label: "Claude (your account)" };
  if (backend === "server") return { live: failures < 3, label: "Claude (server)" };
  if (backend === "test") return { live: true, label: "Test writer" };
  return { live: false, label: "No dialogue (Claude unavailable)" };
}
// the game's pause holds every call (see runtime.js); kept here for the page
export const setPaused = (on) => runtime.setPaused(on);

const first = (v) => v.first || v.name.split(" ")[0];
const cast = () => VILLAGERS.map((v) => `${v.name} (${v.job})`).join(", ");

let wearing = "";
export function setLook(text) { wearing = text || ""; }

const STYLE = (playerName) => `You write dialogue for "Gossiptown", a cozy-looking village reality show with a vicious heart. Ten women live in a tiny storybook town and every night they vote one of their own out. Think reality TV: catty, two-faced, shady, dramatic, funny. Sweet to faces, savage behind backs. Everyone is a woman. No romance, no flirting. No violence beyond a shove. No magic spells.
The cast: ${cast()}. The host is ${HOST.name}. The newcomer (the player) is called ${playerName}.${wearing ? ` Today ${playerName} is wearing ${wearing}.` : ""} Never invent other named townsfolk.`;

// ---------- the queue ----------
// At most three calls at once; what the player is waiting on goes first.
const AT_ONCE = 3;
let running = 0;
const queue = [];
function slot(pri) { return new Promise((go) => { queue.push({ pri, go, n: ++qn }); queue.sort((a, b) => b.pri - a.pri || a.n - b.n); pump(); }); }
let qn = 0;
function pump() { while (running < AT_ONCE && queue.length) { running++; queue.shift().go(); } }
const PRI = { player: 3, vote: 2, show: 2, talk: 1, background: 0 };
export const queued = () => queue.length;

async function raw(prompt, { maxMs = 30000, pri = "talk", meta = {}, s = null } = {}) {
  if (!backend) return null;
  if (s) runtime.spend(s);
  return runtime.call("claude", async () => {
    await slot(PRI[pri] ?? 0);
    try { return await send(prompt, { maxMs, meta }); } finally { running--; pump(); }
  });
}

async function send(prompt, { maxMs, meta }) {
  stats.calls++;
  const t0 = performance.now();
  try {
    let text = null;
    if (backend === "sample") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), maxMs);
      try { text = (await sampleFn(prompt, { modelTier: "quick", cache: false, signal: ctrl.signal })).text; } finally { clearTimeout(timer); }
    } else if (backend === "test") {
      text = await testFn(prompt, meta);
    } else if (backend === "server") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), maxMs);
      try {
        const r = await fetch("api/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }), signal: ctrl.signal });
        if (r.ok) text = (await r.json()).text;
      } finally { clearTimeout(timer); }
    }
    const ms = performance.now() - t0;
    stats.ms += ms;
    runtime.timed("claude", ms);
    if (text && String(text).trim()) { failures = 0; return String(text); }
  } catch (e) {
    if (e?.code === "not_granted") backend = null;
  }
  if (backend) failures++;
  stats.failed++;
  return null;
}

// ---------- reading the answer ----------

export function parseJSON(text) {
  if (!text) return null;
  const t = String(text).replace(/```(json)?/g, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j < i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}
export const cleanLine = (t) => String(t || "").trim().replace(/^["“]|["”]$/g, "").replace(/\*[^*]+\*/g, "").replace(/\s+/g, " ").trim();

const MOVE_HELP = `Moves (list every one the words make; each "span" must be copied exactly from the line):
- claim: states something about someone (who did what, who is voting for whom, who said what). Fields: about, content (one plain sentence that names her), stance ("affirm" or "deny"), and for a claim about someone's vote, vote_target. Cite the tag of what you know in "belief", or set "lie": true only if your instructions say to lie.
- promise: says she WILL do something for/with the listener. Fields: to, content, kind (vote | pact | keep_quiet | talk | ask | warn | confront | spread | defend | gift | other), target (who it's about, if anyone), topic.
- plan: says what she means to do (not as a promise to the listener). Same fields as promise.
- request: asks the listener to do something. Fields: to, content, kind (as above), target.
- agreement / refusal: says yes / no to a request. Field: content.
- question: asks something. Field: content, about.
- threat, accusation, insult, compliment, apology: Fields: to/about, content.
- secret: reveals something told in confidence (also list it as a claim).
- tone: exactly one, content is one word: warm, friendly, neutral, guarded, cool, hostile, sweet-but-fake, nervous.`;

// ---------- a woman says her line ----------
// ctx: { v, view (her payload), to: [names], present: [names], history: ["Name: words"],
//        intent: text, allowed: [rid...], lie: { about, content } | null, setting, playerName,
//        strict: bool (after an ungrounded claim) }
export async function turn(s, ctx, { pri = "talk" } = {}) {
  const { v, view, to, history, intent, lie, setting, playerName, strict, words = "1 to 2 short sentences, under 30 words" } = ctx;
  const prompt = `${STYLE(playerName)}

You are ${v.name}, the ${v.job} (${v.archetype}). Personality: ${v.traits.join(", ")}. You speak: ${v.voice}.
Everything you know, feel and remember is below. Nothing else is true to you.
${JSON.stringify(view, null, 1)}

${setting}
${history.length ? `What has been said so far:\n${history.join("\n")}\n` : ""}What you do now: ${intent}.
${lie ? `You have decided to lie: ${lie.content}. That lie is the only thing you may make up.` : "Do not make up any fact. Anything you claim about anyone must be one of the things you believe above (cite its [r..] tag)."}
${strict ? `Your last attempt claimed something you don't know. Claim only these, by tag: ${ctx.allowed.join(", ") || "nothing (make no claims about anyone)"}.` : ""}
Say it to ${to.join(" and ")} as ${first(v)}, ${words}, in your own voice. Plain spoken words: no quotation marks, no stage directions, no emoji.
${MOVE_HELP}
Answer with JSON only: {"line": "your words", "moves": [{"type": "...", "span": "...", ...}]}`;
  const text = await raw(prompt, { pri, s, meta: { kind: "turn", speaker: v.id, ctx } });
  if (!text) return null;
  const j = parseJSON(text);
  if (!j?.line) return { line: cleanLine(text.split("\n")[0]), moves: null, raw: text };
  return { line: cleanLine(j.line), moves: Array.isArray(j.moves) ? j.moves : null, raw: text };
}

// ---------- reading moves out of words (the player's, or a line whose moves didn't check out) ----------
export async function extract(s, { line, speaker, listeners, history = [], playerName, carrying = null, setting = "" }, { pri = "player" } = {}) {
  const prompt = `Read one line of dialogue from the village reality show "Gossiptown" and list every move it makes.
The cast: ${cast()}. The newcomer (the player) is called ${playerName}.
${setting}
${history.length ? `Conversation so far:\n${history.slice(-8).join("\n")}\n` : ""}${speaker} says to ${listeners.join(" and ")}: ${line}
${carrying ? `${speaker} is holding ${carrying}; if she hands it over, add a move {"type": "gift", "span": "...", "content": "${carrying}"}.\n` : ""}If she physically attacks the listener, add {"type": "attack", "span": "..."}.
${MOVE_HELP.replace(/ Cite the tag[^.]*\. *Set[^.]*\./, "").replace(/ Cite the tag of what you know in "belief", or set "lie": true only if your instructions say to lie\./, "")}
Use first names for about/to/target. Answer with JSON only: {"moves": [{"type": "...", "span": "...", ...}]}`;
  const text = await raw(prompt, { pri, s, meta: { kind: "extract", speaker, line, listeners } });
  const j = parseJSON(text);
  return Array.isArray(j?.moves) ? j.moves : null;
}

// ---------- Primrose (the host's lines are the format's own words, not a character's choices) ----------

// ---------- the vote ----------
// One call writes every ballot line while the player is still choosing; each voter's line is
// written from her own reasons (her decision) and comes back with its moves.
export async function ballotLines(s, { items, playerName, finale }) {
  if (!items.length) return {};
  const text = await raw(`${STYLE(playerName)}

It is ${finale ? "the finale. Women already voted out are the jury and each names the woman who should win the season" : "vote night at the firepit. Each woman names the woman she wants sent home"}. The host reads each ballot aloud and the voter says one short line as hers is read, in front of everyone.
${items.map((it) => `- ${it.v.name} (${it.v.voice}). Votes for ${it.target}. Her reasons: ${it.why}.`).join("\n")}
Write one line for each voter in her own voice, under 16 words, mentioning who she votes for by first name. Each line may only use her reasons above.
${MOVE_HELP}
Answer with JSON only: {"lines": [{"by": "first name", "line": "...", "moves": [...]}]}`, { maxMs: 30000, pri: "vote", s, meta: { kind: "ballots", items: items.map((it) => ({ id: it.v.id, target: it.target, why: it.why })) } });
  const j = parseJSON(text);
  const out = {};
  for (const l of j?.lines || []) {
    const it = items.find((x) => first(x.v).toLowerCase() === String(l.by || "").toLowerCase());
    if (it && l.line) out[it.v.id] = { line: cleanLine(l.line), moves: Array.isArray(l.moves) ? l.moves : [] };
  }
  return out;
}

export async function partingShot(s, { v, view, playerName, votedBy, betrayedBy }) {
  return turn(s, {
    v, view, to: ["everyone"], history: [], playerName,
    setting: `You have just been voted out of Gossiptown and must leave tonight. Voted against you: ${votedBy.join(", ") || "nobody you expected"}.${betrayedBy.length ? ` You feel betrayed by ${betrayedBy.join(", ")}.` : ""}`,
    intent: "say your exit line: one or two dramatic sentences", allowed: [], words: "one or two dramatic sentences, under 28 words",
  }, { pri: "vote" });
}
