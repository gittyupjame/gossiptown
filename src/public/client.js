// The browser side of Thistlewick. It draws the town, moves the player, walks the
// villagers to where the server says they are, shows every line of speech as a bubble
// over the speaker's head, and plays out the vote. The server makes every decision.

import * as THREE from "three";
import * as map from "./map.js";
import { buildTown } from "./town.js";
import { LOOKS, makePerson, animate, setMood, emoteSprite, portrait } from "./people.js";
import { makeRenderer, makeComposer, makeSky, lightAt } from "./fx.js";

const $ = (id) => document.getElementById(id);
const PLACE_NAMES = { plaza: "the town square", salon: "Curl Up & Dye salon", cafe: "the Daisy Cup café", bakery: "Sugarplum Bakery", boutique: "Velvet Boutique", winebar: "the Rosé Garden", postoffice: "the post office", park: "Willow Park", florist: "Petal & Thorn", road: "out and about" };
const PLAYER_SPEED = 3.0, WALK_SPEED = 1.5; // tiles per second

// ---------- the scene ----------

const holder = $("world");
const renderer = makeRenderer(holder);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog("#e8f0fa", 38, 95);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
const hemi = new THREE.HemisphereLight("#fff4ec", "#9ac08a", 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff0dc", 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const sky = makeSky(scene);
const town = buildTown(scene);
const fx = makeComposer(renderer, scene, camera);

const pics = {}; // portraits, made once
const pic = (id) => (pics[id] ||= portrait(LOOKS[id] || LOOKS.player));

let state = null;
const people = {};      // id -> { x, y, path, goal, heading, moving, t, shown, model, info }
const player = { id: "player", x: map.START.x, y: map.START.y, heading: 0, moving: false, t: 0, model: makePerson(LOOKS.player), shown: true };
scene.add(player.model.root);
// a soft pink ring under the player so you can always find yourself
const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 32), new THREE.MeshBasicMaterial({ color: "#ff6a9a", transparent: true, opacity: 0.75, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
player.model.root.add(ring);
const host = { id: "honey", x: map.STAGE.x, y: map.STAGE.y, heading: 0, moving: false, t: 0, model: makePerson(LOOKS.honey), shown: false };
host.model.root.visible = false;
scene.add(host.model.root);

let lastSent = "", nightOn = false, paused = true, talking = null, ceremony = null, zoom = 1, started = false;
const keys = new Set();

// ---------- sound: soft blips for voices, a chime, a drum roll ----------

let audio = null;
function sound() { if (!audio) try { audio = new AudioContext(); } catch { } return audio; }
const PITCH = { player: 520, vivienne: 440, pippa: 700, ivy: 560, wren: 480, sylvie: 380, marigold: 600, odette: 340, juniper: 620, hesper: 300, honey: 500 };
function blip(id, gain = 0.035) {
  const a = sound(); if (!a || paused) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = "triangle"; o.frequency.value = (PITCH[id] || 500) * (0.9 + Math.random() * 0.25);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.07);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.08);
}
function chime(notes = [880, 1320], gain = 0.05) {
  const a = sound(); if (!a) return;
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + i * 0.1;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.55);
  });
}
function drumroll(seconds) {
  const a = sound(); if (!a) return;
  for (let i = 0; i < seconds * 14; i++) {
    const t0 = a.currentTime + i / 14, b = a.createBuffer(1, 2000, a.sampleRate), d = b.getChannelData(0);
    for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
    const s = a.createBufferSource(), g = a.createGain(); s.buffer = b;
    g.gain.value = 0.02 + (i / (seconds * 14)) * 0.05;
    s.connect(g).connect(a.destination); s.start(t0);
  }
}

// ---------- server events ----------

const es = new EventSource("/events");
es.addEventListener("reset", (e) => {
  const d = JSON.parse(e.data);
  player.x = d.pos.x; player.y = d.pos.y;
  for (const k of Object.keys(people)) removePerson(k);
  applyState(d.state, true);
  showNight(d.night);
  if (d.waiting) showMorning(d.state.day, d.state.voteIn === 0);
  if (d.over) showEnd(d.over);
  else $("endbox").classList.remove("show");
});
es.addEventListener("state", (e) => applyState(JSON.parse(e.data)));
es.addEventListener("bubble", (e) => { const d = JSON.parse(e.data); unthink(d.id); say(d.id, d.text, { mood: d.mood }); });
es.addEventListener("opened", (e) => {
  const d = JSON.parse(e.data);
  talking = d.id;
  if (people[d.id]) people[d.id].path = [];
  say(d.id, d.text, { mood: "curious" });
  chime([660, 990], 0.03);
  updateTalk();
});
es.addEventListener("overheard", (e) => {
  const d = JSON.parse(e.data);
  const lines = d.text.split("\n").map((l) => l.match(/^\s*([^:]{1,30}):\s*(.+)$/)).filter(Boolean);
  let delay = 0;
  for (const m of lines) {
    const who = (state?.people || []).find((p) => m[1].toLowerCase().includes(p.first.toLowerCase()));
    if (!who) continue;
    setTimeout(() => say(who.id, m[2], { far: !d.full, mood: d.mood }), delay);
    delay += readTime(m[2]) + 500;
  }
});
es.addEventListener("emote", (e) => { const d = JSON.parse(e.data); emote(d.id, d.kind); });
es.addEventListener("learned", (e) => {
  const d = JSON.parse(e.data);
  toast(`New gossip from ${firstOf(d.from)}`, d.text, d.from);
  chime([990, 1480], 0.04);
});
es.addEventListener("dusk", () => showNight([]));
es.addEventListener("night", () => {});
es.addEventListener("dawn", (e) => {
  const d = JSON.parse(e.data);
  player.x = d.pos.x; player.y = d.pos.y;
  applyState(d.state, true);
  showMorning(d.day, d.voteTonight);
});
es.addEventListener("ceremony", (e) => runCeremony(JSON.parse(e.data)));
es.addEventListener("ended", (e) => showEnd(JSON.parse(e.data)));

function removePerson(id) {
  const p = people[id];
  if (!p) return;
  scene.remove(p.model.root);
  p.tag?.remove(); p.bubble?.el.remove();
  delete people[id];
}

const firstOf = (id) => (id === "player" ? "You" : id === "honey" ? "Honey" : state?.people.find((p) => p.id === id)?.first || id);
const nameOf = (id) => (id === "player" ? "you" : state?.people.find((p) => p.id === id)?.name || id);

function applyState(s, snap = false) {
  const was = state;
  state = s;
  $("day").textContent = s.day;
  $("clock").textContent = s.clock;
  const chip = $("votechip");
  chip.textContent = s.voteIn === 0 ? "Vote tonight at 6" : `Vote in ${s.voteIn} day${s.voteIn > 1 ? "s" : ""}`;
  chip.classList.toggle("tonight", s.voteIn === 0);
  setPaused(s.paused);
  const placeName = PLACE_NAMES[s.place] || "out and about";
  if ($("place").textContent !== placeName) $("place").textContent = placeName;
  if (was && !s.talkingTo && talking && !ceremony) { talking = null; }
  if (s.talkingTo && !talking) talking = s.talkingTo;
  updateTalk();
  for (const p of s.people) {
    let me = people[p.id];
    if (p.gone && !(ceremony && me)) { if (me && !me.leaving) removePerson(p.id); continue; }
    if (!me) {
      const start = p.at || map.HOUSES[p.id] || map.START;
      me = people[p.id] = { id: p.id, x: start.x + 0.5, y: start.y + 0.5, path: [], heading: 0, moving: false, t: Math.random() * 9, shown: !p.home, goal: null, model: makePerson(LOOKS[p.id] || LOOKS.player) };
      scene.add(me.model.root);
      me.tag = document.createElement("div"); me.tag.className = "tag";
      me.tag.innerHTML = `<i style="background:${(LOOKS[p.id] || LOOKS.player).color}"></i>${p.first}`;
      $("labels").appendChild(me.tag);
    }
    me.info = p;
    if (!p.at || me.leaving) { if (!p.at) me.shown = false; continue; }
    const gx = p.at.exact ? p.at.x : p.at.x + 0.5, gy = p.at.exact ? p.at.y : p.at.y + 0.5;
    if (snap) { me.x = gx; me.y = gy; me.path = []; me.shown = !p.home; me.goal = p.at; continue; }
    if (talking === p.id && !ceremony) continue; // she stays put while you talk
    if (!me.goal || me.goal.x !== p.at.x || me.goal.y !== p.at.y) {
      if (!me.shown && !p.home) { const h = map.HOUSES[p.id]; me.x = h.x + 0.5; me.y = h.y + 0.5; me.shown = true; }
      me.goal = p.at;
      const path = map.findPath(Math.floor(me.x), Math.floor(me.y), Math.floor(p.at.x), Math.floor(p.at.y)) || [];
      me.path = path.map((q) => ({ x: q.x + 0.5, y: q.y + 0.5 }));
      if (p.at.exact) me.path.push({ x: gx, y: gy });
    }
  }
}

// ---------- pause ----------

function setPaused(p) {
  paused = !!p;
  $("playbtn").textContent = paused ? "▶ Play" : "❚❚ Pause";
  $("pausebox").classList.toggle("show", paused && !$("endbox").classList.contains("show"));
  if (started) $("pause-title").textContent = "Paused. The whole town is stopped.";
  if (paused) keys.clear();
}
function togglePause() {
  sound()?.resume?.();
  started = true;
  setPaused(!paused);
  post("/pause", { paused });
  $("playbtn").blur();
}
$("playbtn").onclick = togglePause;
$("pause-play").onclick = togglePause;

// ---------- speech bubbles ----------

const readTime = (text) => 900 + text.length * 32 + Math.min(4000, text.length * 40);
const speakers = () => ({ player, honey: host, ...people });

// Show a line over someone's head. Lines from the same person wait their turn.
function say(id, text, { mood, far } = {}) {
  const who = speakers()[id];
  if (!who) return;
  (who.queue ||= []).push({ text, mood, far });
  if (!who.bubble) nextLine(who);
}
function nextLine(who) {
  const line = who.queue.shift();
  if (!line) { who.bubble = null; return; }
  const el = document.createElement("div");
  el.className = "bubble" + (line.far ? " far" : "") + (who.id === "player" ? " you" : "");
  el.style.display = "none"; // shown once it has a place on screen
  el.style.setProperty("--c", (LOOKS[who.id] || LOOKS.player).color);
  el.innerHTML = `<b>${who.id === "player" ? "You" : firstOf(who.id)}</b><span></span>`;
  $("labels").appendChild(el);
  const span = el.querySelector("span");
  setMood(who.model, line.mood || (line.far ? "neutral" : who.model.mood));
  const b = (who.bubble = { el, start: performance.now(), text: line.text, shown: 0 });
  who.model.gestureUntil = who.t + 1.2 + Math.random();
  const typing = setInterval(() => {
    if (paused) return;
    b.shown = Math.min(line.text.length, b.shown + 2);
    span.textContent = line.text.slice(0, b.shown);
    if (b.shown % 4 === 0 && !line.far) blip(who.id);
    if (b.shown >= line.text.length) {
      clearInterval(typing);
      b.done = true;
      setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); nextLine(who); }, 300); }, 1200 + line.text.length * 38);
    }
  }, 45);
}
// "..." over someone while Claude writes her reply
function think(id) {
  const who = speakers()[id];
  if (!who || who.thinking) return;
  const el = document.createElement("div");
  el.className = "bubble thinking";
  el.style.display = "none";
  el.style.setProperty("--c", (LOOKS[id] || LOOKS.player).color);
  el.textContent = "• • •";
  $("labels").appendChild(el);
  who.thinking = el;
}
function unthink(id) { const who = speakers()[id]; if (who?.thinking) { who.thinking.remove(); who.thinking = null; } }

function emote(id, kind) {
  const who = speakers()[id];
  if (!who || !who.shown) return;
  const s = emoteSprite(kind);
  s.position.set(0.45, 1.85, 0);
  who.model.root.add(s);
  const t0 = performance.now();
  (who.emotes ||= []).push({ s, t0 });
  if (kind === "angry") setMood(who.model, "angry");
  if (kind === "shocked" || kind === "exclaim") setMood(who.model, "shocked");
  if (kind === "heart") setMood(who.model, "happy");
  if (kind === "sly") setMood(who.model, "sly");
}

// ---------- talking ----------

const inputBubble = document.createElement("div");
inputBubble.className = "bubble input you";
inputBubble.style.display = "none";
inputBubble.innerHTML = `<input id="in" autocomplete="off" maxlength="300" placeholder="Say something..."><small>Enter on empty = bye</small>`;
$("labels").appendChild(inputBubble);
const input = inputBubble.querySelector("input");

function updateTalk() {
  const on = !!talking && !ceremony && !nightOn;
  inputBubble.style.display = on ? "flex" : "none";
  $("hint").style.opacity = on || ceremony ? 0 : 1;
  if (on && document.activeElement !== input && !paused) input.focus();
  if (!on && document.activeElement === input) input.blur();
}

const post = (url, data) => fetch(url, { method: "POST", body: JSON.stringify(data || {}) });
const act = (data) => (paused ? null : post("/act", data));

function startTalk(id) {
  const p = people[id];
  talking = id;
  p.path = [];
  act({ cmd: `talk ${firstOf(id)}`, near: id, at: { x: Math.floor(p.x), y: Math.floor(p.y) } });
  updateTalk();
}
function endTalk() {
  if (talking) act({ cmd: "bye" });
  talking = null;
  updateTalk();
}

input.addEventListener("keydown", (e) => {
  e.stopPropagation(); // keys typed here are words, not game controls
  if (e.key === "Enter") {
    e.preventDefault();
    const text = input.value.trim();
    input.value = "";
    if (!text) return endTalk();
    if (paused || !talking) return;
    say("player", text);
    think(talking);
    act({ cmd: text, near: talking, speech: true });
  } else if (e.key === "Escape") { e.preventDefault(); endTalk(); }
  else if (e.key === "Tab") { e.preventDefault(); toggleTracker(); }
});

function nearest() {
  let best = null, bd = 1.9;
  for (const [id, p] of Object.entries(people)) {
    if (!p.shown || p.info?.home || p.info?.gone) continue;
    const d = map.dist(p.x, p.y, player.x, player.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// ---------- keyboard ----------

const MOVE_KEYS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "tab") { e.preventDefault(); toggleTracker(); return; }
  if ($("tracker").classList.contains("show")) { if (k === "escape") toggleTracker(); return; }
  if (k === "p") { togglePause(); return; }
  if (paused || nightOn || ceremony) return;
  if (MOVE_KEYS[k]) { e.preventDefault(); keys.add(k); return; }
  if (k === "enter") {
    e.preventDefault();
    if (talking) { input.focus(); return; }
    const id = nearest();
    if (id) startTalk(id); else toast("Nobody close enough", "Walk right up to someone, then press Enter.");
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
holder.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.65, Math.min(1.5, zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });

// ---------- toasts ----------

function toast(title, text, from) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${from && from !== "self" ? `<img src="${pic(from)}">` : ""}<div><b></b><span></span></div>`;
  el.querySelector("b").textContent = title;
  el.querySelector("span").textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 6500);
}

// ---------- the rumor tracker (Tab) ----------

let tab = "cast", tdata = null;
async function toggleTracker() {
  const t = $("tracker");
  if (t.classList.contains("show")) { t.classList.remove("show"); if (talking) input.focus(); return; }
  t.classList.add("show");
  keys.clear();
  tdata = await (await fetch("/tracker")).json();
  renderTracker();
}
$("trackbtn").onclick = toggleTracker;
for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => { tab = b.dataset.t; renderTracker(); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const img = (id) => (id && id !== "self" && id !== "anonymous" && id !== "truth" ? `<img src="${pic(id === "player" ? "player" : id)}">` : `<img>`);

function renderTracker() {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.t === tab);
  const d = tdata, main = $("tk-main");
  if (!d) return;
  const nm = (id) => (id === "player" ? "you" : d.cast.find((c) => c.id === id)?.name.split(" ")[0] || id);
  if (tab === "cast") {
    main.innerHTML = `<div class="cast">${d.cast.map((c) => `<div class="who ${c.gone ? "gone" : ""}">${img(c.id)}<h3>${esc(c.name)}</h3><div class="job">${esc(c.job)}</div>
      <div class="chips"><span class="chip ${c.vibe}">${{ warm: "likes you", friendly: "friendly", unsure: "unsure of you", cold: "cold to you", hostile: "can't stand you" }[c.vibe]}</span>
      ${c.ally ? `<span class="chip ally">says she's with you</span>` : ""}
      ${c.voteFor ? `<span class="chip">says she'll vote out ${esc(nm(c.voteFor))}</span>` : ""}
      ${c.saysTarget ? `<span class="chip">says she wants ${esc(nm(c.saysTarget))} gone</span>` : ""}</div></div>`).join("")}</div>
      <p style="color:var(--soft);text-align:center;margin-top:16px">What people tell you is what they <i>say</i>. They might be lying.</p>`;
  } else if (tab === "learned") {
    main.innerHTML = d.learned.length ? d.learned.slice().reverse().map((r) => `<div class="rumor">${img(r.from)}<div><div class="t">${esc(r.text)}</div>
      <div class="m">${r.how === "overheard" ? "Overheard from" : "Told to you by"} ${esc(nm(r.from))} · day ${r.day}, ${r.time}${r.about ? ` · about ${esc(nm(r.about))}` : ""}</div></div></div>`).join("")
      : `<div class="empty">You haven't heard anything juicy yet. Stand close to people talking, or ask around.</div>`;
  } else if (tab === "told") {
    const alive = d.cast.filter((c) => !c.gone).length;
    main.innerHTML = d.told.length ? d.told.slice().reverse().map((r) => {
      const known = r.spread.filter((x) => !x.gone);
      return `<div class="rumor">${img(r.to)}<div style="flex:1"><div class="t">${esc(r.text)}</div>
        <div class="m">You told ${esc(nm(r.to))} · day ${r.day}, ${r.time}${r.about ? ` · about ${esc(nm(r.about))}` : ""}</div>
        <div class="bar"><i style="width:${Math.round((known.length / Math.max(1, alive)) * 100)}%"></i></div>
        <div class="spread"><b style="font-size:12px;color:var(--soft)">${known.length} of ${alive} have heard it:</b>${r.spread.map((x) => `<span class="${x.believes ? "" : "no"}" title="${x.believes ? "believes it" : "doesn't believe it"}">${img(x.id)}${esc(nm(x.id))}${x.from && x.from !== "player" ? ` <small>(from ${esc(nm(x.from))})</small>` : ""}${x.twisted ? " ✎" : ""}</span>`).join("")}</div>
        ${r.versions.length ? `<div class="m">It has changed as it spread: “${esc(r.versions[r.versions.length - 1])}”</div>` : ""}</div></div>`;
    }).join("") : `<div class="empty">You haven't started any rumors. Tell someone something about someone else, and watch where it goes.</div>`;
  } else if (tab === "you") {
    main.innerHTML = d.aboutYou.length ? d.aboutYou.map((r) => `<div class="rumor"><img src="${pic("player")}"><div><div class="t">${esc(r.text)}</div><div class="m">${r.known} ${r.known === 1 ? "person knows" : "people know"}</div></div></div>`).join("")
      : `<div class="empty">Nobody is talking about you. Yet.</div>`;
  } else if (tab === "votes") {
    main.innerHTML = d.votes.length ? d.votes.map((v) => `<div class="vote"><h4>Day ${v.day}: ${esc(nm(v.out))} ${v.out === "player" ? "were" : "was"} voted out</h4>
      <div class="ballots">${(v.ballots || []).map((b) => `<span>${esc(nm(b.voter))} → ${esc(nm(b.target))}</span>`).join("")}</div></div>`).join("")
      : `<div class="empty">No votes yet. The first one is on day ${d.nextVote} at six o'clock in the square.</div>`;
  }
}

// ---------- the vote ----------

const badges = {};
function badge(id, n) {
  let b = badges[id];
  if (!b) { b = badges[id] = document.createElement("div"); b.className = "votebadge"; $("labels").appendChild(b); }
  b.textContent = n;
  b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitQuiet = async (id) => { const w = speakers()[id]; while (w && (w.bubble || w.queue?.length)) await wait(150); };

async function runCeremony(d) {
  if (d.stage === "gather") {
    ceremony = { stage: "gather" };
    talking = null; updateTalk(); keys.clear();
    $("tracker").classList.remove("show");
    $("fade").classList.add("on");
    await wait(800);
    for (const [id, p] of Object.entries(d.spots)) {
      if (id === "player") { player.x = p.x; player.y = p.y; player.heading = Math.PI; continue; }
      const me = people[id];
      if (me) { me.x = p.x; me.y = p.y; me.path = []; me.shown = true; me.heading = Math.PI; me.goal = { ...p, exact: true }; }
    }
    host.shown = true; host.model.root.visible = true; host.x = map.STAGE.x; host.y = map.STAGE.y; host.heading = 0;
    $("votebanner").classList.add("show");
    $("fade").classList.remove("on");
    drumroll(1.2);
  }
  if (d.stage === "ballot") {
    ceremony = { stage: "ballot" };
    say("honey", d.host, { mood: "happy" });
    await waitQuiet("honey");
    const opts = $("ballot-opts");
    opts.innerHTML = "";
    for (const id of d.candidates) {
      const b = document.createElement("button");
      b.innerHTML = `<img src="${pic(id)}"><span>${esc(firstOf(id))}</span>`;
      b.onclick = () => {
        post("/vote", { target: id });
        $("ballot").classList.remove("show");
        emote("player", "vote");
        toast("Your vote is in", `You wrote down ${nameOf(id)}.`);
        ceremony.stage = "counting";
      };
      opts.appendChild(b);
    }
    $("ballot").classList.add("show");
  }
  if (d.stage === "reveal") {
    ceremony = { stage: "reveal" };
    $("ballot").classList.remove("show");
    const tally = {};
    say("honey", "Let's see how you all voted, my darlings...", { mood: "sly" });
    await waitQuiet("honey");
    for (const b of d.order) {
      const line = b.voter === "player" ? `I'm voting for ${d.names[b.target]}.` : b.line && b.line !== "..." ? b.line : `I vote for ${d.names[b.target]}.`;
      emote(b.voter, "vote");
      say(b.voter, line, { mood: "smug" });
      await waitQuiet(b.voter);
      tally[b.target] = (tally[b.target] || 0) + 1;
      badge(b.target, tally[b.target]);
      blip("honey", 0.06);
      emote(b.target, tally[b.target] >= 3 ? "shocked" : "doubt");
      await wait(500);
    }
    say("honey", d.hostReveal, { mood: "sly" });
    await waitQuiet("honey");
    drumroll(2.2);
    await wait(2300);
    chime([523, 659, 784, 1046], 0.06);
    const isMe = d.out === "player";
    $("out-img").src = pic(d.out);
    $("out-title").textContent = isMe ? "You're going home" : `${d.names[d.out]} is going home`;
    $("out-text").textContent = `${d.count[d.out]} vote${d.count[d.out] === 1 ? "" : "s"}${d.tie ? ", after a tie" : ""}.`;
    $("outbox").classList.add("show");
    await wait(3200);
    $("outbox").classList.remove("show");
    if (d.parting && !isMe) {
      setMood(people[d.out]?.model || {}, "sad");
      say(d.out, d.parting, { mood: "sad" });
      await waitQuiet(d.out);
      // she walks away down the lane and out of town
      const me = people[d.out];
      if (me) { me.leaving = true; me.path = (map.findPath(Math.floor(me.x), Math.floor(me.y), 32, 40) || []).map((q) => ({ x: q.x + 0.5, y: q.y + 0.5 })); }
      await wait(2500);
    }
    for (const b of Object.values(badges)) b.remove();
    for (const k of Object.keys(badges)) delete badges[k];
    post("/ceremony-next");
  }
  if (d.stage === "end") {
    ceremony = null;
    host.shown = false; host.model.root.visible = false;
    $("votebanner").classList.remove("show");
    for (const [id, p] of Object.entries(people)) if (p.leaving) removePerson(id);
  }
  updateTalk();
}

// ---------- night, morning, the end ----------

function showNight(lines) {
  if (lines === null || lines === undefined) { $("nightbox").classList.remove("show"); nightOn = false; return; }
  nightOn = true; keys.clear(); talking = null; updateTalk();
  $("night-title").textContent = "Goodnight";
  $("night-text").textContent = "The town goes to bed, and each woman decides who she wants gone.";
  $("night-ok").style.display = "none";
  $("nightbox").classList.add("show");
}
function showMorning(day, voteTonight) {
  nightOn = true;
  $("night-title").textContent = `Day ${day}`;
  $("night-text").textContent = voteTonight ? "Tonight at six, the town votes someone out. Make your deals while you can." : "A new day. Find out who is against you before the vote.";
  $("night-ok").textContent = `Start day ${day}`;
  $("night-ok").style.display = "inline-block";
  $("nightbox").classList.add("show");
}
$("night-ok").onclick = () => { $("nightbox").classList.remove("show"); nightOn = false; post("/morning"); };
function showEnd(r) {
  $("end-title").textContent = r.won ? "You won!" : "Voted out";
  $("end-text").textContent = r.won ? "Last woman standing. Thistlewick is yours." : "The town has spoken. Pack your bags, newcomer.";
  $("endbox").classList.add("show");
  $("pausebox").classList.remove("show");
}
$("end-new").onclick = () => { $("endbox").classList.remove("show"); post("/new"); };

// ---------- movement ----------

const FOOT = 0.24;
const free = (x, y) => map.walkable(Math.floor(x - FOOT), Math.floor(y - FOOT)) && map.walkable(Math.floor(x + FOOT), Math.floor(y - FOOT))
  && map.walkable(Math.floor(x - FOOT), Math.floor(y + FOOT)) && map.walkable(Math.floor(x + FOOT), Math.floor(y + FOOT));

function stepToward(o, tx, ty, speed, dt) {
  const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  const m = Math.min(d, speed * dt);
  o.x += (dx / d) * m; o.y += (dy / d) * m;
  turnTo(o, Math.atan2(dx, dy), dt);
  return m >= d - 0.001;
}
function turnTo(o, h, dt) {
  let d = h - o.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  o.heading += d * Math.min(1, dt * 10);
}
function faceToward(o, tx, ty, dt) { turnTo(o, Math.atan2(tx - o.x, ty - o.y), dt); }

let sendTimer = 0;
function update(dt) {
  let vx = 0, vy = 0;
  if (!nightOn && !ceremony && !talking) for (const k of keys) { const v = MOVE_KEYS[k]; if (v) { vx += v[0]; vy += v[1]; } }
  player.moving = false;
  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    const nx = player.x + (vx / len) * PLAYER_SPEED * dt, ny = player.y + (vy / len) * PLAYER_SPEED * dt;
    if (free(nx, player.y)) player.x = nx;
    if (free(player.x, ny)) player.y = ny;
    turnTo(player, Math.atan2(vx, vy), dt);
    player.moving = true;
  } else if (talking && people[talking]) faceToward(player, people[talking].x, people[talking].y, dt);
  else if (ceremony) turnTo(player, Math.PI, dt);
  player.t += dt;

  for (const [id, p] of Object.entries(people)) {
    p.moving = false;
    p.t += dt;
    if (!p.shown) continue;
    const next = p.path[0];
    if (next) {
      if (stepToward(p, next.x, next.y, ceremony && !p.leaving ? WALK_SPEED * 3 : WALK_SPEED, dt)) p.path.shift();
      p.moving = true;
    } else if (p.leaving) {
      p.shown = false;
    } else if (p.info?.home) {
      p.shown = false; // went inside
    } else if (talking === id) {
      faceToward(p, player.x, player.y, dt);
    } else if (ceremony) {
      faceToward(p, host.x, host.y, dt);
    } else {
      const pair = state?.pairs.find((q) => q.includes(id));
      const other = pair && people[pair[0] === id ? pair[1] : pair[0]];
      if (other && map.dist(other.x, other.y, p.x, p.y) < 2.2) faceToward(p, other.x, other.y, dt);
    }
  }
  host.t += dt;

  // tell the server where we are
  const pos = `${player.x.toFixed(2)},${player.y.toFixed(2)}`;
  sendTimer -= dt;
  if (pos !== lastSent && sendTimer <= 0 && !ceremony) {
    lastSent = pos; sendTimer = 0.25;
    post("/pos", { x: player.x, y: player.y });
  }
}

// ---------- drawing ----------

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  fx.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camReady = false;
const v3 = new THREE.Vector3();

function screenAt(x, y, h) {
  v3.set(x, h, y).project(camera);
  if (v3.z > 1 || Math.abs(v3.x) > 1.2 || Math.abs(v3.y) > 1.2) return null;
  return [(v3.x * 0.5 + 0.5) * window.innerWidth, (-v3.y * 0.5 + 0.5) * window.innerHeight];
}
const headAt = (o) => (o === player ? 1.75 : 1.8) * (LOOKS[o.id]?.height || 1);

function place(o) {
  o.model.root.position.set(o.x, o === host ? 0.55 : 0, o.y); // the host stands up on the stage
  o.model.body.rotation.y = o.heading;
}

renderer.info.autoReset = false;
function draw(now, dt) {
  renderer.info.reset();
  const t = now / 1000;
  // camera: above and behind the player, or a wide shot of the stage during the vote
  const want = ceremony ? new THREE.Vector3(32, 8.5 * zoom, 30) : new THREE.Vector3(player.x, 17 * zoom, player.y + 12 * zoom);
  const look = ceremony ? new THREE.Vector3(32, 1.2, 18.2) : new THREE.Vector3(player.x, 0.6, player.y + 0.6);
  if (!camReady) { camPos.copy(want); camLook.copy(look); camReady = true; }
  const k = Math.min(1, dt * (ceremony ? 2.5 : 5));
  camPos.lerp(want, k); camLook.lerp(look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);

  // light through the day
  const L = lightAt(state?.minute ?? 600);
  sun.color.copy(L.sun); sun.intensity = L.sunI; hemi.intensity = L.hemi;
  sun.position.set(camLook.x - 10, 22, camLook.z + 6); sun.target.position.copy(camLook);
  sky.material.uniforms.top.value.copy(L.top); sky.material.uniforms.bottom.value.copy(L.bottom);
  sky.position.copy(camera.position);
  scene.fog.color.copy(L.fog);
  fx.bloom.strength = ceremony ? Math.max(0.5, L.bloom) : L.bloom;
  town.update(t, L.night);

  // people
  const near = talking || ceremony ? null : nearest();
  for (const o of [player, host, ...Object.values(people)]) {
    o.model.root.visible = o.shown;
    if (!o.shown) { if (o.tag) o.tag.style.display = "none"; continue; }
    place(o);
    const lookAt = (talking === o.id || o === player) && talking ? undefined : undefined;
    animate(o.model, { walking: o.moving && !paused, t: paused ? 0 : o.t, dt: paused ? 0 : dt, talking: !!o.bubble && !o.bubble.done, lookAt });
    // emotes float up and fade
    if (o.emotes) o.emotes = o.emotes.filter((e) => {
      const age = (now - e.t0) / 1000;
      if (age > 2.6) { o.model.root.remove(e.s); return false; }
      e.s.position.y = 1.85 + Math.min(0.25, age * 0.8) + Math.sin(age * 6) * 0.03;
      const sc = age < 0.2 ? age / 0.2 * 0.6 : 0.55;
      e.s.scale.set(sc, sc, 1);
      e.s.material.opacity = age > 2.2 ? (2.6 - age) / 0.4 : 1;
      return true;
    });
    const h = headAt(o);
    if (o.tag) {
      const pt = !ceremony && map.dist(o.x, o.y, player.x, player.y) < 8 && screenAt(o.x, o.y, h + 0.2);
      o.tag.style.display = pt && !o.bubble ? "flex" : "none";
      if (pt) { o.tag.style.left = pt[0] + "px"; o.tag.style.top = pt[1] + "px"; o.tag.classList.toggle("near", o.id === near); }
    }
    const pt = screenAt(o.x, o.y, h + 0.25);
    if (o.bubble) { o.bubble.el.style.display = pt ? "block" : "none"; if (pt) { o.bubble.el.style.left = pt[0] + "px"; o.bubble.el.style.top = Math.max(60, pt[1]) + "px"; } }
    if (o.thinking) { o.thinking.style.display = pt && !o.bubble ? "block" : "none"; if (pt) { o.thinking.style.left = pt[0] + "px"; o.thinking.style.top = pt[1] + "px"; } }
    if (badges[o.id]) { const bp = screenAt(o.x, o.y, h + 0.12); if (bp) { badges[o.id].style.left = bp[0] + "px"; badges[o.id].style.top = bp[1] + "px"; } }
  }
  if (badges.player && !player.shown) badges.player.style.display = "none";
  if (inputBubble.style.display !== "none") {
    const pt = screenAt(player.x, player.y, headAt(player) + 0.25);
    if (pt) { inputBubble.style.left = pt[0] + "px"; inputBubble.style.top = Math.max(60, pt[1] - (player.bubble ? 70 : 0)) + "px"; }
  }
  unclutter();
  fx.composer.render();
}

// Keep speech bubbles from covering each other: where two overlap, lift the higher one.
function unclutter() {
  const els = [...document.querySelectorAll("#labels .bubble, #labels .votebadge")].filter((e) => e.style.display !== "none" && e.offsetParent !== null);
  const boxes = els.map((el) => ({ el, x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight }));
  boxes.sort((a, b) => b.y - a.y);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) {
      const a = boxes[i], b = boxes[j]; // a is higher on screen than b
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 6;
      if (overlapX && a.y > b.y - b.h - 6) a.y = b.y - b.h - 8; // tops and bottoms are the anchor: top = y - h
    }
  }
  for (const bx of boxes) bx.el.style.top = Math.max(bx.h + 50, bx.y) + "px";
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  draw(now, dt);
}
function loop(now) { frame(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// Some browsers stop animation frames for a page that is not on screen. Keep the town moving anyway.
setInterval(() => { const now = performance.now(); if (now - last > 120) frame(now); }, 50);

// portraits for everyone, made in idle moments so the first Tab press is quick
setTimeout(() => Object.keys(LOOKS).forEach((id, i) => setTimeout(() => pic(id), i * 60)), 1500);

// for poking at the game from the browser console
window.thistlewick = { player, people, host, renderer, get state() { return state; }, say, emote };
