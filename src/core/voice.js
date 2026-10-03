// The words. Every line a cast member says is written by Claude, but only after Jev and
// code have decided what the line has to do. Claude is reached in one of two ways:
//   - on claude.ai, through the page's `sample` capability (runs on the viewer's account)
//   - from the Node server in this repo, at /api/say
// With neither, a phrasebook fills in so the game still plays.

import { VILLAGERS, HOST } from "./cast.js";

let backend = null;   // "sample" | "server" | null
let sampleFn = null;
let failures = 0;
export const stats = { calls: 0, ms: 0, fallbacks: 0 };

export async function initVoice() {
  try {
    if (window.claude?.use) {
      const s = await Promise.race([window.claude.use("sample"), new Promise((r) => setTimeout(() => r(null), 10000))]);
      if (s) { sampleFn = s; backend = "sample"; return backend; }
    }
  } catch {}
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    if (r.ok && (await r.json()).say) { backend = "server"; return backend; }
  } catch {}
  backend = null;
  return backend;
}

export function voiceStatus() {
  if (backend === "sample") return { live: failures < 3, label: "Claude (your account)" };
  if (backend === "server") return { live: failures < 3, label: "Claude (server)" };
  return { live: false, label: "Phrasebook" };
}

const first = (v) => v.first || v.name.split(" ")[0];
const cast = () => VILLAGERS.map((v) => `${v.name} (${v.job})`).join(", ");

const STYLE = (playerName) => `You write dialogue for "Gossiptown", a cozy-looking village reality show with a vicious heart. Ten women live in a tiny storybook town and every few days they vote one of their own out. Think reality TV: catty, two-faced, shady, dramatic, funny. Sweet to faces, savage behind backs. Everyone is a woman. No romance, no flirting. No violence beyond a shove. No magic spells.
The cast: ${cast()}. The host is ${HOST.name}. The newcomer (the player) is called ${playerName}. Never invent other named townsfolk.
Write plain spoken words only: no quotation marks, no stage directions, no asterisks, no emoji, no narration.`;

async function raw(prompt, { maxMs = 30000, onText } = {}) {
  stats.calls++;
  const t0 = performance.now();
  try {
    let text = null;
    if (backend === "sample") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), maxMs);
      try {
        const r = await sampleFn(prompt, { modelTier: "quick", cache: false, signal: ctrl.signal, onText: onText ? ({ text }) => onText(text) : undefined });
        text = r.text;
      } finally { clearTimeout(timer); }
    } else if (backend === "server") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), maxMs);
      try {
        const r = await fetch("api/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }), signal: ctrl.signal });
        if (r.ok) text = (await r.json()).text;
      } finally { clearTimeout(timer); }
    }
    stats.ms += performance.now() - t0;
    text = clean(text);
    if (text) { failures = 0; return text; }
  } catch (e) {
    if (e?.code === "not_granted") backend = null;
  }
  if (backend) failures++;
  stats.fallbacks++;
  return null;
}

const clean = (t) => (t || "").trim().replace(/^["“]|["”]$/g, "").replace(/\*[^*]+\*/g, "").trim();

const describe = (v) => `${v.name}, the ${v.job} (${v.archetype}). Personality: ${v.traits.join(", ")}. Speaks: ${v.voice}.`;
const ONLY = "Do not have anyone promise, announce or hint at any plan, vote or next step other than the ones listed here.";

// ---------- the cast member answers the player ----------

export async function reply(ctx, onText) {
  const { v, playerName, history, line, stance, react, plan, otherPlan, opinion, mood } = ctx;
  const text = await raw(`${STYLE(playerName)}

You are ${describe(v)}
Your mood: ${mood}. What you think of ${playerName}: ${opinion}.
Conversation so far:
${history.slice(-8).join("\n") || "(just started)"}
${playerName} says: ${line}
How you respond: ${stance}. ${react.join(" ")}
${plan ? `You have decided to ${plan}. You may say so.` : `You have not decided to do anything about this.${otherPlan ? ` (You already mean to ${otherPlan}; mention it only if it fits.)` : ""}`}
${ONLY}
Reply as ${first(v)} in 1 to 2 short sentences, in your own voice. Keep it under 30 words.`, { onText });
  return text || phrase.reply(ctx);
}

// ---------- a cast member walks up to the player ----------

export async function opener(ctx) {
  const { v, playerName, purpose, detail, opinion } = ctx;
  const text = await raw(`${STYLE(playerName)}

You are ${describe(v)}
What you think of ${playerName}: ${opinion}.
You walk straight up to ${playerName} to ${purpose}${detail ? `: ${detail}` : ""}.
${ONLY}
Say your opening line as ${first(v)}, 1 to 2 short sentences, under 25 words.`, { maxMs: 12000 });
  return text || phrase.opener(ctx);
}

// ---------- two cast members talking, overheard by the player ----------

export async function exchange(ctx) {
  const { a, b, playerName, topic, rumorText, aboutName, outcome, next } = ctx;
  const text = await raw(`${STYLE(playerName)}

Write a short exchange of 3 to 4 lines between two women, each line starting with the speaker's first name and a colon.
${describe(a)}
${describe(b)}
What they talk about: ${topic}${rumorText ? `. The story${aboutName ? ` (about ${aboutName})` : ""}: "${rumorText}"` : ""}.
How it ends: ${outcome}.
${next.length ? `What they decide to do next: ${next.join("; ")}.` : "Nobody decides to do anything next."}
${ONLY}
Each line under 18 words. No blank lines.`);
  const lines = parseLines(text, [a, b]);
  return lines.length >= 2 ? lines : phrase.exchange(ctx);
}

function parseLines(text, people) {
  if (!text) return [];
  return text.split("\n").map((l) => l.match(/^\s*([^:]{1,30}):\s*(.+)$/)).filter(Boolean).map((m) => {
    const who = people.find((p) => m[1].toLowerCase().includes(first(p).toLowerCase()));
    return who ? { id: who.id, text: clean(m[2]) } : null;
  }).filter(Boolean);
}

// ---------- turning words into stories that travel ----------

export async function asStory({ line, aboutName, history, playerName }) {
  const text = await raw(`Recent conversation:
${history.slice(-6).join("\n") || "(none)"}
${playerName} just said: ${line}
Write what ${playerName} is claiming about ${aboutName} as one plain sentence that names ${aboutName} and makes sense on its own. Keep the meaning, add nothing. Output only the sentence.`, { maxMs: 20000 });
  return text;
}

export async function retell({ teller, rumorText, playerName }) {
  const text = await raw(`${STYLE(playerName)}

${describe(teller)}
Retell this piece of gossip in one juicy sentence the way ${first(teller)} would pass it on, a little exaggerated but the same story: "${rumorText}"
Output only the sentence.`, { maxMs: 10000 });
  return text;
}

// ---------- the vote ----------

export async function partingShot({ v, playerName, votedBy, betrayedBy }) {
  const text = await raw(`${STYLE(playerName)}

You are ${describe(v)}
You have just been voted out of Gossiptown and must leave town tonight. Voted against you: ${votedBy.join(", ") || "nobody you expected"}.${betrayedBy.length ? ` You feel betrayed by ${betrayedBy.join(", ")}.` : ""}
Say your exit line as ${first(v)}: one or two dramatic sentences, under 28 words.`, { maxMs: 20000 });
  return text || phrase.parting({ v, betrayedBy });
}

export async function voteReaction({ v, voter, playerName, wasAlly }) {
  return phrase.voteReaction({ v, voter, wasAlly });
}

// =====================================================================
// The phrasebook: used when Claude can't be reached, and for quick barks.
// =====================================================================

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const VOICE_TICS = {
  celeste: { hi: ["Darling!", "Sweetie, hi!", "Oh, it's you. Love that for you."], yes: ["Of course, darling.", "Mm, I adore that.", "Obviously."], no: ["Oh sweetie, no.", "That's adorable. No.", "Darling, please."], bye: ["Kisses!", "Ta-ta, darling."] },
  odette: { hi: ["Well, well.", "Ah. The new one.", "Looking for a deal?"], yes: ["That could be arranged.", "Interesting. Very interesting.", "I'll remember that."], no: ["I don't think so, dear.", "That's not worth my time.", "No deal."], bye: ["Don't be a stranger. I always find them.", "We'll talk."] },
  wren: { hi: ["Hello, love!", "Oh, love, come here, come here!", "There she is!"], yes: ["No! Really? Tell me everything!", "Oh, I KNEW it, love!", "Ooh, love, that's juicy."], no: ["Oh, love, I don't think so.", "Ooh, I'm not sure about that, love.", "Really? Hm."], bye: ["Off you go, love!", "Come back with more, love!"] },
  sylvie: { hi: ["Oh. Hi.", "What.", "Look who it is."], yes: ["Fine. Sure.", "Huh. Didn't think you had it in you.", "Yeah, that tracks."], no: ["Wow. No.", "Sure you did.", "Riveting. No."], bye: ["Bye, I guess.", "Don't trip on the way out."] },
  marigold: { hi: ["Oh! Hi, hello!", "Oh gosh, hi.", "Hello! Sorry, hi!"], yes: ["Oh gosh, really?", "Okay, okay, I believe you...", "That makes sense, I suppose..."], no: ["Oh, I don't know about that...", "Gosh, I hope that's not true.", "I'd really rather not..."], bye: ["Okay, bye! Sorry!", "Take care, okay?"] },
  pippa: { hi: ["Hi hi hi!", "Oh! It's you! Honest, I was just thinking about you!", "Heyyy!"], yes: ["No way! Honest?", "Totally, totally!", "Oh wow, okay, yes!"], no: ["Wait, really? No, I don't think so, honest.", "Hmm, that doesn't sound right?", "Nooo."], bye: ["Bye! Honest, come back!", "See you!"] },
  brenna: { hi: ["What do you want.", "Hm.", "Make it quick."], yes: ["Fine.", "Fair.", "Good."], no: ["No.", "Don't waste my time.", "Not buying it."], bye: ["Right.", "Go on, then."] },
  juniper: { hi: ["Oh, you came. The crows said you might.", "Hello, little moth.", "Your aura is all orange today."], yes: ["Yes... the leaves agree.", "That feels true in my bones.", "Mm. I sensed that."], no: ["The moon disagrees.", "No... that one smells wrong.", "I don't think the stars believe you."], bye: ["Mind the puddles.", "Go gently."] },
  hesper: { hi: ["Yes, dear?", "You again.", "State your business, dear."], yes: ["Noted.", "That is acceptable.", "I see."], no: ["I very much doubt it, dear.", "Nonsense.", "That is not how we do things here."], bye: ["Good day, dear.", "That will be all."] },
  tansy: { hi: ["Oh, perfect timing.", "Hello! Got a minute? I have questions.", "There's my favorite new face."], yes: ["Fascinating. Go on.", "Noted. Very noted.", "Oh, that's going in the notebook."], no: ["Hm. That doesn't add up.", "Interesting choice of story.", "I'll need a second source for that."], bye: ["Let's do this again.", "Stay interesting."] },
  primrose: { hi: ["Hello, hello!"], yes: ["Wonderful!"], no: ["Oh dear."], bye: ["Toodles!"] },
};
const tic = (v, k) => pick((VOICE_TICS[v.id] || VOICE_TICS.primrose)[k]);
const name = (v) => first(v);

export const phrase = {
  reply({ v, stance, react, plan, playerName }) {
    const parts = [];
    if (react.some((r) => r.includes("lied"))) parts.push(pick(["You're lying to my face. Cute.", "Oh, please. I know that's not true.", "Nice try. I know better."]));
    else if (react.some((r) => r.includes("You believe"))) parts.push(tic(v, "yes"));
    else if (react.some((r) => r.includes("do not believe"))) parts.push(tic(v, "no"));
    else if (react.some((r) => r.includes("agree"))) parts.push(pick(["Fine. You've got a deal.", "Okay. We're in this together.", "Deal. Don't make me regret it."]));
    else if (react.some((r) => r.includes("turn down"))) parts.push(pick(["I don't team up with just anyone.", "Not a chance.", "Ask me again when you've earned it."]));
    else parts.push({ warm: tic(v, "hi"), polite: pick(["Mm-hm.", "I see.", "Right."]), guarded: pick(["Why are you telling me this?", "Hm. Careful.", "What do you want?"]), curious: pick(["Go on...", "Ooh, and then?", "Tell me more."]), dismissive: pick(["Okay. And?", "Is that all?", "Riveting."]), hostile: pick(["Back off.", "Who asked you?", "Get out of my face."]) }[stance] || tic(v, "yes"));
    if (plan) parts.push(pick(["I'm going to do something about this.", "Leave it with me.", "Oh, someone's hearing about this."]));
    return parts.join(" ");
  },
  opener({ v, purpose, playerName }) {
    if (/team up|alliance/.test(purpose)) return pick([`Psst. ${playerName}. You and me should stick together.`, `Walk with me. I think we could help each other.`, `I like you. Don't make it weird. Want to team up?`]);
    if (/vote/.test(purpose)) return pick([`So. Who are you voting for? Asking for a friend.`, `The vote's coming. I have a name in mind. Do you?`, `Between us, I know who should go next.`]);
    if (/gossip|tea|tell/.test(purpose)) return pick([`Okay, you did NOT hear this from me...`, `Come here. You need to hear this.`, `Have you heard what's going around?`]);
    if (/confront|warn/.test(purpose)) return pick([`We need to talk. Now.`, `I heard what you've been saying.`, `You've got some nerve, new girl.`]);
    return `${tic(v, "hi")} Got a minute?`;
  },
  exchange({ a, b, topic, rumorText, aboutName, outcome }) {
    const A = a.id, B = b.id;
    if (rumorText) {
      const t = rumorText.length > 90 ? rumorText.slice(0, 88) + "..." : rumorText;
      if (/asks .* about what people are saying about them/.test(topic)) return [
        { id: A, text: pick(["So. I heard something about you.", "Is it true? What everyone's saying?"]) },
        { id: A, text: t },
        { id: B, text: /admit/.test(outcome) ? pick(["...Fine. It's true. Happy?", "Who told you that? ...Okay, yes."]) : pick(["That is a filthy lie.", "Excuse me? Who said that?"]) },
        { id: A, text: /not convinced/.test(outcome) ? pick(["Mm-hm. Sure.", "Whatever you say."]) : pick(["Okay, okay. I believe you.", "Fine. Sorry I asked."]) },
      ];
      return [
        { id: A, text: pick(["Okay, don't tell anyone, but...", "You did not hear this from me.", "Brace yourself."]) },
        { id: A, text: t },
        { id: B, text: /believes/.test(outcome) ? pick(["Stop. No. I KNEW it.", "Shut up. That explains everything.", "Oh, that's delicious."]) : pick(["That can't be right.", "Who told you that?", "Hm. Sounds made up."]) },
      ];
    }
    if (/alliance|team up/.test(topic)) return [
      { id: A, text: pick(["Real talk. Us two. Till the end?", "We should look out for each other. Quietly."]) },
      { id: B, text: /agree|form/.test(outcome) ? pick(["Deal. Nobody knows.", "Okay. Pinky swear."]) : pick(["I'll think about it.", "I don't do teams."]) },
    ];
    if (/vote/.test(topic)) return [
      { id: A, text: aboutName ? pick([`I'm thinking ${aboutName} goes next.`, `${aboutName} has to go. You with me?`]) : "We need a plan for the vote." },
      { id: B, text: /agree/.test(outcome) ? pick(["Done. Consider it handled.", "Oh, gladly."]) : pick(["Hm. Maybe.", "Let me think about that."]) },
    ];
    if (/argument/.test(topic)) return [
      { id: A, text: pick(["Got something to say to me?", "I know what you did.", "You are SO fake."]) },
      { id: B, text: pick(["Excuse me?!", "Oh, here we go.", "Say that again. I dare you."]) },
      { id: A, text: pick(["You heard me.", "Everyone's thinking it.", "Don't play dumb."]) },
    ];
    if (/complains/.test(topic)) return [
      { id: A, text: pick(["Can we talk about how annoying the new girl is?", "Ugh, did you see her today?", "Some people in this town, honestly."]) },
      { id: B, text: pick(["Don't get me started.", "Ugh, I know.", "Oh, honey. Same."]) },
    ];
    if (/patch things up/.test(topic)) return [
      { id: A, text: pick(["Look... I'm sorry about before.", "Can we just be okay again?"]) },
      { id: B, text: /warmer/.test(outcome) ? pick(["Yeah. Okay. Me too.", "Fine. Hug it out."]) : pick(["We'll see.", "It's going to take more than that."]) },
    ];
    return [
      { id: A, text: pick(["Lovely day, isn't it?", "Did you see what she wore today?", "Busy morning?", "This town is too quiet. I don't trust it."]) },
      { id: B, text: pick(["Mm. Suspiciously lovely.", "Don't even. I saw.", "Exhausting.", "Quiet means someone's plotting."]) },
    ];
  },
  parting({ v, betrayedBy }) {
    if (betrayedBy.length) return `${betrayedBy[0]}, I hope it was worth it. Enjoy your little town.`;
    return pick(["Fine. This town never deserved me.", "Remember, I let you win.", "You'll all be begging me to come back."]);
  },
  voteReaction({ v, voter, wasAlly }) {
    if (wasAlly) return pick([`${name(voter)}?! Seriously?`, `Wow. ${name(voter)}. Wow.`, `Et tu, ${name(voter)}?`]);
    return pick(["Of course.", "Shocking. Not.", "Called it.", "Cute.", "Mm-hm."]);
  },
  bye: (v) => tic(v, "bye"),
  hi: (v) => tic(v, "hi"),
};

// Short barks for when a cast member is just around. Never decisions, just color.
export const BARKS = {
  celeste: ["Ugh, the lighting here is criminal.", "Do I look like I care? Don't answer that.", "Smile, ladies. Someone's always watching.", "I'm not mean. I'm honest with good hair."],
  odette: ["Everything has a price.", "Interesting...", "I'll remember that.", "Debts always come due."],
  wren: ["Ooh, what was THAT about?", "Somebody tell me something!", "Love, you would not BELIEVE my morning.", "Cider's on me. Gossip's on you."],
  sylvie: ["Kill me.", "Wow. Amazing. Not.", "One day this will all be mine.", "Some people, honestly."],
  marigold: ["Oh gosh, is it that late?", "Everyone's being so nice today. Too nice?", "Cinnamon buns fix everything.", "Please don't fight, please don't fight..."],
  pippa: ["Wait, what did I miss?!", "Honest, I love it here!", "Brenna's gonna be so proud!", "Is everyone fighting? Should I be fighting?"],
  brenna: ["Hmph.", "Two-faced, the lot of them.", "Back to work.", "Say it to my face."],
  juniper: ["The bees are nervous today.", "Somebody's lying. I can smell it.", "Mercury is doing something rude.", "Hello, little toad."],
  hesper: ["Order. That's all I ask.", "In my day, we had manners.", "Hmph. Newcomers.", "Rules exist for a reason, dear."],
  tansy: ["Ooh, that's a headline.", "Hold that thought, I'm writing it down.", "Everyone has a story.", "Quiet towns make the best stories."],
};
