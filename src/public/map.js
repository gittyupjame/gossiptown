// The town map, shared by the server (who stands where) and the browser (drawing and walking).
// The town sits on a small round planet. The map is a grid wrapped around it: x goes once
// around the planet (it wraps, so x = W is x = 0 again), y goes from the north pole (0) to
// the south pole (H). The town is built in a band around the middle, with sea at the poles.
//
// `ground` is what the ground looks like, `blocked` is for walking, `objects` are things
// that stand on the ground (houses, the well, stalls), and `zones` say which tiles belong
// to which place in the game.

export const W = 56, H = 28;

// Ground letters:
//   g grass  p path  c cobble  f wood floor  s stone floor  d doorway  n sand  o sea
//   w wood wall  v stone wall  t tree  x fence  h herb bed  b flowers
const ground = Array.from({ length: H }, () => Array(W).fill("g"));
const blocked = Array.from({ length: H }, () => Array(W).fill(false));
export const objects = [];

const wrapX = (x) => ((x % W) + W) % W;
const set = (x, y, t, block) => { x = wrapX(x); ground[y][x] = t; blocked[y][x] = block; };
const fill = (x0, y0, x1, y1, t, block = false) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t, block); };
const obj = (kind, x, y, w = 1, h = 1, extra = {}) => {
  objects.push({ kind, x, y, w, h, ...extra });
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) blocked[yy][wrapX(xx)] = true;
};

// A building with walls all round and a doorway in the wall facing the ring road.
function building(x0, y0, x1, y1, floor, wall, doors, doorRow) {
  fill(x0, y0, x1, y1, wall, true);
  fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, floor);
  for (const dx of doors) set(dx, doorRow, "d", false);
}

// sea at the poles, a strip of sand, then grass
fill(0, 0, W - 1, 3, "o", true);
fill(0, 24, W - 1, 27, "o", true);
fill(0, 4, W - 1, 4, "n");
fill(0, 23, W - 1, 23, "n");

// the ring road round the middle of the planet
fill(0, 14, W - 1, 14, "p");

// ---- north of the road ----
// smithy
building(2, 7, 9, 12, "s", "v", [5, 6], 12);
fill(5, 13, 6, 13, "p");
obj("forge", 3, 8, 2, 1);
obj("anvil", 6, 10);
obj("barrel", 8, 8);
// bakery
building(12, 7, 18, 12, "f", "w", [15], 12);
fill(15, 13, 15, 13, "p");
obj("oven", 13, 8, 2, 1);
obj("counter", 14, 9, 3, 1);
obj("table", 17, 11);
// tavern
building(21, 6, 30, 12, "f", "w", [25, 26], 12);
fill(25, 13, 26, 13, "p");
obj("counter", 23, 8, 5, 1);
obj("barrel", 29, 7);
obj("table", 23, 10, 2, 1);
obj("table", 27, 10, 2, 1);
// elder's hall
building(33, 7, 40, 12, "s", "v", [36, 37], 12);
fill(36, 13, 37, 13, "p");
obj("podium", 36, 8, 2, 1);
obj("bench", 34, 10, 2, 1);
obj("bench", 38, 10, 2, 1);

// ---- south of the road ----
// village square
fill(10, 15, 22, 21, "c");
obj("well", 15, 17, 2, 2);
obj("bench", 11, 20, 2, 1);
obj("bench", 20, 16, 2, 1);
// market
fill(25, 15, 33, 21, "p");
obj("stall", 26, 17, 3, 1, { color: "#e0705a" });
obj("stall", 30, 17, 3, 1, { color: "#9a6fd0" }); // Odo's
obj("stall", 26, 20, 3, 1, { color: "#5a9ae0" });
obj("stall", 30, 20, 3, 1, { color: "#e0b85a" });
// herb garden, fenced, gate facing the road
fill(36, 15, 44, 21, "x", true);
fill(37, 16, 43, 20, "g");
set(39, 15, "p", false); set(40, 15, "p", false);
for (const y of [17, 19]) fill(38, y, 42, y, "h", true);

// ---- homes: four north of the road, four south, each with its door facing the road ----
export const HOUSES = {};
const owners = ["brannoc", "pip", "marigold", "odo", "wren", "silas", "hesper", "juniper"];
const roofs = ["#c8594a", "#5a7ec0", "#e08a4a", "#7a5ab0", "#c0904a", "#5aa06a", "#4a6aa0", "#b0a04a"];
[[43, 10], [47, 10], [51, 10], [54, 10], [46, 16], [50, 16], [54, 16], [2, 16]].forEach(([x, y], i) => {
  obj("house", x, y, 3, 2, { color: roofs[i], owner: owners[i], facing: y < 14 ? "south" : "north" });
  const fy = y < 14 ? y + 2 : y - 1; // the tile in front of the door
  set(x + 1, fy, "p", false);
  if (y < 14) set(x + 1, fy + 1, "p", false);
  HOUSES[owners[i]] = { x: wrapX(x + 1), y: fy };
});

// trees and flowers dotted about the grass
const TREES = [[1, 6], [11, 6], [19, 5], [31, 5], [42, 6], [48, 6], [53, 7], [10, 9], [20, 10], [32, 9], [41, 9],
  [24, 22], [8, 19], [34, 22], [45, 21], [52, 21], [6, 22], [14, 22], [23, 17], [35, 17], [55, 12], [8, 15], [45, 13]];
for (const [x, y] of TREES) if (ground[y][wrapX(x)] === "g" && !blocked[y][wrapX(x)]) set(x, y, "t", true);
const FLOWERS = [[4, 5], [16, 5], [27, 5], [38, 5], [50, 5], [12, 13], [19, 13], [31, 13], [42, 13], [6, 21], [17, 22], [29, 22], [48, 22], [3, 20], [53, 20], [9, 17]];
for (const [x, y] of FLOWERS) if (ground[y][wrapX(x)] === "g" && !blocked[y][wrapX(x)]) set(x, y, "b", false);

export { ground, blocked };

// Which tiles belong to which place. Anything outside these is the lane between places.
export const ZONES = {
  smithy: [2, 7, 9, 12],
  bakery: [12, 7, 18, 12],
  tavern: [21, 6, 30, 12],
  hall: [33, 7, 40, 12],
  square: [10, 15, 22, 21],
  market: [25, 15, 33, 21],
  garden: [36, 15, 44, 21],
};

export function zoneAt(x, y) {
  const tx = wrapX(Math.floor(x)), ty = Math.floor(y);
  for (const [k, [x0, y0, x1, y1]] of Object.entries(ZONES)) if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return k;
  return null;
}

// Tiles inside a place where someone can stand (not doorways, not walls).
export const SPOTS = {};
for (const [k, [x0, y0, x1, y1]] of Object.entries(ZONES)) {
  SPOTS[k] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!blocked[y][x] && ground[y][x] !== "d") SPOTS[k].push({ x, y });
}

export const walkable = (x, y) => y >= 0 && y < H && !blocked[y][wrapX(x)];
export { wrapX };

// Distance in tiles, going the short way round the planet.
export function dist(ax, ay, bx, by) {
  let dx = Math.abs(wrapX(ax) - wrapX(bx));
  if (dx > W / 2) dx = W - dx;
  return Math.hypot(dx, ay - by);
}

// The short way round from ax to bx: a step between -W/2 and W/2.
export function dxTo(ax, bx) {
  let d = wrapX(bx) - wrapX(ax);
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

// Shortest path on the tile grid, 4 directions, wrapping round the planet.
// Returns a list of tiles, not including the start.
export function findPath(sx, sy, tx, ty) {
  sx = wrapX(sx); tx = wrapX(tx);
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const queue = [[sx, sy]];
  const goalOk = walkable(tx, ty);
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = wrapX(x + dx), ny = y + dy;
      if (ny < 0 || ny >= H || prev.has(key(nx, ny))) continue;
      const isGoal = nx === tx && ny === ty;
      if (!walkable(nx, ny) && !(isGoal && !goalOk)) continue;
      prev.set(key(nx, ny), key(x, y));
      if (isGoal) {
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

export const START = { x: 16, y: 20 };
