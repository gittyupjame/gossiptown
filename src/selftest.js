// Plays one scripted day with no clock, to check the simulation end to end.
//   GOSSIP_FAKE_LLM=1 node src/selftest.js     fast, no Claude calls
//   node src/selftest.js                       real Claude lines (slow)
import "./env.js";
import { newTown } from "./world.js";
import * as sim from "./sim.js";
import * as jev from "./jev.js";
import * as llm from "./llm.js";

const s = newTown();
const out = [];
const ui = { say: (t) => { out.push(t); console.log(t); } };
const script = {
  "08:15": async () => { s.player.location = "tavern"; s.player.talkingTo = "wren"; },
  "08:30": async () => say("wren", "Morning! I'm new here. This place is lovely."),
  "08:45": async () => say("wren", "I hate to say it, but I saw Silas pocketing coins from your till last night."),
  "09:30": async () => { sim.leaveNote(s, s.people.brannoc, "Odo's scale is crooked. He has been cheating the whole town, you included."); console.log("> note left for Brannoc"); },
  "10:30": async () => { s.player.location = "smithy"; s.player.talkingTo = "pip"; },
  "10:45": async () => say("pip", "Pip, between us, Odo told me Brannoc's work is shoddy and overpriced."),
  "12:00": async () => { s.player.location = "tavern"; s.player.listening = true; console.log("> listening at the tavern"); },
  "14:00": async () => { s.player.location = "market"; console.log("> " + await sim.doAction(s, "knock over a basket of apples at Odo's stall", ui)); },
  "18:00": async () => { s.player.location = "tavern"; s.player.listening = true; },
};
async function say(id, line) {
  const v = s.people[id];
  if (v.location !== s.player.location) { console.log(`> (${id} is not here, at ${v.location})`); return; }
  const r = await sim.playerSays(s, v, line, ui);
  console.log(`> YOU to ${sim.first(v)}: ${line}\n  ${sim.first(v)}: ${r.reply}\n  [jev] ${JSON.stringify(r.debug)}`);
}

console.log(`Decisions: ${jev.mode()}`);
for (s.minute = 8 * 60 + 15; s.minute <= 20 * 60; s.minute += 15) {
  const t = sim.clock(s.minute);
  if (script[t]) await script[t]();
  await sim.tick(s, ui);
}
console.log("\n=== night ===");
for (const l of await sim.endOfDay(s, ui)) console.log(" - " + l);
console.log("\n=== who knows what (conf >= 0.4) ===");
for (const v of Object.values(s.people)) {
  const k = Object.entries(v.knows).filter(([, x]) => x.conf >= 0.4).map(([id]) => s.rumors[id].text.slice(0, 70));
  console.log(`${v.name}${v.gone ? " (gone)" : ""}${v.employed ? "" : " (out of work)"}: ${k.length} -> ${k.join(" | ")}`);
}
console.log("\n=== feelings toward the newcomer ===");
for (const v of sim.alive(s)) console.log(`${v.name}: affinity ${s.rel[v.id].player.affinity.toFixed(1)}, trust ${s.rel[v.id].player.trust.toFixed(1)}`);
console.log(`\nrumors: ${Object.keys(s.rumors).length}, fights: ${s.fights || 0}, events: ${s.events.length}`);
console.log(`Jev calls: ${jev.stats.calls}, Claude calls: ${llm.stats.calls}`);
