// The town map, shared by the server (who stands where) and the browser (drawing and walking).
// Each tile is 16x16 pixels. The ground grid is for drawing, `blocked` is for walking,
// `objects` are things drawn on top (well, stalls, houses), and `zones` say which tiles
// belong to which place in the game.

export const W = 48, H = 32;

// Ground letters:
//   g grass  p path  c cobble  f wood floor  s stone floor  d doorway
//   w wood wall  v stone wall  t tree  x fence  h herb bed  b flowers
const ground = Array.from({ length: H }, () => Array(W).fill("g"));
const blocked = Array.from({ length: H }, () => Array(W).fill(false));
export const objects = [];

const set = (x, y, t, block) => { ground[y][x] = t; blocked[y][x] = block; };
const fill = (x0, y0, x1, y1, t, block = false) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t, block); };
const obj = (kind, x, y, w = 1, h = 1, extra = {}) => {
  objects.push({ kind, x, y, w, h, ...extra });
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) blocked[yy][xx] = true;
};

function building(x0, y0, x1, y1, floor, wall, doors) {
  fill(x0, y0, x1, y1, wall, true);
  fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, floor);
  for (const dx of doors) set(dx, y1, "d", false);
}

// roads
fill(1, 11, 46, 11, "p");
fill(1, 22, 46, 22, "p");
fill(1, 28, 46, 28, "p");
fill(23, 23, 24, 27, "p");

// smithy, top left
building(2, 2, 11, 8, "s", "v", [6, 7]);
fill(6, 9, 7, 10, "p");
obj("forge", 3, 3, 2, 1);
obj("anvil", 6, 5);
obj("barrel", 10, 3);
obj("barrel", 10, 4);

// bakery
building(14, 2, 21, 8, "f", "w", [17, 18]);
fill(17, 9, 18, 10, "p");
obj("oven", 15, 3, 2, 1);
obj("counter", 18, 4, 3, 1);
obj("table", 19, 6);

// tavern
building(25, 2, 36, 10, "f", "w", [30, 31]);
obj("counter", 27, 4, 6, 1);
obj("barrel", 34, 3);
obj("barrel", 35, 3);
obj("table", 27, 7, 2, 1);
obj("table", 33, 7, 2, 1);

// elder's hall
building(39, 2, 46, 10, "s", "v", [42, 43]);
obj("podium", 42, 3, 2, 1);
obj("bench", 40, 6, 2, 1);
obj("bench", 44, 6, 2, 1);

// village square
fill(14, 12, 33, 20, "c");
obj("well", 23, 15, 2, 2);
obj("bench", 16, 13, 2, 1);
obj("bench", 30, 19, 2, 1);
fill(12, 16, 13, 17, "p"); // to the market
fill(34, 16, 36, 17, "p"); // to the garden

// market
fill(2, 12, 11, 20, "p");
obj("stall", 3, 13, 3, 1, { color: "#c0503a" });
obj("stall", 8, 13, 3, 1, { color: "#7a4fa0" }); // Odo's
obj("stall", 3, 17, 3, 1, { color: "#3a7ac0" });
obj("stall", 8, 17, 3, 1, { color: "#c09a3a" });

// herb garden, fenced, gate on the left
fill(37, 12, 46, 21, "x", true);
fill(38, 13, 45, 20, "g");
set(37, 16, "p", false); set(37, 17, "p", false);
for (const y of [14, 16, 18, 20]) fill(39, y, 44, y, "h", true);

// homes along the bottom
export const HOUSES = {};
const owners = ["brannoc", "pip", "marigold", "odo", "wren", "silas", "hesper", "juniper"];
const roofs = ["#8a3b2e", "#5a6e8a", "#a8573a", "#4e4a6e", "#7a5a2e", "#5a7a4a", "#3e4a5e", "#7a6a3a"];
[2, 7, 12, 17, 27, 32, 37, 42].forEach((x, i) => {
  obj("house", x, 24, 4, 3, { color: roofs[i], owner: owners[i] });
  fill(x + 1, 27, x + 2, 27, "p");
  HOUSES[owners[i]] = { x: x + 1, y: 27 }; // the tile in front of the door
});

// trees round the edge, and a few dotted about
for (let x = 0; x < W; x++) { set(x, 0, "t", true); set(x, H - 1, "t", true); }
for (let y = 0; y < H; y++) { set(0, y, "t", true); set(W - 1, y, "t", true); }
for (const [x, y] of [[12, 3], [13, 6], [22, 3], [23, 7], [37, 4], [38, 8], [3, 23], [10, 30], [20, 29], [30, 30], [45, 29], [1, 29], [12, 21], [35, 13], [35, 20], [13, 13], [26, 30], [40, 23]])
  if (ground[y][x] === "g") set(x, y, "t", true);
for (const [x, y] of [[15, 10], [20, 10], [26, 12], [9, 9], [3, 10], [44, 12], [8, 21], [18, 21], [29, 21], [41, 30], [6, 30], [15, 30], [34, 30], [22, 30], [25, 23]])
  if (ground[y][x] === "g" && !blocked[y][x]) set(x, y, "b", false);

export { ground, blocked };

// Which tiles belong to which place. Anything outside these is the lane between places.
export const ZONES = {
  smithy: [2, 2, 11, 8],
  bakery: [14, 2, 21, 8],
  tavern: [25, 2, 36, 10],
  hall: [39, 2, 46, 10],
  square: [14, 12, 33, 20],
  market: [2, 12, 11, 20],
  garden: [37, 12, 46, 21],
};

export function zoneAt(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (const [k, [x0, y0, x1, y1]] of Object.entries(ZONES)) if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return k;
  return null;
}

// Tiles inside a place where someone can stand (not doorways, not walls).
export const SPOTS = {};
for (const [k, [x0, y0, x1, y1]] of Object.entries(ZONES)) {
  SPOTS[k] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!blocked[y][x] && ground[y][x] !== "d") SPOTS[k].push({ x, y });
}

export const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blocked[y][x];

// Shortest path on the tile grid, 4 directions. Returns a list of tiles, not including the start.
export function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const queue = [[sx, sy]];
  const goalOk = walkable(tx, ty);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (prev.has(key(nx, ny))) continue;
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

export const START = { x: 24, y: 18 };
