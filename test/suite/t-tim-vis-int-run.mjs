import * as F from "./fixtures.mjs";
import { readFileSync, readdirSync } from "node:fs";
const { ok } = F;
const all = async () => [await F.main(), ...(await F.seeds())];
const CAUSE = /^(e|d|mv|i|c|t|a)\d+$|^rule:[a-z-]+$|^player:[a-z-]+$/;
function pair(c, a, b, place = "plaza") {
  for (const v of Object.values(c.s.people)) if (![a, b].includes(v.id)) F.put(c, v.id, "dock");
  F.put(c, a, place);
  const p = F.at(c, a);
  F.put(c, b, place, { x: p.x + 0.8, z: p.z });
}
// the state minus what only measures wall-clock time
const strip = (s) => JSON.stringify(s, (k, v) => (k === "ms" || k === "spread" ? undefined : v));

export const tests = [
  { id: "TIM-1", kind: "audit", fn: async () => {
    const { s } = await F.main();
    const light = [], heavy = [];
    for (const v of Object.values(s.people)) for (const m of v.mem || []) {
      if (m.used != null) continue;
      const age = (F.R.now(s) - (m.day * 1440 + m.minute)) / 1440;
      const keep = F.M.vivid(s, m) / m.w;
      (m.w >= 4 ? heavy : m.w <= 1.2 ? light : []).push({ age, keep });
    }
    const at = (xs, lo, hi) => F.mean(xs.filter((x) => x.age >= lo && x.age < hi).map((x) => x.keep));
    const l0 = at(light, 0, 1), l2 = at(light, 2, 9), h0 = at(heavy, 0, 1), h2 = at(heavy, 2, 9);
    return ok(light.length && heavy.length && l2 < l0 * 0.3 && h2 > 0.5 * h0, `share of vividness kept: light memories ${(l0 * 100).toFixed(0)}% under a day old, ${(l2 * 100).toFixed(0)}% after two days; heavy ones ${(h0 * 100).toFixed(0)}% and ${(h2 * 100).toFixed(0)}%`);
  } },
  { id: "TIM-2", kind: "scenario", fn: async () => {
    const c = await F.town(501);
    const s = c.s;
    const r1 = s.rel.wren.sylvie, r2 = s.rel.hesper.odette;
    const b1 = r1.affinity, b2 = r2.affinity;
    F.M.shift(s, "wren", "sylvie", { aff: -0.4, why: "a snide remark about my apron", cause: "rule:test" });
    F.M.shift(s, "hesper", "odette", { aff: -1.6, trust: -1.3, why: "broke her word to me at the vote", cause: "rule:test" });
    const d1 = r1.affinity - b1, d2 = r2.affinity - b2;
    for (let day = 0; day < 2; day++) { for (let h = 0; h < 12; h++) F.M.driftFeelings(s, 1); F.M.driftFeelings(s, 10); s.day++; }
    const k1 = (r1.affinity - b1) / d1, k2 = (r2.affinity - b2) / d2;
    return ok(k1 < 0.5 && k2 > 0.6, `two days later: ${(k1 * 100).toFixed(0)}% of the slight's effect on Wren is left; ${(k2 * 100).toFixed(0)}% of the betrayal's effect on Hesper`);
  } },
  { id: "TIM-3", kind: "audit", fn: async () => {
    const mod = await import("./t-bel-spr.mjs");
    const r = await mod.tests.find((t) => t.id === "SPR-5").fn();
    return ok(r.pass, `same check as SPR-5: ${r.detail}`);
  } },
  { id: "TIM-4", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const c of s.trace.filter((c) => c.what === "belief")) {
      n++;
      if (!CAUSE.test(c.cause || "") || (/^rule:/.test(c.cause) && c.to > (c.from ?? 0) && c.cause !== "rule:test" && c.cause !== "rule:history")) bad.push(`${si}/${c.who}:${c.key}:${c.cause}`);
    }
    return ok(n && !bad.length, `${n} belief changes; ${bad.length} raised by time or a rule rather than new evidence ${bad.slice(0, 3)}`);
  } },
  { id: "TIM-5", kind: "scenario", fn: async () => {
    const c = await F.town(502);
    const s = c.s;
    await F.run(c, 30);
    const before = strip(s);
    const decisions = s.decisions.length;
    F.runtime.setPaused(true);
    // an hour of real time passes while paused: the page stops calling update(), and any call
    // already on its way is held
    const realNow = performance.now, dateNow = Date.now;
    const skew = 3600 * 1000;
    performance.now = () => realNow.call(performance) + skew; Date.now = () => dateNow() + skew;
    const held = F.T.advance(s, c.ui);
    for (let i = 0; i < 50; i++) await F.tick();
    const during = strip(s) === before && s.decisions.length === decisions;
    performance.now = realNow; Date.now = dateNow;
    F.runtime.setPaused(false);
    await Promise.all(held); await F.settle(c.g);
    const src = readdirSync("src/core").filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(`src/core/${f}`, "utf8")]);
    const clockUse = src.filter(([f, t]) => /(vivid|drift|decay|fade|stale)[\s\S]{0,400}(Date\.now|performance\.now)/.test(t)).map(([f]) => f);
    return ok(during && !clockUse.length, `paused for an hour of real time: state ${during ? "unchanged" : "CHANGED"} and no decision made; fading and drift read only the in-game clock (${clockUse.length ? `wall clock used in ${clockUse}` : "no wall-clock use"})`);
  } },

  { id: "VIS-1", kind: "inspect", fn: async () => {
    const files = readdirSync("src/client").filter((f) => f.endsWith(".js"));
    const canned = [];
    for (const f of files) {
      const t = readFileSync(`src/client/${f}`, "utf8");
      // arrays of three or more spoken-looking lines (canned barks) would be invented content
      // the host's own show-running patter ("Ladies! LADIES!") states nobody's feelings, rumors
      // or plans, so it is not counted; anything else spoken from a fixed list would be
      const body = t.split("\n").filter((l) => !/hostSay\(/.test(l)).join("\n");
      for (const m of body.matchAll(/\[\s*(["'`][^"'`\n]{12,}[.!?]["'`]\s*,\s*){2,}["'`][^"'`\n]{12,}[.!?]["'`]\s*\]/g)) canned.push(`${f}: ${m[0].slice(0, 60)}`);
      for (const m of body.matchAll(/Math\.random\(\)[^\n]{0,60}(lines|barks|quips|says|phrases)/g)) canned.push(`${f}: ${m[0].slice(0, 60)}`);
    }
    const tracker = readFileSync("src/client/tracker.js", "utf8");
    const fromState = ["s.player.heard", "s.player.told", "s.player.knows", "s.votes", "lookCue", "vibe"].every((k) => tracker.includes(k));
    return ok(!canned.length && fromState, `client code scanned for invented reactions, opinions or rumors (host patter aside): ${canned.length ? canned.slice(0, 2).join("; ") : "none"}; the Tab tracker reads the newcomer's own heard/told/knows, the vote record, seen looks and her own memories`);
  } },
  { id: "VIS-2", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) {
      const cues = new Set((s.cues || []).map((c) => `${c.who}|${c.cause}`));
      const recent = s.cues?.length ? s.cues[0].day * 1440 + s.cues[0].minute : 0;
      const groups = {};
      for (const c of s.trace.filter((c) => c.what === "rel" && /^player\.(affinity|trust)$/.test(c.key) && !/^rule:/.test(c.cause) && c.day * 1440 + c.minute >= recent)) {
        const k = `${c.who}|${c.cause}`;
        groups[k] = (groups[k] || 0) + Math.abs(c.to - c.from) * (c.key.endsWith("trust") ? 0.8 : 1);
      }
      for (const [k, w] of Object.entries(groups)) { if (w < 0.6) continue; n++; if (!cues.has(k)) bad.push(`${si}/${k}`); }
    }
    return ok(n && !bad.length, `${n} heavy changes in how a woman sees the newcomer; ${bad.length} with no visible reaction over her head ${bad.slice(0, 3)}`);
  } },
  { id: "VIS-3", kind: "scenario", fn: async () => {
    const a = await (await import("./t-evt-prc-mem.mjs")).tests.find((t) => t.id === "MEM-4").fn();
    const b = await (await import("./t-rel-soc-lie.mjs")).tests.find((t) => t.id === "LIE-7").fn();
    return ok(a.pass && b.pass, `MEM-4: ${a.detail} | LIE-7: ${b.detail}`);
  } },
  { id: "VIS-4", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const rec of s.votes.filter((v) => !v.finale)) for (const [voter, reasons] of Object.entries(rec.reasons || {})) {
      n++;
      const d = F.R.decisionById(s, rec.decisions?.[voter]);
      if (!d || JSON.stringify(d.reasons) !== JSON.stringify(reasons)) bad.push(`${si}/${rec.day}:${voter}`);
    }
    const vjs = readFileSync("src/client/vote.js", "utf8");
    return ok(n && !bad.length && /result\.reasons|\.reasons\b/.test(vjs), `${n} ballot reasons shown at the vote; ${bad.length} that differ from the logged decision's top reasons`);
  } },
  { id: "VIS-5", kind: "inspect", fn: async () => {
    const { s } = await F.main();
    const items = F.sim.reveal(s);
    const bad = items.filter((it) => !it.cause || !(F.R.evById(s, it.cause) || F.R.decisionById(s, it.cause) || /^rule:|^player:/.test(it.cause)));
    const kinds = [...new Set(items.map((x) => x.kind))];
    return ok(items.length && !bad.length, `${items.length} reveal lines (${kinds.join(", ")}); ${bad.length} not traced to a logged event or decision; e.g. "${items[0]?.text}"`);
  } },

  { id: "INT-1", kind: "audit", fn: async () => {
    const model = ["voice.js", "jev.js"].map((f) => [f, readFileSync(`src/core/${f}`, "utf8")]);
    const writes = [];
    for (const [f, t] of model) for (const m of t.matchAll(/\bs\.(people|rumors|rel|world|ledger|decisions|trace|moves|talks|player|alliances|votes)\b[^\n;]*?(=(?!=)|\.push\(|\.splice\()/g)) writes.push(`${f}: ${m[0].slice(0, 50)}`);
    return ok(!writes.length, `the Jev and Claude layers (voice.js, jev.js) read the state and return proposals; state writes found there: ${writes.length ? writes.slice(0, 3).join("; ") : "none"}`);
  } },
  { id: "INT-2", kind: "audit", fn: async () => {
    const rules = {};
    let n = 0;
    for (const { s } of await all()) {
      for (const v of s.violations || []) { if (/cascade-depth-cap/.test(v.rule)) continue; rules[v.rule] = (rules[v.rule] || 0) + 1; }
      for (const rec of s.votes) for (const [voter, target] of Object.entries(rec.ballots)) { n++; const gone = (id) => id !== "player" && s.people[id]?.outDay != null && s.people[id].outDay < rec.day; if (gone(target) || gone(voter)) rules["vote-for-or-by-eliminated"] = (rules["vote-for-or-by-eliminated"] || 0) + 1; }
      for (const c of s.ledger || []) if (c.status === "kept" && c.target && c.target !== "player" && s.people[c.target]?.outDay != null && s.people[c.target].outDay < c.settledDay && c.kind !== "vote") rules["kept-impossible"] = (rules["kept-impossible"] || 0) + 1;
    }
    return ok(!Object.keys(rules).length, `rule scan over ${(await all()).length} seasons (${n} ballots): ${Object.entries(rules).map(([k, x]) => `${k} ${x}`).join(", ") || "no violations"}`);
  } },
  { id: "INT-3", kind: "audit", fn: async () => {
    let n = 0; const bad = [];
    for (const [si, { s }] of (await all()).entries()) for (const c of s.trace) { n++; if (!CAUSE.test(c.cause || "")) bad.push(`${si}/${c.who}.${c.what}:${c.cause}`); }
    return ok(n && !bad.length, `${n} state changes; ${bad.length} without a cause pointer ${bad.slice(0, 3)}`);
  } },
  { id: "INT-4", kind: "inspect", fn: async () => {
    const { s } = await F.main();
    const sample = [];
    for (const what of ["belief", "rel", "agenda", "vote_plan", "commit", "goal"]) {
      const xs = s.trace.filter((c) => c.what === what && !/^rule:/.test(c.cause));
      for (let i = 0; i < 6 && xs.length; i++) sample.push(xs[Math.floor((i + 0.5) * xs.length / 6)]);
    }
    const chains = sample.map((c) => F.I.why(s, c.cause));
    const broken = chains.filter((ch) => !ch.length || ch.some((x) => x.what === "?"));
    const ex = chains.find((ch) => ch.length >= 3) || chains[0];
    return ok(sample.length >= 30 && !broken.length, `${sample.length} sampled beliefs, feelings, plans, promises and goals; ${broken.length} whose chain of causes breaks; e.g. ${ex.map((x) => x.what).slice(0, 4).join(" <- ")}`);
  } },
  { id: "INT-5", kind: "audit", fn: async () => {
    let ticks = 0, checks = 0; const v = {};
    for (const { s } of await all()) {
      checks += s.checks || 0;
      ticks += new Set(s.decisions.filter((d) => d.label.startsWith("hourly:")).map((d) => `${d.day}:${Math.floor(d.minute / 5)}`)).size ? 1 : 0;
      for (const x of (s.violations || []).filter((x) => /^invariant:/.test(x.rule))) v[x.rule] = (v[x.rule] || 0) + 1;
    }
    return ok(checks > 500 && !Object.keys(v).length, `invariants checked after every tick (${checks} checks over ${(await all()).length} seasons); breaches: ${Object.entries(v).map(([k, x]) => `${k} ${x}`).join(", ") || "none"}`);
  } },

  { id: "RUN-1", kind: "scenario", fn: async () => {
    const c = await F.town(510);
    const s = c.s;
    pair(c, "celeste", "wren");
    const t = F.T.open(s, "celeste", "wren", { reason: "a test", cause: "rule:test", ui: c.ui });
    F.runtime.setPaused(true);
    const before = strip(s), d0 = s.decisions.length, w0 = c.writer.turns.length;
    const p = F.T.advance(s, c.ui);
    for (let i = 0; i < 40; i++) await F.tick();
    const frozen = strip(s) === before && s.decisions.length === d0 && c.writer.turns.length === w0;
    F.runtime.setPaused(false);
    await Promise.all(p);
    const moved = s.decisions.length > d0;
    const page = readFileSync("src/client/main.js", "utf8");
    const closes = /visibilitychange|pagehide|beforeunload/.test(page) && /setPaused\(true/.test(page);
    return ok(frozen && moved && closes, `while paused: ${frozen ? "no Jev or Claude call went out and nothing changed" : "SOMETHING MOVED"}; after unpausing the held call went through; the page pauses itself when hidden or closed: ${closes}`);
  } },
  { id: "RUN-2", kind: "scenario", fn: async () => {
    const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
    const log = [], ui = F.makeUi(log);
    const writer = F.makeWriter();
    F.voice.__setWriter(writer.fn);
    await F.quiesce();
    const g = F.G.createGame(ui, { daySeconds: 60, store });
    g.newSeason("Rosie", null, { seed: 520 });
    const s = g.state(); writer.s = s;
    await F.settle(g);
    // Brenna means to talk to Juniper about Odette; save before she does
    const d = await F.R.decide(s, "brenna", {}, { meant: { type: "noul", instructions: "test", prior: 0.97 } }, "sincere:brenna", "rule:test");
    const cm = F.M.commit(s, { by: "brenna", to: "celeste", kind: "talk", target: "juniper", topic: "Odette", sincere: true, sincerity: d._id, cause: "rule:test" });
    F.T.afterCommit(s, s.people.brenna, cm, d._id);
    g.save();
    const saved = store.m["gossiptown.season.v3"];
    const g2 = F.G.createGame(ui, { daySeconds: 60, store });
    const s2 = g2.load(); writer.s = s2;
    const same = JSON.stringify(s2) === JSON.stringify(JSON.parse(saved));
    const keys = ["people", "rel", "rumors", "ledger", "alliances", "talks", "trace", "decisions", "moves", "world"];
    const diff = keys.filter((k) => JSON.stringify(s2[k]) !== JSON.stringify(JSON.parse(saved)[k]));
    for (const v of Object.values(s2.people)) if (!["brenna", "juniper"].includes(v.id)) F.A.place(s2, v, "dock", "rule:test");
    F.A.place(s2, s2.people.brenna, "smithy", "rule:test"); const p = F.space.pos(s2, "brenna"); F.A.place(s2, s2.people.juniper, "smithy", "rule:test", { at: { x: p.x + 1.5, z: p.z + 1 } });
    const d0 = s2.decisions.length;
    const item = s2.people.brenna.agenda.find((x) => x.commit === cm.id);
    await F.run({ g: g2, s: s2 }, 240);
    const c2 = F.M.byId(s2, cm.id);
    // she picks the plan back up: either she has talked to Juniper, or she set out to
    const acted = s2.decisions.slice(d0).filter((x) => x.actor === "brenna" && item && [`do_${item.id}`, `find_${item.id}`].includes(x.q.next?.pick));
    // or she thought better of it after the reload, in a decision that weighed this very plan
    const rethought = c2?.status !== "open" && c2?.status !== "kept" && s2.decisions.slice(d0).some((x) => x.id === c2.settleCause && x.actor === "brenna");
    return ok(same && !diff.length && item && (c2?.status === "kept" || acted.length || rethought), `saved mid-plan and reloaded: memories, beliefs, promises, agendas and talks ${diff.length ? `differ in ${diff}` : "identical"}; after the reload Brenna's plan to talk to Juniper was still on her list and she acted on it ${acted.length} time(s) (promise ${c2?.status}${rethought ? `, by her own decision after the reload: ${c2.why}` : ""})`);
  } },
  { id: "RUN-3", kind: "scenario", fn: async () => {
    const c = await F.town(530);
    const s = c.s;
    pair(c, "celeste", "wren");
    F.put(c, "player", "plaza", { ...F.at(c, "celeste"), x: F.at(c, "celeste").x - 0.6, z: F.at(c, "celeste").z + 0.6 });
    const t = F.T.open(s, "celeste", "wren", { reason: "a test", cause: "rule:test", ui: c.ui });
    await Promise.all(F.T.advance(s, c.ui));
    c.writer.down = true; // the dialogue model goes away mid-talk
    const lines0 = s.world.filter((e) => e.type === "line").length, shown0 = c.log.filter((x) => x.k === "exchange" || x.k === "toPlayer").length;
    for (let i = 0; i < 8 && t.status === "active"; i++) { s.minute += 2; await Promise.all(F.T.advance(s, c.ui)); }
    c.writer.down = false;
    const lines1 = s.world.filter((e) => e.type === "line").length, shown1 = c.log.filter((x) => x.k === "exchange" || x.k === "toPlayer").length;
    const orphan = c.log.filter((x) => (x.k === "exchange" || x.k === "toPlayer") && !s.world.some((e) => e.id === x.ev || (e.talk === x.talk && e.type === "line"))).length;
    return ok(t.status === "ended" && t.end?.reason && t.end?.cause && lines1 === lines0 && shown1 === shown0 && !orphan, `with the dialogue model down the talk was ${t.status} ("${t.end?.reason}", cause ${t.end?.cause}); new lines ${lines1 - lines0}, shown on screen ${shown1 - shown0}, shown without a committed line ${orphan}`);
  } },
  { id: "RUN-4", kind: "audit", defer: true, fn: async () => ({ pass: true, detail: "decided after every other test has run" }) },
  { id: "RUN-5", kind: "scenario", fn: async () => {
    const once = async () => { const ctx = await F.season({ seed: 540, days: 1 }); return { world: ctx.s.world.map((e) => JSON.stringify(e)), picks: ctx.s.decisions.map((d) => `${d.id}:${d.actor}:${JSON.stringify(Object.values(d.q).map((q) => q.pick ?? q.value ?? q.yes))}`) }; };
    const a = await once(), b = await once();
    const wd = a.world.findIndex((x, i) => x !== b.world[i]), dd = a.picks.findIndex((x, i) => x !== b.picks[i]);
    return ok(wd === -1 && dd === -1 && a.world.length === b.world.length, `two replays of day 1 from the same seed and recorded model outputs: ${a.world.length} vs ${b.world.length} events, ${a.picks.length} vs ${b.picks.length} decisions; first difference: events ${wd}, decisions ${dd}`);
  } },
  { id: "RUN-6", kind: "audit", fn: async () => {
    await all();
    const p = F.runtime.p95("reply"), n = F.runtime.latency.reply.length;
    const target = 2500;
    return ok(n > 5 && p <= target, `the newcomer's talks: ${n} replies timed, 95th percentile ${p} ms to start (target ${target} ms headless; the live target is set from the first real-model run); the world loop never waits on off-screen talks (each tick starts work and returns)`);
  } },
  { id: "RUN-7", kind: "audit", fn: async () => {
    await all();
    const used = F.runtime.budget.used, bound = F.runtime.budget.bound;
    const hours = Object.keys(used).length, b = Object.keys(bound).length;
    const peak = Math.max(...Object.values(used));
    return ok(hours && b / hours <= 0.05, `spend ceiling ${F.runtime.budget.perHour} calls per in-game hour; peak ${peak}; bound in ${b} of ${hours} hours (last season); off-screen talks skipped for budget: ${F.T.stats.budgetSkipped}`);
  } },
];
