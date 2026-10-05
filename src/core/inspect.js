// The inspector: read-only questions about the record, for debugging and the test suite.
// Nothing here is shown to the player in play (she only sees what she has learned).

import * as B from "./beliefs.js";
import { evById, decisionById } from "./record.js";

const nm = (s, id) => (id === "player" ? s.player.name : s.people[id]?.name.split(" ")[0] || id);

// what each woman thinks of someone: her own feelings and the stories she believes about her
export function reputation(s, id) {
  const out = {};
  for (const v of Object.values(s.people)) {
    if (v.gone || v.id === id) continue;
    const r = s.rel[v.id]?.[id];
    if (!r) continue;
    const stories = Object.entries(v.knows || {}).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid]?.about === id).map(([rid]) => s.rumors[rid]);
    out[v.id] = {
      liking: +r.affinity.toFixed(2), trust: +r.trust.toFixed(2), respect: +(r.respect || 0).toFixed(2), fear: +(r.fear || 0).toFixed(2),
      suspicion: +B.suspicion(s, v.id, id).toFixed(2),
      bad: stories.filter((x) => (x.harm || 0) < 0).length, good: stories.filter((x) => (x.harm || 0) > 0).length,
    };
  }
  return out;
}

// who has heard a story (believes it, doubts it), from their own records
export const reach = (s, rid) => B.reach(s, rid);

// why something is the way it is: a change, a decision or an event, followed back cause by cause
export function why(s, start, depth = 10) {
  const chain = [];
  let id = start;
  const seen = new Set();
  while (id && chain.length < depth && !seen.has(id)) {
    seen.add(id);
    if (/^rule:|^player:/.test(id)) { chain.push({ id, what: id.startsWith("rule:") ? `the game's own clock or rules (${id.slice(5)})` : `the newcomer (${id.slice(7)})` }); break; }
    const d = decisionById(s, id);
    if (d) { chain.push({ id, what: `${nm(s, d.actor)} decided: ${d.text || d.label}` }); id = d.cause; continue; }
    const e = evById(s, id);
    if (e) { chain.push({ id, what: `${e.type}${e.actor ? ` by ${nm(s, e.actor)}` : ""}${e.content?.text ? `: "${e.content.text}"` : ""}` }); id = e.cause; continue; }
    const m = (s.moves || []).find((x) => x.id === id);
    if (m) { chain.push({ id, what: `${nm(s, m.by)} ${m.type}: "${m.span}"` }); id = m.ev; continue; }
    const c = (s.ledger || []).find((x) => x.id === id);
    if (c) { chain.push({ id, what: `${nm(s, c.by)} promised ${nm(s, c.to)}: ${c.what || c.kind}` }); id = c.cause; continue; }
    const i = (s.inferences || []).find((x) => x.id === id);
    if (i) { chain.push({ id, what: `${nm(s, i.by)} worked out: ${i.why}` }); id = i.cause; continue; }
    chain.push({ id, what: "?" });
    break;
  }
  return chain;
}

// a change in the trace (by who/what/key, latest first) and its causes
export function whyChange(s, { who, what, key }) {
  const c = [...(s.trace || [])].reverse().find((x) => x.who === who && x.what === what && (key == null || x.key === key));
  return c ? { change: c, chain: why(s, c.cause) } : null;
}
