// The Gossip Board (Tab): what you've heard, what you started and how far it went,
// who promised you what, how each woman feels about you, and every vote so far.

import * as sim from "../core/sim.js";
import { VILLAGERS } from "../core/cast.js";

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
const holders = (s, rids) => {
  const out = {};
  for (const v of Object.values(s.people)) for (const rid of rids) { const k = v.knows[rid]; if (k && (!out[v.id] || k.conf > out[v.id].conf)) out[v.id] = { ...k, rid }; }
  return out;
};
const family = (s, rid) => { const ids = [rid]; let added = true; while (added) { added = false; for (const r of Object.values(s.rumors)) if (r.parent && ids.includes(r.parent) && !ids.includes(r.id)) { ids.push(r.id); added = true; } } return ids; };
const root = (s, rid) => { let r = s.rumors[rid]; while (r?.parent && s.rumors[r.parent]) r = s.rumors[r.parent]; return r; };

function tea(s) {
  const heard = [...s.player.heard].reverse();
  const aboutYou = Object.values(s.rumors).filter((r) => r.about === "player");
  const heardIds = new Set(heard.map((h) => h.rid));
  const unheard = aboutYou.filter((r) => !heardIds.has(r.id) && Object.values(s.people).some((v) => v.knows[r.id]?.conf >= 0.3)).length;
  if (!heard.length) return `<div class="empty"><span class="big">🫖</span>No tea yet. Stand near people talking, or ask someone what's going on.${unheard ? `<br><br><b>${unheard}</b> whisper${unheard > 1 ? "s are" : " is"} going around about you already.` : ""}</div>`;
  const card = (h) => {
    const r = s.rumors[h.rid];
    if (!r) return "";
    const fam = family(s, root(s, r.id).id);
    const know = Object.values(holders(s, fam)).filter((k) => k.conf >= 0.3).length;
    const kind = r.about === "player" ? "about-you" : r.kind === "vote" ? "vote" : r.kind === "alliance" ? "alliance" : "";
    const from = h.from === "self" ? "you saw it" : `${h.how === "told" ? "told by" : "overheard from"} ${nm(s, h.from)}`;
    return `<div class="tea ${kind}">
      <div class="t-head">${r.about ? img(r.about) : ""}<div><div class="t-about">${r.about ? `About ${r.about === "player" ? "YOU" : nm(s, r.about)}` : "General gossip"}</div><div class="t-meta">Day ${h.day} · ${h.time} · ${from}</div></div></div>
      <div class="t-text">${esc(r.text)}</div>
      <div class="t-foot"><span class="chip">🔥 ${know} know${know === 1 ? "s" : ""}</span>${r.kind === "vote" ? `<span class="chip warn">vote plot</span>` : ""}${r.kind === "alliance" ? `<span class="chip good">pact</span>` : ""}${r.parent ? `<span class="chip">a retold version</span>` : ""}${h.how === "overheard part" ? `<span class="chip">only caught part of it</span>` : ""}</div>
    </div>`;
  };
  const you = heard.filter((h) => s.rumors[h.rid]?.about === "player");
  const rest = heard.filter((h) => s.rumors[h.rid]?.about !== "player");
  return `${you.length || unheard ? `<div class="section-title">What they say about you</div><div class="tea-grid">${you.map(card).join("")}</div>${unheard ? `<p class="muted">…and ${unheard} more whisper${unheard > 1 ? "s" : ""} about you that you haven't heard yet.</p>` : ""}` : ""}
    <div class="section-title">The tea</div><div class="tea-grid">${rest.map(card).join("") || `<p class="muted">Nothing about anyone else yet.</p>`}</div>`;
}

function spread(s) {
  const roots = [...new Set(s.player.told.map((t) => root(s, t.rid)?.id).filter(Boolean))].reverse();
  if (!roots.length) return `<div class="empty"><span class="big">🌱</span>You haven't started any rumors yet.<br>Tell someone something about another woman (true or not) and watch it travel.</div>`;
  return roots.map((rid) => {
    const r = s.rumors[rid];
    const fam = family(s, rid);
    const hs = holders(s, fam);
    const believe = Object.values(hs).filter((k) => k.conf >= 0.5).length;
    const doubt = Object.values(hs).filter((k) => k.conf < 0.5).length;
    const told = s.player.told.filter((t) => fam.includes(t.rid));
    const backfire = Object.values(s.rumors).some((x) => x.about === "player" && r.about && x.text.includes(s.people[r.about]?.name || "@@") && /lies|lied/.test(x.text));
    return `<div class="spread">
      <div>
        <div class="t-meta muted">Day ${r.day} · about ${nm(s, r.about)}</div>
        <div class="s-text">“${esc(r.text)}”</div>
        <div class="t-foot"><span class="chip good">${believe} believe it</span><span class="chip">${doubt} doubt it</span><span class="chip">${fam.length} version${fam.length > 1 ? "s" : ""}</span>${backfire ? `<span class="chip bad">it came back on you</span>` : ""}</div>
        <div class="section-title">You told</div>
        ${told.map((t) => t.to === "crowd"
          ? `<div class="vote-row"><span class="avatar board-pin">🎤</span> <b>Said it in front of everyone</b> <span class="muted">Day ${t.day} ${t.time}</span></div>`
          : t.to === "board"
          ? `<div class="vote-row"><span class="avatar board-pin">📌</span> <b>Pinned anonymously</b> <span class="muted">Day ${t.day} ${t.time}</span> <span class="chip">${(s.notes || []).find((n) => n.rid === t.rid)?.readBy.length || 0} walked past it</span></div>`
          : `<div class="vote-row">${img(t.to)} <b>${nm(s, t.to)}</b> <span class="muted">Day ${t.day} ${t.time}</span> ${t.believed ? `<span class="chip good">bought it</span>` : `<span class="chip bad">didn't buy it</span>`}</div>`).join("")}
        ${fam.length > 1 ? `<div class="section-title">How it's being told now</div>${fam.slice(1).map((id) => `<p class="muted">“${esc(s.rumors[id].text)}”</p>`).join("")}` : ""}
      </div>
      ${network(s, hs)}
    </div>`;
  }).join("");
}

function network(s, hs) {
  const ids = VILLAGERS.map((v) => v.id);
  const W = 260, H = 220, cx = W / 2, cy = H / 2, R = 86;
  const pos = { player: [cx, cy] };
  ids.forEach((id, i) => { const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2; pos[id] = [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; });
  let edges = "", nodes = "";
  for (const [id, k] of Object.entries(hs)) {
    const from = k.from === "player" ? "player" : pos[k.from] ? k.from : null;
    if (!from || from === id) continue;
    const [x1, y1] = pos[from], [x2, y2] = pos[id];
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
    edges += `<line x1="${x1 + (dx / d) * 16}" y1="${y1 + (dy / d) * 16}" x2="${x2 - (dx / d) * 18}" y2="${y2 - (dy / d) * 18}" stroke="${k.conf >= 0.5 ? "#ff6f9c" : "#c8b0c8"}" stroke-width="2.2" marker-end="url(#ah${k.conf >= 0.5 ? "p" : "g"})" />`;
  }
  for (const id of ["player", ...ids]) {
    const [x, y] = pos[id];
    const k = hs[id];
    const ring = id === "player" ? "#e86f5a" : !k ? "#eadfe6" : k.conf >= 0.5 ? "#ff6f9c" : "#b8a0c8";
    const gone = s.people[id]?.gone;
    nodes += `<g opacity="${gone ? 0.35 : k || id === "player" ? 1 : 0.45}"><circle cx="${x}" cy="${y}" r="16" fill="#fff" stroke="${ring}" stroke-width="3"/>${id === "player" ? `<text x="${x}" y="${y + 4}" text-anchor="middle" class="netlabel">YOU</text>` : `<clipPath id="c${id}${x | 0}"><circle cx="${x}" cy="${y}" r="13.5"/></clipPath><image href="${pics[id] || ""}" x="${x - 14}" y="${y - 14}" width="28" height="28" clip-path="url(#c${id}${x | 0})"/>`}</g>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}"><defs><marker id="ahp" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ff6f9c"/></marker><marker id="ahg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#c8b0c8"/></marker></defs>${edges}${nodes}</svg>`;
}

function pacts(s) {
  const mine = sim.alliancesOf(s, "player");
  const known = (s.player.knownAlliances || []).map((id) => s.alliances.find((a) => a.id === id)).filter((a) => a && !a.members.includes("player"));
  const status = (p) => {
    const vote = s.votes.find((v) => v.day >= p.day && v.ballots[p.by]);
    if (!vote || vote.finale) return `<span class="chip">pending</span>`;
    if (p.kind === "vote" || p.kind === "told-vote") return vote.ballots[p.by] === p.target ? `<span class="chip good">kept it</span>` : `<span class="chip bad">voted ${nm(s, vote.ballots[p.by])} instead</span>`;
    if (p.kind === "alliance") return vote.ballots[p.by] === "player" ? `<span class="chip bad">voted for YOU</span>` : `<span class="chip good">didn't vote for you</span>`;
    return "";
  };
  const line = (p) => {
    const what = p.kind === "alliance" ? "agreed to a secret pact with you" : p.kind === "vote" ? `said she'd vote out ${nm(s, p.target)}` : `said she's voting for ${nm(s, p.target)}`;
    return `<div class="pact">${img(p.by)}<div style="flex:1"><b>${nm(s, p.by)}</b> ${what} <span class="muted">· Day ${p.day}</span></div>${status(p)}</div>`;
  };
  const proms = [...s.player.promises].reverse();
  return `<div class="section-title">Your pacts</div>
    ${mine.length ? mine.map((a) => `<div class="pact"><b>${esc(a.name)}</b><div class="members">${a.members.filter((m) => m !== "player").map((m) => img(m)).join("")}</div><span class="muted">${a.members.filter((m) => m !== "player").map((m) => nm(s, m)).join(", ")}</span></div>`).join("") : `<p class="muted">No pacts yet. Try asking someone to team up.</p>`}
    <div class="section-title">What they promised you</div>
    ${proms.length ? proms.map(line).join("") : `<p class="muted">Nobody has promised you anything. Ask who they're voting for, or ask them to vote someone out.</p>`}
    <div class="section-title">Pacts you've uncovered</div>
    ${known.length ? known.map((a) => `<div class="pact"><b>${esc(a.name)}</b><div class="members">${a.members.filter((m) => !s.people[m]?.gone).map((m) => img(m)).join("")}</div><span class="muted">${a.members.filter((m) => !s.people[m]?.gone).map((m) => nm(s, m)).join(" + ")}</span></div>`).join("") : `<p class="muted">You haven't caught anyone teaming up yet. Pacts get made in whispers, so listen closely.</p>`}`;
}

function cast(s) {
  return `<div class="cast-grid">${VILLAGERS.map((v0) => {
    const v = s.people[v0.id];
    const about = s.player.heard.filter((h) => s.rumors[h.rid]?.about === v.id).length;
    const ally = sim.alliancesOf(s, "player").some((a) => a.members.includes(v.id));
    return `<div class="castc ${v.gone ? "out" : ""}">${img(v.id, "")}<div><div class="c-arch">${esc(v.archetype)}</div><div class="c-name">${esc(v.name)}</div><div class="c-line">${esc(v.employed ? v.job : `out-of-work ${v.job}`)}</div>
      <div class="c-line">${v.gone ? `Voted out on day ${v.outDay}` : `${esc(sim.firstOf(s, v.id))} ${sim.vibe(s, v.id)}`}</div>
      <div class="t-foot">${ally && !v.gone ? `<span class="chip good">your pact</span>` : ""}${about ? `<span class="chip">${about} rumor${about > 1 ? "s" : ""} about her</span>` : ""}</div></div></div>`;
  }).join("")}</div>`;
}

function votes(s) {
  if (!s.votes.length) return `<div class="empty"><span class="big">🔥</span>No votes yet. The first one is on the night of day 3.</div>`;
  return [...s.votes].reverse().map((v) => {
    const rows = Object.entries(v.ballots).map(([voter, target]) => {
      const betrayed = v.betrayals?.some((b) => b.by === voter);
      return `<div class="vote-row">${img(voter === "player" ? "player" : voter)}<b>${voter === "player" ? "You" : nm(s, voter)}</b><span class="arrow">→</span>${img(target)}<span>${target === "player" ? "<b>YOU</b>" : nm(s, target)}</span>${betrayed ? `<span class="chip bad">broke her word</span>` : ""}</div>`;
    }).join("");
    return `<div class="vote-round"><div class="section-title">Night ${v.day} · ${v.finale ? `Finale: ${nm(s, v.winner)} won` : `${nm(s, v.out)} was voted out`}</div>${rows}</div>`;
  }).join("");
}
