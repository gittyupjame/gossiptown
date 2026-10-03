// The words. Every line anyone says is written by `claude -p`, but only after Jev and
// code have decided what the line has to do.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { VILLAGERS, SHOW } from "./world.js";

const MODEL = process.env.CLAUDE_MODEL || "haiku";
const FAKE = process.env.GOSSIP_FAKE_LLM === "1";

export const stats = { calls: 0, ms: 0 };

const STYLE = () => `Setting: ${SHOW.name}, a cute little town that is also a reality show. Every few days the town votes one woman out; the last one standing wins.
Tone: catty, gossipy reality TV. Everyone is two-faced, petty and playing to win. Sharp, funny and mean, but no slurs, no swearing stronger than "hell", no violence, no romance.
Everyone in town is a woman (she/her), and so is the player, a newcomer. The only people in town are: ${VILLAGERS.map((v) => `${v.name} (${v.job})`).join(", ")}, the host ${SHOW.host.name}, and the newcomer. Do not invent other named people.
Write plain text only. No quotes around lines, no stage directions in asterisks, no emoji, no narration unless asked. Keep lines short: these appear in speech bubbles.`;

export function ask(prompt, { timeoutMs = 45000 } = {}) {
  stats.calls++;
  const t0 = Date.now();
  if (FAKE) return Promise.resolve(fakeLine(prompt));
  return new Promise((resolve) => {
    // A bare call: no tools, no MCP servers, no hooks or user settings, nothing saved.
    // Loading all of those made each line take minutes instead of seconds.
    const p = spawn("claude", ["-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--no-chrome"],
      { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });
    let out = "";
    const timer = setTimeout(() => { p.kill(); resolve("..."); }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { clearTimeout(timer); stats.ms += Date.now() - t0; resolve(out.trim().replace(/^"|"$/g, "") || "..."); });
    p.on("error", () => { clearTimeout(timer); resolve(fakeLine(prompt)); });
    p.stdin.end(`${STYLE()}\n\n${prompt}`);
  });
}

function fakeLine(prompt) {
  const q = prompt.match(/Retell this piece of gossip[^"]*"([^"]+)"/);
  if (q) return q[1];
  const c = prompt.match(/The newcomer just said: (.+)/);
  if (c) return c[1];
  if (/short exchange/.test(prompt)) {
    const names = [...prompt.matchAll(/^([A-Z][a-z]+) [A-Z][a-z]+, /gm)].map((m) => m[1]);
    return `${names[0] || "A"}: (gossip)\n${names[1] || "B"}: (gossip back)`;
  }
  const m = prompt.match(/Stance: (\w+)/);
  return `(${m ? m[1] : "a line"})`;
}

const describe = (v) => `${v.name}, ${v.job}. Personality: ${v.traits.join(", ")}. Speaks: ${v.voice}. Game plan: ${v.agenda}`;
const firstName = (v) => v.name.split(" ")[0];

// The words must match what Jev decided. A villager never announces a plan the game
// did not decide, because nothing would make her carry it out.
const ONLY_THESE = "Do not have anyone promise, announce or hint at any plan, deal or next step other than the ones listed here.";

// A villager answers the player. Jev already chose the stance and what she will do.
export function villagerReply({ v, history, line, stance, believes, caughtLie, plan, otherPlan, deal, reveal, gossip, knownAboutPlayer, mood }) {
  const react = [];
  if (caughtLie) react.push("You are sure the newcomer just lied to you, and you let it show.");
  else if (believes === true) react.push("You believe what the newcomer just told you.");
  else if (believes === false) react.push("You do not believe what the newcomer just told you.");
  if (deal) react.push(deal);
  if (reveal) react.push(reveal);
  if (gossip) react.push(`You tell her this piece of gossip: "${gossip}"`);
  if (plan) react.push(`You have decided to ${plan}. You may say so.`);
  else react.push(`You have not decided to do anything else.${otherPlan ? ` (You already mean to ${otherPlan}; mention it only if it fits.)` : ""}`);
  return ask(`You are ${describe(v)}
Your mood: ${mood}. What you think of the newcomer: ${knownAboutPlayer}.
Conversation so far:
${history.slice(-8).join("\n") || "(just started)"}
The newcomer says: ${line}
Stance: ${stance}. ${react.join(" ")}
${ONLY_THESE}
Reply as ${firstName(v)} in 1 to 2 short sentences, in your own voice.`);
}

// A villager walks up to the newcomer and opens a conversation.
export function opener({ v, want, rumorText, feelings, recent }) {
  return ask(`You are ${describe(v)}
You ${feelings}. Recently: ${recent.join(" | ") || "nothing much"}.
You walk up to the newcomer to ${want}.${rumorText ? ` You tell her this piece of gossip: "${rumorText}"` : ""}
${ONLY_THESE}
Say your opening line to her as ${firstName(v)}: 1 or 2 short sentences, in your own voice.`);
}

// A conversation between two villagers that the player is close enough to hear.
export function overheard({ a, b, topic, rumorText, aboutName, outcome, next = [] }) {
  return ask(`Write a short exchange (3 or 4 lines) between two women, each line starting with the speaker's first name and a colon.
${describe(a)}
${describe(b)}
What the conversation is: ${topic}${rumorText ? `. The story being talked about${aboutName ? ` (about ${aboutName})` : ""}: "${rumorText}"` : ""}.
How it ends: ${outcome}.
${next.length ? `What they decide: ${next.join("; ")}.` : "Nobody decides to do anything next."}
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
Retell this piece of gossip in one sentence the way ${firstName(teller)} would pass it on, slightly changed but with the same meaning: "${rumorText}"
Output only the sentence.`);
}

// At the vote: why she wrote that name, said to the whole town.
export function voteLine({ v, targetName, recent }) {
  return ask(`You are ${describe(v)}
It is the vote, in front of the whole town. You voted to send home ${targetName}. Recently: ${recent.join(" | ") || "nothing much"}.
Say one short, catty sentence as you reveal your vote, in your own voice. Name ${targetName}.`);
}

// The one voted out says goodbye.
export function partingLine({ v, votes }) {
  return ask(`You are ${describe(v)}
The town just voted you out with ${votes} vote${votes === 1 ? "" : "s"}. Say one or two short sentences as you leave: bitter, dramatic or gracious, the way you would.`);
}

// The host of the vote.
export function hostLine({ moment }) {
  return ask(`You are ${SHOW.host.name}, the host of the vote. You speak like a ${SHOW.host.voice}.
${moment}
Say one or two short sentences.`);
}
