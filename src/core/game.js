// The game loop: the clock, the days, saving, conversations and the vote nights.
// The page drives it by calling update(dt) every frame while the game is not paused,
// so pausing (or closing the page) stops the town and every Jev and Claude call.

import { newTown, SHOW } from "./cast.js";
import * as sim from "./sim.js";

const SAVE_KEY = "gossiptown.season.v2";

export function hasSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); return !!raw && JSON.parse(raw).version === 2 && !JSON.parse(raw).over; } catch { return false; }
}

export function createGame(ui, { daySeconds = 300 } = {}) {
  let s = null;
  let carry = 0, busy = false, busyAt = 0;
  const gameMinPerSec = () => (12 * 60) / daySeconds;
  const setDaySeconds = (n) => { daySeconds = n; };

  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {} };

  function newSeason(playerName) {
    s = newTown({ playerName });
    s.phase = "day";
    save();
    return s;
  }
  function load() {
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { s = null; }
    if (!s || s.version !== 2) return null;
    for (const v of sim.alive(s)) v.approaching = false;
    s.player.talkingTo = null;
    if (s.phase === "day") s.minute = Math.max(8 * 60, Math.min(s.minute, 19 * 60 + 45));
    return s;
  }

  // Called every frame while playing.
  function update(dt) {
    if (!s || s.phase !== "day" || s.over) return;
    carry += dt * gameMinPerSec();
    const step = Math.floor(carry);
    if (!step) return;
    carry -= step;
    const before = s.minute;
    s.minute = Math.min(20 * 60, s.minute + step);
    ui.clock?.(s);
    if (sim.isVoteDay(s) && before < 19 * 60 && s.minute >= 19 * 60) ui.bell?.(s);
    if (Math.floor(s.minute / 15) !== Math.floor(before / 15) && !busy && s.minute < 20 * 60) runTick();
    // a slow tick (a long Jev or dialogue call) never holds up the evening for long
    if (s.minute >= 20 * 60 && (!busy || performance.now() - busyAt > 15000)) dusk();
  }

  async function runTick() {
    busy = true; busyAt = performance.now();
    try { await sim.tick(s, ui); save(); } catch (e) { console.error("tick failed", e); }
    busy = false;
  }

  function dusk() {
    if (s.phase !== "day") return;
    endTalk();
    s.phase = sim.isVoteDay(s) ? "vote" : "night";
    save();
    if (s.phase === "vote") ui.voteNight?.(s);
    else night();
  }

  async function night() {
    ui.nightStart?.(s);
    let lines = [];
    try { lines = await sim.endOfDay(s, ui); } catch (e) { console.error(e); }
    save();
    ui.nightDone?.(s, lines);
  }

  function nextDay() {
    if (s.over) return;
    s.day += 1; s.minute = 8 * 60; s.phase = "day";
    s.player.location = "plaza"; s.player.talkingTo = null;
    for (const v of sim.alive(s)) { v.location = "home"; v.approaching = false; }
    save();
    ui.dawn?.(s);
  }

  // ---------- the vote ----------

  function voteSetup() {
    const left = sim.alive(s).map((v) => v.id);
    const remaining = left.length + (s.player.out ? 0 : 1);
    const finale = remaining <= SHOW.finalists;
    const candidates = [...left, ...(s.player.out ? [] : ["player"])];
    const jury = finale ? Object.values(s.people).filter((v) => v.out).map((v) => v.id) : [];
    return { finale, candidates, voters: finale ? jury : left, jury };
  }

  // Start the cast's ballots as soon as the ceremony begins, so Jev works while the player picks.
  let pending = null;
  function startBallots() {
    const { finale, candidates, voters } = voteSetup();
    pending = sim.castVotes(s, candidates, voters.map((id) => s.people[id]), { finale });
    return pending;
  }

  async function resolveVote(playerBallot) {
    const { finale, candidates } = voteSetup();
    const first = { ...(await (pending || startBallots())) };
    pending = null;
    if (playerBallot && !finale) first.player = playerBallot;
    const rounds = [{ ballots: first, among: candidates }];
    const top = (ballots) => {
      const t = {};
      for (const x of Object.values(ballots)) t[x] = (t[x] || 0) + 1;
      const max = Math.max(...Object.values(t));
      return Object.keys(t).filter((k) => t[k] === max);
    };
    let leaders = top(first), drawn = false;
    if (leaders.length > 1) {
      // a tie: everyone else votes again between the tied women
      const voters = Object.keys(first).filter((id) => !leaders.includes(id) && id !== "player" && s.people[id]);
      const again = voters.length ? await sim.castVotes(s, leaders, voters.map((id) => s.people[id]), { finale }) : {};
      if (!finale && first.player && leaders.includes(first.player) && !leaders.includes("player")) again.player = first.player;
      rounds.push({ ballots: again, among: leaders });
      const l2 = Object.keys(again).length ? top(again) : leaders;
      leaders = l2;
      if (leaders.length > 1) { leaders = [leaders[Math.floor(Math.random() * leaders.length)]]; drawn = true; }
    }
    const chosen = leaders[0];
    let rec;
    if (finale) {
      s.over = { won: chosen === "player", reason: "finale", winner: chosen };
      rec = { day: s.day, ballots: first, out: null, winner: chosen, finale: true, betrayals: [] };
      s.votes.push(rec);
      s.phase = "over";
    } else {
      rec = sim.applyVote(s, first, chosen, ui);
      if (chosen === "player") { s.over = { won: false, reason: "voted out" }; s.phase = "over"; }
    }
    save();
    return { ...rec, rounds, drawn, finale };
  }

  function afterVote() {
    if (s.over) return;
    night();
  }

  // ---------- conversations ----------

  function startTalk(id) {
    const v = s.people[id];
    if (!v || v.gone) return false;
    s.player.talkingTo = id;
    if (s.player.convo?.with !== id) s.player.convo = { with: id, lines: [] };
    ui.first?.("talk", { id });
    return true;
  }
  function endTalk() {
    s.player.talkingTo = null;
  }
  async function say(text, onText) {
    const v = s.people[s.player.talkingTo];
    if (!v) return null;
    const res = await sim.playerSays(s, v, text.slice(0, 400), ui, onText);
    save();
    if (res.leaving) {
      s.player.talkingTo = null;
      if (v.intent) sim.setOff(s, v, ui);
    }
    return res;
  }

  return {
    newSeason, load, save, update, nextDay, startBallots, resolveVote, afterVote, voteSetup,
    startTalk, endTalk, say, night, setDaySeconds,
    state: () => s,
    busy: () => busy,
  };
}
