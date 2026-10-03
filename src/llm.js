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
  const c = prompt.match(/The newcomer just said: (.+)/);
  if (c) return c[1];
  const m = prompt.match(/Stance: (\w+)/);
  return `(${m ? m[1] : "neutral"} reply)`;
}

const describe = (v) => `${v.name}, the ${v.job}. Personality: ${v.traits.join(", ")}. Speaks: ${v.voice}.`;

// The words must match what Jev decided. A villager never announces a plan the game
// did not decide, because nothing would make them carry it out.
const ONLY_THESE = "Do not have anyone promise, announce or hint at any plan or next step other than the ones listed here.";

// A villager answers the player. Jev already chose the stance and what they will do.
export function villagerReply({ v, history, line, stance, believes, caughtLie, plan, otherPlan, knownAboutPlayer, mood }) {
  const react = [];
  if (caughtLie) react.push("You are sure the newcomer just lied to you, and you let it show.");
  else if (believes === true) react.push("You believe what the newcomer just told you.");
  else if (believes === false) react.push("You do not believe what the newcomer just told you.");
  if (plan) react.push(`You have decided to ${plan}. You may say so.`);
  else react.push(`You have not decided to do anything about this.${otherPlan ? ` (You already mean to ${otherPlan}; you may mention it only if it fits.)` : ""}`);
  return ask(`You are ${describe(v)}
Your mood: ${mood}. What you think of the newcomer: ${knownAboutPlayer}.
Conversation so far:
${history.slice(-8).join("\n") || "(just started)"}
The newcomer says: ${line}
Stance: ${stance}. ${react.join(" ")}
${ONLY_THESE}
Reply as ${v.name.split(" ")[0]} in 1 to 3 short sentences, in your own voice.`);
}

// A conversation between two villagers that the player is close enough to hear.
export function overheard({ a, b, topic, rumorText, aboutName, outcome, next = [] }) {
  return ask(`Write a short exchange (3 to 5 lines) between two villagers, each line starting with the speaker's first name and a colon.
${describe(a)}
${describe(b)}
What the conversation is: ${topic}${rumorText ? `. The story being talked about${aboutName ? ` (about ${aboutName})` : ""}: "${rumorText}"` : ""}.
How it ends: ${outcome}.
${next.length ? `What they decide to do next: ${next.join("; ")}.` : "Nobody decides to do anything next."}
${ONLY_THESE}
No blank lines between lines.`);
}

// Turn something the player said into the story people will pass on.
export function asStory({ line, aboutName, history }) {
  return ask(`Recent conversation:
${history.slice(-6).join("\n") || "(none)"}
The newcomer just said: ${line}
Write what the newcomer is claiming about ${aboutName} as one plain sentence that names ${aboutName} and makes sense on its own. Keep the meaning, add nothing. Output only the sentence.`);
}

// Rephrase a rumor the way it would sound after passing through someone's mouth.
export function retell({ teller, rumorText }) {
  return ask(`${describe(teller)}
Retell this piece of gossip in one sentence the way ${teller.name.split(" ")[0]} would pass it on, slightly changed but with the same meaning: "${rumorText}"
Output only the sentence.`);
}
