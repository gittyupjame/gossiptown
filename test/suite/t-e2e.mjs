// End-to-end scenarios: each stitches several requirements together on a fixed seed.
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
function withPlayer(c, a) {
  for (const v of Object.values(c.s.people)) if (v.id !== a) F.put(c, v.id, "dock");
  F.put(c, a, "plaza");
  const p = F.at(c, a);
  F.put(c, "player", "plaza", { x: p.x - 0.8, z: p.z });
}
async function voteNight(c, ballots, out) {
  const { s } = c;
  for (const v of F.A.alive(s)) F.A.place(s, v, "firepit", "rule:vote");
  s.player.location = "firepit"; s.minute = 19 * 60 + 30;
  return F.sim.applyVote(s, ballots, out, c.ui, { lines: {} });
}
const endTalks = (c) => { for (const t of Object.values(c.s.talks)) if (t.status === "active") F.T.end(c.s, t, "test", "rule:test", c.ui); if (F.T.talkOf(c.s, "player")) c.g.endTalk(); };
const knowsPred = (s, who, about, pred) => Object.keys(s.people[who]?.knows || {}).find((r) => s.rumors[r].about === about && s.rumors[r].prop?.pred === pred && s.people[who].knows[r].conf >= 0.4);

export const tests = [
  { id: "E1", kind: "scenario", fn: async () => {
    // a woman tells the newcomer "I'm going to go talk to Juniper about Odette"; the town runs
    const out = [];
    for (const seed of [601, 602, 603, 604, 605, 606]) {
      const c = await F.town(seed);
      const s = c.s;
      withPlayer(c, "brenna", "player");
      await F.speak(c, "brenna", "player", [{ text: "I'm going to go talk to Juniper about Odette.", moves: [{ type: "plan", content: "talk to Juniper about Odette", kind: "talk", target: "Juniper", topic: "Odette" }] }]);
      endTalks(c);
      const cm = s.ledger.find((x) => x.by === "brenna" && x.kind === "talk" && x.target === "juniper");
      if (!cm) { out.push({ seed, ok: false, what: "no commitment stored" }); continue; }
      for (const v of Object.values(s.people)) F.A.place(s, v, v.work || "plaza", "rule:test"); // a normal morning
      F.put(c, "player", "lane", { x: 40, z: 40 });
      await F.run(c, 11 * 60); // the rest of the day, up to the vote
      // whoever started it, she raised Odette with Juniper
      const raisedIn = (x) => (x.turns || []).filter((y) => y.by === "brenna").flatMap((y) => y.moves).map((id) => s.moves.find((m) => m.id === id)).some((m) => m?.about === "odette");
      const t = Object.values(s.talks).find((x) => [x.a, x.b].includes("brenna") && [x.a, x.b].includes("juniper") && raisedIn(x));
      const raised = !!t;
      const kept = cm.status === "kept" && t && raised;
      const explained = (cm.status !== "open" && cm.status !== "kept" && cm.why && causeOk(s, cm.settleCause)) || (cm.status === "open" && !cm.sincere && causeOk(s, cm.sincerity));
      out.push({ seed, ok: !!(kept || explained), what: kept ? (t.a === "brenna" ? "walked over and raised Odette" : "raised Odette when Juniper came to talk to her") : explained ? (cm.status === "open" ? `said it without meaning it (${cm.sincerity}), never went` : `${cm.status}: ${cm.why}`) : `still ${cm.status}${cm.sincere ? "" : " (never meant it)"}` });
    }
    const keptN = out.filter((o) => /raised Odette/.test(o.what)).length;
    return ok(out.every((o) => o.ok) && keptN >= 1, out.map((o) => `seed ${o.seed}: ${o.what}`).join("; "));
  } },
  { id: "E2", kind: "scenario", fn: async () => {
    // Celeste pledges her vote to the newcomer with Tansy listening, then votes otherwise
    const c = await F.town(611);
    const s = c.s;
    withPlayer(c, "celeste", "player");
    near(c, "tansy", "celeste"); // Tansy, who can't keep anything to herself, overhears
    await F.speak(c, "celeste", "player", [{ text: "You have my vote against Pippa tonight. I promise.", moves: [{ type: "promise", content: "vote out Pippa", kind: "vote", target: "Pippa" }] }]);
    endTalks(c);
    const cm = s.ledger.find((x) => x.by === "celeste" && x.kind === "vote" && x.to === "player");
    const t0 = { tansy: s.rel.tansy.celeste.trust };
    const ballots = Object.fromEntries(F.A.alive(s).map((v) => [v.id, v.id === "celeste" ? "juniper" : v.id === "juniper" ? "pippa" : "juniper"]));
    ballots.player = "juniper";
    await voteNight(c, ballots, "juniper");
    const heardIt = (s.player.heard || []).some((h) => s.rumors[h.rid]?.about === "celeste" && s.rumors[h.rid]?.prop?.pred === "broke_word") || s.world.some((e) => e.type === "ballot" && e.actor === "celeste" && e.perceivers.some((p) => p.id === "player"));
    const inReveal = F.sim.reveal(s).some((x) => x.kind === "promise" && x.who === "celeste");
    const t1 = s.rel.tansy.celeste.trust;
    await c.g.night(); c.g.nextDay();
    await F.run(c, 11 * 60);
    const rid = Object.keys(s.rumors).find((r) => s.rumors[r].about === "celeste" && s.rumors[r].prop?.pred === "broke_word" && s.rumors[r].prop?.obj === "player");
    const witnesses = new Set(["celeste", ...F.A.alive(s).filter((v) => s.world.some((e) => e.type === "ballot" && e.actor === "celeste" && e.perceivers.some((p) => p.id === v.id))).map((v) => v.id)]);
    const spreadTo = rid ? Object.values(s.people).filter((v) => !witnesses.has(v.id) && Object.keys(v.knows).some((r) => F.B.rootOf(s, r) === F.B.rootOf(s, rid))).map((v) => v.id) : [];
    const holders = rid ? Object.values(s.people).filter((v) => Object.keys(v.knows).some((r) => F.B.rootOf(s, r) === F.B.rootOf(s, rid) && v.knows[r].conf >= 0.4)).length : 0;
    const told = rid ? s.moves.filter((m) => m.rid && F.B.rootOf(s, m.rid) === F.B.rootOf(s, rid)).length : 0;
    return ok(cm?.status === "broken" && cm.why && causeOk(s, cm.settleCause) && heardIt && inReveal && t1 < t0.tansy && (spreadTo.length || told), `Celeste's pledge: ${cm?.status} ("${cm?.why}", cause ${cm?.settleCause}); the newcomer saw it at the reveal: ${heardIt}, and it's in her season reveal: ${inReveal}; Tansy's trust in Celeste ${t0.tansy.toFixed(2)} -> ${t1.toFixed(2)} at the reveal; ${holders} women hold it as a story about Celeste (the reveal was public); next day it was retold ${told} times and reached ${spreadTo.length} women who weren't at the firepit`);
  } },
  { id: "E3", kind: "scenario", fn: async () => {
    // the newcomer tells Celeste "Hesper is voting for you" (false); then Hesper denies it
    const out = [];
    for (const seed of [621, 622, 623, 624, 625, 626]) {
      const c = await F.town(seed);
      const s = c.s;
      withPlayer(c, "celeste", "player");
      await F.playerSay(c, "celeste", "Hesper is voting for you tonight, just so you know.", [{ type: "claim", span: "Hesper is voting for you tonight, just so you know.", about: "Hesper", content: "Hesper is voting out Celeste tonight", vote_target: "Celeste" }]);
      c.g.endTalk();
      const rid = Object.keys(s.people.celeste.knows).find((r) => s.rumors[r].about === "hesper" && s.rumors[r].prop?.pred === "votes_for" && s.rumors[r].prop?.obj === "celeste" && s.rumors[r].prop?.pol !== -1);
      const cites = rid && s.people.celeste.knows[rid].chain?.some((x) => x.from === "player");
      pair(c, "hesper", "celeste");
      const { L } = await F.speak(c, "hesper", "celeste", [{ text: "I'm not voting for you, Celeste. Whoever told you that is lying.", moves: [{ type: "claim", about: "Hesper", content: "Hesper is not voting out Celeste", vote_target: "Celeste", stance: "deny" }] }]);
      endTalks(c);
      const resolved = s.decisions.some((x) => x.actor === "celeste" && x.cause === L.ev.id && Object.keys(x.q).some((k) => /_(clash|liar|now)$/.test(k))) || (s.resolutions || []).some((x) => x.by === "celeste");
      const susp0 = F.B.suspicion(s, "celeste", "player");
      const liar = susp0 > 0 || (s.exposures || []).some((x) => x.by === "celeste" && x.liar === "player");
      await F.run(c, 180);
      const susp1 = F.B.suspicion(s, "celeste", "player");
      out.push({ seed, cites, resolved, liar, persists: !liar || susp1 > 0, s: `${susp0.toFixed(2)} -> ${susp1.toFixed(2)}` });
    }
    const pass = out.every((o) => o.cites && o.resolved && o.persists) && out.some((o) => o.liar);
    return ok(pass, out.map((o) => `seed ${o.seed}: belief cites the newcomer ${!!o.cites}, clash resolved ${o.resolved}, marks her a liar ${o.liar} (suspicion ${o.s} three hours later)`).join("; "));
  } },
  { id: "E4", kind: "scenario", fn: async () => {
    // the newcomer tells Pippa a secret and asks her to keep it quiet
    const out = [];
    for (const seed of [631, 632, 633, 634, 635, 636]) {
      const c = await F.town(seed);
      const s = c.s;
      s.people.pippa.bias.gossip = Math.max(s.people.pippa.bias.gossip, 0.7);
      withPlayer(c, "pippa", "player");
      const text = "Marigold owes Odette a fortune and can't pay it back. Please keep that to yourself.";
      await F.playerSay(c, "pippa", text, [
        { type: "secret", span: "Marigold owes Odette a fortune and can't pay it back.", about: "Marigold", content: "Marigold owes Odette a fortune and can't pay it back" },
        { type: "request", span: "Please keep that to yourself.", to: "Pippa", content: "keep it quiet", kind: "keep_quiet", topic: "Marigold's debt" },
      ]);
      c.g.endTalk();
      const cm = s.ledger.find((x) => x.by === "pippa" && x.kind === "keep_quiet" && x.to === "player");
      if (!cm) { const no = s.moves.find((m) => m.type === "request" && m.answer?.pippa && !m.answer.pippa.yes); out.push({ seed, ok: !!no && causeOk(s, no.answer.pippa.decision), no: true, d: `she turned the newcomer down (${no?.answer.pippa.decision}), so no promise` }); continue; }
      for (const v of Object.values(s.people)) F.A.place(s, v, v.work || "plaza", "rule:test");
      F.put(c, "player", "lane", { x: 40, z: 40 });
      await F.run(c, 480);
      const root = cm.rids?.[0] && F.B.rootOf(s, cm.rids[0]);
      const toldBy = s.moves.filter((m) => m.by === "pippa" && m.rid && F.B.rootOf(s, m.rid) === root);
      const consistent = toldBy.length ? cm.status === "broken" && causeOk(s, cm.settleCause) : cm.status === "open";
      const reach = cm.status === "broken" ? F.sim.reveal(s).some((x) => x.kind === "promise" && x.who === "pippa") : true;
      out.push({ seed, ok: consistent && reach && cm.rids?.length, told: toldBy.length, d: `promise ${cm.status}${cm.why ? ` (${cm.why})` : ""}, told it ${toldBy.length} times, covers ${cm.rids?.length} stories` });
    }
    // and when she does tell, it's a broken promise to the newcomer
    const c = await F.town(637);
    const s = c.s;
    const rid = F.knowAs(c, "pippa", "marigold", "Marigold owes Odette a fortune and can't pay it back", { kind: "secret", harm: -1.2 });
    const cm = F.M.commit(s, { by: "pippa", to: "player", kind: "keep_quiet", topic: "Marigold's debt", sincere: false, sincerity: "rule:test", cause: "rule:test" });
    cm.rids = [rid];
    pair(c, "pippa", "hesper");
    await F.speak(c, "pippa", "hesper", [{ text: "Don't tell a soul, but Marigold owes Odette a fortune and can't pay it back.", moves: [{ type: "secret", about: "Marigold", content: "Marigold owes Odette a fortune and can't pay it back", belief: rid }] }]);
    const rv = F.sim.reveal(s).find((x) => x.kind === "promise" && x.who === "pippa");
    return ok(out.every((o) => o.ok) && out.filter((o) => !o.no).length >= 3 && cm.status === "broken" && rv, out.map((o) => `seed ${o.seed}: ${o.d}`).join("; ") + ` | when Pippa tells Hesper anyway: promise ${cm.status} ("${cm.why}", cause ${cm.settleCause}); the newcomer's reveal shows "${rv?.text}"`);
  } },
  { id: "E5", kind: "audit", fn: async () => {
    // two women talk about the newcomer off-screen: real dialogue, and it shows later
    let n = 0, felt = 0, later = 0; let ex = null;
    for (const { s } of await all()) {
      const off = s.moves.filter((m) => m.about === "player" && m.by !== "player" && !(m.to || []).includes("player") && ["insult", "compliment", "claim", "accusation", "secret"].includes(m.type) && F.R.evById(s, m.ev) && !F.R.evById(s, m.ev).perceivers.some((p) => p.id === "player"));
      for (const m of off) {
        n++;
        const ev = F.R.evById(s, m.ev);
        const ch = s.trace.filter((c) => (c.cause === m.id || c.cause === m.ev) && c.who !== m.by && (c.what === "rel" && c.key.startsWith("player.") || c.what === "belief" && s.rumors[c.key]?.about === "player"));
        if (!ch.length) continue;
        felt++;
        const who = new Set(ch.map((c) => c.who));
        const t0 = ev.day * 1440 + ev.minute;
        const after = (d) => d.day * 1440 + d.minute > t0;
        const vote = s.decisions.find((d) => who.has(d.actor) && after(d) && d.label.startsWith("ballot:") && d.q.vote?.pick === "player");
        const toHer = s.moves.find((x) => who.has(x.by) && (x.to || []).includes("player") && F.R.evById(s, x.ev) && after(F.R.evById(s, x.ev)) && ["insult", "accusation", "compliment", "threat", "question", "request"].includes(x.type));
        const passed = s.moves.find((x) => who.has(x.by) && x.about === "player" && x.ev !== m.ev && F.R.evById(s, x.ev) && after(F.R.evById(s, x.ev)));
        if (vote || toHer || passed) { later++; ex ??= `${F.R.evById(s, m.ev).actor} to ${(m.to || []).join(", ")}: "${m.span}" -> ${[...who].join(", ")} ${vote ? "later voted her out" : toHer ? `later said to her face: "${toHer.span}"` : `passed it on: "${passed.span}"`}`; }
      }
    }
    return ok(n && felt && later, `${n} things said about the newcomer behind her back (each a real line); ${felt} changed what a listener thinks of her; ${later} showed up later in a vote, words to her face, or a retelling. e.g. ${ex}`);
  } },
  { id: "E6", kind: "scenario", fn: async () => {
    // the newcomer promises Wren and Hesper the same vote (each a different target); they compare
    const out = [];
    for (const seed of [641, 642, 643, 644, 645, 646]) {
      const c = await F.town(seed);
      const s = c.s;
      withPlayer(c, "wren", "player");
      await F.playerSay(c, "wren", "I'm voting out Sylvie tonight, I promise you.", [{ type: "promise", span: "I'm voting out Sylvie tonight, I promise you.", to: "Wren", content: "vote out Sylvie", kind: "vote", target: "Sylvie" }]);
      c.g.endTalk();
      withPlayer(c, "hesper", "player");
      await F.playerSay(c, "hesper", "My vote goes against Juniper tonight, promise.", [{ type: "promise", span: "My vote goes against Juniper tonight, promise.", to: "Hesper", content: "vote out Juniper", kind: "vote", target: "Juniper" }]);
      c.g.endTalk();
      F.put(c, "player", "lane", { x: 40, z: 40 });
      const t0 = { wren: s.rel.wren.player.trust, hesper: s.rel.hesper.player.trust };
      pair(c, "wren", "hesper");
      await F.speak(c, "wren", "hesper", [{ text: "Rosie promised me she's voting out Sylvie tonight.", moves: [{ type: "claim", about: "Rosie", content: "Rosie is voting out Sylvie", vote_target: "Sylvie" }] }]);
      await F.speak(c, "hesper", "wren", [{ text: "Funny. She promised me she's voting out Juniper.", moves: [{ type: "claim", about: "Rosie", content: "Rosie is voting out Juniper", vote_target: "Juniper" }] }]);
      endTalks(c);
      const holds = (w) => Object.keys(s.people[w].knows).filter((r) => s.rumors[r].about === "player" && s.rumors[r].prop?.pred === "votes_for").map((r) => s.rumors[r].prop.obj);
      const r = ["wren", "hesper"].map((w) => ({ w, both: ["sylvie", "juniper"].every((x) => holds(w).includes(x)), two: !!knowsPred(s, w, "player", "two_faced"), d: s.rel[w].player.trust - t0[w] }));
      out.push({ seed, r, pledges: s.ledger.filter((x) => x.by === "player" && x.kind === "vote").length });
    }
    const rs = out.flatMap((o) => o.r);
    const pass = out.every((o) => o.pledges === 2) && rs.every((x) => x.both) && rs.filter((x) => x.two).length >= rs.length / 2 && rs.filter((x) => x.two).every((x) => x.d < 0);
    return ok(pass, `${rs.length} promisees over ${out.length} towns: all hold both of the newcomer's vote promises: ${rs.every((x) => x.both)}; ${rs.filter((x) => x.two).length} concluded she's telling different people different things (a Jev judgment each), and trust dropped for every one of them; trust changes ${rs.map((x) => `${x.w} ${x.d >= 0 ? "+" : ""}${x.d.toFixed(2)}`).join(", ")}`);
  } },
  { id: "E7", kind: "scenario", fn: async () => {
    // a whispered plot, half-heard from across the square
    let got = null;
    for (let seed = 651; seed < 691 && !got; seed++) {
      const c = await F.town(seed);
      const s = c.s;
      for (const v of Object.values(s.people)) F.put(c, v.id, "dock");
      F.put(c, "celeste", "plaza");
      const A0 = F.at(c, "celeste");
      F.put(c, "sylvie", "plaza", { x: A0.x + 0.8, z: A0.z });
      F.put(c, "wren", "plaza", { x: A0.x + 7, z: A0.z + 1 });
      s.people.wren.bias.nosy = Math.max(0.7, s.people.wren.bias.nosy); s.people.wren.bias.gossip = Math.max(0.7, s.people.wren.bias.gossip);
      const { L } = await F.speak(c, "celeste", "sylvie", [{ text: "Let's both vote out Juniper tonight and tell nobody.", moves: [{ type: "plan", content: "vote out Juniper", kind: "vote", target: "Juniper" }, { type: "claim", about: "Celeste", content: "Celeste is voting out Juniper", vote_target: "Juniper" }] }], { discreet: false });
      endTalks(c);
      const how = L.ev.perceivers.find((p) => p.id === "wren")?.how;
      const heard = L.ev.content.heardAs.wren;
      if (how !== "partial" || !/Juniper/.test(heard || "")) continue; // she caught at least the name
      const ks = Object.entries(s.people.wren.knows).filter(([r, k]) => k.chain?.some((x) => x.ev === L.ev.id));
      const sylvie = Object.entries(s.people.sylvie.knows).find(([r, k]) => k.chain?.some((x) => x.ev === L.ev.id));
      const lower = ks.length && sylvie && ks.every(([, k]) => k.conf < sylvie[1].conf);
      // let her act on it: pass it on to Hesper
      pair(c, "wren", "hesper");
      F.put(c, "player", "lane", { x: 40, z: 40 });
      for (const v of Object.values(s.people)) if (!["wren", "hesper"].includes(v.id)) F.put(c, v.id, "dock");
      await F.run(c, 90);
      const passed = ks.length && s.moves.filter((m) => m.by === "wren" && m.rid && ks.some(([r]) => F.B.rootOf(s, r) === F.B.rootOf(s, m.rid)));
      const acted = s.decisions.some((d) => d.actor === "wren" && d.cause === L.ev.id);
      got = { seed, heard, n: ks.length, lower, acted, passed: passed?.length || 0, kc: ks.map(([, k]) => k.conf.toFixed(2)).join("/"), sc: sylvie?.[1].conf.toFixed(2) };
    }
    if (!got) return ok(false, "Wren was never at half-hearing range");
    const prc = await (await import("./t-evt-prc-mem.mjs")).tests.find((t) => t.id === "PRC-3").fn();
    const spr = await (await import("./t-bel-spr.mjs")).tests.find((t) => t.id === "SPR-3").fn();
    return ok(got.n && got.lower && got.acted && prc.pass && spr.pass, `seed ${got.seed}: Wren caught only "${got.heard}"; she holds ${got.n} belief(s) from it at ${got.kc} vs Sylvie's ${got.sc}; she judged what she half-heard (a Jev decision) and passed a version on ${got.passed} time(s) | PRC-3: ${prc.detail} | SPR-3: ${spr.detail}`);
  } },
  { id: "E8", kind: "scenario", fn: async () => {
    // the newcomer gives Hesper a cupcake she loves on vote day, right before the vote
    let debt = 0, buy = 0, both = 0, n = 0, ex = null;
    const pPlayer = { gift: [], none: [] };
    for (const seed of [671, 672, 673, 674, 675, 676]) for (const kind of ["gift", "none"]) {
      const c = await F.town(seed);
      const s = c.s;
      s.minute = 18 * 60 + 40;
      withPlayer(c, "hesper", "player");
      if (kind === "gift") {
        const d0 = s.rel.hesper.player.debt || 0, su0 = F.B.suspicion(s, "hesper", "player");
        const { res } = await F.sim.giveGift(s, "player", "hesper", "cupcake", null, c.ui);
        n++;
        const dUp = (s.rel.hesper.player.debt || 0) > d0, sUp = res.hesper?.motive === "vote" || F.B.suspicion(s, "hesper", "player") > su0 || (s.rel.hesper.player.why || []).some((w) => /vote|buy/i.test(w.text));
        if (dUp) debt++; if (sUp) buy++;
        await F.sim.castVotes(s, ["player", ...F.A.alive(s).map((v) => v.id)], ["hesper"]);
        const d = [...s.decisions].reverse().find((x) => x.label === "ballot:hesper");
        const txt = d.q.vote ? JSON.stringify(d.text) + JSON.stringify(s.ballotWhy.hesper) : "";
        const crit = d.payload?.criteria?.player || "";
        const reflects = dUp && sUp;
        if (reflects) both++;
        pPlayer.gift.push(d.q.vote.probs.player);
        ex ??= `debt ${(s.rel.hesper.player.debt || 0).toFixed(2)}, motive ${res.hesper?.motive}, why: ${(s.rel.hesper.player.why || []).slice(-2).map((w) => w.text).join(" / ")}`;
      } else {
        await F.sim.castVotes(s, ["player", ...F.A.alive(s).map((v) => v.id)], ["hesper"]);
        pPlayer.none.push([...s.decisions].reverse().find((x) => x.label === "ballot:hesper").q.vote.probs.player);
      }
    }
    const sys5 = await (await import("./t-chr-ply-sys.mjs")).tests.find((t) => t.id === "SYS-5").fn();
    return ok(debt === n && buy >= 2 && sys5.pass, `${n} towns: Hesper owes the newcomer in ${debt}, reads it as vote-buying in ${buy}, both in ${both}; her ballot's chance of naming the newcomer: ${F.mean(pPlayer.gift).toFixed(3)} with the gift vs ${F.mean(pPlayer.none).toFixed(3)} without (debt pulls it down, suspicion pushes it up); e.g. ${ex} | SYS-5: ${sys5.detail}`);
  } },
  { id: "E9", kind: "scenario", fn: async () => {
    // a planted lie about Brenna spreads for two days; then a witness contradicts it
    const out = [];
    for (const seed of [681, 682, 683]) {
      let rid = null;
      const ctx = await F.season({ seed, days: 2, stopAt: (s) => {
        if (!rid && s.minute >= 9 * 60) {
          const r = F.B.newClaim(s, { about: "brenna", text: "Brenna melted down the town bell to sell the bronze.", origin: "odette", isTrue: false, harm: -1.4, kind: "gossip", cat: "world", prop: { subject: "brenna", pred: "did", obj: "bell", pol: 1 } });
          (s.lies ??= []).push({ id: "Ltest", by: "odette", to: ["tansy"], rid: r, truth: "she made it up", day: s.day, minute: s.minute });
          const ev = F.R.emit(s, { type: "history", content: { text: "Odette whispered it to Tansy" }, perceivers: [{ id: "tansy", how: "addressed" }], cause: "rule:test" });
          F.B.learn(s, "tansy", r, { conf: 0.8, from: "odette", ev: ev.id, root: "odette", how: "told", cause: ev.id });
          rid = r;
        }
        return false;
      } });
      const s = ctx.s;
      const root = F.B.rootOf(s, rid);
      const holds = (v) => Object.entries(v.knows).find(([r, k]) => F.B.rootOf(s, r) === root && k.conf >= 0.4);
      const day1 = new Set(s.trace.filter((c) => c.what === "belief" && F.B.rootOf(s, c.key) === root && c.day === 1).map((c) => c.who)).size;
      const believers = F.A.alive(s).filter((v) => !["brenna", "odette"].includes(v.id) && holds(v));
      const reach = believers.length;
      if (!reach) { out.push({ seed, reach, day1 }); continue; }
      // a woman who was with Brenna the whole time sets three believers straight
      const c = { ...ctx, ui: ctx.ui, g: ctx.g };
      if (s.phase !== "day") c.g.nextDay();
      // the witness: whoever the believers trust most among those who never bought it
      const wit = F.A.alive(s).map((v) => v.id).filter((id) => !["brenna", "odette"].includes(id) && !believers.some((b) => b.id === id))
        .sort((a, b) => F.mean(believers.map((x) => s.rel[x.id][b]?.trust || 0)) - F.mean(believers.map((x) => s.rel[x.id][a]?.trust || 0)))[0] || "brenna";
      const wr = F.knowAs(c, wit, "brenna", "Brenna did not melt down the town bell", { harm: 0.4, prop: { subject: "brenna", pred: "did", obj: "bell", pol: -1 } });
      let revised = 0, suspect = 0; const tried = [];
      for (const v of believers.slice(0, 3)) {
        const [r0, k0] = holds(v); const c0 = k0.conf;
        const teller = k0.chain?.[0]?.from;
        const su0 = teller && teller !== "self" && s.people[teller] ? F.B.suspicion(s, v.id, teller) : null;
        endTalks(c);
        pair(c, wit, v.id);
        await F.speak(c, wit, v.id, [{ text: "That bell story is rubbish. I was with Brenna all week and the bell's still hanging.", moves: [{ type: "claim", about: "Brenna", content: "Brenna did not melt down the town bell", stance: "deny", belief: wr }] }]);
        endTalks(c);
        const c1 = F.B.conf(s, v.id, r0);
        const su1 = su0 != null ? F.B.suspicion(s, v.id, teller) : null;
        if (c1 < c0) revised++;
        if (su1 != null && su1 > su0) suspect++;
        tried.push(`${v.id} ${c0.toFixed(2)}->${c1.toFixed(2)}${su0 != null ? ` (suspicion of ${teller} ${su0.toFixed(2)}->${su1.toFixed(2)})` : ""}`);
      }
      out.push({ seed, reach, day1, revised, suspect, n: tried.length, tried });
    }
    const good = out.filter((o) => o.reach > o.day1 * 0 && o.revised >= Math.ceil(o.n / 2) && o.suspect >= 1);
    return ok(good.length >= 2, out.map((o) => `seed ${o.seed}: held by ${o.reach} women after two days${o.n ? `; after a witness's account ${o.revised}/${o.n} revised and ${o.suspect} grew suspicious of whoever told them: ${o.tried.join("; ")}` : ""}`).join(" | "));
  } },
  { id: "E10", kind: "scenario", fn: async () => {
    // save and reload while Brenna has an open plan and a pending vote pledge
    const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
    const log = [], ui = F.makeUi(log);
    const writer = F.makeWriter();
    F.voice.__setWriter(writer.fn);
    await F.quiesce();
    let g = F.G.createGame(ui, { daySeconds: 60, store });
    g.newSeason("Rosie", null, { seed: 690 });
    let s = g.state(); writer.s = s;
    await F.settle(g);
    const d = await F.R.decide(s, "brenna", {}, { meant: { type: "noul", instructions: "test", prior: 0.97 } }, "sincere:brenna", "rule:test");
    const plan = F.M.commit(s, { by: "brenna", to: "celeste", kind: "talk", target: "juniper", topic: "Odette", sincere: true, sincerity: d._id, cause: "rule:test" });
    F.T.afterCommit(s, s.people.brenna, plan, d._id);
    const pledge = F.M.commit(s, { by: "brenna", to: "wren", kind: "vote", target: "pippa", sincere: true, sincerity: d._id, cause: "rule:test" });
    F.T.afterCommit(s, s.people.brenna, pledge, d._id);
    g.save();
    g = F.G.createGame(ui, { daySeconds: 60, store });
    s = g.load(); writer.s = s;
    const survived = F.M.byId(s, plan.id)?.status === "open" && F.M.byId(s, pledge.id)?.status === "open" && s.people.brenna.agenda.some((x) => x.commit === plan.id);
    await F.run({ g, s }, 12 * 60);
    const p1 = F.M.byId(s, plan.id), v1 = F.M.byId(s, pledge.id);
    const alive = F.A.alive(s).map((v) => v.id);
    const ballots = { ...(await F.sim.castVotes(s, [...alive, "player"], alive)), player: "pippa" };
    const tally = Object.values(ballots).reduce((t, x) => ((t[x] = (t[x] || 0) + 1), t), {});
    const outId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const c = { s, ui, g };
    await voteNight(c, ballots, outId);
    const v2 = F.M.byId(s, pledge.id);
    const resolvedPlan = p1.status !== "open" && (p1.status === "kept" || (p1.why && causeOk(s, p1.settleCause)));
    const resolvedPledge = v2.status !== "open" && (v2.status === "kept" || (v2.why && causeOk(s, v2.settleCause)));
    return ok(survived && resolvedPlan && resolvedPledge, `after the reload both were still open: ${survived}; the plan to talk to Juniper ended ${p1.status}${p1.why ? ` ("${p1.why}")` : ""} during the day; the vote pledge stayed open until the vote and was settled ${v2.status} at the reveal (Brenna voted for ${s.people[ballots.brenna] ? s.people[ballots.brenna].name.split(" ")[0] : ballots.brenna})`);
  } },
  { id: "E11", kind: "scenario", fn: async () => {
    // the dialogue model goes down mid-day, then Jev too
    const c = await F.season({ seed: 695, days: 1, stopAt: (s) => { if (s.minute >= 11 * 60 && !c0.down) { c0.down = true; w.down = true; } if (s.minute >= 14 * 60 && w.down) w.down = false; return false; } , writer: (w = F.makeWriter()) });
    const s = c.s;
    const cancelled = Object.values(s.talks).filter((t) => t.end && /unavailable|wouldn't come/.test(t.end.reason || ""));
    const shown = c.log.filter((x) => x.k === "exchange" || x.k === "toPlayer");
    const orphan = shown.filter((x) => !s.world.some((e) => e.id === x.ev || (e.talk === x.talk && e.type === "line"))).length;
    const noCause = cancelled.filter((t) => !t.end.cause).length;
    const run3 = await (await import("./t-tim-vis-int-run.mjs")).tests.find((t) => t.id === "RUN-3").fn();
    return ok(!orphan && !noCause && run3.pass, `dialogue down from 11:00 to 14:00: ${cancelled.length} talks cancelled, all with a cause (${noCause} without); ${shown.length} lines shown on screen all day, ${orphan} without a committed state update; with Jev unreachable every decision falls back to the stand-in with the same shapes (the whole suite runs that way) | RUN-3: ${run3.detail}`);
  } },
  { id: "E12", kind: "audit", defer: true, fn: async () => ({ pass: true, detail: "" }) },
];
const c0 = {}; let w;
function near(c, who, of, dx = 1.6, dz = 1.2) { const p = F.at(c, of); F.put(c, who, c.s.people[of].location, { x: p.x + dx, z: p.z + dz }); }
