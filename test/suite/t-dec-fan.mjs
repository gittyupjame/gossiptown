import * as F from "./fixtures.mjs";
const { ok } = F;
const all = async () => [await F.main(), ...(await F.seeds())];
function pair(c, a, b, place = "plaza") {
  for (const v of Object.values(c.s.people)) if (![a, b].includes(v.id)) F.put(c, v.id, "dock");
  F.put(c, a, place);
  const p = F.at(c, a);
  F.put(c, b, place, { x: p.x + 0.8, z: p.z });
}
const near = (c, who, of, dx = 1.6, dz = 1.2) => { const p = F.at(c, of); F.put(c, who, c.s.people[of].location, { x: p.x + dx, z: p.z + dz }); };

export const tests = [
  { id: "DEC-1", kind: "audit", fn: async () => {
    // every option of every choice: how often it was picked vs the probability it was given
    const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 }));
    let choices = 0, notTop = 0;
    for (const { s } of await all()) for (const d of s.decisions) for (const q of Object.values(d.q)) {
      if (q.type !== "choice" || !q.probs) continue;
      choices++;
      const top = Object.entries(q.probs).sort((a, b) => b[1] - a[1])[0][0];
      if (q.pick !== top) notTop++;
      for (const [k, p] of Object.entries(q.probs)) { const b = bins[Math.min(9, Math.floor(p * 10))]; b.n++; b.p += p; b.hit += k === q.pick ? 1 : 0; }
    }
    const rows = bins.filter((b) => b.n >= 200).map((b) => ({ p: b.p / b.n, f: b.hit / b.n }));
    const worst = Math.max(...rows.map((r) => Math.abs(r.p - r.f)));
    return ok(choices > 1000 && worst < 0.06 && notTop > 0, `${choices} choices; ${notTop} picked something other than the most likely option; picked frequency vs probability by decile: ${rows.map((r) => `${r.p.toFixed(2)}->${r.f.toFixed(2)}`).join(" ")} (worst gap ${worst.toFixed(3)})`);
  } },
  { id: "DEC-2", kind: "audit", fn: async () => {
    const m = await F.main();
    const banned = ["\"perceivers\"", "\"heardAs\"", "\"isTrue\"", "\"origin\"", "\"settleCause\"", "\"sincerity\"", F.CANARY];
    const hits = {};
    for (const p of m.payloads) for (const b of banned) if (p.payload.includes(b)) hits[b] = (hits[b] || 0) + 1;
    const fields = new Set();
    for (const p of m.payloads.slice(0, 400)) try { Object.keys(JSON.parse(p.payload)).forEach((k) => fields.add(k)); } catch {}
    return ok(!Object.keys(hits).length && m.payloads.length > 1000, `${m.payloads.length} payloads; world-log fields found: ${Object.entries(hits).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}; fields used: ${[...fields].join(", ")}`);
  } },
  { id: "DEC-3", kind: "scenario", fn: async () => {
    // small slights (three digs at Wren) move Wren's vote against Sylvie
    const probe = async (slights) => {
      const c = await F.town(201);
      const s = c.s;
      pair(c, "sylvie", "wren");
      const digs = ["Nice apron, Wren, did you sleep in it?", "Your cider tastes like dishwater, honestly.", "Nobody laughs at your jokes, you know."];
      for (const d of digs.slice(0, slights)) await F.speak(c, "sylvie", "wren", [{ text: d, moves: [{ type: "insult", to: "Wren", content: d }] }]);
      s.minute = 19 * 60 + 30;
      await F.sim.castVotes(s, F.A.alive(s).map((v) => v.id), [s.people.wren]);
      const d = [...s.decisions].reverse().find((x) => x.label === "ballot:wren");
      return d.q.vote.probs.sylvie;
    };
    const p0 = await probe(0), p3 = await probe(3);
    return ok(p3 > p0 * 1.5, `Wren's probability of voting Sylvie out: no slights ${p0.toFixed(3)}, after three small digs ${p3.toFixed(3)}`);
  } },
  { id: "DEC-4", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const by = {};
      for (const d of s.decisions.filter((d) => d.label.startsWith("hourly:") && d.q.vote)) (by[d.actor] ??= []).push(d);
      for (const [who, ds] of Object.entries(by)) for (let i = 1; i < ds.length; i++) {
        const a = ds[i - 1], b = ds[i];
        if (a.q.vote.pick === b.q.vote.pick || a.q.vote.pick === "undecided" || b.q.vote.pick === "undecided") continue;
        n++;
        const t0 = a.day * 1440 + a.minute, t1 = b.day * 1440 + b.minute;
        if (t1 - t0 > 180) continue;
        const between = s.trace.some((c) => c.who === who && !/^rule:/.test(c.cause) && (c.what === "rel" || c.what === "belief") && c.day * 1440 + c.minute > t0 && c.day * 1440 + c.minute <= t1);
        if (!between) bad.push(`${si}/${who} ${a.id}->${b.id}`);
      }
    }
    return ok(!bad.length, `${n} changes of mind about the vote; ${bad.length} within three hours with nothing new in between ${bad.slice(0, 3)}`);
  } },
  { id: "DEC-5", kind: "scenario", fn: async () => {
    const faces = { friend: {}, rival: {} };
    let aff = { friend: [], rival: [] };
    for (let i = 0; i < 10; i++) for (const kind of ["friend", "rival"]) {
      const c = await F.town(210 + i);
      const s = c.s;
      const r = s.rel.brenna.player;
      r.affinity = kind === "friend" ? 2 : -2; r.trust = kind === "friend" ? 1.5 : -1.5;
      s.minute = 15 * 60;
      pair(c, "brenna", "hesper");
      F.put(c, "player", "plaza", { ...F.at(c, "brenna"), x: F.at(c, "brenna").x - 0.8 });
      const before = r.affinity;
      const { res } = await F.sim.giveGift(s, "player", "brenna", "flowers", null, c.ui);
      const face = res.brenna?.face;
      faces[kind][face] = (faces[kind][face] || 0) + 1;
      aff[kind].push(r.affinity - before);
    }
    const warm = (k) => (faces[k].delighted || 0) + (faces[k].pleased || 0);
    return ok(warm("friend") >= 8 && warm("rival") <= 5 && F.mean(aff.friend) > F.mean(aff.rival), `the same flowers from the newcomer: to a friend ${JSON.stringify(faces.friend)} (liking ${F.mean(aff.friend).toFixed(2)}), to a rival ${JSON.stringify(faces.rival)} (liking ${F.mean(aff.rival).toFixed(2)})`);
  } },
  { id: "DEC-6", kind: "scenario", fn: async () => {
    let n = 0, up = 0; const ps = [];
    for (const seed of [220, 221, 222, 223, 224, 225]) for (const who of ["wren", "brenna", "juniper"]) {
      const p = [];
      for (const trust of [-1, 0.5, 2]) {
        const c = await F.town(seed);
        const s = c.s;
        s.rel[who].celeste.trust = trust;
        pair(c, "celeste", who);
        await F.speak(c, "celeste", who, [{ text: "Will you keep an eye on Odette for me?", moves: [{ type: "request", to: F.first(c, who), content: "keep an eye on Odette", kind: "other" }] }]);
        const d = [...s.decisions].reverse().find((x) => x.actor === who && x.q.m0_accept);
        p.push(d.q.m0_accept.p);
      }
      n++; if (p[0] < p[1] && p[1] < p[2]) up++;
      ps.push(p.map((x) => x.toFixed(2)).join("<"));
    }
    return ok(up === n, `raising trust in Celeste raised the probability of saying yes in ${up}/${n} sampled cases (${ps.slice(0, 4).join(", ")} ...)`);
  } },
  { id: "DEC-7", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      for (const m of s.moves) for (const [P, d] of Object.entries(m.judged || {})) { n++; const e = F.R.decisionById(s, d); if (!e || e.actor !== P) bad.push(`${si}/${m.id}:${P}`); }
      for (const e of s.world.filter((e) => ["talk_open", "depart", "ballot", "gift", "board_post", "fight"].includes(e.type) && s.people[e.actor])) {
        n++;
        const d = F.R.decisionById(s, e.cause);
        if (!d && !/^(e\d+|rule:(vote|welcome-party|show|gather|night|dawn)|mv\d+)$/.test(e.cause)) bad.push(`${si}/${e.id}:${e.type}:${e.cause}`);
      }
      for (const d of s.decisions) if (!d.label || !Object.keys(d.q).length || !d.used) bad.push(`${si}/${d.id} incomplete`);
    }
    return ok(n && !bad.length, `${n} judgments and actions; ${bad.length} not linked to a logged decision with its question, options, probabilities, pick and inputs ${bad.slice(0, 3)}`);
  } },

  { id: "FAN-1", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const labels = new Set(s.decisions.map((d) => d.label));
      for (const e of s.world.filter((e) => (e.type === "line" || e.type === "show_line") && (e.content.moves || []).length)) {
        const real = (e.content.moves || []).map((id) => s.moves.find((m) => m.id === id)).filter((m) => m && m.type !== "tone");
        if (!real.length) continue;
        for (const p of e.perceivers) {
          if (p.id === e.actor || !s.people[p.id] || !["addressed", "overheard"].includes(p.how)) continue;
          if (s.people[p.id].outDay != null && s.people[p.id].outDay < e.day) continue;
          n++;
          if (!labels.has(`react:${p.id}<-${e.id}`)) bad.push(`${si}/${e.id}:${p.id}`);
        }
      }
    }
    return ok(n && !bad.length, `${n} (event, perceiver) pairs with real moves; ${bad.length} without her reaction request ${bad.slice(0, 3)}`);
  } },
  { id: "FAN-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const multi = (s.rounds || []).filter((r) => r.n > 1);
    const worst = Math.max(...multi.map((r) => r.spread));
    const big = Math.max(...multi.map((r) => r.n));
    return ok(multi.length && worst <= 50, `${multi.length} rounds with several perceivers (up to ${big} at once); the latest request started at most ${worst} ms after the first`);
  } },
  { id: "FAN-3", kind: "scenario", fn: async () => {
    const c = await F.town(230);
    const s = c.s;
    const qsOf = (who, label) => { const d = [...s.decisions].reverse().find((x) => x.actor === who && x.label.startsWith(label)); return d ? Object.keys(d.q).map((k) => k.replace(/^m\d+_/, "")) : []; };
    const has = (got, want) => want.every((w) => got.includes(w));
    const out = [];
    pair(c, "odette", "wren");
    F.knowAs(c, "odette", "wren", "Wren waters down the cider");
    await F.speak(c, "odette", "wren", [{ text: "Everyone knows you water down the cider, Wren.", moves: [{ type: "claim", about: "Wren", content: "Wren waters down the cider" }] }]);
    out.push(["claim about her", has(qsOf("wren", "react:wren"), ["believe", "liar", "payback", "feel"])]);
    F.knowAs(c, "odette", "brenna", "Brenna cheated at the fair");
    await F.speak(c, "odette", "wren", [{ text: "Brenna cheated at the fair, you know.", moves: [{ type: "claim", about: "Brenna", content: "Brenna cheated at the fair" }] }]);
    out.push(["claim about another", has(qsOf("wren", "react:wren"), ["believe", "liar", "onX", "pass", "act", "feel"])]);
    await F.speak(c, "odette", "wren", [{ text: "I'm voting out Juniper tonight.", moves: [{ type: "promise", content: "vote out Juniper", kind: "vote", target: "Juniper" }] }]);
    out.push(["vote pledge", has(qsOf("wren", "react:wren"), ["sincere", "join"])]);
    F.T.end(s, F.T.talkOf(s, "odette"), "test", "rule:test", c.ui);
    F.put(c, "player", "plaza", { ...F.at(c, "wren"), x: F.at(c, "wren").x - 0.8 });
    await F.sim.giveGift(s, "player", "wren", "cupcake", null, c.ui);
    out.push(["gift", has(qsOf("wren", "gift:wren"), ["like", "motive"])]);
    return ok(out.every((x) => x[1]), out.map(([k, v]) => `${k}: ${v ? "expected questions" : "MISSING"}`).join("; ") + ` (claim about her asks ${qsOf("wren", "react:wren").length ? "" : ""}believe/liar/payback/feel; gift asks like/motive, and owing follows from liking)`);
  } },
  { id: "FAN-4", kind: "scenario", fn: async () => {
    for (let seed = 240; seed < 280; seed++) {
      const c = await F.town(seed);
      const s = c.s;
      pair(c, "tansy", "brenna");
      near(c, "sylvie", "tansy", 1.2, 1.4); near(c, "celeste", "tansy", -1.2, 1.4); near(c, "pippa", "tansy", 1.6, -1.2); near(c, "juniper", "tansy", -1.5, -1.3); near(c, "wren", "tansy", 2.2, 0.3);
      for (const id of ["brenna", "sylvie", "celeste", "pippa", "juniper", "wren"]) { s.people[id].bias.temper = 1; s.people[id].mood.anger = 1.5; s.rel[id].odette.affinity = -2; }
      F.put(c, "odette", "market");
      F.knowAs(c, "tansy", "odette", "Odette rigged the scales at her stall to cheat everyone", { harm: -1.6 });
      await F.speak(c, "tansy", "brenna", [{ text: "Odette rigged the scales at her stall to cheat everyone.", moves: [{ type: "claim", about: "Odette", content: "Odette rigged the scales at her stall to cheat everyone" }] }]);
      const x = (s.clashes || []).find((k) => k.target === "odette");
      if (!x) continue;
      const second = s.people[x.second].agenda.find((it) => it.target === "odette");
      const firstIt = s.people[x.first].agenda.find((it) => it.target === "odette");
      return ok(firstIt?.now && second && !second.now && second.after === x.first && F.R.decisionById(s, x.decision) && F.R.decisionById(s, x.firstDecision), `seed ${seed}: ${F.first(c, x.first)} and ${F.first(c, x.second)} both decided to go after Odette right away; ${F.first(c, x.first)} goes now (${x.firstDecision}), ${F.first(c, x.second)} goes after her (${x.decision}, queued after ${x.first})`);
    }
    return ok(false, "no seed produced two women deciding to go after the same person at once");
  } },
  { id: "FAN-5", kind: "audit", fn: async () => {
    await all();
    const st = F.react.stats;
    return ok(st.cascades > 0 && st.maxDepth >= 2 && st.depthBound / Math.max(1, st.rounds) < 0.005, `${st.cascades} visible reactions started rounds of their own, chains up to ${st.maxDepth} deep; the depth cap bound ${st.depthBound} times in ${st.rounds} rounds`);
  } },
  { id: "FAN-6", kind: "scenario", fn: async () => {
    let instant = 0, later = 0, towns = 0;
    for (const seed of [250, 251, 252, 253, 254, 255]) {
      const c = await F.town(seed);
      const s = c.s;
      towns++;
      pair(c, "odette", "marigold");
      for (const [id, dx, dz] of [["pippa", 1.5, 1], ["wren", -1.4, 1.2], ["hesper", 1.8, -1.2], ["brenna", -1.6, -1], ["juniper", 2.4, 0.4]]) { near(c, id, "marigold", dx, dz); s.rel[id].marigold.affinity = Math.max(1.4, s.rel[id].marigold.affinity); }
      const { r } = await F.speak(c, "odette", "marigold", [{ text: "Marigold, your buns are as stale and sad as you are.", moves: [{ type: "insult", to: "Marigold", content: "calls her stale and sad" }] }]);
      instant += r.outbursts.length + r.agenda.filter((a) => a.now).length;
      later += r.agenda.filter((a) => !a.now).length;
    }
    return ok(instant > 0 && later > 0, `a public insult of a well-liked woman, ${towns} towns: ${instant} reactions on the spot (gasps, walk-offs, stepping in now) and ${later} queued for later; timing is part of each woman's answer`);
  } },
  { id: "FAN-7", kind: "scenario", fn: async () => {
    const res = { nervous: [], practiced: [] };
    for (let i = 0; i < 12; i++) for (const kind of ["nervous", "practiced"]) {
      const c = await F.town(260 + i);
      const s = c.s;
      const liar = kind === "nervous" ? "marigold" : "odette";
      if (kind === "nervous") { s.minute = 18 * 60 + 30; s.people.marigold.mood.fear = 1.6; }
      else { s.minute = 9 * 60; s.people.odette.mood.fear = 0; }
      pair(c, liar, "hesper");
      const t = F.T.open(s, liar, "hesper", { reason: "a test", cause: "rule:test", ui: c.ui });
      const plan = await F.T.chooseIntent(s, t, liar, "hesper");
      const lie = { about: "juniper", content: "Juniper has been skimming money from the till", truth: "she made it up" };
      await F.speak(c, liar, "hesper", [{ text: "Juniper has been skimming money from the till.", moves: [{ type: "claim", about: "Juniper", content: "Juniper has been skimming money from the till", lie: true }] }], { plan: { decision: plan.decision, delivery: plan.delivery, lie } });
      const d = [...s.decisions].reverse().find((x) => x.actor === "hesper" && x.q.m0_liar);
      res[kind].push({ caught: d.q.m0_liar.yes, p: d.q.m0_liar.p, delivery: plan.delivery });
    }
    const m = (k, f) => F.mean(res[k].map(f));
    return ok(m("nervous", (x) => x.p) > m("practiced", (x) => x.p) && res.nervous.filter((x) => x.caught).length >= res.practiced.filter((x) => x.caught).length, `nervous Marigold at 6:30pm on vote day: delivery ${m("nervous", (x) => x.delivery).toFixed(2)}, Hesper senses the lie p=${m("nervous", (x) => x.p).toFixed(2)}, caught ${res.nervous.filter((x) => x.caught).length}/12; practiced Odette at 9am: delivery ${m("practiced", (x) => x.delivery).toFixed(2)}, p=${m("practiced", (x) => x.p).toFixed(2)}, caught ${res.practiced.filter((x) => x.caught).length}/12`);
  } },
  { id: "FAN-8", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const have = new Set(s.decisions.filter((d) => d.label.startsWith("hourly:")).map((d) => `${d.actor}:${d.day}:${Math.floor(d.minute / 60)}`));
      const lastDay = Math.max(...s.decisions.map((d) => d.day));
      for (const v of Object.values(s.people)) for (let day = 1; day < lastDay; day++) for (let h = 9; h < 19; h++) {
        if (v.outDay != null && v.outDay <= day) continue;
        n++;
        if (!have.has(`${v.id}:${day}:${h}`)) bad.push(`${si}/${v.id} d${day} ${h}h`);
      }
    }
    return ok(n && bad.length / n < 0.02, `${n} woman-hours; ${bad.length} without a reconsideration (${bad.slice(0, 3)})`);
  } },
];
