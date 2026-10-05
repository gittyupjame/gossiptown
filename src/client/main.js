// Gossiptown in the browser: wires the town, the cast, the camera, the controls and the
// screens to the game. The game itself (Jev decisions, Claude words) lives in src/core.

import * as inspect from "../core/inspect.js";
import * as THREE from "three";
import { renderer, camera, setTime, updateSky, resize, env } from "./scene.js";
import { buildTown, updateTown, setClockHands, setBoardNotes } from "./town.js";
import { dustCloud } from "./fight.js";
import { makeCharacter, Walker, portraits, turn, setXray } from "./people.js";
import * as B from "./bubbles.js";
import * as H from "./hud.js";
import * as L from "./layout.js";
import { initBoard, render as renderBoard } from "./tracker.js";
import { runVote } from "./vote.js";
import { runShow } from "./spotlight.js";
import * as audio from "./audio.js";
import { openWardrobe, isOpen as wardrobeOpen } from "./closet.js";
import * as W from "../core/wardrobe.js";
import { FORMATS } from "../core/events.js";
import { createGame, hasSave } from "../core/game.js";
import * as sim from "../core/sim.js";
import * as jev from "../core/jev.js";
import * as voice from "../core/voice.js";
import { VILLAGERS, HOST, PLAYER_LOOK, PLACES, ITEMS } from "../core/cast.js";

const $ = H.$;
const scene = (await import("./scene.js")).scene;

// ---------- settings ----------

const SETTINGS_KEY = "gossiptown.settings.v1";
const settings = (() => { try { return { daySeconds: 300, jevKey: "", music: 0.7, sound: 0.85, muted: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { daySeconds: 300, jevKey: "", music: 0.7, sound: 0.85, muted: false }; } })();
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
const me = addPerson("player", W.lookOf(W.STARTER), { idle: "none" }, L.PLAYER_START.x, L.PLAYER_START.z);
me.walker.speedBase = 3.2;
const pics = portraits([...VILLAGERS, { id: "player", look: W.lookOf(W.STARTER) }, { id: HOST.id, look: HOST.look }]);

// Swap the player's figure for one in her new outfit (and refresh her portrait).
function setPlayerLook(outfit) {
  const look = W.lookOf(outfit);
  const old = me.model;
  const model = makeCharacter(look, { idle: "none" });
  model.root.position.copy(old.root.position); model.root.rotation.copy(old.root.rotation);
  scene.add(model.root); scene.remove(old.root);
  me.model = model; me.walker.model = model;
  B.setAnchor("player", () => model.root.position.clone().setY(model.height + 0.12));
  Object.assign(pics, portraits([{ id: "player", look }]));
}

// ---------- state ----------

let mode = "title"; // title | intro | play | fight | show | vote | night | end
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
const frozen = () => paused || H.tipShowing() || H.isOpen("board") || H.isOpen("settings") || wardrobeOpen();

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
  const dest = v.location === "lane" ? v.dest : v.location;
  if (dest === "home") {
    const d = L.homeDoor(v.id);
    if (p.inside) return;
    p.walker.goTo(d.x, d.z);
    p.goingHome = true;
  } else {
    if (p.inside) emerge(v.id);
    p.goingHome = false;
    const spot = (v.location === "lane" ? v.destSpot : v.spot) || L.spotFor(dest, takenSpots());
    p.walker.goTo(spot.x, spot.z);
    p.walker.dest = spot;
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
  if (v.location === "lane" && v.dest) { const f = v.from || v.destSpot; p.walker.x = f.x; p.walker.z = f.z; p.walker.stop(); sendTo(v); return; }
  const spot = v.spot || L.spotFor(v.location, takenSpots());
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
  arrived: (v) => sendTo(v),
  // two women about to talk: they stand where the sim put them
  pair(a, b) {
    for (const v of [a, b]) {
      const p = people[v.id];
      if (!p || p.inside || p.gone || !v.spot || talk?.id === v.id) continue;
      p.walker.goTo(v.spot.x, v.spot.z); p.walker.dest = v.spot;
    }
  },
  exchange: (e) => { if (mode === "play") playExchange(e); },
  headline: (text, kind) => H.chyron(text, kind),
  emote: (id, kind) => { if (people[id] && !people[id].inside) B.emote(id, kind); },
  fight(a, b, { winner } = {}) {
    if (mode !== "play" && mode !== "show") return;
    const pa = people[a], pb = people[b];
    if (!pa || !pb || pa.inside || pb.inside || pa.gone || pb.gone) return;
    if (talk && (talk.id === a || talk.id === b)) endTalk(false);
    // face off, then the dust cloud
    const dx = pb.walker.x - pa.walker.x, dz = pb.walker.z - pa.walker.z, d = Math.hypot(dx, dz) || 1;
    if (d > 1.6) { pb.walker.x = pa.walker.x + (dx / d) * 1.1; pb.walker.z = pa.walker.z + (dz / d) * 1.1; }
    for (const p of [pa, pb]) { p.walker.stop(); p.walker.frozen = true; }
    const cloud = dustCloud(pa.walker, pb.walker, { ida: a, idb: b });
    if (Math.hypot(pa.walker.x - me.walker.x, pa.walker.z - me.walker.z) < 22 || mode === "show") audio.scuffle(3.2);
    let t = 0;
    const fn = (dt) => {
      cloud.update(dt);
      if ((t += dt) < 3.2) return;
      frameFns.delete(fn);
      cloud.stop();
      for (const p of [pa, pb]) p.walker.frozen = false;
      if (winner) { B.emote(winner, "sparkle"); B.emote(winner === a ? b : a, "star"); }
    };
    frameFns.add(fn);
    if (Math.hypot(pa.walker.x - me.walker.x, pa.walker.z - me.walker.z) < 18) H.tip("fight");
  },
  lookJudged(v, rec) { if (rec.seenByPlayer && mode === "play") H.tip("looks"); },
  gift(id, how) { B.emote(id, { delighted: "heart", pleased: "flower", suspicious: "suspicious", insulted: "anger" }[how]); },
  // a line said to the newcomer: in a talk she's in, or a woman coming over to start one
  toPlayer({ by, text }) {
    if (talk && talk.id === by) { talk.think?.close(); talk.think = null; B.say(by, text, { name: first(by), color: colorOf(by), hold: Math.max(4, text.length / 12) }); return; }
    const v = S()?.people[by];
    if (v && !talk && mode === "play") walkUp(v, text);
  },
  talkEnded(t) { if (talk && (t.a === talk.id || t.b === talk.id) && (t.a === "player" || t.b === "player")) endTalk(false, true); },
  fightPlayer: (id, by) => { if (mode === "play" || mode === "show") playerBrawl(id, by); },
  first(kind) {
    const map = { rumor: "rumor", told: "told", alliance: "alliance", "alliance-overheard": "alliance-overheard", "vote-pitch": "vote-pitch", caught: "caught", talk: "talk" };
    if (map[kind]) H.tip(map[kind]);
  },
  heard() { H.toast("☕ New tea on your Gossip Board (Tab)"); boardBadge(); },
  clock: () => {},
  bell() {
    audio.sfx("bell", { strikes: 3 });
    H.chyron("The bell is ringing. Everyone to the firepit at sundown!", "vote");
    B.emote(HOST.id, "bell");
    H.tip("bell");
  },
  voteNight: () => startVote(),
  showPlanned(s, ev) {
    const f = FORMATS[ev.format];
    if (mode === "play") H.chyron(`Today Primrose hosts ${f.icon} ${f.title} at ${PLACES[ev.place].name}, ${sim.clock(ev.minute)}. ${f.blurb}`, "show");
  },
  showBell(s, ev) {
    const f = FORMATS[ev.format];
    H.chyron(`Primrose is gathering everyone at ${PLACES[ev.place].name} for ${f.title}!`, "show");
    B.emote(HOST.id, "bell");
  },
  showStart: () => startShow(),
  nightStart: () => {},
  nightDone: (s, lines) => showNight(s, lines),
};

let unseen = 0;
function boardBadge(reset = false) {
  unseen = reset ? 0 : unseen + 1;
  $("btn-board").innerHTML = `☕ Gossip Board${unseen ? ` <span class="badge">${unseen}</span>` : ""} <kbd>Tab</kbd>`;
}

// ---------- someone walks up to you ----------

async function walkUp(v, line) {
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
  if (S().player.talkingTo !== id) return;
  const p = people[id];
  p.walker.stop(); p.walker.frozen = true;
  p.walker.face = me.walker;
  p.model.lookAt(me.model.root.position);
  me.model.lookAt(p.model.root.position);
  talk = { id, busy: false, bubble: null };
  if (opener) B.say(id, opener, { name: first(id), color: colorOf(id), hold: 6 });
  else B.emote(id, "wave");
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
  talk.think = B.thinking(id, { name: first(id), color: colorOf(id) });
  let res = null;
  try { res = await game.say(text); } catch (e) { console.error(e); }
  if (talk?.think) { talk.think.close(); talk.think = null; }
  if (!talk || talk.id !== id) return;
  talk.busy = false;
  if (!res) { openTyping(); return; }
  if (res.failed) { H.toast("Nobody could make out a word: dialogue isn't reachable right now."); endTalk(false); return; }
  const said = res.reply || "";
  if (res.fight) {
    await wait(Math.max(900, said.length * 30));
    playerBrawl(id, res.fight.by);
    return;
  }
  if (res.leaving) {
    await wait(Math.max(1500, said.length * 40));
    endTalk(false);
    return;
  }
  await wait(400);
  if (talk && talk.id === id) openTyping();
}

function endTalk(_walkedOff, fromGame = false) {
  if (!talk) return;
  const id = talk.id;
  talk.bubble?.close(); talk.think?.close();
  const p = people[id];
  p.walker.frozen = false;
  p.walker.face = null;
  p.model.lookAt(null); me.model.lookAt(null);
  if (!fromGame) game.endTalk();
  talk = null;
  document.getElementById("speech")?.blur();
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- a cat fight with you ----------
// Mash Enter to hold your own; walk away to back down. Jev's town decides what it means.

async function playerBrawl(id, by) {
  if (mode !== "play" && mode !== "show") return;
  const back = mode;
  const s = S();
  const p = people[id], v = s.people[id];
  if (!p || p.inside || p.gone) return;
  if (talk) endTalk(false);
  B.hush("player"); B.hush(id);
  mode = "fight";
  H.hint("");
  for (const x of [p, me]) { x.walker.stop(); x.walker.frozen = true; }
  const dx = p.walker.x - me.walker.x, dz = p.walker.z - me.walker.z, d = Math.hypot(dx, dz) || 1;
  if (d > 1.4) { p.walker.x = me.walker.x + (dx / d) * 1.1; p.walker.z = me.walker.z + (dz / d) * 1.1; }
  H.tip("fight-you");
  H.voteHud(by === "player" ? "You started a cat fight!" : `${first(id)} started a cat fight!`, "Mash Enter to hold your own · walk away to back down");
  $("fm-her").textContent = first(id);
  const meter = $("fightmeter"), bar = meter.querySelector("i");
  meter.classList.add("show");
  const cloud = dustCloud(me.walker, p.walker, { ida: "player", idb: id });
  frameFns.add(cloud.update);
  audio.scuffle(5);
  // how hard she fights back: her nerve and temper, how angry she is, and a bit of luck
  const her = 1.6 + v.bias.nerve * 1.6 + v.bias.temper * 1.2 + v.mood.anger * 0.3 + Math.random() * 0.8;
  let power = 0.5, away = 0, result = null;
  const tap = () => { power = Math.min(1, power + 0.045); audio.sfx("tap"); };
  enterFns.add(tap);
  for (let t = 0; t < 5.0; t += 0.1) {
    await wait(100);
    power = Math.max(0, power - her * 0.012);
    bar.style.width = `${Math.round(power * 100)}%`;
    const moving = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].some((k) => keys.has(k));
    away = moving ? away + 0.1 : Math.max(0, away - 0.05);
    if (away >= 0.6) { result = "backed_down"; break; }
    if (power >= 1) { result = "won"; break; }
    if (power <= 0) { result = "lost"; break; }
  }
  result ??= power >= 0.5 ? "won" : "lost";
  enterFns.delete(tap);
  frameFns.delete(cloud.update);
  cloud.stop();
  meter.classList.remove("show");
  H.voteHud(null);
  for (const x of [p, me]) x.walker.frozen = false;
  if (result === "backed_down") {
    const ang = Math.atan2(me.walker.x - p.walker.x, me.walker.z - p.walker.z);
    const nx = me.walker.x + Math.sin(ang) * 1.2, nz = me.walker.z + Math.cos(ang) * 1.2;
    if (!L.solidAt(nx, nz, 0.35)) { me.walker.x = nx; me.walker.z = nz; }
  }
  B.emote(result === "won" ? "player" : id, "sparkle");
  B.emote(result === "won" ? id : "player", "star");
  audio.sting(result === "won" ? "good" : "bad");
  mode = back;
  const r = await game.fight(id, { by, result });
  if (r) {
    const parts = [];
    if (r.sided.you.length) parts.push(`On your side: ${r.sided.you.join(", ")}`);
    if (r.sided.her.length) parts.push(`On ${first(id)}'s side: ${r.sided.her.join(", ")}`);
    if (parts.length) setTimeout(() => H.toast(parts.join(" · ")), 2500);
  }
}

// ---------- things to do around town ----------

const SPOTS = [
  ...Object.entries(L.PICKUPS).map(([item, p]) => ({ kind: "pickup", item, x: p.x, z: p.z, r: 1.7, label: { x: p.x, y: 1.5, z: p.z } })),
  { kind: "board", x: L.BOARD_STAND.x, z: L.BOARD_STAND.z, r: 1.9, label: { x: L.BOARD.x, y: 2.75, z: L.BOARD.z } },
  { kind: "rack", x: L.RACK_STAND.x, z: L.RACK_STAND.z, r: 1.8, label: { x: L.RACK.x, y: 2.4, z: L.RACK.z } },
  ...VILLAGERS.map((v) => { const m = L.mailbox(v.id); return { kind: "mail", owner: v.id, x: m.stand.x, z: m.stand.z, r: 1.4, label: null }; }),
];
for (const sp of SPOTS) {
  if (!sp.label) continue;
  sp.key = `spot-${sp.kind}-${sp.item || ""}`;
  const at = new THREE.Vector3(sp.label.x, sp.label.y, sp.label.z);
  B.setAnchor(sp.key, () => at);
  sp.tag = B.label(sp.key, sp.kind === "pickup" ? ITEMS[sp.item].icon : sp.kind === "rack" ? "👗" : "📌", "spot-icon far");
}
let acting = false;

function liveNotes(s) { return (s.notes || []).filter((n) => s.day - n.day <= 1); }

function nearestSpot(s) {
  let best = null, bd = Infinity;
  for (const sp of SPOTS) {
    const d = Math.hypot(sp.x - me.walker.x, sp.z - me.walker.z);
    if (d > sp.r || d >= bd) continue;
    if (sp.kind === "pickup" && s.player.carrying === sp.item) continue;
    if (sp.kind === "mail" && s.people[sp.owner]?.gone) continue;
    best = sp; bd = d;
  }
  return best;
}
function spotHint(sp, s) {
  if (sp.kind === "pickup") return `<kbd>Enter</kbd> ${s.player.carrying ? "swap for" : "pick up"} ${ITEMS[sp.item].icon} ${ITEMS[sp.item].name}`;
  if (sp.kind === "board") return `<kbd>Enter</kbd> pin an anonymous note 📌`;
  if (sp.kind === "rack") return `<kbd>Enter</kbd> change your look 👗 <small>(🪙 ${s.player.coins})</small>`;
  return `<kbd>Enter</kbd> peek in ${first(sp.owner)}'s mailbox 📬`;
}
let shownNotes = -1;
function updateSpots(s) {
  const n = liveNotes(s).length;
  if (n !== shownNotes) { shownNotes = n; setBoardNotes(n); }
  for (const sp of SPOTS) {
    if (!sp.tag) continue;
    const d = Math.hypot(sp.label.x - me.walker.x, sp.label.z - me.walker.z);
    sp.tag.el.classList.toggle("far", d > 13 || (sp.kind === "pickup" && s.player.carrying === sp.item));
    if (sp.kind === "board") { const n = liveNotes(s).length; const html = n ? `📌<small>${n}</small>` : "📌"; if (sp.tag.el.innerHTML !== html) sp.tag.el.innerHTML = html; }
  }
}

async function useSpot(sp) {
  const s = S();
  if (acting || !s) return;
  if (sp.kind === "pickup") {
    const it = game.pickUp(sp.item);
    if (!it) return;
    B.emote("player", "gift");
    audio.sfx("pickup");
    H.toast(`${it.icon} You picked up ${it.name} from ${it.where}`);
    return;
  }
  if (sp.kind === "rack") {
    acting = true;
    me.walker.stop();
    try {
      const o = await openWardrobe({ outfit: s.player.outfit, owned: s.player.owned, coins: s.player.coins, playerName: s.player.name });
      if (o && o.changed) {
        const r = game.dress(o);
        if (r.ok) {
          setPlayerLook(S().player.outfit);
          B.emote("player", "sparkle");
          audio.sfx("pickup");
          H.toast(`👗 New look${r.spent ? ` for 🪙 ${r.spent}` : ""}. Everyone who sees you will have an opinion.`);
        }
      }
    } finally { acting = false; }
    return;
  }
  if (sp.kind === "mail") {
    acting = true;
    me.walker.stop();
    B.emote("player", "suspicious");
    audio.sfx("creak");
    let r = null;
    try { r = await game.snoop(sp.owner); } catch (e) { console.error(e); } finally { acting = false; }
    if (!r) return;
    if (r.found) H.toast(`📬 ${r.found}`);
    if (r.isSecret) B.emote("player", "gasp");
    return;
  }
  if (sp.kind === "board") {
    acting = true;
    let bubble = null;
    const done = () => { acting = false; bubble?.close(); frameFns.delete(watch); };
    const watch = () => { if (Math.hypot(sp.x - me.walker.x, sp.z - me.walker.z) > 3.2 || mode !== "play") done(); };
    frameFns.add(watch);
    bubble = B.typing("player", {
      name: s.player.name, placeholder: "Write an anonymous note…", hint: "Enter to pin it · empty Enter to walk away",
      onSubmit: async (text) => {
        bubble.lock(true);
        let r = null;
        try { r = await game.postNote(text); } catch (e) { console.error(e); } finally { done(); }
        if (!r) return;
        B.emote("player", "whisper");
        audio.sfx("pin");
        setBoardNotes(liveNotes(S()).length);
        H.toast("📌 Your note is up on the Whisper board. Nobody knows it was you... yet.");
      },
      onCancel: done,
    });
  }
}

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
let brainT = 0, heardSeen = -1;
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
    s.player.pos = { x: me.walker.x, z: me.walker.z };
    // new tea: something the newcomer learned (only ever from what she perceived)
    if (s.player.heard.length > heardSeen) { if (heardSeen >= 0) { H.toast("☕ New tea on your Gossip Board (Tab)"); boardBadge(); } heardSeen = s.player.heard.length; }
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
    const spot = near || talk || acting ? null : nearestSpot(s);
    H.hint(near ? `<kbd>Enter</kbd> talk to ${first(near)}` : spot ? spotHint(spot, s) : "");
    updateSpots(s);
    H.updateHud(s, placeTitle(s.player.location));
    setClockHands(s.minute);
  } else if (mode !== "vote") { for (const v of VILLAGERS) B.tagState(v.id, { show: false }); B.tagState(HOST.id, { show: false }); if (mode !== "play") H.hint(""); }
  // music for the moment, footsteps, and the sounds of wherever you are
  soundFrame(s, rawDt, fz);
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
let stepAcc = 0, lastStepX = 0, lastStepZ = 0;
function surfaceAt(x, z) {
  if (Math.abs(x - L.DOCK.x) < L.DOCK.w / 2 + 0.3 && z < L.DOCK.z + 1 && z > L.DOCK.z - L.DOCK.len) return "wood";
  if (Math.abs(x - L.BRIDGE.x) < L.BRIDGE.len / 2 && Math.abs(z - L.BRIDGE.z) < L.BRIDGE.w / 2 + 0.3) return "wood";
  if (Math.hypot(x - L.PLAZA.x, z - L.PLAZA.z) < L.PLAZA.r) return "stone";
  for (const r of L.ROADS) if (L.distToPolyline(x, z, r.pts) < r.w / 2) return "stone";
  return "grass";
}
function soundFrame(s, dt, fz) {
  const won = s?.over?.won;
  const evening = s && (s.minute >= 17 * 60 || (sim.isVoteDay(s) && s.minute >= 19 * 60));
  const track = mode === "title" || mode === "intro" ? "title" : mode === "fight" ? "fight" : mode === "show" ? "show" : mode === "vote" || mode === "vote-pick" ? "vote" : mode === "night" ? "night" : mode === "end" ? (won ? "title" : "night") : evening ? "evening" : "day";
  audio.music(track, { afternoon: !!s && s.minute >= 13 * 60 });
  if (fz) return;
  // your footsteps, by what you're walking on
  const w = me.walker, moved = Math.hypot(w.x - lastStepX, w.z - lastStepZ);
  lastStepX = w.x; lastStepZ = w.z;
  if (moved < 1 && (mode === "play" || mode === "vote-pick" || mode === "show")) { stepAcc += moved; if (stepAcc > 1.05) { stepAcc = 0; audio.sfx("step", { surface: surfaceAt(w.x, w.z), gain: 0.8 }); } }
  const lx = mode === "play" || mode === "vote-pick" ? w.x : cam.look.x, lz = mode === "play" || mode === "vote-pick" ? w.z : cam.look.z;
  const crowdHere = s ? sim.alive(s).filter((v) => { const p = people[v.id]; return !p.inside && Math.hypot(p.walker.x - lx, p.walker.z - lz) < 9; }).length : 0;
  audio.updateAudio({ x: lx, z: lz, minute: forceNight ? 21.5 * 60 : mode === "title" ? 17.8 * 60 : s ? s.minute : 600, mode, night: env.night, fireLit: mode === "vote" || mode === "vote-pick", riverDist: L.distToPolyline(lx, lz, L.RIVER) - L.RIVER_W / 2, crowdHere: crowdHere >= 3 ? crowdHere : 0 });
}
const placeTitle = (loc) => (PLACES[loc] ? PLACES[loc].name.replace(/^the /, "The ") : "The lanes");

// ---------- input ----------

window.addEventListener("keydown", (e) => {
  if (e.target.id === "name-in" || e.target.id === "set-jev-key" || wardrobeOpen()) return;
  if (e.code === "Tab") { e.preventDefault(); toggleBoard(); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    if (H.tipShowing()) { H.dismissTip(); return; }
    if (H.isOpen("board")) return;
    if (H.isOpen("nightcard")) { $("night-ok").click(); return; }
    if (H.isOpen("endcard")) return;
    if (enterFns.size && !paused) { for (const fn of [...enterFns]) fn(); return; }
    if (mode === "play" && !talk && !paused && !acting) {
      const id = nearestVillager(2.4);
      if (id) startTalk(id);
      else { const sp = nearestSpot(S()); if (sp) useSpot(sp); }
    }
    return;
  }
  if (e.code === "KeyM" && !e.target.closest?.("input")) { setMuted(audio.toggleMute()); return; }
  if (e.code === "KeyP" || e.code === "Escape") {
    if (e.code === "Escape" && H.isOpen("board")) { toggleBoard(false); return; }
    if (e.code === "Escape" && H.isOpen("settings")) { closeSettings(); return; }
    if (mode !== "title" && mode !== "end") setPaused(!paused);
    return;
  }
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
// browsers only allow sound after the first click or key press
const wake = () => audio.initAudio({ music: settings.music, sfx: settings.sound, muted: settings.muted });
window.addEventListener("pointerdown", wake, true);
window.addEventListener("keydown", wake, true);
document.addEventListener("click", (e) => { if (e.target.closest?.("button")) audio.sfx("click"); }, true);
function setMuted(on) {
  settings.muted = on; saveSettings();
  audio.setVolumes({ muted: on });
  $("btn-mute").textContent = on ? "🔇" : "🔊";
}
$("btn-mute").onclick = () => setMuted(!settings.muted);
$("btn-mute").textContent = settings.muted ? "🔇" : "🔊";
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => { if (document.hidden && mode !== "title" && mode !== "end") setPaused(true); });
window.addEventListener("toggle-tracker", () => toggleBoard());
window.addEventListener("tip-closed", () => { if (talk?.bubble) talk.bubble.focus(); });

function setPaused(on) {
  if (on && !paused) audio.sfx("pause");
  paused = on;
  audio.setPaused(on);
  voice.setPaused(on);
  if (!on) setTimeout(() => audio.sfx("unpause"), 30);
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
  if (on !== H.isOpen("board")) audio.sfx("board");
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
  $("set-voice-status").textContent = vs.label;
  for (const b of document.querySelectorAll("#set-day button")) b.classList.toggle("on", +b.dataset.v === settings.daySeconds);
  $("set-music").value = settings.music; $("set-sound").value = settings.sound;
  H.screen("settings", true);
}
function closeSettings() {
  const key = $("set-jev-key").value.trim();
  if (key !== settings.jevKey) { settings.jevKey = key; saveSettings(); if (!serverJev) jev.configure(key ? { key } : {}); }
  H.screen("settings", false);
}
for (const b of document.querySelectorAll("#set-day button")) b.onclick = () => { settings.daySeconds = +b.dataset.v; saveSettings(); for (const x of document.querySelectorAll("#set-day button")) x.classList.toggle("on", x === b); if (game) game.setDaySeconds?.(settings.daySeconds); };
$("set-ok").onclick = closeSettings;
$("set-music").oninput = (e) => { settings.music = +e.target.value; saveSettings(); audio.setVolumes({ music: settings.music }); };
$("set-sound").oninput = (e) => { settings.sound = +e.target.value; saveSettings(); audio.setVolumes({ sfx: settings.sound }); audio.sfx("tip"); };
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
$("name-ok").onclick = async () => {
  const name = ($("name-in").value.trim() || "Rosie").replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, 16) || "Rosie";
  H.screen("namecard", false);
  const outfit = await openWardrobe({ outfit: W.STARTER, owned: [], coins: W.BUDGET, creation: true, playerName: name });
  H.resetTips();
  newGameObject();
  game.newSeason(name, outfit);
  setPlayerLook(S().player.outfit);
  intro();
};
$("t-continue").onclick = () => {
  newGameObject();
  if (!game.load()) { toTitle(); return; }
  setPlayerLook(S().player.outfit);
  H.screen("title", false);
  resume();
};
$("end-new").onclick = () => { try { localStorage.removeItem("gossiptown.season.v3"); } catch {} H.screen("endcard", false); toTitle(); };

// ---------- how you look ----------

// The welcome party gets its first good look at you.
async function firstImpressions(hostSay) {
  const s = S();
  cam.shot(new THREE.Vector3(me.walker.x, 1.2, me.walker.z), 4.2, { from: new THREE.Vector3(0, 0, 0), height: 0.9 });
  const spin = { t: 0 };
  const fn = (dt) => { spin.t += dt; me.walker.heading = Math.PI + Math.sin(Math.min(1, spin.t / 1.6) * Math.PI * 2) * 0.9 * (1 - Math.min(1, spin.t / 1.6)); if (spin.t > 1.7) { me.walker.heading = Math.PI; frameFns.delete(fn); } };
  frameFns.add(fn);
  await hostSay(`But first, ladies, take a good long look at our newcomer!`, 2600);
  let recs = [];
  try { recs = await game.firstLooks({ where: "the welcome party in the plaza: the newcomer's very first appearance" }); } catch (e) { console.error(e); }
  cam.shot(new THREE.Vector3(0, 0.8, -3.2), 9.5, { from: new THREE.Vector3(0, 0, 14), height: 8.5 });
  await wait(1100);
  const EM = { admires: "heart", approves: "sparkle", sneers: "cringe", envious: "anger", copycat: "anger", suspicious: "suspicious" };
  for (const v of sim.alive(s)) { const r = s.looks[v.id]; if (r && EM[r.reaction]) { B.emote(v.id, EM[r.reaction]); await wait(90); } }
  await wait(1200);
  const avg = recs.reduce((t, r) => t + r.verdict, 0) / Math.max(1, recs.length);
  await hostSay(avg >= 2.8 ? `Ooh, they're impressed. Careful, sweetie, nobody likes the prettiest girl in the room for long.` : avg <= 1.6 ? `Yikes. Tough crowd! Maybe pay a visit to the clothes rack by the salon.` : `Mixed reviews! Some love it, some are already whispering. How thrilling.`);
}

async function intro() {
  mode = "intro";
  const s = S();
  // the welcome party in the plaza
  const arc = VILLAGERS.map((v, i) => { const a = Math.PI * (1.12 + (i / (VILLAGERS.length - 1)) * 0.76); return { id: v.id, x: Math.cos(a) * 6.4, z: Math.sin(a) * 6.4 + 1.2 }; });
  for (const a of arc) { const p = people[a.id]; p.inside = false; p.gone = false; p.model.root.visible = true; p.walker.x = a.x; p.walker.z = a.z; p.walker.stop(); p.walker.face = { x: 0, z: 6.5 }; p.walker.heading = Math.atan2(-a.x, 6.5 - a.z); s.people[a.id].location = "plaza"; s.people[a.id].spot = { x: a.x, z: a.z }; }
  const host = people[HOST.id].walker;
  host.x = -1.6; host.z = 4.2; host.stop(); host.face = { x: 0, z: 8 };
  me.walker.x = 0.6; me.walker.z = 8.4; me.walker.heading = Math.PI;
  me.model.root.position.set(me.walker.x, 0, me.walker.z); me.model.root.rotation.y = Math.PI;
  s.player.pos = { x: me.walker.x, z: me.walker.z };
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
  await hostSay(`I'm Primrose, your host. Ten women live here, and every night, at the firepit, they vote one of their own out of town.`);
  cam.shot(new THREE.Vector3(0.6, 1.4, 8.4), 4.5, { from: new THREE.Vector3(0, 0, 0), height: 1.2 });
  await hostSay(`And now there's you, ${s.player.name}. The new girl. Nobody here trusts you. Yet.`);
  await hostSay(`Make friends. Make secret pacts. Spread a little gossip. Just don't get voted out.`);
  await hostSay(`Oh, and every day I host a little show somewhere in town. Everyone comes, everyone watches, and whatever you say up there, the whole town remembers.`);
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
  await firstImpressions(hostSay);
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
  if (s.phase === "show") { startPlay(); startShow(); return; }
  if (s.over) { showEnd(); return; }
  startPlay();
  H.fade(false);
}

// ---------- Primrose's daily show ----------

const showCtx = {
  get game() { return game; },
  get ui() { return ui; },
  walker(id) { const p = people[id]; if (p.inside) { p.inside = false; p.model.root.visible = true; } return p.walker; },
  model: (id) => people[id]?.model,
  cam, wait, waitOrEnter,
  npcFight: (a, b, o) => ui.fight(a, b, o),
  playerFight: (id, by) => playerBrawl(id, by),
};

let showRunning = false;
async function startShow() {
  if (showRunning) return;
  showRunning = true;
  endTalk(false);
  mode = "show";
  H.showHud(false);
  H.hint("");
  setXray(false);
  try { await runShow(showCtx); } catch (e) { console.error("show failed", e); H.cinema(false); H.voteHud(null); game.endShow(); }
  showRunning = false;
  setXray(true);
  const s = S();
  for (const p of Object.values(people)) p.walker.face = null;
  for (const v of Object.values(s.people)) if (!v.gone) { const p = people[v.id]; p.walker.dest = { x: p.walker.x, z: p.walker.z }; }
  if (s.over) { showEnd(); return; }
  startPlay();
  await H.fade(false);
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
      const CENTRE_X = L.FIREPIT.x, CENTRE_Z = L.FIREPIT.z;
      const bound = (x, z) => { const d = Math.hypot(x - CENTRE_X, z - CENTRE_Z); return d < 5.2 && d > 2.0; };
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
        H.hint(chosen ? (confirm ? `<kbd>Enter</kbd> again to vote out <b>${first(chosen)}</b>` : `<kbd>Enter</kbd> vote for ${first(chosen)}`) : "Walk up to the woman you want gone, or click her card");
      };
      frameFns.add(tick);
      // or pick from the portrait cards: one click walks you over, a second casts it
      const cardsEl = document.getElementById("votecards");
      cardsEl.innerHTML = "";
      const cards = {};
      for (const id of cands) {
        const b = document.createElement("button");
        b.innerHTML = `<img alt=""><span></span>`;
        b.querySelector("img").src = pics[id] || "";
        b.querySelector("span").textContent = first(id);
        b.onclick = () => {
          if (chosen === id) return onEnter();
          const w = people[id].walker, dx = CENTRE_X - w.x, dz = CENTRE_Z - w.z, d = Math.hypot(dx, dz) || 1;
          me.walker.x = w.x + (dx / d) * 1.3; me.walker.z = w.z + (dz / d) * 1.3;
        };
        cards[id] = b;
        cardsEl.appendChild(b);
      }
      cardsEl.classList.add("show");
      const syncCards = () => { for (const id of cands) { cards[id].classList.toggle("on", id === chosen); cards[id].classList.toggle("confirm", id === confirm); } };
      frameFns.add(syncCards);
      const onEnter = () => {
        if (!chosen) return;
        if (confirm !== chosen) { confirm = chosen; B.say("player", `${first(chosen)}...?`, { name: S().player.name, color: colorOf("player"), you: true, hold: 1.5 }); return; }
        frameFns.delete(tick); frameFns.delete(syncCards); enterFns.delete(onEnter);
        cardsEl.classList.remove("show");
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
  setXray(false);
  const result = await runVote(voteCtx);
  setXray(true);
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
  const rows = (lines || []).map((l) => `<div class="nb-line"><span class="ic">🌙</span><span>${l}</span></div>`).join("");
  $("night-body").innerHTML = `${rows}
    <div class="nb-recap">Today you heard <b>${today}</b> new rumor${today === 1 ? "" : "s"} and started <b>${told}</b>.</div>
    <div class="nb-recap">${sim.daysToVote({ ...s, day: s.day + 1 }) === 0 ? "🔥 Tomorrow night is a vote." : `Next vote in ${sim.daysToVote({ ...s, day: s.day + 1 })} days.`}</div>`;
  $("night-ok").innerHTML = `Start Day ${s.day + 1} <kbd>Enter</kbd>`;
  H.fade(false);
  H.screen("nightcard", true);
  audio.sting("nightfall");
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
  audio.sting("morning");
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
    <div class="end-list">${!won && last && !finale && against.length ? `<p><b>Voted you out:</b> ${against.join(", ")}</p>` : ""}${finale ? `<p><b>Jury votes:</b> ${Object.entries(last.ballots).map(([x, t]) => `${sim.nameOf(s, x)} → ${sim.nameOf(s, t)}`).join(" · ")}</p>` : ""}${s.player.fights ? `<p><b>Cat fights you started:</b> ${s.player.fights}</p>` : ""}${betrayals.length ? `<p><b>Broke their word to you:</b> ${[...new Set(betrayals.map((b) => sim.nameOf(s, b.by)))].join(", ")}</p>` : ""}</div>`;
  // what was really going on, straight from the record
  const rv = game.reveal();
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const group = (k, title) => { const xs = rv.filter((x) => x.kind === k); return xs.length ? `<p><b>${title}</b></p>${xs.slice(0, 12).map((x) => `<p class="muted">${esc(x.text)}</p>`).join("")}` : ""; };
  $("end-body").innerHTML += `<div class="end-list reveal"><div class="section-title">What was really going on</div>${group("ballot", "Why they voted the way they did")}${group("promise", "Promises to you that weren't kept")}${group("lie", "Lies told")}${group("behind", "Said behind your back")}${group("secret", "Everyone's secrets")}</div>`;
  H.fade(false);
  H.screen("endcard", true);
  audio.sting(won ? "fanfare" : "sad");
}

// ---------- go ----------

await connect();
voice.initVoice().then(() => H.setBrain(jev.status(), voice.voiceStatus()));
toTitle();
cam.pos.set(30, 20, 30);
requestAnimationFrame(frame);
window.__gossiptown = { renderer, get game() { return game; }, people, ui, cam, setPaused, get mode() { return mode; }, startVote, jev, voice, audio, me, inspect: { reputation: (id) => inspect.reputation(game.state(), id), reach: (rid) => inspect.reach(game.state(), rid), why: (id) => inspect.why(game.state(), id), whyChange: (q) => inspect.whyChange(game.state(), q), violations: () => game.state()?.violations || [] } };
