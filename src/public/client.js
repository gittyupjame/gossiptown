// The browser side: draws the little planet in 3D, moves the player, walks villagers
// to where the server says they are, and shows names and speech bubbles.
// The server makes every decision.

import * as THREE from "three";
import * as map from "./map.js";
import { surface, placeOn, buildTown, makePerson, animate, LOOKS } from "./globe.js";

const $ = (id) => document.getElementById(id);
const PLACE_NAMES = { square: "the village square", bakery: "Marigold's bakery", smithy: "the smithy", tavern: "the Crooked Kettle tavern", market: "the market stalls", garden: "the herb garden", hall: "the elder's hall", road: "the lane" };
const PLAYER_SPEED = 2.6, WALK_SPEED = 1.1; // tiles per second: an easy stroll

// ---------- 3D scene ----------

const holder = $("world");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
holder.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight("#fff4e0", "#6a8a5a", 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff0d8", 1.6);
scene.add(sun, sun.target);
buildTown(scene);

let state = null;
const people = {};      // id -> { x, y, path, heading, moving, t, shown, model, info, target }
const player = { x: map.START.x + 0.5, y: map.START.y + 0.5, heading: 0, moving: false, t: 0 };
player.model = makePerson(LOOKS.player);
scene.add(player.model.root);
let lastSent = "", nightOn = false, paused = true;
let zoom = 1;
// how the camera sits behind and above the player
const view = { dist: 11, up: 0.95, back: 0.55, lookUp: 0.5, lookAhead: 0 };
const keys = new Set();

// ---------- server events ----------

const es = new EventSource("/events");
es.addEventListener("reset", (e) => {
  const d = JSON.parse(e.data);
  $("log").innerHTML = "";
  d.lines.forEach(addLine);
  player.x = d.pos.x; player.y = d.pos.y;
  for (const k of Object.keys(people)) removePerson(k);
  applyState(d.state, true);
  showNight(d.night);
  if (d.waiting) showMorning([]);
  $("endbox").classList.toggle("show", d.over);
  scrollLog(true);
});
es.addEventListener("state", (e) => applyState(JSON.parse(e.data)));
es.addEventListener("say", (e) => addLine(JSON.parse(e.data)));
es.addEventListener("bubble", (e) => { const d = JSON.parse(e.data); bubble(d.id, d.text); });
es.addEventListener("overheard", (e) => {
  const d = JSON.parse(e.data);
  const lines = d.text.split("\n").map((l) => l.match(/^\s*([^:]{1,30}):\s*(.+)$/)).filter(Boolean);
  lines.forEach((m, i) => {
    const who = (state?.people || []).find((p) => m[1].toLowerCase().includes(p.first.toLowerCase()));
    if (who) setTimeout(() => bubble(who.id, m[2], 3200), i * 2600);
  });
});
es.addEventListener("dusk", () => showNight([]));
es.addEventListener("night", (e) => showNight(JSON.parse(e.data), true));
es.addEventListener("dawn", (e) => {
  const d = JSON.parse(e.data);
  player.x = d.pos.x; player.y = d.pos.y;
  applyState(d.state, true);
  showMorning();
});
es.addEventListener("ended", () => { $("nightbox").classList.remove("show"); $("endbox").classList.add("show"); });

function removePerson(id) {
  const p = people[id];
  if (!p) return;
  scene.remove(p.model.root);
  p.tag?.remove(); p.bubbleEl?.remove();
  delete people[id];
}

function applyState(s, snap = false) {
  const was = state;
  state = s;
  $("day").textContent = s.day;
  $("clock").textContent = s.clock;
  setPaused(s.paused);
  const placeName = PLACE_NAMES[s.place] || "the lane";
  if ($("place").textContent !== placeName) {
    $("place").textContent = placeName;
    if (was && s.place !== "road") toast(`You enter ${placeName}.`);
  }
  updateTalk();
  const ids = new Set();
  for (const p of s.people) {
    ids.add(p.id);
    let me = people[p.id];
    if (!me) {
      const start = p.at || map.HOUSES[p.id] || map.START;
      me = people[p.id] = { x: start.x + 0.5, y: start.y + 0.5, path: [], heading: 0, moving: false, t: Math.random() * 9, shown: !p.home, target: null, model: makePerson(LOOKS[p.id] || LOOKS.player) };
      scene.add(me.model.root);
      me.tag = document.createElement("div"); me.tag.className = "tag"; $("labels").appendChild(me.tag);
    }
    me.info = p;
    if (!p.at) { me.shown = false; continue; }
    if (snap) { me.x = p.at.x + 0.5; me.y = p.at.y + 0.5; me.path = []; me.shown = !p.home; me.target = p.at; continue; }
    if (!me.target || me.target.x !== p.at.x || me.target.y !== p.at.y) {
      if (!me.shown && !p.home) { const h = map.HOUSES[p.id]; me.x = h.x + 0.5; me.y = h.y + 0.5; me.shown = true; }
      me.target = p.at;
      me.path = map.findPath(Math.floor(me.x), Math.floor(me.y), p.at.x, p.at.y) || [p.at];
    }
  }
  for (const k of Object.keys(people)) if (!ids.has(k)) removePerson(k);
}

// ---------- pause ----------

function setPaused(p) {
  paused = !!p;
  $("playbtn").textContent = paused ? "▶ Play" : "❚❚ Pause";
  $("pausebox").classList.toggle("show", paused);
  $("playbtn").style.background = paused ? "" : "#9ab8e0";
  if (paused) keys.clear();
}
$("playbtn").onclick = () => togglePause();
function togglePause() {
  setPaused(!paused);
  post("/pause", { paused });
  $("playbtn").blur();
  if (paused && document.activeElement === $("in")) $("in").blur();
}

// ---------- the side panel ----------

function addLine(text) {
  const log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/^\s+/, (m) => (m.length > 2 ? "  " : ""));
    if (!line.trim()) continue;
    const d = document.createElement("div");
    if (/^> /.test(line)) d.className = "you";
    else if (/^\[.+(every word|part of it)\]$/.test(line)) d.className = "hearhead";
    else if (/^\* /.test(line) || /walks straight up to you/.test(line)) d.className = "event";
    else if (/^\s*- /.test(line) || /bells ring|Day \d+ begins/.test(line)) d.className = "night";
    else if (/^[A-Z][a-z]+( [A-Z][a-z]+)?: /.test(line)) d.className = talking() && line.startsWith(firstOf(talking()) + ":") ? "say" : "hear";
    else d.className = "info";
    d.textContent = line;
    log.appendChild(d);
  }
  scrollLog(atBottom);
}
function scrollLog(force) { if (force) $("log").scrollTop = $("log").scrollHeight; }
const firstOf = (id) => state?.people.find((p) => p.id === id)?.first || id;

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2200);
}

// ---------- talking ----------
// Enter next to someone starts a conversation. While talking, Enter sends what you typed;
// Enter on an empty line says goodbye.

const talking = () => state?.talkingTo || null;

function updateTalk() {
  const who = talking();
  $("talk").classList.toggle("show", !!who);
  $("hint").style.display = who ? "none" : "block";
  if (who) {
    $("who").innerHTML = `Talking to <b>${firstOf(who)}</b>. Press Enter on an empty line to say goodbye.`;
    if (document.activeElement !== $("in")) $("in").focus();
  } else if (document.activeElement === $("in")) $("in").blur();
}

const post = (url, data) => fetch(url, { method: "POST", body: JSON.stringify(data || {}) });
const act = (data) => {
  if (paused) { toast("The game is paused. Press Play first."); return; }
  return post("/act", data);
};

function startTalk(id) {
  const p = people[id];
  act({ cmd: `talk ${firstOf(id)}`, near: id, at: { x: Math.floor(p.x), y: Math.floor(p.y) } });
  p.path = []; // they stop where they are
  state.talkingTo = id;
  updateTalk();
}
function endTalk() {
  if (talking()) act({ cmd: "bye" });
  state.talkingTo = null;
  updateTalk();
}

$("in").addEventListener("keydown", (e) => {
  e.stopPropagation(); // keys typed here are words, not game controls
  if (e.key === "Enter") {
    e.preventDefault();
    const text = $("in").value.trim();
    $("in").value = "";
    if (!text) return endTalk();
    if (paused) { toast("The game is paused. Press Play first."); return; }
    if (talking()) { act({ cmd: text, near: talking(), echo: text, speech: true }); bubble("player", text); }
  } else if (e.key === "Escape") { e.preventDefault(); endTalk(); }
});

$("end-new").onclick = () => post("/new");
$("night-ok").onclick = () => { $("nightbox").classList.remove("show"); nightOn = false; post("/morning"); };

function nearest() {
  let best = null, bd = 1.8;
  for (const [id, p] of Object.entries(people)) {
    if (!p.shown || p.info?.home) continue;
    const d = map.dist(p.x, p.y, player.x, player.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// ---------- keyboard ----------

const MOVE_KEYS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };

window.addEventListener("keydown", (e) => {
  if (document.activeElement === $("in")) return;
  const k = e.key.toLowerCase();
  if (k === "p") { togglePause(); return; }
  if (paused || nightOn) return;
  if (MOVE_KEYS[k]) { e.preventDefault(); keys.add(k); return; }
  if (k === "enter") {
    e.preventDefault();
    if (talking()) { $("in").focus(); return; }
    const id = nearest();
    if (id) startTalk(id); else toast("Walk right up to someone, then press Enter.");
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
holder.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(1.8, zoom * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });

// ---------- movement ----------

const FOOT = 0.25; // half the width of the player's feet, in tiles
const free = (x, y) => map.walkable(Math.floor(x - FOOT), Math.floor(y - FOOT)) && map.walkable(Math.floor(x + FOOT), Math.floor(y - FOOT))
  && map.walkable(Math.floor(x - FOOT), Math.floor(y + FOOT)) && map.walkable(Math.floor(x + FOOT), Math.floor(y + FOOT));

// how wide one map step east is at this latitude, so walking speed feels the same everywhere
const widthAt = (y) => Math.max(0.3, Math.sin((y / map.H) * Math.PI));

function stepToward(o, tx, ty, speed, dt) {
  const dx = map.dxTo(o.x, tx) * widthAt(o.y), dy = ty - o.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  const m = Math.min(d, speed * dt);
  o.x = map.wrapX(o.x + ((dx / d) * m) / widthAt(o.y)); o.y += (dy / d) * m;
  o.heading = Math.atan2(dx, dy);
  return m >= d - 0.001;
}

function faceToward(o, tx, ty) { o.heading = Math.atan2(map.dxTo(o.x, tx) * widthAt(o.y), ty - o.y); }

// When you walk into a corner or just miss a doorway, ease sideways so you slip through.
function slide(nx, ny, axis, dt) {
  const step = PLAYER_SPEED * dt;
  for (const off of [0.2, -0.2, 0.4, -0.4]) {
    const tx = axis === "x" ? nx + off : nx, ty = axis === "y" ? ny + off : ny;
    if (free(tx, ty)) {
      if (axis === "x") player.x = map.wrapX(player.x + Math.sign(off) * Math.min(step, Math.abs(off)));
      else player.y += Math.sign(off) * Math.min(step, Math.abs(off));
      return;
    }
  }
}

let sendTimer = 0;

function update(dt) {
  // the player
  let vx = 0, vy = 0;
  if (!nightOn) for (const k of keys) { const v = MOVE_KEYS[k]; if (v) { vx += v[0]; vy += v[1]; } }
  player.moving = false;
  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    const nx = map.wrapX(player.x + ((vx / len) * PLAYER_SPEED * dt) / widthAt(player.y)), ny = player.y + (vy / len) * PLAYER_SPEED * dt;
    if (free(nx, player.y)) player.x = nx;
    else if (vy === 0) slide(nx, player.y, "y", dt);
    if (free(player.x, ny)) player.y = ny;
    else if (vx === 0) slide(player.x, ny, "x", dt);
    player.heading = Math.atan2(vx, vy);
    player.moving = true;
  }
  if (player.moving) player.t += dt;

  // villagers walk their paths
  for (const [id, p] of Object.entries(people)) {
    p.moving = false;
    if (!p.shown) continue;
    const next = p.path[0];
    if (next) {
      if (stepToward(p, next.x + 0.5, next.y + 0.5, WALK_SPEED, dt)) p.path.shift();
      p.moving = true;
      p.t += dt;
    } else if (p.info?.home) {
      p.shown = false; // went inside
    } else if (state?.talkingTo === id) {
      faceToward(p, player.x, player.y);
    } else {
      const pair = state?.pairs.find((q) => q.includes(id));
      const other = pair && people[pair[0] === id ? pair[1] : pair[0]];
      if (other && map.dist(other.x, other.y, p.x, p.y) < 2) faceToward(p, other.x, other.y);
    }
  }

  // tell the server where we are
  const pos = `${player.x.toFixed(2)},${player.y.toFixed(2)}`;
  sendTimer -= dt;
  if (pos !== lastSent && sendTimer <= 0) {
    lastSent = pos; sendTimer = 0.25;
    post("/pos", { x: player.x, y: player.y });
  }
}

// ---------- speech bubbles ----------

function bubble(id, text, ms) {
  const o = id === "player" ? player : people[id];
  if (!o) return;
  if (!o.bubbleEl) { o.bubbleEl = document.createElement("div"); o.bubbleEl.className = id === "player" ? "bubble you" : "bubble"; $("labels").appendChild(o.bubbleEl); }
  o.bubbleEl.textContent = text;
  o.bubbleUntil = performance.now() + (ms || Math.min(9000, 2500 + text.length * 55));
}

// ---------- drawing ----------

function resize() {
  const r = holder.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const camPos = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
let camReady = false;

function placePerson(o) {
  const s = placeOn(o.model.root, o.x, o.y, 0);
  o.model.body.rotation.y = o.heading;
  return s;
}

// where a point on the globe shows up on screen, or null if it is round the back
const tmp = new THREE.Vector3();
function screenAt(x, y, h) {
  const s = surface(x, y, h);
  tmp.copy(camera.position).sub(s.pos);
  if (tmp.dot(s.n) < 0.5) return null;
  tmp.copy(s.pos).project(camera);
  if (tmp.z > 1) return null;
  const r = renderer.domElement;
  return [(tmp.x * 0.5 + 0.5) * r.clientWidth, (-tmp.y * 0.5 + 0.5) * r.clientHeight];
}

// place names floating over each place
const placeTags = Object.entries(map.ZONES).map(([k, [x0, y0, x1, y1]]) => {
  const el = document.createElement("div"); el.className = "place"; el.textContent = PLACE_NAMES[k].replace(/^the /, "");
  $("labels").appendChild(el);
  return { el, x: (x0 + x1 + 1) / 2, y: k === "square" || k === "market" || k === "garden" ? y1 + 1.6 : y0 - 0.6 };
});

function draw(now) {
  // camera: above and a little behind the player, so the planet curves away in front
  const s = placePerson(player);
  const dist = view.dist * zoom;
  const want = s.pos.clone().addScaledVector(s.n, dist * view.up).addScaledVector(s.south, dist * view.back);
  if (!camReady) { camPos.copy(want); camUp.copy(s.n); camReady = true; }
  camPos.lerp(want, 0.12); camUp.lerp(s.n, 0.12).normalize();
  camera.position.copy(camPos);
  camera.up.copy(camUp);
  camera.lookAt(s.pos.clone().addScaledVector(s.n, view.lookUp).addScaledVector(s.south, -view.lookAhead));
  sun.position.copy(camera.position).addScaledVector(s.east, 6).addScaledVector(s.n, 4);
  sun.target.position.copy(s.pos);

  // evening light
  const m = state?.minute ?? 480;
  const dusk = Math.max(0, Math.min(1, (m - 16 * 60) / 240));
  hemi.intensity = 1.6 - dusk * 0.9; sun.intensity = 1.6 - dusk * 1.1;
  sun.color.set(dusk > 0.3 ? "#ffc89a" : "#fff0d8");
  holder.classList.toggle("night", dusk > 0.6);

  const near = talking() ? null : nearest();
  animate(player.model, player.moving && !paused, player.t);
  for (const [id, p] of Object.entries(people)) {
    p.model.root.visible = p.shown;
    if (!p.shown) { p.tag.style.display = "none"; continue; }
    placePerson(p);
    animate(p.model, p.moving && !paused, p.moving ? p.t : paused ? 0 : now / 1000 + p.t);
    const pt = map.dist(p.x, p.y, player.x, player.y) < 7 && screenAt(p.x, p.y, 1.25);
    p.tag.style.display = pt ? "block" : "none";
    if (pt) { p.tag.style.left = pt[0] + "px"; p.tag.style.top = pt[1] + "px"; p.tag.classList.toggle("near", id === near); p.tag.textContent = p.info.first; }
  }
  for (const o of [player, ...Object.values(people)]) {
    if (!o.bubbleEl) continue;
    const pt = now < o.bubbleUntil && (o === player || o.shown) && screenAt(o.x, o.y, 1.5);
    o.bubbleEl.style.display = pt ? "block" : "none";
    if (pt) { o.bubbleEl.style.left = pt[0] + "px"; o.bubbleEl.style.top = Math.max(50, pt[1] - 22) + "px"; }
  }
  for (const t of placeTags) {
    const pt = screenAt(t.x, t.y, 1.8);
    t.el.style.display = pt ? "block" : "none";
    if (pt) { t.el.style.left = pt[0] + "px"; t.el.style.top = pt[1] + "px"; }
  }
  renderer.render(scene, camera);
}

function showNight(lines, done) {
  if (lines === null || lines === undefined) { $("nightbox").classList.remove("show"); nightOn = false; return; }
  nightOn = true;
  keys.clear();
  $("nightbox").classList.add("show");
  $("night-title").textContent = "The bells ring eight. The day is over.";
  $("night-text").textContent = done ? "Overnight, the town made up its mind:" : "The town goes to bed and makes up its mind...";
  $("night-lines").innerHTML = "";
  for (const l of lines) { const li = document.createElement("li"); li.textContent = l; $("night-lines").appendChild(li); }
  if (done && !lines.length) $("night-lines").innerHTML = "<li>A quiet night. Nobody's mind changed much.</li>";
  $("night-ok").style.display = "none";
}
function showMorning(lines) {
  if (lines) showNight(lines, true);
  $("night-text").textContent = "Morning comes. The clock waits for you.";
  $("night-ok").textContent = `Start day ${state?.day ?? ""}`;
  $("night-ok").style.display = "inline-block";
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  draw(now);
}
function loop(now) { frame(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// Some browsers stop animation frames for a page that is not on screen. Keep the town moving anyway.
setInterval(() => { const now = performance.now(); if (now - last > 120) frame(now); }, 50);

// for poking at the game from the browser console
window.thistlewick = { player, people, view, get state() { return state; } };
