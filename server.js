// Optional game server. Serves the built page (dist/index.html) and keeps the keys off
// the browser:
//   POST /api/jev   forwards a decision request to Jev with JEV_API_KEY
//   POST /api/say   writes a line with Claude (ANTHROPIC_API_KEY, or the `claude` CLI)
//   GET  /api/health  tells the page what is available
// Run:  npm run build && npm start     then open http://localhost:4747

import "./src/env.js";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { tmpdir } from "node:os";

const PORT = Number(process.env.PORT || 4747);
const JEV_KEY = process.env.JEV_API_KEY || "";
const JEV_URL = process.env.JEV_URL || "https://api.typesafe.ai/v1/systemone";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const hasCli = (() => { try { execSync("command -v claude", { stdio: "ignore" }); return true; } catch { return false; } })();
const canSay = !!ANTHROPIC_KEY || hasCli;

async function body(req) { let b = ""; for await (const c of req) b += c; return b; }
const json = (res, code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };

async function jev(payload) {
  const r = await fetch(JEV_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${JEV_KEY}` }, body: payload, signal: AbortSignal.timeout(9000) });
  return { status: r.status, text: await r.text() };
}

async function say(prompt) {
  if (ANTHROPIC_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json();
    return d.content?.map((c) => c.text || "").join("").trim() || null;
  }
  return new Promise((resolve) => {
    const p = spawn("claude", ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence"], { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });
    let out = "";
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 40000);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { clearTimeout(timer); resolve(out.trim() || null); });
    p.on("error", () => { clearTimeout(timer); resolve(null); });
    p.stdin.end(prompt);
  });
}

createServer(async (req, res) => {
  try {
    const url = req.url.replace(/\?.*$/, "");
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      if (!existsSync("dist/index.html")) { res.writeHead(500); return res.end("Run `npm run build` first."); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return res.end(readFileSync("dist/index.html"));
    }
    if (url === "/api/health") return json(res, 200, { jev: !!JEV_KEY, say: canSay });
    if (req.method === "POST" && url === "/api/jev") {
      if (!JEV_KEY) return json(res, 503, { error: "no JEV_API_KEY" });
      const r = await jev(await body(req));
      res.writeHead(r.status, { "content-type": "application/json" });
      return res.end(r.text);
    }
    if (req.method === "POST" && url === "/api/say") {
      if (!canSay) return json(res, 503, { error: "no Claude" });
      const { prompt } = JSON.parse(await body(req));
      return json(res, 200, { text: await say(String(prompt).slice(0, 12000)) });
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 502, { error: e.message });
  }
}).listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`Gossiptown is running at http://localhost:${PORT} (Jev: ${JEV_KEY ? "key set" : "offline stand-in"}, dialogue: ${canSay ? "Claude" : "phrasebook"})`));
