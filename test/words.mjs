// Words are never just flavor: promises and claims in written dialogue (and in what the
// player types) end up in the promise book, in plans, votes and rumors, and get settled.
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
globalThis.window = {};
const voice = await import("../src/core/voice.js");
const { createGame } = await import("../src/core/game.js");
const sim = await import("../src/core/sim.js");
const M = await import("../src/core/mind.js");
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };

let script = () => null;
const prompts = [];
voice.__setWriter(async (p) => { prompts.push(p); return script(p); });
const ui = { headline: () => {}, distance: () => 5, hearing: () => "none", first: () => {}, heard: () => {} };
const g = createGame(ui, { daySeconds: 60 });
g.newSeason("Rosie");
const s = g.state();

// 1. an NPC's reply to the player promises something Jev never decided: she is held to it
script = (p) => p.includes("Reply as Celeste") ? "Oh, darling, leave it with me. I'll go have a word with Odette myself.\n---\nWILL | Celeste | Rosie | have a word with Odette\nCLAIM | Celeste | Pippa | Pippa cheats at cards every Thursday." : null;
g.startTalk("celeste");
await g.say("Odette keeps looking at me funny. What's her deal?");
const c1 = (s.ledger || []).find((c) => c.by === "celeste" && c.to === "player" && c.target === "odette");
ok(!!c1, `Celeste's promise is in the book: ${c1 && M.deedText(s, c1)}`);
const planned = [s.people.celeste.intent, ...(s.people.celeste.plans || [])].find((p) => p?.target === "odette");
ok(planned && planned.commit === c1?.id, `and she now plans to do it: ${planned && sim.planText(s, planned)}`);
const claim = Object.values(s.rumors).find((r) => /cheats at cards/.test(r.text));
ok(claim && s.player.heard.some((h) => h.rid === claim.id), "her claim about Pippa became a story the player heard");
ok(s.people.celeste.talks?.player?.some((l) => /leave it with me/.test(l.text)), "the words are kept in her talk history with the player");

// 2. the next conversation remembers what was said before
script = (p) => (p.includes("Reply as Celeste") ? "Still on it, sweetie.\n---\nNONE" : null);
await g.say("Did you talk to her yet?");
const last = prompts.filter((p) => p.includes("Reply as Celeste")).at(-1);
ok(/Promises between you/.test(last) && /Odette/.test(last), "Claude sees the promise when she answers again");
g.endTalk?.();

// 3. the player promises a vote; voting otherwise breaks it, and she remembers
script = () => "Hm. We'll see.\n---\nNONE";
g.startTalk("marigold");
const r3 = await g.say("I promise I'll vote Sylvie out tonight, you have my word.");
const c3 = (s.ledger || []).find((c) => c.by === "player" && c.to === "marigold");
ok(c3 && c3.kind === "vote" && c3.target === "sylvie", `the player's promise is in the book (${r3.debug.intent}): ${c3 && M.deedText(s, c3)}`);
g.endTalk?.();
const trustBefore = s.rel.marigold.player.trust;
sim.applyVote(s, { player: "odette", marigold: "odette", celeste: "pippa" }, "odette", ui);
ok(c3.status === "broken", `voting otherwise broke it: ${c3.why}`);
ok(s.rel.marigold.player.trust < trustBefore, `Marigold trusts her less (${trustBefore.toFixed(2)} -> ${s.rel.marigold.player.trust.toFixed(2)})`);
ok(s.people.marigold.core.some((m) => /promised/.test(m.line)), "and never forgets it");

// 4. two women talking off-screen: their words are written and bind them
script = (p) => p.includes("Write a short exchange") ? (() => {
  const [a, b] = [...p.matchAll(/^(\w+) \w+, the /gm)].map((m) => m[1]);
  return `${a}: You won't believe what I heard.\n${b}: Go on.\n${a}: I'm voting Hesper out, and you should too.\n---\nWILL | ${a} | ${b} | vote Hesper out\nCLAIM | ${a} | Hesper | Hesper reads everyone's letters at the post office.`;
})() : "Fine.\n---\nNONE";
for (let i = 0; i < 40 && !(s.ledger || []).some((c) => c.target === "hesper" && c.kind === "vote" && c.by !== "player" && c.by !== "hesper" && c.to !== "hesper"); i++) { g.update(0.25); await new Promise((r) => setTimeout(r, 5)); while (g.busy()) await new Promise((r) => setTimeout(r, 5)); }
await new Promise((r) => setTimeout(r, 50));
const c4 = (s.ledger || []).find((c) => c.target === "hesper" && c.kind === "vote" && c.by !== "player" && c.by !== "hesper" && c.to !== "hesper");
ok(!!c4, `an off-screen conversation was written and its vote promise is in the book: ${c4 && M.deedText(s, c4)} (to ${c4 && sim.firstOf(s, c4.to)})`);
ok(c4 && s.people[c4.by].votePlan?.target === "hesper", "and she now plans to vote that way");
const letters = Object.values(s.rumors).filter((r) => /letters/.test(r.text));
ok(letters.some((r) => s.people[c4.to].knows[r.id]), `the listener now knows the claim she made (${letters.length} version${letters.length > 1 ? "s" : ""} going round)`);
ok(s.people[c4.by].talks?.[c4.to]?.length >= 3, "both remember the exchange");

// 5. pause holds Claude
voice.setPaused(true);
let done = false;
const pending = voice.retell({ teller: s.people.wren, rumorText: "x", playerName: "Rosie" }).then(() => (done = true));
await new Promise((r) => setTimeout(r, 100));
ok(!done, "nothing is written while paused");
voice.setPaused(false);
await pending;
ok(done, "and it goes out on unpause");

// 6. an NPC promise nobody follows up on lapses, with a reason
const lap = M.commit(s, { by: "wren", to: "player", kind: "other", what: "I'll bring you a scone" });
s.day += 2; M.sleep(s);
ok(lap.status === "broken" && lap.why, `an unkept promise is settled as broken: ${lap.why}`);
