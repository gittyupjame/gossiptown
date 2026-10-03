// Thistlewick: a living gossip village. Text prototype.
// Run:  JEV_API_KEY=... node src/main.js

import "./env.js";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { newTown, PLACES } from "./world.js";
import * as sim from "./sim.js";
import * as jev from "./jev.js";
import * as llm from "./llm.js";

const DAY_SECONDS = Number(process.env.DAY_SECONDS || 600); // real seconds for 08:00 -> 20:00
const GAME_MIN_PER_SEC = (12 * 60) / DAY_SECONDS;
const SAVE = "save.json";
const SHOW_JEV = process.env.SHOW_JEV === "1";

let s = existsSync(SAVE) && !process.argv.includes("--new") ? JSON.parse(readFileSync(SAVE, "utf8")) : newTown();
let busy = false, paused = false, carry = 0, timer = null;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ui = {
  say(text) {
    process.stdout.write("\r\x1b[K" + text + "\n");
    rl.prompt(true);
  },
};
const save = () => writeFileSync(SAVE, JSON.stringify(s));

function prompt() {
  const who = s.player.talkingTo ? ` talking to ${sim.first(s.people[s.player.talkingTo])}` : "";
  rl.setPrompt(`[Day ${s.day} ${sim.clock(s.minute)}${who}] > `);
  rl.prompt(true);
}

function look() {
  const place = PLACES[s.player.location];
  const here = sim.at(s, s.player.location);
  const lines = [`You are at ${place.name}. ${place.desc}`];
  lines.push(here.length ? `Here: ${here.map((v) => `${v.name} (${v.employed ? v.job : "out of work"})`).join(", ")}.` : "Nobody else is here.");
  lines.push(`Places: ${Object.keys(PLACES).join(", ")}.`);
  return lines.join("\n");
}

const HELP = `Commands
  look                      where you are and who is here
  go <place>                walk somewhere (square, bakery, smithy, tavern, market, garden, hall)
  talk <name>               start talking; then just type what you say. "bye" to stop
  listen                    lean in on the conversations here (hear everything, but you may be noticed)
  follow <name> / stop      follow someone around
  give <name> <thing>       give a gift. Your things: see "bag"
  note <name> <text>        leave an unsigned note for someone to find
  do <anything>             do something in the world, in your own words
  map                       what you have figured out about the town
  journal                   gossip you have overheard
  wait                      let time pass
  stats                     how many Jev and Claude calls so far
  quit                      save and exit`;

async function handle(line) {
  const text = line.trim();
  if (!text) return;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  const lc = cmd.toLowerCase();

  // in a conversation, anything that is not a command is something you say
  const commands = ["look", "go", "talk", "listen", "follow", "stop", "give", "note", "do", "map", "journal", "wait", "stats", "help", "quit", "bag", "bye"];
  if (s.player.talkingTo && !commands.includes(lc)) {
    const v = s.people[s.player.talkingTo];
    if (v.location !== s.player.location || v.gone) { ui.say(`${sim.first(v)} isn't here anymore.`); s.player.talkingTo = null; return; }
    const { reply, debug } = await sim.playerSays(s, v, text, ui);
    ui.say(`${sim.first(v)}: ${reply}`);
    if (SHOW_JEV) ui.say(`   [jev] ${JSON.stringify(debug)}`);
    if (!s.player.talkingTo) ui.say(`(${sim.first(v)} ends the conversation.)`);
    return;
  }

  switch (lc) {
    case "help": ui.say(HELP); break;
    case "look": ui.say(look()); break;
    case "bag": ui.say(`You carry: ${s.player.gifts.join(", ") || "nothing"}.`); break;
    case "go": {
      const dest = Object.keys(PLACES).find((k) => k.startsWith(arg.toLowerCase()) || PLACES[k].name.includes(arg.toLowerCase()));
      if (!dest) { ui.say("Where? " + Object.keys(PLACES).join(", ")); break; }
      s.player.location = dest; s.player.talkingTo = null; s.player.following = null;
      ui.say(look());
      break;
    }
    case "talk": {
      const v = sim.findPerson(s, arg);
      if (!v || v.location !== s.player.location) { ui.say("They aren't here."); break; }
      s.player.talkingTo = v.id;
      ui.say(`You approach ${v.name}. Type what you want to say. "bye" to stop.`);
      break;
    }
    case "bye": if (s.player.talkingTo) ui.say(`You leave ${sim.first(s.people[s.player.talkingTo])} be.`); s.player.talkingTo = null; break;
    case "listen": s.player.listening = true; ui.say("You drift closer and keep your ears open."); break;
    case "follow": {
      const v = sim.findPerson(s, arg);
      if (!v || v.location !== s.player.location) { ui.say("They aren't here."); break; }
      s.player.following = v.id; ui.say(`You keep a casual distance behind ${sim.first(v)}.`); break;
    }
    case "stop": s.player.following = null; ui.say("You stop following."); break;
    case "give": {
      const v = sim.findPerson(s, rest[0] || "");
      const thing = rest.slice(1).join(" ").toLowerCase();
      const item = s.player.gifts.find((g) => g.toLowerCase().includes(thing));
      if (!v || v.location !== s.player.location) { ui.say("They aren't here."); break; }
      if (!thing || !item) { ui.say(`Give what? You carry: ${s.player.gifts.join(", ")}.`); break; }
      s.player.gifts = s.player.gifts.filter((g) => g !== item);
      ui.say(`You give ${item} to ${sim.first(v)}. ` + (await sim.give(s, v, item)));
      break;
    }
    case "note": {
      const v = sim.findPerson(s, rest[0] || "");
      if (!v) { ui.say("Note for whom?"); break; }
      sim.leaveNote(s, v, rest.slice(1).join(" "));
      ui.say(`You slip an unsigned note where ${sim.first(v)} will find it.`);
      break;
    }
    case "do": ui.say(await sim.doAction(s, arg, ui)); break;
    case "map": ui.say(sim.socialMap(s).join("\n")); break;
    case "journal": ui.say(s.player.journal.slice(-12).join("\n") || "Nothing yet."); break;
    case "wait": ui.say("You let the time pass."); break;
    case "stats": ui.say(`Jev: ${jev.stats.calls} calls (${jev.mode()}), avg ${jev.stats.calls ? Math.round(jev.stats.ms / jev.stats.calls) : 0} ms. Claude: ${llm.stats.calls} calls, avg ${llm.stats.calls ? Math.round(llm.stats.ms / llm.stats.calls) : 0} ms.`); break;
    case "quit": save(); process.exit(0);
    default: ui.say(`Not sure what "${cmd}" means. Type help.`);
  }
}

// The clock runs in real time; every 15 game minutes the town takes a step.
function startClock() {
  timer = setInterval(async () => {
    if (paused) return;
    carry += GAME_MIN_PER_SEC;
    const before = s.minute;
    s.minute += Math.floor(carry);
    carry -= Math.floor(carry);
    prompt();
    if (Math.floor(s.minute / 15) !== Math.floor(before / 15) && !busy) {
      busy = true;
      try { await sim.tick(s, ui); save(); } catch (e) { ui.say(`[tick error] ${e.message}`); }
      busy = false;
    }
    if (s.minute >= 20 * 60) await nightfall();
  }, 1000);
}

async function nightfall() {
  paused = true;
  clearInterval(timer);
  ui.say(`\nThe bells ring eight. Day ${s.day} is over. The town goes to bed and makes up its mind...`);
  const lines = await sim.endOfDay(s, ui);
  ui.say(lines.length ? lines.map((l) => "  - " + l).join("\n") : "  - A quiet night. Nobody's mind changed much.");
  if (s.banished) { save(); ui.say("\nThanks for playing."); process.exit(0); }
  s.day += 1; s.minute = 8 * 60; s.player.location = "square"; s.player.talkingTo = null; s.player.following = null;
  for (const v of sim.alive(s)) v.location = v.schedule[8] || "square";
  save();
  ui.say(`\nDay ${s.day} begins. You wake in your rented room and step out into the square. (Prototype: days after the first work, but the season ending isn't built yet.)`);
  paused = false;
  startClock();
}

console.log(`Thistlewick. You are the newcomer. A day lasts ${Math.round(DAY_SECONDS / 60)} real minutes. Decisions: ${jev.mode()}. Type help.\n`);
console.log(look() + "\n");
rl.on("line", async (line) => { try { await handle(line); } catch (e) { ui.say(`[error] ${e.message}`); } prompt(); });
rl.on("close", () => { save(); process.exit(0); });
prompt();
startClock();
