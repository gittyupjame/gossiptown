// Primrose's daily show, played out in town: the crowd gathers round, Primrose hands out
// the floor, each woman (and you) says her piece, and the crowd's faces say how it landed.
// What it all means is decided in src/core/events.js.

import * as THREE from "three";
import * as B from "./bubbles.js";
import * as H from "./hud.js";
import * as L from "./layout.js";
import * as voice from "../core/voice.js";
import * as sim from "../core/sim.js";
import * as E from "../core/events.js";
import { PLACES } from "../core/cast.js";
import { scene, toon, outlineMat } from "./scene.js";

const FACE = { loved: "heart", amused: "laugh", unmoved: null, cringed: "cringe", offended: "anger" };
const HOSTILE = new Set(["call_out", "roast", "backhanded", "name_vote", "spill"]);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function runShow(ctx) {
  const { game } = ctx;
  const s = game.state();
  const ev = E.showOf(s);
  const f = E.FORMATS[ev.format];
  const place = PLACES[ev.place].name;
  const first = (id) => sim.firstOf(s, id);
  const color = (id) => (id === "player" ? "#e86f5a" : id === "primrose" ? "#e8577e" : "#ff6f9c");
  const cast = sim.alive(s).map((v) => v.id);
  const everyone = [...cast, ...(s.player.out ? [] : ["player"])];

  // ---------- staging ----------
  H.cinema(true);
  await H.fade(true);
  B.hushAll();
  const lineupP = E.lineup(s);
  const { stage, seats, hostAt, dir } = staging(ev.place, everyone.length);
  const seatOf = {};
  everyone.forEach((id, i) => {
    seatOf[id] = seats[i];
    const w = ctx.walker(id);
    w.stop(); w.frozen = false;
    w.x = seats[i].x; w.z = seats[i].z;
    w.face = { x: stage.x, z: stage.z };
    w.heading = Math.atan2(stage.x - w.x, stage.z - w.z);
  });
  const host = ctx.walker("primrose");
  host.stop(); host.x = hostAt.x; host.z = hostAt.z; host.face = { x: stage.x + dir.x * 6, z: stage.z + dir.z * 6 };
  const prop = makeProp(f, stage, hostAt, dir);
  const front = { x: stage.x + dir.x * 10, z: stage.z + dir.z * 10 };
  const wide = () => ctx.cam.shot(vec(stage.x - dir.x * 2.2, 1.2, stage.z - dir.z * 2.2), 12.5, { from: front, height: 6.5 });
  const close = (id) => { const w = ctx.walker(id); ctx.cam.shot(vec(w.x, 1.4, w.z), 5.6, { from: { x: w.x + dir.x * 6, z: w.z + dir.z * 6 }, height: 2.0 }); };
  wide();
  ctx.cam.pos.set(stage.x + dir.x * 14, 8, stage.z + dir.z * 14);
  const lineup = await lineupP;
  await ctx.wait(300);
  await H.fade(false);
  H.voteHud(`${f.icon} ${f.title}`, `${place.replace(/^the /, "The ")} · Day ${s.day}`);
  H.tip("show");
  await ctx.wait(1400);
  H.voteHud(null);

  const hostSay = async (text, ms) => { close("primrose"); await sayAndWait(ctx, "primrose", text, ms, color); };
  await hostSay(pick(f.open));

  // ---------- the show itself ----------
  let fought = false;
  const play = async (act, line, { context } = {}) => {
    // the crowd decides how it landed, and their faces show it
    const res = await E.crowdReacts(s, act, ctx.ui, { line });
    wide();
    await ctx.wait(350);
    for (const [id, k] of Object.entries(res.reactions)) if (FACE[k]) setTimeout(() => B.emote(id, FACE[k]), Math.random() * 500);
    if (act.by === "player") showTally(res.tally);
    await ctx.wait(1700);
    if (res.snap && !fought) {
      fought = true;
      await hostSay(pick(["Oh no. Oh no no no.", "Ladies! LADIES!", "Somebody get the cameras closer!"]), 1500);
      if (act.by === "player") await ctx.playerFight(res.snap, res.snap);
      else await sim.brawl(s, s.people[res.snap], s.people[act.by], ev.place, { ...ctx.ui, fight: (a, b, o) => ctx.npcFight(a, b, o) }, true).then(() => ctx.wait(3600));
      for (const id of [res.snap, act.by]) { const w = ctx.walker(id); w.x = seatOf[id].x; w.z = seatOf[id].z; w.face = { x: stage.x, z: stage.z }; }
      wide();
      await hostSay(pick(["...And that's showbiz, ladies.", "Well! THAT'S going in the highlight reel.", "Moving on. Quickly."]), 1800);
    }
    return res;
  };

  // A woman (or you) takes the floor: walks up, speaks, the crowd reacts.
  const speak = async (id, act, line) => {
    const w = ctx.walker(id);
    w.goTo(stage.x, stage.z);
    await walkUp(ctx, w, stage);
    w.face = { x: front.x, z: front.z };
    close(id);
    await sayAndWait(ctx, id, line, null, color, id === "player" ? s.player.name : first(id));
    return play(act, line);
  };
  const sitDown = (id) => { const w = ctx.walker(id); w.goTo(seatOf[id].x, seatOf[id].z); setTimeout(() => { w.face = { x: stage.x, z: stage.z }; }, 1600); };

  // You type what you say in front of everyone.
  const yourTurn = async (placeholder, hint) => {
    const pw = ctx.walker("player");
    close("player");
    H.hint("");
    const text = await new Promise((resolve) => {
      const b = B.typing("player", { name: s.player.name, placeholder, hint, onSubmit: (t) => { b.close(); resolve(t); }, onCancel: () => { b.close(); resolve(""); } });
    });
    pw.face = { x: front.x, z: front.z };
    return text;
  };

  if (f.kind === "hotseat") {
    const seat = lineup.seat, rid = lineup.rumor;
    const story = rid ? s.rumors[rid].text : null;
    await hostSay(pick([`Today's lucky lady in the Hot Seat is... ${first(seat)}!`, `${first(seat)}, darling. Take a seat. The hot one.`]));
    const sw = ctx.walker(seat);
    sw.goTo(stage.x, stage.z);
    await walkUp(ctx, sw, stage);
    sw.face = { x: front.x, z: front.z };
    E.readOut(s, rid, ctx.ui);
    await hostSay(story ? `Word around town is... "${story}"` : `Everybody in this town seems to have a problem with you. Why is that?`, 3600);
    await hostSay(pick(["Well? Is it true?", "Care to explain yourself?", "The town wants to know."]), 1600);
    let answer;
    if (seat === "player") {
      const text = await yourTurn(f.you, "Enter to answer · empty Enter to say nothing");
      answer = await E.playerAct(s, text, { seatRumor: rid });
      if (text) { B.say("player", text, { name: s.player.name, color: color("player"), you: true, hold: 3 }); await ctx.wait(Math.max(1600, text.length * 40)); }
      else await hostSay("Nothing? Silence speaks volumes, darling.", 1800);
      await play(answer, text);
    } else {
      answer = await E.seatAnswer(s, seat, rid);
      const line = await voice.showLine({ v: s.people[seat], title: f.title, blurb: f.blurb, place, what: E.actText(s, answer), context: story ? `Primrose just read out what the town says about you: "${story}"` : "Primrose asks why everyone has a problem with you.", playerName: s.player.name });
      close(seat);
      await sayAndWait(ctx, seat, line, null, color, first(seat));
      await play(answer, line);
    }
    // the crowd pipes up
    const pipes = await E.pipeUp(s, seat);
    for (const p of pipes) {
      const line = await voice.showLine({ v: s.people[p.by], title: f.title, blurb: f.blurb, place, what: p.pipe === "heckle" ? `heckle ${first(seat)} from the crowd` : `stick up for ${first(seat)} from the crowd`, context: story ? `${first(seat)} is in the Hot Seat over: "${story}"` : "", playerName: s.player.name });
      close(p.by);
      await sayAndWait(ctx, p.by, line, null, color, first(p.by));
      await play(p, line);
    }
    if (seat !== "player" && !s.player.out) {
      await hostSay(`${s.player.name}? Anything to say to ${first(seat)}?`, 1600);
      const text = await yourTurn(`Chime in about ${first(seat)}…`, "Enter to say it · empty Enter to stay out of it");
      if (text) {
        B.say("player", text, { name: s.player.name, color: color("player"), you: true, hold: 3 });
        await ctx.wait(Math.max(1600, text.length * 40));
        await play(await E.playerAct(s, text, { defaultSubject: seat }), text);
      }
    }
    sitDown(seat);
  } else {
    // decide every woman's move now and write all their lines while Primrose warms up
    const npcs = lineup.order.filter((id) => id !== "player");
    const acts = Object.fromEntries(await Promise.all(npcs.map(async (id) => [id, await E.npcAct(s, id, { assigned: lineup.assigned[id] })])));
    const linesP = voice.showLines({ items: npcs.map((id) => ({ v: s.people[id], what: E.actText(s, acts[id]) })), title: f.title, blurb: f.blurb, place, playerName: s.player.name }).catch(() => ({}));
    for (const id of lineup.order) {
      if (id !== "player" && s.people[id]?.gone) continue;
      const assigned = lineup.assigned[id];
      await hostSay(pick(f.turn(id === "player" ? s.player.name : first(id), assigned ? (assigned === "player" ? s.player.name : first(assigned)) : "")), 1800);
      let act, line;
      if (id === "player") {
        const pw = ctx.walker("player");
        pw.goTo(stage.x, stage.z);
        await walkUp(ctx, pw, stage);
        const text = await yourTurn(f.you, "Enter to say it · empty Enter to pass");
        act = await E.playerAct(s, text, { assigned });
        if (!text) { await hostSay(pick(["Nothing? Boring!", "Wow. Riveting. Sit down, sweetie.", "The silent type. Noted."]), 1600); }
        else { B.say("player", text, { name: s.player.name, color: color("player"), you: true, hold: 3.2 }); await ctx.wait(Math.max(1800, text.length * 42)); }
        await play(act, text);
      } else {
        act = acts[id];
        line = (await linesP)[id] || voice.phrase.show({ v: s.people[id], what: E.actText(s, act) });
        await speak(id, act, line);
      }
      // the woman she went for gets to answer
      if (f.rebuttal && act.subject && HOSTILE.has(act.kind) && !fought && (act.subject === "player" || !s.people[act.subject]?.gone)) {
        if (act.subject === "player") {
          await hostSay(`Ooh. ${s.player.name}, your response?`, 1500);
          const text = await yourTurn(`Answer ${first(id)}…`, "Enter to fire back · empty Enter to let it go");
          if (text) {
            B.say("player", text, { name: s.player.name, color: color("player"), you: true, hold: 3 });
            await ctx.wait(Math.max(1600, text.length * 40));
            await play(await E.playerAct(s, text, { defaultSubject: id }), text);
          }
        } else {
          const rb = await E.rebuttal(s, act.subject, act);
          const rline = await voice.showLine({ v: s.people[act.subject], title: f.title, blurb: f.blurb, place, what: rb.answer === "fire_back" ? `fire right back at ${first(id)}` : rb.answer === "sorry" ? `apologize to ${first(id)}` : E.actText(s, rb), context: `${id === "player" ? s.player.name : first(id)} just ${E.actText(s, act)}.`, playerName: s.player.name });
          close(act.subject);
          await sayAndWait(ctx, act.subject, rline, null, color, first(act.subject));
          await play(rb, rline);
        }
      }
      sitDown(id);
      await ctx.wait(500);
    }
  }

  await hostSay(pick(["That's the show, ladies! Try not to kill each other before sundown.", "And that's a wrap! Oh, the town is going to be BUZZING.", "Thank you, thank you. Same time tomorrow, my little vipers."]), 2400);
  prop.remove();
  await H.fade(true);
  H.cinema(false);
  game.endShow();
}

// ---------- staging helpers ----------

// A round rug to stand on and a little banner by Primrose, in the show's own colors.
const COLORS = { toast: "#ffb84a", clear_air: "#7ac8ff", hot_seat: "#ff5a5a", send_home: "#ff8a3a", hot_cold: "#ff7ac0", tea: "#9ad08a", soapbox: "#c89aff", confessions: "#b8a0e8", roast: "#ff6a3a" };
function makeProp(f, stage, hostAt, dir) {
  const key = Object.keys(E.FORMATS).find((k) => E.FORMATS[k] === f);
  const col = COLORS[key] || "#ff7ac0";
  const g = new THREE.Group();
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.03, 28), toon(col));
  rug.position.set(stage.x, 0.02, stage.z); g.add(rug);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 6, 28), toon("#ffffff"));
  ring.rotation.x = Math.PI / 2; ring.position.set(stage.x, 0.04, stage.z); g.add(ring);
  // the banner
  const c = document.createElement("canvas"); c.width = 512; c.height = 160;
  const x = c.getContext("2d");
  x.fillStyle = col; x.beginPath(); x.roundRect(6, 6, 500, 148, 30); x.fill();
  x.lineWidth = 8; x.strokeStyle = "#fff"; x.stroke();
  x.fillStyle = "#fff"; x.font = "bold 60px 'Baloo 2', 'Trebuchet MS', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(`${f.icon} ${f.title}`, 256, 84, 470);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  // behind Primrose, facing the camera
  const banner = new THREE.Group();
  banner.position.set(hostAt.x + (hostAt.x - stage.x) * 0.5 - dir.x * 0.8, 0, hostAt.z + (hostAt.z - stage.z) * 0.5 - dir.z * 0.8);
  banner.rotation.y = Math.atan2(dir.x, dir.z);
  for (const dx of [-1.1, 1.1]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), toon("#6a4a3a")); pole.position.set(dx, 1.3, 0); banner.add(pole); }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  sign.position.set(0, 2.35, 0.03); banner.add(sign);
  g.add(banner);
  scene.add(g);
  return { remove() { scene.remove(g); tex.dispose(); } };
}

// The stage is the open ground nearest the venue's spot. The speaker faces the camera
// and the crowd fills the free ground behind and beside her, so every face is in shot.
function staging(placeKey, n) {
  const c = L.PLACE_SPOTS[placeKey];
  let stage = { x: c.x, z: c.z };
  if (L.solidAt(stage.x, stage.z, 0.6)) {
    outer: for (let r = 1; r < 8; r += 0.5) for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const p = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
      if (!L.solidAt(p.x, p.z, 0.6)) { stage = p; break outer; }
    }
  }
  // the camera looks in from whichever side has the longest clear view, south if it can
  let dir = { x: 0, z: 1 }, bestClear = -1;
  for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.6, -2.6, Math.PI]) {
    const d = { x: Math.sin(off), z: Math.cos(off) };
    let clear = 0;
    for (let k = 1.5; k <= 14; k += 0.5) { if (L.solidAt(stage.x + d.x * k, stage.z + d.z * k, 0.5)) break; clear = k; }
    if (clear > bestClear + 1.5) { bestClear = clear; dir = d; }
    if (clear >= 14) break;
  }
  const back = Math.atan2(-dir.x, -dir.z);
  const cands = [];
  for (const r of [2.8, 3.6, 4.4, 5.2, 6.0, 6.8, 7.6]) for (let a = -Math.PI; a < Math.PI; a += Math.PI / 14) {
    const p = { x: stage.x + Math.sin(a) * r, z: stage.z + Math.cos(a) * r };
    let da = Math.abs(a - back); if (da > Math.PI) da = Math.PI * 2 - da;
    if (!L.solidAt(p.x, p.z, 0.45)) cands.push({ ...p, score: r + da * 1.6 });
  }
  cands.sort((p, q) => p.score - q.score);
  const seats = [];
  for (const p of cands) {
    if (seats.length >= n) break;
    if (seats.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 1.15)) seats.push(p);
  }
  while (seats.length < n) seats.push({ x: stage.x + (seats.length - n / 2), z: stage.z + 3 });
  // Primrose stands just beside the stage
  let hostAt = { x: stage.x + 1.4, z: stage.z - 0.3 };
  const side = { x: dir.z, z: -dir.x };
  for (const [dx, dz] of [[side.x * 1.4 - dir.x * 0.3, side.z * 1.4 - dir.z * 0.3], [-side.x * 1.4 - dir.x * 0.3, -side.z * 1.4 - dir.z * 0.3], [-dir.x * 1.4, -dir.z * 1.4]]) if (!L.solidAt(stage.x + dx, stage.z + dz, 0.4)) { hostAt = { x: stage.x + dx, z: stage.z + dz }; break; }
  return { stage, seats, hostAt, dir };
}

async function walkUp(ctx, w, to) {
  for (let i = 0; i < 24; i++) {
    if (Math.hypot(w.x - to.x, w.z - to.z) < 0.5) break;
    await ctx.wait(100);
  }
  w.stop(); w.x = to.x; w.z = to.z;
}

async function sayAndWait(ctx, id, text, ms, color, name) {
  const b = B.say(id, text, { name: name || (id === "primrose" ? "Primrose" : id), color: color(id), you: id === "player", hold: 999 });
  await ctx.waitOrEnter(ms ?? Math.max(2400, 1000 + text.length * 48));
  b.close();
  await ctx.wait(200);
}

function showTally(t) {
  const parts = [];
  if (t.loved) parts.push(`💖 ${t.loved} loved it`);
  if (t.amused) parts.push(`😂 ${t.amused} laughed`);
  if (t.unmoved) parts.push(`😐 ${t.unmoved} shrugged`);
  if (t.cringed) parts.push(`😬 ${t.cringed} cringed`);
  if (t.offended) parts.push(`💢 ${t.offended} offended`);
  const warm = t.loved + t.amused, cold = t.cringed + t.offended;
  H.voteHud(warm > cold + 1 ? "The crowd loved it!" : cold > warm + 1 ? "Oof. That did not land." : warm || cold ? "The crowd is split" : "Crickets...", parts.join(" · "));
  setTimeout(() => H.voteHud(null), 3200);
}

function vec(x, y, z) { return new THREE.Vector3(x, y, z); }
