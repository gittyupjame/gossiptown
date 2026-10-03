// The browser side: draws the town, moves the player, walks villagers to where the
// server says they are, and shows speech bubbles. The server makes every decision.

import * as map from "./map.js";
import { T, drawTown, personFrames, LOOKS } from "./sprites.js";

const $ = (id) => document.getElementById(id);
const cv = $("world"), ctx = cv.getContext("2d");
const town = drawTown(map);
const frames = Object.fromEntries(Object.entries(LOOKS).map(([id, look]) => [id, personFrames(look)]));

const PLACE_NAMES = { square: "the village square", bakery: "Marigold's bakery", smithy: "the smithy", tavern: "the Crooked Kettle tavern", market: "the market stalls", garden: "the herb garden", hall: "the elder's hall", road: "the lane" };
const PLAYER_SPEED = 4.5, WALK_SPEED = 2.6; // tiles per second

let state = null;
const people = {};      // id -> { x, y, path, dir, moving, anim, shown, bubble }
const player = { x: map.START.x + 0.5, y: map.START.y + 0.5, dir: 0, moving: false, anim: 0, bubble: null };
let following = null, mode = "idle", menuFor = null, lastSent = "", nightOn = false;
const keys = new Set();

// ---------- server events ----------

const es = new EventSource("/events");
es.addEventListener("reset", (e) => {
  const d = JSON.parse(e.data);
  $("log").innerHTML = "";
  d.lines.forEach(addLine);
  player.x = d.pos.x; player.y = d.pos.y;
  for (const k of Object.keys(people)) delete people[k];
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
    const who = Object.values(state?.people || []).find((p) => m[1].toLowerCase().includes(p.first.toLowerCase()));
    if (who) setTimeout(() => bubble(who.id, m[2], 3200), i * 2600);
  });
});
es.addEventListener("dusk", () => showNight([]));
es.addEventListener("night", (e) => showNight(JSON.parse(e.data), true));
es.addEventListener("dawn", (e) => {
  const d = JSON.parse(e.data);
  player.x = d.pos.x; player.y = d.pos.y; following = null;
  applyState(d.state, true);
  showMorning();
});
function showMorning(lines) {
  if (lines) showNight(lines, true);
  $("night-text").textContent = "Morning comes. The clock waits for you.";
  $("night-ok").textContent = `Start day ${state?.day ?? ""}`;
  $("night-ok").style.display = "inline-block";
}
es.addEventListener("ended", () => { $("nightbox").classList.remove("show"); $("endbox").classList.add("show"); });

function applyState(s, snap = false) {
  const was = state;
  state = s;
  $("day").textContent = s.day;
  $("clock").textContent = s.clock;
  const placeName = PLACE_NAMES[s.place] || "the lane";
  if ($("place").textContent !== placeName) {
    $("place").textContent = placeName;
    if (was && s.place !== "road") toast(`You enter ${placeName}.`);
  }
  if (was?.talkingTo && !s.talkingTo && mode === "say") setMode("idle");
  if (s.talkingTo && mode !== "say") setMode("say");
  updateWho();
  const ids = new Set();
  for (const p of s.people) {
    ids.add(p.id);
    let me = people[p.id];
    if (!me) {
      const start = p.at || map.HOUSES[p.id] || map.START;
      me = people[p.id] = { x: start.x + 0.5, y: start.y + 0.5, path: [], dir: 0, moving: false, anim: 0, shown: !p.home, bubble: null, target: null };
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
  for (const k of Object.keys(people)) if (!ids.has(k)) delete people[k];
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
    else if (/^[A-Z][a-z]+( [A-Z][a-z]+)?: /.test(line)) d.className = state?.talkingTo && line.startsWith(firstOf(state.talkingTo) + ":") ? "say" : "hear";
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

function setMode(m) {
  mode = m;
  const input = $("in");
  input.placeholder = m === "say" ? `Say something to ${firstOf(state?.talkingTo)}... (Esc to say goodbye)`
    : m === "do" ? "Describe what you do, then press Enter... (Esc to cancel)"
    : "Press Enter to type";
  if (m === "say" || m === "do") input.focus();
  updateWho();
}
function updateWho() {
  const who = $("who");
  if (mode === "say" && state?.talkingTo) who.innerHTML = `Talking to <b>${firstOf(state.talkingTo)}</b>. Walk away or press <kbd>Esc</kbd> to stop.`;
  else if (mode === "do") who.innerHTML = `Doing something at <b>${PLACE_NAMES[state?.place] || "the lane"}</b>. Everyone here will see it.`;
  else if (following) who.innerHTML = `Following <b>${firstOf(following)}</b>. Press an arrow key to stop.`;
  else who.innerHTML = `Walk up to someone and press <kbd>E</kbd>.`;
}

const post = (url, data) => fetch(url, { method: "POST", body: JSON.stringify(data || {}) });
const act = (data) => post("/act", data);

$("f").onsubmit = (e) => {
  e.preventDefault();
  const text = $("in").value.trim();
  $("in").value = "";
  if (!text) { if (mode !== "say") $("in").blur(); return; }
  if (mode === "say" && state?.talkingTo) {
    act({ cmd: text, near: state.talkingTo, echo: text, speech: true });
    bubble("player", text);
  } else if (mode === "do") {
    act({ cmd: `do ${text}`, echo: `(you ${text})` });
    setMode("idle"); $("in").blur();
  } else if (/^(journal|map|bag|help|stats|do|note|wait)\b/i.test(text)) {
    act({ cmd: text, echo: text });
  } else {
    toast("To talk, walk up to someone and press E.");
  }
};

$("in").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (mode === "say") act({ cmd: "bye" });
    setMode("idle");
    $("in").blur();
  }
});

$("b-do").onclick = () => { closeMenus(); setMode("do"); };
$("b-journal").onclick = () => act({ cmd: "journal", echo: "journal" });
$("b-map").onclick = () => act({ cmd: "map", echo: "who likes who" });
$("b-bag").onclick = () => act({ cmd: "bag", echo: "bag" });
$("b-new").onclick = () => { if (confirm("Start a fresh town? Your current game will be replaced.")) post("/new"); };
$("end-new").onclick = () => post("/new");
$("night-ok").onclick = () => { $("nightbox").classList.remove("show"); nightOn = false; post("/morning"); };

$("b-note").onclick = () => {
  closeMenus();
  $("note-to").innerHTML = state.people.map((p) => `<option value="${p.first}">${p.name} (${p.job})</option>`).join("");
  $("notebox").classList.add("show");
  $("note-text").focus();
};
$("note-send").onclick = () => {
  const text = $("note-text").value.trim();
  if (!text) return;
  act({ cmd: `note ${$("note-to").value} ${text}`, echo: `(a note for ${$("note-to").value}) ${text}` });
  $("note-text").value = "";
  closeMenus();
};
$("note-close").onclick = closeMenus;

// ---------- the person menu ----------

function nearest() {
  let best = null, bd = 1.7;
  for (const [id, p] of Object.entries(people)) {
    if (!p.shown || p.info?.home) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

function openPersonMenu(id) {
  closeMenus();
  menuFor = id;
  const p = people[id].info;
  $("pm-name").textContent = p.name;
  $("pm-job").textContent = p.job;
  $("pm-follow").innerHTML = following === id ? "<kbd>F</kbd> Stop following" : "<kbd>F</kbd> Follow";
  $("personmenu").classList.add("show");
}
function closeMenus() {
  for (const m of document.querySelectorAll(".menu")) m.classList.remove("show");
  menuFor = null;
}
const menuOpen = () => !!document.querySelector(".menu.show");

function startTalk(id) {
  closeMenus();
  following = null;
  act({ cmd: `talk ${firstOf(id)}`, near: id });
  state.talkingTo = id;
  setMode("say");
}
function openGifts(id) {
  closeMenus();
  menuFor = id;
  $("gifts").innerHTML = "";
  for (const item of state.bag) {
    const b = document.createElement("button");
    b.textContent = item;
    b.onclick = () => { act({ cmd: `give ${firstOf(id)} ${item}`, near: id }); closeMenus(); };
    $("gifts").appendChild(b);
  }
  if (!state.bag.length) $("gifts").textContent = "Your bag is empty.";
  $("giftmenu").classList.add("show");
}
function toggleFollow(id) {
  closeMenus();
  following = following === id ? null : id;
  if (following) toast(`You keep a casual distance behind ${firstOf(id)}.`);
  updateWho();
}
$("pm-talk").onclick = () => startTalk(menuFor);
$("pm-give").onclick = () => openGifts(menuFor);
$("pm-follow").onclick = () => toggleFollow(menuFor);
$("pm-close").onclick = closeMenus;
$("gm-close").onclick = closeMenus;

// ---------- keyboard ----------

const MOVE_KEYS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };

window.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (typing) { if (e.key === "Escape") { closeMenus(); document.activeElement.blur(); } return; }
  const k = e.key.toLowerCase();
  if (MOVE_KEYS[k]) {
    e.preventDefault();
    keys.add(k);
    if (menuOpen()) closeMenus();
    if (following) { following = null; updateWho(); }
    return;
  }
  if (k === "escape") { closeMenus(); if (mode === "say") { act({ cmd: "bye" }); setMode("idle"); } return; }
  if ($("personmenu").classList.contains("show")) {
    if (k === "t") { e.preventDefault(); return startTalk(menuFor); }
    if (k === "g") return openGifts(menuFor);
    if (k === "f") return toggleFollow(menuFor);
  }
  if (k === "e" && !nightOn) {
    const id = nearest();
    if (id) openPersonMenu(id); else toast("Nobody is close enough. Walk right up to someone.");
    return;
  }
  if (k === "enter") { e.preventDefault(); $("in").focus(); }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

// ---------- movement ----------

const R = 0.28; // half the width of the player's feet, in tiles
const free = (x, y) => map.walkable(Math.floor(x - R), Math.floor(y - R / 2)) && map.walkable(Math.floor(x + R), Math.floor(y - R / 2))
  && map.walkable(Math.floor(x - R), Math.floor(y + R)) && map.walkable(Math.floor(x + R), Math.floor(y + R));

function stepToward(o, tx, ty, speed, dt) {
  const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  const m = Math.min(d, speed * dt);
  o.x += (dx / d) * m; o.y += (dy / d) * m;
  o.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
  return m >= d - 0.001;
}

function face(o, tx, ty) {
  const dx = tx - o.x, dy = ty - o.y;
  o.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
}

// When you walk into a corner or just miss a doorway, ease sideways so you slip through.
function slide(nx, ny, axis) {
  const step = PLAYER_SPEED * 0.016 * 3;
  for (const off of [0.2, -0.2, 0.4, -0.4]) {
    const tx = axis === "x" ? nx + off : nx, ty = axis === "y" ? ny + off : ny;
    if (free(tx, ty)) {
      if (axis === "x") player.x += Math.sign(off) * Math.min(step, Math.abs(off));
      else player.y += Math.sign(off) * Math.min(step, Math.abs(off));
      return;
    }
  }
}

let followPath = [], followRecalc = 0;

function update(dt) {
  // the player
  let vx = 0, vy = 0;
  if (!nightOn) for (const k of keys) { const v = MOVE_KEYS[k]; if (v) { vx += v[0]; vy += v[1]; } }
  player.moving = false;
  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    const nx = player.x + (vx / len) * PLAYER_SPEED * dt, ny = player.y + (vy / len) * PLAYER_SPEED * dt;
    if (free(nx, player.y)) player.x = nx;
    else if (vy === 0) slide(nx, player.y, "y");
    if (free(player.x, ny)) player.y = ny;
    else if (vx === 0) slide(player.x, ny, "x");
    player.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 2 : 3) : vy < 0 ? 1 : 0;
    player.moving = true;
  } else if (following && people[following]?.shown) {
    const t = people[following];
    if (Math.hypot(t.x - player.x, t.y - player.y) > 1.6) {
      followRecalc -= dt;
      if (followRecalc <= 0 || !followPath.length) { followPath = map.findPath(Math.floor(player.x), Math.floor(player.y), Math.floor(t.x), Math.floor(t.y)) || []; followRecalc = 0.6; }
      const next = followPath[0];
      if (next && stepToward(player, next.x + 0.5, next.y + 0.5, PLAYER_SPEED * 0.8, dt)) followPath.shift();
      player.moving = true;
    }
  } else if (following && people[following] && !people[following].shown) {
    toast(`${firstOf(following)} has gone indoors for the night.`);
    following = null; updateWho();
  }
  if (player.moving) player.anim += dt;

  // villagers walk their paths
  for (const [id, p] of Object.entries(people)) {
    p.moving = false;
    if (!p.shown) continue;
    const next = p.path[0];
    if (next) {
      if (stepToward(p, next.x + 0.5, next.y + 0.5, WALK_SPEED, dt)) p.path.shift();
      p.moving = true;
      p.anim += dt;
    } else if (p.info?.home) {
      p.shown = false; // went inside
    } else if (state?.talkingTo === id) {
      face(p, player.x, player.y);
    } else {
      const pair = state?.pairs.find((q) => q.includes(id));
      const other = pair && people[pair[0] === id ? pair[1] : pair[0]];
      if (other && Math.hypot(other.x - p.x, other.y - p.y) < 2) face(p, other.x, other.y);
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
let sendTimer = 0;

// ---------- speech bubbles ----------

function bubble(id, text, ms) {
  const o = id === "player" ? player : people[id];
  if (!o) return;
  o.bubble = { text, until: performance.now() + (ms || Math.min(9000, 2500 + text.length * 55)) };
}

function wrap(text, width) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

function drawBubble(sx, sy, text) {
  ctx.font = "13px ui-monospace, Menlo, monospace";
  const lines = wrap(text, 210);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, h = lines.length * 16 + 10;
  let x = Math.round(sx - w / 2), y = Math.round(sy - h - 10);
  x = Math.max(4, Math.min(cv.width - w - 4, x)); y = Math.max(46, y); // stay below the clock box
  ctx.fillStyle = "rgba(250,246,234,0.96)"; ctx.strokeStyle = "#2a2218"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx - 5, y + h); ctx.lineTo(sx, y + h + 8); ctx.lineTo(sx + 5, y + h); ctx.fill();
  ctx.fillStyle = "#2a2218";
  lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 17 + i * 16));
}

// ---------- drawing ----------

let SCALE = 3;
function resize() {
  const r = cv.getBoundingClientRect();
  cv.width = Math.floor(r.width); cv.height = Math.floor(r.height);
  SCALE = cv.width < 700 ? 2 : 3;
}
window.addEventListener("resize", resize);
resize();

function draw(now) {
  const vw = cv.width / SCALE, vh = cv.height / SCALE;
  let cx = player.x * T - vw / 2, cy = player.y * T - vh / 2;
  cx = Math.max(0, Math.min(map.W * T - vw, cx)); cy = Math.max(0, Math.min(map.H * T - vh, cy));
  if (vw > map.W * T) cx = (map.W * T - vw) / 2;
  if (vh > map.H * T) cy = (map.H * T - vh) / 2;
  cx = Math.round(cx * SCALE) / SCALE; cy = Math.round(cy * SCALE) / SCALE;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#16140f"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(SCALE, 0, 0, SCALE, -cx * SCALE, -cy * SCALE);
  ctx.drawImage(town, 0, 0);

  // people, back to front
  const all = Object.entries(people).filter(([, p]) => p.shown).map(([id, p]) => ({ id, o: p }));
  all.push({ id: "player", o: player });
  all.sort((a, b) => a.o.y - b.o.y);
  for (const { id, o } of all) {
    const fr = frames[id] || frames.player;
    const f = o.moving ? 1 + (Math.floor(o.anim * 7) % 2) : 0;
    const px = Math.round(o.x * T), py = Math.round(o.y * T);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(px, py + 3, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(fr[o.dir][f], px - 9, py - 15);
  }

  // evening light
  const m = state?.minute ?? 480;
  if (m > 16 * 60) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(20,24,70,${Math.min(0.45, ((m - 960) / 240) * 0.45)})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  // names, the E prompt, and speech bubbles, in screen pixels
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const toScreen = (o) => [(o.x * T - cx) * SCALE, (o.y * T - cy) * SCALE];
  const near = !menuOpen() && mode !== "say" ? nearest() : null;
  ctx.font = "bold 12px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  for (const { id, o } of all) {
    if (id === "player") continue;
    const d = Math.hypot(o.x - player.x, o.y - player.y);
    if (d > 6) continue;
    const [sx, sy] = toScreen(o);
    const label = o.info.first + (id === near ? "  [E]" : "");
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const tw = ctx.measureText(label).width + 8;
    ctx.fillRect(sx - tw / 2, sy - 15 * SCALE - 18, tw, 16);
    ctx.fillStyle = id === near ? "#f0bf5e" : "#ece4cf";
    ctx.fillText(label, sx, sy - 15 * SCALE - 6);
  }
  ctx.textAlign = "left";
  for (const { o } of all) {
    if (!o.bubble) continue;
    if (now > o.bubble.until) { o.bubble = null; continue; }
    const [sx, sy] = toScreen(o);
    drawBubble(sx, sy - 15 * SCALE - 20, o.bubble.text);
  }
}

function showNight(lines, done) {
  if (lines === null || lines === undefined) { $("nightbox").classList.remove("show"); nightOn = false; return; }
  nightOn = true;
  keys.clear();
  closeMenus();
  $("nightbox").classList.add("show");
  $("night-title").textContent = "The bells ring eight. The day is over.";
  $("night-text").textContent = done ? "Overnight, the town made up its mind:" : "The town goes to bed and makes up its mind...";
  $("night-lines").innerHTML = "";
  for (const l of lines) { const li = document.createElement("li"); li.textContent = l; $("night-lines").appendChild(li); }
  if (done && !lines.length) $("night-lines").innerHTML = "<li>A quiet night. Nobody's mind changed much.</li>";
  $("night-ok").style.display = "none";
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(dt);
  draw(now);
}
function loop(now) { frame(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// Some browsers stop animation frames for a page that is not on screen. Keep the town moving anyway.
setInterval(() => { const now = performance.now(); if (now - last > 120) frame(now); }, 50);

// for poking at the game from the browser console
window.thistlewick = { player, people, get state() { return state; } };
