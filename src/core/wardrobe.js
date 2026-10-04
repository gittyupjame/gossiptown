// What you wear. Every piece has a price and a few style words; you start the season with
// a budget and the show pays a small stipend each morning. Code only describes the look
// in plain words; how each woman takes it is up to Jev (see looks.js).

export const BUDGET = 150;   // coins to dress yourself on arrival
export const STIPEND = 40;   // coins the producers hand you every morning

// style words, used in descriptions and in each woman's taste
export const STYLES = ["glam", "classy", "cute", "boho", "edgy", "practical", "sporty", "frumpy", "flashy", "modest"];

export const SLOTS = [
  { key: "dress", label: "Outfit", icon: "👗" },
  { key: "shoes", label: "Shoes", icon: "👠" },
  { key: "hair", label: "Hair", icon: "💇" },
  { key: "dye", label: "Hair color", icon: "🎨" },
  { key: "hat", label: "Hat", icon: "👒" },
  { key: "neck", label: "Necklace", icon: "📿" },
  { key: "ears", label: "Earrings", icon: "💎" },
  { key: "face", label: "Glasses", icon: "👓" },
  { key: "bag", label: "Bag", icon: "👜" },
];

// id -> { slot, name, price, tags, ... model fields }
export const ITEMS = {
  // outfits (color picked separately, free)
  frock:    { slot: "dress", name: "plain cotton frock", price: 0, tags: ["frumpy", "practical", "modest"], shape: "frock" },
  overalls: { slot: "dress", name: "denim overalls", price: 15, tags: ["practical", "sporty"], shape: "overalls" },
  sundress: { slot: "dress", name: "gingham sundress", price: 25, tags: ["cute"], shape: "sundress" },
  peasant:  { slot: "dress", name: "embroidered peasant dress", price: 35, tags: ["boho"], shape: "peasant" },
  tea:      { slot: "dress", name: "polka-dot tea dress", price: 40, tags: ["cute", "classy"], shape: "tea" },
  suit:     { slot: "dress", name: "tweed skirt suit", price: 70, tags: ["classy", "modest"], shape: "suit" },
  leather:  { slot: "dress", name: "leather jacket and mini skirt", price: 75, tags: ["edgy"], shape: "leather" },
  slip:     { slot: "dress", name: "silk slip dress", price: 85, tags: ["glam"], shape: "slip" },
  sequin:   { slot: "dress", name: "sequin party dress", price: 120, tags: ["glam", "flashy"], shape: "sequin" },
  gown:     { slot: "dress", name: "velvet ballgown", price: 160, tags: ["glam", "flashy", "classy"], shape: "gown" },
  // shoes
  clogs:    { slot: "shoes", name: "wooden clogs", price: 0, tags: ["practical", "frumpy"], shoe: "clogs", color: "#a8794a" },
  flats:    { slot: "shoes", name: "ballet flats", price: 10, tags: ["cute"], shoe: "flats", color: "#ff9ab8" },
  sneakers: { slot: "shoes", name: "canvas sneakers", price: 15, tags: ["sporty", "practical"], shoe: "sneakers", color: "#ffffff" },
  boots:    { slot: "shoes", name: "lace-up boots", price: 30, tags: ["edgy", "practical"], shoe: "boots", color: "#3a2a24" },
  heels:    { slot: "shoes", name: "red heels", price: 45, tags: ["glam"], shoe: "heels", color: "#d8283c" },
  glass:    { slot: "shoes", name: "crystal-heel pumps", price: 80, tags: ["glam", "flashy"], shoe: "heels", color: "#cfefff" },
  // hair, cut at the salon
  sidebun:  { slot: "hair", name: "a side bun", price: 0, tags: ["cute"], style: "sidebun" },
  long:     { slot: "hair", name: "long loose hair", price: 0, tags: ["boho"], style: "long" },
  messybun: { slot: "hair", name: "a messy bun", price: 0, tags: ["practical", "boho"], style: "messybun" },
  ponytail: { slot: "hair", name: "a high ponytail", price: 5, tags: ["sporty"], style: "ponytail" },
  braid:    { slot: "hair", name: "a side braid", price: 10, tags: ["boho", "cute"], style: "braid" },
  bun:      { slot: "hair", name: "a neat bun", price: 10, tags: ["classy", "modest"], style: "bun" },
  twintails:{ slot: "hair", name: "twin tails", price: 10, tags: ["cute"], style: "twintails" },
  bob:      { slot: "hair", name: "a sharp bob", price: 15, tags: ["classy", "edgy"], style: "bob" },
  short:    { slot: "hair", name: "a pixie crop", price: 15, tags: ["edgy", "sporty"], style: "short" },
  puffs:    { slot: "hair", name: "space puffs", price: 20, tags: ["cute", "flashy"], style: "puffs" },
  braids:   { slot: "hair", name: "long braids", price: 25, tags: ["boho"], style: "braids" },
  bigcurls: { slot: "hair", name: "big glam curls", price: 35, tags: ["glam"], style: "bigcurls" },
  // hair color
  chestnut: { slot: "dye", name: "natural chestnut", price: 0, tags: [], color: "#9a5a3a" },
  black:    { slot: "dye", name: "natural black", price: 0, tags: [], color: "#2a2228" },
  blonde:   { slot: "dye", name: "natural blonde", price: 0, tags: [], color: "#e8c27a" },
  copper:   { slot: "dye", name: "copper red dye", price: 15, tags: ["boho"], color: "#d0643a" },
  platinum: { slot: "dye", name: "platinum blonde dye", price: 20, tags: ["glam"], color: "#fff1b8" },
  pink:     { slot: "dye", name: "pastel pink dye", price: 20, tags: ["cute", "flashy"], color: "#f6b3cf" },
  lilac:    { slot: "dye", name: "lilac dye", price: 20, tags: ["edgy"], color: "#c3a6e8" },
  ink:      { slot: "dye", name: "inky blue dye", price: 20, tags: ["edgy"], color: "#34407a" },
  // hats
  nohat:    { slot: "hat", name: "no hat", price: 0, tags: [] },
  bow:      { slot: "hat", name: "a big satin bow", price: 10, tags: ["cute"], hat: "bow" },
  sunhat:   { slot: "hat", name: "a straw sunhat", price: 15, tags: ["cute", "boho"], hat: "sunhat" },
  crown:    { slot: "hat", name: "a flower crown", price: 20, tags: ["boho", "cute"], hat: "flowercrown" },
  beret:    { slot: "hat", name: "a beret", price: 20, tags: ["edgy", "classy"], hat: "beret" },
  fascinator: { slot: "hat", name: "a feathered fascinator", price: 55, tags: ["classy", "flashy"], hat: "fascinator" },
  tiara:    { slot: "hat", name: "a tiara", price: 110, tags: ["glam", "flashy"], hat: "tiara" },
  // necklaces
  noneck:   { slot: "neck", name: "no necklace", price: 0, tags: [] },
  scarf:    { slot: "neck", name: "a silk scarf", price: 15, tags: ["classy"], neck: "scarf" },
  locket:   { slot: "neck", name: "a little locket", price: 20, tags: ["cute", "modest"], neck: "locket" },
  choker:   { slot: "neck", name: "a velvet choker", price: 25, tags: ["edgy"], neck: "choker" },
  pearls:   { slot: "neck", name: "a string of pearls", price: 60, tags: ["classy"], neck: "pearls" },
  diamonds: { slot: "neck", name: "a diamond necklace", price: 140, tags: ["glam", "flashy"], neck: "diamonds" },
  // earrings
  noears:   { slot: "ears", name: "no earrings", price: 0, tags: [] },
  hoops:    { slot: "ears", name: "gold hoops", price: 25, tags: ["glam", "edgy"], ears: "hoops" },
  studs:    { slot: "ears", name: "pearl studs", price: 30, tags: ["classy", "modest"], ears: "studs" },
  chandelier: { slot: "ears", name: "chandelier earrings", price: 70, tags: ["flashy", "glam"], ears: "chandelier" },
  // glasses
  noface:   { slot: "face", name: "no glasses", price: 0, tags: [] },
  specs:    { slot: "face", name: "round reading glasses", price: 10, tags: ["modest", "practical"], face: "roundglasses" },
  cateye:   { slot: "face", name: "cat-eye glasses", price: 25, tags: ["edgy", "classy"], face: "cateye" },
  shades:   { slot: "face", name: "big sunglasses", price: 30, tags: ["glam", "flashy"], face: "sunglasses" },
  // bags
  nobag:    { slot: "bag", name: "no bag", price: 0, tags: [] },
  basket:   { slot: "bag", name: "a wicker basket", price: 5, tags: ["practical", "cute"], bag: "basket" },
  tote:     { slot: "bag", name: "a canvas tote", price: 15, tags: ["practical", "boho"], bag: "tote" },
  clutch:   { slot: "bag", name: "a beaded clutch", price: 40, tags: ["classy"], bag: "clutch" },
  handbag:  { slot: "bag", name: "a designer handbag", price: 110, tags: ["glam", "flashy"], bag: "handbag" },
};

// free swatches
export const COLORS = {
  "#f6a37a": "peach", "#ff8fb8": "pink", "#d8283c": "red", "#ffd76a": "yellow", "#7fbf8f": "sage green",
  "#5a8ad6": "blue", "#6b4a9a": "purple", "#2a2430": "black", "#ffffff": "white", "#c9a074": "camel",
};
export const SKINS = ["#fde3cf", "#fbd9c4", "#f1cdb5", "#e9c2a6", "#d8a888", "#c98f6a", "#a8704c", "#7a4e34"];

export const STARTER = { dress: "frock", shoes: "clogs", hair: "sidebun", dye: "chestnut", hat: "nohat", neck: "noneck", ears: "noears", face: "noface", bag: "nobag", color: "#f6a37a", skin: "#fbd9c4" };
export const FREE = Object.keys(ITEMS).filter((id) => ITEMS[id].price === 0);

export const outfitCost = (o) => SLOTS.reduce((t, sl) => t + (ITEMS[o[sl.key]]?.price || 0), 0);
export const outfitKey = (o) => [...SLOTS.map((sl) => o[sl.key]), o.color].join("|");

// the 3D look for people.js
export function lookOf(o) {
  const it = (k) => ITEMS[o[k]] || ITEMS[STARTER[k]];
  const accent = { "#ffffff": "#ff8fb8", "#2a2430": "#e8c36a", "#ffd76a": "#ffffff" }[o.color] || "#ffffff";
  return {
    skin: o.skin || STARTER.skin, hair: it("dye").color, hairStyle: it("hair").style,
    outfit: o.color || STARTER.color, accent, height: 1.0,
    dress: it("dress").shape, shoe: it("shoes").shoe, shoeColor: it("shoes").color,
    hat: it("hat").hat || null, neck: it("neck").neck || null, ears: it("ears").ears || null, face: it("face").face || null, bag: it("bag").bag || null,
  };
}

export function tagsOf(o) {
  const n = {};
  for (const sl of SLOTS) for (const t of ITEMS[o[sl.key]]?.tags || []) n[t] = (n[t] || 0) + (sl.key === "dress" ? 2 : 1);
  return n;
}

// how pricey it looks, in words
export function priceWord(cost) {
  return cost >= 300 ? "dripping in money" : cost >= 180 ? "very expensive" : cost >= 100 ? "expensive" : cost >= 45 ? "mid-priced" : cost >= 15 ? "cheap" : "dirt cheap, hand-me-downs";
}

// "a sage green tweed skirt suit, red heels, a beret and pearl studs"
export function itemsText(o) {
  const parts = [`a ${COLORS[o.color] || "colored"} ${ITEMS[o.dress].name}`, ITEMS[o.shoes].name];
  for (const k of ["hat", "neck", "ears", "face", "bag"]) if (ITEMS[o[k]]?.price) parts.push(ITEMS[o[k]].name);
  return parts.join(", ");
}
export function hairText(o) { return `${ITEMS[o.hair].name} in ${ITEMS[o.dye].name.replace(/ dye$/, "")}`; }

// The most noticeable thing she is wearing (for quick remarks)
export function standout(o) {
  let best = o.dress, bp = -1;
  for (const sl of SLOTS) { const it = ITEMS[o[sl.key]]; if (!it || !it.price) continue; const p = it.price + (sl.key === "dress" ? 30 : 0); if (p > bp) { bp = p; best = o[sl.key]; } }
  return ITEMS[best].name.replace(/^an? /, "");
}

export function owns(owned, id) { return FREE.includes(id) || (owned || []).includes(id); }
