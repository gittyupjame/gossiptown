// A rough reading of what the player typed, for the offline stand-in's priors (and as a
// hint in what Jev sees). Jev reads the words themselves; this only has to be good enough
// that the women don't react to the wrong thing when Jev can't be reached.
//
// read(line, { names, listener }) -> {
//   acts: { question, small_talk, compliment, insult, claim, alliance, vote_pitch, ask_vote,
//           threat, apology, about_self, physical, gift, deny, plead },   each 0..1
//   mentioned: [id], about: id|null   the woman the line is mainly about (not the listener)
//   toListener: -1..1                 how warm the line is toward whoever is listening
//   toSubject: -1..1                  how it makes the woman it's about look
// }

const W = (list) => list.map((w) => w.toLowerCase());
const POS = W(["love", "lovely", "adore", "beautiful", "gorgeous", "pretty", "cute", "sweet", "kind", "nice", "great", "amazing", "wonderful", "brilliant", "smart", "clever", "funny", "best", "fabulous", "stunning", "talented", "honest", "trust", "loyal", "genuine", "fan", "admire", "respect", "like", "glad", "thank", "thanks", "cheers", "fantastic", "perfect", "classy", "elegant"]);
const NEG = W(["hate", "ugly", "stupid", "idiot", "dumb", "fake", "liar", "lying", "lies", "snake", "two-faced", "backstab", "backstabber", "witch", "loser", "pathetic", "awful", "terrible", "horrible", "gross", "nasty", "mean", "rude", "cheat", "cheats", "cheated", "cheating", "crook", "crooked", "steal", "stole", "stealing", "thief", "jealous", "petty", "bitter", "annoying", "boring", "frumpy", "tacky", "trash", "creep", "creepy", "useless", "disgusting", "vile", "evil", "sneaky", "shady", "manipulative", "bully", "coward", "hypocrite", "desperate", "clown"]);
const SECRETY = W(["secret", "secretly", "saw", "seen", "heard", "overheard", "told", "says", "said", "apparently", "rumor", "rumour", "found", "caught", "owes", "owe", "affair", "plotting", "plans", "planning", "behind", "really", "actually", "truth"]);
const NEGATORS = new Set(["not", "never", "no", "isn't", "isnt", "aren't", "arent", "don't", "dont", "doesn't", "doesnt", "didn't", "didnt", "wasn't", "wasnt", "won't", "wont", "hardly", "nothing"]);

const has = (low, re) => re.test(low);

export function read(line, { names = {}, listener = null } = {}) {
  const low = ` ${String(line || "").toLowerCase().replace(/[’']/g, "'")} `;
  const words = low.match(/[a-z'-]+/g) || [];
  // who is named: first names, and "she/her" falls back to the last one named
  const mentioned = Object.entries(names).filter(([id, n]) => id !== listener && n && new RegExp(`\\b${n.toLowerCase()}\\b`).test(low)).map(([id]) => id);
  const listenerNamed = listener && names[listener] && new RegExp(`\\b${names[listener].toLowerCase()}\\b`).test(low);
  const you = /\b(you|you're|youre|your|yours|ya|u)\b/.test(low) || listenerNamed;

  // sentiment with simple negation: "not fake" is not an insult
  let pos = 0, neg = 0;
  words.forEach((w, i) => {
    const flip = NEGATORS.has(words[i - 1]) || NEGATORS.has(words[i - 2]);
    if (POS.includes(w)) flip ? neg += 0.6 : pos += 1;
    if (NEG.includes(w)) flip ? pos += 0.4 : neg += 1;
  });
  const tone = (pos - neg) / Math.max(1, pos + neg); // -1..1
  const strength = Math.min(1, (pos + neg) / 2);

  const question = has(low, /\?\s*$|^\s*(who|what|why|how|where|when|is|are|do|does|did|can|could|would|will|have|has)\b/) ? 1 : has(low, /\?/) ? 0.7 : 0;
  const aboutOther = mentioned.length > 0 || has(low, /\b(she|her|hers|they|them)\b/);
  const claimWords = words.filter((w) => SECRETY.includes(w)).length;
  const acts = {
    question,
    small_talk: has(low, /\b(hi|hello|hey|morning|evening|how are you|how's it going|nice day|lovely day|weather|what's up|sup)\b/) ? 0.9 : 0.15,
    compliment: you && tone > 0.2 ? 0.4 + strength * 0.6 : 0,
    insult: you && tone < -0.2 ? 0.4 + strength * 0.6 : 0,
    claim: aboutOther && !question ? Math.min(1, 0.25 + claimWords * 0.3 + (tone < -0.2 ? 0.3 : 0) + (mentioned.length ? 0.2 : 0)) : aboutOther && question ? 0.15 : 0,
    alliance: has(low, /\b(team up|teaming|ally|allies|alliance|pact|together|stick together|partner|side with|on my side|work together|have each other's back|got your back|deal)\b/) ? 0.9 : 0,
    vote_pitch: has(low, /\b(vote (her|them|\w+) out|vote out|vote for|voting (her|\w+) out|send (her|\w+) home|get rid of|kick (her|\w+) out|go home tonight|should go|has to go|needs to go|eliminate)\b/) && (mentioned.length || /\bher\b/.test(low)) ? 0.95 : 0,
    ask_vote: has(low, /\b(who (are|r) you voting|who you voting|your vote|voting for|who's going home|who do you want gone|who are you sending)\b/) ? 0.95 : 0,
    threat: has(low, /\b(or else|you'll regret|watch your back|i'll make sure|i will ruin|ruin you|i'll tell everyone|i'll expose|you'll pay|careful)\b/) ? 0.9 : 0,
    apology: has(low, /\b(sorry|apologi[sz]e|my bad|forgive me|i was wrong)\b/) ? 0.9 : 0,
    about_self: has(low, /\b(i am|i'm|im|my|me|myself)\b/) && !aboutOther && !you ? 0.5 : 0.1,
    physical: has(low, /\b(slap|smack|punch|hit|shove|push|kick|scratch|claw|tackle|deck|slug)\w*\s+(you|ya|u|your|her)\b|\bfight me\b|\bpull your hair\b|\*(slaps|shoves|punches|pushes|hits)\b/) ? 1 : 0,
    gift: has(low, /\b(here|for you|gift|present|brought|got you|take (it|this)|treat)\b/) ? 0.8 : 0,
    deny: has(low, /\b(that's a lie|thats a lie|not true|never did|i didn't|i did not|lies|made that up|nonsense|rubbish)\b/) ? 0.9 : 0,
    plead: has(low, /\b(please|keep me|give me a chance|deserve|don't send me|i want to stay|let me stay)\b/) ? 0.8 : 0,
  };
  const about = mentioned.length ? mentioned[0] : null;
  return {
    acts, mentioned, about, you, question: question > 0,
    toListener: you ? tone * (0.4 + strength * 0.6) : acts.small_talk > 0.5 ? 0.2 : 0,
    toSubject: about || aboutOther ? tone * (0.4 + strength * 0.6) - (claimWords && tone <= 0 ? 0.3 : 0) : 0,
  };
}

// Priors for a choice from a reading: strong evidence gets a big weight, none a small one.
export const weigh = (x, hi = 12, lo = 0.15) => lo + x * (hi - lo);
