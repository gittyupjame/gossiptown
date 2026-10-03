// Gossiptown in the browser: wires the town, the cast, the camera, the controls and the
// screens to the game. The game itself (Jev decisions, Claude words) lives in src/core.

import * as THREE from "three";
import { renderer, camera, setTime, updateSky, resize, env } from "./scene.js";
import { buildTown, updateTown, setClockHands } from "./town.js";
import { makeCharacter, Walker, portraits, turn } from "./people.js";
import * as B from "./bubbles.js";
import * as H from "./hud.js";
import * as L from "./layout.js";
import { initBoard, render as renderBoard } from "./tracker.js";
import { runVote } from "./vote.js";
import { createGame, hasSave } from "../core/game.js";
import * as sim from "../core/sim.js";
import * as jev from "../core/jev.js";
import * as voice from "../core/voice.js";
import { VILLAGERS, HOST, PLAYER_LOOK, PLACES } from "../core/cast.js";

const $ = H.$;
const scene = (await import("./scene.js")).scene;

// ---------- settings ----------

const SETTINGS_KEY = "gossiptown.settings.v1";
const settings = (() => { try { return { daySeconds: 300, jevKey: "", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { daySeconds: 300, jevKey: "" }; } })();
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };
let serverJev = false;

async function connect() {
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    if (r.ok) { const h = await r.json(); serverJev = !!h.jev; }
  } catch {}
  if (serverJev) jev.configure({ proxy: "api/jev" });
  else if (settings.jevKey) jev.configure({ key: settings.jevKey });
  else jev.configure({});
}

// ---------- the world ----------

$("world").appendChild(renderer.domElement);
resize();
window.addEventListener("resize", resize);
buildTown();

const people = {}; // id -> { model, walker, inside, gone }
function addPerson(id, look, opts, x, z) {
  const model = makeCharacter(look, opts);
  scene.add(model.root);
  const walker = new Walker(model, { x, z, speed: 1.15 * (opts.speed || 1) });
  people[id] = { id, model, walker, inside: false, gone: false };
  B.setAnchor(id, () => model.root.position.clone().setY(model.height + 0.12));
  return people[id];
}
for (const v of VILLAGERS) { addPerson(v.id, v.look, { idle: v.idle, speed: v.speed }, 0, 0); B.tag(v.id, v.name.split(" ")[0]); }
addPerson(HOST.id, HOST.look, { idle: "chatter" }, -36, -3);
B.tag(HOST.id, "Primrose");
const me = addPerson("player", PLAYER_LOOK, { idle: "none" }, L.PLAYER_START.x, L.PLAYER_START.z);
me.walker.speedBase = 3.2;
const pics = portraits([...VILLAGERS, { id: "player", look: PLAYER_LOOK }, { id: HOST.id, look: HOST.look }]);

// ---------- state ----------

let mode = "title"; // title | intro | play | vote | night | end
let paused = false;
let game = null;
let talk = null; // { id, bubble, busy }
let gameTime = 0;
const frameFns = new Set();
const timers = new Set();
const enterFns = new Set();
const keys = new Set();
let forceNight = false;
const FAST = new URLSearchParams(location.search).has("fast") ? 8 : 1; // test speed-up
if (FAST > 1) { renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); }

const S = () => game?.state();
const first = (id) => (id === "player" ? S()?.player.name : id === HOST.id ? "Primrose" : S()?.people[id]?.name.split(" ")[0] || id);
const frozen = () => paused || H.tipShowing() || H.isOpen("board") || H.isOpen("settings");

function wait(ms) { return new Promise((resolve) => timers.add({ left: ms, resolve })); }
function waitOrEnter(ms) {
  return new Promise((resolve) => {
    const t = { left: ms, resolve: () => { enterFns.delete(fn); resolve(); } };
    const fn = () => { timers.delete(t); enterFns.delete(fn); resolve(); };
    timers.add(t); enterFns.add(fn);
  });
}

// ---------- camera ----------

const cam = {
  mode: "follow", pos: new THREE.Vector3(0, 20, 30), look: new THREE.Vector3(), wantPos: new THREE.Vector3(), wantLook: new THREE.Vector3(),
  orbitC: null, orbitR: 12, orbitH: 7, orbitSpeed: 0.1, orbitA: 0, snap: false, zoom: 1,
  follow() { this.mode = "follow"; },
  orbit(c, r, h, speed) { this.mode = "orbit"; this.orbitC = c.clone(); this.orbitR = r; this.orbitH = h; this.orbitSpeed = speed; },
  shot(target, dist, { from = null, height = 1.0, snap = false } = {}) {
    this.mode = "shot";
    const dir = from ? new THREE.Vector3(from.x - target.x, 0, from.z - target.z).normalize() : new THREE.Vector3(0, 0, 1);
    this.wantPos.set(target.x + dir.x * dist, target.y + height, target.z + dir.z * dist);
    this.wantLook.copy(target);
    if (snap) { this.pos.copy(this.wantPos); this.look.copy(this.wantLook); }
  },
  update(dt) {
    const p = me.walker;
    if (this.mode === "follow") {
      let tx = p.x, tz = p.z, d = 15.5 * this.zoom, hgt = 12.5 * this.zoom;
      if (talk) { const o = people[talk.id].walker; tx = (p.x + o.x) / 2; tz = (p.z + o.z) / 2; d = 8.5; hgt = 5.6; }
      this.wantPos.set(tx, hgt, tz + d);
      this.wantLook.set(tx, 1.0, tz - 0.5);
    } else if (this.mode === "orbit") {
      this.orbitA += dt * this.orbitSpeed;
      this.wantPos.set(this.orbitC.x + Math.cos(this.orbitA) * this.orbitR, this.orbitH, this.orbitC.z + Math.sin(this.orbitA) * this.orbitR);
      this.wantLook.copy(this.orbitC).setY(1.2);
    }
    const k = this.mode === "shot" ? 3 : this.mode === "orbit" ? 2 : 4.5;
    this.pos.lerp(this.wantPos, Math.min(1, dt * k));
    this.look.lerp(this.wantLook, Math.min(1, dt * k * 1.2));
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  },
};

// ---------- villagers following the sim ----------

const takenSpots = () => Object.values(people).map((p) => p.walker.dest).filter(Boolean);

function sendTo(v) {
  const p = people[v.id];
  if (!p || p.gone) return;
  if (v.location === "home") {
    const d = L.homeDoor(v.id);
    if (p.inside) return;
    p.walker.goTo(d.x, d.z);
    p.goingHome = true;
  } else {
    if (p.inside) emerge(v.id);
    p.goingHome = false;
    const spot = L.spotFor(v.location, takenSpots());
    p.walker.goTo(spot.x, spot.z);
  }
  p.walker.face = null;
}
function emerge(id) {
  const p = people[id];
  const d = L.homeDoor(id);
  p.inside = false;
  p.walker.x = d.x; p.walker.z = d.z;
  p.model.root.visible = true;
}
function goInside(id) {
  const p = people[id];
  p.inside = true; p.goingHome = false;
  p.model.root.visible = false;
  B.tagState(id, { show: false });
}
function placeNow(v) {
  const p = people[v.id];
  if (v.gone) { p.gone = true; p.model.root.visible = false; B.tagState(v.id, { show: false }); return; }
  p.gone = false;
  if (v.location === "home") { const d = L.homeDoor(v.id); p.walker.x = d.x; p.walker.z = d.z; goInside(v.id); return; }
  p.inside = false; p.model.root.visible = true;
  const spot = L.spotFor(v.location, takenSpots());
  p.walker.x = spot.x; p.walker.z = spot.z; p.walker.stop(); p.walker.dest = spot;
}

// conversations the player overhears play out as bubbles over their heads
const exchangeQueue = new Map(); // pair key -> busy
async function playExchange({ a, b, lines, full }) {
  const key = [a, b].sort().join("|");
  if (exchangeQueue.has(key)) return;
  exchangeQueue.set(key, true);
  const pa = people[a].walker, pb = people[b].walker;
  for (let i = 0; i < 40 && (pa.moving || pb.moving); i++) await wait(150);
  pa.face = { x: pb.x, z: pb.z }; pb.face = { x: pa.x, z: pa.z };
  people[a].model.lookAt(pb.model?.root?.position || pb); people[b].model.lookAt(pa.model?.root?.position || pa);
  H.tip("overheard");
  for (const l of lines) {
    if (!people[l.id] || people[l.id].gone) continue;
    const bubble = B.say(l.id, l.text, { name: first(l.id), color: colorOf(l.id), muffled: !full });
    const ms = Math.max(1800, 700 + l.text.length * 55);
    await wait(ms);
    if (!bubble.dead) bubble.close();
    await wait(220);
  }
  people[a].model.lookAt(null); people[b].model.lookAt(null);
  exchangeQueue.delete(key);
}
const colorOf = (id) => (id === "player" ? "#e86f5a" : { celeste: "#ff6f9c", odette: "#8a5ac8", wren: "#e0663a", sylvie: "#a03a5a", marigold: "#d8962a", pippa: "#3a7ad6", brenna: "#8a5a3a", juniper: "#7a5ad8", hesper: "#34406a", tansy: "#2a9a90", primrose: "#e8577e" }[id] || "#ff6f9c");

// ---------- hooks the game calls ----------

const ui = {
  moved: (v) => sendTo(v),
  pair(a, b) {
    const pa = people[a.id], pb = people[b.id];
    if (!pa || !pb || pa.inside || pb.inside) return;
    const t = pa.walker.dest || { x: pa.walker.x, z: pa.walker.z };
    for (const [dx, dz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1], [0.8, 0.8], [-0.8, -0.8]]) {
      if (!L.solidAt(t.x + dx, t.z + dz, 0.35)) { pb.walker.goTo(t.x + dx, t.z + dz); pb.walker.dest = { x: t.x + dx, z: t.z + dz }; break; }
    }
  },
  hearing(a, b) {
    const pa = people[a.id]?.walker, pb = people[b.id]?.walker;
    if (!pa || !pb || people[a.id].inside || people[b.id].inside) return "none";
    const ta = pa.dest || pa, tb = pb.dest || pb;
    const d = Math.min(Math.hypot((pa.x + pb.x) / 2 - me.walker.x, (pa.z + pb.z) / 2 - me.walker.z), Math.hypot((ta.x + tb.x) / 2 - me.walker.x, (ta.z + tb.z) / 2 - me.walker.z));
    return d <= 6.5 ? "full" : d <= 13 ? "part" : "none";
  },
  distance(v) { const p = people[v.id]; if (!p || p.inside || p.gone) return 999; return Math.hypot(p.walker.x - me.walker.x, p.walker.z - me.walker.z); },
  exchange: (e) => playExchange(e),
  headline: (text, kind) => H.chyron(text, kind),
  emote: (id, kind) => { if (people[id] && !people[id].inside) B.emote(id, kind); },
  fight(a, b) {
    const pa = people[a].walker, pb = people[b].walker;
    const dx = pb.x - pa.x, dz = pb.z - pa.z, d = Math.hypot(dx, dz) || 1;
    for (const [w, s] of [[pa, -1], [pb, 1]]) { const nx = w.x + (dx / d) * s * 0.9, nz = w.z + (dz / d) * s * 0.9; if (!L.solidAt(nx, nz, 0.3)) { w.x = nx; w.z = nz; } }
    if (Math.hypot(pa.x - me.walker.x, pa.z - me.walker.z) < 15) H.tip("fight");
  },
  approach: (v, line, purpose) => walkUp(v, line, purpose),
  first(kind) {
    const map = { rumor: "rumor", told: "told", alliance: "alliance", "alliance-overheard": "alliance-overheard", "vote-pitch": "vote-pitch", caught: "caught", talk: "talk" };
    if (map[kind]) H.tip(map[kind]);
  },
  heard() { H.toast("☕ New tea on your Gossip Board (Tab)"); boardBadge(); },
  clock: () => {},
  bell() {
    H.chyron("The bell is ringing. Everyone to the firepit at sundown!", "vote");
    B.emote(HOST.id, "bell");
    H.tip("bell");
  },
  voteNight: () => startVote(),
  nightStart: () => {},
  nightDone: (s, lines) => showNight(s, lines),
};

let unseen = 0;
function boardBadge(reset = false) {
  unseen = reset ? 0 : unseen + 1;
  $("btn-board").innerHTML = `☕ Gossip Board${unseen ? ` <span class="badge">${unseen}</span>` : ""} <kbd>Tab</kbd>`;
}

// ---------- someone walks up to you ----------

async function walkUp(v, line, purpose) {
  const p = people[v.id];
  if (!p || p.inside || talk || mode !== "play") return;
  const w = p.walker;
  for (let i = 0; i < 60; i++) {
    if (talk || mode !== "play") return;
    const d = Math.hypot(w.x - me.walker.x, w.z - me.walker.z);
    if (d < 1.8) break;
    if (i % 6 === 0) {
      const ang = Math.atan2(w.x - me.walker.x, w.z - me.walker.z);
      w.goTo(me.walker.x + Math.sin(ang) * 1.3, me.walker.z + Math.cos(ang) * 1.3);
    }
    await wait(250);
  }
  if (talk || mode !== "play" || Math.hypot(w.x - me.walker.x, w.z - me.walker.z) > 3.5) return;
  w.stop();
  H.tip("approach");
  B.emote(v.id, "wave");
  startTalk(v.id, line);
}

// ---------- talking ----------

function startTalk(id, opener = null) {
  const s = S();
  if (talk || !s || mode !== "play") return;
  if (!game.startTalk(id)) return;
  const p = people[id];
  p.walker.stop(); p.walker.frozen = true;
  p.walker.face = me.walker;
  p.model.lookAt(me.model.root.position);
  me.model.lookAt(p.model.root.position);
  talk = { id, busy: false, bubble: null };
  if (opener) B.say(id, opener, { name: first(id), color: colorOf(id), hold: 6 });
  else if (!S().player.convo?.lines.length) B.say(id, voice.phrase.hi(s.people[id]), { name: first(id), color: colorOf(id), hold: 3 });
  openTyping();
}

function openTyping() {
  if (!talk) return;
  talk.bubble = B.typing("player", {
    name: S().player.name,
    placeholder: `Say something to ${first(talk.id)}…`,
    onSubmit: (text) => sayLine(text),
    onCancel: () => endTalk(true),
  });
}

async function sayLine(text) {
  if (!talk || talk.busy) return;
  const id = talk.id;
  talk.busy = true;
  talk.bubble?.close(); talk.bubble = null;
  B.say("player", text, { name: S().player.name, color: colorOf("player"), you: true, hold: 2.5 });
  const think = B.thinking(id, { name: first(id), color: colorOf(id) });
  let revealed = false;
  const res = await game.say(text, (partial) => { if (!revealed) { think.reveal(partial); revealed = true; } else think.set(partial); });
  if (!res) { think.close(); talk && (talk.busy = false); return; }
  if (!revealed) think.reveal(res.reply); else think.set(res.reply);
  if (!talk || talk.id !== id) return;
  talk.busy = false;
  if (res.leaving) {
    await wait(Math.max(1500, res.reply.length * 40));
    endTalk(false);
    return;
  }
  await wait(500);
  if (talk && talk.id === id) openTyping();
}

function endTalk(sayBye) {
  if (!talk) return;
  const id = talk.id;
  talk.bubble?.close();
  const p = people[id];
  if (sayBye) {
    B.say("player", pick(["See you around!", "Gotta run!", "Bye for now!", "Talk later!"]), { name: S().player.name, color: colorOf("player"), you: true, hold: 1.4 });
    setTimeout(() => { if (!p.inside) B.say(id, voice.phrase.bye(S().people[id]), { name: first(id), color: colorOf(id), hold: 1.6 }); }, 500);
  }
  p.walker.frozen = false;
  p.walker.face = null;
  p.model.lookAt(null); me.model.lookAt(null);
  game.endTalk();
  talk = null;
  document.getElementById("speech").blur();
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- the player walking ----------

function nearestVillager(maxD) {
  let best = null, bd = maxD;
  for (const v of sim.alive(S())) {
    const p = people[v.id];
    if (p.inside || p.gone) continue;
    const d = Math.hypot(p.walker.x - me.walker.x, p.walker.z - me.walker.z);
    if (d < bd) { bd = d; best = v.id; }
  }
  return best;
}

function movePlayer(dt, bound = null) {
  let mx = 0, mz = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW")) mz -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) mz += 1;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) mx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) mx += 1;
  const w = me.walker;
  let speed = 0;
  if (mx || mz) {
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
    const sp = 4.2;
    const step = (nx, nz) => {
      if (L.solidAt(nx, nz, 0.35)) return false;
      if (bound && !bound(nx, nz)) return false;
      for (const p of Object.values(people)) if (p !== me && !p.inside && !p.gone && p.model.root.visible && Math.hypot(p.walker.x - nx, p.walker.z - nz) < 0.6) return false;
      return true;
    };
    const nx = w.x + mx * sp * dt, nz = w.z + mz * sp * dt;
    if (step(nx, nz)) { w.x = nx; w.z = nz; } else if (step(nx, w.z)) w.x = nx; else if (step(w.x, nz)) w.z = nz;
    w.heading = turn(w.heading, Math.atan2(mx, mz), dt * 12);
    speed = sp;
    w.path = [];
  }
  return speed;
}

// ---------- the main loop ----------

let last = performance.now();
let brainT = 0, barkT = 6, saveT = 0;
function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const fz = frozen();
  const dt = fz ? 0 : rawDt * FAST;
  if (!fz) {
    gameTime += dt;
    for (const t of [...timers]) { t.left -= dt * 1000; if (t.left <= 0) { timers.delete(t); t.resolve(); } }
    for (const fn of [...frameFns]) fn(dt);
  }
  const s = S();
  if (mode === "play" && s && !fz) {
    game.update(dt);
    let pv = 0;
    pv = movePlayer(dt);
    if (talk) {
      const o = people[talk.id].walker;
      const d = Math.hypot(o.x - me.walker.x, o.z - me.walker.z);
      if (d > 4.5) endTalk(false);
      else if (!pv) me.walker.heading = turn(me.walker.heading, Math.atan2(o.x - me.walker.x, o.z - me.walker.z), dt * 6);
    }
    me.model.root.position.set(me.walker.x, 0, me.walker.z);
    me.model.root.rotation.y = me.walker.heading;
    me.walker.v += (pv - me.walker.v) * Math.min(1, dt * 12);
    me.model.update(dt, gameTime, { speed: me.walker.v, talking: B.isTalking("player") });
    s.player.location = L.placeAt(me.walker.x, me.walker.z);
    if ((saveT += dt) > 2) { saveT = 0; s.player.pos = { x: me.walker.x, z: me.walker.z }; }
    // ambient barks from idle women nearby
    if ((barkT -= dt) < 0) {
      barkT = 7 + Math.random() * 9;
      const cands = sim.alive(s).filter((v) => { const p = people[v.id]; return !p.inside && !p.walker.moving && !B.hasBubble(v.id) && v.id !== talk?.id && Math.hypot(p.walker.x - me.walker.x, p.walker.z - me.walker.z) < 14; });
      if (cands.length) { const v = pick(cands); B.say(v.id, pick(voice.BARKS[v.id] || ["Hm."]), { name: first(v.id), color: colorOf(v.id), muffled: true, hold: 1.8 }); }
    }
  }
  // everyone else walks
  const ws = Object.values(people).filter((p) => !p.inside && !p.gone && p.model.root.visible).map((p) => p.walker);
  if (!fz) for (const p of Object.values(people)) {
    if (p === me && mode === "play") continue;
    if (p.inside || p.gone) continue;
    const v = s?.people[p.id];
    p.walker.update(dt, gameTime, ws, { talking: B.isTalking(p.id), anger: v ? Math.min(1, v.mood.anger / 2) : 0 });
    if (p.goingHome && !p.walker.moving) goInside(p.id);
  }
  // tags and what Enter would do
  if (mode === "play" && s) {
    const near = talk ? null : nearestVillager(2.4);
    for (const v of VILLAGERS) {
      const p = people[v.id];
      const d = Math.hypot(p.walker.x - me.walker.x, p.walker.z - me.walker.z);
      B.tagState(v.id, { show: !p.inside && !p.gone && d < 10 && !(talk && talk.id === v.id), near: near === v.id });
    }
    B.tagState(HOST.id, { show: Math.hypot(people[HOST.id].walker.x - me.walker.x, people[HOST.id].walker.z - me.walker.z) < 8 });
    H.hint(near ? `<kbd>Enter</kbd> talk to ${first(near)}` : "");
    H.updateHud(s, placeTitle(s.player.location));
    setClockHands(s.minute);
  } else if (mode !== "vote") { for (const v of VILLAGERS) B.tagState(v.id, { show: false }); B.tagState(HOST.id, { show: false }); if (mode !== "play") H.hint(""); }
  // light and sky
  const minute = forceNight ? 21.5 * 60 : mode === "title" ? 17.8 * 60 : s ? s.minute : 9 * 60;
  setTime(minute, { x: cam.pos.x, z: cam.pos.z - 14 });
  if (!fz) { updateSky(dt); updateTown(gameTime, dt, env.night); }
  if ((brainT -= rawDt) < 0) { brainT = 1; H.setBrain(jev.status(), voice.voiceStatus()); }
  cam.update(fz ? 0 : rawDt);
  B.frame(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
const placeTitle = (loc) => (PLACES[loc] ? PLACES[loc].name.replace(/^the /, "The ") : "The lanes");

// ---------- input ----------

window.addEventListener("keydown", (e) => {
  if (e.target.id === "name-in" || e.target.id === "set-jev-key") return;
  if (e.code === "Tab") { e.preventDefault(); toggleBoard(); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    if (H.tipShowing()) { H.dismissTip(); return; }
    if (H.isOpen("board")) return;
    if (H.isOpen("nightcard")) { $("night-ok").click(); return; }
    if (H.isOpen("endcard")) return;
    if (enterFns.size && !paused) { for (const fn of [...enterFns]) fn(); return; }
    if (mode === "play" && !talk && !paused) { const id = nearestVillager(2.4); if (id) startTalk(id); }
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") {
    if (e.code === "Escape" && H.isOpen("board")) { toggleBoard(false); return; }
    if (e.code === "Escape" && H.isOpen("settings")) { closeSettings(); return; }
    if (mode !== "title" && mode !== "end") setPaused(!paused);
    return;
  }
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => { if (document.hidden && mode !== "title" && mode !== "end") setPaused(true); });
window.addEventListener("toggle-tracker", () => toggleBoard());
window.addEventListener("tip-closed", () => { if (talk?.bubble) talk.bubble.focus(); });

function setPaused(on) {
  paused = on;
  H.screen("pause", on);
  $("btn-pause").textContent = on ? "▶" : "❚❚";
  if (on) keys.clear();
  else if (talk?.bubble) talk.bubble.focus();
}
$("btn-pause").onclick = () => setPaused(!paused);
$("p-resume").onclick = () => setPaused(false);
$("p-title").onclick = () => { setPaused(false); toTitle(); };
$("p-settings").onclick = () => openSettings();

function toggleBoard(force) {
  if (!S() || mode === "title" || mode === "intro") return;
  const on = force ?? !H.isOpen("board");
  H.screen("board", on);
  if (on) { renderBoard(); boardBadge(true); H.tip("tracker"); keys.clear(); }
  else if (talk?.bubble) talk.bubble.focus();
}
$("btn-board").onclick = () => toggleBoard();
$("board-close").onclick = () => toggleBoard(false);
initBoard(S, pics);

// ---------- settings screen ----------

function openSettings() {
  $("set-jev-key").value = settings.jevKey || "";
  $("set-jev-key").parentElement && ($("set-jev-key").style.display = serverJev ? "none" : "");
  document.querySelector(".set-label").style.display = serverJev ? "none" : "";
  const js = jev.status();
  $("set-jev-status").textContent = serverJev ? "Jev, through the game server" : js.live ? `Jev is connected (${js.why})` : `Offline stand-in. ${js.why}. Paste a Jev key below to use the real Jev.`;
  const vs = voice.voiceStatus();
  $("set-voice-status").textContent = vs.label === "Phrasebook" ? "A built-in phrasebook (Claude isn't reachable from this page)" : `${vs.label}`;
  for (const b of document.querySelectorAll("#set-day button")) b.classList.toggle("on", +b.dataset.v === settings.daySeconds);
  H.screen("settings", true);
}
function closeSettings() {
  const key = $("set-jev-key").value.trim();
  if (key !== settings.jevKey) { settings.jevKey = key; saveSettings(); if (!serverJev) jev.configure(key ? { key } : {}); }
  H.screen("settings", false);
}
for (const b of document.querySelectorAll("#set-day button")) b.onclick = () => { settings.daySeconds = +b.dataset.v; saveSettings(); for (const x of document.querySelectorAll("#set-day button")) x.classList.toggle("on", x === b); if (game) game.setDaySeconds?.(settings.daySeconds); };
$("set-ok").onclick = closeSettings;
$("t-settings").onclick = openSettings;

// ---------- title, intro, days ----------

function newGameObject() {
  game = createGame(ui, { daySeconds: settings.daySeconds });
}

function toTitle() {
  mode = "title";
  endTalk(false);
  B.hushAll();
  H.showHud(false);
  for (const id of ["nightcard", "endcard", "board", "pause"]) H.screen(id, false);
  H.screen("title", true);
  $("t-continue").style.display = hasSave() ? "" : "none";
  cam.orbit(new THREE.Vector3(0, 0, -4), 34, 17, 0.05);
  // a pretty town for the title: everyone out and about
  for (const v of VILLAGERS) { const p = people[v.id]; p.gone = false; p.inside = false; p.model.root.visible = true; const sp = L.spotFor(pick(["plaza", "market", "tavern", "bakery", "salon"]), takenSpots()); p.walker.x = sp.x; p.walker.z = sp.z; p.walker.dest = sp; p.walker.stop(); }
}

$("t-new").onclick = () => {
  H.screen("title", false);
  H.screen("namecard", true);
  $("name-in").value = "";
  setTimeout(() => $("name-in").focus(), 50);
};
$("name-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("name-ok").click(); } e.stopPropagation(); });
$("name-ok").onclick = () => {
  const name = ($("name-in").value.trim() || "Rosie").replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, 16) || "Rosie";
  H.screen("namecard", false);
  H.resetTips();
  newGameObject();
  game.newSeason(name);
  intro();
};
$("t-continue").onclick = () => {
  newGameObject();
  if (!game.load()) { toTitle(); return; }
  H.screen("title", false);
  resume();
};
$("end-new").onclick = () => { try { localStorage.removeItem("gossiptown.season.v2"); } catch {} H.screen("endcard", false); toTitle(); };

async function intro() {
  mode = "intro";
  const s = S();
  // the welcome party in the plaza
  const arc = VILLAGERS.map((v, i) => { const a = Math.PI * (1.12 + (i / (VILLAGERS.length - 1)) * 0.76); return { id: v.id, x: Math.cos(a) * 6.4, z: Math.sin(a) * 6.4 + 1.2 }; });
  for (const a of arc) { const p = people[a.id]; p.inside = false; p.gone = false; p.model.root.visible = true; p.walker.x = a.x; p.walker.z = a.z; p.walker.stop(); p.walker.face = { x: 0, z: 6.5 }; p.walker.heading = Math.atan2(-a.x, 6.5 - a.z); s.people[a.id].location = "plaza"; }
  const host = people[HOST.id].walker;
  host.x = -1.6; host.z = 4.2; host.stop(); host.face = { x: 0, z: 8 };
  me.walker.x = 0.6; me.walker.z = 8.4; me.walker.heading = Math.PI;
  me.model.root.position.set(me.walker.x, 0, me.walker.z); me.model.root.rotation.y = Math.PI;
  H.cinema(true);
  cam.shot(new THREE.Vector3(-0.5, 1.4, 6), 7, { from: new THREE.Vector3(0, 0, 20), height: 1.6, snap: true });
  await H.fade(false);
  H.skip(true);
  const hostSay = async (text, ms) => {
    const b = B.say(HOST.id, text, { name: "Primrose", color: colorOf(HOST.id), hold: 999 });
    await waitOrEnter(ms ?? Math.max(2800, 1200 + text.length * 48));
    b.close();
    await wait(180);
  };
  await hostSay(`Welcome to Gossiptown, sweetie! The coziest little town with the sharpest little knives.`);
  await hostSay(`I'm Primrose, your host. Ten women live here, and every three days, at the firepit, they vote one of their own out of town.`);
  cam.shot(new THREE.Vector3(0.6, 1.4, 8.4), 4.5, { from: new THREE.Vector3(0, 0, 0), height: 1.2 });
  await hostSay(`And now there's you, ${s.player.name}. The new girl. Nobody here trusts you. Yet.`);
  await hostSay(`Make friends. Make secret pacts. Spread a little gossip. Just don't get voted out.`);
  await hostSay(`The last three standing face a jury of every woman they sent home. Win, and you're the Queen of Gossiptown!`);
  await hostSay(`Now, let me introduce the ladies...`, 2200);
  for (const v of VILLAGERS) {
    const w = people[v.id].walker;
    cam.shot(new THREE.Vector3(w.x, 1.35, w.z), 3.6, { from: new THREE.Vector3(0, 0, 7), height: 0.5 });
    await wait(450);
    H.lowerThird(v, pics[v.id]);
    people[v.id].model.surprise();
    const b = B.say(v.id, v.quote, { name: first(v.id), color: colorOf(v.id), hold: 999 });
    await waitOrEnter(3400);
    b.close();
    H.lowerThird(null);
    await wait(250);
  }
  cam.shot(new THREE.Vector3(-1.6, 1.4, 4.2), 5, { from: new THREE.Vector3(0, 0, 14), height: 1.4 });
  await hostSay(`Day one starts now. Good luck, ${s.player.name}. You'll need it!`, 3000);
  H.skip(false);
  H.cinema(false);
  host.goTo(-37, -2.4);
  for (const p of Object.values(people)) p.walker.face = null;
  startPlay();
  H.tip("welcome");
}

function startPlay() {
  mode = "play";
  H.showHud(true);
  cam.follow();
  cam.pos.set(me.walker.x, 14, me.walker.z + 16);
}

function resume() {
  const s = S();
  for (const v of Object.values(s.people)) placeNow(v);
  const pos = s.player.pos || L.PLAYER_START;
  me.walker.x = pos.x; me.walker.z = pos.z;
  const host = people[HOST.id].walker; host.x = -37; host.z = -2.4;
  if (s.phase === "night") { mode = "night"; game.night(); return; }
  if (s.phase === "vote") { startPlay(); startVote(); return; }
  if (s.over) { showEnd(); return; }
  startPlay();
  H.fade(false);
}

// ---------- vote night ----------

const voteCtx = {
  get game() { return game; },
  walker(id, revive = false) {
    const p = people[id];
    if (revive && (p.gone || p.inside)) { p.gone = false; p.inside = false; p.model.root.visible = true; p.revived = true; }
    if (p.inside) { p.inside = false; p.model.root.visible = true; }
    return p.walker;
  },
  model: (id) => people[id]?.model,
  cam, wait, waitOrEnter,
  onEnter(fn) { enterFns.add(fn); return () => enterFns.delete(fn); },
  everyFrame(fn) { frameFns.add(fn); },
  stopFrame(fn) { frameFns.delete(fn); },
  setNight(on) { forceNight = on; },
  leave(id) {
    const p = people[id];
    p.walker.goTo(-14, -28);
    setTimeout(() => { p.walker.goTo(0, -12); }, 0);
    let t = 0;
    const fn = (dt) => { t += dt; if (t > 2.4) { p.gone = true; p.model.root.visible = false; B.tagState(id, { show: false }); frameFns.delete(fn); } };
    frameFns.add(fn);
  },
  playerPicks(cands, seats) {
    return new Promise((resolve) => {
      mode = "vote-pick";
      let chosen = null, confirm = null;
      const bound = (x, z) => { const d = Math.hypot(x - L.FIREPIT.x, z - L.FIREPIT.z); return d < 5.2 && d > 2.0; };
      cam.mode = "follow";
      const tick = (dt) => {
        const pv = movePlayer(dt, bound);
        me.model.root.position.set(me.walker.x, 0, me.walker.z);
        me.model.root.rotation.y = me.walker.heading;
        me.walker.v += (pv - me.walker.v) * Math.min(1, dt * 12);
        me.model.update(dt, gameTime, { speed: me.walker.v });
        let best = null, bd = 2.0;
        for (const id of cands) { const w = people[id].walker; const d = Math.hypot(w.x - me.walker.x, w.z - me.walker.z); if (d < bd) { bd = d; best = id; } }
        for (const id of cands) { people[id].model.ring.visible = id === best; B.tagState(id, { show: true, near: id === best }); }
        if (best !== chosen) { chosen = best; confirm = null; }
        H.hint(chosen ? (confirm ? `<kbd>Enter</kbd> again to vote out <b>${first(chosen)}</b>` : `<kbd>Enter</kbd> vote for ${first(chosen)}`) : "Walk up to the woman you want gone");
      };
      frameFns.add(tick);
      const onEnter = () => {
        if (!chosen) return;
        if (confirm !== chosen) { confirm = chosen; B.say("player", `${first(chosen)}...?`, { name: S().player.name, color: colorOf("player"), you: true, hold: 1.5 }); return; }
        frameFns.delete(tick); enterFns.delete(onEnter);
        for (const id of cands) { people[id].model.ring.visible = false; B.tagState(id, { show: false }); }
        H.hint("");
        mode = "vote";
        resolve(chosen);
      };
      enterFns.add(onEnter);
    });
  },
};

async function startVote() {
  mode = "vote";
  endTalk(false);
  H.showHud(false);
  H.hint("");
  B.hushAll();
  const result = await runVote(voteCtx);
  for (const p of Object.values(people)) { if (p.revived) { p.revived = false; } p.walker.face = null; }
  const s = S();
  for (const v of Object.values(s.people)) if (v.gone) { const p = people[v.id]; p.gone = true; p.model.root.visible = false; }
  if (s.over) { showEnd(result); return; }
  mode = "night";
  game.afterVote();
}

// ---------- night and morning ----------

function showNight(s, lines) {
  mode = "night";
  endTalk(false);
  H.showHud(false);
  const today = s.player.heard.filter((h) => h.day === s.day).length;
  const told = s.player.told.filter((t) => t.day === s.day).length;
  const lastVote = s.votes.at(-1);
  $("night-kicker").textContent = `End of day ${s.day}`;
  $("night-title").textContent = lastVote?.day === s.day ? `${sim.nameOf(s, lastVote.out)} has left Gossiptown.` : "The town goes to bed...";
  const rows = lines.map((l) => `<div class="nb-line"><span class="ic">${/quit|fired/.test(l) ? "💼" : "🌙"}</span><span>${l}</span></div>`).join("");
  $("night-body").innerHTML = `${rows || `<div class="nb-recap">A quiet night. Or so it seems. Somewhere, someone is plotting.</div>`}
    <div class="nb-recap">Today you heard <b>${today}</b> new rumor${today === 1 ? "" : "s"} and started <b>${told}</b>.</div>
    <div class="nb-recap">${sim.daysToVote({ ...s, day: s.day + 1 }) === 0 ? "🔥 Tomorrow night is a vote." : `Next vote in ${sim.daysToVote({ ...s, day: s.day + 1 })} days.`}</div>`;
  $("night-ok").innerHTML = `Start Day ${s.day + 1} <kbd>Enter</kbd>`;
  H.fade(false);
  H.screen("nightcard", true);
  H.tip("night");
}
$("night-ok").onclick = async () => {
  if (!H.isOpen("nightcard") || H.tipShowing()) return;
  H.screen("nightcard", false);
  await H.fade(true);
  game.nextDay();
  const s = S();
  for (const v of Object.values(s.people)) placeNow(v);
  const d = L.homeDoor("player");
  me.walker.x = d.x; me.walker.z = d.z; me.walker.heading = Math.PI / 2 * -1;
  const host = people[HOST.id].walker; host.x = -37; host.z = -2.4; host.stop();
  startPlay();
  await H.fade(false);
  H.chyron(`Day ${s.day}. ${sim.isVoteDay(s) ? "Tonight is a vote!" : `${sim.daysToVote(s)} day${sim.daysToVote(s) > 1 ? "s" : ""} until the next vote.`}`, sim.isVoteDay(s) ? "vote" : "info");
};

function showEnd(result) {
  mode = "end";
  const s = S();
  H.showHud(false);
  const won = s.over?.won;
  const finale = s.over?.reason === "finale";
  $("end-kicker").textContent = finale ? "The finale" : `Day ${s.day}`;
  $("end-title").textContent = won ? `👑 Queen of Gossiptown!` : finale ? `So close. ${sim.nameOf(s, s.over.winner)} won.` : `You've been voted out.`;
  const myRoots = new Set(s.player.told.map((t) => t.rid));
  let reach = 0;
  for (const v of Object.values(s.people)) if (Object.keys(v.knows).some((rid) => s.rumors[rid]?.origin === "player" && v.knows[rid].conf >= 0.5)) reach++;
  const betrayals = s.votes.flatMap((v) => v.betrayals || []);
  const last = s.votes.at(-1);
  const against = last ? Object.entries(last.ballots).filter(([, t]) => t === "player").map(([x]) => sim.nameOf(s, x)) : [];
  $("end-body").innerHTML = `<div class="end-stats"><div><b>${s.day}</b>days survived</div><div><b>${myRoots.size}</b>rumors started</div><div><b>${reach}</b>women believed you</div><div><b>${s.player.heard.length}</b>pieces of tea</div><div><b>${sim.alliancesOf(s, "player").length}</b>pacts</div><div><b>${betrayals.length}</b>betrayals</div></div>
    <div class="end-list">${!won && last && !finale && against.length ? `<p><b>Voted you out:</b> ${against.join(", ")}</p>` : ""}${finale ? `<p><b>Jury votes:</b> ${Object.entries(last.ballots).map(([x, t]) => `${sim.nameOf(s, x)} → ${sim.nameOf(s, t)}`).join(" · ")}</p>` : ""}${betrayals.length ? `<p><b>Broke their word to you:</b> ${[...new Set(betrayals.map((b) => sim.nameOf(s, b.by)))].join(", ")}</p>` : ""}</div>`;
  H.fade(false);
  H.screen("endcard", true);
}

// ---------- go ----------

await connect();
voice.initVoice().then(() => H.setBrain(jev.status(), voice.voiceStatus()));
toTitle();
cam.pos.set(30, 20, 30);
requestAnimationFrame(frame);
window.__gossiptown = { renderer, get game() { return game; }, people, ui, cam, setPaused, get mode() { return mode; }, startVote, jev, voice };
