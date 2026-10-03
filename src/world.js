// The starting town. Thistlewick is a reality show: nine women and the newcomer (the
// player) live in a small town, and every few days the town votes one of them out.
// Code owns who people are; Jev decides what they do; Claude only writes the words.

export const SHOW = {
  name: "Thistlewick",
  tagline: "Who stays?",
  host: { id: "honey", name: "Mayor Honey Bellweather", first: "Honey", voice: "bubbly game-show host, loves a dramatic pause, calls everyone 'my darlings'" },
};

export const PLACES = {
  plaza:      { name: "the town square",        desc: "A cobbled square around a fountain, with the bandstand where the vote happens." },
  salon:      { name: "Curl Up & Dye salon",     desc: "Ivy's hair salon. Everyone talks while they sit in the chairs." },
  cafe:       { name: "the Daisy Cup café",      desc: "Small tables under striped umbrellas. Good for being seen." },
  bakery:     { name: "Sugarplum Bakery",        desc: "Marigold's bakery, with a bench out front." },
  boutique:   { name: "Velvet Boutique",         desc: "Vivienne's dress shop. Expensive, and she wants you to know it." },
  winebar:    { name: "the Rosé Garden",         desc: "Wren's wine bar, with a garden of tables under string lights." },
  postoffice: { name: "the post office",         desc: "Odette's post office. Every letter in town passes through her hands." },
  park:       { name: "Willow Park",             desc: "A park with a duck pond, benches and quiet corners." },
  florist:    { name: "Petal & Thorn florist",   desc: "Juniper's flower shop at the edge of the park." },
};

// Each woman has a job, a personality, a voice, an agenda for the game and a secret.
// None of this is a script: it all goes into the Jev states, and Jev decides what she does.
export const VILLAGERS = [
  {
    id: "vivienne", name: "Vivienne Ashcombe", job: "owner of the Velvet Boutique", work: "boutique",
    traits: ["queen bee", "polished", "controlling", "charming in public, cruel in private", "never forgets a slight"],
    voice: "sweet as syrup, calls everyone 'darling', every compliment has a hook in it",
    agenda: "Stay on top. Keep a loyal follower or two, and get rid of anyone who could take her crown.",
    secrets: ["Vivienne's boutique is nearly broke, and she has been borrowing money from Odette to hide it."],
  },
  {
    id: "pippa", name: "Pippa Fennel", job: "shop girl at the Velvet Boutique", work: "boutique",
    traits: ["eager", "gullible", "chatty", "desperate to be liked", "copies whoever is winning"],
    voice: "fast and bubbly, says 'literally' and 'oh my gosh' a lot",
    agenda: "Stay close to whoever is strongest so she is never the target.",
    secrets: ["Pippa has been telling Vivienne everything the others say about her."],
  },
  {
    id: "ivy", name: "Ivy Marchetti", job: "hairdresser at Curl Up & Dye", work: "salon",
    traits: ["loudmouth", "dramatic", "cannot keep a secret", "loves an audience", "picks fights for fun"],
    voice: "loud, theatrical, gasps a lot, 'excuse me?!', 'oh she did NOT'",
    agenda: "Be the centre of every drama. Take Vivienne down a peg.",
    secrets: ["Ivy wrote the anonymous letter that got the last salon owner run out of town."],
  },
  {
    id: "wren", name: "Wren Tallow", job: "owner of the Rosé Garden wine bar", work: "winebar",
    traits: ["warm on the surface", "nosy", "two-faced", "collects secrets", "everyone's 'best friend'"],
    voice: "friendly and cosy, calls everyone 'love', always asks one question too many",
    agenda: "Be everyone's confidante, then use what they tell her when the vote comes.",
    secrets: ["Wren waters down the wine and charges full price."],
  },
  {
    id: "sylvie", name: "Sylvie Moor", job: "barista at the Daisy Cup café", work: "cafe",
    traits: ["bitter", "ambitious", "sharp-tongued", "resents anyone with money", "secretly insecure"],
    voice: "dry and sarcastic, mutters cutting asides",
    agenda: "Knock the rich girls out first. Win, and finally be the one people look at.",
    secrets: ["Sylvie has been taking coins from the café till for weeks."],
  },
  {
    id: "marigold", name: "Marigold Ashby", job: "baker at Sugarplum Bakery", work: "bakery",
    traits: ["sweet", "anxious", "passive-aggressive", "conflict-avoidant", "keeps a list of everyone who wronged her"],
    voice: "soft and apologetic, trails off, a sting hidden in every 'no offence'",
    agenda: "Fly under the radar and let the loud ones knock each other out.",
    secrets: ["Marigold owes Odette a large sum of money and is months behind on paying it back."],
  },
  {
    id: "odette", name: "Odette Crane", job: "postmistress", work: "postoffice",
    traits: ["sly", "calculating", "patient", "trades favours", "always knows more than she says"],
    voice: "smooth and quiet, hints at what she knows, 'a little bird told me'",
    agenda: "Make everyone owe her something, then call in the debts at the vote.",
    secrets: ["Odette steams open other people's letters and reads them."],
  },
  {
    id: "juniper", name: "Juniper Reed", job: "florist at Petal & Thorn", work: "florist",
    traits: ["dreamy", "superstitious", "quiet", "notices everything", "holds grudges in silence"],
    voice: "soft and strange, talks about omens and flowers, then says something cutting",
    agenda: "Watch, remember, and strike once at the right moment.",
    secrets: ["Juniper was run out of her last town after an accusation she won't talk about."],
  },
  {
    id: "hesper", name: "Hesper Vane", job: "head of the garden club", work: "park",
    traits: ["stern", "proud", "old guard", "hates being lied to", "thinks she should be in charge"],
    voice: "formal and clipped, never wastes a word",
    agenda: "Restore order. Vote out liars and troublemakers, whoever they turn out to be.",
    secrets: ["Hesper rigged last year's flower show so her roses would win."],
  },
];

// Starting feelings. affinity and trust run from -3 to 3. Unlisted pairs start at
// a mild small-town default.
const START_REL = [
  ["vivienne", "pippa", 0.5, 1, "a useful follower"],
  ["pippa", "vivienne", 2.5, 2.5, "Pippa worships Vivienne"],
  ["vivienne", "ivy", -2, -1.5, "rivals since Ivy laughed at her dress at the spring fair"],
  ["ivy", "vivienne", -2, -2, "can't stand her airs"],
  ["ivy", "wren", 1.5, 1, "gossip buddies"],
  ["wren", "ivy", 1, 0, "useful because she can't keep her mouth shut"],
  ["sylvie", "vivienne", -1.5, -1, "resents her money"],
  ["sylvie", "wren", -1, -0.5, "used to work at the wine bar and quit after a row"],
  ["wren", "sylvie", 0, -0.5, "an ex-employee who left on bad terms"],
  ["marigold", "odette", -1, -1, "she owes her money and is afraid of her"],
  ["odette", "marigold", 0, -1, "a debtor who is late"],
  ["odette", "vivienne", 0.5, 0, "Vivienne owes her money too"],
  ["marigold", "juniper", 2, 2, "close friends"],
  ["juniper", "marigold", 2, 2, "close friends"],
  ["hesper", "juniper", -0.5, -1, "wary of the strange florist"],
  ["hesper", "ivy", -1, -1, "thinks Ivy is vulgar"],
  ["odette", "hesper", 1, 0, "cultivates the old guard"],
  ["hesper", "odette", 0.5, 0.5, "finds her useful"],
];

export function newTown() {
  const people = {};
  for (const v of VILLAGERS) {
    people[v.id] = {
      ...structuredClone(v),
      location: "home", // everyone wakes up at home
      mood: { anger: 0, fear: 0, cheer: 1 }, // 0..3 each
      knows: {},        // rumorId -> { conf 0..1, from, day, time }
      memory: [],       // short lines of what happened to her
      intent: null,     // a plan: { kind, target, rumor, why, promisedTo, now } set by decisions, acted on later
      target: null,     // who she wants voted out next, decided by Jev at night
      gone: false,      // voted out
      lastApproach: -999, // game minute she last walked up to the newcomer
    };
  }
  const rel = {};
  const ids = [...Object.keys(people), "player"];
  for (const a of Object.keys(people)) {
    rel[a] = {};
    for (const b of ids) if (a !== b) rel[a][b] = b === "player" ? { affinity: 0.2, trust: 0, note: "the new girl; curious about her, nothing against her yet" } : { affinity: 0.3, trust: 0.2, note: "neighbours" };
  }
  for (const [a, b, af, tr, note] of START_REL) rel[a][b] = { affinity: af, trust: tr, note };

  const rumors = {};
  let n = 0;
  for (const v of VILLAGERS) for (const s of v.secrets) {
    const id = "r" + ++n;
    rumors[id] = { id, about: v.id, text: s, origin: "truth", isTrue: true, harm: -1.5, day: 0 };
    people[v.id].knows[id] = { conf: 1, from: "self", day: 0, time: "08:00" };
  }
  // a few secrets have already leaked to one person each
  const leak = (rid, who, from) => (people[who].knows[rid] = { conf: 0.7, from, day: 0, time: "08:00" });
  leak("r6", "wren", "odette");     // Marigold's debt
  leak("r1", "odette", "self");     // Odette knows Vivienne borrows from her
  leak("r5", "wren", "self");       // Wren suspects Sylvie's till
  leak("r2", "ivy", "wren");        // Ivy has heard Pippa reports to Vivienne

  return {
    day: 1, minute: 8 * 60, // game clock, minutes since midnight
    people, rel, rumors, nextRumor: n + 1,
    alliances: [],          // { a, b, day, real } pacts between two women; real=false means one side is faking
    votes: [],              // past votes: { day, ballots: [{ voter, target }], out }
    player: {
      name: "the newcomer", location: "plaza", talkingTo: null, following: null, listening: false,
      journal: [], seen: {},
      knows: {},            // rumors the player has learned: rid -> { from, how, day, time }
      claims: [],           // things the player told people: { rid, to, day, time }
      promises: {},         // what each woman told the player: id -> { ally: bool, voteFor: id|null, day }
      gone: false,
    },
    events: [], // { day, time, place, text, witnesses }
  };
}
