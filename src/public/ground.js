// The ground of the planet, painted as pixel tiles into one picture that wraps around
// the globe. Each map tile is 16x16 pixels. Things that stand up (walls, trees, houses)
// are 3D models in globe.js; this is only the ground under them.

export const T = 16;

const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// a fixed pseudo-random number for a tile, so the grass looks the same every time
function rng(seed) {
  let x = seed * 2654435761 >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function speckle(g, base, dots, r, n) {
  g.fillStyle = base; g.fillRect(0, 0, T, T);
  for (let i = 0; i < n; i++) { g.fillStyle = dots[Math.floor(r() * dots.length)]; g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1); }
}

const PAINT = {
  g(g, r) {
    speckle(g, "#7cc35a", ["#6fb54f", "#8bd068", "#68a94a"], r, 24);
    if (r() < 0.3) { const x = 2 + Math.floor(r() * 11), y = 3 + Math.floor(r() * 10); g.fillStyle = "#5f9e44"; g.fillRect(x, y, 1, 2); g.fillRect(x + 2, y, 1, 2); g.fillRect(x + 1, y - 1, 1, 3); }
  },
  p(g, r) { speckle(g, "#e2c08a", ["#d6b27a", "#ecce9a", "#cfa870"], r, 20); },
  n(g, r) { speckle(g, "#f2dfa4", ["#e8d394", "#f8e8b8", "#e0c888"], r, 18); },
  o(g, r) {
    g.fillStyle = "#58b4e0"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#7ccaf0";
    for (let i = 0; i < 3; i++) { const x = Math.floor(r() * 12), y = Math.floor(r() * 14); g.fillRect(x, y, 4, 1); }
  },
  c(g, r) {
    g.fillStyle = "#b9b2a8"; g.fillRect(0, 0, T, T);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 4; col++) {
      const x = col * 4 + (row % 2 ? 2 : 0), y = row * 4;
      g.fillStyle = ["#d2ccc2", "#c8c1b6", "#dcd6cc"][Math.floor(r() * 3)];
      g.fillRect(x + 1, y + 1, 3, 3);
    }
  },
  f(g) {
    g.fillStyle = "#c98f55"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#b07a44";
    for (let y = 3; y < T; y += 4) g.fillRect(0, y, T, 1);
    g.fillRect(5, 0, 1, 3); g.fillRect(12, 4, 1, 3); g.fillRect(3, 8, 1, 3); g.fillRect(10, 12, 1, 3);
  },
  s(g) {
    g.fillStyle = "#aaa49a"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#968f86"; g.fillRect(0, 7, T, 1); g.fillRect(7, 0, 1, 7); g.fillRect(15, 8, 1, 8);
    g.fillStyle = "#b8b2a8"; g.fillRect(1, 1, 5, 1); g.fillRect(9, 9, 5, 1);
  },
  d(g) { PAINT.f(g); },
  h(g, r) {
    g.fillStyle = "#8a5e3a"; g.fillRect(0, 0, T, T);
    for (let x = 1; x < T; x += 5) {
      g.fillStyle = "#4e8e3a"; g.fillRect(x + 1, 6, 1, 6);
      g.fillStyle = ["#6cc24a", "#8fd060", "#b48ae0"][Math.floor(r() * 3)]; g.fillRect(x, 3, 3, 4);
    }
  },
  b(g, r) {
    PAINT.g(g, r);
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12);
      g.fillStyle = ["#ffe066", "#ff8fb0", "#ffffff", "#b49cff"][Math.floor(r() * 4)];
      g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
      g.fillStyle = "#e8b830"; g.fillRect(x, y, 1, 1);
    }
  },
};
// tiles covered by 3D things get the ground that would be under them
PAINT.t = PAINT.g; PAINT.x = PAINT.g; PAINT.w = PAINT.f; PAINT.v = PAINT.s;

export function paintGround(map) {
  const c = canvas(map.W * T, map.H * T);
  const g = c.getContext("2d");
  const tile = canvas(T, T), tg = tile.getContext("2d");
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    (PAINT[map.ground[y][x]] || PAINT.g)(tg, rng(x * 131 + y * 7919 + 1));
    g.drawImage(tile, x * T, y * T);
  }
  return c;
}
