// Thistlewick in the browser. Same game as main.js, shown on a web page.
// Run:  node src/web.js        then open http://localhost:4747
// The clock only runs while the page is open.

import { createServer } from "node:http";
import { createGame } from "./game.js";

const PORT = Number(process.env.PORT || 4747);
let lines = [];         // everything printed so far, so a reload shows the story
let statusText = "";
let over = false;
const clients = new Set();

function send(event, data) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
const out = {
  say(text) { lines.push(text); if (lines.length > 2000) lines = lines.slice(-2000); send("say", text); },
  status(text) { statusText = text; send("status", text); },
  quit() { out.say("Saved. Close the tab whenever you like; the game picks up where you left off."); },
  ended() { over = true; send("ended", true); },
};

let game;
function begin(fresh) {
  game?.stop();
  lines = []; over = false;
  game = createGame(out, { fresh });
  game.save();
  out.say(game.intro());
  out.status(game.status());
  send("reset", { lines, status: statusText, over });
  if (clients.size) game.start();
}
begin(process.argv.includes("--new"));

async function body(req) {
  let b = "";
  for await (const chunk of req) b += chunk;
  return b;
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`event: reset\ndata: ${JSON.stringify({ lines, status: statusText, over })}\n\n`);
    clients.add(res);
    if (clients.size === 1 && !over) game.start();
    req.on("close", () => { clients.delete(res); if (!clients.size) game.stop(); });
    return;
  }
  if (req.method === "POST" && req.url === "/say") {
    const text = (await body(req)).slice(0, 2000);
    res.end("ok");
    out.say(`> ${text}`);
    await game.handle(text);
    return;
  }
  if (req.method === "POST" && req.url === "/new") {
    res.end("ok");
    begin(true);
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`Thistlewick is running at http://localhost:${PORT}`));

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thistlewick</title>
<style>
  :root { --bg:#1b1a17; --fg:#e9e2d0; --dim:#9b937f; --you:#e8b860; --accent:#7fb27f; --panel:#25231f; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 ui-monospace, Menlo, monospace; height:100vh; display:flex; flex-direction:column; }
  header { padding:10px 16px; background:var(--panel); display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  header b { color:var(--accent); }
  #status { color:var(--dim); }
  #log { flex:1; overflow-y:auto; padding:16px; white-space:pre-wrap; word-wrap:break-word; }
  .you { color:var(--you); }
  .event { color:var(--dim); }
  form { display:flex; gap:8px; padding:12px 16px; background:var(--panel); }
  input { flex:1; font:inherit; padding:10px; background:var(--bg); color:var(--fg); border:1px solid #444; border-radius:6px; }
  button { font:inherit; padding:8px 14px; background:#3a3a30; color:var(--fg); border:1px solid #555; border-radius:6px; cursor:pointer; }
  .quick { display:flex; gap:6px; flex-wrap:wrap; padding:0 16px 10px; background:var(--panel); }
  .quick button { padding:4px 10px; font-size:14px; }
</style></head>
<body>
<header><span><b>Thistlewick</b> <span id="status"></span></span><button id="new">New game</button></header>
<div id="log"></div>
<form id="f"><input id="in" autocomplete="off" autofocus placeholder="Type a command, or what you say..."><button>Send</button></form>
<div class="quick">
  <button data-c="look">look</button><button data-c="help">help</button><button data-c="map">map</button>
  <button data-c="journal">journal</button><button data-c="bag">bag</button><button data-c="listen">listen</button>
  <button data-c="wait">wait</button><button data-c="bye">bye</button>
</div>
<script>
  const log = document.getElementById("log"), input = document.getElementById("in"), statusEl = document.getElementById("status");
  function add(text) {
    const d = document.createElement("div");
    if (text.startsWith("> ")) d.className = "you";
    else if (text.startsWith("*") || text.startsWith("\\n[")) d.className = "event";
    d.textContent = text;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.appendChild(d);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  const es = new EventSource("/events");
  es.addEventListener("reset", (e) => { const d = JSON.parse(e.data); log.innerHTML = ""; d.lines.forEach(add); statusEl.textContent = d.status; log.scrollTop = log.scrollHeight; });
  es.addEventListener("say", (e) => add(JSON.parse(e.data)));
  es.addEventListener("status", (e) => statusEl.textContent = JSON.parse(e.data));
  es.addEventListener("ended", () => add("Press New game to start again."));
  function send(text) { if (text.trim()) fetch("/say", { method: "POST", body: text }); }
  document.getElementById("f").onsubmit = (e) => { e.preventDefault(); send(input.value); input.value = ""; input.focus(); };
  document.querySelectorAll(".quick button").forEach((b) => b.onclick = () => { send(b.dataset.c); input.focus(); });
  document.getElementById("new").onclick = () => { if (confirm("Start a fresh town? Your current game will be replaced.")) fetch("/new", { method: "POST" }); };
</script>
</body></html>`;
