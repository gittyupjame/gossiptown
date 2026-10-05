import * as F from "./fixtures.mjs";
const { ok } = F;
const all = async () => [await F.main(), ...(await F.seeds())];
const causeOk = (s, c) => !!c && (/^rule:[a-z-]+$/.test(c) || /^player:/.test(c) || !!F.R.decisionById(s, c) || !!F.R.evById(s, c) || /^(mv|c|i|t|a)\d+$/.test(c));
// a woman next to another, both out of everyone else's way
function pair(c, a, b, place = "plaza") {
  for (const v of Object.values(c.s.people)) if (![a, b].includes(v.id)) F.put(c, v.id, "dock");
  F.put(c, a, place);
  const p = F.at(c, a);
  F.put(c, b, place, { x: p.x + 0.8, z: p.z });
}
// a woman who promised a vote, then a vote night with the ballots given
async function voteNight(c, ballots, out) {
  const { s } = c;
  for (const v of F.A.alive(s)) F.A.place(s, v, "firepit", "rule:vote");
  s.player.location = "firepit"; s.minute = 19 * 60 + 30;
  return F.sim.applyVote(s, ballots, out, c.ui, { lines: {} });
}

export const tests = [
  { id: "CMT-1", kind: "audit", fn: async () => {
    let n = 0; const bad = []; let acc = 0;
    for (const [si, { s }] of (await all()).entries()) {
      for (const m of s.moves) {
        if (!["promise", "plan", "threat"].includes(m.type) && !(m.type === "agreement" && m.by === "player")) continue;
        if (!F.R.evById(s, m.ev)) continue;
        n++;
        const c = m.commit && F.M.byId(s, m.commit);
        if (!c || !c.by || !c.to || !c.kind || c.day == null || !Array.isArray(c.heard) || c.sincere == null || !c.status) bad.push(`${si}/${m.id}`);
      }
      // a yes to a request is a promise too
      for (const m of s.moves.filter((m) => m.type === "request" && m.answer)) for (const [P, a] of Object.entries(m.answer)) if (a.yes && m.kind && m.kind !== "other") { acc++; if (!(s.ledger || []).some((c) => c.by === P && (c.sincerity === a.decision || c.sincerities?.includes(a.decision)))) bad.push(`${si}/${m.id}:${P}`); }
    }
    return ok(n && !bad.length, `${n} promise/plan/threat moves and ${acc} agreed requests; ${bad.length} without a full commitment record ${bad.slice(0, 4)}`);
  } },
  { id: "CMT-2", kind: "audit", fn: async () => {
    let n = 0, back = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const c of s.ledger || []) {
      if (c.by === "player") continue;
      // pacts from before the season: whether she meant it is part of her backstory
      if (F.R.evById(s, c.sincerity)?.type === "history") { back++; continue; }
      n++;
      const d = F.R.decisionById(s, c.sincerity);
      if (!d || d.actor !== c.by) bad.push(`${si}/${c.id} (${c.sincerity} ${d?.label})`);
    }
    return ok(n && !bad.length, `${n} commitments made in play by women (plus ${back} from backstory); ${bad.length} without her own sincerity decision ${bad.slice(0, 3)}`);
  } },
  { id: "CMT-3", kind: "scenario", fn: async () => {
    // "I'm going to talk to Juniper about Odette", then she does, about Odette
    for (const seed of [81, 82, 83, 84, 85, 86]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "brenna", "celeste", "smithy");
      await F.speak(c, "brenna", "celeste", [{ text: "I'm going to talk to Juniper about Odette.", moves: [{ type: "plan", content: "talk to Juniper about Odette", kind: "talk", target: "Juniper", topic: "Odette" }] }]);
      const cm = s.ledger.find((x) => x.by === "brenna" && x.kind === "talk");
      if (!cm?.sincere) continue;
      F.T.end(s, F.T.talkOf(s, "brenna"), "test", "rule:test", c.ui);
      const p = F.at(c, "brenna");
      F.put(c, "juniper", "smithy", { x: p.x + 1.5, z: p.z + 1 });
      await F.run(c, 120);
      const t = Object.values(s.talks).find((x) => x.a === "brenna" && x.b === "juniper");
      const moves = (t?.turns || []).filter((x) => x.by === "brenna").flatMap((x) => x.moves).map((id) => s.moves.find((m) => m.id === id));
      const aboutO = moves.some((m) => m?.about === "odette");
      const prompt = c.writer.turns.find((x) => x.speaker === "brenna" && /Juniper/.test(x.prompt) && /Odette/.test(x.prompt));
      return ok(t && aboutO && prompt && cm.status === "kept", `seed ${seed}: Brenna meant it (${cm.sincerity}); talk with Juniper ${t ? `opened (${t.reason})` : "never happened"}; her moves about Odette: ${aboutO}; prompt carried the topic: ${!!prompt}; commitment ${cm.status}`);
    }
    return ok(false, "Brenna never meant it on any seed");
  } },
  { id: "CMT-4", kind: "audit", fn: async () => {
    let n = 0; const bad = []; const why = {};
    for (const { s } of await all()) {
      for (const c of (s.ledger || []).filter((c) => !["open", "kept"].includes(c.status))) {
        n++;
        if (!causeOk(s, c.settleCause) || !c.why) bad.push(`${c.id}:${c.settleCause}`);
        why[c.status] = (why[c.status] || 0) + 1;
      }
      bad.push(...(s.violations || []).filter((v) => v.rule === "settle-without-cause").map((v) => v.detail.c));
    }
    return ok(n && !bad.length, `${n} commitments closed without being kept (${Object.entries(why).map(([k, x]) => `${k} ${x}`).join(", ")}); ${bad.length} without a cause pointer`);
  } },
  { id: "CMT-5", kind: "scenario", fn: async () => {
    // the same pledge, whispered vs made at the show, then a reason to go back on it
    const res = { 0: [], 2: [] };
    for (let i = 0; i < 24; i++) for (const level of [0, 2]) {
      const c = await F.town(500 + i);
      const s = c.s;
      const v = s.people.pippa;
      const d = await F.R.decide(s, "pippa", {}, { meant: { type: "noul", instructions: "test", prior: 0.97 } }, "sincere:pippa", "rule:test");
      const cm = F.M.commit(s, { by: "pippa", to: "wren", kind: "warn", target: "marigold", topic: "what Odette is saying", sincere: true, sincerity: d._id, heard: level ? F.A.alive(s).map((x) => x.id) : [], level, cause: "rule:test" });
      F.T.afterCommit(s, v, cm, d._id);
      F.M.shift(s, "pippa", "marigold", { aff: 2.5, trust: 1, why: "Marigold saved her shop", cause: "rule:test" });
      F.M.shift(s, "pippa", "wren", { aff: -1, trust: -1, why: "Wren mocked her", cause: "rule:test" });
      await F.A.reconsider(s, v, c.ui);
      const dd = [...s.decisions].reverse().find((x) => x.actor === "pippa" && x.q[`keep_${cm.id}`]);
      res[level].push({ p: dd?.q[`keep_${cm.id}`].p, broke: cm.status !== "open" });
    }
    const pv = F.mean(res[0].map((x) => x.p)), pp = F.mean(res[2].map((x) => x.p));
    const bv = res[0].filter((x) => x.broke).length, bp = res[2].filter((x) => x.broke).length;
    return ok(pv < pp && bv > bp, `whispered: kept-probability ${pv.toFixed(2)}, broken ${bv}/24; at the show: ${pp.toFixed(2)}, broken ${bp}/24`);
  } },
  { id: "CMT-6", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const { s } of await all()) for (const c of s.ledger || []) {
      if (c.deadline == null) continue;
      n++;
      if (c.status === "open" && c.deadline < s.day * 1440) bad.push(`${c.id} (${c.kind}, due day ${Math.floor(c.deadline / 1440)})`);
    }
    return ok(n && !bad.length, `${n} commitments with a deadline; ${bad.length} still open after it passed ${bad.slice(0, 3)}`);
  } },
  { id: "CMT-7", kind: "scenario", fn: async () => {
    const c = await F.town(87);
    const s = c.s;
    const d = await F.R.decide(s, "celeste", {}, { meant: { type: "noul", instructions: "test", prior: 0.5 } }, "sincere:celeste", "rule:test");
    const cm = F.M.commit(s, { by: "celeste", to: "wren", kind: "vote", target: "pippa", sincere: false, sincerity: d._id, heard: ["hesper"], level: 0, cause: "rule:test" });
    const ballots = Object.fromEntries(F.A.alive(s).map((v) => [v.id, v.id === "celeste" ? "juniper" : v.id === "juniper" ? "pippa" : "juniper"]));
    await voteNight(c, ballots, "juniper");
    const w = s.people.wren;
    const rid = Object.keys(w.knows).find((r) => s.rumors[r].prop?.pred === "broke_word" && s.rumors[r].about === "celeste");
    const mem = w.mem.find((m) => m.about?.includes("celeste") && m.w >= 3);
    return ok(cm.status === "broken" && rid && mem, `pledge ${cm.status}; Wren knows "${rid && s.rumors[rid].text}"; it's a weighty memory (${mem?.w}): ${!!mem}`);
  } },
  { id: "CMT-8", kind: "scenario", fn: async () => {
    const c = await F.town(88);
    const s = c.s;
    const d = await F.R.decide(s, "celeste", {}, { meant: { type: "noul", instructions: "test", prior: 0.5 } }, "sincere:celeste", "rule:test");
    F.M.commit(s, { by: "celeste", to: "wren", kind: "vote", target: "pippa", sincere: true, sincerity: d._id, heard: ["hesper"], level: 0, cause: "rule:test" });
    const t0 = { wren: s.rel.wren.celeste.trust, hesper: s.rel.hesper.celeste.trust, brenna: s.rel.brenna.celeste.trust };
    const ballots = Object.fromEntries(F.A.alive(s).map((v) => [v.id, v.id === "celeste" ? "juniper" : ["juniper", "brenna"].includes(v.id) ? "pippa" : "juniper"]));
    await voteNight(c, ballots, "juniper");
    const t1 = { wren: s.rel.wren.celeste.trust, hesper: s.rel.hesper.celeste.trust, brenna: s.rel.brenna.celeste.trust };
    const rid = Object.keys(s.people.hesper.knows).find((r) => s.rumors[r].prop?.pred === "broke_word");
    // and it travels: Hesper can pass it on
    const spreadable = rid && s.rumors[rid].harm < 0 && F.B.conf(c.s, "hesper", rid) >= 0.5;
    return ok(t1.wren < t0.wren - 0.5 && t1.hesper < t0.hesper && spreadable && Math.abs(t1.brenna - t0.brenna) < Math.abs(t1.hesper - t0.hesper), `trust in Celeste: Wren (promised) ${t0.wren.toFixed(2)} -> ${t1.wren.toFixed(2)}; Hesper (heard it) ${t0.hesper.toFixed(2)} -> ${t1.hesper.toFixed(2)}; Brenna (didn't know) ${t0.brenna.toFixed(2)} -> ${t1.brenna.toFixed(2)}; it's now gossip Hesper holds: ${!!spreadable}`);
  } },
  { id: "CMT-9", kind: "scenario", fn: async () => {
    const c = await F.town(89);
    const s = c.s;
    pair(c, "wren", "odette");
    const d = await F.R.decide(s, "odette", {}, { meant: { type: "noul", instructions: "test", prior: 0.1 } }, "sincere:odette", "rule:test");
    const cm = F.M.commit(s, { by: "odette", to: "wren", kind: "ask", target: "hesper", topic: "the festival fund", sincere: false, sincerity: d._id, cover: "say it slipped her mind", level: 0, cause: "rule:test" });
    F.M.settle(s, cm, "broken", "she never meant it", d._id);
    await F.speak(c, "wren", "odette", [{ text: "You said you'd ask Hesper about the festival fund and you never did.", moves: [{ type: "accusation", about: "Odette", content: "Odette broke her word about asking Hesper" }] }]);
    const before = 0;
    for (let i = 0; i < 4 && !c.writer.turns.slice(before).some((x) => x.speaker === "odette"); i++) { await Promise.all(F.T.advance(s, c.ui)); s.minute += 2; }
    const turn = c.writer.turns.slice(before).find((x) => x.speaker === "odette");
    return ok(turn && turn.prompt.includes("say it slipped her mind"), `Odette's answer was written ${turn ? "knowing" : "without"} her stored cover story ("say it slipped her mind")`);
  } },
  { id: "CMT-10", kind: "scenario", fn: async () => {
    // Sylvie promises Celeste one vote and Hesper another; then the two compare notes
    let holdsBoth = 0, saw = 0, n = 0, susp = [];
    for (const seed of [90, 190, 290, 390]) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "sylvie", "celeste");
      await F.speak(c, "sylvie", "celeste", [{ text: "I'm voting out Pippa tonight, I promise.", moves: [{ type: "promise", content: "vote out Pippa", kind: "vote", target: "Pippa" }] }], { discreet: true });
      F.T.end(s, F.T.talkOf(s, "sylvie"), "test", "rule:test", c.ui);
      pair(c, "sylvie", "hesper");
      await F.speak(c, "sylvie", "hesper", [{ text: "My vote goes against Juniper tonight, promise.", moves: [{ type: "promise", content: "vote out Juniper", kind: "vote", target: "Juniper" }] }], { discreet: true });
      F.T.end(s, F.T.talkOf(s, "sylvie"), "test", "rule:test", c.ui);
      if (s.ledger.filter((x) => x.by === "sylvie" && x.kind === "vote").length !== 2) return ok(false, "the two pledges weren't both stored");
      pair(c, "celeste", "hesper");
      await F.speak(c, "celeste", "hesper", [{ text: "Sylvie told me she's voting out Pippa tonight.", moves: [{ type: "claim", about: "Sylvie", content: "Sylvie is voting out Pippa", vote_target: "Pippa" }] }]);
      await F.speak(c, "hesper", "celeste", [{ text: "Funny, Sylvie told me she's voting out Juniper.", moves: [{ type: "claim", about: "Sylvie", content: "Sylvie is voting out Juniper", vote_target: "Juniper" }] }]);
      for (const who of ["celeste", "hesper"]) {
        n++;
        const holds = Object.keys(s.people[who].knows).filter((r) => s.rumors[r].prop?.pred === "votes_for" && s.rumors[r].about === "sylvie").map((r) => s.rumors[r].prop.obj);
        if (["pippa", "juniper"].every((x) => holds.includes(x))) holdsBoth++;
        if (Object.keys(s.people[who].knows).some((r) => s.rumors[r].prop?.pred === "two_faced" && s.rumors[r].about === "sylvie")) saw++;
        susp.push(F.B.suspicion(s, who, "sylvie"));
      }
    }
    return ok(holdsBoth === n && saw >= n / 2, `${n} promisees over 4 towns: ${holdsBoth} ended up holding both of Sylvie's vote promises; ${saw} concluded she's telling different people different things (a Jev judgment each); mean suspicion of Sylvie ${F.mean(susp).toFixed(2)}`);
  } },

  { id: "GOL-1", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const { s } of await all()) for (const v of F.A.alive(s)) { n++; if (!(v.goals || []).some((g) => g.w > 0)) bad.push(v.id); }
    // and at every point in between: a goal list never emptied
    let emptied = 0;
    for (const { s } of await all()) {
      const w = {};
      for (const c of s.trace.filter((c) => c.what === "goal")) { (w[c.who] ??= {})[c.key] = c.to; if (Object.values(w[c.who]).every((x) => x <= 0) && s.people[c.who] && !(s.people[c.who].outDay <= c.day)) emptied++; }
    }
    return ok(n && !bad.length && !emptied, `${n} women at season ends, ${bad.length} without an active goal; goal lists that ever emptied: ${emptied}`);
  } },
  { id: "GOL-2", kind: "scenario", fn: async () => {
    const c = await F.town(91);
    const s = c.s;
    const v = s.people.pippa;
    for (const g of v.goals) if (g.kind !== "survive") g.w = Math.max(g.w, 2.2);
    F.M.setGoal(s, v, { kind: "protect", target: "marigold", w: 2.4, why: "her best friend", cause: "rule:test" });
    F.M.setGoal(s, v, { kind: "survive", w: 1, why: "nobody wants to go home", cause: "rule:test" });
    const top0 = v.goals[0].kind;
    pair(c, "wren", "pippa");
    F.knowAs(c, "wren", "odette", "Odette is voting out Pippa", { kind: "vote", prop: { subject: "odette", pred: "votes_for", obj: "pippa", pol: 1 } });
    await F.speak(c, "wren", "pippa", [{ text: "Odette told me she's voting you out tonight, Pippa.", moves: [{ type: "claim", about: "Odette", content: "Odette is voting out Pippa", vote_target: "Pippa" }] }]);
    await F.A.reconsider(s, v, c.ui);
    return ok(top0 !== "survive" && v.goals[0].kind === "survive", `Pippa's top goal before: ${top0}; after hearing she's a target: ${v.goals[0].kind} (${v.goals.map((g) => `${g.kind}${g.target ? ":" + g.target : ""} ${g.w.toFixed(1)}`).join(", ")})`);
  } },
  { id: "GOL-3", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const { s } of await all()) {
      for (const c of s.trace.filter((c) => c.what === "agenda" && c.from == null)) {
        n++;
        if (!causeOk(s, c.cause)) bad.push(`${c.key}:${c.cause}`);
      }
      bad.push(...(s.violations || []).filter((v) => v.rule === "agenda-without-cause").map((v) => v.detail.kind));
      for (const v of Object.values(s.people)) for (const it of v.agenda || []) if (!["goal", "commit", "reaction", "decision"].includes(it.cause?.type)) bad.push(it.id);
    }
    return ok(n && !bad.length, `${n} agenda items added; ${bad.length} not citing a goal, commitment, reaction or decision`);
  } },
  { id: "GOL-4", kind: "audit", fn: async () => {
    const acts = ["depart", "talk_open", "gift", "board_post", "board_read", "snoop", "fight", "outburst"];
    let n = 0; const bad = []; const rules = {};
    for (const { s } of await all()) for (const e of s.world) {
      if (!acts.includes(e.type) || !s.people[e.actor]) continue;
      n++;
      if (!causeOk(s, e.cause)) bad.push(`${e.id}:${e.type}:${e.cause}`);
      else if (/^rule:/.test(e.cause)) rules[e.cause] = (rules[e.cause] || 0) + 1;
    }
    const allowed = ["rule:vote", "rule:welcome-party", "rule:show", "rule:test", "rule:dawn", "rule:night", "rule:gather"];
    const odd = Object.keys(rules).filter((r) => !allowed.includes(r));
    return ok(n && !bad.length && !odd.length, `${n} actions by women; ${bad.length} without a cause; moved by the show's own clock: ${Object.entries(rules).map(([k, x]) => `${k} ${x}`).join(", ") || "none"}${odd.length ? `; unexplained rules ${odd}` : ""}`);
  } },
  { id: "GOL-5", kind: "scenario", fn: async () => {
    let hit = null, tries = 0;
    for (const seed of [92, 93, 94, 95, 96, 97, 98, 99]) {
      tries++;
      const c = await F.town(seed);
      const s = c.s;
      const v = s.people.sylvie;
      const g = F.M.setGoal(s, v, { kind: "ally", target: "marigold", w: 1.5, why: "test", cause: "rule:test" });
      F.M.pushAgenda(s, v, { kind: "gift", target: "marigold", cause: { type: "goal", id: g.id } });
      const firstBefore = v.agenda[0].kind;
      pair(c, "odette", "wren");
      const p = F.at(c, "odette");
      F.put(c, "sylvie", "plaza", { x: p.x + 2.2, z: p.z + 1.4 });
      await F.speak(c, "odette", "wren", [{ text: "Sylvie is a sour little nobody and everyone knows it.", moves: [{ type: "insult", about: "Sylvie", content: "calls Sylvie a sour nobody" }] }]);
      const top = v.agenda[0];
      if (top && top.kind === "confront" && top.target === "odette" && top.now) { hit = { seed, firstBefore, top, d: top.cause.id }; break; }
    }
    return ok(hit, hit ? `seed ${hit.seed}: Sylvie's agenda led with "${hit.firstBefore}"; after overhearing the insult, "confront Odette, now" went to the front (${hit.d})` : `no seed of ${tries} put a confrontation ahead of the errand`);
  } },
  { id: "GOL-6", kind: "audit", fn: async () => {
    let opp = { n: 0, talks: 0, neg: 0 }, rnd = { n: 0, talks: 0, neg: 0 };
    for (const { s } of await all()) {
      const goalsOf = (id) => s.people[id].goals || [];
      // opposed: one wants the other gone (sink/revenge), or they want opposite fates for a third
      const opposed = (a, b) => goalsOf(a).some((g) => ["sink", "revenge", "expose"].includes(g.kind) && g.target === b) || goalsOf(b).some((g) => ["sink", "revenge", "expose"].includes(g.kind) && g.target === a) || goalsOf(a).some((g) => g.kind === "protect" && goalsOf(b).some((h) => ["sink", "revenge"].includes(h.kind) && h.target === g.target));
      const ids = Object.keys(s.people).filter((id) => id !== "primrose");
      for (const a of ids) for (const b of ids) {
        if (a >= b) continue;
        const talks = Object.values(s.talks).filter((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a)).length;
        const neg = s.moves.filter((m) => (m.by === a && (m.to.includes(b) || m.about === b) || m.by === b && (m.to.includes(a) || m.about === a)) && ["insult", "threat", "accusation"].includes(m.type)).length + s.world.filter((e) => e.type === "fight" && [e.actor, ...e.targets].includes(a) && [e.actor, ...e.targets].includes(b)).length;
        const o = opposed(a, b) ? opp : rnd;
        o.n++; o.talks += talks; o.neg += neg;
      }
    }
    const per = (o, k) => o[k] / Math.max(1, o.n);
    return ok(opp.n && per(opp, "neg") > per(rnd, "neg") * 1.5, `opposed pairs (${opp.n}): ${per(opp, "talks").toFixed(2)} talks and ${per(opp, "neg").toFixed(2)} hostile moves each; other pairs (${rnd.n}): ${per(rnd, "talks").toFixed(2)} talks and ${per(rnd, "neg").toFixed(2)} hostile moves each (talks are only kept for the last 40)`);
  } },
];
