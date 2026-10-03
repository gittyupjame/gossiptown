// The starting town. Code owns who people are; Jev decides what they do;
// the LLM only writes the words they say.

export const PLACES = {
  square: { name: "the village square", desc: "A cobbled square around an old well. Everyone passes through." },
  bakery: { name: "Marigold's bakery", desc: "Warm, small, smells of rye. A bench by the window." },
  smithy: { name: "the smithy", desc: "Hot and loud. Sparks, an anvil, a water barrel." },
  tavern: { name: "the Crooked Kettle tavern", desc: "Low beams, long tables, the town's real meeting hall." },
  market: { name: "the market stalls", desc: "A row of stalls. Odette's is the biggest." },
  garden: { name: "the herb garden", desc: "Juniper's garden at the edge of town. Quiet, a little wild." },
  hall: { name: "the elder's hall", desc: "A stone hall where disputes are heard and town business is done." },
};

// `work` is where someone works. Nobody has a fixed schedule: every quarter hour Jev
// decides where each villager goes, from who they are, the time, and their plans.

export const VILLAGERS = [
  {
    id: "brenna", work: "smithy", name: "Brenna Hale", job: "blacksmith", employer: null,
    traits: ["gruff", "proud", "honest", "slow to trust", "quick-tempered when insulted"],
    voice: "short blunt sentences, hates flattery",
    secrets: [],
  },
  {
    id: "pippa", work: "smithy", name: "Pippa Fennel", job: "blacksmith's apprentice", employer: "brenna",
    traits: ["eager", "gullible", "chatty", "wants to be liked", "looks up to Brenna"],
    voice: "fast and excitable, says 'honest!' a lot",
    secrets: [],
  },
  {
    id: "marigold", work: "bakery", name: "Marigold Ashby", job: "baker", employer: null,
    traits: ["anxious", "kind", "dislikes gossip", "conflict-avoidant", "very loyal to friends"],
    voice: "soft, apologetic, trails off",
    secrets: ["Marigold owes Odette a large sum of money and is months behind on repaying it."],
  },
  {
    id: "odette", work: "market", name: "Odette Crane", job: "merchant and moneylender", employer: null,
    traits: ["sly", "greedy", "well-connected", "charming when it pays", "holds grudges"],
    voice: "smooth, flattering, always hinting at a deal",
    secrets: ["Odette uses a crooked scale at her market stall and shorts every customer."],
  },
  {
    id: "wren", work: "tavern", name: "Wren Tallow", job: "tavern keeper", employer: null,
    traits: ["warm", "nosy", "the town's gossip hub", "protective of her tavern", "loves a good story"],
    voice: "friendly, calls everyone 'love', asks lots of questions",
    secrets: [],
  },
  {
    id: "sylvie", work: "tavern", name: "Sylvie Moor", job: "tavern server", employer: "wren",
    traits: ["bitter", "ambitious", "resentful of Wren", "sharp-tongued", "secretly insecure"],
    voice: "dry, sarcastic, mutters asides",
    secrets: ["Sylvie has been stealing coins from the tavern till for weeks."],
  },
  {
    id: "hesper", work: "hall", name: "Elder Hesper Vane", job: "village elder", employer: null,
    traits: ["stern", "fair", "values order above all", "distrusts outsiders", "hates being lied to"],
    voice: "formal, measured, never wastes a word",
    secrets: [],
  },
  {
    id: "juniper", work: "garden", name: "Juniper Reed", job: "herbalist", employer: null,
    traits: ["dreamy", "superstitious", "gentle", "a bit of an outsider herself", "notices small things"],
    voice: "wandering, talks about omens and plants",
    secrets: ["Juniper was run out of her last town after an accusation she won't talk about."],
  },
];

// Starting feelings. affinity and trust run from -3 to 3. Unlisted pairs start at
// a mild small-town default.
const START_REL = [
  ["brenna", "odette", -2, -2, "Odette once cheated Brenna on an iron order; they have not forgiven it"],
  ["brenna", "pippa", 1.5, 1, "master and apprentice"],
  ["pippa", "brenna", 2.5, 2.5, "Pippa idolizes Brenna"],
  ["marigold", "odette", -1, -1, "she owes her money and fears her"],
  ["odette", "marigold", 0, -1, "a debtor who is late"],
  ["marigold", "juniper", 2, 2, "close friends"],
  ["juniper", "marigold", 2, 2, "close friends"],
  ["sylvie", "wren", -1, 0, "resents working for her"],
  ["wren", "sylvie", 1, 1.5, "trusts her with the till"],
  ["wren", "marigold", 1.5, 1.5, "old friends"],
  ["hesper", "juniper", -0.5, -1, "wary of the newcomer-herbalist"],
  ["odette", "hesper", 1, 0, "cultivates the elder's favor"],
  ["hesper", "odette", 0.5, 0.5, "finds her useful"],
  ["sylvie", "odette", 1, 0.5, "drinking companions"],
  ["odette", "sylvie", 0.5, 0, "a useful pair of ears"],
];

export function newTown() {
  const people = {};
  for (const v of VILLAGERS) {
    people[v.id] = {
      ...structuredClone(v),
      location: "home", // everyone wakes up at home
      activity: "starting the day",
      mood: { anger: 0, fear: 0, cheer: 1 }, // 0..3 each
      knows: {},        // rumorId -> { conf 0..1, from, day, time }
      memory: [],       // short lines of what happened to them
      intent: null,     // a plan: { kind, target, rumor, why, promisedTo, now } set by decisions, acted on later
      gone: false,      // moved away or banished
      employed: true,
    };
  }
  const rel = {};
  const ids = [...Object.keys(people), "player"];
  for (const a of Object.keys(people)) {
    rel[a] = {};
    for (const b of ids) if (a !== b) rel[a][b] = b === "player" ? { affinity: 0, trust: -0.5, note: "a newcomer nobody knows" } : { affinity: 0.5, trust: 0.5, note: "neighbors" };
  }
  for (const [a, b, af, tr, note] of START_REL) rel[a][b] = { affinity: af, trust: tr, note };

  const rumors = {};
  let n = 0;
  for (const v of VILLAGERS) for (const s of v.secrets) {
    const id = "r" + ++n;
    rumors[id] = { id, about: v.id, text: s, origin: "truth", isTrue: true, harm: -1.5, day: 0 };
    people[v.id].knows[id] = { conf: 1, from: "self", day: 0, time: "08:00" };
  }
  // One secret has already leaked to one person.
  people.wren.knows.r1 = { conf: 0.6, from: "odette", day: 0, time: "08:00" }; // Marigold's debt

  return {
    day: 1, minute: 8 * 60, // game clock, minutes since midnight
    people, rel, rumors, nextRumor: n + 1,
    player: { name: "the newcomer", location: "square", talkingTo: null, following: null, listening: false, journal: [], seen: {}, gifts: ["a loaf of rye", "a silver ribbon", "a pouch of 5 coins", "a jar of honey"] },
    events: [], // { day, time, place, text, witnesses }
  };
}
