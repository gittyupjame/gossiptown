// Everything drawn over people's heads: speech bubbles, the bubble you type into,
// little emotes, name tags and place names. All of it is HTML positioned from 3D.

import * as THREE from "three";
import { camera } from "./scene.js";
import * as audio from "./audio.js";

const layer = document.getElementById("labels");
const anchors = new Map(); // id -> () => Vector3 (top of head)
const v3 = new THREE.Vector3();
let viewW = window.innerWidth, viewH = window.innerHeight;
window.addEventListener("resize", () => { viewW = window.innerWidth; viewH = window.innerHeight; });

export function setAnchor(id, fn) { anchors.set(id, fn); }

// How loud someone is: near the camera is full volume, across town is a murmur.
function loudness(id) {
  const fn = anchors.get(id);
  if (!fn) return 0.6;
  const d = fn().distanceTo(camera.position);
  return Math.max(0.12, Math.min(1, 1.3 - d / 28));
}

function project(p) {
  v3.copy(p).project(camera);
  const behind = v3.z > 1;
  return { x: (v3.x * 0.5 + 0.5) * viewW, y: (-v3.y * 0.5 + 0.5) * viewH, behind };
}

const active = new Set(); // { el, id, offset, clamp, update?(dt) }

function place(item) {
  const fn = anchors.get(item.id);
  if (!fn) { item.el.style.display = "none"; return; }
  const p = fn().clone();
  p.y += item.offset || 0;
  let { x, y, behind } = project(p);
  let off = false;
  if (item.clamp) {
    const m = 70;
    if (behind) { x = viewW - x; y = viewH - m; off = true; }
    if (x < m || x > viewW - m || y < m + 40 || y > viewH - m) off = true;
    x = Math.max(m + 40, Math.min(viewW - m - 40, x));
    // keep the whole bubble below the HUD (or the letterbox bars during a ceremony)
    const top = document.body.classList.contains("cinema") ? viewH * 0.07 + 14 : 76;
    y = Math.max(top + (item.el.firstElementChild?.offsetHeight || 60) + 14, Math.min(viewH - m, y));
  } else if (behind) { item.el.style.display = "none"; return; }
  item.el.style.display = "";
  item.el.classList.toggle("offscreen", off);
  item.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

export function frame(dt) {
  for (const item of active) {
    item.update?.(dt);
    if (item.dead) { item.el.remove(); active.delete(item); continue; }
    place(item);
  }
}

// ---------- speech bubbles ----------

const speaking = new Map(); // id -> current bubble

export function say(id, text, { name = "", color = "#ff8fb8", muffled = false, hold = null, you = false, onDone } = {}) {
  speaking.get(id)?.close();
  const el = document.createElement("div");
  el.className = `bubble${muffled ? " muffled" : ""}${you ? " you" : ""}`;
  el.innerHTML = `<div class="bwrap"><div class="bname" style="color:${color}"></div><div class="btext"></div></div>`;
  el.querySelector(".bname").textContent = name;
  layer.appendChild(el);
  const tEl = el.querySelector(".btext");
  let shown = 0, full = text || "", life = 0, closing = false, voiced = 0;
  const speed = 42; // characters per second
  const item = {
    el, id, offset: 0.55, clamp: true, dead: false,
    update(dt) {
      life += dt;
      if (shown < full.length) {
        shown = Math.min(full.length, shown + dt * speed);
        tEl.textContent = full.slice(0, Math.ceil(shown));
        // she babbles along as her words appear (a syllable every few letters)
        if (full !== "…" && voiced < 48 * 3.2) while (shown - voiced >= 3.2) {
          voiced += 3.2;
          const ch = full[Math.floor(voiced)] || "a";
          audio.speakTick(id, /[a-z]/i.test(ch) ? ch : "a", { gain: (you ? 0.6 : 1) * loudness(id), muffled, ask: /\?\s*$/.test(full), end: shown >= full.length - 3 });
        }
      }
      const need = hold ?? Math.max(2.6, 1.4 + full.length / 15);
      if (!closing && shown >= full.length && full !== "…" && life > full.length / speed + need) item.close();
    },
    set(t) { full = t; },
    get talking() { return !closing && (shown < full.length); },
    close() {
      if (closing) return;
      closing = true;
      el.classList.add("out");
      setTimeout(() => { item.dead = true; onDone?.(); }, 260);
      if (speaking.get(id) === item) speaking.delete(id);
    },
  };
  requestAnimationFrame(() => el.classList.add("in"));
  active.add(item);
  speaking.set(id, item);
  return item;
}

// a "…" bubble while someone thinks of what to say
export function thinking(id, opts = {}) {
  const b = say(id, "", { ...opts, hold: 9999 });
  b.el.classList.add("thinking");
  b.el.querySelector(".btext").innerHTML = `<span class="dots"><i></i><i></i><i></i></span>`;
  b.set("…");
  const orig = b.set;
  b.reveal = (t) => { b.el.classList.remove("thinking"); b.el.querySelector(".btext").textContent = ""; orig(t); };
  return b;
}

export const isTalking = (id) => !!speaking.get(id)?.talking;
export const hasBubble = (id) => speaking.has(id);
export function hush(id) { speaking.get(id)?.close(); }
export function hushAll() { for (const b of [...speaking.values()]) b.close(); }

// ---------- the bubble you type into ----------

export function typing(id, { name, placeholder = "Say something…", hint = "Enter to say it · empty Enter to say goodbye", onSubmit, onCancel }) {
  speaking.get(id)?.close();
  const el = document.createElement("div");
  el.className = "bubble you typing in";
  el.innerHTML = `<div class="bwrap"><div class="bname" style="color:#e86f5a"></div><div class="btext"><span class="typed"></span><span class="caret"></span><span class="ph"></span></div><div class="bhint"></div></div>`;
  el.querySelector(".bname").textContent = name;
  el.querySelector(".ph").textContent = placeholder;
  el.querySelector(".bhint").textContent = hint;
  layer.appendChild(el);
  const input = document.getElementById("speech");
  input.value = "";
  input.disabled = false;
  const typed = el.querySelector(".typed"), ph = el.querySelector(".ph");
  const sync = () => { typed.textContent = input.value; ph.style.display = input.value ? "none" : ""; };
  input.oninput = sync;
  input.onkeydown = (e) => {
    if (e.key.startsWith("Arrow")) { e.preventDefault(); return; } // arrows still walk while you type
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const v = input.value.trim(); input.value = ""; sync(); audio.sfx(v ? "send" : "click"); v ? onSubmit(v) : onCancel?.(); }
    else if (e.key.length === 1 || e.key === "Backspace") audio.sfx("key");
    else if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
    else if (e.key === "Tab") { e.preventDefault(); window.dispatchEvent(new CustomEvent("toggle-tracker")); }
    e.stopPropagation();
  };
  setTimeout(() => input.focus(), 0);
  const item = {
    el, id, offset: 0.55, clamp: true, dead: false,
    close() { item.dead = true; input.blur(); input.oninput = input.onkeydown = null; },
    lock(on) { el.classList.toggle("locked", on); input.disabled = on; if (!on) setTimeout(() => input.focus(), 0); },
    focus() { input.focus(); },
  };
  active.add(item);
  return item;
}

// ---------- emotes ----------

const EMOTES = { anger: "💢", gasp: "❗", whisper: "🤫", suspicious: "👀", handshake: "🤝", heart: "💖", sad: "💧", vote: "🗳️", crown: "👑", sparkle: "✨", question: "❓", tea: "☕", bell: "🔔", wave: "👋", star: "💫", pow: "💥", gift: "🎁", flower: "🌸", laugh: "😂", cringe: "😬" };
export function emote(id, kind, { silent = false } = {}) {
  if (!kind || !EMOTES[kind]) return;
  if (!silent) audio.emote(id, kind, { gain: loudness(id) });
  const el = document.createElement("div");
  el.className = "emote";
  el.textContent = EMOTES[kind];
  layer.appendChild(el);
  let life = 0;
  const item = { el, id, offset: 0.35, dead: false, update(dt) { life += dt; if (life > 1.9) item.dead = true; } };
  active.add(item);
}

// a comic-book word that pops over someone ("POW!")
export function pop(id, text) {
  audio.sfx(/SLAP|THWAP|BAP/.test(text) ? "slap" : "pow", { gain: 0.5 * loudness(id) });
  const el = document.createElement("div");
  el.className = "fx-pop";
  el.textContent = text;
  el.style.marginLeft = `${Math.round(Math.random() * 60 - 40)}px`;
  el.style.marginTop = `${Math.round(Math.random() * 30 - 50)}px`;
  layer.appendChild(el);
  let life = 0;
  const item = { el, id, offset: 0.1, dead: false, update(dt) { life += dt; if (life > 0.75) item.dead = true; } };
  active.add(item);
}

// ---------- name tags ----------

const tags = new Map();
export function tag(id, name, sub = "") {
  const el = document.createElement("div");
  el.className = "tag";
  el.innerHTML = `<b></b><span class="tsub"></span><span class="tkey">Enter</span>`;
  el.querySelector("b").textContent = name;
  el.querySelector(".tsub").textContent = sub;
  layer.appendChild(el);
  const item = { el, id, offset: 0.12, dead: false };
  tags.set(id, item);
  active.add(item);
  return item;
}
export function tagState(id, { show, near, sub }) {
  const t = tags.get(id);
  if (!t) return;
  t.el.classList.toggle("show", !!show);
  t.el.classList.toggle("near", !!near);
  if (sub !== undefined && t.sub !== sub) { t.sub = sub; t.el.querySelector(".tsub").textContent = sub; }
}
export function tagName(id, name) { const t = tags.get(id); if (t) t.el.querySelector("b").textContent = name; }
export function removeTag(id) { const t = tags.get(id); if (t) { t.dead = true; tags.delete(id); } }

// ---------- floating labels anywhere (place names, vote tallies) ----------

export function label(id, html, cls, offset = 0) {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  layer.appendChild(el);
  const item = { el, id, offset, dead: false, remove() { item.dead = true; } };
  active.add(item);
  return item;
}
