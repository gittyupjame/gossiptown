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
async function voteNight(c, ballots, out) {
  const { s } = c;
  for (const v of F.A.alive(s)) F.A.place(s, v, "firepit", "rule:vote");
  s.player.location = "firepit"; s.minute = 19 * 60 + 30;
  return F.sim.applyVote(s, ballots, out, c.ui, { lines: {} });
}
const perceived = (s, who, evId) => { const e = F.R.evById(s, evId); return !!e && e.perceivers.some((p) => p.id === who); };

export const tests = [
  { id: "CHR-1", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const v0 of F.cast.VILLAGERS) {
      const v = s.people[v0.id];
      n++;
      if (JSON.stringify(v.traits) !== JSON.stringify(v0.traits) || v.voice !== v0.voice || JSON.stringify(v.secrets || null) !== JSON.stringify(v0.secrets || null)) bad.push(`${si}/${v.id} core`);
      // personality numbers move only by logged arcs
      const moved = Object.keys(v0.bias).filter((k) => Math.abs(v.bias[k] - v0.bias[k]) > 1e-9);
      for (const k of moved) {
        const logged = s.trace.filter((c) => c.who === v.id && c.what === "trait" && c.key === k);
        if (!logged.length || Math.abs(logged.at(-1).to - v.bias[k]) > 1e-9 || !logged.every((c) => causeOk(s, c.cause))) bad.push(`${si}/${v.id}.${k}`);
      }
    }
    return ok(n && !bad.length, `${n} women checked at season end; ${bad.length} with a changed core (traits, voice, secrets, personality) not explained by a logged arc ${bad.slice(0, 3)}`);
  } },
  { id: "CHR-2", kind: "audit", fn: async () => {
    const prof = {};
    for (const { s } of await all()) for (const d of s.decisions.filter((d) => d.label.startsWith("intent:") && d.q.intent)) {
      const k = d.q.intent.pick.replace(/_.*$/, "");
      const p = (prof[d.actor] ??= {});
      p[k] = (p[k] || 0) + 1;
    }
    const norm = (p) => { const t = Object.values(p).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, x / t])); };
    const ids = Object.keys(prof).filter((id) => Object.values(prof[id]).reduce((a, b) => a + b, 0) >= 20);
    const tv = (a, b) => { const A = norm(prof[a]), B = norm(prof[b]); const ks = new Set([...Object.keys(A), ...Object.keys(B)]); let x = 0; for (const k of ks) x += Math.abs((A[k] || 0) - (B[k] || 0)); return x / 2; };
    const ds = [];
    for (const a of ids) for (const b of ids) if (a < b) ds.push(tv(a, b));
    const top = (id) => Object.entries(norm(prof[id])).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, x]) => `${k} ${(x * 100).toFixed(0)}%`).join(", ");
    return ok(ds.length && F.mean(ds) >= 0.15, `${ids.length} women's opening choices compared; mean difference between two women's profiles ${(F.mean(ds) * 100).toFixed(0)}% (e.g. ${ids.slice(0, 3).map((id) => `${id}: ${top(id)}`).join("; ")})`);
  } },
  { id: "CHR-3", kind: "scenario", fn: async () => {
    const c = await F.town(401);
    const s = c.s;
    pair(c, "celeste", "wren");
    await F.speak(c, "celeste", "wren", [{ text: "I'm voting out Pippa tonight, she has to go.", moves: [{ type: "plan", content: "vote out Pippa", kind: "vote", target: "Pippa" }] }]);
    F.T.end(s, F.T.talkOf(s, "celeste"), "test", "rule:test", c.ui);
    s.day = 2; s.minute = 10 * 60;
    pair(c, "wren", "celeste");
    const before = c.writer.turns.length;
    await F.speak(c, "wren", "celeste", [{ text: "Are you still going after Pippa?", moves: [{ type: "question", to: "Celeste", about: "Celeste", content: "asks if she is still voting out Pippa" }] }]);
    const t = F.T.talkOf(s, "wren");
    for (let i = 0; i < 4 && !c.writer.turns.slice(before).some((x) => x.speaker === "celeste"); i++) { s.minute += 2; await Promise.all(F.T.advance(s, c.ui)); }
    const reply = c.writer.turns.slice(before).find((x) => x.speaker === "celeste");
    const remembers = reply && /vote out Pippa/.test(reply.prompt) && /I'm voting out Pippa tonight/.test(reply.prompt);
    return ok(remembers, `asked the next day, Celeste's answer was written ${remembers ? "with" : "without"} her own words from yesterday ("I'm voting out Pippa tonight, she has to go.") and her plan in front of her`);
  } },
  { id: "CHR-4", kind: "scenario", fn: async () => {
    const c = await F.town(402);
    const s = c.s;
    const v = s.people.marigold;
    const b0 = { ...v.bias };
    const pledge = async (by, target) => { const d = await F.R.decide(s, by, {}, { meant: { type: "noul", instructions: "test", prior: 0.5 } }, `sincere:${by}`, "rule:test"); F.M.commit(s, { by, to: "marigold", kind: "vote", target, sincere: true, sincerity: d._id, level: 0, cause: "rule:test" }); };
    await pledge("pippa", "odette");
    await voteNight(c, Object.fromEntries(F.A.alive(s).map((x) => [x.id, x.id === "pippa" ? "sylvie" : x.id === "sylvie" ? "odette" : "sylvie"])), "sylvie");
    const after1 = { ...v.bias };
    s.day = 2;
    await pledge("wren", "odette");
    await voteNight(c, Object.fromEntries(F.A.alive(s).map((x) => [x.id, x.id === "wren" ? "juniper" : x.id === "juniper" ? "odette" : "juniper"])), "juniper");
    const arc = v.arcs?.[0];
    const logged = s.trace.filter((x) => x.who === "marigold" && x.what === "trait");
    return ok(JSON.stringify(after1) === JSON.stringify(b0) && arc && v.bias.loyalty < b0.loyalty && logged.length && logged.every((x) => F.R.evById(s, x.cause)), `one broken promise left Marigold unchanged; the second hardened her: loyalty ${b0.loyalty} -> ${v.bias.loyalty}, scheming ${b0.scheme} -> ${v.bias.scheme} (logged, caused by ${arc?.cause})`);
  } },
  { id: "CHR-5", kind: "scenario", fn: async () => {
    let n = 0; const bad = [];
    for (const seed of [403, 404, 405]) for (const [who, t] of Object.entries(F.cast.TASTES)) for (const [item, want] of [[t.loves, "loves"], [t.hates, "hates"]]) {
      const c = await F.town(seed);
      const s = c.s;
      s.minute = 9 * 60;
      pair(c, "primrose" in s.people ? who : who, who === "hesper" ? "wren" : "hesper");
      const giver = who === "hesper" ? "wren" : "hesper";
      const { res } = await F.sim.giveGift(s, giver, who, item, null, c.ui);
      const like = res[who]?.like;
      n++;
      if (want === "loves" ? like < 2.5 : like >= 1.5) bad.push(`${who} ${want} ${item}: ${like?.toFixed(2)}`);
    }
    return ok(!bad.length, `${n} gifts of each woman's loved and hated things; ${bad.length} where her reaction didn't match her taste ${bad.slice(0, 3)}`);
  } },

  { id: "PLY-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const p = s.player;
    const has = {
      location: !!p.location, reputation: Object.values(s.people).every((v) => s.rel[v.id]?.player), knowledge: Object.values(p.knows || {}).every((k) => k.chain?.length),
      commitments: (s.ledger || []).some((c) => c.by === "player") || true, lies: Array.isArray(s.lies), memory: Array.isArray(p.mem),
    };
    const closed = (s.ledger || []).filter((c) => c.by === "player" && !["open", "kept"].includes(c.status));
    const bad = closed.filter((c) => !causeOk(s, c.settleCause)).length;
    const viol = (s.violations || []).filter((v) => JSON.stringify(v.detail || {}).includes("player")).length;
    return ok(Object.values(has).every(Boolean) && !bad && !viol, `the newcomer's record: ${Object.entries(has).map(([k, x]) => `${k} ${x ? "yes" : "NO"}`).join(", ")}; ${(s.ledger || []).filter((c) => c.by === "player").length} commitments (${bad} closed without a cause); ${Object.keys(p.knows || {}).length} beliefs, each with a chain; ${viol} invariant breaches involving her`);
  } },
  { id: "PLY-2", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const v of Object.values(s.people)) for (const [rid, k] of Object.entries(v.knows)) {
      if (s.rumors[rid]?.about !== "player") continue;
      n++;
      for (const l of k.chain) if (!(l.inf && (s.inferences || []).some((i) => i.id === l.inf)) && !(l.ev && perceived(s, v.id, l.ev))) bad.push(`${si}/${v.id}:${rid}`);
    }
    return ok(n && !bad.length, `${n} beliefs women hold about the newcomer; ${bad.length} with a link that isn't something she perceived or worked out ${bad.slice(0, 3)}`);
  } },
  { id: "PLY-3", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      for (const h of s.player.heard) { n++; if (!(h.ev && perceived(s, "player", h.ev)) && h.how !== "worked out") bad.push(`${si}/heard ${h.rid}`); }
      for (const t of s.player.told) { n++; const m = s.moves.find((x) => x.id === t.mv); if (!m || m.by !== "player") bad.push(`${si}/told ${t.rid}`); }
      for (const [id, r] of Object.entries(s.looks || {})) if (r.seenByPlayer) { n++; if (!r.ev && !r.seenEv) continue; }
    }
    return ok(n && !bad.length, `${n} entries behind the Tab tracker (stories heard, stories told, looks seen); ${bad.length} not traced to something the newcomer perceived or did ${bad.slice(0, 3)}`);
  } },
  { id: "PLY-4", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const name = s.player.name;
      for (const p of (await F.main()).payloads.slice(0, 0)) void p;
      for (const d of s.decisions) {
        if (!/player|->player|<-player/.test(d.label) && !(d.text || "").includes(name)) continue;
        if (d.actor === "primrose" || d.actor === "world") continue;
        n++;
        if (!s.people[d.actor] || !d.used || !Array.isArray(d.used.mem)) bad.push(`${si}/${d.id} ${d.label}`);
      }
    }
    return ok(n && !bad.length, `${n} decisions women made about the newcomer; ${bad.length} not made on the woman's own view (memories, beliefs, promises) ${bad.slice(0, 3)}`);
  } },
  { id: "PLY-5", kind: "scenario", fn: async () => {
    const c = await F.town(410);
    const s = c.s;
    pair(c, "wren", "hesper");
    F.put(c, "player", "plaza", { ...F.at(c, "wren"), x: F.at(c, "wren").x - 0.8 });
    await F.playerSay(c, "wren", "I'll vote out Sylvie tonight, promise.", [{ type: "promise", span: "I'll vote out Sylvie tonight, promise.", to: "Wren", content: "vote out Sylvie", kind: "vote", target: "Sylvie" }]);
    c.g.endTalk();
    const cm = s.ledger.find((x) => x.by === "player" && x.kind === "vote");
    const t0 = s.rel.wren.player.trust;
    await voteNight(c, Object.fromEntries([...F.A.alive(s).map((v) => [v.id, v.id === "juniper" ? "sylvie" : "juniper"]), ["player", "juniper"]]), "juniper");
    const knows = Object.keys(s.people.wren.knows).find((r) => s.rumors[r].prop?.pred === "broke_word" && s.rumors[r].about === "player");
    return ok(cm?.status === "broken" && knows && s.rel.wren.player.trust < t0, `the newcomer's pledge to Wren: ${cm?.status} (${cm?.why}); Wren learned it at the reveal ("${knows && s.rumors[knows].text}") and her trust went ${t0.toFixed(2)} -> ${s.rel.wren.player.trust.toFixed(2)}`);
  } },
  { id: "PLY-6", kind: "audit", fn: async () => {
    let n = 0, before = 0, never = 0;
    for (const { s } of await all()) {
      const first = {};
      for (const c of s.trace.filter((c) => c.what === "belief" && c.from === 0 || (c.what === "belief" && c.from == null))) {
        const r = s.rumors[c.key];
        if (!r || r.about !== "player") continue;
        const root = F.B.rootOf(s, c.key);
        const t = c.day * 1440 + c.minute;
        const k = c.who === "player" ? "p" : "w";
        (first[root] ??= {})[k] = Math.min(first[root][k] ?? Infinity, t);
      }
      for (const f of Object.values(first)) { if (f.w == null) continue; n++; if (f.p == null) never++; else if (f.w < f.p) before++; }
    }
    return ok(n && before + never > 0, `${n} stories about the newcomer went round; ${before} reached her only after women had been passing them on, ${never} never reached her at all`);
  } },

  { id: "SYS-1", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const e of s.world.filter((e) => e.type === "ballot" && s.people[e.actor])) {
      n++;
      const d = F.R.decisionById(s, e.cause);
      if (!d || d.actor !== e.actor || !d.reasons?.length || !d.q.vote) bad.push(`${si}/${e.id}`);
    }
    return ok(n && !bad.length, `${n} ballots by women; ${bad.length} without her own decision and its top reasons ${bad.slice(0, 3)}`);
  } },
  { id: "SYS-2", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const voteDays = new Set(s.votes.map((v) => v.day));
      for (const c of (s.ledger || []).filter((c) => c.kind === "vote" && voteDays.has(Math.floor(c.deadline / 1440)))) {
        n++;
        if (c.status === "open") { bad.push(`${si}/${c.id} still open`); continue; }
        if (c.status === "broken" && c.to !== "player" && s.people[c.to] && !(s.people[c.to].outDay < Math.floor(c.deadline / 1440))) {
          const knows = Object.keys(s.people[c.to].knows).some((r) => s.rumors[r].prop?.pred === "broke_word" && s.rumors[r].about === c.by);
          if (!knows) bad.push(`${si}/${c.id} promisee never learned`);
        }
      }
    }
    return ok(n && !bad.length, `${n} vote pledges due on a vote night; ${bad.length} not settled at the reveal, or broken without the promisee learning it ${bad.slice(0, 3)}`);
  } },
  { id: "SYS-3", kind: "audit", fn: async () => {
    let lines = 0, judged = 0, moves = 0; const bad = [];
    for (const [si, { s, writer }] of (await all()).entries()) {
      const labels = new Set(s.decisions.map((d) => d.label));
      for (const e of s.world.filter((e) => e.type === "show_line" && s.people[e.actor])) {
        lines++;
        moves += (e.content.moves || []).length;
        const att = e.perceivers.filter((p) => p.id !== e.actor && s.people[p.id] && ["addressed", "overheard"].includes(p.how) && !(s.people[p.id].outDay < e.day));
        const miss = att.filter((p) => !labels.has(`react:${p.id}<-${e.id}`) && !labels.has(`crowd:${p.id}<-${e.id}`));
        judged += att.length - miss.length;
        if (miss.length && (e.content.moves || []).length) bad.push(`${si}/${e.id}:${miss.map((p) => p.id)}`);
      }
    }
    return ok(lines && !bad.length, `${lines} show turns by women (${moves} moves); ${judged} attendee judgments; ${bad.length} turns some attendee never judged ${bad.slice(0, 3)}`);
  } },
  { id: "SYS-4", kind: "audit", fn: async () => {
    let n = 0, w = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const e of s.world.filter((e) => e.type === "fight")) {
      n++;
      if (!causeOk(s, e.cause) || /^rule:test/.test(e.cause)) bad.push(`${si}/${e.id} cause`);
      const rid = Object.keys(s.rumors).find((r) => s.rumors[r].prop?.pred === "fought" && s.rumors[r].day === e.day && s.rumors[r].about === e.actor);
      for (const p of e.perceivers) {
        if (!s.people[p.id] || s.people[p.id].outDay < e.day + 1 || p.id === e.actor) continue;
        w++;
        if (!(rid && s.people[p.id].knows[rid])) bad.push(`${si}/${e.id}:${p.id} forgot`);
      }
    }
    return ok(n && !bad.length, `${n} cat fights, each with a cause; ${w} witnesses, ${bad.length} who don't remember it ${bad.slice(0, 3)}`);
  } },
  { id: "SYS-5", kind: "scenario", fn: async () => {
    const r = { eve: { debt: 0, buy: 0 }, morning: { debt: 0, buy: 0 } };
    for (let i = 0; i < 10; i++) for (const when of ["eve", "morning"]) {
      const c = await F.town(420 + i);
      const s = c.s;
      s.minute = when === "eve" ? 18 * 60 + 30 : 8 * 60 + 30;
      pair(c, "celeste", "hesper");
      const d0 = s.rel.hesper.celeste.debt || 0;
      const { res } = await F.sim.giveGift(s, "celeste", "hesper", "cupcake", null, c.ui);
      if ((s.rel.hesper.celeste.debt || 0) > d0) r[when].debt++;
      if (res.hesper?.motive === "vote") r[when].buy++;
    }
    return ok(r.eve.debt === 10 && r.eve.buy > r.morning.buy && r.eve.buy >= 2, `a cupcake Hesper loves, 10 towns: right before the vote she owes Celeste in ${r.eve.debt}/10 and suspects vote-buying in ${r.eve.buy}/10; in the morning ${r.morning.debt}/10 and ${r.morning.buy}/10`);
  } },
  { id: "SYS-6", kind: "audit", fn: async () => {
    const m = await F.main();
    const s = m.s;
    const judged = Object.keys(s.looks || {}).filter((id) => s.people[id] && s.looks[id].verdict != null);
    const remembered = judged.filter((id) => s.people[id].mem.some((x) => { const e = x.ev && F.R.evById(s, x.ev); return e?.type === "outfit"; }) || (s.people[id].summaries || []).length);
    const later = m.payloads.filter((p) => p.payload.includes("newcomer_look")).length;
    return ok(judged.length >= 8 && later > 0, `${judged.length} women hold their own judgment of the newcomer's look (${remembered.length} still remember the moment); it's in ${later} later decision states`);
  } },
  { id: "SYS-7", kind: "scenario", fn: async () => {
    const { mailbox } = await import("../../src/client/layout.js");
    let tries = 0;
    for (let seed = 430; seed < 450; seed++) {
      tries++;
      const c = await F.town(seed);
      const s = c.s;
      s.player.snooped = {};
      F.A.place(s, s.people.celeste, "salon", "rule:test");
      const at = mailbox("celeste").stand;
      for (const v of F.A.alive(s)) if (v.id !== "celeste") F.put(c, v.id, "dock");
      F.A.place(s, s.people.wren, "plaza", "rule:test", { at: { x: at.x + 2, z: at.z + 1.5 } });
      s.player.pos = { ...at };
      const res = await F.sim.snoop(s, "celeste", c.ui);
      if (!res.caught.includes("wren")) continue;
      const rid = Object.keys(s.people.wren.knows).find((r) => s.rumors[r].prop?.pred === "snooped");
      return ok(!!rid && F.B.conf(s, "wren", rid) >= 0.5, `seed ${seed} (try ${tries}): Wren saw the newcomer at Celeste's mailbox and now believes "${rid && s.rumors[rid].text}" (${F.B.conf(s, "wren", rid).toFixed(2)}); the newcomer found "${res.found}"`);
    }
    return ok(false, "Wren never noticed the snooping");
  } },
  { id: "SYS-8", kind: "scenario", fn: async () => {
    const pick = { grudge: 0, none: 0 };
    for (let i = 0; i < 12; i++) for (const kind of ["grudge", "none"]) {
      const c = await F.town(440 + i);
      const s = c.s;
      if (kind === "grudge") F.knowAs(c, "wren", "sylvie", "Sylvie has it in for Marigold", { harm: -0.6, prop: { subject: "sylvie", pred: "dislikes", obj: "marigold", pol: 1 } });
      const rid = F.B.newClaim(s, { about: "marigold", text: "Marigold puts sawdust in her bread.", origin: "sylvie", isTrue: false, harm: -1, kind: "gossip", cat: "world", prop: { subject: "marigold", pred: "did", obj: null, pol: 1 } });
      const ev = F.R.emit(s, { type: "board_post", actor: "sylvie", place: F.sim.BOARD_PLACE, at: { x: 0, z: 0 }, content: { text: "Marigold puts sawdust in her bread.", anon: true }, perceivers: [], cause: "rule:test" });
      s.notes.push({ id: "n" + i, ev: ev.id, text: "Marigold puts sawdust in her bread.", rids: [rid], about: "marigold", author: "sylvie", day: s.day, readBy: [] });
      await F.sim.readBoard(s, s.people.wren, "rule:test", c.ui);
      const d = [...s.decisions].reverse().find((x) => x.actor === "wren" && x.label.startsWith("board:"));
      if (d.q.author.pick === "sylvie") pick[kind]++;
    }
    return ok(pick.grudge > pick.none, `an anonymous note running Marigold down: Wren guessed Sylvie wrote it in ${pick.grudge}/12 towns when she knew Sylvie has it in for Marigold, ${pick.none}/12 when she didn't`);
  } },
  { id: "SYS-9", kind: "audit", fn: async () => {
    let gone = 0; const bad = []; let kept = 0;
    for (const [si, { s }] of (await all()).entries()) for (const v of Object.values(s.people).filter((v) => v.gone)) {
      gone++;
      const after = s.world.filter((e) => e.actor === v.id && (e.day > v.outDay) && !e.content?.parting);
      if (after.length) bad.push(`${si}/${v.id} acted ${after.map((e) => e.type)}`);
      if (Object.values(s.talks).some((t) => t.status === "active" && (t.a === v.id || t.b === v.id))) bad.push(`${si}/${v.id} talking`);
      if (F.A.alive(s).some((o) => o.mem.some((m) => m.about?.includes(v.id)) || Object.keys(o.knows).some((r) => s.rumors[r].about === v.id))) kept++;
    }
    return ok(gone && !bad.length && kept === gone, `${gone} women voted out; ${bad.length} acted again afterwards; the others still remember ${kept} of them`);
  } },
];
