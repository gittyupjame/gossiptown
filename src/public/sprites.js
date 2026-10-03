// Pixel art drawn in code: ground tiles, objects, and people. Everything is 16x16
// pixels per tile and gets scaled up with smoothing turned off.

export const T = 16;

const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// a fixed pseudo-random number for a tile, so the grass looks the same every frame
function rng(seed) {
  let x = seed * 2654435761 >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// ---------- ground ----------

function speckle(g, base, dots, r, n) {
  g.fillStyle = base; g.fillRect(0, 0, T, T);
  for (let i = 0; i < n; i++) { g.fillStyle = dots[Math.floor(r() * dots.length)]; g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1); }
}

const GROUND = {
  g(g, r) {
    speckle(g, "#5d9a45", ["#528a3c", "#6aa851", "#4f8338"], r, 26);
    if (r() < 0.35) { const x = 2 + Math.floor(r() * 11), y = 3 + Math.floor(r() * 10); g.fillStyle = "#47782f"; g.fillRect(x, y, 1, 2); g.fillRect(x + 2, y, 1, 2); g.fillRect(x + 1, y - 1, 1, 3); }
  },
  p(g, r) { speckle(g, "#c49a64", ["#b58a55", "#d1a970", "#a87e4b"], r, 22); },
  c(g, r) {
    g.fillStyle = "#8f8a84"; g.fillRect(0, 0, T, T);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 4; col++) {
      const x = col * 4 + (row % 2 ? 2 : 0), y = row * 4;
      const shade = ["#a8a39c", "#9e9993", "#b3aea6"][Math.floor(r() * 3)];
      g.fillStyle = shade; g.fillRect(x + 1, y + 1, 3, 3);
    }
  },
  f(g) {
    g.fillStyle = "#a9733f"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#8d5e31";
    for (let y = 3; y < T; y += 4) g.fillRect(0, y, T, 1);
    g.fillRect(5, 0, 1, 3); g.fillRect(12, 4, 1, 3); g.fillRect(3, 8, 1, 3); g.fillRect(10, 12, 1, 3);
    g.fillStyle = "#b9824b"; g.fillRect(0, 0, T, 1);
  },
  s(g) {
    g.fillStyle = "#8a847c"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#77716a"; g.fillRect(0, 7, T, 1); g.fillRect(7, 0, 1, 7); g.fillRect(15, 8, 1, 8);
    g.fillStyle = "#958f87"; g.fillRect(1, 1, 5, 1); g.fillRect(9, 9, 5, 1);
  },
  d(g) { GROUND.f(g); g.fillStyle = "#6b4423"; g.fillRect(0, 13, T, 3); },
  w(g, r, wall) { wallTile(g, wall, "#7b5232", "#94663f", "#5a3a22"); },
  v(g, r, wall) { wallTile(g, wall, "#77736e", "#8f8a84", "#5a5652"); },
  t(g, r) {
    GROUND.g(g, r);
    g.fillStyle = "#5b3a1e"; g.fillRect(7, 11, 3, 4);
    g.fillStyle = "#2f5e2a"; circle(g, 8, 7, 6.5);
    g.fillStyle = "#3d7a33"; circle(g, 7, 6, 5);
    g.fillStyle = "#56963f"; circle(g, 6, 5, 2.5);
  },
  x(g, r) {
    GROUND.g(g, r);
    g.fillStyle = "#7a5530"; g.fillRect(0, 6, T, 2); g.fillRect(0, 11, T, 2);
    g.fillStyle = "#6a4523"; g.fillRect(2, 4, 2, 11); g.fillRect(11, 4, 2, 11);
  },
  h(g, r) {
    g.fillStyle = "#6e4a2c"; g.fillRect(0, 0, T, T);
    g.fillStyle = "#5c3d24"; for (let i = 0; i < 12; i++) g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1);
    for (let x = 1; x < T; x += 5) {
      const c = ["#4f9a3c", "#6fb04a", "#8a6fb8"][Math.floor(r() * 3)];
      g.fillStyle = "#3e7a2c"; g.fillRect(x + 1, 6, 1, 6);
      g.fillStyle = c; g.fillRect(x, 3, 3, 4); g.fillRect(x + 1, 2, 1, 1);
    }
  },
  b(g, r) {
    GROUND.g(g, r);
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12);
      g.fillStyle = ["#e8d14a", "#e86a8a", "#f2f2f2", "#9a7ae0"][Math.floor(r() * 4)];
      g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
      g.fillStyle = "#c9a227"; g.fillRect(x, y, 1, 1);
    }
  },
};

function circle(g, cx, cy, rad) {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad) g.fillRect(x, y, 1, 1);
}

// walls: the face of the wall is lit, and a wall with floor below it shows its front
function wallTile(g, info, base, light, dark) {
  g.fillStyle = base; g.fillRect(0, 0, T, T);
  g.fillStyle = dark;
  for (let y = 4; y < T; y += 5) g.fillRect(0, y, T, 1);
  for (let y = 0; y < T; y += 5) { const off = (y / 5) % 2 ? 4 : 0; for (let x = off; x < T; x += 8) g.fillRect(x, y, 1, 4); }
  if (info.topOpen) { g.fillStyle = light; g.fillRect(0, 0, T, 3); g.fillStyle = dark; g.fillRect(0, 3, T, 1); }
  if (info.floorBelow) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 12, T, 4); }
}

// ---------- objects ----------

function drawObject(g, o) {
  const X = o.x * T, Y = o.y * T, Wd = o.w * T, Ht = o.h * T;
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(X + x, Y + y, w, h); };
  switch (o.kind) {
    case "well":
      R("#5a5652", 2, 4, 28, 26); R("#8f8a84", 3, 5, 26, 24); R("#2c4f7a", 7, 9, 18, 16); R("#3e6a9e", 9, 11, 10, 6);
      R("#5b3a1e", 3, 0, 3, 18); R("#5b3a1e", 26, 0, 3, 18); R("#7a4f2a", 1, 0, 30, 4); R("#8f5e33", 1, 0, 30, 1);
      break;
    case "stall":
      R("#6a4523", 2, 6, Wd - 4, 10); R("#8a5e33", 2, 6, Wd - 4, 2);
      for (let x = 0; x < Wd; x += 8) { R(o.color, x, 0, 4, 6); R("#f0e6d0", x + 4, 0, 4, 6); }
      R("#e0b050", 6, 9, 4, 3); R("#c04030", 14, 9, 4, 3); R("#70a040", 24, 9, 4, 3); R("#e0b050", 36, 9, 4, 3);
      break;
    case "anvil":
      R("#3a3a40", 2, 6, 12, 4); R("#55555c", 2, 6, 12, 1); R("#3a3a40", 5, 10, 6, 3); R("#2a2a30", 3, 13, 10, 2);
      break;
    case "forge":
      R("#5a5652", 0, 0, Wd, Ht); R("#77736e", 0, 0, Wd, 2); R("#2a1a10", 6, 5, Wd - 12, 9); R("#e05a20", 8, 8, Wd - 16, 5); R("#f5c040", 11, 10, Wd - 22, 2);
      break;
    case "oven":
      R("#9a5a3a", 0, 0, Wd, Ht); R("#b06a45", 0, 0, Wd, 2); R("#2a1a10", 8, 5, Wd - 16, 9); R("#e07a30", 10, 10, Wd - 20, 3);
      break;
    case "counter":
      R("#6a4523", 0, 3, Wd, Ht - 3); R("#8f5e33", 0, 2, Wd, 3); R("#4e321a", 0, Ht - 2, Wd, 2);
      R("#e8d8b0", 4, 0, 4, 3); R("#c08040", Wd - 10, 0, 5, 3);
      break;
    case "table":
      R("#8f5e33", 1, 3, Wd - 2, 8); R("#a87040", 1, 3, Wd - 2, 2); R("#5a3a1e", 2, 11, 2, 4); R("#5a3a1e", Wd - 4, 11, 2, 4);
      R("#e8e0c8", 5, 5, 4, 3);
      break;
    case "barrel":
      R("#7a4f2a", 2, 2, 12, 13); R("#94663f", 3, 2, 10, 2); R("#3a3a40", 2, 5, 12, 1); R("#3a3a40", 2, 11, 12, 1);
      break;
    case "bench":
      R("#8f5e33", 0, 5, Wd, 4); R("#a87040", 0, 5, Wd, 1); R("#5a3a1e", 2, 9, 2, 5); R("#5a3a1e", Wd - 4, 9, 2, 5);
      break;
    case "podium":
      R("#5a3a5e", 2, 2, Wd - 4, 12); R("#7a5a7e", 2, 2, Wd - 4, 2); R("#e8d14a", Wd / 2 - 2, 6, 4, 4);
      break;
    case "house": {
      // roof over the top two rows, a wall with a door and windows on the bottom row
      R("#d8c8a0", 0, 2 * T, Wd, T); R("#b8a880", 0, 2 * T, Wd, 2);
      R("#5a3a1e", T + 4, 2 * T + 3, T * 2 - 8, T - 3); R("#e8c860", T * 2 + 3, 2 * T + 9, 2, 2);
      R("#3a5a7a", 3, 2 * T + 4, 8, 6); R("#3a5a7a", Wd - 11, 2 * T + 4, 8, 6);
      R(o.color, -2, 0, Wd + 4, 2 * T + 2);
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let y = 3; y < 2 * T; y += 4) g.fillRect(X - 2, Y + y, Wd + 4, 1);
      R("rgba(255,255,255,0.18)", -2, 0, Wd + 4, 2);
      R("rgba(0,0,0,0.3)", -2, 2 * T, Wd + 4, 2);
      R("#6a5a50", Wd - 12, -6, 5, 8);
      break;
    }
  }
}

export function drawTown(map) {
  const c = canvas(map.W * T, map.H * T);
  const g = c.getContext("2d");
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const t = map.ground[y][x];
    const tile = canvas(T, T), tg = tile.getContext("2d");
    const isWall = t === "w" || t === "v";
    const info = isWall ? { topOpen: y === 0 || !(map.ground[y - 1][x] === "w" || map.ground[y - 1][x] === "v"), floorBelow: y + 1 < map.H && ["f", "s"].includes(map.ground[y + 1][x]) } : null;
    (GROUND[t] || GROUND.g)(tg, rng(x * 131 + y * 7919 + 1), info);
    g.drawImage(tile, x * T, y * T);
  }
  // soft shadow on floors just below a wall
  g.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 1; y < map.H; y++) for (let x = 0; x < map.W; x++)
    if (["f", "s", "d"].includes(map.ground[y][x]) && ["w", "v"].includes(map.ground[y - 1][x])) g.fillRect(x * T, y * T, T, 4);
  for (const o of map.objects) drawObject(g, o);
  // signs over the doors
  return c;
}

// ---------- people ----------

export const LOOKS = {
  player:   { skin: "#f0c8a0", hair: "#6a4426", shirt: "#3a6ac0", pants: "#3a3a50", boots: "#4a3020", cloak: "#2a4a8a" },
  brannoc:  { skin: "#d8a47a", hair: "#3a2a1e", shirt: "#5a5a60", pants: "#3a3028", boots: "#2a2018", apron: "#7a4f2a", beard: true, big: true },
  pip:      { skin: "#f2c9a0", hair: "#d0702a", shirt: "#4a9a4a", pants: "#5a4a3a", boots: "#3a2a1e" },
  marigold: { skin: "#f4d0b0", hair: "#e8c860", shirt: "#d880a0", pants: "#7a5a6a", boots: "#5a3a2a", apron: "#f2eee0", long: true },
  odo:      { skin: "#e0b890", hair: "#1e1a1a", shirt: "#7a4fa0", pants: "#2e2a3a", boots: "#1e1a1a", hat: "#4a3020" },
  wren:     { skin: "#f0c8a0", hair: "#b8402a", shirt: "#2a8a8a", pants: "#4a3a3a", boots: "#3a2a1e", apron: "#e8e0c8", long: true },
  silas:    { skin: "#e8c4a0", hair: "#2a2028", shirt: "#8a2a2a", pants: "#2a2a30", boots: "#1e1a1a" },
  hesper:   { skin: "#e8c8b0", hair: "#e8e8f0", shirt: "#2e3a6a", pants: "#2e3a6a", boots: "#1e1a2a", robe: true, long: true },
  juniper:  { skin: "#c89a70", hair: "#4a5a2a", shirt: "#6a8a3a", pants: "#6a8a3a", boots: "#4a3a2a", robe: true, long: true },
};

// dir: 0 down, 1 up, 2 left, 3 right. frame: 0 standing, 1 and 2 walking steps.
function drawPerson(g, p, dir, frame) {
  const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const side = dir >= 2;
  const step = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const bob = frame ? 0 : 0;
  // legs
  if (p.robe) {
    R(p.shirt, 4, 10, 8, 4); R(p.boots, 5 + (step > 0 ? 1 : 0), 14, 2, 1); R(p.boots, 9 - (step < 0 ? 1 : 0), 14, 2, 1);
  } else if (!side) {
    R(p.pants, 5, 11, 2, step === 1 ? 2 : 3); R(p.pants, 9, 11, 2, step === -1 ? 2 : 3);
    R(p.boots, 5, step === 1 ? 13 : 14, 2, 1); R(p.boots, 9, step === -1 ? 13 : 14, 2, 1);
  } else if (step === 0) {
    R(p.pants, 6, 11, 4, 3); R(p.boots, 6, 14, 4, 1);
  } else {
    R(p.pants, 5, 11, 2, 3); R(p.pants, 9, 11, 2, 3); R(p.boots, 4, 14, 3, 1); R(p.boots, 9, 14, 3, 1);
  }
  // body
  const bx = side ? 5 : 4, bw = side ? 6 : 8;
  if (p.cloak && dir === 1) R(p.cloak, 4, 6, 8, 7);
  R(p.shirt, bx, 6 + bob, bw, 5);
  if (p.big) R(p.shirt, bx - 1, 6, bw + 2, 4);
  if (!side) {
    R(p.shirt, 3, 7, 1, 3); R(p.shirt, 12, 7, 1, 3); R(p.skin, 3, 10, 1, 1); R(p.skin, 12, 10, 1, 1);
  } else {
    const ax = 7 + step;
    R(p.shirt, ax, 7, 2, 3); R(p.skin, ax, 10, 2, 1);
  }
  if (p.apron && dir !== 1) R(p.apron, side ? (dir === 2 ? 5 : 8) : 5, 8, side ? 3 : 6, 4);
  if (p.cloak && dir !== 1) { R(p.cloak, bx, 6, 1, 6); R(p.cloak, bx + bw - 1, 6, 1, 6); }
  // head
  R(p.skin, 5, 1, 6, 5);
  if (dir === 1) {
    R(p.hair, 4, 0, 8, 6);
    if (p.long) R(p.hair, 4, 6, 8, 2);
  } else if (dir === 0) {
    R(p.hair, 4, 0, 8, 2); R(p.hair, 4, 2, 1, 2); R(p.hair, 11, 2, 1, 2);
    if (p.long) { R(p.hair, 4, 2, 1, 6); R(p.hair, 11, 2, 1, 6); }
    R("#2a1a1a", 6, 3, 1, 2); R("#2a1a1a", 9, 3, 1, 2);
    if (p.beard) R(p.hair, 5, 4, 6, 3);
  } else {
    // drawn facing left; facing right is the mirror image
    R(p.hair, 5, 0, 7, 2); R(p.hair, 9, 2, 3, 3);
    if (p.long) R(p.hair, 10, 2, 2, 6);
    R("#2a1a1a", 6, 3, 1, 2);
    if (p.beard) R(p.hair, 5, 4, 4, 3);
  }
  if (p.hat) { R(p.hat, 3, 1, 10, 1); R(p.hat, 5, -1, 6, 2); }
}

// add a dark outline around the figure, which makes it read clearly on any ground
function outline(c) {
  const g = c.getContext("2d");
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data, w = c.width, h = c.height;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const add = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push([x, y]);
  g.fillStyle = "#1c1410";
  for (const [x, y] of add) g.fillRect(x, y, 1, 1);
}

// Returns frames[dir][frame] as 18x18 canvases (16x16 plus room for the outline).
export function personFrames(look) {
  const frames = [];
  for (let dir = 0; dir < 4; dir++) {
    frames.push([0, 1, 2].map((f) => {
      const c = canvas(18, 18), g = c.getContext("2d");
      g.save(); g.translate(1, 2);
      if (dir === 3) { g.translate(16, 0); g.scale(-1, 1); }
      drawPerson(g, look, dir === 3 ? 2 : dir, f);
      g.restore();
      outline(c);
      return c;
    }));
  }
  return frames;
}
