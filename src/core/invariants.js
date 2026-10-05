// Checks that must hold after every tick. Each breach is logged as a violation; the test
// suite fails on any, and the play link keeps them for the inspector.

const DIMS = ["affinity", "trust", "respect", "fear", "debt"];
const finite = (x) => typeof x === "number" && Number.isFinite(x);

export function checkInvariants(s) {
  const bad = [];
  const add = (rule, detail) => bad.push({ rule, detail });
  const present = (id) => (id === "player" ? !s.player.out : !!s.people[id] && !s.people[id].gone);

  // feelings stay numbers, in range
  for (const [a, row] of Object.entries(s.rel || {})) for (const [b, r] of Object.entries(row)) for (const k of DIMS) {
    const x = r[k] ?? 0;
    if (!finite(x) || Math.abs(x) > 4) add("feeling-range", { a, b, k, x });
  }
  // every belief comes from somewhere and is about a claim that exists
  const holders = [...Object.values(s.people).map((v) => [v.id, v.knows]), ["player", s.player.knows]];
  for (const [id, knows] of holders) for (const [rid, k] of Object.entries(knows || {})) {
    if (!s.rumors[rid]) { add("belief-unknown-claim", { id, rid }); continue; }
    if (!k.chain?.length) add("belief-without-chain", { id, rid });
    if (!finite(k.conf) || k.conf < 0 || k.conf > 1) add("belief-range", { id, rid, conf: k.conf });
  }
  // a promise that is no longer open was closed for a reason
  for (const c of s.ledger || []) {
    if (!["open", "kept", "broken", "dropped", "impossible", "abandoned", "released"].includes(c.status)) add("commit-status", { c: c.id, status: c.status });
    if (c.status !== "open" && c.status !== "kept" && !c.settleCause) add("commit-closed-without-cause", { c: c.id, status: c.status });
  }
  // talks only between people who are still here, and nobody in two at once
  const inTalk = {};
  for (const t of Object.values(s.talks || {})) if (t.status === "active") {
    for (const id of [t.a, t.b]) {
      if (!present(id)) add("talk-with-absent", { talk: t.id, id });
      if (inTalk[id]) add("two-talks", { id, talks: [inTalk[id], t.id] });
      inTalk[id] = t.id;
    }
  }
  // women who are gone stay gone
  for (const v of Object.values(s.people)) if (v.gone && v.location !== "gone") add("gone-but-placed", { id: v.id, at: v.location });
  return bad;
}
