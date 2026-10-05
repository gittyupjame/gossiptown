import * as F from "./fixtures.mjs";
const { ok } = F;
const people = (s) => Object.values(s.people);

export const tests = [
  { id: "EVT-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const bad = [];
    const seen = new Set();
    for (const t of Object.values(s.talks)) for (const turn of t.turns) {
      const e = F.R.evById(s, turn.ev);
      if (!e || e.type !== "line" || e.content.text !== turn.text) bad.push(`turn ${t.id}:${turn.ev}`);
      if (seen.has(turn.ev)) bad.push(`dup ${turn.ev}`); seen.add(turn.ev);
    }
    for (const v of s.votes) if (!v.finale) { const n = s.world.filter((e) => e.type === "ballot" && e.day === v.day).length; if (n !== Object.keys(v.ballots).length) bad.push(`ballots day ${v.day}: ${n} events for ${Object.keys(v.ballots).length}`); }
    const fights = people(s).reduce((t, v) => t + (v.fights || 0), 0) + (s.player.fights || 0);
    const fe = s.world.filter((e) => e.type === "fight").length;
    if (fe !== fights) bad.push(`fights ${fe} events vs ${fights}`);
    for (const [id, r] of Object.entries(s.looks || {})) { const e = F.R.evById(s, r.ev); if (!e || e.type !== "outfit") bad.push(`look ${id}`); }
    for (const n of s.notes || []) if (!F.R.evById(s, n.ev)?.type?.startsWith("board_post")) bad.push(`note ${n.id}`);
    for (const e of s.world) for (const k of ["id", "day", "minute", "type", "actor", "targets", "content"]) if (!(k in e)) bad.push(`${e.id} lacks ${k}`);
    return ok(!bad.length, bad.length ? bad.slice(0, 5).join("; ") : `${seen.size} lines, ${fe} fights, ${s.votes.length} votes, ${Object.keys(s.looks).length} looks each map to one event`);
  } },
  { id: "EVT-2", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const empty = s.world.filter((e) => e.actor && (e.actor === "player" || s.people[e.actor]) && !e.perceivers.length);
    const noHow = s.world.filter((e) => e.perceivers.some((p) => !["did", "addressed", "overheard", "partial", "saw"].includes(p.how)));
    return ok(!empty.length && !noHow.length, `${empty.length} acted events with nobody perceiving, ${noHow.length} with an unknown "how" (of ${s.world.length})`);
  } },
  { id: "EVT-3", kind: "audit", fn: async () => {
    const { s, snaps } = await F.main();
    let changed = [];
    for (const e of s.world) { const was = snaps.get(e.id); if (was && was !== JSON.stringify(e)) changed.push(e.id); }
    const ids = s.world.map((e) => +e.id.slice(1));
    const ordered = ids.every((x, i) => i === 0 || x > ids[i - 1]);
    return ok(!changed.length && ordered, `${changed.length} events changed after commit; ids ${ordered ? "strictly increasing" : "out of order"} (${snaps.size} checked)`);
  } },
  { id: "EVT-4", kind: "audit", fn: async () => {
    const m = await F.main();
    const inPayload = m.payloads.filter((p) => p.payload.includes("CANARY")).length;
    const inPrompt = m.writer.prompts.filter((p) => p.includes("CANARY")).length;
    const placed = m.s.world.some((e) => e.content?.text === F.CANARY);
    return ok(placed && !inPayload && !inPrompt, `canary in world log: ${placed}; in ${inPayload}/${m.payloads.length} Jev payloads and ${inPrompt}/${m.writer.prompts.length} prompts`);
  } },
  { id: "EVT-5", kind: "inspect", fn: async () => {
    const { s } = await F.main();
    const types = new Set(Object.keys(F.R.EVENT_TYPES));
    const unknown = s.world.filter((e) => !types.has(e.type));
    const frozen = Object.isFrozen(F.R.EVENT_TYPES);
    const versioned = s.world.every((e) => e.v === F.R.EVENT_TYPES_VERSION);
    return ok(frozen && versioned && !unknown.length, `${types.size} types, frozen ${frozen}, version ${F.R.EVENT_TYPES_VERSION} on every event: ${versioned}; unknown: ${unknown.length}`);
  } },

  { id: "PRC-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const bad = [];
    for (const v of people(s)) {
      const tr = v.trail || [];
      for (let i = 0; i < tr.length; i++) {
        const x = tr[i];
        if (x.jump && !/^rule:/.test(x.jump)) bad.push(`${v.id} jumped without a rule (${x.jump})`);
        if (x.loc === "lane" && x.eta != null) {
          if (!(x.eta > x.at)) bad.push(`${v.id} travelled in no time`);
          const nxt = tr[i + 1];
          if (nxt && !nxt.jump && nxt.loc !== "lane" && nxt.at < x.eta) bad.push(`${v.id} arrived early`);
        }
      }
      if (typeof v.location !== "string") bad.push(`${v.id} location ${v.location}`);
    }
    return ok(!bad.length && typeof s.player.location === "string", bad.slice(0, 4).join("; ") || "every move takes travel time; jumps only for announced gatherings (rule: causes)");
  } },
  { id: "PRC-2", kind: "scenario", fn: async () => {
    const c = await F.town(21);
    const A0 = F.at(c, "celeste");
    F.put(c, "wren", "plaza", { x: A0.x + 2, z: A0.z }); F.put(c, "odette", "plaza", { x: A0.x + 8, z: A0.z }); F.put(c, "pippa", "plaza", { x: A0.x + 40, z: A0.z });
    F.put(c, "sylvie", "plaza", { x: A0.x + 0.8, z: A0.z + 0.6 });
    const { L } = await F.speak(c, "celeste", "sylvie", [{ text: "Marigold burned the bread on purpose again.", moves: [] }]);
    const how = (id) => L.ev.perceivers.find((p) => p.id === id)?.how || "none";
    const mem = (id) => (c.s.people[id].mem || []).find((m) => m.ev === L.ev.id);
    const r = { wren: how("wren"), odette: how("odette"), pippa: how("pippa") };
    const pass = r.wren === "overheard" && r.odette === "partial" && r.pippa === "none" && mem("wren")?.words === L.ev.content.text && mem("odette")?.words !== L.ev.content.text && !mem("pippa");
    return ok(pass, `2 m: ${r.wren}, 8 m: ${r.odette}, 40 m: ${r.pippa}; partial words: "${mem("odette")?.words}"`);
  } },
  { id: "PRC-3", kind: "scenario", fn: async () => {
    let got = null;
    for (let sd = 30; sd < 40 && !got; sd++) {
      const c = await F.town(sd);
      const A0 = F.at(c, "celeste");
      F.put(c, "sylvie", "plaza", { x: A0.x + 0.8, z: A0.z }); F.put(c, "wren", "plaza", { x: A0.x + 2.5, z: A0.z }); F.put(c, "odette", "plaza", { x: A0.x + 7, z: A0.z });
      const rid = F.knowAs(c, "celeste", "brenna", "Brenna sold the smithy's best anvil to a traveling tinker for cash");
      const r = c.s.rumors[rid];
      const { L } = await F.speak(c, "celeste", "sylvie", [{ text: r.text, moves: [{ type: "claim", about: F.first(c, r.about), content: r.text, belief: rid }] }]);
      const m = c.s.people.odette.mem.find((x) => x.ev === L.ev.id);
      const kp = Object.entries(c.s.people.odette.knows).find(([, k]) => k.chain.some((l) => l.ev === L.ev.id));
      const kf = Object.entries(c.s.people.wren.knows).find(([, k]) => k.chain.some((l) => l.ev === L.ev.id));
      if (m?.how === "partial" && kp) got = { m, kp, kf };
    }
    if (!got) return ok(false, "no partial overhear formed a belief in 10 seeds");
    const lower = !got.kf || got.kp[1].conf <= got.kf[1].conf + 1e-9;
    return ok(got.kp[1].partial && lower, `partial memory "${got.m.words}"; belief flagged partial: ${!!got.kp[1].partial}; conf ${got.kp[1].conf.toFixed(2)} vs full hearer ${got.kf ? got.kf[1].conf.toFixed(2) : "-"}`);
  } },
  { id: "PRC-4", kind: "scenario", fn: async () => {
    const c = await F.town(22);
    const A0 = F.at(c, "brenna");
    F.put(c, "pippa", "plaza", { x: A0.x + 0.8, z: A0.z }); F.put(c, "hesper", "plaza", { x: A0.x + 18, z: A0.z });
    const { L } = await F.speak(c, "brenna", "pippa", [{ text: "Keep this between us, alright?", moves: [] }], { discreet: true });
    const m = c.s.people.hesper.mem.find((x) => x.ev === L.ev.id);
    return ok(m && m.how === "saw" && !m.words && /whispering|talking/.test(m.text), `watcher's memory: ${m ? `"${m.text}" (${m.how}, words: ${m.words ?? "none"})` : "none"}`);
  } },
  { id: "PRC-5", kind: "audit", fn: async () => {
    const all = [await F.main(), ...(await F.seeds())];
    let dq = 0, secret = [], other = [];
    for (const { s } of all) {
      dq += s.decisions.filter((d) => d.q.discreet).length;
      for (const e of s.world.filter((e) => e.type === "line")) {
        const mv = (e.content.moves || []).map((id) => s.moves.find((m) => m.id === id)).filter(Boolean);
        const n = e.perceivers.filter((p) => p.how !== "did" && p.how !== "addressed" && p.how !== "saw").length;
        (mv.some((m) => m.rid && (s.rumors[m.rid]?.kind === "secret" || (s.rumors[m.rid]?.harm || 0) <= -1)) ? secret : other).push(n);
      }
    }
    return ok(dq > 0 && secret.length > 3 && F.mean(secret) < F.mean(other), `${dq} Jev "keep it quiet" decisions; bystanders per line: secrets ${F.mean(secret).toFixed(2)} (n=${secret.length}) vs other ${F.mean(other).toFixed(2)} (n=${other.length})`);
  } },
  { id: "PRC-6", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const lines = s.world.filter((e) => e.type === "show_line");
    const bad = [];
    for (const e of lines) {
      const there = Object.values(s.people).filter((v) => !v.gone || (v.outDay ?? 99) > e.day).map((v) => v.id);
      for (const id of there) {
        const v = s.people[id];
        if (v.outDay != null && v.outDay < e.day) continue;
        const has = v.mem.some((m) => m.ev === e.id) || (v.summaries || []).some((x) => x.evs.includes(e.id));
        if (!e.perceivers.some((p) => p.id === id) || !has) bad.push(`${e.id}:${id}`);
      }
    }
    return ok(lines.length && !bad.length, `${lines.length} show lines; missing attendee memories: ${bad.length} ${bad.slice(0, 3)}`);
  } },

  { id: "MEM-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let n = 0; const bad = [];
    const recs = { ...Object.fromEntries(Object.values(s.people).map((v) => [v.id, v])), player: s.player };
    const index = {};
    for (const [id, v] of Object.entries(recs)) { index[id] = new Map(); for (const m of v.mem || []) if (m.ev) index[id].set(m.ev, m.how); for (const sm of v.summaries || []) for (const e of sm.evs) index[id].set(e, "summary"); }
    for (const e of s.world) for (const p of e.perceivers) {
      const v = recs[p.id]; if (!v) continue;
      if (p.id !== "player" && v.outDay != null && v.outDay < e.day) continue;
      n++;
      const h = index[p.id].get(e.id);
      if (!h) bad.push(`${e.id}:${p.id}`); else if (h !== "summary" && h !== p.how) bad.push(`${e.id}:${p.id} how ${h}/${p.how}`);
    }
    return ok(!bad.length, `${n} perceptions; ${bad.length} without a matching memory ${bad.slice(0, 4)}`);
  } },
  { id: "MEM-2", kind: "scenario", fn: async () => {
    const c = await F.town(23);
    const A0 = F.at(c, "odette");
    F.put(c, "juniper", "plaza", { x: A0.x + 0.8, z: A0.z });
    const text = "Brenna has been watering down the cider at the tavern";
    const { L } = await F.speak(c, "odette", "juniper", [{ text: `${text}.`, moves: [{ type: "claim", about: "Brenna", content: text, lie: true }] }], { plan: { decision: "rule:test", lie: { about: "brenna", content: text, truth: "she made it up" } } });
    const m = c.s.people.juniper.mem.find((x) => x.ev === L.ev.id);
    const mv = L.moves.find((x) => x.type === "claim");
    const r = c.s.rumors[mv.rid];
    const lie = (c.s.lies || []).find((l) => l.mv === mv.id);
    return ok(m && m.text.includes(text) && r.isTrue === false && lie && F.R.evById(c.s, L.ev.id).content.text === `${text}.`, `her memory: "${m?.text}"; claim stored false: ${r.isTrue === false}; lie record: ${!!lie}; event text unchanged`);
  } },
  { id: "MEM-3", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const heavy = [], light = [];
    for (const v of Object.values(s.people)) for (const m of v.mem) {
      const e = m.ev && F.R.evById(s, m.ev); if (!e) continue;
      const mine = e.actor === v.id || e.targets.includes(v.id) || e.content?.out === v.id;
      if (mine && ["fight", "elimination"].includes(e.type) || (e.type === "ballot" && e.targets.includes(v.id))) heavy.push(m.w);
      else if (e.type === "line" && !(e.content.moves || []).length) light.push(m.w);
    }
    const minH = Math.min(...heavy), maxL = Math.max(...light, 0), meanL = F.mean(light);
    return ok(heavy.length && minH > meanL, `fights/votes about her: min weight ${minH} (n=${heavy.length}); small talk: mean ${meanL.toFixed(2)}, max ${maxL} (n=${light.length})`);
  } },
  { id: "MEM-4", kind: "scenario", fn: async () => {
    const c = await F.town(24);
    const A0 = F.at(c, "wren");
    F.put(c, "tansy", "plaza", { x: A0.x + 0.8, z: A0.z });
    const words = "I swear on my kettle I will vote out Sylvie tomorrow night.";
    await F.speak(c, "wren", "tansy", [{ text: words, moves: [{ type: "promise", content: "vote out Sylvie", kind: "vote", target: "Sylvie", to: "Tansy" }] }]);
    c.s.minute += 600; // the next day, in effect
    const quoted = F.M.wordsWith(c.s, "tansy", "wren").some((l) => l.includes(words));
    const payload = JSON.stringify(F.V.view(c.s, "tansy", { with: ["wren"] }).payload);
    return ok(quoted && payload.includes(words), `exact words in her memory: ${quoted}; in her view when she next talks with Wren: ${payload.includes(words)}`);
  } },
  { id: "MEM-5", kind: "scenario", fn: async () => {
    const c = await F.town(25);
    const s = c.s;
    s.people.pippa.mem = [];
    F.M.note(s, "pippa", "Odette snubbed me at the bakery", { w: 1.5, cause: "rule:test", about: ["odette"] });
    F.M.note(s, "pippa", "Juniper read my tea leaves", { w: 1.5, cause: "rule:test", about: ["juniper"] });
    const a = F.M.recall(s, "pippa", { with: ["juniper"], max: 1, mark: false })[0];
    const b = F.M.recall(s, "pippa", { with: ["odette"], max: 1, mark: false })[0];
    return ok(a?.about.includes("juniper") && b?.about.includes("odette"), `with Juniper: "${a?.text}"; with Odette: "${b?.text}"`);
  } },
  { id: "MEM-6", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let over = 0, sums = 0, orphan = 0;
    for (const v of Object.values(s.people)) {
      if (v.mem.filter((m) => m.w < F.M.HEAVY).length > F.M.MEM_CAP) over++;
      const ids = new Set(v.mem.map((m) => m.id));
      for (const x of v.summaries || []) { sums++; if (!x.cites.length || x.cites.some((id) => ids.has(id))) orphan++; }
    }
    return ok(!over && sums > 0 && !orphan, `cap ${F.M.MEM_CAP}: ${over} over; ${sums} summaries, each citing the memories it replaced (${orphan} bad)`);
  } },
  { id: "MEM-7", kind: "audit", fn: async () => {
    const { s } = await F.main();
    let heavyIn = 0, kept = 0;
    for (const v of Object.values(s.people)) { for (const x of v.summaries || []) if (x.w >= F.M.HEAVY) heavyIn++; kept += v.mem.filter((m) => m.w >= F.M.HEAVY).length; }
    return ok(!heavyIn && kept > 0, `${kept} heavy memories kept whole; ${heavyIn} heavy memories folded into summaries`);
  } },
];
