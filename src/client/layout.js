// The shape of Thistlewick: where everything stands, what you can walk on, and how
// people find their way around. Units are metres; x runs east, z runs south.

export const BOUNDS = { x0: -62, x1: 62, z0: -74, z1: 52 };

export const LAKE = { x: 0, z: -58, rx: 30, rz: 14 };
export const RIVER = [[24, -50], [28, -34], [31, -16], [31, 2], [33, 18], [36, 34], [38, 52]];
export const RIVER_W = 5.2;
export const BRIDGE = { x: 31.2, z: 0, w: 4.4, len: 9 };
export const PLAZA = { x: 0, z: 0, r: 10.5 };

export const ROADS = [
  { pts: [[-46, 0], [-10, 0]], w: 4.2 },
  { pts: [[10, 0], [50, 0]], w: 4.2 },
  { pts: [[0, -10], [0, -42]], w: 3.6 },
  { pts: [[0, 10], [0, 50]], w: 3.6 },
  { pts: [[-36, 26], [26, 26]], w: 3.0 },
  { pts: [[0, -24], [-14, -28], [-24, -33]], w: 2.6 },
  { pts: [[-34, 0], [-36, 10], [-38, 18]], w: 2.6 },
  { pts: [[42, 0], [42, 6]], w: 3 },
];

// Buildings: centre, size, facing (direction the door looks: "s","n","e","w"), and look.
export const BUILDINGS = [
  { id: "bakery", x: -14, z: -14, w: 9, d: 7.5, h: 3.6, face: "s", wall: "#fff3d6", roof: "#e98a5a", trim: "#b5643c", sign: "Marigold's", awning: ["#ffd76a", "#ffffff"], kind: "shop" },
  { id: "salon", x: 14, z: -14, w: 9, d: 7.5, h: 3.8, face: "s", wall: "#ffe1ec", roof: "#e86f9a", trim: "#b84a74", sign: "Curl Up & Dye", awning: ["#ff8fb8", "#ffffff"], kind: "shop" },
  { id: "tavern", x: -16, z: 12.2, w: 11, d: 8.5, h: 4.4, face: "n", wall: "#f3dcc0", roof: "#7a5a9a", trim: "#5a3e2a", sign: "Crooked Kettle", awning: null, kind: "tavern", floors: 2 },
  { id: "gazette", x: 12.5, z: 12, w: 8, d: 7, h: 4.0, face: "n", wall: "#dff1ee", roof: "#3a8f8a", trim: "#2a5f5a", sign: "The Whisper", awning: ["#3fa7a0", "#ffffff"], kind: "shop" },
  { id: "hall", x: -38, z: -10, w: 13, d: 9, h: 5, face: "s", wall: "#efe7f5", roof: "#4a5a8a", trim: "#34406a", sign: "Town Hall", awning: null, kind: "hall" },
  { id: "smithy", x: 44, z: 12, w: 9, d: 7, h: 3.8, face: "n", wall: "#d9c2a8", roof: "#7a4a3a", trim: "#4a2e22", sign: "Hale & Co.", awning: null, kind: "smithy" },
  { id: "greenhouse", x: -44, z: 22, w: 7, d: 5.5, h: 3.2, face: "e", wall: "#cfeee0", roof: "#bfe8dc", trim: "#5a9a7a", sign: null, awning: null, kind: "glass" },
];

// Cottages along the lane, one per cast member, plus the player's rented room.
export const COTTAGES = [
  { id: "celeste", x: -29, z: 20, face: "s", wall: "#fff0f6", roof: "#ff8fb8" },
  { id: "odette", x: -19.5, z: 20, face: "s", wall: "#ece4f6", roof: "#6b4a9a" },
  { id: "wren", x: -10, z: 20, face: "s", wall: "#f9efe0", roof: "#d9572e" },
  { id: "sylvie", x: 9.5, z: 20.5, face: "s", wall: "#efe6e8", roof: "#7a2e44" },
  { id: "marigold", x: 19.5, z: 20.5, face: "s", wall: "#fff7dc", roof: "#f0b552" },
  { id: "pippa", x: -29, z: 32, face: "n", wall: "#e6f0ff", roof: "#5a8ad6" },
  { id: "brenna", x: -19.5, z: 32, face: "n", wall: "#efe2d6", roof: "#8a5a3a" },
  { id: "juniper", x: -10, z: 32, face: "n", wall: "#eef6ea", roof: "#7fbf8f" },
  { id: "hesper", x: 9.5, z: 32, face: "n", wall: "#e8eaf2", roof: "#34406a" },
  { id: "tansy", x: 19.5, z: 32, face: "n", wall: "#e2f4f2", roof: "#3fa7a0" },
  { id: "player", x: 8, z: 42, face: "w", wall: "#fff2e8", roof: "#f6a37a" },
];
export const COTTAGE_SIZE = { w: 6, d: 5, h: 3 };

export const MARKET_STALLS = [
  { x: 20, z: -4.6, rot: 0, colors: ["#ff8a8a", "#ffffff"] },
  { x: 25, z: -4.6, rot: 0, colors: ["#8ad0ff", "#ffffff"] },
  { x: 20, z: 4.6, rot: Math.PI, colors: ["#ffd76a", "#ffffff"] },
  { x: 25, z: 4.6, rot: Math.PI, colors: ["#9ae0a8", "#ffffff"] },
];

export const DOCK = { x: 10, z: -42, w: 3, len: 12 };
export const FIREPIT = { x: -26, z: -37, r: 6.2 };
export const GATE = { x: 0, z: 48 };
export const FOUNTAIN = { x: 0, z: 0, r: 2.6 };

// Where people stand when they are "at" a place: the open ground in front of it.
export const PLACE_SPOTS = {
  plaza:   { x: 0, z: 0, r: 8.5, inner: 3.6 },
  bakery:  { x: -13, z: -7.2, r: 3.2 },
  salon:   { x: 13, z: -7.2, r: 3.2 },
  tavern:  { x: -15, z: 5.6, r: 2.4 },
  gazette: { x: 12.5, z: 6.2, r: 2 },
  market:  { x: 22.5, z: 0, r: 3.6 },
  hall:    { x: -38, z: -2.6, r: 4 },
  smithy:  { x: 43, z: 5, r: 3.4 },
  garden:  { x: -35, z: 20, r: 3.6 },
  dock:    { x: 10, z: -44, r: 1.2, line: true },
  firepit: { x: -26, z: -37, r: 4.6, inner: 2.6 },
};

export const PLAYER_START = { x: 2, z: 6 };
export const HOST_SPOT = { x: -26, z: -44.2 };

// ---------- geometry helpers ----------

export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const x = ax + t * dx, z = az + t * dz;
  return Math.hypot(px - x, pz - z);
}
export function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

const footprint = (b, pad) => ({ x0: b.x - b.w / 2 - pad, x1: b.x + b.w / 2 + pad, z0: b.z - b.d / 2 - pad, z1: b.z + b.d / 2 + pad });
const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export const onRoad = (x, z) => ROADS.some((r) => distToPolyline(x, z, r.pts) < r.w / 2) || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r;
export const inLake = (x, z) => ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 < 1;
export const inRiver = (x, z) => distToPolyline(x, z, RIVER) < RIVER_W / 2;
export const onBridge = (x, z) => Math.abs(z - BRIDGE.z) < BRIDGE.w / 2 && Math.abs(x - BRIDGE.x) < BRIDGE.len / 2;
export const onDock = (x, z) => Math.abs(x - DOCK.x) < DOCK.w / 2 && z <= DOCK.z + 3 && z >= DOCK.z - DOCK.len;

// Trees and other round obstacles are added by the town builder.
export const OBSTACLES = []; // { x, z, r }

export function solidAt(x, z, pad = 0.35) {
  if (x < BOUNDS.x0 + 2 || x > BOUNDS.x1 - 2 || z < BOUNDS.z0 + 2 || z > BOUNDS.z1 - 2) return true;
  if (onDock(x, z) || onBridge(x, z)) return false;
  if (inLake(x, z) || inRiver(x, z)) return true;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.r + pad) return true;
  for (const b of BUILDINGS) if (inRect(x, z, footprint(b, pad))) return true;
  for (const c of COTTAGES) if (inRect(x, z, footprint({ ...c, ...COTTAGE_SIZE }, pad))) return true;
  for (const s of MARKET_STALLS) if (Math.abs(x - s.x) < 1.9 + pad && Math.abs(z - s.z) < 1.0 + pad) return true;
  for (const o of OBSTACLES) if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return true;
  if (Math.hypot(x - FIREPIT.x, z - FIREPIT.z) < 1.3 + pad) return true; // the fire itself
  return false;
}

// ---------- path finding on a 1 m grid; roads are cheaper so people walk on them ----------

const CELL = 1;
const GW = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / CELL), GH = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / CELL);
let grid = null; // 0 = blocked, else cost

export function buildGrid() {
  grid = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = BOUNDS.x0 + (i + 0.5) * CELL, z = BOUNDS.z0 + (j + 0.5) * CELL;
    grid[j * GW + i] = solidAt(x, z, 0.5) ? 0 : onRoad(x, z) || onBridge(x, z) || onDock(x, z) ? 1 : 2.6;
  }
}
const cellOf = (x, z) => [Math.floor((x - BOUNDS.x0) / CELL), Math.floor((z - BOUNDS.z0) / CELL)];
const centre = (i, j) => [BOUNDS.x0 + (i + 0.5) * CELL, BOUNDS.z0 + (j + 0.5) * CELL];
const open = (i, j) => i >= 0 && j >= 0 && i < GW && j < GH && grid[j * GW + i] > 0;

function nearestOpen(i, j) {
  if (open(i, j)) return [i, j];
  for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (open(i + di, j + dj)) return [i + di, j + dj];
  return [i, j];
}

export function findPath(ax, az, bx, bz) {
  if (!grid) buildGrid();
  const [si, sj] = nearestOpen(...cellOf(ax, az));
  const [ti, tj] = nearestOpen(...cellOf(bx, bz));
  const start = sj * GW + si, goal = tj * GW + ti;
  const g = new Map([[start, 0]]), came = new Map();
  const heap = [[0, start]];
  const push = (f, n) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const closed = new Set();
  let found = false, guard = 0;
  while (heap.length && guard++ < 30000) {
    const [, n] = pop();
    if (n === goal) { found = true; break; }
    if (closed.has(n)) continue;
    closed.add(n);
    const i = n % GW, j = (n / GW) | 0;
    for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]]) {
      const ni = i + di, nj = j + dj;
      if (!open(ni, nj) || (di && dj && (!open(i + di, j) || !open(i, j + dj)))) continue;
      const m = nj * GW + ni;
      const cost = g.get(n) + w * (grid[n] + grid[m]) / 2;
      if (cost < (g.get(m) ?? Infinity)) { g.set(m, cost); came.set(m, n); push(cost + Math.hypot(ni - ti, nj - tj), m); }
    }
  }
  if (!found) return [[bx, bz]];
  const cells = [];
  for (let n = goal; n !== undefined && n !== start; n = came.get(n)) cells.push(n);
  cells.reverse();
  const pts = cells.map((n) => centre(n % GW, (n / GW) | 0));
  pts.push([bx, bz]);
  return smooth([[ax, az], ...pts]).slice(1);
}

// drop points that can be skipped in a straight line over equally cheap ground
function smooth(pts) {
  const out = [pts[0]];
  let k = 0;
  while (k < pts.length - 1) {
    let far = k + 1;
    for (let m = Math.min(pts.length - 1, k + 14); m > k + 1; m--) if (clearLine(pts[k], pts[m])) { far = m; break; }
    out.push(pts[far]);
    k = far;
  }
  return out;
}
function clearLine(a, b) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5);
  const [ai, aj] = cellOf(a[0], a[1]);
  const c0 = open(ai, aj) ? grid[aj * GW + ai] : 2.6;
  for (let t = 1; t < n; t++) {
    const x = a[0] + ((b[0] - a[0]) * t) / n, z = a[1] + ((b[1] - a[1]) * t) / n;
    const [i, j] = cellOf(x, z);
    if (!open(i, j) || grid[j * GW + i] !== c0) return false;
  }
  return true;
}

// A free standing spot for someone at a place.
export function spotFor(place, taken = [], seedAngle = Math.random() * Math.PI * 2) {
  const p = PLACE_SPOTS[place];
  if (!p) return { x: PLAYER_START.x, z: PLAYER_START.z };
  for (let k = 0; k < 40; k++) {
    let x, z;
    if (p.line) { x = p.x + (Math.random() - 0.5) * 1.6; z = p.z - Math.random() * 8; }
    else {
      const a = seedAngle + k * 2.4, rr = (p.inner || 0) + Math.random() * (p.r - (p.inner || 0));
      x = p.x + Math.cos(a) * rr; z = p.z + Math.sin(a) * rr;
    }
    if (solidAt(x, z, 0.6)) continue;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < 1.3)) continue;
    return { x, z };
  }
  return { x: p.x, z: p.z };
}

export function homeDoor(id) {
  const c = COTTAGES.find((c) => c.id === id);
  if (!c) return { x: 0, z: 26 };
  const off = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[c.face];
  return { x: c.x + off[0] * (COTTAGE_SIZE.d / 2 + 1.4), z: c.z + off[1] * (COTTAGE_SIZE.d / 2 + 1.4) };
}

export function placeAt(x, z) {
  let best = null, bd = Infinity;
  for (const [k, p] of Object.entries(PLACE_SPOTS)) {
    const d = p.line ? (Math.abs(x - p.x) < 2 && z < p.z + 3 && z > p.z - 10 ? 0 : Infinity) : Math.hypot(x - p.x, z - p.z) - p.r;
    if (d < bd) { bd = d; best = k; }
  }
  return bd < 4 ? best : "lane";
}
