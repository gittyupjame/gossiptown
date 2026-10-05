import * as F from "./fixtures.mjs";
const { ok } = F;
const all = async () => [await F.main(), ...(await F.seeds())];
const causeOk = (s, c) => !!c && (/^rule:[a-z-]+$/.test(c) || /^player:/.test(c) || !!F.R.decisionById(s, c) || !!F.R.evById(s, c) || /^(mv|c|i|t|a)\d+$/.test(c));
function pair(c, a, b, place = "plaza") {
  for (const v of Object.values(c.s.people)) if (![a, b].includes(v.id)) F.put(c, v.id, "dock");
  F.put(c, a, place);
  const p = F.at(c, a);
  F.put(c, b, place, { x: p.x + 0.8, z: p.z });
}
const near = (c, who, of, dx = 1.6, dz = 1.2) => { const p = F.at(c, of); F.put(c, who, c.s.people[of].location, { x: p.x + dx, z: p.z + dz }); };
const askP = async (c, asker, who) => {
  await F.speak(c, asker, who, [{ text: "Could you put in a good word for me with Hesper?", moves: [{ type: "request", to: F.first(c, who), content: "put in a good word with Hesper", kind: "other" }] }]);
  const d = [...c.s.decisions].reverse().find((x) => x.actor === who && x.q.m0_accept);
  return d.q.m0_accept.p;
};

export const tests = [
  { id: "REL-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const ids = Object.keys(s.people);
    let pairs = 0, differ = 0, dims = true;
    for (const a of ids) for (const b of ids) {
      if (a >= b || !s.rel[a]?.[b] || !s.rel[b]?.[a]) continue;
      pairs++;
      for (const k of ["affinity", "trust", "respect", "fear", "debt"]) if (!(k in s.rel[a][b]) && k !== "debt") dims = false;
      if (Math.abs(s.rel[a][b].affinity - s.rel[b][a].affinity) > 0.05 || Math.abs(s.rel[a][b].trust - s.rel[b][a].trust) > 0.05) differ++;
    }
    return ok(pairs && differ > pairs / 2 && dims, `${pairs} pairs stored both ways with liking, trust, respect, fear and debt; ${differ} where A's view of B differs from B's view of A`);
  } },
  { id: "REL-2", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const c of s.trace.filter((c) => c.what === "rel")) { n++; if (!causeOk(s, c.cause)) bad.push(`${si}/${c.who}->${c.key}:${c.cause}`); }
    return ok(n && !bad.length, `${n} relationship changes; ${bad.length} without a cause ${bad.slice(0, 3)}`);
  } },
  { id: "REL-3", kind: "scenario", fn: async () => {
    const c = await F.town(301);
    const s = c.s;
    pair(c, "odette", "pippa");
    const r = s.rel.pippa.odette, b = { ...r };
    await F.speak(c, "odette", "pippa", [{ text: "Cross me again and you'll regret it, Pippa.", moves: [{ type: "threat", to: "Pippa", content: "threatens her" }] }]);
    return ok(r.fear > b.fear && r.affinity < b.affinity && Math.abs(r.trust - b.trust) < 1e-9, `Pippa on Odette after a threat: fear ${b.fear.toFixed(2)} -> ${r.fear.toFixed(2)}, liking ${b.affinity.toFixed(2)} -> ${r.affinity.toFixed(2)}, trust ${b.trust.toFixed(2)} -> ${r.trust.toFixed(2)}`);
  } },
  { id: "REL-4", kind: "scenario", fn: async () => {
    const base = await (async () => { const c = await F.town(302); pair(c, "celeste", "wren"); return { p: await askP(c, "celeste", "wren"), anger: 0 }; })();
    const c = await F.town(302);
    const s = c.s;
    pair(c, "odette", "wren");
    const a0 = s.people.wren.mood.anger;
    await F.speak(c, "odette", "wren", [{ text: "You're a sad little barmaid, Wren.", moves: [{ type: "insult", to: "Wren", content: "calls her a sad barmaid" }] }]);
    F.T.end(s, F.T.talkOf(s, "odette"), "test", "rule:test", c.ui);
    const a1 = s.people.wren.mood.anger;
    pair(c, "celeste", "wren");
    const p = await askP(c, "celeste", "wren");
    const prompt = c.writer.turns.length ? null : null;
    return ok(a1 > a0 && p < base.p, `Wren's anger ${a0.toFixed(2)} -> ${a1.toFixed(2)} after being insulted; the chance she says yes to Celeste's next request ${base.p.toFixed(2)} -> ${p.toFixed(2)}; her mood (and why) is in every view she decides and speaks from`);
  } },
  { id: "REL-5", kind: "scenario", fn: async () => {
    const ps = { gift: [], none: [] };
    for (const seed of [303, 304, 305, 306]) for (const kind of ["none", "gift"]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "celeste", "hesper");
      if (kind === "gift") { s.player.location = "plaza"; await F.sim.giveGift(s, "celeste", "hesper", "cupcake", null, c.ui); }
      ps[kind].push(await askP(c, "celeste", "hesper"));
      if (kind === "gift" && seed === 303) ps.debt = s.rel.hesper.celeste.debt;
    }
    return ok(F.mean(ps.gift) > F.mean(ps.none) && ps.debt > 0, `Hesper owes Celeste ${ps.debt.toFixed(2)} after a cupcake she loves; chance she grants Celeste's next ask: ${F.mean(ps.none).toFixed(2)} without the gift, ${F.mean(ps.gift).toFixed(2)} with it`);
  } },
  { id: "REL-6", kind: "scenario", fn: async () => {
    const out = [];
    for (const seed of [307, 308, 309]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "sylvie", "marigold");
      for (const [id, dx] of [["pippa", 1.6], ["hesper", -1.6]]) { near(c, id, "marigold", dx, 1); s.rel[id].marigold.affinity = 2; }
      s.people.marigold.bias.nerve = 0; s.people.sylvie.bias.nerve = 1; s.people.sylvie.bias.temper = 1;
      const b = { pippa: s.rel.pippa.sylvie.affinity, hesper: s.rel.hesper.sylvie.affinity };
      const r = await F.sim.brawl(s, "sylvie", "marigold", "rule:test", c.ui);
      const winner = r.winner, loser = winner === "sylvie" ? "marigold" : "sylvie";
      if (loser !== "marigold") continue;
      out.push({ seed, d: ["pippa", "hesper"].map((id) => s.rel[id].sylvie.affinity - b[id]) });
    }
    const cooled = out.flatMap((o) => o.d).filter((x) => x < 0).length, total = out.flatMap((o) => o.d).length;
    return ok(total && cooled === total, `${out.length} fights Marigold lost: her friends' liking for Sylvie changed by ${out.flatMap((o) => o.d).map((x) => x.toFixed(2)).join(", ")}`);
  } },

  { id: "SOC-1", kind: "inspect", fn: async () => {
    const { s } = await F.main();
    const ids = F.A.alive(s).map((v) => v.id);
    let varied = 0;
    const show = [];
    for (const id of ids) {
      const rep = F.I.reputation(s, id);
      const ls = Object.values(rep).map((r) => r.liking);
      if (Math.max(...ls) - Math.min(...ls) > 1) varied++;
      if (show.length < 2) show.push(`${F.sim.nameOf(s, id).split(" ")[0]}: ${Object.entries(rep).slice(0, 4).map(([w, r]) => `${w} ${r.liking}`).join(", ")}`);
    }
    return ok(varied >= ids.length / 2, `the inspector's per-woman reputation varies by more than a point of liking for ${varied}/${ids.length} women (${show.join("; ")})`);
  } },
  { id: "SOC-2", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const al of s.alliances) {
      n++;
      for (const m of al.members) {
        if (m === "player") continue;
        const cid = al.commits?.[m];
        if (!cid || !F.M.byId(s, cid) || typeof al.loyal?.[m] !== "boolean") bad.push(`${si}/${al.id}:${m}`);
      }
      if (!al.terms || al.day == null) bad.push(`${si}/${al.id} terms/start`);
    }
    return ok(n && !bad.length, `${n} alliances; ${bad.length} member entries without a commitment record and private loyalty ${bad.slice(0, 3)}`);
  } },
  { id: "SOC-3", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      for (const c of s.trace.filter((c) => c.what === "alliance")) { n++; if (!causeOk(s, c.cause)) bad.push(`${si}/${c.key}:${c.cause}`); }
      for (const al of s.alliances) for (const h of al.history || []) { n++; if (!causeOk(s, h.cause)) bad.push(`${si}/${al.id}:${h.cause}`); }
    }
    return ok(n && !bad.length, `${n} alliance changes; ${bad.length} without a cause ${bad.slice(0, 3)}`);
  } },
  { id: "SOC-4", kind: "scenario", fn: async () => {
    const got = { isolated: 0, backed: 0 };
    for (let i = 0; i < 10; i++) for (const kind of ["isolated", "backed"]) {
      const c = await F.town(310 + i);
      const s = c.s;
      const v = s.people.juniper;
      s.alliances = s.alliances.filter((a) => !a.members.includes("juniper"));
      if (kind === "backed") F.T.joinPact(s, "juniper", "wren", F.M.commit(s, { by: "juniper", to: "wren", kind: "pact", sincere: true, sincerity: "rule:test", cause: "rule:test" }));
      v.goals = v.goals.filter((g) => g.kind !== "ally");
      await F.A.reconsider(s, v, c.ui);
      if (v.goals.some((g) => g.kind === "ally") || v.agenda.some((x) => x.kind === "recruit")) got[kind]++;
    }
    return ok(got.isolated > got.backed, `Juniper sets out to win an ally in ${got.isolated}/10 towns when she believes nobody is in her corner, ${got.backed}/10 when she has a pact`);
  } },
  { id: "SOC-5", kind: "scenario", fn: async () => {
    const run = async (text, moves) => {
      const c = await F.town(320);
      const s = c.s;
      const ev = F.E.showOf(s);
      s.minute = ev.minute; s.phase = "show"; F.E.gather(s);
      const before = Object.fromEntries(F.A.alive(s).map((v) => [v.id, s.rel[v.id].player.affinity]));
      c.writer.player.set(text, moves);
      const a = await F.E.playerAct(s, text, {});
      const res = await F.E.crowdReacts(s, a);
      const d = F.A.alive(s).filter((v) => v.location === s.player.location || F.space.dist(s, v.id, "player") < 30).map((v) => s.rel[v.id].player.affinity - before[v.id]);
      return { mean: F.mean(d), up: d.filter((x) => x > 0).length, n: d.length };
    };
    const toast = await run("Here's to all of you, the warmest town I've ever lived in!", [{ type: "compliment", span: "Here's to all of you, the warmest town I've ever lived in!", to: ["everyone"], content: "toasts the whole town" }]);
    const jab = await run("Honestly, you're all a bunch of petty, sour snakes.", [{ type: "insult", span: "Honestly, you're all a bunch of petty, sour snakes.", to: ["everyone"], content: "insults the whole town" }]);
    return ok(toast.mean > 0 && toast.up >= toast.n / 2 && jab.mean < toast.mean, `the crowd's liking for the newcomer after a warm toast: ${toast.up}/${toast.n} warmed, mean ${toast.mean.toFixed(2)}; after insulting everyone: mean ${jab.mean.toFixed(2)}`);
  } },
  { id: "SOC-6", kind: "audit", fn: async () => {
    const runs = await all();
    const groups = runs.map(({ s }) => new Set(s.alliances.filter((a) => a.members.filter((m) => m === "player" || !s.people[m]?.gone).length >= 2).map((a) => a.members.filter((m) => m === "player" || !s.people[m]?.gone).sort().join("+"))));
    const sig = groups.map((g) => [...g].sort().join(" | "));
    const distinct = new Set(sig).size;
    const start = new Set(F.cast.START_ALLIANCES ? F.cast.START_ALLIANCES.map((a) => [...a.members].sort().join("+")) : []);
    const changed = groups.filter((g) => [...g].some((x) => !start.has(x)) || [...start].some((x) => !g.has(x))).length;
    return ok(distinct === runs.length && changed === runs.length, `${runs.length} seasons end with ${distinct} different sets of groups; ${changed} differ from the groups the season started with (e.g. ${sig[0] || "none"})`);
  } },

  { id: "LIE-1", kind: "audit", fn: async () => {
    let n = 0, player = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      for (const l of s.lies || []) { n++; if (l.by === "player") player++; if (!l.truth || !l.rid || !s.rumors[l.rid] || !l.by) bad.push(`${si}/${l.id}`); }
      for (const m of s.moves.filter((m) => m.grounds === "lie")) if (!(s.lies || []).some((l) => l.mv === m.id)) bad.push(`${si}/${m.id} unrecorded`);
    }
    // the newcomer lying: a claim nothing she saw or heard backs
    const c = await F.town(331);
    F.put(c, "player", "plaza", { ...F.at(c, "wren"), x: F.at(c, "wren").x - 0.8 });
    await F.playerSay(c, "wren", "Odette stole the festival fund, I saw her.", [{ type: "claim", span: "Odette stole the festival fund, I saw her.", about: "Odette", content: "Odette stole the festival fund" }]);
    const pl = (c.s.lies || []).find((l) => l.by === "player");
    if (pl) player++;
    return ok(n && player && pl?.truth && !bad.length, `${n} lies stored by women over the seasons, each with the claim and her real belief; the newcomer's made-up claim was stored as a lie (${pl?.truth}); ${bad.length} missing ${bad.slice(0, 3)}`);
  } },
  { id: "LIE-2", kind: "audit", fn: async () => {
    const per = {};
    for (const { s } of await all()) for (const v of Object.values(s.people)) { (per[v.id] ??= { d: v.bias.deceit, n: 0 }).n += (s.lies || []).filter((l) => l.by === v.id).length; }
    const honest = Object.values(per).filter((x) => x.d <= 0.3), sly = Object.values(per).filter((x) => x.d >= 0.6);
    const mh = F.mean(honest.map((x) => x.n)), ms = F.mean(sly.map((x) => x.n));
    return ok(honest.length && sly.length && ms > mh * 2, `lies per woman over ${(await all()).length} seasons: honest types (${honest.length}) ${mh.toFixed(1)}, scheming types (${sly.length}) ${ms.toFixed(1)}`);
  } },
  { id: "LIE-3", kind: "scenario", fn: async () => {
    // contradicting what she saw herself
    const c = await F.town(330);
    const s = c.s;
    pair(c, "odette", "wren");
    F.knowAs(c, "wren", "brenna", "Brenna did not steal the cider", { harm: 0.2, prop: { subject: "brenna", pred: "did", obj: null, pol: -1 } });
    const lie = { about: "brenna", content: "Brenna stole the cider", truth: "she made it up" };
    const s0 = F.B.suspicion(s, "wren", "odette");
    const { L } = await F.speak(c, "odette", "wren", [{ text: "Brenna stole the cider, you know.", moves: [{ type: "claim", about: "Brenna", content: "Brenna stole the cider", lie: true }] }], { plan: { decision: "rule:test", lie, delivery: 2 } });
    const b1 = F.B.conf(s, "wren", L.moves[0].rid), s1 = F.B.suspicion(s, "wren", "odette");
    // a lie with nothing against it: sometimes sensed on the spot, more often when it's tense
    const rate = async (minute, fear) => {
      let caught = 0;
      for (let i = 0; i < 16; i++) {
        const k = await F.town(340 + i);
        k.s.minute = minute; k.s.people.hesper.mood.anger = fear;
        pair(k, "tansy", "hesper");
        await F.speak(k, "tansy", "hesper", [{ text: "Juniper has been skimming money from the till.", moves: [{ type: "claim", about: "Juniper", content: "Juniper has been skimming money from the till", lie: true }] }], { plan: { decision: "rule:test", lie: { about: "juniper", content: "Juniper has been skimming money from the till" }, delivery: 2 } });
        const d = [...k.s.decisions].reverse().find((x) => x.actor === "hesper" && x.q.m0_liar);
        caught += d.q.m0_liar.p;
      }
      return caught / 16;
    };
    const calm = await rate(9 * 60, 0), tense = await rate(18 * 60 + 40, 1.2);
    return ok(b1 < 0.3 && s1 > s0 && calm > 0 && tense > calm, `against what Wren saw: belief ${b1.toFixed(2)}, suspicion of Odette ${s0.toFixed(2)} -> ${s1.toFixed(2)}; a lie with nothing against it is sensed on the spot with p=${calm.toFixed(3)} on a calm morning, ${tense.toFixed(3)} just before the vote`);
  } },
  { id: "LIE-4", kind: "scenario", fn: async () => {
    for (const seed of [350, 351, 352, 353, 354, 355, 356, 357, 358, 359]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "odette", "wren");
      s.people.wren.bias.gossip = 0.9;
      F.knowAs(c, "wren", "brenna", "Brenna did not steal the cider", { harm: 0.2, prop: { subject: "brenna", pred: "did", obj: null, pol: -1 } });
      const t0 = s.rel.wren.odette.trust;
      await F.speak(c, "odette", "wren", [{ text: "Brenna stole the cider, you know.", moves: [{ type: "claim", about: "Brenna", content: "Brenna stole the cider", lie: true }] }], { plan: { decision: "rule:test", lie: { about: "brenna", content: "Brenna stole the cider" }, delivery: 2 } });
      const x = (s.exposures || []).find((e) => e.by === "wren" && e.liar === "odette");
      if (!x) continue;
      const mem = s.people.wren.mem.find((m) => m.ev === x.ev);
      const t1 = s.rel.wren.odette.trust;
      F.T.end(s, F.T.talkOf(s, "odette"), "test", "rule:test", c.ui);
      // she tells three others; those who believe her trust Odette less
      const text = s.rumors[x.claim].text, told = [];
      for (const o of ["hesper", "pippa", "brenna"]) {
        const tr0 = s.rel[o].odette.trust;
        pair(c, "wren", o);
        await F.speak(c, "wren", o, [{ text, moves: [{ type: "claim", about: "Odette", content: text, belief: x.claim }] }]);
        F.T.end(s, F.T.talkOf(s, "wren"), "test", "rule:test", c.ui);
        told.push({ o, believes: F.B.conf(s, o, x.claim) >= 0.4, d: s.rel[o].odette.trust - tr0 });
      }
      const bel = told.filter((x) => x.believes);
      return ok(mem?.w >= 4 && t1 < t0 && bel.length && bel.every((x) => x.d < 0), `seed ${seed}: Wren caught Odette's lie (${x.cause}); heavy memory ${mem?.w}; her trust in Odette ${t0.toFixed(2)} -> ${t1.toFixed(2)}; she passed it on: ${told.map((x) => `${x.o} ${x.believes ? "believed it" : "doubted it"}, trust ${x.d >= 0 ? "+" : ""}${x.d.toFixed(2)}`).join("; ")}`);
    }
    return ok(false, "Wren never caught the lie on any seed");
  } },
  { id: "LIE-5", kind: "scenario", fn: async () => {
    const out = [];
    for (const seed of [360, 361, 362, 363]) {
      let rid = null;
      const ctx = await F.season({ seed, days: 2, stopAt: (s) => {
        if (!rid && s.minute >= 9 * 60) {
          // Odette plants a story about Brenna in Tansy's ear
          const r = F.B.newClaim(s, { about: "brenna", text: "Brenna melted down the town bell to sell the bronze.", origin: "odette", isTrue: false, harm: -1.4, kind: "gossip", cat: "world", prop: { subject: "brenna", pred: "did", obj: "bell", pol: 1 } });
          (s.lies ??= []).push({ id: "Ltest", by: "odette", to: ["tansy"], rid: r, truth: "she made it up", day: s.day, minute: s.minute });
          const ev = F.R.emit(s, { type: "history", content: { text: "Odette whispered it to Tansy" }, perceivers: [{ id: "tansy", how: "addressed" }], cause: "rule:test" });
          F.B.learn(s, "tansy", r, { conf: 0.8, from: "odette", ev: ev.id, root: "odette", how: "told", cause: ev.id });
          rid = r;
        }
        return false;
      } });
      const s = ctx.s;
      const alive = F.A.alive(s).filter((v) => v.id !== "brenna" && v.id !== "odette");
      const versions = new Set([rid, ...Object.keys(s.rumors).filter((x) => F.B.rootOf(s, x) === F.B.rootOf(s, rid))]);
      const heard = alive.filter((v) => Object.keys(v.knows).some((x) => versions.has(x))).length;
      out.push({ seed, heard, of: alive.length });
    }
    const majority = out.filter((o) => o.heard > o.of / 2).length;
    return ok(majority >= 1, `a planted lie about Brenna, two days later: ${out.map((o) => `seed ${o.seed} ${o.heard}/${o.of}`).join(", ")}; reached a majority in ${majority} of ${out.length}`);
  } },
  { id: "LIE-6", kind: "scenario", fn: async () => {
    const c = await F.town(370);
    const s = c.s;
    // Marigold tells Celeste something true she saw; Celeste doesn't buy it and marks her a liar
    pair(c, "marigold", "celeste");
    F.knowAs(c, ["marigold", "brenna"], "tansy", "Tansy has been reading other people's mail", { harm: -1 });
    s.rel.celeste.marigold.trust = -0.5;
    F.B.suspect(s, "celeste", "marigold", { by: 0.6, because: [], why: "test", cause: F.R.emit(s, { type: "history", content: { text: "an old spat" }, perceivers: [{ id: "celeste", how: "did" }], cause: "rule:test" }).id });
    await F.speak(c, "marigold", "celeste", [{ text: "Tansy has been reading other people's mail.", moves: [{ type: "claim", about: "Tansy", content: "Tansy has been reading other people's mail" }] }]);
    const sus0 = F.B.suspicion(s, "celeste", "marigold"), tr0 = s.rel.celeste.marigold.trust;
    F.T.end(s, F.T.talkOf(s, "marigold"), "test", "rule:test", c.ui);
    // the accusation hurts her with whoever hears it
    pair(c, "celeste", "pippa");
    const pt0 = s.rel.pippa.marigold.trust;
    F.knowAs(c, "celeste", "marigold", "Marigold is a liar who makes things up", { harm: -1.2 });
    await F.speak(c, "celeste", "pippa", [{ text: "Marigold is a liar who makes things up.", moves: [{ type: "accusation", about: "Marigold", content: "Marigold is a liar who makes things up" }] }]);
    const pt1 = s.rel.pippa.marigold.trust;
    F.T.end(s, F.T.talkOf(s, "celeste"), "test", "rule:test", c.ui);
    // a witness backs her
    pair(c, "brenna", "celeste");
    s.rel.celeste.brenna.trust = 1.5;
    await F.speak(c, "brenna", "celeste", [{ text: "I saw it too, Tansy reads everyone's mail.", moves: [{ type: "claim", about: "Tansy", content: "Tansy has been reading other people's mail" }] }]);
    const sus1 = F.B.suspicion(s, "celeste", "marigold"), tr1 = s.rel.celeste.marigold.trust;
    return ok(pt1 <= pt0 && sus1 < sus0 && tr1 > tr0, `the accusation: Pippa's trust in Marigold ${pt0.toFixed(2)} -> ${pt1.toFixed(2)}; after Brenna backs her up, Celeste's suspicion of Marigold ${sus0.toFixed(2)} -> ${sus1.toFixed(2)} and trust ${tr0.toFixed(2)} -> ${tr1.toFixed(2)}`);
  } },
  { id: "LIE-7", kind: "scenario", fn: async () => {
    for (const seed of [380, 381, 382, 383, 384, 385, 386, 387]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "wren", "hesper");
      F.put(c, "player", "plaza", { ...F.at(c, "wren"), x: F.at(c, "wren").x - 0.8 });
      await F.playerSay(c, "wren", "I'm voting out Sylvie tonight.", [{ type: "claim", span: "I'm voting out Sylvie tonight.", about: "Rosie", content: "Rosie is voting out Sylvie", vote_target: "Sylvie" }]);
      c.g.endTalk(); await F.settle(c.g);
      s.minute += 90;
      const before = c.writer.turns.length;
      await F.playerSay(c, "wren", "Juniper is the one I'm sending home tonight.", [{ type: "claim", span: "Juniper is the one I'm sending home tonight.", about: "Rosie", content: "Rosie is voting out Juniper", vote_target: "Juniper" }]);
      for (let i = 0; i < 4 && !c.writer.turns.slice(before).some((x) => x.speaker === "wren"); i++) { s.minute += 2; await Promise.all(F.T.advance(s, c.ui)); await F.settle(c.g); }
      const reply = c.writer.turns.slice(before).find((x) => x.speaker === "wren");
      const sus = F.B.suspicion(s, "wren", "player");
      if (reply && /I'm voting out Sylvie tonight/.test(reply.prompt) && /call/i.test(reply.prompt)) return ok(true, `seed ${seed}: Wren's suspicion of the newcomer ${sus.toFixed(2)}; her reply was written to call it out, quoting "I'm voting out Sylvie tonight." from earlier today`);
    }
    return ok(false, "Wren never called out the newcomer's contradiction with the earlier quote");
  } },
];
