// The outfit chooser: on arrival (with your starting budget) and at the clothes rack by
// the salon (with whatever coins you have). Pieces you own are free to put back on.

import * as W from "../core/wardrobe.js";
import { fullPortrait } from "./people.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);
const TABS = [...W.SLOTS, { key: "skin", label: "Skin", icon: "🖐️" }];
const cap = (t) => t.replace(/^an? /, "").replace(/^./, (c) => c.toUpperCase());

let root = null;
function build() {
  root = document.createElement("div");
  root.id = "wardrobe";
  root.className = "screen";
  root.innerHTML = `<div class="card wardrobe pop">
    <div class="wd-left">
      <div class="wd-stage"><img id="wd-pic" alt=""><button class="wd-rot" id="wd-rl">⟲</button><button class="wd-rot r" id="wd-rr">⟳</button></div>
      <div id="wd-sum" class="wd-sum"></div>
    </div>
    <div class="wd-right">
      <div class="card-kicker" id="wd-kicker"></div>
      <h2 id="wd-title"></h2>
      <p class="muted wd-blurb" id="wd-blurb"></p>
      <div class="wd-tabs" id="wd-tabs"></div>
      <div class="wd-items" id="wd-items"></div>
      <div class="wd-foot">
        <div class="wd-purse" id="wd-purse"></div>
        <button class="big-btn ghost" id="wd-cancel">Never mind</button>
        <button class="big-btn" id="wd-ok"></button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(root);
}

// Resolves with the chosen outfit, or null if cancelled.
export function openWardrobe({ outfit, owned = [], coins, creation = false, playerName = "you" }) {
  if (!root) build();
  const o = { ...W.STARTER, ...outfit };
  let tab = "dress", angle = 0.35;
  const start = W.outfitKey(o);
  $("wd-kicker").textContent = creation ? "Before you arrive" : "Curl Up & Dye · the clothes rack";
  $("wd-title").textContent = creation ? `Dress ${playerName} for her debut` : "Change your look";
  $("wd-blurb").textContent = creation
    ? `You have ${coins} coins to spend. Everyone in town will size you up the moment you arrive, and every woman has her own taste.`
    : `Pieces you already own are free. The producers add ${W.STIPEND} coins to your purse every morning.`;
  $("wd-cancel").style.display = creation ? "none" : "";
  $("wd-ok").innerHTML = creation ? "Arrive in town <kbd>Enter</kbd>" : "Wear it <kbd>Enter</kbd>";

  const price = (id) => (W.owns(owned, id) ? 0 : W.ITEMS[id].price);
  const bill = () => W.SLOTS.reduce((t, sl) => t + price(o[sl.key]), 0);

  function draw() {
    $("wd-pic").src = fullPortrait(W.lookOf(o), { angle });
    const total = W.outfitCost(o), b = bill(), over = b > coins;
    const tags = Object.entries(W.tagsOf(o)).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([t]) => `<span class="chip">${t}</span>`).join("");
    $("wd-sum").innerHTML = `<div class="wd-worth">Looks <b>${W.priceWord(total)}</b></div><div class="wd-chips">${tags || '<span class="chip">plain</span>'}</div>`;
    $("wd-purse").innerHTML = `<span class="${over ? "over" : ""}">🪙 ${b} <small>of ${coins}</small></span>${over ? `<small class="over">${b - coins} over budget</small>` : `<small>${coins - b} left after this</small>`}`;
    $("wd-ok").disabled = over;
    $("wd-tabs").innerHTML = TABS.map((t) => `<button class="wd-tab${t.key === tab ? " on" : ""}" data-tab="${t.key}" title="${t.label}">${t.icon}<span>${t.label}</span></button>`).join("");
    let html = "";
    if (tab === "skin") {
      html = `<div class="wd-swatches">${W.SKINS.map((c) => `<button class="sw${o.skin === c ? " on" : ""}" data-skin="${c}" style="background:${c}"></button>`).join("")}</div><p class="muted small">Skin tone is just you. Nobody in town judges it.</p>`;
    } else {
      const ids = Object.keys(W.ITEMS).filter((id) => W.ITEMS[id].slot === tab);
      html = `<div class="wd-grid">${ids.map((id) => {
        const it = W.ITEMS[id], mine = W.owns(owned, id) && it.price > 0, p = price(id);
        return `<button class="wd-item${o[tab] === id ? " on" : ""}${p > coins ? " dear" : ""}" data-item="${id}">
          ${it.color ? `<i class="dot" style="background:${it.color}"></i>` : ""}<b>${cap(it.name)}</b>
          <span class="wd-price">${it.price === 0 ? "Free" : mine ? "Owned" : `🪙 ${it.price}`}</span>
          <span class="wd-tags">${it.tags.join(" · ")}</span></button>`;
      }).join("")}</div>`;
      if (tab === "dress") html += `<div class="wd-label">Color <small class="muted">(free)</small></div><div class="wd-swatches">${Object.entries(W.COLORS).map(([c, n]) => `<button class="sw${o.color === c ? " on" : ""}" data-color="${c}" title="${n}" style="background:${c}"></button>`).join("")}</div>`;
    }
    $("wd-items").innerHTML = html;
  }

  return new Promise((resolve) => {
    const done = (val) => {
      root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey, true);
      root.classList.remove("show");
      resolve(val);
    };
    const onClick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; }
      else if (b.dataset.item) { o[tab] = b.dataset.item; audio.sfx("pickup"); }
      else if (b.dataset.color) { o.color = b.dataset.color; audio.sfx("pickup"); }
      else if (b.dataset.skin) { o.skin = b.dataset.skin; }
      else if (b.id === "wd-rl") angle -= 0.7;
      else if (b.id === "wd-rr") angle += 0.7;
      else if (b.id === "wd-ok") { if (bill() <= coins) done({ ...o, changed: W.outfitKey(o) !== start }); return; }
      else if (b.id === "wd-cancel") { done(null); return; }
      draw();
    };
    const onKey = (e) => {
      if (!root.classList.contains("show")) return;
      if (e.code === "KeyM") return; // mute still works
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); $("wd-ok").click(); }
      else if (e.key === "Escape" && !creation) { e.preventDefault(); done(null); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { angle += e.key === "ArrowLeft" ? -0.5 : 0.5; draw(); }
    };
    root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    root.classList.add("show");
    draw();
  });
}

export const isOpen = () => !!root?.classList.contains("show");
