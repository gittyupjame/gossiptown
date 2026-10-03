// The words. Every line a villager says is written by `claude -p`, but only
// after Jev and code have decided what the line has to do.

import { spawn } from "node:child_process";
import { VILLAGERS } from "./world.js";

const MODEL = process.env.CLAUDE_MODEL || "haiku";
const FAKE = process.env.GOSSIP_FAKE_LLM === "1";

export const stats = { calls: 0, ms: 0 };

const STYLE = () => `Setting: Thistlewick, a small cozy-fantasy village. Keep it grounded and human: no magic spells, no romance.
The only people in town are: ${VILLAGERS.map((v) => `${v.name} (${v.job})`).join(", ")}, plus the player, a newcomer. Do not invent other named townsfolk.
Write plain text only. No quotes around lines, no stage directions in asterisks, no narration unless asked.`;

export function ask(prompt, { timeoutMs = 45000 } = {}) {
  stats.calls++;
  const t0 = Date.now();
  if (FAKE) return Promise.resolve(fakeLine(prompt));
  return new Promise((resolve) => {
    const p = spawn("claude", ["-p", "--model", MODEL], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { p.kill(); resolve("..."); }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { clearTimeout(timer); stats.ms += Date.now() - t0; resolve(out.trim() || "..."); });
    p.on("error", () => { clearTimeout(timer); resolve(fakeLine(prompt)); });
    p.stdin.end(`${STYLE()}\n\n${prompt}`);
  });
}

function fakeLine(prompt) {
  const q = prompt.match(/Retell this piece of gossip[^"]*"([^"]+)"/);
  if (q) return q[1];
  const m = prompt.match(/Stance: (\w+)/);
  return `(${m ? m[1] : "neutral"} reply)`;
}

const describe = (v) => `${v.name}, the ${v.job}. Personality: ${v.traits.join(", ")}. Speaks: ${v.voice}.`;

// A villager answers the player. Jev already chose the stance and the reaction.
export function villagerReply({ v, history, line, stance, believes, caughtLie, act, knownAboutPlayer, mood }) {
  const react = [];
  if (caughtLie) react.push("You are sure the newcomer just lied to you, and you let it show.");
  else if (believes === true) react.push("You believe what the newcomer just told you.");
  else if (believes === false) react.push("You do not believe what the newcomer just told you.");
  if (act === "confront_subject") react.push("You intend to go confront the person this is about.");
  if (act === "report_to_elder") react.push("You say you'll take this to Elder Hesper.");
  if (act === "end_conversation") react.push("You end the conversation now.");
  return ask(`You are ${describe(v)}
Your mood: ${mood}. What you think of the newcomer: ${knownAboutPlayer}.
Conversation so far:
${history.slice(-8).join("\n") || "(just started)"}
The newcomer says: ${line}
Stance: ${stance}. ${react.join(" ")}
Reply as ${v.name.split(" ")[0]} in 1 to 3 short sentences, in your own voice.`);
}

// A conversation between two villagers that the player is close enough to hear.
export function overheard({ a, b, topic, rumorText, aboutName, outcome }) {
  return ask(`Write a short exchange (3 to 5 lines) between two villagers, each line starting with the speaker's first name and a colon.
${describe(a)}
${describe(b)}
What the conversation is: ${topic}${rumorText ? `. ${a.name.split(" ")[0]} passes on this rumor${aboutName ? ` about ${aboutName}` : ""}: "${rumorText}"` : ""}.
How it ends: ${outcome}.
No blank lines between lines.`);
}

// Rephrase a rumor the way it would sound after passing through someone's mouth.
export function retell({ teller, rumorText }) {
  return ask(`${describe(teller)}
Retell this piece of gossip in one sentence the way ${teller.name.split(" ")[0]} would pass it on, slightly changed but with the same meaning: "${rumorText}"
Output only the sentence.`);
}
