// Thistlewick in the browser: a little 3D town you walk around, where all speech
// happens in bubbles over people's heads.
// Run:  node src/web.js        then open http://localhost:4747
// The game clock only runs while the page is open and not paused.
//
// The server owns the game (state, Jev, Claude) and decides which tile each villager
// stands on. The page draws the town, walks people along paths to those tiles, and
// sends back where the player is standing.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createGame } from "./game.js";
import * as sim from "./sim.js";
import { SHOW, PLACES } from "./world.js";
import { SPOTS, HOUSES, START, STAGE, VOTE_SPOTS, zoneAt, walkable, dist } from "./public/map.js";

const PORT = Number(process.env.PORT || 4747);
const PUBLIC = new URL("./public/", import.meta.url);

let lines = [];          // everything said so far (the tracker shows it as a diary)
let game, s;
let spot = {};           // villager id -> the tile she is standing on or walking to
let pairs = [];          // who stopped to talk to whom this quarter hour
let ppos = { ...START }; // where the player is, in tiles
let over = null, night = null, waiting = false; // waiting: the night is over, the day starts when you click
let paused = true; // the world starts stopped; nothing runs and no Jev calls are made until you press Play
let ceremony = null; // the vote in progress: { stage, ... } and promises waiting on the page
const clients = new Set();

// The clock (and with it every Jev and Claude call the town makes) only runs while
// a page is open, the game is not paused, and it is daytime.
function syncClock() {
  const run = clients.size > 0 && !paused && !over && !night && !waiting && !ceremony;
  if (run && !game.running()) game.start();
  if (!run && game.running()) game.stop();
}

function send(event, data) {
  // a page that opens in the middle of the vote gets the vote so far
  if (event === "ceremony" && ceremony) (ceremony.log ||= []).push(data);
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function log(text) {
  lines.push({ day: s?.day, time: s ? sim.clock(s.minute) : "", text });
  if (lines.length > 400) lines = lines.slice(-400);
}

// ---------- where villagers stand ----------

const taken = (x, y, except) =>
  Object.entries(spot).some(([id, p]) => id !== except && p && Math.floor(p.x) === x && Math.floor(p.y) === y) || (Math.floor(ppos.x) === x && Math.floor(ppos.y) === y);

function placeSpot(v) {
  if (v.gone) { spot[v.id] = null; return; }
  if (v.location === "home") { spot[v.id] = { ...HOUSES[v.id] }; return; }
  const list = SPOTS[v.location];
  if (!list) { spot[v.id] = null; return; }
  for (let i = 0; i < 40; i++) {
    const p = list[Math.floor(Math.random() * list.length)];
    if (!taken(p.x, p.y, v.id)) { spot[v.id] = { x: p.x, y: p.y }; return; }
  }
  spot[v.id] = { ...list[0] };
}

function besideTile(t, v, zone) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = Math.floor(t.x) + dx, y = Math.floor(t.y) + dy;
    if (walkable(x, y) && !taken(x, y, v.id) && (!zone || zoneAt(x, y) === zone)) return { x, y };
  }
  return null;
}

const distTo = (p) => dist(ppos.x, ppos.y, p.x + 0.5, p.y + 0.5);

// ---------- hooks the engine calls ----------

const hooks = {
  moved(v) { placeSpot(v); },
  pair(a, b, place) {
    if (!spot[a.id]) placeSpot(a);
    // b walks over to a, unless they are already standing together
    const near = spot[a.id] && spot[b.id] && dist(spot[a.id].x, spot[a.id].y, spot[b.id].x, spot[b.id].y) <= 1.5;
    const p = !near && spot[a.id] && besideTile(spot[a.id], b, place);
    if (p) spot[b.id] = p;
    pairs.push([a.id, b.id]);
  },
  // Close up you hear every word; a bit further off you catch some of it.
  hearing(a, b, place) {
    const pa = spot[a.id], pb = spot[b.id];
    if (!pa || !pb) return "none";
    const d = dist(ppos.x, ppos.y, (pa.x + pb.x + 1) / 2, (pa.y + pb.y + 1) / 2);
    if (d <= 3.2) return "full";
    if (d <= 7) return "part";
    return "none";
  },
  isNear(v) { return !!spot[v.id] && distTo(spot[v.id]) <= 7; },
  overheard({ a, b, text, full, mood }) {
    log(`[${sim.first(s.people[a])} and ${sim.first(s.people[b])}${full ? "" : ", half heard"}] ${text.replace(/\n/g, " / ")}`);
    send("overheard", { a, b, text, full, mood });
  },
  bubble(id, text, mood) { send("bubble", { id, text, mood }); },
  emote(id, kind) { send("emote", { id, kind }); },
  learned(r) { send("learned", { text: r.text, about: r.about, from: r.from }); },
  approach(v) {
    const p = besideTile(ppos, v);
    if (p) spot[v.id] = p;
    send("state", snapshot());
  },
  opened(v, line) {
    spot[v.id] = besideTile(ppos, v) || spot[v.id];
    send("state", snapshot());
    send("opened", { id: v.id, text: line });
  },
};

function snapshot() {
  const vd = sim.voteDay(s.day);
  return {
    day: s.day, clock: sim.clock(s.minute), minute: s.minute, voteIn: vd - s.day,
    place: s.player.location, talkingTo: s.player.talkingTo, approaching: s.approaching || null,
    people: Object.values(s.people).map((v) => ({ id: v.id, name: v.name, first: sim.first(v), job: v.job, gone: v.gone, home: v.location === "home", at: spot[v.id] })),
    pairs, over, night: !!night, paused, ceremony: ceremony?.stage || null,
  };
}

// ---------- the vote, as an event the page plays out ----------

const ceremonyHooks = {
  async gather() {
    const cast = sim.alive(s);
    const order = [...cast.map((v) => v.id), "player"].sort(() => Math.random() - 0.5);
    const spots = {};
    order.forEach((id, i) => (spots[id] = VOTE_SPOTS[i]));
    for (const v of cast) spot[v.id] = { ...spots[v.id], exact: true };
    ppos = { ...spots.player };
    ceremony = { stage: "gather", spots, log: [] };
    syncClock();
    send("ceremony", { stage: "gather", spots, stage_at: STAGE, host: SHOW.host });
    send("state", snapshot());
  },
  ballot(candidates, hostLine) {
    ceremony.stage = "ballot";
    send("ceremony", { stage: "ballot", candidates, host: hostLine });
    return new Promise((resolve) => (ceremony.vote = resolve));
  },
  reveal(show) {
    ceremony.stage = "reveal";
    const names = Object.fromEntries([...Object.values(s.people).map((v) => [v.id, sim.first(v)]), ["player", "You"]]);
    send("ceremony", { stage: "reveal", ...show, names });
    return new Promise((resolve) => {
      ceremony.next = resolve;
      setTimeout(resolve, 6 * 60 * 1000); // never hang forever if the page is closed
    });
  },
  async done() {
    ceremony = null;
    send("ceremony", { stage: "end" });
  },
};

const out = {
  say: log,
  status() { send("state", snapshot()); },
  quit() {},
  ended(result) { over = result; ceremony = null; syncClock(); send("ended", result); send("state", snapshot()); },
  hooks,
  ceremony: ceremonyHooks,
  beforeTick() { pairs = []; },
  afterTick() {
    // now and then someone who is not talking takes a few steps within the place she is in
    const busy = new Set(pairs.flat());
    for (const v of sim.alive(s)) {
      if (busy.has(v.id) || v.id === s.player.talkingTo || v.id === s.approaching || !SPOTS[v.location] || !spot[v.id] || Math.random() > 0.08) continue;
      const close = SPOTS[v.location].filter((p) => dist(p.x, p.y, spot[v.id].x, spot[v.id].y) <= 2.5 && !taken(p.x, p.y, v.id));
      if (close.length) spot[v.id] = { ...close[Math.floor(Math.random() * close.length)] };
    }
  },
  dusk() { night = { lines: null }; pairs = []; syncClock(); send("dusk", { day: s.day }); },
  night(lines) { night = { lines }; send("night", lines); },
  dawn() {
    night = null;
    for (const v of sim.alive(s)) placeSpot(v);
    ppos = { ...START };
    s.player.pos = ppos;
    waiting = true;
    send("dawn", { pos: ppos, state: snapshot(), day: s.day, voteTonight: sim.voteDay(s.day) === s.day });
    setTimeout(syncClock, 0);
  },
};

function begin(fresh) {
  game?.stop();
  lines = []; over = null; night = null; waiting = false; ceremony = null; spot = {}; pairs = [];
  game = createGame(out, { fresh });
  s = game.state();
  over = s.over || null;
  if (s.ceremony) s.ceremony = false; // a vote cut off by a restart starts again at six
  ppos = s.player.pos || { ...START };
  s.player.pos = ppos;
  s.player.talkingTo = null; s.approaching = null;
  for (const v of sim.alive(s)) placeSpot(v);
  game.save();
  send("reset", resetData());
  syncClock();
}
const resetData = () => ({ state: snapshot(), pos: ppos, over, night: night?.lines || (night ? [] : null), waiting, show: SHOW, places: PLACES });
begin(process.argv.includes("--new") || !existsSync("save.json"));

// ---------- the player ----------

function movePlayer(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || paused || ceremony) return;
  ppos = { x, y };
  s.player.pos = ppos;
  if (s.player.talkingTo) {
    const p = spot[s.player.talkingTo];
    if (p && distTo(p) <= 3.5) return; // still close enough to keep talking
    game.handle("bye");
  }
  const loc = zoneAt(x, y) || "road";
  if (loc !== s.player.location) { s.player.location = loc; send("state", snapshot()); }
}

// Talking to someone: starting, each line you say, and goodbye.
async function act({ cmd, near, speech, at }) {
  if (over || night || ceremony || typeof cmd !== "string") return;
  if (paused) return;
  if (near) {
    const v = s.people[near];
    // starting a conversation stops her where she stands (the page says where that is, since she may be mid-walk)
    const starting = v && !v.gone && at && /^talk /.test(cmd) && walkable(at.x, at.y) && distTo(at) <= 3;
    if (starting) spot[v.id] = { x: at.x, y: at.y };
    if (!v || v.gone || !spot[v.id] || distTo(spot[v.id]) > 3.5) return;
    if (PLACES[v.location]) s.player.location = v.location;
  }
  if (speech) log(`You: ${cmd}`);
  await game.handle(cmd.slice(0, 600), { speech: !!speech });
  send("state", snapshot());
}

// ---------- http ----------

async function body(req) {
  let b = "";
  for await (const chunk of req) b += chunk;
  return b;
}

const TYPES = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".css": "text/css" };

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || /^\/[a-z]+\.(js|css|html)$/.test(req.url))) {
      const file = req.url === "/" ? "index.html" : req.url.slice(1);
      res.writeHead(200, { "content-type": TYPES[file.slice(file.lastIndexOf("."))], "cache-control": "no-cache" });
      return res.end(readFileSync(new URL(file, PUBLIC)));
    }
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: reset\ndata: ${JSON.stringify(resetData())}\n\n`);
      for (const d of ceremony?.log || []) res.write(`event: ceremony\ndata: ${JSON.stringify(d)}\n\n`);
      clients.add(res);
      syncClock();
      req.on("close", () => { clients.delete(res); syncClock(); });
      return;
    }
    if (req.method === "GET" && req.url === "/tracker") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...sim.tracker(s), diary: lines.slice(-80) }));
    }
    if (req.method !== "POST") { res.writeHead(404); return res.end(); }
    const data = JSON.parse((await body(req)) || "{}");
    res.end("ok");
    if (req.url === "/pos") return movePlayer(data.x, data.y);
    if (req.url === "/act") return act(data);
    if (req.url === "/pause") { paused = !!data.paused; syncClock(); return send("state", snapshot()); }
    if (req.url === "/morning") { if (waiting) { waiting = false; syncClock(); } return; }
    if (req.url === "/vote") { if (ceremony?.vote && (s.people[data.target] && !s.people[data.target].gone)) { const f = ceremony.vote; ceremony.vote = null; f(data.target); } return; }
    if (req.url === "/ceremony-next") { const f = ceremony?.next; if (f) { ceremony.next = null; f(); } return; }
    if (req.url === "/new") return begin(true);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
}).listen(PORT, "127.0.0.1", () => console.log(`${SHOW.name} is running at http://localhost:${PORT}`));
