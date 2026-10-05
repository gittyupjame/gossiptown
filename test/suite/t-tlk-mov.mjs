import * as F from "./fixtures.mjs";
const { ok } = F;
const lineEvs = (s) => s.world.filter((e) => (e.type === "line" || e.type === "show_line") && s.people[e.actor]);
const movesOf = (s, e) => (e.content.moves || []).map((id) => s.moves.find((m) => m.id === id)).filter(Boolean);

export const tests = [
  { id: "TLK-1", kind: "audit", fn: async () => {
    const { s, writer } = await F.main();
    const evs = lineEvs(s);
    const said = new Set([...writer.said.keys()].map(F.voice.cleanLine));
    const written = evs.filter((e) => said.has(F.voice.cleanLine(e.content.text))).length;
    const silent = Object.values(s.talks).filter((t) => t.status === "ended" && !t.turns.length && !t.end?.reason).length;
    return ok(evs.length && written === evs.length && !silent, `${written}/${evs.length} spoken lines were written by the dialogue model (no canned lines); talks that ended silently without a reason: ${silent}`);
  } },
  { id: "TLK-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    for (const t of Object.values(s.talks)) for (const turn of t.turns) {
      if (turn.by === "player") continue;
      n++;
      const e = F.R.evById(s, turn.ev);
      const d = F.R.decisionById(s, e?.cause);
      if (!d || d.actor !== turn.by || !/^(intent|react):/.test(d.label)) bad.push(`${t.id}:${turn.ev} cause ${e?.cause}`);
    }
    return ok(n && !bad.length, `${n} lines by women; ${bad.length} without her own intent decision ${bad.slice(0, 3)}`);
  } },
  { id: "TLK-3", kind: "audit", fn: async () => {
    const { s, writer } = await F.main();
    let leaks = 0, checked = 0;
    for (const sec of Object.values(s.secrets)) {
      const text = s.rumors[sec.rid].text;
      for (const t of writer.turns) {
        if (t.speaker === sec.owner) continue;
        const v = s.people[t.speaker];
        if (!v || F.B.conf(s, t.speaker, sec.rid) > 0 || Object.keys(v.knows).some((r) => F.B.rootOf(s, r) === sec.root)) continue;
        checked++;
        if (t.prompt.includes(text)) leaks++;
      }
    }
    return ok(checked > 0 && !leaks, `${checked} prompts for women who never learned a given secret; ${leaks} contained it`);
  } },
  { id: "TLK-4", kind: "audit", fn: async () => {
    const all = [await F.main(), ...(await F.seeds())];
    let n = 0, bad = 0;
    for (const { s } of all) for (const e of lineEvs(s)) for (const m of movesOf(s, e)) if (["claim", "accusation", "secret"].includes(m.type)) { n++; if (!m.grounds || m.grounds === "ungrounded") bad++; }
    return ok(n && !bad, `${n} committed claims by women; ${bad} with no matching belief or chosen lie (regenerated ${F.T.stats.regenerated}, gave up and cancelled ${F.T.stats.ungroundedFinal})`);
  } },
  { id: "TLK-5", kind: "inspect", fn: async () => {
    const { s, writer } = await F.main();
    const bad = writer.turns.filter((t) => { const v = s.people[t.speaker]; return !v || !t.prompt.includes(v.voice) || !t.prompt.includes(v.traits.join(", ")); }).length;
    const voices = new Set(Object.values(s.people).map((v) => v.voice)).size;
    return ok(!bad && voices === Object.keys(s.people).length, `every prompt carries her own voice and traits (${writer.turns.length} prompts, ${voices} distinct voices); a blind rater needs the live model (not in this headless run)`);
  } },
  { id: "TLK-6", kind: "audit", fn: async () => {
    const st = F.T.stats;
    const on = st.onscreenMoves / Math.max(1, st.onscreenLines), off = st.offscreenMoves / Math.max(1, st.offscreenLines);
    const hours = Object.keys(F.runtime.budget.used).length, bound = Object.keys(F.runtime.budget.bound).length;
    return ok(st.offscreenLines > 50 && off >= on * 0.6, `off-screen lines ${st.offscreenLines} (${off.toFixed(2)} moves/line) vs on-screen ${st.onscreenLines} (${on.toFixed(2)}); talk-length cap bound ${st.capped}x; spend ceiling bound in ${bound} of ${hours} hours`);
  } },
  { id: "TLK-7", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const ts = Object.values(s.talks).filter((t) => t.a !== "player");
    const bad = ts.filter((t) => !t.reason || !F.R.decisionById(s, t.cause));
    const byPlayer = Object.values(s.talks).filter((t) => t.a === "player").length, toPlayer = ts.filter((t) => t.b === "player").length;
    return ok(ts.length && !bad.length, `${ts.length} talks opened by women (${toPlayer} with the newcomer), ${byPlayer} by the newcomer; ${bad.length} without a decision and reason`);
  } },
  { id: "TLK-8", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const ended = Object.values(s.talks).filter((t) => t.status === "ended");
    const bad = ended.filter((t) => !t.end?.reason || !t.end?.cause);
    const why = {};
    for (const t of ended) { const k = t.end.reason.replace(/[A-Z][a-z]+/g, "X"); why[k] = (why[k] || 0) + 1; }
    return ok(ended.length && !bad.length, `${ended.length} ended talks, ${bad.length} without a stored reason; top: ${Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} (${n})`).join(", ")}`);
  } },
  { id: "TLK-9", kind: "scenario", fn: async () => {
    const c = await F.town(71);
    const s = c.s;
    const A0 = F.at(c, "celeste");
    for (const v of Object.values(s.people)) if (!["celeste", "sylvie"].includes(v.id)) F.put(c, v.id, "dock");
    F.put(c, "sylvie", "plaza", { x: A0.x + 0.8, z: A0.z });
    const t = F.T.open(s, "celeste", "sylvie", { reason: "a test", cause: "rule:test", ui: c.ui });
    await Promise.all(F.T.advance(s, c.ui)); // her first line
    s.minute += 3;
    await Promise.all(F.T.advance(s, c.ui)); // reactions: Sylvie's answer is planned
    F.put(c, "odette", "plaza", { x: A0.x + 1.5, z: A0.z + 1.2 }); // Odette walks up
    s.minute += 3;
    const before = c.writer.turns.length;
    await Promise.all(F.T.advance(s, c.ui));
    const next = c.writer.turns.slice(before).find((x) => ["sylvie", "celeste"].includes(x.speaker));
    return ok(t.interrupts?.some((x) => x.who === "odette") && next && /Odette just walked up/.test(next.setting), `interruption stored: ${!!t.interrupts?.length}; the next line (${next?.speaker}) was written knowing "${next?.setting?.match(/Odette[^.]*\./)?.[0] || "?"}"`);
  } },

  { id: "MOV-1", kind: "scenario", fn: async () => {
    const c = await F.town(72);
    const types = ["claim", "promise", "plan", "request", "agreement", "refusal", "threat", "accusation", "compliment", "insult", "secret", "question", "tone"];
    const line = "Brenna lied. I'll vote Wren. I mean to ask Hesper. Vote with me? Yes. No. Watch it. You cheated. Nice hat. You fool. Pippa owes money. Who's next?";
    const bits = line.split(/(?<=[.?]) /);
    const raw = [
      { type: "claim", span: bits[0], about: "Brenna", content: "Brenna lied" }, { type: "promise", span: bits[1], content: "vote out Wren", kind: "vote", target: "Wren" },
      { type: "plan", span: bits[2], content: "ask Hesper", kind: "ask", target: "Hesper" }, { type: "request", span: bits[3], content: "vote with me", kind: "vote" },
      { type: "agreement", span: bits[4], content: "yes" }, { type: "refusal", span: bits[5], content: "no" }, { type: "threat", span: bits[6], content: "watch it" },
      { type: "accusation", span: bits[7], about: "Sylvie", content: "Sylvie cheated" }, { type: "compliment", span: bits[8], content: "nice hat" }, { type: "insult", span: bits[9], content: "fool" },
      { type: "secret", span: bits[10], about: "Pippa", content: "Pippa owes money" }, { type: "question", span: bits[11], content: "who's next" }, { type: "tone", content: "hostile" },
    ];
    c.writer.player.set(line, raw);
    const got = await F.voice.extract(c.s, { line, speaker: "Rosie", listeners: ["Sylvie"], playerName: "Rosie" });
    const res = F.moves.check(c.s, got, { line, speaker: "player", listeners: ["sylvie"] });
    const kinds = new Set([...res.moves.map((m) => m.type), res.tone ? "tone" : null]);
    const missing = types.filter((t) => !kinds.has(t));
    return ok(!missing.length && !res.rejects.length, `extracted ${kinds.size - (kinds.has(null) ? 1 : 0)} of ${types.length} move types${missing.length ? `; missing ${missing}` : ""}`);
  } },
  { id: "MOV-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    for (const m of s.moves) {
      const e = F.R.evById(s, m.ev); if (!e) continue;
      n++;
      if (!m.by || !Array.isArray(m.to) || !m.content || !F.moves.spanOk(e.content.text, m.span)) bad.push(m.id);
      if (["claim", "accusation", "secret"].includes(m.type) && !m.about) bad.push(m.id);
    }
    return ok(n && !bad.length, `${n} moves; ${bad.length} missing speaker/addressee/subject/content or a span of the real words`);
  } },
  { id: "MOV-3", kind: "scenario", fn: async () => {
    const c = await F.town(73);
    const s = c.s;
    let once = true;
    c.writer.hook = (ctx) => (once && ctx.v.id === "celeste" ? ((once = false), { line: "Odette is a cheat and a fraud.", moves: [{ type: "insult", span: "words that were never said", content: "calls her a cheat" }] }) : null);
    c.writer.player.set("Odette is a cheat and a fraud.", [{ type: "insult", span: "Odette is a cheat and a fraud", to: "Odette", content: "calls her a cheat and a fraud" }]);
    const A0 = F.at(c, "celeste"); F.put(c, "odette", "plaza", { x: A0.x + 0.8, z: A0.z });
    const t = F.T.open(s, "celeste", "odette", { reason: "a test", cause: "rule:test", ui: c.ui });
    const ex0 = c.writer.kinds.extract || 0;
    await Promise.all(F.T.advance(s, c.ui));
    const rej = (s.rejects || []).find((r) => r.who === "celeste" && r.retry);
    const turn = t.turns[0];
    const kept = turn && turn.moves.map((id) => s.moves.find((m) => m.id === id)).some((m) => m.type === "insult");
    return ok(rej && (c.writer.kinds.extract || 0) > ex0 && kept, `bad move logged: "${rej?.why}" (retry ${rej?.retry}); re-extracted from the words; committed insult: ${kept}`);
  } },
  { id: "MOV-4", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    for (const e of lineEvs(s).concat(s.world.filter((e) => e.type === "line" && e.actor === "player"))) for (const m of movesOf(s, e)) {
      for (const p of e.perceivers) {
        if (p.id === e.actor || p.id === "player" || !s.people[p.id]) continue;
        if (!["addressed", "overheard"].includes(p.how)) continue;
        if (s.people[p.id].outDay != null && s.people[p.id].outDay < e.day) continue;
        if (m.type === "tone") continue;
        n++;
        if (!m.judged?.[p.id]) bad.push(`${m.id}:${p.id}`);
      }
    }
    return ok(n && !bad.length, `${n} (move, listener) pairs; ${bad.length} without a judgment ${bad.slice(0, 3)}`);
  } },
  { id: "MOV-5", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0, bad = 0, dismissed = 0, changed = 0;
    for (const m of s.moves) for (const P of Object.keys(m.judged || {})) { n++; const e = m.effects?.[P]; if (e == null) bad++; else if (e === "dismissed") dismissed++; else changed++; }
    const cited = s.trace.filter((c) => /^mv\d+$/.test(c.cause)).length;
    return ok(n && !bad, `${n} judgments: ${changed} changed her state, ${dismissed} stored as heard and dismissed, ${bad} neither; ${cited} trace entries cite a move`);
  } },
  { id: "MOV-6", kind: "scenario", fn: async () => {
    const lines = ["I'll vote Sylvie out tonight, you have my word.", "Count on me, my vote goes against Sylvie.", "Sylvie's going home and I'm the one voting for it, promise."];
    const out = [];
    for (const text of lines) {
      const c = await F.town(74);
      F.put(c, "player", "plaza", { ...F.at(c, "wren"), x: F.at(c, "wren").x + 0.8 });
      await F.playerSay(c, "wren", text, [{ type: "promise", span: text, to: "Wren", content: "vote out Sylvie", kind: "vote", target: "Sylvie" }]);
      const cm = c.s.ledger.find((x) => x.by === "player");
      const mv = c.s.moves.find((m) => m.by === "player" && m.type === "promise");
      const d = c.s.decisions.find((x) => x.actor === "wren" && x.id === mv?.judged?.wren);
      out.push({ k: cm && `${cm.kind}:${cm.target}`, p: d?.q?.m0_sincere?.p });
    }
    const same = out.every((o) => o.k === "vote:sylvie");
    const ps = out.map((o) => o.p).filter((x) => x != null);
    const spread = Math.max(...ps) - Math.min(...ps);
    return ok(same && ps.length === 3 && spread < 0.15, `three paraphrases -> ${out.map((o) => o.k).join(", ")}; Wren's belief she means it: ${ps.map((p) => p.toFixed(2)).join(", ")}`);
  } },
  { id: "MOV-7", kind: "scenario", fn: async () => {
    const c = await F.town(75);
    const A0 = F.at(c, "sylvie");
    F.put(c, "marigold", "plaza", { x: A0.x + 0.8, z: A0.z }); F.put(c, "hesper", "plaza", { x: A0.x + 2, z: A0.z + 1 });
    const before = c.s.rel.hesper.sylvie.affinity;
    const { L } = await F.speak(c, "sylvie", "marigold", [{ text: "You're a talentless little nobody, Marigold.", moves: [{ type: "insult", to: "Marigold", content: "calls her a talentless nobody" }] }]);
    const how = L.ev.perceivers.find((p) => p.id === "hesper")?.how;
    const after = c.s.rel.hesper.sylvie.affinity;
    const judged = L.moves[0].judged.hesper;
    return ok(how === "overheard" && judged && after !== before, `Hesper ${how} it, judged it (${judged}); her liking for Sylvie ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  } },
  { id: "MOV-8", kind: "audit", fn: async () => {
    const st = F.T.stats;
    const share = st.small / Math.max(1, st.lines);
    return ok(share <= 0.35, `small-talk lines ${st.small} of ${st.lines} (${(share * 100).toFixed(0)}%, ceiling 35%)`);
  } },
];
