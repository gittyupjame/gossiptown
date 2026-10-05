// The vote night at the firepit: everyone on a stump, the player walks up to cast her
// ballot, the host reads the votes one by one, and someone leaves town for good.

import * as THREE from "three";
import { scene, setTime } from "./scene.js";
import { fireState, fx } from "./town.js";
import * as B from "./bubbles.js";
import * as H from "./hud.js";
import * as L from "./layout.js";
import * as sim from "../core/sim.js";
import * as audio from "./audio.js";

const CENTRE = new THREE.Vector3(L.FIREPIT.x, 0, L.FIREPIT.z);

export async function runVote(ctx) {
  const { game } = ctx;
  const s = game.state();
  const setup = game.voteSetup();
  const { finale, candidates, jury } = setup;
  const first = (id) => sim.firstOf(s, id);
  const torches = [];
  const tallies = {};
  const cleanup = [];

  // ---------- staging ----------
  H.cinema(true);
  await H.fade(true);
  ctx.setNight(true);
  setTime(21.5 * 60, CENTRE);
  fireState.pit = 1;
  B.hushAll();
  const seats = {};
  candidates.forEach((id, i) => {
    const a = (i / candidates.length) * Math.PI * 2 + Math.PI / 2 + 0.35;
    seats[id] = { x: CENTRE.x + Math.cos(a) * 4.4, z: CENTRE.z + Math.sin(a) * 4.4 };
  });
  for (const id of candidates) {
    const w = ctx.walker(id);
    w.stop(); w.frozen = false;
    w.x = seats[id].x; w.z = seats[id].z;
    w.face = { x: CENTRE.x, z: CENTRE.z };
    w.heading = Math.atan2(CENTRE.x - w.x, CENTRE.z - w.z);
    torches.push(makeTorch(id, seats[id]));
  }
  // the jury stands behind the host at the finale
  if (finale) jury.forEach((id, i) => {
    const w = ctx.walker(id, true);
    w.x = L.HOST_SPOT.x - (jury.length - 1) * 0.8 + i * 1.6; w.z = L.HOST_SPOT.z - 2.4;
    w.face = { x: CENTRE.x, z: CENTRE.z }; w.heading = 0;
  });
  const host = ctx.walker("primrose");
  host.x = L.HOST_SPOT.x; host.z = L.HOST_SPOT.z; host.face = { x: CENTRE.x, z: CENTRE.z }; host.heading = 0;
  ctx.cam.orbit(CENTRE, 13, 7.5, 0.12);
  // while the player chooses, Jev casts the cast's ballots and Claude writes each voter's
  // line from her own reasons
  let spoken = {};
  game.startBallots();
  const linesP = game.ballotLines().then((lines) => { spoken = lines || {}; }).catch(() => {});
  await ctx.wait(400);
  await H.fade(false);
  H.voteHud(finale ? "The Finale" : "The Vote", `Night ${s.day}`);

  const hostSay = async (text, ms) => {
    ctx.cam.shot(vec(host.x, 1.6, host.z + 0.1), 5.5, { from: CENTRE });
    await sayAndWait(ctx, "primrose", text, ms);
  };

  await ctx.wait(1600);
  H.voteHud(null);
  if (finale) {
    await hostSay(`Good evening, ladies, and welcome to the finale!`);
    await hostSay(`Three women left. Only one will be crowned the Queen of Gossiptown.`);
    await hostSay(`Tonight the women you sent home get the last word. Jury, your votes please.`);
  } else {
    const n = sim.alive(s).length + (s.player.out ? 0 : 1);
    await hostSay(pick([`Good evening, ladies. Welcome to the firepit.`, `Ladies. Take your seats. You know why we're here.`, `Welcome back to the firepit, my little backstabbers.`]));
    await hostSay(pick([`${n} of you sitting here. A whole day of whispers, pacts and promises.`, `Smiles all day. Knives tonight.`, `I've heard things. Oh, I've heard things.`]));
    await hostSay(`Tonight, one of you leaves Gossiptown for good.`);
  }

  // ---------- the player's ballot ----------
  let playerBallot = null;
  if (!finale && !s.player.out) {
    H.cinema(false);
    H.showHud(false);
    H.voteHud("Cast your vote", "Walk up to the woman you want gone, or pick her card");
    H.tip("vote");
    playerBallot = await ctx.playerPicks(candidates.filter((id) => id !== "player"), seats);
    H.voteHud(null);
    B.say("player", `I vote for ${first(playerBallot)}.`, { name: s.player.name, color: "#e86f5a", you: true, hold: 1.8 });
    B.emote("player", "vote");
    const pw = ctx.walker("player");
    pw.goTo(seats.player.x, seats.player.z);
    await ctx.wait(1600);
    H.cinema(true);
  }

  // ---------- reading the votes ----------
  await hostSay(finale ? "The jury has voted." : "The votes are in.", 1800);
  ctx.cam.orbit(CENTRE, 12, 8, 0.08);
  await Promise.race([linesP, ctx.wait(20000)]);
  const result = await game.resolveVote(playerBallot);
  const pw = ctx.walker("player"); if (seats.player) { pw.stop(); pw.x = seats.player.x; pw.z = seats.player.z; pw.face = { x: CENTRE.x, z: CENTRE.z }; }
  await hostSay(finale ? "When I read your name, you get the jury's vote." : "I'll read them one at a time.", 2000);

  let skipping = false;
  const unsub = ctx.onEnter(() => { skipping = true; });
  H.skip(true, "Enter to skip ahead");
  for (const [ri, round] of result.rounds.entries()) {
    if (ri === 1) {
      const tied = round.among.map(first);
      await hostSay(`It's a tie between ${list(tied)}!`, 2200);
      await hostSay(Object.keys(round.ballots).length ? `Everyone else votes again. Only ${list(tied)} can get votes.` : `Nobody left to break it...`, 2600);
      for (const id of Object.keys(tallies)) { tallies[id].remove(); delete tallies[id]; }
    }
    const order = orderBallots(round.ballots, ri === result.rounds.length - 1 ? (finale ? result.winner : result.out) : null);
    const counts = {};
    for (const [voter, target] of order) {
      counts[target] = (counts[target] || 0) + 1;
      if (!skipping) {
        const vw = ctx.walker(voter, true);
        ctx.cam.shot(vec(vw.x, 1.4, vw.z), 4.2, { from: CENTRE });
        const own = ri === 0 && result.rounds[0].ballots[voter] === target ? spoken[voter] : null;
        // the host reads each ballot; the voter's own line (written from her real reasons) if she has one
        if (voter === "player") B.say("player", `${first(target)}.`, { name: s.player.name, color: "#e86f5a", you: true, hold: 1.2 });
        else if (own) B.say(voter, own, { name: first(voter), color: "#ff6f9c", hold: Math.max(1.4, own.length / 14) });
        else B.say("primrose", `${first(voter)}: ${first(target)}.`, { name: "Primrose", color: "#e8577e", hold: 1.2 });
        // why she really voted that way, straight from her decision
        const why = voter !== "player" && ri === 0 ? result.reasons?.[voter] : null;
        if (why?.length) H.chyron(`${first(voter)}'s reasons: ${why.join("; ")}`, "info");
        await ctx.wait(own ? Math.max(1400, own.length * 45) : 1100);
        await flyBallot(ctx, voter, target);
      }
      setTally(target, counts[target]);
      if (!skipping) {
        const tw = ctx.walker(target);
        ctx.cam.shot(vec(tw.x, 1.4, tw.z), 4.8, { from: CENTRE });
        const wasAlly = !finale && voter !== "player" && target !== "player" && (result.pactBreaks || []).some((b) => b.by === voter && b.of === target);
        const promised = target === "player" && (result.betrayals || []).some((b) => b.by === voter);
        if (target !== "player") {
          ctx.model(target)?.surprise();
          B.emote(target, wasAlly ? "anger" : counts[target] >= 3 ? "sad" : "gasp");
        } else if (promised) {
          H.chyron(`${first(voter)} promised you, and voted for you anyway.`, "bad");
        }
        await ctx.wait(promised || wasAlly ? 1700 : 1100);
      }
    }
    if (ri === 0 && result.rounds.length > 1) await ctx.wait(800);
  }
  unsub();
  H.skip(false);

  // ---------- the result ----------
  const chosen = finale ? result.winner : result.out;
  const total = Object.values(result.rounds.at(-1).ballots).filter((t) => t === chosen).length;
  if (result.drawn) await hostSay(`Still tied! So the fire decides...`, 2400);
  if (finale) {
    audio.sting("drumroll", 2.4);
    await hostSay(`With ${total} vote${total === 1 ? "" : "s"}, the Queen of Gossiptown is...`, 2600);
    const cw = ctx.walker(chosen);
    ctx.cam.shot(vec(cw.x, 1.5, cw.z), 4.5, { from: CENTRE });
    await ctx.wait(900);
    B.emote(chosen, "crown");
    audio.sting(chosen === "player" ? "fanfare" : "good");
    audio.crowd({ loved: 6 });
    confetti(ctx, cw);
    await sayAndWait(ctx, "primrose", `${chosen === "player" ? s.player.name : first(chosen)}!`, 2600);
  } else {
    const ow = ctx.walker(chosen);
    audio.sting("drumroll", 2.6);
    await hostSay(`With ${total} vote${total === 1 ? "" : "s"}...`, 2000);
    ctx.cam.shot(vec(ow.x, 1.5, ow.z), 4.4, { from: CENTRE });
    await ctx.wait(900);
    audio.sting("eliminated");
    await sayAndWait(ctx, "primrose", `${chosen === "player" ? s.player.name : first(chosen)}. The town has spoken.`, 2600);
    snuff(chosen);
    audio.sfx("fizzle");
    if (chosen !== "player") {
      // her last word: a real line, said to everyone, and it counts
      const b = B.thinking(chosen, { name: first(chosen) });
      const got = await game.partingShot(chosen);
      if (got?.line) { b.reveal(got.line); await ctx.wait(Math.max(3200, got.line.length * 55)); }
      b.close();
      // she walks out of the ring and down the path, out of town
      ctx.leave(chosen);
      await ctx.wait(2600);
      if (result.betrayals?.length) for (const bt of result.betrayals) H.chyron(`${first(bt.by)} broke her word to you: she voted for ${bt.voted === "player" ? "YOU" : first(bt.voted)}.`, "bad");
    } else {
      await ctx.wait(1500);
    }
  }
  for (const t of torches) t.remove();
  for (const id of Object.keys(tallies)) tallies[id].remove();
  for (const c of cleanup) c();
  fireState.pit = 0;
  H.cinema(false);
  await H.fade(true);
  ctx.setNight(false);
  return result;

  // ---------- local helpers ----------
  function setTally(id, n) {
    if (!tallies[id]) tallies[id] = B.label(id, `<span>0</span>`, "tally", 0.9);
    tallies[id].el.querySelector("span").textContent = n;
    audio.sfx("tally", { n: Math.min(12, n * 2) });
    tallies[id].el.querySelector("span").style.animation = "none"; void tallies[id].el.offsetWidth; tallies[id].el.querySelector("span").style.animation = "";
  }
  function makeTorch(id, seat) {
    const dir = new THREE.Vector3(seat.x - CENTRE.x, 0, seat.z - CENTRE.z).normalize();
    const p = new THREE.Vector3(seat.x + dir.x * 1.0, 0, seat.z + dir.z * 1.0);
    const g = new THREE.Group(); g.position.copy(p); scene.add(g);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6), new THREE.MeshLambertMaterial({ color: "#5a3e2a" })); pole.position.y = 0.9; g.add(pole);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); fl.position.y = 2.0; fl.scale.setScalar(0.8); g.add(fl);
    let level = 1, t = Math.random() * 10;
    const tick = (dt) => { t += dt; fl.material.opacity = level; fl.scale.set(0.7 + Math.sin(t * 13) * 0.08, 0.9 + Math.sin(t * 9) * 0.12, 1); };
    ctx.everyFrame(tick);
    return { id, remove() { scene.remove(g); ctx.stopFrame(tick); }, snuff() { const f = (dt) => { level = Math.max(0, level - dt * 1.5); }; ctx.everyFrame(f); } };
  }
  function snuff(id) { torches.find((t) => t.id === id)?.snuff(); }
}

function vec(x, y, z) { return new THREE.Vector3(x, y, z); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const list = (a) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

async function sayAndWait(ctx, id, text, ms) {
  const name = id === "primrose" ? "Primrose" : sim.firstOf(ctx.game.state(), id);
  const b = B.say(id, text, { name, color: id === "primrose" ? "#e8577e" : "#ff6f9c", hold: 999 });
  await ctx.waitOrEnter(ms ?? Math.max(2200, 900 + text.length * 45));
  b.close();
  await ctx.wait(200);
}

// Read the votes in an order that keeps it tense: the last vote read is a vote for the loser.
function orderBallots(ballots, last) {
  const entries = Object.entries(ballots).sort(() => Math.random() - 0.5);
  if (last) { const i = entries.findIndex(([, t]) => t === last); if (i >= 0) entries.push(entries.splice(i, 1)[0]); }
  return entries;
}

async function flyBallot(ctx, from, to) {
  const a = ctx.walker(from, true), b = ctx.walker(to);
  const tex = ballotTex();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.6, 0.45, 1);
  scene.add(sp);
  const p0 = new THREE.Vector3(a.x, 1.6, a.z), p1 = new THREE.Vector3(b.x, 2.2, b.z);
  ctx.cam.shot(p0.clone().lerp(p1, 0.5).setY(1.4), 7, { from: CENTRE });
  audio.sfx("whoosh");
  const dur = 900;
  let t = 0;
  await new Promise((resolve) => {
    const tick = (dt) => {
      t += dt * 1000;
      const u = Math.min(1, t / dur);
      sp.position.copy(p0).lerp(p1, u);
      sp.position.y += Math.sin(u * Math.PI) * 2.2;
      sp.material.rotation = u * 6;
      if (u >= 1) { ctx.stopFrame(tick); scene.remove(sp); audio.sfx("thunk"); resolve(); }
    };
    ctx.everyFrame(tick);
  });
}

let _ballot = null;
function ballotTex() {
  if (_ballot) return _ballot;
  const c = document.createElement("canvas"); c.width = 128; c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#fff8ec"; g.strokeStyle = "#e8b4a0"; g.lineWidth = 6;
  g.beginPath(); g.roundRect(8, 8, 112, 80, 12); g.fill(); g.stroke();
  g.fillStyle = "#ff6f9c"; g.beginPath(); g.arc(64, 48, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.font = "bold 20px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("✕", 64, 49);
  _ballot = new THREE.CanvasTexture(c); _ballot.colorSpace = THREE.SRGBColorSpace;
  return _ballot;
}

function confetti(ctx, w) {
  const cols = ["#ff6f9c", "#ffd76a", "#8ad0ff", "#9ae0a8", "#c8a0ff", "#ffffff"];
  const geo = new THREE.PlaneGeometry(0.12, 0.08);
  const bits = [];
  for (let i = 0; i < 180; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
    m.position.set(w.x + (Math.random() - 0.5) * 6, 4 + Math.random() * 4, w.z + (Math.random() - 0.5) * 6);
    m.userData = { vy: -1 - Math.random(), spin: Math.random() * 8, vx: (Math.random() - 0.5) * 0.8 };
    scene.add(m); bits.push(m);
  }
  let life = 0;
  const tick = (dt) => {
    life += dt;
    for (const m of bits) { m.position.y += m.userData.vy * dt; m.position.x += m.userData.vx * dt; m.rotation.x += m.userData.spin * dt; m.rotation.y += dt * 3; }
    if (life > 7) { ctx.stopFrame(tick); for (const m of bits) scene.remove(m); }
  };
  ctx.everyFrame(tick);
}
