// The screen furniture: HUD, hints, headlines, first-time tips, and the cards between days.

import { SHOW, ITEMS } from "../core/cast.js";

const $ = (id) => document.getElementById(id);
export { $ };

// ---------- HUD ----------

export function showHud(on) { $("hud").classList.toggle("hidden", !on); }

export function updateHud(s, placeName) {
  $("hud-day").textContent = s.day;
  const m = Math.min(s.minute, 20 * 60);
  $("hud-time").textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  $("hud-bar").style.width = `${((m - 480) / 720) * 100}%`;
  const d = (SHOW.voteEvery - (s.day % SHOW.voteEvery)) % SHOW.voteEvery;
  const pill = $("votepill");
  $("hud-vote").textContent = d === 0 ? (m >= 19 * 60 ? "To the firepit!" : "Vote TONIGHT") : `Vote in ${d} day${d > 1 ? "s" : ""}`;
  pill.classList.toggle("tonight", d === 0);
  $("placepill").textContent = placeName;
  const it = s.player.carrying && ITEMS[s.player.carrying];
  const cp = $("carrypill");
  cp.classList.toggle("hidden", !it);
  if (it && cp.dataset.item !== s.player.carrying) { cp.dataset.item = s.player.carrying; cp.textContent = `${it.icon} Carrying ${it.name}`; }
}

export function setBrain(jevStatus, voiceStatus) {
  const b = $("brain");
  b.classList.toggle("live", jevStatus.live);
  b.querySelector("span").textContent = jevStatus.live ? "Jev live" : "Stand-in brain";
  b.title = `Decisions: ${jevStatus.label} (${jevStatus.why}). Dialogue: ${voiceStatus.label}.`;
}

let hintText = "";
export function hint(html) {
  if (html === hintText) return;
  hintText = html;
  const h = $("hint");
  if (html) { h.innerHTML = html; h.classList.add("show"); } else h.classList.remove("show");
}

let toastT = null;
export function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- headlines (lower-third chyron) ----------

const queue = [];
let showing = false;
const TAGS = { drama: "Drama", bad: "Uh oh", vote: "The Vote", good: "Nice", info: "Meanwhile", tea: "Fresh tea" };
export function chyron(text, kind = "drama") {
  queue.push({ text, kind });
  if (queue.length > 4) queue.shift();
  if (!showing) next();
}
function next() {
  const item = queue.shift();
  const c = $("chyron");
  if (!item) { showing = false; return; }
  showing = true;
  c.className = item.kind;
  c.querySelector(".ctag").textContent = TAGS[item.kind] || "Drama";
  c.querySelector(".ctext").textContent = item.text;
  requestAnimationFrame(() => c.classList.add("show"));
  setTimeout(() => { c.classList.remove("show"); setTimeout(next, 600); }, 4800);
}

// ---------- first-time tips ----------

export const TIPS = {
  welcome: { icon: "🚶‍♀️", title: "Welcome to Gossiptown", text: "Walk with <kbd>W A S D</kbd> or the arrow keys. Walk up to anyone and press <kbd>Enter</kbd> to talk. <kbd>Tab</kbd> opens your Gossip Board, <kbd>P</kbd> pauses." },
  talk: { icon: "💬", title: "Just say it", text: "Type anything and press <kbd>Enter</kbd>. She reacts to what you actually say: ask questions, flatter her, spill (or invent) gossip, propose a secret pact, or ask her to vote someone out. Empty <kbd>Enter</kbd> or walking away ends the chat." },
  overheard: { icon: "👂", title: "Eavesdropping", text: "Stand close to hear every word. From further away you only catch pieces. Get too close and they might catch you." },
  rumor: { icon: "☕", title: "Fresh tea!", text: "You just learned a rumor. It's pinned to your Gossip Board (<kbd>Tab</kbd>). Pass it on, use it as leverage, or keep it in your pocket." },
  told: { icon: "🌱", title: "You started a rumor", text: "Watch where it goes under <b>My Rumors</b> on the Gossip Board. If it's a lie and someone checks with the woman it's about, it can come back to bite you." },
  approach: { icon: "👋", title: "Someone came to you", text: "The women here walk up when they want something: to recruit you, fish for gossip, or warn you. Type a reply, or just walk away." },
  alliance: { icon: "🤝", title: "Pacts are secret", text: "Some women say yes and mean it. Some say yes and are lying to your face. You'll find out who at the vote." },
  "alliance-overheard": { icon: "🤫", title: "A secret pact!", text: "You caught two of them teaming up. Who's in which pact is on your Gossip Board under <b>Pacts &amp; Promises</b>." },
  "vote-pitch": { icon: "🗳️", title: "Lobbying", text: "Whether she really votes your way depends on how much she likes and trusts you, and whether she was lying. Votes are public, so broken promises get exposed." },
  caught: { icon: "👀", title: "Caught snooping", text: "They noticed you hovering. Being caught makes people trust you less. Hang back a little further next time." },
  bell: { icon: "🔔", title: "The bell rings!", text: "Tonight is a vote. Everyone heads to the firepit at sundown. Last chance to lock in your pacts." },
  vote: { icon: "🔥", title: "Cast your vote", text: "Walk up to the woman you want gone (or click her card) and press <kbd>Enter</kbd>, then <kbd>Enter</kbd> again to lock it in. The votes are read out one by one." },
  night: { icon: "🌙", title: "Overnight", text: "Every night each woman lies awake and makes up her mind: grudges, quitting, making peace, who has to go. You hear about the public stuff by morning." },
  tracker: { icon: "📌", title: "Your Gossip Board", text: "<b>The Tea</b>: everything you've heard. <b>My Rumors</b>: what you started and how far it spread. <b>Pacts</b>: who promised you what. <b>The Cast</b>: how each woman feels about you." },
  fight: { icon: "💢", title: "A cat fight!", text: "Everyone who saw it picks a side, and it'll be all over town by tonight. Whoever starts fights gets remembered at the vote." },
  "fight-you": { icon: "💥", title: "She's coming for you!", text: "Mash <kbd>Enter</kbd> to hold your own, or walk away to back down. Win and she'll be scared of you. Lose and the whole town hears about it. Either way, whoever started it pays at the vote." },
  gift: { icon: "🎁", title: "A little something", text: "You're carrying a gift. Talk to someone and hand it over (\"I brought you this\"). Every woman has one thing she adores and one she can't stand. Some will wonder what you want for it." },
  snoop: { icon: "📬", title: "Snooping", text: "The first peek in a woman's mailbox can turn up her secret. Anyone nearby might see you, and if she's home she might be watching from the window." },
  note: { icon: "📌", title: "An anonymous note", text: "Your note stays up for two days. Anyone passing the square or the market may read it. Nosy ones (and anyone you've told the same story to) may work out you wrote it." },
};

const seenKey = "gossiptown.tips.v1";
let seen = (() => { try { return JSON.parse(localStorage.getItem(seenKey)) || {}; } catch { return {}; } })();
const tipQueue = [];
let tipOpen = null;
export const tipShowing = () => !!tipOpen;
export function resetTips() { seen = {}; try { localStorage.removeItem(seenKey); } catch {} }

export function tip(id) {
  if (seen[id] || !TIPS[id] || tipQueue.includes(id) || tipOpen === id) return;
  tipQueue.push(id);
  if (!tipOpen) showNextTip();
}
function showNextTip() {
  const id = tipQueue.shift();
  if (!id) { tipOpen = null; window.dispatchEvent(new Event("tip-closed")); return; }
  tipOpen = id;
  const t = TIPS[id];
  const el = $("tip");
  el.querySelector(".tip-icon").textContent = t.icon;
  el.querySelector("h3").textContent = t.title;
  el.querySelector("p").innerHTML = t.text;
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  el.classList.add("show");
  window.dispatchEvent(new Event("tip-opened"));
}
export function dismissTip() {
  if (!tipOpen) return false;
  seen[tipOpen] = true;
  try { localStorage.setItem(seenKey, JSON.stringify(seen)); } catch {}
  $("tip").classList.remove("show");
  setTimeout(showNextTip, 120);
  tipOpen = "closing";
  return true;
}
$("tip-ok").addEventListener("click", dismissTip);

// ---------- screens ----------

export function screen(id, on) { $(id).classList.toggle("show", on); }
export const isOpen = (id) => $(id).classList.contains("show");

export function fade(on) { $("fade").classList.toggle("on", on); return new Promise((r) => setTimeout(r, 750)); }
export function cinema(on) { document.body.classList.toggle("cinema", on); }

export function lowerThird(p, img) {
  const lt = $("lowerthird");
  if (!p) { lt.classList.remove("show"); return; }
  lt.querySelector(".lt-img").style.backgroundImage = img ? `url(${img})` : "";
  lt.querySelector(".lt-arch").textContent = p.archetype || p.job;
  lt.querySelector(".lt-name").textContent = p.name;
  lt.querySelector(".lt-quote").textContent = p.quote ? `“${p.quote}”` : "";
  lt.classList.remove("show"); void lt.offsetWidth; lt.classList.add("show");
}
export function skip(on, text = "Enter to continue") { const s = $("skip"); s.textContent = text; s.classList.toggle("show", on); }

export function voteHud(title, sub) {
  const v = $("votehud");
  if (!title) { v.classList.remove("show"); return; }
  v.querySelector(".vh-title").textContent = title;
  v.querySelector(".vh-sub").textContent = sub || "";
  v.classList.add("show");
}
