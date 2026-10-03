// The game loop, shared by the terminal (main.js) and the web page (web.js).
// A day runs from 08:00 to 20:00 in real time. Every VOTE_EVERY days, at 18:00, the
// whole town gathers in the square and votes one woman out. Last one standing wins.
//
// The front end passes in an output object:
//   say(text)          a line for the log
//   status(text)       the clock changed
//   ended(result)      the game is over: { won: bool }
// and, for the 3D version, optional hooks (see web.js):
//   hooks: { moved, pair, hearing, overheard, bubble, emote, approach, opened, learned, isNear }
//   beforeTick(), afterTick(), dusk(), night(lines), dawn()
//   ceremony: { gather(), ballot(candidates) -> Promise<target>, reveal(show) -> Promise, done() }

import "./env.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { newTown, PLACES, SHOW } from "./world.js";
import * as sim from "./sim.js";
import * as jev from "./jev.js";
import * as llm from "./llm.js";

const DAY_SECONDS = Number(process.env.DAY_SECONDS || 360); // real seconds for 08:00 -> 20:00
const GAME_MIN_PER_SEC = (12 * 60) / DAY_SECONDS;
const SAVE = "save.json";
const SHOW_JEV = process.env.SHOW_JEV === "1";
const VOTE_HOUR = 18;

export const HELP = `Commands
  look                  where you are and who is here
  go <place>            walk somewhere (${Object.keys(PLACES).join(", ")})
  talk <name>           start talking; then just type what you say. "bye" to stop
  listen                lean in on the conversations here (hear everything, but you may be noticed)
  wait                  let time pass
  stats                 how many Jev and Claude calls so far
  quit                  save and exit`;

export function createGame(out, { fresh = false } = {}) {
  let s = existsSync(SAVE) && !fresh ? JSON.parse(readFileSync(SAVE, "utf8")) : newTown();
  if (!s.alliances) s = newTown(); // an old save from before the reality show
  let busy = false, paused = false, carry = 0, timer = null, over = !!s.over;
  const ui = { say: (t) => out.say(t), ...(out.hooks || {}) };
  const save = () => writeFileSync(SAVE, JSON.stringify(s));

  function status() {
    const who = s.player.talkingTo ? ` talking to ${sim.first(s.people[s.player.talkingTo])}` : "";
    return `[Day ${s.day} ${sim.clock(s.minute)}${who}]`;
  }

  function look() {
    const place = PLACES[s.player.location];
    if (!place) return `You are on the lane between places.\nPlaces: ${Object.keys(PLACES).join(", ")}.`;
    const here = sim.at(s, s.player.location);
    const lines = [`You are at ${place.name}. ${place.desc}`];
    lines.push(here.length ? `Here: ${here.map((v) => `${v.name} (${v.job})`).join(", ")}.` : "Nobody else is here.");
    return lines.join("\n");
  }

  // speech: true means the line is something you say out loud, even if it starts with a command word
  async function handle(line, { speech = false } = {}) {
    const text = line.trim();
    if (!text || over || s.ceremony) return;
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    const lc = cmd.toLowerCase();

    // in a conversation, anything that is not a command is something you say
    const commands = ["look", "go", "talk", "listen", "wait", "stats", "help", "quit", "bye"];
    if (s.player.talkingTo && (speech || !commands.includes(lc))) {
      const v = s.people[s.player.talkingTo];
      if (v.gone) { s.player.talkingTo = null; return; }
      const { reply, debug, leaving, mood } = await sim.playerSays(s, v, text, ui);
      ui.say(`${sim.first(v)}: ${reply}`);
      ui.bubble?.(v.id, reply, mood);
      if (SHOW_JEV) ui.say(`   [jev] ${JSON.stringify(debug)}`);
      if (!s.player.talkingTo) ui.say(`(${sim.first(v)} ends the conversation.)`);
      // someone who said she would go and do something right now goes
      if (leaving && v.intent) await sim.setOff(s, v, ui);
      return;
    }

    switch (lc) {
      case "help": ui.say(HELP); break;
      case "look": ui.say(look()); break;
      case "go": {
        const dest = Object.keys(PLACES).find((k) => k.startsWith(arg.toLowerCase()) || PLACES[k].name.toLowerCase().includes(arg.toLowerCase()));
        if (!dest) { ui.say("Where? " + Object.keys(PLACES).join(", ")); break; }
        s.player.location = dest; s.player.talkingTo = null;
        ui.say(look());
        break;
      }
      case "talk": {
        const v = sim.findPerson(s, arg);
        if (!v) { ui.say("She isn't here."); break; }
        s.player.talkingTo = v.id;
        ui.say(`You start talking to ${v.name}.`);
        break;
      }
      case "bye": if (s.player.talkingTo) ui.say(`You leave ${sim.first(s.people[s.player.talkingTo])} be.`); s.player.talkingTo = null; break;
      case "listen": s.player.listening = true; ui.say("You drift closer and keep your ears open."); break;
      case "wait": ui.say("You let the time pass."); break;
      case "stats": ui.say(`Jev: ${jev.stats.calls} calls (${jev.mode()}), avg ${jev.stats.calls ? Math.round(jev.stats.ms / jev.stats.calls) : 0} ms. Claude: ${llm.stats.calls} calls, avg ${llm.stats.calls ? Math.round(llm.stats.ms / llm.stats.calls) : 0} ms.`); break;
      case "quit": save(); out.quit?.(); break;
      default: ui.say(`Not sure what "${cmd}" means. Type help.`);
    }
  }

  // The clock runs in real time; every 15 game minutes the town takes a step.
  function startClock() {
    if (over || s.ceremony) return;
    clearInterval(timer);
    timer = setInterval(async () => {
      if (paused) return;
      carry += GAME_MIN_PER_SEC;
      const before = s.minute;
      s.minute += Math.floor(carry);
      carry -= Math.floor(carry);
      out.status(status());
      const isVoteDay = sim.voteDay(s.day) === s.day;
      if (isVoteDay && s.minute >= VOTE_HOUR * 60 && !paused && !s.voted) { await voteNight(); return; }
      if (Math.floor(s.minute / 15) !== Math.floor(before / 15) && !busy) {
        busy = true;
        out.beforeTick?.();
        try { await sim.tick(s, ui); save(); } catch (e) { ui.say(`[tick error] ${e.message}`); console.error(e); }
        busy = false;
        out.afterTick?.();
      }
      if (s.minute >= 20 * 60 && !paused) await nightfall();
    }, 1000);
  }
  function stopClock() { clearInterval(timer); timer = null; }

  // ---------- the vote ----------

  async function voteNight() {
    paused = true; stopClock();
    s.ceremony = true; s.player.talkingTo = null; s.approaching = null;
    const c = out.ceremony || {};
    ui.say(`\nSix o'clock. The whole town gathers in the square for the vote.`);
    await c.gather?.();
    const cast = sim.alive(s);
    const candidates = cast.map((v) => v.id);
    // everything slow starts at once: Jev decides the votes, Claude writes the host's opening
    const hostOpen = llm.hostLine({ moment: `The town has gathered in the square for the vote. ${cast.length + 1} women are left. Welcome everyone and build the tension before they vote.` });
    const ballotsP = sim.castVotes(s);
    // each woman's line for her vote is written while the player is still choosing
    const linesP = ballotsP.then((bs) => Promise.all(bs.map((b) => llm.voteLine({ v: s.people[b.voter], targetName: sim.nameOf(s, b.target), recent: s.people[b.voter].memory.slice(-3) }))));
    const mine = s.player.gone ? null : await (c.ballot ? c.ballot(candidates, await hostOpen) : Promise.resolve(null));
    const ballots = await ballotsP;
    const lines = [...(await linesP), null];
    if (mine && s.people[mine]) ballots.push({ voter: "player", target: mine });
    const result = await sim.tally(s, ballots);
    const outName = sim.nameOf(s, result.out);
    const [hostReveal, parting] = await Promise.all([
      llm.hostLine({ moment: `All the votes are in. ${result.tie ? "It was a tie, and you broke it." : ""} You are about to announce that ${outName} is leaving town. Say it with a dramatic pause.` }),
      result.out === "player" ? Promise.resolve(null) : llm.partingLine({ v: s.people[result.out], votes: result.count[result.out] }),
    ]);
    // reveal the votes one by one, saving the votes for the one going home for last
    const order = ballots.map((b, i) => ({ ...b, line: lines[i] }));
    order.sort((a, b) => (a.target === result.out) - (b.target === result.out) || Math.random() - 0.5);
    s.votes.push({ day: s.day, ballots: ballots.map(({ voter, target }) => ({ voter, target })), out: result.out, count: result.count });
    for (const b of ballots) if (b.voter !== "player") sim.remember(s.people[b.voter], s, `voted for ${sim.nameOf(s, b.target)}`);
    for (const v of sim.alive(s)) for (const b of ballots) if (b.voter !== v.id) sim.remember(v, s, `${sim.nameOf(s, b.voter)} voted for ${b.target === v.id ? "me" : sim.nameOf(s, b.target)}`);
    ui.say(`${SHOW.host.first}: ${await hostOpen}`);
    for (const b of order) ui.say(`${sim.nameOf(s, b.voter)} votes for ${sim.nameOf(s, b.target)}${b.line ? `: ${b.line}` : ""}`);
    ui.say(`${SHOW.host.first}: ${hostReveal}`);
    if (parting) ui.say(`${sim.first(s.people[result.out])}: ${parting}`);
    await c.reveal?.({ order, count: result.count, out: result.out, tie: result.tie, hostReveal, parting });
    sim.eliminate(s, result.out);
    s.ceremony = false; s.voted = true;
    const left = sim.alive(s);
    if (s.player.gone) { finish(false); return; }
    if (left.length <= 1) { finish(true); return; }
    await c.done?.();
    await nightfall();
  }

  function finish(won) {
    over = true; s.over = { won };
    save();
    ui.say(won ? "\nYou are the last woman standing. You win Thistlewick!" : "\nYou have been voted out of Thistlewick. Game over.");
    out.ended?.({ won });
  }

  async function nightfall() {
    paused = true; stopClock();
    out.dusk?.();
    ui.say(`\nThe bells ring eight. Day ${s.day} is over. The town goes to bed and plots...`);
    const lines = await sim.endOfDay(s, ui);
    out.night?.(lines);
    s.day += 1; s.minute = 8 * 60; s.voted = false;
    s.player.location = "plaza"; s.player.talkingTo = null;
    s.lastApproach = -999;
    for (const v of sim.alive(s)) { v.location = "home"; v.lastApproach = -999; } // everyone wakes at home; Jev decides where they go
    save();
    out.dawn?.();
    ui.say(`\nDay ${s.day} begins.${sim.voteDay(s.day) === s.day ? " Tonight is the vote." : ""}`);
    paused = false;
    startClock();
  }

  return {
    intro: () => `${SHOW.name}. You are the newcomer. A day lasts ${Math.round(DAY_SECONDS / 60)} real minutes. Decisions: ${jev.mode()}. Type help.\n\n${look()}\n`,
    status,
    state: () => s,
    save,
    start: startClock,
    stop: () => { stopClock(); save(); },
    running: () => !!timer,
    isOver: () => over,
    async handle(line, opts) { try { await handle(line, opts); } catch (e) { ui.say(`[error] ${e.message}`); console.error(e); } out.status(status()); },
  };
}
