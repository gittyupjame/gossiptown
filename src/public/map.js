// The town map, shared by the server (who stands where) and the browser (drawing and walking).
// A flat town on a grid of 1 x 1 tiles: x runs east, y runs south. The camera looks north,
// so buildings face south (towards the camera) wherever they can.
//
// `ground` is what the ground looks like, `blocked` is for walking, `objects` are the
// things that stand on the ground, and `zones` say which tiles belong to which place.

export const W = 64, H = 48;

// Ground letters:
//   g grass  p stone path  c plaza cobbles  k patio tiles  d wooden deck  n sand  o water
//   b under a building  t under a tree  h hedge
const ground = Array.from({ length: H }, () => Array(W).fill("g"));
const blocked = Array.from({ length: H }, () => Array(W).fill(false));
export const objects = [];

const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, t, block) => { if (inMap(x, y)) { ground[y][x] = t; blocked[y][x] = block; } };
const fill = (x0, y0, x1, y1, t, block = false) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t, block); };
const block = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inMap(x, y)) blocked[y][x] = true; };
const obj = (kind, x, y, extra = {}) => { const o = { kind, x, y, ...extra }; objects.push(o); return o; };

// A building: a solid block with its front (door, sign, awning) on one side.
function building(id, x0, y0, x1, y1, extra) {
  fill(x0, y0, x1, y1, "b", true);
  return obj("building", x0, y0, { id, w: x1 - x0 + 1, h: y1 - y0 + 1, front: "south", ...extra });
}

// ---- edges: woods all round, a river along the south ----
fill(0, 0, W - 1, 1, "t", true); fill(0, H - 4, W - 1, H - 1, "t", true);
fill(0, 0, 1, H - 1, "t", true); fill(W - 2, 0, W - 1, H - 1, "t", true);
fill(2, 41, W - 3, 41, "n"); fill(2, 42, W - 3, 43, "o", true);

// ---- streets ----
fill(2, 13, W - 3, 13, "p");          // high street, along the shop fronts
fill(2, 31, W - 3, 31, "p");          // south road
fill(2, 39, W - 3, 39, "p");          // home lane, by the river
fill(20, 14, 20, 30, "p"); fill(43, 14, 43, 30, "p"); // side streets either side of the square
fill(31, 32, 32, 38, "p");            // from the square down to the homes

// ---- the shops along the high street, all facing the square ----
building("salon", 4, 4, 12, 9, { name: "Curl Up & Dye", wall: "#ffc8dc", roof: "#e86a9a", trim: "#ffffff", awning: ["#ff8fb8", "#ffffff"] });
fill(4, 10, 13, 12, "k");
building("cafe", 16, 4, 24, 9, { name: "Daisy Cup", wall: "#fff1c4", roof: "#f0a85a", trim: "#ffffff", awning: ["#ffd34f", "#ffffff"] });
fill(15, 10, 25, 12, "k");
building("townhall", 28, 2, 35, 9, { name: "Town Hall", wall: "#e8eef8", roof: "#7a8ad8", trim: "#ffffff", tall: true, clock: true });
building("bakery", 38, 4, 46, 9, { name: "Sugarplum Bakery", wall: "#ffe0e6", roof: "#c97a5a", trim: "#fff8f0", awning: ["#f4a6b8", "#fff4ea"] });
fill(38, 10, 47, 12, "k");
building("boutique", 50, 4, 59, 9, { name: "Velvet Boutique", wall: "#e6dcff", roof: "#8a6ad0", trim: "#ffe8a0", awning: ["#b49cf0", "#ffffff"] });
fill(49, 10, 60, 12, "k");

// shop-front furniture
obj("salonchair", 6, 11); obj("salonchair", 8, 11); obj("salonchair", 10, 11); obj("mirror", 12, 10);
for (const [x, y, c] of [[17, 11, "#ff8fb0"], [20, 11, "#7ccfa8"], [23, 11, "#ffcf5a"]]) obj("cafetable", x, y, { color: c });
obj("breadcart", 40, 11); obj("bench", 44, 11, { w: 2 });
obj("rack", 51, 11); obj("mannequin", 54, 11); obj("rack", 57, 11);

// ---- the town square, with the gazebo stage where the vote happens ----
fill(21, 14, 42, 30, "c");
obj("gazebo", 28, 14, { w: 8, h: 3 }); block(28, 14, 35, 16);
obj("fountain", 30, 23, { w: 4, h: 4 }); block(30, 23, 33, 26);
for (const [x, y] of [[22, 15], [41, 15], [22, 29], [41, 29]]) obj("planter", x, y);
for (const [x, y] of [[22, 15], [41, 15], [22, 29], [41, 29]]) block(x, y, x, y);
obj("bench", 24, 27, { w: 2 }); obj("bench", 38, 27, { w: 2 });
obj("tvcamera", 23, 18); obj("tvcamera", 40, 18); obj("tvcamera", 37, 29); block(23, 18, 23, 18); block(40, 18, 40, 18); block(37, 29, 37, 29);
obj("bunting", 21, 14, { to: [42, 14] });
obj("bunting", 21, 30, { to: [42, 30], high: true });

// ---- east side: the wine bar and the post office, fronts facing the square ----
building("winebar", 52, 15, 59, 22, { name: "The Rosé Garden", wall: "#ffd6d0", roof: "#c8505a", trim: "#fff4ea", front: "west", awning: ["#e86a7a", "#fff4ea"] });
fill(45, 15, 51, 22, "d");
for (const [x, y] of [[46, 16], [49, 16], [46, 19], [49, 19]]) obj("winetable", x, y);
obj("stringlights", 45, 15, { to: [51, 15] }); obj("stringlights", 45, 22, { to: [51, 22] });
building("postoffice", 52, 25, 59, 30, { name: "Post Office", wall: "#d8ecff", roof: "#4a7ac0", trim: "#ffffff", front: "west", awning: ["#5a8ad8", "#ffffff"] });
fill(46, 25, 51, 29, "k");
obj("mailbox", 47, 26); obj("mailbox", 47, 28); obj("bench", 49, 27, { w: 2 });

// ---- west side: Willow Park and the florist ----
fill(9, 17, 14, 21, "o", true);
obj("pond", 9, 17, { w: 6, h: 5 });
obj("lilypad", 10, 18); obj("lilypad", 12, 20); obj("lilypad", 13, 18);
obj("bench", 5, 16, { w: 2 }); obj("bench", 16, 22, { w: 2 }); obj("bench", 6, 22, { w: 2 });
building("florist", 4, 24, 10, 27, { name: "Petal & Thorn", wall: "#e4f8dc", roof: "#5aae6a", trim: "#ffffff", awning: ["#7cd08a", "#ffffff"] });
fill(3, 28, 12, 30, "k");
obj("flowercart", 5, 29); obj("flowercart", 9, 29); obj("flowerpots", 11, 28);

// ---- homes along the river lane, every front door facing south ----
export const HOUSES = {};
const owners = ["player", "vivienne", "pippa", "ivy", "wren", "sylvie", "marigold", "odette", "juniper", "hesper"];
const roofs = ["#f49ab0", "#9a7ae0", "#ffb070", "#ff7a9a", "#e8805a", "#7a8ab0", "#f6c86a", "#6a9ad8", "#7cc88a", "#8a9ab8"];
const walls = ["#fff6ec", "#f6eeff", "#fff2e0", "#ffeef2", "#fff0e8", "#eef2fa", "#fffae6", "#eef6ff", "#f0fbec", "#f4f4f8"];
owners.forEach((owner, i) => {
  const x = 6 + i * 5 + (i >= 5 ? 6 : 0);
  building("house", x, 34, x + 3, 37, { owner, wall: walls[i], roof: roofs[i], trim: "#ffffff", small: true });
  fill(x + 1, 38, x + 2, 38, "p");
  HOUSES[owner] = { x: x + 1, y: 38 }; // the tile in front of the door
  obj("fence", x - 1, 38, { to: [x, 38] }); obj("fence", x + 3, 38, { to: [x + 4, 38] });
  obj("mailbox", x + 3, 38, { small: true });
});

// ---- trees, hedges, flowers and lamps ----
const TREES = [[3, 3], [14, 3], [26, 3], [37, 3], [48, 3], [61, 4], [3, 14], [17, 15], [4, 20], [15, 24], [18, 18], [7, 31],
  [3, 33], [26, 33], [37, 33], [56, 33], [60, 33], [18, 40], [44, 40], [60, 40], [4, 40], [26, 24], [37, 24], [60, 12], [45, 31]];
for (const [x, y] of TREES) if (!blocked[y][x] && ground[y][x] === "g") { set(x, y, "t", true); obj("tree", x, y, { kind2: (x * 7 + y * 3) % 3 }); }
for (let x = 2; x < W - 2; x++) for (const y of [0, 1, H - 4, H - 3, H - 2, H - 1]) if ((x * 13 + y * 7) % 3 === 0) obj("tree", x, y, { kind2: (x + y) % 3, edge: true });
for (let y = 2; y < H - 4; y++) for (const x of [0, 1, W - 2, W - 1]) if ((x * 5 + y * 11) % 3 === 0) obj("tree", x, y, { kind2: (x + y) % 3, edge: true });
for (const [x, y] of [[2, 14], [19, 14], [44, 14], [2, 32], [19, 32], [44, 32], [61, 32], [61, 14], [27, 13], [36, 13], [14, 31], [50, 31], [25, 39], [38, 39], [12, 39], [52, 39]])
  if (!blocked[y][x]) obj("lamp", x, y);
const FLOWERS = [[3, 11], [14, 11], [26, 11], [37, 11], [48, 11], [61, 11], [5, 15], [16, 16], [7, 23], [17, 27], [24, 32], [39, 32], [21, 40], [41, 40], [57, 40], [33, 41]];
for (const [x, y] of FLOWERS) if (!blocked[y][x] && ground[y][x] === "g") obj("flowers", x, y);
for (const [x, y] of [[2, 12], [27, 12], [36, 12], [61, 12]]) if (!blocked[y][x]) { obj("bush", x, y); blocked[y][x] = true; }

export { ground, blocked };

// Which tiles belong to which place. A place can be several rectangles.
// Anything outside these is the lane between places.
export const ZONES = {
  plaza: [[21, 14, 42, 30]],
  salon: [[4, 10, 13, 12]],
  cafe: [[15, 10, 25, 12]],
  bakery: [[38, 10, 47, 12]],
  boutique: [[49, 10, 60, 12]],
  winebar: [[45, 15, 51, 22]],
  postoffice: [[45, 25, 51, 29]],
  park: [[3, 14, 19, 23], [11, 24, 19, 30]],
  florist: [[3, 28, 10, 30]],
};

export function zoneAt(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (const [k, rects] of Object.entries(ZONES)) for (const [x0, y0, x1, y1] of rects) if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return k;
  return null;
}

// Tiles inside a place where someone can stand.
export const SPOTS = {};
for (const [k, rects] of Object.entries(ZONES)) {
  SPOTS[k] = [];
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (!blocked[y][x] && zoneAt(x, y) === k) SPOTS[k].push({ x, y });
}

export const walkable = (x, y) => inMap(x, y) && !blocked[y][x];
export const wrapX = (x) => x; // the old planet map wrapped round; this town does not
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dxTo = (ax, bx) => bx - ax;

// Shortest path on the tile grid, 8 directions (no cutting corners).
// Returns a list of tiles, not including the start.
export function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  if (!walkable(tx, ty)) {
    // aim for the nearest walkable tile next to the goal
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [tx + dx, ty + dy]).find(([x, y]) => walkable(x, y));
    if (!n) return null;
    [tx, ty] = n;
  }
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const queue = [[sx, sy]];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (prev.has(key(nx, ny)) || !walkable(nx, ny)) continue;
      if (dx && dy && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
      prev.set(key(nx, ny), key(x, y));
      if (nx === tx && ny === ty) {
        const path = [];
        let k = key(nx, ny);
        while (k !== key(sx, sy)) { path.unshift({ x: k % W, y: Math.floor(k / W) }); k = prev.get(k); }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

// The vote: the host stands on the gazebo stage, everyone else in a curve in front of it.
export const STAGE = { x: 32, y: 15.6 };
export const VOTE_SPOTS = Array.from({ length: 11 }, (_, i) => {
  const a = Math.PI * (0.18 + (0.64 * i) / 10);
  return { x: 32 - Math.cos(a) * 6.2, y: 17.6 + Math.sin(a) * 3.2 };
});

export const START = { x: 31.5, y: 28.5 };
