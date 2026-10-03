// Plays one scripted day and a vote with no clock, to check the simulation end to end.
//   GOSSIP_FAKE_LLM=1 node src/selftest.js     fast, no Claude calls
//   node src/selftest.js                       real Claude lines (slow)
import "./env.js";
import { newTown } from "./world.js";
import * as sim from "./sim.js";
import * as jev from "./jev.js";
import * as llm from "./llm.js";

const s = newTown();
const ui = {
  say: (t) => console.log(t),
  approach: (v) => console.log(`> ${sim.first(v)} walks up to you`),
  opened: (v, line) => console.log(`  ${sim.first(v)}: ${line}`),
  learned: (r) => console.log(`  (you learned: ${r.text})`),
  overheard: ({ a, b, text, full }) => console.log(`\n[${a} and ${b}${full ? "" : ", partly"}]\n${text}`),
  isNear: (v) => v.location === s.player.location,
};
const script = {
  "08:30": async () => say("wren", "Hi! I'm new here. Who should I watch out for?"),
  "09:00": async () => say("wren", "I saw Sylvie pocketing coins from the café till this morning."),
  "10:30": async () => say("pippa", "Do you want to team up? I'll watch your back at the vote if you watch mine."),
  "11:00": async () => say("pippa", "Will you vote out Hesper with me? She's out to get both of us."),
};
async function say(id, line) {
  const v = s.people[id];
  if (v.location === "home") { console.log(`> (${id} is at home)`); return; }
  s.player.location = v.location; // walk over to her
  s.player.talkingTo = id;
  const r = await sim.playerSays(s, v, line, ui);
  console.log(`> YOU to ${sim.first(v)}: ${line}\n  ${sim.first(v)}: ${r.reply}\n  [jev] ${JSON.stringify(r.debug)}`);
  if (r.leaving && v.intent) { await sim.setOff(s, v, ui); console.log(`  (${sim.first(v)} leaves for ${sim.placeName(v.location)})`); }
  s.player.talkingTo = null;
}

console.log(`Decisions: ${jev.mode()}`);
for (s.minute = 8 * 60 + 15; s.minute <= 18 * 60; s.minute += 15) {
  const t = sim.clock(s.minute);
  if (script[t]) await script[t]();
  await sim.tick(s, ui);
  if (s.player.talkingTo) { console.log(`  (you say goodbye to ${s.player.talkingTo})`); s.player.talkingTo = null; }
}
console.log("\n=== night: who wants whom out ===");
await sim.endOfDay(s, ui);
for (const v of sim.alive(s)) console.log(`${v.name} wants out: ${sim.nameOf(s, v.target)}; deals: ${JSON.stringify(v.allies || {})}`);
console.log("\n=== the vote ===");
const ballots = await sim.castVotes(s);
for (const b of ballots) console.log(`${sim.nameOf(s, b.voter)} -> ${sim.nameOf(s, b.target)}`);
const result = await sim.tally(s, ballots);
console.log(`Out: ${sim.nameOf(s, result.out)} ${JSON.stringify(result.count)}${result.tie ? " (tie)" : ""}`);
sim.eliminate(s, result.out);
console.log("\n=== tracker ===");
console.log(JSON.stringify(sim.tracker(s), null, 1).slice(0, 2500));
console.log(`\nrumors: ${Object.keys(s.rumors).length}, fights: ${s.fights || 0}`);
console.log(`Jev calls: ${jev.stats.calls}, Claude calls: ${llm.stats.calls}`);
