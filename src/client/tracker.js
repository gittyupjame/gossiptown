// The Gossip Board (Tab): what you've heard, what you started and how far it went,
// who promised you what, how each woman feels about you, and every vote so far.

import * as sim from "../core/sim.js";
import { VILLAGERS } from "../core/cast.js";
import { lookCue } from "../core/looks.js";

const $ = (id) => document.getElementById(id);
let tab = "tea";
let pics = {};
let getState = () => null;

export function initBoard(state, portraits) {
  getState = state; pics = portraits;
  for (const b of document.querySelectorAll(".board-tabs button")) b.addEventListener("click", () => { tab = b.dataset.tab; render(); });
}
export function render() {
  for (const b of document.querySelectorAll(".board-tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
  const s = getState();
  if (!s) return;
  $("board-body").innerHTML = ({ tea, spread, pacts, cast, votes }[tab])(s);
  $("board-body").scrollTop = 0;
}

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const img = (id, cls = "avatar") => `<img class="${cls}" src="${pics[id] || ""}" alt="">`;
const nm = (s, id) => esc(sim.firstOf(s, id));
const root = (s, rid) => { let r = s.rumors[rid]; while (r?.parent && s.rumors[r.parent]) r = s.rumors[r.parent]; return r; };
// Everything here is the newcomer's own record: what she perceived, who told her, what she said.
const mine = (s, rid) => s.player.knows?.[rid] || null;
const SURE = (c) => (c >= 0.85 ? "you're sure" : c >= 0.6 ? "you believe it" : c >= 0.35 ? "you half-believe it" : "you doubt it");

function tea(s) {
  const heard = [...s.player.heard].reverse();
  if (!heard.length) return `<div class="empty"><span class="big">🫖</span>No tea yet. Stand near people talking, or ask someone what's going on.</div>`;
  const card = (h) => {
    const r = s.rumors[h.rid];
    if (!r) return "";
    const k = mine(s, h.rid);
    const sources = new Set((k?.chain || []).map((l) => l.from).filter(Boolean)).size;
    const kind = r.about === "player" ? "about-you" : r.kind === "vote" ? "vote" : r.kind === "pact" ? "alliance" : "";
    const from = h.from === "self" ? "you saw it" : h.how === "worked out" ? "you worked it out" : `${h.how === "told" ? "told by" : "overheard from"} ${nm(s, h.from)}`;
    return `<div class="tea ${kind}">
      <div class="t-head">${r.about ? img(r.about) : ""}<div><div class="t-about">${r.about ? `About ${r.about === "player" ? "YOU" : nm(s, r.about)}` : "General gossip"}</div><div class="t-meta">Day ${h.day} · ${h.time} · ${from}</div></div></div>
      <div class="t-text">${esc(r.text)}</div>
      <div class="t-foot">${k ? `<span class="chip">${SURE(k.conf)}</span>` : ""}${sources > 1 ? `<span class="chip good">heard it from ${sources} people</span>` : ""}${r.kind === "vote" ? `<span class="chip warn">vote plot</span>` : ""}${r.kind === "pact" ? `<span class="chip good">pact</span>` : ""}${h.how === "overheard part" ? `<span class="chip">only caught part of it</span>` : ""}</div>
    </div>`;
  };
  const you = heard.filter((h) => s.rumors[h.rid]?.about === "player");
  const rest = heard.filter((h) => s.rumors[h.rid]?.about !== "player");
  return `${you.length ? `<div class="section-title">What you've heard they say about you</div><div class="tea-grid">${you.map(card).join("")}</div>` : ""}
    <div class="section-title">The tea</div><div class="tea-grid">${rest.map(card).join("") || `<p class="muted">Nothing about anyone else yet.</p>`}</div>`;
}

function spread(s) {
  const told = [...s.player.told].reverse();
  if (!told.length) return `<div class="empty"><span class="big">🌱</span>You haven't passed anything on yet.<br>Tell someone something about another woman (true or not), then listen for it coming back.</div>`;
  const byRoot = new Map();
  for (const t of told) { const r = root(s, t.rid); if (r) (byRoot.get(r.id) || byRoot.set(r.id, []).get(r.id)).push(t); }
  return [...byRoot].map(([rid, ts]) => {
    const r = s.rumors[rid];
    // it came back: someone told the newcomer a version of her own story
    const back = s.player.heard.filter((h) => h.from !== "player" && h.from !== "self" && root(s, h.rid)?.id === rid && h.rid !== rid);
    return `<div class="spread">
      <div>
        <div class="t-meta muted">${r.about ? `about ${nm(s, r.about)}` : ""}</div>
        <div class="s-text">“${esc(r.text)}”</div>
        <div class="section-title">You told</div>
        ${ts.map((t) => t.to === "crowd"
          ? `<div class="vote-row"><span class="avatar board-pin">🎤</span> <b>Said it in front of everyone</b> <span class="muted">Day ${t.day} ${t.time}</span></div>`
          : t.to === "board"
          ? `<div class="vote-row"><span class="avatar board-pin">📌</span> <b>Pinned anonymously</b> <span class="muted">Day ${t.day} ${t.time}</span></div>`
          : `<div class="vote-row">${img(t.to)} <b>${nm(s, t.to)}</b> <span class="muted">Day ${t.day} ${t.time}</span></div>`).join("")}
        ${back.length ? `<div class="section-title">It came back to you</div>${back.map((h) => `<p class="muted">${nm(s, h.from)}: “${esc(s.rumors[h.rid].text)}”</p>`).join("")}` : ""}
      </div>
    </div>`;
  }).join("");
}

function pacts(s) {
  const ours = sim.alliancesOf(s, "player");
  // pacts she has heard about or seen (her own beliefs), not the truth
  const known = Object.entries(s.player.knows || {}).filter(([rid, k]) => k.conf >= 0.5 && s.rumors[rid]?.prop?.pred === "allied").map(([rid]) => s.rumors[rid]);
  const book = s.ledger || [];
  // how a promise turned out, as far as the newcomer can know: votes are read out in public;
  // anything else only if she was there when it was settled
  const chip = (c) => {
    const pub = ["vote", "told_vote"].includes(c.kind) && c.status !== "open";
    const saw = c.by === "player" || pub || (c.settleCause && s.world.find((e) => e.id === c.settleCause)?.perceivers?.some((p) => p.id === "player"));
    if (c.status === "open" || !saw) return `<span class="chip">${c.status === "open" ? "pending" : "you haven't seen"}</span>`;
    if (c.status === "kept") return `<span class="chip good">kept it</span>`;
    if (c.status === "broken") return `<span class="chip bad">${esc(c.why || "broke it")}</span>`;
    return `<span class="chip">${esc(c.why || c.status)}</span>`;
  };
  const deed = (c) => esc(c.kind === "told_vote" ? `said she's voting out ${nm(s, c.target)}` : c.kind === "pact" ? "agreed to a secret pact" : c.kind === "other" ? `said: “${c.what || ""}”` : `said she'd ${sim.deedText(s, c, { by: false })}`);
  const toYou = book.filter((c) => c.to === "player").reverse();
  const fromYou = book.filter((c) => c.by === "player").reverse();
  return `<div class="section-title">Your pacts</div>
    ${ours.length ? ours.map((a) => `<div class="pact"><b>${esc(a.name)}</b><div class="members">${a.members.filter((m) => m !== "player").map((m) => img(m)).join("")}</div><span class="muted">${a.members.filter((m) => m !== "player").map((m) => nm(s, m)).join(", ")}</span></div>`).join("") : `<p class="muted">No pacts yet. Try asking someone to team up.</p>`}
    <div class="section-title">What they promised you</div>
    ${toYou.length ? toYou.map((c) => `<div class="pact">${img(c.by)}<div style="flex:1"><b>${nm(s, c.by)}</b> ${deed(c)} <span class="muted">· Day ${c.day}</span></div>${chip(c)}</div>`).join("") : `<p class="muted">Nobody has promised you anything. Ask who they're voting for, or ask them to vote someone out.</p>`}
    <div class="section-title">What you promised</div>
    ${fromYou.length ? fromYou.map((c) => `<div class="pact">${img(c.to)}<div style="flex:1">${c.kind === "other" ? `You promised <b>${nm(s, c.to)}</b>: “${esc(c.what || "")}”` : `You told <b>${nm(s, c.to)}</b> you'd ${esc(c.kind === "pact" ? "stick together" : sim.deedText(s, c, { by: false }))}`} <span class="muted">· Day ${c.day}</span></div>${chip(c)}</div>`).join("") : `<p class="muted">You haven't promised anyone anything. They will remember when you do.</p>`}
    <div class="section-title">Pacts you've uncovered</div>
    ${known.length ? known.map((r) => `<div class="pact"><div class="members">${[r.prop.subject, r.prop.obj].map((m) => img(m)).join("")}</div><span class="muted">${esc(r.text)}</span></div>`).join("") : `<p class="muted">You haven't caught anyone teaming up yet. Pacts get made in whispers, so listen closely.</p>`}`;
}

function cast(s) {
  return `<div class="cast-grid">${VILLAGERS.map((v0) => {
    const v = s.people[v0.id];
    const about = s.player.heard.filter((h) => s.rumors[h.rid]?.about === v.id).length;
    const ally = sim.alliancesOf(s, "player").some((a) => a.members.includes(v.id));
    return `<div class="castc ${v.gone ? "out" : ""}">${img(v.id, "")}<div><div class="c-arch">${esc(v.archetype)}</div><div class="c-name">${esc(v.name)}</div><div class="c-line">${esc(v.employed ? v.job : `out-of-work ${v.job}`)}</div>
      <div class="c-line">${v.gone ? `Voted out on day ${v.outDay}` : `${esc(sim.firstOf(s, v.id))} ${sim.vibe(s, v.id)}`}</div>
      ${!v.gone && lookCue(s, v.id) ? `<div class="c-line">👗 ${esc(lookCue(s, v.id))}</div>` : ""}
      <div class="t-foot">${ally && !v.gone ? `<span class="chip good">your pact</span>` : ""}${about ? `<span class="chip">${about} rumor${about > 1 ? "s" : ""} about her</span>` : ""}</div></div></div>`;
  }).join("")}</div>`;
}

function votes(s) {
  if (!s.votes.length) return `<div class="empty"><span class="big">🔥</span>No votes yet. The first one is tonight at the firepit.</div>`;
  return [...s.votes].reverse().map((v) => {
    const rows = Object.entries(v.ballots).map(([voter, target]) => {
      const betrayed = v.betrayals?.some((b) => b.by === voter);
      return `<div class="vote-row">${img(voter === "player" ? "player" : voter)}<b>${voter === "player" ? "You" : nm(s, voter)}</b><span class="arrow">→</span>${img(target)}<span>${target === "player" ? "<b>YOU</b>" : nm(s, target)}</span>${betrayed ? `<span class="chip bad">broke her word</span>` : ""}</div>`;
    }).join("");
    return `<div class="vote-round"><div class="section-title">Night ${v.day} · ${v.finale ? `Finale: ${nm(s, v.winner)} won` : `${nm(s, v.out)} was voted out`}</div>${rows}</div>`;
  }).join("");
}
