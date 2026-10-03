// Thistlewick in the browser: a top-down town you walk around, with a text box for talking.
// Run:  node src/web.js        then open http://localhost:4747
// The game clock only runs while the page is open.
//
// The server owns the game (state, Jev, Claude) and decides which tile each villager
// stands on. The page draws the town, walks people along paths to those tiles, and
// sends back where the player is standing.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createGame } from "./game.js";
import * as sim from "./sim.js";
import { SPOTS, HOUSES, START, zoneAt, walkable } from "./public/map.js";

const PORT = Number(process.env.PORT || 4747);
const PUBLIC = new URL("./public/", import.meta.url);

let lines = [];          // everything printed so far, so a reload shows the story
let game, s;
let spot = {};           // villager id -> the tile they are standing on or walking to
let pairs = [];          // who stopped to talk to whom this quarter hour
let ppos = { ...START }; // where the player is, in tiles
let over = false, night = null, waiting = false; // waiting: the night is over, the day starts when you click
const clients = new Set();

function send(event, data) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function log(text) {
  lines.push(text);
  if (lines.length > 2000) lines = lines.slice(-2000);
  send("say", text);
}

// ---------- where villagers stand ----------

const taken = (x, y, except) =>
  Object.entries(spot).some(([id, p]) => id !== except && p && p.x === x && p.y === y) || (Math.floor(ppos.x) === x && Math.floor(ppos.y) === y);

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
    const x = t.x + dx, y = t.y + dy;
    if (walkable(x, y) && !taken(x, y, v.id) && (!zone || zoneAt(x, y) === zone)) return { x, y };
  }
  return null;
}

const distTo = (p) => Math.hypot(ppos.x - (p.x + 0.5), ppos.y - (p.y + 0.5));

// ---------- hooks the engine calls ----------

const hooks = {
  moved(v) { placeSpot(v); },
  pair(a, b, place) {
    if (!spot[a.id]) placeSpot(a);
    const p = spot[a.id] && besideTile(spot[a.id], b, place);
    if (p) spot[b.id] = p;
    pairs.push([a.id, b.id]);
  },
  // Close up you hear every word; a bit further off you catch some of it. Walls block sound.
  hearing(a, b, place) {
    const pa = spot[a.id], pb = spot[b.id];
    if (!pa || !pb) return "none";
    const myZone = zoneAt(ppos.x, ppos.y);
    const indoors = !["square", "market", "garden"].includes(place);
    if (myZone && myZone !== place) return "none";
    const d = Math.hypot(ppos.x - (pa.x + pb.x + 1) / 2, ppos.y - (pa.y + pb.y + 1) / 2);
    if (d <= 3.5 && myZone === place) return "full";
    if (d <= 8 && (myZone === place || !indoors || d <= 4)) return "part";
    return "none";
  },
  overheard({ a, b, text, full }) {
    log(`[${sim.first(s.people[a])} and ${sim.first(s.people[b])}, ${full ? "you hear every word" : "you catch part of it"}]`);
    log(text);
    send("overheard", { a, b, text });
  },
  bubble(id, text) { send("bubble", { id, text }); },
  approach(v) {
    const p = besideTile({ x: Math.floor(ppos.x), y: Math.floor(ppos.y) }, v);
    if (p) spot[v.id] = p;
  },
};

function snapshot() {
  return {
    day: s.day, clock: sim.clock(s.minute), minute: s.minute,
    place: s.player.location, talkingTo: s.player.talkingTo, bag: s.player.gifts,
    people: sim.alive(s).map((v) => ({ id: v.id, name: v.name, first: sim.first(v), job: v.employed ? v.job : "out of work", home: v.location === "home", at: spot[v.id] })),
    pairs, over, night: !!night,
  };
}

const out = {
  say: log,
  status() { send("state", snapshot()); },
  quit() { log("Saved. Close the tab whenever you like; the game picks up where you left off."); },
  ended() { over = true; send("ended", true); },
  hooks,
  beforeTick() { pairs = []; },
  afterTick() {
    // people who are not talking drift around the place they are in
    const busy = new Set(pairs.flat());
    for (const v of sim.alive(s)) if (!busy.has(v.id) && v.id !== s.player.talkingTo && SPOTS[v.location] && Math.random() < 0.3) placeSpot(v);
  },
  dusk() { night = { lines: null }; pairs = []; send("dusk", true); },
  night(lines) { night = { lines }; send("night", lines); },
  dawn() {
    night = null;
    for (const v of sim.alive(s)) placeSpot(v);
    ppos = { ...START };
    s.player.pos = ppos;
    waiting = true;
    send("dawn", { pos: ppos, state: snapshot() });
    setTimeout(() => waiting && game.stop(), 0);
  },
};

function begin(fresh) {
  game?.stop();
  lines = []; over = false; night = null; waiting = false; spot = {}; pairs = [];
  game = createGame(out, { fresh });
  s = game.state();
  ppos = s.player.pos || { ...START };
  if (!s.player.pos && s.player.location !== "square") s.player.location = "square";
  s.player.pos = ppos;
  for (const v of sim.alive(s)) placeSpot(v);
  game.save();
  log(`Thistlewick. You are the newcomer. Walk with the arrow keys or WASD. Walk up to someone and press E.`);
  send("reset", resetData());
  if (clients.size) game.start();
}
const resetData = () => ({ lines, state: snapshot(), pos: ppos, over, night: night?.lines || (night ? [] : null), waiting });
begin(process.argv.includes("--new"));

// ---------- the player ----------

function movePlayer(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
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

// Things you do to a person: talk, give, and anything typed while talking.
async function act({ cmd, near, echo, speech }) {
  if (over || night || typeof cmd !== "string") return;
  if (near) {
    const v = s.people[near];
    if (!v || v.gone || !spot[v.id] || distTo(spot[v.id]) > 3) { log("They are too far away. Walk closer."); return; }
    s.player.location = v.location;
  }
  if (echo) log(`> ${echo}`);
  await game.handle(cmd.slice(0, 2000), { speech: !!speech });
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
      clients.add(res);
      if (clients.size === 1 && !over && !night && !waiting) game.start();
      req.on("close", () => { clients.delete(res); if (!clients.size && !night) game.stop(); });
      return;
    }
    if (req.method === "POST" && req.url === "/pos") {
      const { x, y } = JSON.parse(await body(req));
      res.end("ok");
      return movePlayer(x, y);
    }
    if (req.method === "POST" && req.url === "/act") {
      const data = JSON.parse(await body(req));
      res.end("ok");
      return act(data);
    }
    if (req.method === "POST" && req.url === "/morning") {
      res.end("ok");
      if (waiting) { waiting = false; if (clients.size) game.start(); }
      return;
    }
    if (req.method === "POST" && req.url === "/new") {
      res.end("ok");
      return begin(true);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Thistlewick is running at http://localhost:${PORT}`));
