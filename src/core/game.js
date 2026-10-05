// The game loop: the clock, the days, saving, conversations and the vote nights.
// The page drives it by calling update(dt) every frame while the game is not paused, so
// pausing (or closing the page) stops the clock, and runtime.setPaused holds every Jev and
// Claude call: nothing is sent and no answer lands while paused.

import { newTown, SHOW } from "./cast.js";
import * as sim from "./sim.js";
import * as events from "./events.js";
import * as looks from "./looks.js";
import * as runtime from "./runtime.js";
import * as rng from "./rng.js";
import * as jev from "./jev.js";
import * as T from "./talk.js";
import * as A from "./agents.js";
import { checkInvariants } from "./invariants.js";
import * as R from "./record.js";

const SAVE_KEY = "gossiptown.season.v3";
export const TICK = 5; // in-game minutes per tick

export function hasSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; const j = JSON.parse(raw); return j.version === 3 && !j.over; } catch { return false; }
}

export function createGame(ui, { daySeconds = 300, store = typeof localStorage !== "undefined" ? localStorage : null } = {}) {
  let s = null;
  let carry = 0;
  R.setCueSink((c) => ui.emote?.(c.who, c.kind));
  let inflight = 0, inflightAt = 0;
  const gameMinPerSec = () => (12 * 60) / daySeconds;
  const setDaySeconds = (n) => { daySeconds = n; };

  const save = () => { if (!s || !store) return; try { sim.prune(s, 2); store.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { console.warn("save failed", e); } };

  function begin(state) {
    s = state;
    rng.bind(s);
    jev.setSeed(s.seed);
    return s;
  }

  function newSeason(playerName, outfit = null, { seed = null } = {}) {
    runtime.newSeason();
    begin(newTown({ playerName, seed }));
    sim.seedHistory(s);
    looks.setUp(s);
    s.player.debuted = false; // the welcome party gets the first look
    if (outfit) looks.dress(s, outfit);
    // the welcome party in the plaza: everyone is there and hears Primrose introduce the newcomer
    for (const v of A.alive(s)) A.place(s, v, "plaza", "rule:welcome-party");
    s.player.location = "plaza";
    sim.announce(s, `Everyone, meet our newcomer, ${s.player.name}! She's moving in today, and she's in the game.`, "rule:welcome-party");
    planShow();
    save();
    return s;
  }
  function load() {
    let raw = null;
    try { raw = JSON.parse(store.getItem(SAVE_KEY)); } catch { raw = null; }
    if (!raw || raw.version !== 3) return null;
    begin(raw);
    s.player.talkingTo = null;
    looks.setUp(s);
    if (s.phase === "day") s.minute = Math.max(8 * 60, Math.min(s.minute, 19 * 60 + 45));
    if ((s.phase === "day" || s.phase === "show") && !events.showOf(s)) { s.phase = "day"; planShow(); }
    // a talk with the newcomer can't survive a reload (she isn't standing there any more);
    // talks between women pick up where they were
    const pt = T.talkOf(s, "player");
    if (pt) T.end(s, pt, "the newcomer left", "player:walk-away", ui);
    return s;
  }

  // Primrose picks today's show (a Jev decision); the town plays on meanwhile.
  function planShow() {
    const day = s.day;
    inflight++;
    events.planDay(s).then((ev) => { if (s.day === day) { save(); ui.showPlanned?.(s, ev); } }).catch((e) => console.error("show planning failed", e)).finally(() => inflight--);
  }

  // One tick: what's due starts; the page doesn't wait for it.
  function runTick() {
    runtime.note({ t: "tick", day: s.day, minute: s.minute });
    inflight++; inflightAt = performance.now();
    return sim.tick(s, ui).then(() => {
      const bad = checkInvariants(s);
      s.checks = (s.checks || 0) + 1;
      if (bad.length) for (const b of bad) s.violations.push({ rule: `invariant:${b.rule}`, detail: b.detail, day: s.day, minute: s.minute });
    }).catch((e) => console.error("tick failed", e)).finally(() => { inflight--; });
  }

  // Called every frame while playing.
  let saveAt = 0;
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
    const ev = events.showOf(s);
    if (ev && !ev.done) {
      if (!ev.bell && s.minute >= ev.minute - 30) { ev.bell = true; ui.showBell?.(s, ev); }
      if (s.minute >= ev.minute) { endTalk(); s.phase = "show"; events.gather(s); save(); ui.showStart?.(s, ev); return; }
    }
    if (Math.floor(s.minute / TICK) !== Math.floor(before / TICK) && s.minute < 20 * 60) runTick();
    if (performance.now() - saveAt > 4000) { saveAt = performance.now(); save(); }
    // a slow call never holds up the evening for long
    if (s.minute >= 20 * 60 && (inflight === 0 || performance.now() - inflightAt > 15000)) dusk();
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
    s.phase = "night";
    save();
    ui.nightDone?.(s, lines);
  }

  function nextDay() {
    if (s.over) return;
    runtime.note({ t: "dawn", day: s.day + 1 });
    s.day += 1; s.minute = 8 * 60; s.phase = "day";
    sim.dawn(s);
    looks.payday(s);
    planShow();
    save();
    ui.dawn?.(s);
  }

  // ---------- Primrose's show ----------
  function endShow() {
    events.finish(s);
    if (s.phase === "show") s.phase = "day";
    save();
  }

  // ---------- the vote ----------
  function voteSetup() {
    const left = A.alive(s).map((v) => v.id);
    const remaining = left.length + (s.player.out ? 0 : 1);
    const finale = remaining <= SHOW.finalists;
    const candidates = [...left, ...(s.player.out ? [] : ["player"])];
    const jury = finale ? Object.values(s.people).filter((v) => v.out).map((v) => v.id) : [];
    return { finale, candidates, voters: finale ? jury : left, jury };
  }

  // the cast votes as soon as the ceremony begins, so Jev works while the player picks
  let pending = null, lines = null;
  function startBallots() {
    const { finale, candidates, voters } = voteSetup();
    for (const v of A.alive(s)) if (v.location !== "firepit") A.place(s, v, "firepit", "rule:vote");
    s.player.location = "firepit";
    // everything said before the bell is judged before anyone votes
    for (const t of Object.values(s.talks)) if (t.status === "active") T.end(s, t, "the vote bell rang", "rule:vote-bell", ui);
    pending = T.flushUnjudged(s, ui).then(() => sim.castVotes(s, candidates, voters.map((id) => s.people[id]), { finale }));
    return pending;
  }
  async function ballotLines() {
    const ballots = await (pending || startBallots());
    lines = await sim.ballotLines(s, ballots, { finale: voteSetup().finale }).catch(() => ({}));
    return lines;
  }

  async function resolveVote(playerBallot) {
    const { finale, candidates } = voteSetup();
    runtime.note({ t: "ballot", target: playerBallot });
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
    let final = first;
    if (leaders.length > 1) {
      // a tie: everyone else votes again between the tied women
      const voters = Object.keys(first).filter((id) => !leaders.includes(id) && id !== "player" && s.people[id]);
      const again = voters.length ? await sim.castVotes(s, leaders, voters.map((id) => s.people[id]), { finale }) : {};
      if (!finale && first.player && leaders.includes(first.player) && !leaders.includes("player")) again.player = first.player;
      rounds.push({ ballots: again, among: leaders });
      const l2 = Object.keys(again).length ? top(again) : leaders;
      leaders = l2;
      if (Object.keys(again).length) final = { ...first, ...again };
      if (leaders.length > 1) { leaders = [leaders[Math.floor(rng.rand() * leaders.length)]]; drawn = true; }
    }
    const chosen = leaders[0];
    let rec;
    if (finale) {
      s.over = { won: chosen === "player", reason: "finale", winner: chosen };
      for (const [voter, target] of Object.entries(first)) sim.announce(s, `${sim.nameOf(s, voter)} votes for ${sim.nameOf(s, target)} to win.`, "rule:vote");
      rec = { day: s.day, ballots: first, out: null, winner: chosen, finale: true, betrayals: [], reasons: {} };
      s.votes.push(rec);
      s.phase = "over";
    } else {
      rec = await sim.applyVote(s, final, chosen, ui, { lines: lines || {} });
      if (chosen === "player") { s.over = { won: false, reason: "voted out" }; s.phase = "over"; }
    }
    lines = null;
    save();
    return { ...rec, rounds, drawn, finale };
  }

  async function partingShot(id) {
    const r = await sim.partingShot(s, id, ui).catch(() => null);
    save();
    return r;
  }

  function afterVote() { if (!s.over) night(); }

  // ---------- conversations ----------
  function startTalk(id) {
    const t = sim.startTalk(s, id, ui);
    if (!t) return null;
    s.player.talkingTo = id;
    ui.first?.("talk", { id });
    return t;
  }
  function endTalk() {
    if (!s) return;
    sim.endTalk(s, "the newcomer walked off", ui);
    s.player.talkingTo = null;
  }
  async function say(text) {
    const t = T.talkOf(s, "player");
    if (!t) return null;
    const res = await sim.playerSays(s, text.slice(0, 400), ui);
    if (res?.leaving) s.player.talkingTo = null;
    save();
    return res;
  }

  // ---------- things to do around town ----------
  const canAct = () => s && s.phase === "day" && !s.over && !s.player.out;
  function pickUp(item) { if (!canAct()) return null; const it = sim.pickUp(s, item, ui); save(); return it; }
  async function snoop(owner) { if (!canAct()) return null; const r = await sim.snoop(s, owner, ui); save(); return r; }
  async function postNote(text) { if (!canAct()) return null; const r = await sim.postNote(s, text.slice(0, 300), ui); save(); return r; }
  async function fight(id, how) {
    endTalk();
    const r = await sim.playerFight(s, id, how, ui);
    save();
    return r;
  }

  return {
    dress: (o) => { const r = looks.dress(s, o); if (r.changed) runtime.note({ t: "dress", outfit: o }); save(); return r; },
    bill: (o) => looks.bill(s, o), firstLooks: (opts) => looks.judgeAll(s, ui, opts),
    newSeason, load, save, update, nextDay, startBallots, ballotLines, resolveVote, afterVote, voteSetup, partingShot,
    startTalk, endTalk, say, night, setDaySeconds, pickUp, snoop, postNote, fight, endShow, runTick,
    state: () => s,
    reveal: () => sim.reveal(s),
    busy: () => inflight > 0,
  };
}
