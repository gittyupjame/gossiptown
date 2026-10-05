// Who is in town. Code owns who people are; Jev decides what they do; Claude only
// writes the words they say.
//
// `bias` numbers (0..1) describe a personality. They are written into every Jev state
// as plain words, and the offline stand-in uses them as priors so each woman still
// behaves like herself when Jev can't be reached.
//   gossip   how much she passes things on        deceit   how easily she lies
//   loyalty  how much she sticks to allies        temper   how fast she fights
//   nosy     how much she pries                   social   how much she seeks company
//   scheme   how much she plays the game          nerve    how bold she is with the newcomer

export const SHOW = {
  name: "Gossiptown",
  tagline: "Ten women. One tiny town. Every night, somebody gets voted out.",
  voteEvery: 1, // in-game days between votes
  finalists: 3, // the season ends when this many are left (you included)
};

export const HOST = {
  id: "primrose", name: "Primrose Fairweather", first: "Primrose", job: "town crier and host of the vote",
  look: { skin: "#f6d3bc", hair: "#f3c6d8", hairStyle: "puffs", outfit: "#ffffff", accent: "#e8577e", accessory: "sash", height: 1.0 },
};

export const PLACES = {
  plaza:   { name: "the plaza",              short: "Plaza",        desc: "Cobbles, a fountain, benches. Everyone passes through and everyone is seen." },
  bakery:  { name: "Marigold's bakery",      short: "Bakery",       desc: "Café tables outside, cinnamon in the air. Good for a quiet word." },
  salon:   { name: "Curl Up & Dye",          short: "Salon",        desc: "Celeste's salon. Mirrors, hair dryers, and the best gossip in town." },
  tavern:  { name: "the Crooked Kettle",     short: "Tavern",       desc: "Wren's tavern with a patio under string lights. Loose lips after noon." },
  gazette: { name: "the Whisper office",     short: "Whisper",      desc: "Tansy's print shop, where the town gossip sheet gets written." },
  market:  { name: "the market",             short: "Market",       desc: "Striped stalls, fruit crates, Odette's scales." },
  hall:    { name: "the town hall",          short: "Town Hall",    desc: "Elder Hesper's hall with the clock tower. Rules, records, complaints." },
  smithy:  { name: "the smithy",             short: "Smithy",       desc: "Across the river. Hot, loud, and nobody can overhear you over the hammer." },
  garden:  { name: "the herb garden",        short: "Garden",       desc: "Juniper's greenhouse and beds at the edge of town. Quiet, a little odd." },
  dock:    { name: "the lake dock",          short: "Dock",         desc: "A wooden dock on the lake. Where people go to sulk or to scheme." },
  firepit: { name: "the firepit",            short: "Firepit",      desc: "A ring of stumps on the hill. The votes happen here." },
};

export const VILLAGERS = [
  {
    id: "celeste", name: "Celeste Belrose", job: "salon owner", work: "salon", archetype: "The Queen Bee",
    quote: "Darling, I don't gossip. I inform.",
    traits: ["charming to your face", "vicious behind your back", "image-obsessed", "controlling", "always counting who is on her side"],
    voice: "sugary and breathy, calls everyone 'darling' or 'sweetie', compliments that are really insults",
    bias: { gossip: 0.9, deceit: 0.85, loyalty: 0.3, temper: 0.4, nosy: 0.7, social: 0.95, scheme: 0.9, nerve: 0.8 },
    secrets: ["Celeste reads the private letters her clients leave in their coat pockets at the salon."],
    look: { skin: "#fbe0cf", hair: "#fff1b8", hairStyle: "bigcurls", outfit: "#ff8fb8", accent: "#ffffff", accessory: "sunglasses", height: 1.04 },
    idle: "primp",
  },
  {
    id: "odette", name: "Odette Crane", job: "merchant and moneylender", work: "market", archetype: "The Villain",
    quote: "Everyone in this town owes me something.",
    traits: ["sly", "greedy", "keeps a ledger of favors", "enjoys other people's misery", "never forgets a slight"],
    voice: "smooth and low, purrs, always hinting at a deal or a debt",
    bias: { gossip: 0.6, deceit: 0.95, loyalty: 0.2, temper: 0.35, nosy: 0.6, social: 0.5, scheme: 0.95, nerve: 0.7 },
    secrets: ["Odette uses a crooked scale at her market stall and shorts every customer."],
    look: { skin: "#e9c2a6", hair: "#2a2238", hairStyle: "bob", outfit: "#6b4a9a", accent: "#e8c36a", accessory: "earrings", height: 1.06 },
    idle: "scheme",
  },
  {
    id: "wren", name: "Wren Tallow", job: "tavern keeper", work: "tavern", archetype: "The Gossip Hub",
    quote: "I don't spread rumors, love. They just come to me.",
    traits: ["warm", "nosy", "cannot keep a secret to save her life", "loves a scandal", "protective of her tavern"],
    voice: "chatty, calls everyone 'love', asks three questions at once, gasps a lot",
    bias: { gossip: 1.0, deceit: 0.35, loyalty: 0.55, temper: 0.3, nosy: 1.0, social: 1.0, scheme: 0.35, nerve: 0.75 },
    secrets: ["Wren waters down the cider at the Crooked Kettle."],
    look: { skin: "#f7d6c0", hair: "#d9572e", hairStyle: "messybun", outfit: "#6fae7c", accent: "#fff6e0", accessory: "apron", height: 1.0 },
    idle: "chatter",
  },
  {
    id: "sylvie", name: "Sylvie Moor", job: "tavern server", work: "tavern", archetype: "The Bitter One",
    quote: "Oh, I'm sure she's lovely. In a bad light.",
    traits: ["bitter", "sharp-tongued", "ambitious", "resents Wren", "secretly insecure", "holds grudges"],
    voice: "dry and sarcastic, eye-rolling asides, short cutting lines",
    bias: { gossip: 0.75, deceit: 0.7, loyalty: 0.35, temper: 0.75, nosy: 0.5, social: 0.45, scheme: 0.7, nerve: 0.6 },
    secrets: ["Sylvie has been stealing coins from the Crooked Kettle's till for weeks."],
    look: { skin: "#f1cdb5", hair: "#3a2430", hairStyle: "ponytail", outfit: "#7a2e44", accent: "#1e1a22", accessory: "choker", height: 1.02 },
    idle: "eyeroll",
  },
  {
    id: "marigold", name: "Marigold Ashby", job: "baker", work: "bakery", archetype: "The Sweetheart",
    quote: "I just want everyone to get along! ...Mostly.",
    traits: ["sweet", "anxious", "people-pleaser", "hates conflict", "fiercely loyal to friends", "cracks under pressure"],
    voice: "soft and apologetic, says 'oh gosh', trails off mid-sentence",
    bias: { gossip: 0.35, deceit: 0.25, loyalty: 0.95, temper: 0.15, nosy: 0.35, social: 0.7, scheme: 0.2, nerve: 0.3 },
    secrets: ["Marigold owes Odette a large sum of money and is months behind on repaying it."],
    look: { skin: "#fde3cf", hair: "#f0b552", hairStyle: "braid", outfit: "#ffd76a", accent: "#ffffff", accessory: "apron", height: 0.96 },
    idle: "fidget",
  },
  {
    id: "pippa", name: "Pippa Fennel", job: "blacksmith's apprentice", work: "smithy", archetype: "The Floater",
    quote: "Wait, are we fighting? Who are we fighting? Honest!",
    traits: ["eager", "gullible", "chatty", "desperate to be liked", "worships Brenna", "agrees with whoever spoke last"],
    voice: "fast and bubbly, says 'honest!' a lot, run-on sentences",
    bias: { gossip: 0.7, deceit: 0.2, loyalty: 0.6, temper: 0.2, nosy: 0.65, social: 0.9, scheme: 0.15, nerve: 0.85 },
    secrets: ["Pippa broke Wren's prize teapot and hid the pieces in the river."],
    look: { skin: "#ffe0c8", hair: "#ff9a3c", hairStyle: "twintails", outfit: "#5a8ad6", accent: "#c98a4a", accessory: "goggles", height: 0.92 },
    idle: "bounce",
  },
  {
    id: "brenna", name: "Brenna Hale", job: "blacksmith", work: "smithy", archetype: "The Straight Shooter",
    quote: "Say it to my face or don't say it.",
    traits: ["blunt", "proud", "honest to a fault", "hot-tempered when insulted", "loyal once won over", "despises two-faced people"],
    voice: "short blunt sentences, no flattery, snorts",
    bias: { gossip: 0.15, deceit: 0.1, loyalty: 0.9, temper: 0.9, nosy: 0.2, social: 0.35, scheme: 0.25, nerve: 0.6 },
    secrets: ["Brenna let Pippa take the blame for a ruined sword commission that was really Brenna's mistake."],
    look: { skin: "#c98f6a", hair: "#6a3e24", hairStyle: "short", outfit: "#8a5a3a", accent: "#3a2a20", accessory: "smithapron", height: 1.08 },
    idle: "arms",
  },
  {
    id: "juniper", name: "Juniper Reed", job: "herbalist", work: "garden", archetype: "The Wildcard",
    quote: "The moths told me you'd say that.",
    traits: ["dreamy", "superstitious", "unpredictable", "notices everything", "an outsider herself", "sometimes eerily right"],
    voice: "wandering and soft, talks about omens, plants and moon phases",
    bias: { gossip: 0.4, deceit: 0.3, loyalty: 0.7, temper: 0.2, nosy: 0.6, social: 0.4, scheme: 0.4, nerve: 0.55 },
    secrets: ["Juniper was run out of her last town after an accusation she won't talk about."],
    look: { skin: "#f4dcd0", hair: "#b8a2e8", hairStyle: "long", outfit: "#7fbf8f", accent: "#ffb3c7", accessory: "flowercrown", height: 0.98 },
    idle: "twirl",
  },
  {
    id: "hesper", name: "Hesper Vane", job: "village elder", work: "hall", archetype: "The Old Guard",
    quote: "This town survived worse than you, dear.",
    traits: ["stern", "values order and tradition", "distrusts newcomers", "hates being lied to", "votes on principle", "secretly lonely"],
    voice: "formal and clipped, calls people 'dear' coldly, never wastes a word",
    bias: { gossip: 0.25, deceit: 0.2, loyalty: 0.6, temper: 0.5, nosy: 0.45, social: 0.3, scheme: 0.45, nerve: 0.5 },
    secrets: ["Elder Hesper lost the town's festival fund playing cards and covered it up."],
    look: { skin: "#f1d4c4", hair: "#d8d8e0", hairStyle: "bun", outfit: "#34406a", accent: "#c9a85a", accessory: "glasses", height: 0.95 },
    idle: "cane", speed: 0.75,
  },
  {
    id: "tansy", name: "Tansy Quill", job: "editor of the Gossiptown Whisper", work: "gazette", archetype: "The Mastermind",
    quote: "Everything is a story. I just decide how it ends.",
    traits: ["calculating", "observant", "plays every side", "patient", "smiles too much", "collects secrets like stamps"],
    voice: "precise and pleasant, asks leading questions, takes 'notes' out loud",
    bias: { gossip: 0.7, deceit: 0.8, loyalty: 0.4, temper: 0.15, nosy: 0.9, social: 0.6, scheme: 1.0, nerve: 0.65 },
    secrets: ["Tansy secretly writes 'Overheard', the Whisper's anonymous and nastiest column."],
    look: { skin: "#d8a888", hair: "#1e1a1a", hairStyle: "braids", outfit: "#3fa7a0", accent: "#f2e6c8", accessory: "roundglasses", height: 1.0 },
    idle: "notes",
  },
];


// How each woman judges clothes. `loves`/`hates` are style words from wardrobe.js, `vain`
// is how much looks matter to her (and how much she hates being outshone), `worth` is
// roughly what her own outfit cost. Written into Jev states as words; priors only offline.
export const FASHION = {
  celeste:  { loves: ["glam", "flashy"], hates: ["frumpy", "practical"], vain: 1.0, worth: 300, text: "lives for glamour and labels, sneers at anything cheap or frumpy, and cannot stand being outshone in her own town" },
  odette:   { loves: ["classy", "glam"], hates: ["boho", "cute"], vain: 0.6, worth: 240, text: "prices every outfit at a glance; respects money, despises cheapness, and wonders where new money came from" },
  wren:     { loves: ["practical", "cute"], hates: ["flashy"], vain: 0.2, worth: 60, text: "cozy and down to earth; distrusts anyone who looks like they are trying too hard" },
  sylvie:   { loves: ["edgy"], hates: ["cute", "flashy"], vain: 0.8, worth: 90, text: "dark and edgy herself; jealous of anyone prettier, sneers at sweet little looks" },
  marigold: { loves: ["cute", "modest"], hates: ["edgy", "flashy"], vain: 0.2, worth: 40, text: "loves sweet, homey, modest clothes; a bit intimidated by anything loud or daring" },
  pippa:    { loves: ["cute", "glam"], hates: ["frumpy"], vain: 0.6, worth: 110, text: "copies whatever Celeste likes, adores anything cute or sparkly, and cares a lot about looking cool" },
  brenna:   { loves: ["practical", "sporty"], hates: ["glam", "flashy"], vain: 0.05, worth: 30, text: "thinks fussy clothes are for show-offs; respects boots and sleeves you can work in" },
  juniper:  { loves: ["boho"], hates: ["glam", "flashy"], vain: 0.1, worth: 50, text: "free spirit in flowers and linen; finds glitz and labels soulless and fake" },
  hesper:   { loves: ["classy", "modest"], hates: ["flashy", "edgy"], vain: 0.3, worth: 140, text: "old-fashioned; expects decent, tidy, proper dress and frowns on anything showy or rebellious" },
  tansy:    { loves: ["edgy", "classy"], hates: ["frumpy"], vain: 0.4, worth: 120, text: "reads outfits like headlines: what someone wears is a story about who they are trying to be" },
};

export const PLAYER_LOOK = { skin: "#fbd9c4", hair: "#9a5a3a", hairStyle: "sidebun", outfit: "#f6a37a", accent: "#fff3e6", accessory: "scarf", height: 1.0 };

// Starting feelings. affinity and trust run from -3 to 3.
const START_REL = [
  ["celeste", "odette", -1, -1.5, "rival queens who pretend to be friends"],
  ["odette", "celeste", -0.5, -1.5, "rival queens who pretend to be friends"],
  ["celeste", "tansy", 1.5, 1, "thinks Tansy is her loyal confidante"],
  ["tansy", "celeste", 0.5, 0, "pretends to be Celeste's confidante, is really studying her"],
  ["celeste", "marigold", -0.5, 0.5, "finds Marigold frumpy and useful"],
  ["marigold", "celeste", 0.5, 0, "a little afraid of her"],
  ["pippa", "celeste", 2, 1.5, "wants to be her"],
  ["celeste", "pippa", 0.5, 0, "a fan, easy to use"],
  ["brenna", "odette", -2, -2, "Odette cheated Brenna on an iron order and never paid it back"],
  ["odette", "brenna", -1, -0.5, "a loud brute who owes her an apology"],
  ["brenna", "pippa", 1.5, 1, "master and apprentice"],
  ["pippa", "brenna", 2.5, 2.5, "idolizes her"],
  ["brenna", "celeste", -1, -1.5, "can't stand fake people"],
  ["marigold", "odette", -1.5, -1, "owes her money and is scared of her"],
  ["odette", "marigold", 0, -1, "a debtor who is late"],
  ["marigold", "juniper", 2, 2, "best friends"],
  ["juniper", "marigold", 2, 2, "best friends"],
  ["sylvie", "wren", -1.5, 0, "resents working for her"],
  ["wren", "sylvie", 1, 1.5, "trusts her with the till"],
  ["wren", "marigold", 1.5, 1.5, "old friends"],
  ["marigold", "wren", 1.5, 1, "old friends"],
  ["hesper", "juniper", -0.5, -1, "suspicious of her past"],
  ["juniper", "hesper", -0.5, 0, "thinks the elder has a dark aura"],
  ["odette", "hesper", 1, 0, "cultivates the elder's favor"],
  ["hesper", "odette", 0.5, 0.5, "finds her useful"],
  ["sylvie", "odette", 1, 0.5, "drinking companions"],
  ["odette", "sylvie", 0.5, 0, "a useful pair of ears"],
  ["wren", "tansy", 1, 0.5, "trades gossip with her"],
  ["tansy", "wren", 0.5, 0.5, "her best source"],
  ["hesper", "tansy", -0.5, -0.5, "disapproves of that gossip sheet"],
  ["sylvie", "celeste", -1, -1, "jealous of her"],
  ["celeste", "sylvie", -0.5, -0.5, "a sour little thing"],
];

// Little things the player can pick up around town and give away. Each woman has one
// she adores and one she can't stand; Jev decides how a gift actually lands.
export const ITEMS = {
  cupcake: { name: "a pink cupcake", icon: "🧁", place: "bakery", where: "Marigold's counter" },
  flowers: { name: "a bunch of wildflowers", icon: "💐", place: "garden", where: "the garden beds" },
  cider: { name: "a mug of cider", icon: "🍺", place: "tavern", where: "the Crooked Kettle's tap" },
  polish: { name: "a bottle of nail polish", icon: "💅", place: "salon", where: "the salon shelf" },
  trinket: { name: "a shiny trinket", icon: "💎", place: "market", where: "Odette's stall" },
};
export const TASTES = {
  celeste: { loves: "polish", hates: "cider" },
  odette: { loves: "trinket", hates: "flowers" },
  wren: { loves: "flowers", hates: "cider" },
  sylvie: { loves: "trinket", hates: "cupcake" },
  marigold: { loves: "flowers", hates: "trinket" },
  pippa: { loves: "cupcake", hates: "polish" },
  brenna: { loves: "cider", hates: "polish" },
  juniper: { loves: "trinket", hates: "cupcake" },
  hesper: { loves: "cupcake", hates: "trinket" },
  tansy: { loves: "cider", hates: "flowers" },
};

// Secret pacts at the start of the season. Only members know; the player finds out by listening.
const START_ALLIANCES = [
  { name: "the Salon Set", members: ["celeste", "tansy"] },
  { name: "the Back Booth", members: ["sylvie", "odette"] },
  { name: "the Garden Girls", members: ["marigold", "juniper"] },
];
// shared by every season: read-only, so one season can't reshape the next
for (const a of START_ALLIANCES) { Object.freeze(a.members); Object.freeze(a); }
Object.freeze(START_ALLIANCES);

// A fresh season. Everything a woman starts with is set here or written as day-0 history
// (sim.seedHistory), so every belief she holds traces back to an event.
import { newRel } from "./mind.js";
export function newTown({ playerName = "Rosie", seed = null } = {}) {
  const people = {};
  for (const v of VILLAGERS) {
    people[v.id] = {
      ...structuredClone(v),
      location: "home", spot: null,
      mood: { anger: 0, fear: 0, cheer: 1 }, moodBase: { anger: 0, fear: 0, cheer: 1 },
      knows: {}, mem: [], summaries: [], goals: [], agenda: [], votePlan: null,
      gone: false, out: false, employed: true,
    };
  }
  const rel = {};
  const ids = [...Object.keys(people), "player"];
  for (const a of Object.keys(people)) {
    rel[a] = {};
    for (const b of ids) if (a !== b) rel[a][b] = b === "player" ? newRel(0.1, 0, "the new girl, a blank slate so far") : newRel(0.3, 0.3, "neighbors");
  }
  for (const [a, b, af, tr, note] of START_REL) rel[a][b] = newRel(af, tr, note);
  return {
    version: 3,
    seed: seed ?? String(Math.floor(Math.random() * 1e9)),
    day: 1, minute: 8 * 60, phase: "day",
    people, rel, rumors: {}, nextRumor: 1,
    alliances: [], world: [], decisions: [], trace: [], ledger: [], moves: [], talks: {}, lies: [], secrets: {},
    votes: [], notes: [], shows: [],
    player: {
      name: playerName, location: "plaza", pos: null, talkingTo: null,
      mem: [], summaries: [], knows: {}, heard: [], told: [],
      carrying: null, fights: 0, snooped: {},
    },
    over: null,
  };
}
export { START_REL, START_ALLIANCES };
