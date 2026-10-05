// Moves: what a line of dialogue does. Claude lists them with the words; code checks each one
// against the schema and the rules before anything is committed:
//   - the type is known, the span is real words from the line, the people named exist
//   - a woman's claim about anyone is something she believes (she cites it) or the lie Jev
//     chose for her; anything else is "ungrounded" and the line is written again
// Rejected moves are logged with the reason and retried (re-extracted or rewritten), never
// dropped silently.

import { nextId } from "./record.js";
import { nm } from "./mind.js";
import { overlap } from "./reading.js";

export const MOVE_TYPES = ["claim", "promise", "plan", "request", "agreement", "refusal", "threat", "accusation", "compliment", "insult", "secret", "question", "apology", "tone", "gift", "attack"];
export const SUBSTANTIVE = new Set(MOVE_TYPES.filter((t) => t !== "tone"));
const NEEDS_CONTENT = new Set(["claim", "promise", "plan", "request", "threat", "accusation", "secret"]);
export const COMMIT_KINDS = ["vote", "pact", "keep_quiet", "talk", "ask", "warn", "confront", "spread", "defend", "gift", "make_peace", "recruit", "lobby", "report", "other"];

const squash = (t) => String(t || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

// the span is real words from the line (allowing a dropped word or changed punctuation)
export function spanOk(line, span) {
  const L = squash(line), S = squash(span);
  if (!S) return false;
  if (L.includes(S)) return true;
  const ws = S.split(" ");
  let i = 0, hit = 0;
  for (const w of L.split(" ")) if (i < ws.length && w === ws[i]) { hit++; i++; } else if (i < ws.length && ws[i + 1] === w) { hit++; i += 2; }
  return hit / ws.length >= 0.8;
}

export function idByName(s, name, { speaker = null, listeners = [] } = {}) {
  const low = squash(name);
  if (!low) return null;
  if (low === squash(s.player.name) || low === "the newcomer" || low === "newcomer" || low === "the new girl") return "player";
  if (/^(you|her|yourself)$/.test(low) && listeners.length === 1) return listeners[0];
  if (/^(me|i|myself|herself)$/.test(low)) return speaker;
  if (/^(everyone|everybody|all|the crowd|the town|you all|ladies)$/.test(low)) return "everyone";
  if (low === "primrose" || low.startsWith("primrose ")) return "primrose";
  const v = Object.values(s.people).find((p) => squash(p.name.split(" ")[0]) === low || squash(p.name) === low || low.startsWith(squash(p.name.split(" ")[0]) + " "));
  return v?.id || null;
}

// Raw moves from Claude -> checked moves. Returns { moves, rejects }.
export function check(s, raw, { line, speaker, listeners, talk = null, ev = null }) {
  const moves = [], rejects = [];
  let tone = null;
  for (const m of Array.isArray(raw) ? raw : []) {
    const type = String(m?.type || "").toLowerCase().trim();
    if (!MOVE_TYPES.includes(type)) { rejects.push({ move: m, why: `unknown move type "${type}"` }); continue; }
    if (type === "tone") { tone = tone || String(m.content || m.tone || "neutral").toLowerCase(); continue; }
    if (!m.span || !spanOk(line, m.span)) { rejects.push({ move: m, why: "span is not words from the line" }); continue; }
    if (NEEDS_CONTENT.has(type) && !String(m.content || "").trim()) { rejects.push({ move: m, why: "no content" }); continue; }
    const ctx = { speaker, listeners };
    const about = m.about ? idByName(s, m.about, ctx) : null;
    if (m.about && !about) { rejects.push({ move: m, why: `unknown person "${m.about}"` }); continue; }
    const to = m.to ? idByName(s, m.to, ctx) : null;
    const target = m.target ? idByName(s, m.target, ctx) : null;
    const voteTarget = m.vote_target ? idByName(s, m.vote_target, ctx) : null;
    if ((type === "claim" || type === "accusation" || type === "secret") && !about) { rejects.push({ move: m, why: "a claim must be about someone" }); continue; }
    if (about && about !== "player" && about !== "everyone" && about !== "primrose" && s.people[about]?.gone && type !== "claim") { rejects.push({ move: m, why: "about someone who has left" }); continue; }
    const kind = COMMIT_KINDS.includes(String(m.kind || "").toLowerCase()) ? String(m.kind).toLowerCase() : null;
    moves.push({
      type, by: speaker, to: to && to !== "everyone" ? [to] : listeners, about: about === "everyone" ? null : about,
      content: String(m.content || m.span).trim().slice(0, 240), span: String(m.span).slice(0, 200),
      ...(type === "claim" || type === "secret" || type === "accusation" ? { pol: /deny|false|not/i.test(m.stance || "") ? -1 : 1 } : {}),
      ...(voteTarget ? { voteTarget } : {}), ...(kind ? { kind } : {}), ...(target ? { target } : {}), ...(m.topic ? { topic: String(m.topic).slice(0, 80) } : {}),
      ...(m.belief ? { belief: String(m.belief).replace(/^\[|\]$/g, "") } : {}), ...(m.lie ? { lie: true } : {}),
    });
  }
  // accusations, secrets and claims say something about someone: they are claims too
  return { moves, rejects, tone: tone || "neutral" };
}

// A woman's claim must be something she believes, or the lie Jev chose.
export function grounded(s, speaker, mv, { lie = null } = {}) {
  if (!["claim", "accusation", "secret"].includes(mv.type)) return { ok: true };
  if (speaker === "player") return { ok: true }; // the player can say anything; it's judged as said
  const v = s.people[speaker];
  if (lie && (mv.lie || (lie.about === mv.about && overlap(lie.content, mv.content) >= 0.3))) return { ok: true, lie: true };
  if (mv.about === speaker) return { ok: true, self: true }; // about herself: she knows her own life
  const cited = mv.belief && v.knows[mv.belief] && v.knows[mv.belief].conf >= 0.3 ? mv.belief : null;
  if (cited && s.rumors[cited].about === mv.about && overlap(s.rumors[cited].text, mv.content) >= 0.2 && (!mv.voteTarget || s.rumors[cited].prop?.obj === mv.voteTarget)) return { ok: true, rid: cited };
  // not cited (or cited wrong): a belief she holds that says the same thing
  let best = null, bo = 0;
  for (const [rid, k] of Object.entries(v.knows)) {
    const r = s.rumors[rid];
    // what a woman said she'd do, heard from her own mouth, can be repeated even if doubted
    const fromHer = r.prop?.pred === "votes_for" && k.chain?.some((l) => l.from === r.about);
    if (k.conf < 0.3 && !fromHer) continue;
    if (r.about !== mv.about && r.prop?.obj !== mv.about) continue;
    // a vote claim is only backed by a belief about that same vote
    if (mv.voteTarget && (r.prop?.pred !== "votes_for" || r.prop.obj !== mv.voteTarget || (r.prop.pol ?? 1) !== (mv.pol ?? 1))) continue;
    const o = overlap(r.text, mv.content);
    if (o > bo) { bo = o; best = rid; }
  }
  if (best && bo >= 0.34) return { ok: true, rid: best };
  // her own feelings ("Sylvie is fake") are hers to voice: an opinion, not a fact
  if (/\b(i think|i feel|i hate|i can't stand|i love|i adore|i don't trust|i trust)\b/i.test(mv.span)) return { ok: true, opinion: true };
  return { ok: false, why: `${nm(s, speaker)} claimed something she doesn't believe: "${mv.content}"` };
}

export function register(s, mv, { ev, talk }) {
  const m = { id: nextId(s, "mv"), ev, talk, ...mv, day: s.day, minute: s.minute, judged: {}, effects: {} };
  (s.moves ??= []).push(m);
  return m;
}
export const moveById = (s, id) => (s.moves || []).find((m) => m.id === id) || null;
