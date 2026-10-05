import * as F from "./fixtures.mjs";
const { ok } = F;
const alive = (s) => Object.values(s.people).filter((v) => !v.gone);
const holders = (s) => [...Object.values(s.people).map((v) => [v.id, v]), ["player", s.player]];

// one claim told by a speaker to a listener, as a line
async function tell(c, S, L, rid, extra = {}) {
  const r = c.s.rumors[rid];
  const A0 = F.at(c, S);
  F.put(c, L, c.s.people[S].location, { x: A0.x + 0.8, z: A0.z });
  return F.speak(c, S, L, [{ text: r.text, moves: [{ type: "claim", about: r.about === "player" ? c.s.player.name : F.first(c, r.about), content: r.text, belief: rid, ...extra }] }], extra.plan ? { plan: extra.plan } : {});
}

export const tests = [
  { id: "BEL-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    for (const [id, v] of holders(s)) for (const [rid, k] of Object.entries(v.knows || {})) {
      n++;
      const r = s.rumors[rid];
      if (!r || !(r.about || r.prop?.subject) || !r.text) bad.push(`${id}:${rid} subject/claim`);
      if (typeof k.conf !== "number" || k.conf < 0 || k.conf > 1) bad.push(`${id}:${rid} conf`);
      if (!k.chain?.length) bad.push(`${id}:${rid} chain`);
      if (!k.formed || k.formed.day == null) bad.push(`${id}:${rid} formed`);
    }
    return ok(!bad.length, `${n} beliefs; ${bad.length} missing a field ${bad.slice(0, 3)}`);
  } },
  { id: "BEL-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const miss = alive(s).filter((v) => { const cats = new Set(Object.keys(v.knows).filter((r) => v.knows[r].conf >= 0.3).map((r) => s.rumors[r]?.cat)); return !(cats.has("world") && cats.has("trait") && cats.has("mind")); });
    return ok(!miss.length, `${alive(s).length - miss.length}/${alive(s).length} women hold world, trait and mind beliefs${miss.length ? `; missing: ${miss.map((v) => v.id)}` : ""}`);
  } },
  { id: "BEL-3", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const infs = new Set((s.inferences || []).map((i) => i.id));
    let n = 0; const bad = [];
    for (const [id, v] of holders(s)) for (const [rid, k] of Object.entries(v.knows || {})) for (const l of k.chain) {
      n++;
      if (l.inf) { if (!infs.has(l.inf) && (s.inferences || []).length < 800) bad.push(`${id}:${rid} inference ${l.inf}`); continue; }
      const e = l.ev && F.R.evById(s, l.ev);
      if (!e) { bad.push(`${id}:${rid} no event`); continue; }
      if (!e.perceivers.some((p) => p.id === id)) bad.push(`${id}:${rid} never perceived ${l.ev}`);
    }
    return ok(!bad.length, `${n} source links; ${bad.length} not ending at an event she perceived or a logged inference ${bad.slice(0, 3)}`);
  } },
  { id: "BEL-4", kind: "scenario", fn: async () => {
    const res = await F.over([41, 42, 43, 44, 45, 46], async (sd) => {
      const out = [];
      for (const trusted of [true, false]) {
        const c = await F.town(sd);
        const S = "celeste", L = "marigold";
        const r = c.s.rel[L][S]; r.trust = trusted ? 2.2 : -2.2; r.affinity = trusted ? 2 : -2;
        const rid = F.knowAs(c, S, "tansy", "Tansy reads other people's letters before delivering them");
        await tell(c, S, L, rid);
        out.push(F.conf(c, L, rid));
      }
      return out;
    });
    const fr = F.mean(res.map((x) => x[0])), rv = F.mean(res.map((x) => x[1]));
    return ok(fr - rv >= 0.15, `mean confidence from a trusted friend ${fr.toFixed(2)} vs from a rival ${rv.toFixed(2)} (6 seeds)`);
  } },
  { id: "BEL-5", kind: "scenario", fn: async () => {
    const c = await F.town(47);
    const s = c.s;
    const rid = F.B.newClaim(s, { about: "hesper", text: "Hesper fixed the flower show for her niece", origin: "truth", isTrue: true, harm: -0.8 });
    const e1 = F.R.emit(s, { type: "history", content: { text: "x" }, perceivers: [{ id: "pippa", how: "did" }, { id: "brenna", how: "did" }], cause: "rule:test" });
    F.B.learn(s, "pippa", rid, { conf: 0.5, from: "wren", root: "wren", ev: e1.id, how: "told", cause: e1.id });
    F.B.learn(s, "pippa", rid, { conf: 0.5, from: "wren", root: "wren", ev: e1.id, how: "told", cause: e1.id });
    F.B.learn(s, "brenna", rid, { conf: 0.5, from: "wren", root: "wren", ev: e1.id, how: "told", cause: e1.id });
    F.B.learn(s, "brenna", rid, { conf: 0.5, from: "juniper", root: "juniper", ev: e1.id, how: "told", cause: e1.id });
    const same = F.conf(c, "pippa", rid), two = F.conf(c, "brenna", rid);
    return ok(two > same + 0.1, `twice from one teller: ${same.toFixed(2)}; once each from two unconnected tellers: ${two.toFixed(2)}`);
  } },
  { id: "BEL-6", kind: "scenario", fn: async () => {
    let good = 0, tried = 0, detail = "";
    for (const sd of [51, 52, 53, 54, 55, 56]) {
      const c = await F.town(sd);
      const s = c.s;
      const a = F.knowAs(c, "celeste", "brenna", "Brenna is voting to send Pippa home", { kind: "vote", harm: -0.6, prop: { subject: "brenna", pred: "votes_for", obj: "pippa", pol: 1 } });
      await tell(c, "celeste", "pippa", a, { vote_target: "Pippa" });
      const b = F.knowAs(c, "odette", "brenna", "Brenna is not voting to send Pippa home", { kind: "vote", harm: 0.3, prop: { subject: "brenna", pred: "votes_for", obj: "pippa", pol: -1 } });
      const r2 = await tell(c, "odette", "pippa", b, { vote_target: "Pippa", stance: "deny" });
      tried++;
      const d = s.decisions.filter((x) => x.actor === "pippa" && x.cause === r2.L.ev.id).find((x) => Object.keys(x.q).some((k) => k.endsWith("_clash")));
      const rec = (s.resolutions || []).find((x) => x.by === "pippa");
      const ks = Object.entries(s.people.pippa.knows).filter(([rid]) => s.rumors[rid].about === "brenna" && s.rumors[rid].prop?.pred === "votes_for").map(([, k]) => k.conf);
      const one = ks.length >= 2 && Math.max(...ks) - Math.min(...ks) >= 0.15;
      // a teller, or Brenna herself if Pippa decides Brenna is telling people different things
      const susp = Math.max(F.B.suspicion(s, "pippa", "celeste"), F.B.suspicion(s, "pippa", "odette"), rec?.pick === "two_faced" ? F.B.suspicion(s, "pippa", "brenna") : 0);
      if (one && susp > 0 && (rec || s.decisions.some((x) => x.actor === "pippa" && Object.entries(x.q).some(([k, q]) => k.endsWith("_liar") && q.yes)))) good++;
      F.dbg?.(sd, ks, susp, rec?.pick); if (!detail && rec) detail = `resolution "${rec?.pick}"; confidences ${ks.map((x) => x.toFixed(2)).join(" vs ")}; suspicion of a teller (or of Brenna) ${susp.toFixed(2)}`;
    }
    return ok(good >= tried - 1, `${good}/${tried} seeds resolved to one belief and/or a suspicion, with the resolution logged. e.g. ${detail}`);
  } },
  { id: "BEL-7", kind: "audit", fn: async () => {
    const all = [await F.main(), ...(await F.seeds())];
    let n = 0, bad = 0, lower = 0;
    for (const { s } of all) for (const i of s.inferences || []) { n++; if (!i.from?.length || !i.from.every((r) => s.rumors[r])) bad++; if (i.conf <= 0.85) lower++; }
    return ok(n > 0 && !bad && lower === n, `${n} inferences; ${bad} without the beliefs they came from; all capped below sight: ${lower === n}`);
  } },
  { id: "BEL-8", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let bad = 0;
    for (const sec of Object.values(s.secrets)) { const k = F.B.secretKnowers(s, sec).join(","); if (k !== [...sec.knowers].sort().join(",")) bad++; if (!sec.owner || !s.rumors[sec.rid]) bad++; }
    return ok(!bad, `${Object.keys(s.secrets).length} secrets, owner + true content + knower set; ${bad} out of sync`);
  } },

  { id: "SPR-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const CH = new Set(["line", "show_line", "board_post", "board_read", "announcement", "fight", "gift", "snoop", "outfit", "ballot", "elimination", "outburst", "mail", "history", "talk_open", "arrive"]);
    const by = {};
    let bad = 0;
    for (const [, v] of holders(s)) for (const k of Object.values(v.knows || {})) for (const l of k.chain) { if (l.inf) { by.inference = (by.inference || 0) + 1; continue; } const e = F.R.evById(s, l.ev); if (!e || !CH.has(e.type)) bad++; else by[e.type] = (by[e.type] || 0) + 1; }
    return ok(!bad, `${bad} beliefs from outside the in-world channels; by channel: ${JSON.stringify(by)}`);
  } },
  { id: "SPR-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    const decided = new Set(s.decisions.map((d) => d.id));
    for (const e of s.world.filter((e) => e.type === "line" && s.people[e.actor])) {
      const mv = (e.content.moves || []).map((id) => s.moves.find((m) => m.id === id)).filter((m) => m && ["claim", "accusation", "secret"].includes(m.type) && m.about !== e.actor);
      if (!mv.length) continue;
      n++;
      if (!/^d\d+$/.test(e.cause) || !decided.has(e.cause)) bad.push(e.id);
    }
    return ok(n > 0 && !bad.length, `${n} retellings; ${bad.length} without a logged decision to say it`);
  } },
  { id: "SPR-3", kind: "scenario", fn: async () => {
    const all = [await F.main(), ...(await F.seeds())];
    let mut = 0, both = 0;
    for (const { s } of all) for (const m of s.moves) if (m.mutated) { mut++; const r = s.rumors[m.rid]; if (r?.parent && s.rumors[r.parent]) both++; }
    return ok(mut > 0 && both === mut, `${mut} retellings changed the story across ${all.length} seeded seasons; both versions stored for ${both}`);
  } },
  { id: "SPR-4", kind: "scenario", fn: async () => {
    let good = 0, n = 0;
    for (const sd of [61, 62, 63, 64, 65, 66]) {
      const c = await F.town(sd);
      const s = c.s;
      const text = "Pippa cheated at the bake-off with a store-bought pie";
      const rid = F.B.newClaim(s, { about: "pippa", text, origin: "odette", isTrue: false, harm: -1 });
      const e = F.R.emit(s, { type: "history", content: { text: `Odette told me: ${text}` }, perceivers: [{ id: "wren", how: "did" }, { id: "odette", how: "did" }], cause: "rule:test" });
      F.B.learn(s, "wren", rid, { conf: 0.8, from: "odette", root: "odette", ev: e.id, how: "told", cause: e.id });
      await tell(c, "wren", "pippa", rid);
      n++;
      if (F.B.suspicion(s, "pippa", "odette") > 0) good++;
    }
    return ok(good >= n / 2, `told a lie about herself second-hand, Pippa suspects the original teller (Odette) in ${good}/${n} seeds`);
  } },
  { id: "SPR-5", kind: "audit", fn: async () => {
    const all = [await F.main(), ...(await F.seeds())];
    const pts = []; let fresh = 0, stale = 0;
    for (const { s } of all) {
      const tells = {};
      for (const m of s.moves) if (m.rid && ["claim", "secret", "accusation"].includes(m.type) && s.people[m.by]) { const root = F.B.rootOf(s, m.rid); (tells[root] ||= []).push(m.day - (s.rumors[root].day || 0)); }
      for (const r of Object.values(s.rumors)) if (r.id === F.B.rootOf(s, r.id) && r.kind !== "liar") { const ts = tells[r.id] || []; pts.push([Math.abs(r.harm || 0), ts.length]); fresh += ts.filter((a) => a <= 0).length; stale += ts.filter((a) => a >= 2).length; }
    }
    const mx = F.mean(pts.map((p) => p[0])), my = F.mean(pts.map((p) => p[1]));
    const cov = F.mean(pts.map((p) => (p[0] - mx) * (p[1] - my))), sx = Math.sqrt(F.mean(pts.map((p) => (p[0] - mx) ** 2))), sy = Math.sqrt(F.mean(pts.map((p) => (p[1] - my) ** 2)));
    const corr = cov / (sx * sy || 1);
    return ok(corr > 0.05 && fresh > stale, `correlation of juiciness with retellings ${corr.toFixed(2)} over ${pts.length} stories; retold on their first day ${fresh}, two or more days old ${stale}`);
  } },
  { id: "SPR-6", kind: "inspect", fn: async () => {
    const { s } = await F.main();
    let bad = 0;
    for (const rid of Object.keys(s.rumors)) {
      const r = F.B.reach(s, rid);
      const truth = holders(s).filter(([id, v]) => (id === "player" || !s.people[id].gone) && v.knows?.[rid]).length;
      if (r.heard.length !== truth) bad++;
    }
    const sample = Object.keys(s.rumors).find((rid) => F.B.reach(s, rid).heard.length > 3);
    const rr = F.B.reach(s, sample);
    return ok(!bad, `reach for every story (${Object.keys(s.rumors).length}); e.g. "${s.rumors[sample].text.slice(0, 50)}": ${rr.believe.length} believe, ${rr.doubt.length} doubt, ${rr.heard.length} heard`);
  } },
];
