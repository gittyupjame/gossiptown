// The 3D planet: the globe, the buildings and trees on it, and the little people.
// Map tile (x, y) sits on the globe at longitude x / W and latitude y / H, so one tile is
// one unit wide at the equator.

import * as THREE from "three";
import * as map from "./map.js";
import { paintGround } from "./ground.js";

export const R = map.W / (2 * Math.PI); // radius in tiles

// Where tile coordinates land on the globe, with the local directions there:
// n points up out of the ground, east is +x on the map, south is +y on the map.
export function surface(x, y, h = 0) {
  const phi = (x / map.W) * Math.PI * 2, theta = (y / map.H) * Math.PI;
  const st = Math.sin(theta), ct = Math.cos(theta), sp = Math.sin(phi), cp = Math.cos(phi);
  const n = new THREE.Vector3(-cp * st, ct, sp * st);
  const east = new THREE.Vector3(sp, 0, cp);
  const south = new THREE.Vector3(-cp * ct, -st, sp * ct);
  return { pos: n.clone().multiplyScalar(R + h), n, east, south, width: Math.max(0.2, st) };
}

// Stand a 3D thing on the globe at a map position. Its +Y is up, +X east, +Z south.
export function placeOn(o, x, y, h = 0, turn = 0) {
  const s = surface(x, y, h);
  o.position.copy(s.pos);
  const m = new THREE.Matrix4().makeBasis(s.east, s.n, s.south);
  o.quaternion.setFromRotationMatrix(m);
  if (turn) o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
  return s;
}

// soft cartoon shading: three bands of light instead of a smooth fade
const bands = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();
const mat = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: bands, ...extra });
const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "string" ? mat(color) : color);
const cyl = (rt, rb, h, color, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === "string" ? mat(color) : color);
const ball = (r, color, seg = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, Math.max(12, seg), Math.max(10, seg - 4)), typeof color === "string" ? mat(color) : color);
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

function stripes(a, b) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 2;
  const g = c.getContext("2d");
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 4, 0, 4, 2); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshToonMaterial({ map: t, gradientMap: bands });
}

// ---------- the town ----------

export function buildTown(scene) {
  const tex = new THREE.CanvasTexture(paintGround(map));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.MeshToonMaterial({ map: tex, gradientMap: bands }));
  scene.add(globe);

  // walls: one block per wall tile, wood or stone, with a lighter top
  // each building has its own soft colour
  const WALL = { smithy: "#c9c0dc", bakery: "#ffc4d4", tavern: "#ffdca0", hall: "#b8d6f2" };
  const walls = Object.fromEntries(Object.entries(WALL).map(([k, c]) => [k, { body: mat(c), cap: mat("#fff8ef") }]));
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const t = map.ground[y][x];
    if (t === "w" || t === "v") {
      const g = new THREE.Group();
      const s = placeOn(g, x + 0.5, y + 0.5);
      const w = walls[map.zoneAt(x, y)] || walls.tavern;
      g.add(at(box(s.width, 0.6, 1, w.body), 0, 0.3, 0));
      g.add(at(box(s.width + 0.06, 0.12, 1.06, w.cap), 0, 0.66, 0));
      scene.add(g);
    } else if (t === "t") {
      scene.add(tree(x, y));
    } else if (t === "x") {
      scene.add(fence(x, y));
    }
  }
  for (const o of map.objects) scene.add(thing(o));
  // street lamps and little bushes along the ring road
  for (let x = 3; x < map.W; x += 7) for (const y of [13, 15]) {
    const xx = y === 13 ? x : x + 3;
    if (map.ground[y][map.wrapX(xx)] === "g" || map.ground[y][map.wrapX(xx)] === "b") scene.add(lamp(xx, y));
  }
  for (let y = 5; y < 23; y++) for (let x = 0; x < map.W; x++)
    if (map.ground[y][x] === "b" && (x * 7 + y * 3) % 2 === 0) scene.add(bush(x, y));
  return globe;
}

function lamp(x, y) {
  const g = new THREE.Group();
  placeOn(g, x + 0.5, y + 0.5);
  g.add(at(cyl(0.05, 0.07, 1.3, "#6a5a7a", 8), 0, 0.65, 0));
  g.add(at(ball(0.16, mat("#fff2b8", { emissive: "#ffd870", emissiveIntensity: 0.6 })), 0, 1.38, 0));
  g.add(at(cyl(0.02, 0.16, 0.1, "#6a5a7a", 8), 0, 1.52, 0));
  return g;
}

function bush(x, y) {
  const g = new THREE.Group();
  placeOn(g, x + 0.5, y + 0.5);
  g.add(at(ball(0.28, "#7ccf7a"), 0, 0.18, 0));
  g.add(at(ball(0.2, "#8edb88"), 0.2, 0.14, 0.08));
  for (const [dx, dz, c] of [[0.1, 0.22, "#ff9ab8"], [-0.15, 0.18, "#fff2a0"], [0.22, -0.05, "#ff9ab8"]]) g.add(at(ball(0.06, c, 10), dx, 0.32, dz));
  return g;
}

function tree(x, y) {
  const g = new THREE.Group();
  placeOn(g, x + 0.5, y + 0.5);
  const r = ((x * 31 + y * 17) % 7) / 7;
  const size = 0.85 + r * 0.35;
  g.add(at(cyl(0.09, 0.13, 0.5, "#8a5a32", 6), 0, 0.25, 0));
  if (r < 0.5) {
    g.add(at(ball(0.5 * size, ["#6cc46a", "#7ccf74", "#62ba66"][Math.floor(r * 6) % 3]), 0, 0.85 * size, 0));
    g.add(at(ball(0.32 * size, "#8edb84"), 0.2, 1.08 * size, 0.12));
    if (r < 0.25) for (const [dx, dz] of [[0.3, 0.3], [-0.35, 0.15], [0.05, -0.4]]) g.add(at(ball(0.07, "#ff8a8a", 10), dx, 0.9 * size, dz));
  } else {
    g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.5 * size, 0.8 * size, 12), mat("#5ab87a")), 0, 0.75 * size, 0));
    g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.38 * size, 0.6 * size, 12), mat("#6cc88a")), 0, 1.15 * size, 0));
  }
  g.rotation.y = r * 6;
  return g;
}

function fence(x, y) {
  const g = new THREE.Group();
  const s = placeOn(g, x + 0.5, y + 0.5);
  const isF = (xx, yy) => map.ground[yy]?.[map.wrapX(xx)] === "x";
  const wood = mat("#fff4ea"); // white picket fence
  g.add(at(box(0.12, 0.5, 0.12, wood), 0, 0.25, 0));
  if (isF(x - 1, y) || isF(x + 1, y)) { g.add(at(box(s.width, 0.08, 0.06, wood), 0, 0.35, 0)); g.add(at(box(s.width, 0.08, 0.06, wood), 0, 0.18, 0)); }
  if (isF(x, y - 1) || isF(x, y + 1)) { g.add(at(box(0.06, 0.08, 1, wood), 0, 0.35, 0)); g.add(at(box(0.06, 0.08, 1, wood), 0, 0.18, 0)); }
  return g;
}

function thing(o) {
  const g = new THREE.Group();
  const s = placeOn(g, o.x + o.w / 2, o.y + o.h / 2);
  const W = o.w * s.width, D = o.h;
  switch (o.kind) {
    case "well":
      g.add(at(cyl(0.75, 0.8, 0.5, "#b8b2a8", 14), 0, 0.25, 0));
      g.add(at(cyl(0.6, 0.6, 0.06, "#4aa0e0", 14), 0, 0.46, 0));
      g.add(at(box(0.1, 1.1, 0.1, "#8a5a32"), -0.65, 0.75, 0));
      g.add(at(box(0.1, 1.1, 0.1, "#8a5a32"), 0.65, 0.75, 0));
      { const roof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.5, 4), mat("#c8594a")); roof.rotation.y = Math.PI / 4; g.add(at(roof, 0, 1.5, 0)); }
      g.add(at(cyl(0.12, 0.1, 0.18, "#8a5a32", 8), 0.0, 0.95, 0));
      break;
    case "stall":
      g.add(at(box(W - 0.2, 0.5, 0.8, "#a8703f"), 0, 0.25, 0));
      for (const [px, c] of [[-W / 2 + 0.3, "#e0b050"], [0, "#e06040"], [W / 2 - 0.3, "#80c050"]]) g.add(at(ball(0.13, c, 6), px, 0.58, 0));
      g.add(at(box(0.07, 1.2, 0.07, "#8a5a32"), -W / 2 + 0.15, 0.6, -0.35));
      g.add(at(box(0.07, 1.2, 0.07, "#8a5a32"), W / 2 - 0.15, 0.6, -0.35));
      { const awn = box(W, 0.08, 1.0, stripes(o.color, "#fff4e0")); awn.rotation.x = 0.25; g.add(at(awn, 0, 1.2, 0)); }
      break;
    case "anvil":
      g.add(at(box(0.3, 0.3, 0.3, "#5a4a3a"), 0, 0.15, 0));
      g.add(at(box(0.6, 0.18, 0.3, "#4a4a55"), 0, 0.38, 0));
      break;
    case "forge":
      g.add(at(box(W, 0.8, D, "#8a847c"), 0, 0.4, 0));
      g.add(at(box(W * 0.6, 0.3, 0.05, mat("#ff8030", { emissive: "#ff5010", emissiveIntensity: 0.8 })), 0, 0.35, D / 2 + 0.01));
      break;
    case "oven":
      g.add(at(box(W, 0.6, D, "#c87a50"), 0, 0.3, 0));
      g.add(at(ball(0.55, "#c87a50", 8), 0, 0.6, 0));
      g.add(at(box(0.4, 0.25, 0.05, mat("#ff9040", { emissive: "#ff6010", emissiveIntensity: 0.7 })), 0, 0.3, D / 2 + 0.01));
      break;
    case "counter":
      g.add(at(box(W, 0.6, 0.7, "#9a6a3e"), 0, 0.3, 0));
      g.add(at(box(W + 0.05, 0.08, 0.8, "#c8935a"), 0, 0.64, 0));
      g.add(at(cyl(0.08, 0.08, 0.16, "#f0f0e0", 8), -W / 4, 0.76, 0));
      break;
    case "table":
      g.add(at(box(W - 0.15, 0.08, 0.8, "#c8935a"), 0, 0.5, 0));
      g.add(at(box(0.08, 0.5, 0.08, "#8a5a32"), -W / 2 + 0.2, 0.25, 0));
      g.add(at(box(0.08, 0.5, 0.08, "#8a5a32"), W / 2 - 0.2, 0.25, 0));
      g.add(at(cyl(0.07, 0.06, 0.14, "#f0e0c0", 8), 0.1, 0.61, 0));
      break;
    case "barrel":
      g.add(at(cyl(0.32, 0.28, 0.65, "#a8703f", 10), 0, 0.33, 0));
      g.add(at(cyl(0.33, 0.33, 0.05, "#55555c", 10), 0, 0.15, 0));
      g.add(at(cyl(0.33, 0.33, 0.05, "#55555c", 10), 0, 0.5, 0));
      break;
    case "bench":
      g.add(at(box(W - 0.1, 0.08, 0.4, "#c8935a"), 0, 0.3, 0));
      g.add(at(box(0.08, 0.3, 0.3, "#8a5a32"), -W / 2 + 0.2, 0.15, 0));
      g.add(at(box(0.08, 0.3, 0.3, "#8a5a32"), W / 2 - 0.2, 0.15, 0));
      break;
    case "podium":
      g.add(at(box(W * 0.7, 0.7, 0.6, "#8a6ab0"), 0, 0.35, 0));
      g.add(at(box(0.25, 0.25, 0.05, "#ffd84a"), 0, 0.4, 0.31));
      break;
    case "house": {
      const front = o.facing === "south" ? 1 : -1; // which way the door faces
      g.add(at(box(W * 0.92, 1.0, D * 0.9, "#f4e6c8"), 0, 0.5, 0));
      // a four-sided roof: turn the cone square to the walls first, then stretch it to fit
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), mat(o.color));
      cone.rotation.y = Math.PI / 4;
      const roof = new THREE.Group(); roof.add(cone);
      roof.scale.set(W * 0.78, 0.9, D * 0.78);
      g.add(at(roof, 0, 1.45, 0));
      g.add(at(box(0.4, 0.62, 0.05, "#8a5a32"), 0, 0.31, front * D * 0.45));
      g.add(at(box(0.3, 0.3, 0.05, "#7ac0f0"), -W * 0.3, 0.6, front * D * 0.45));
      g.add(at(box(0.3, 0.3, 0.05, "#7ac0f0"), W * 0.3, 0.6, front * D * 0.45));
      g.add(at(box(0.18, 0.5, 0.18, "#9a8a80"), W * 0.25, 1.7, -front * 0.2));
      break;
    }
  }
  return g;
}

// ---------- people ----------
// Everyone in town is a woman. Each has her own hair, dress and one small detail.
//   hair style: bob, long, bun, ponytail, pigtails, short

export const LOOKS = {
  player:   { skin: "#ffdcc4", hair: "#8a5a3a", style: "long", dress: "#7aa8ec", trim: "#ffffff", bow: "#ff8fab" },
  brenna:   { skin: "#eab48e", hair: "#6a4028", style: "short", dress: "#8a8fa8", trim: "#5a4a3a", apron: "#a8784a", band: "#e0604a", big: true },
  pippa:    { skin: "#ffd8b8", hair: "#f0904a", style: "pigtails", dress: "#7ccf7a", trim: "#ffffff" },
  marigold: { skin: "#ffe2cc", hair: "#f6d47a", style: "bun", dress: "#f8a8c0", trim: "#ffffff", apron: "#ffffff" },
  odette:   { skin: "#f2cca8", hair: "#3a2e3a", style: "long", dress: "#a07ad0", trim: "#ffd86a", hat: "#6a4a7a" },
  wren:     { skin: "#ffdcc4", hair: "#d8604a", style: "ponytail", dress: "#5ec0c0", trim: "#ffffff", apron: "#fff4e4" },
  sylvie:   { skin: "#f4d4b8", hair: "#3a3048", style: "bob", dress: "#d86a7a", trim: "#3a3048" },
  hesper:   { skin: "#f4dccc", hair: "#f6f4fa", style: "bun", dress: "#5a6ab8", trim: "#ffd86a", long: true },
  juniper:  { skin: "#dcac84", hair: "#7a8a40", style: "long", dress: "#9acb6a", trim: "#ffffff", flower: "#ff9ab8" },
};

export function makePerson(look) {
  const root = new THREE.Group();   // placed on the globe
  const body = new THREE.Group();   // turns to face where she walks, and bobs
  root.add(body);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: "#5a4636", transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
  root.add(shadow);

  // little legs under a bell-shaped dress
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.07, 0.2, 0);
    hip.add(at(cyl(0.045, 0.045, 0.16, look.skin, 8), 0, -0.1, 0));
    hip.add(at(ball(0.06, "#6a4a3a"), 0, -0.18, 0.02));
    body.add(hip); legs.push(hip);
  }
  body.add(at(cyl(0.13, look.long ? 0.27 : 0.24, look.long ? 0.42 : 0.34, look.dress, 20), 0, look.long ? 0.3 : 0.33, 0));
  body.add(at(cyl(look.long ? 0.272 : 0.242, look.long ? 0.272 : 0.242, 0.04, look.trim, 20), 0, look.long ? 0.1 : 0.17, 0));
  if (look.apron) body.add(at(box(0.2, 0.22, 0.03, look.apron), 0, 0.3, 0.19));
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.15, 0.47, 0);
    sh.add(at(cyl(0.04, 0.045, 0.18, look.dress, 8), 0, -0.08, 0));
    sh.add(at(ball(0.05, look.skin), 0, -0.19, 0));
    sh.rotation.z = side * 0.25;
    body.add(sh); arms.push(sh);
  }

  // a big round head
  const head = new THREE.Group(); head.position.y = 0.76;
  body.add(head);
  head.add(ball(0.27, look.skin, 24));
  const hair = mat(look.hair);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.285, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.38), hair));
  const backLen = { short: 0.55, bob: 0.68, long: 0.8, bun: 0.6, ponytail: 0.6, pigtails: 0.62 }[look.style] ?? 0.6;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.282, 24, 14, Math.PI, Math.PI, 0, Math.PI * backLen), hair));
  if (look.style === "bob") for (const side of [-1, 1]) head.add(at(box(0.08, 0.26, 0.2, hair), side * 0.25, -0.06, -0.02));
  if (look.style === "long") { head.add(at(box(0.5, 0.42, 0.12, hair), 0, -0.24, -0.17)); for (const side of [-1, 1]) head.add(at(box(0.07, 0.36, 0.16, hair), side * 0.25, -0.16, -0.04)); }
  if (look.style === "bun") head.add(at(ball(0.13, hair), 0, 0.27, -0.06));
  if (look.style === "ponytail") { head.add(at(ball(0.07, look.trim === "#ffffff" ? "#ff8fab" : look.trim), 0, 0.1, -0.27)); const tail = ball(0.12, hair); tail.scale.set(0.8, 1.6, 0.8); head.add(at(tail, 0, -0.08, -0.33)); }
  if (look.style === "pigtails") for (const side of [-1, 1]) { const tail = ball(0.1, hair); tail.scale.set(0.8, 1.4, 0.8); head.add(at(tail, side * 0.3, -0.05, -0.05)); }
  // fringe over the forehead
  { const fringe = ball(0.2, hair); fringe.scale.set(1.2, 0.45, 0.6); head.add(at(fringe, 0, 0.17, 0.15)); }
  // big eyes with a shine, rosy cheeks, a tiny smile
  for (const side of [-1, 1]) {
    const eye = ball(0.045, "#3a2a2a"); eye.scale.set(0.85, 1.15, 0.5);
    head.add(at(eye, side * 0.095, 0.0, 0.245));
    head.add(at(ball(0.014, new THREE.MeshBasicMaterial({ color: "#ffffff" })), side * 0.095 + 0.012, 0.022, 0.265));
    const blush = ball(0.045, mat("#ff9aa8", { transparent: true, opacity: 0.75 })); blush.scale.set(1.1, 0.6, 0.3);
    head.add(at(blush, side * 0.16, -0.07, 0.215));
  }
  { const smile = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), mat("#8a4a3a")); smile.rotation.z = Math.PI; head.add(at(smile, 0, -0.07, 0.262)); }
  if (look.bow) { for (const side of [-1, 1]) { const b = ball(0.07, look.bow); b.scale.set(1.2, 0.8, 0.5); head.add(at(b, side * 0.08, 0.26, 0.05)); } head.add(at(ball(0.035, look.bow), 0, 0.26, 0.06)); }
  if (look.band) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.025, 8, 24), mat(look.band)); band.rotation.x = Math.PI / 2 - 0.3; head.add(at(band, 0, 0.12, 0)); }
  if (look.flower) for (const [dx, dy] of [[0, 0.05], [0.05, 0], [-0.05, 0], [0, -0.05]]) head.add(at(ball(0.04, look.flower), 0.2 + dx, 0.17 + dy, 0.12));
  if (look.hat) { head.add(at(cyl(0.38, 0.38, 0.03, look.hat, 24), 0, 0.2, 0)); head.add(at(cyl(0.2, 0.24, 0.2, look.hat, 20), 0, 0.31, 0)); head.add(at(cyl(0.245, 0.245, 0.05, look.trim, 20), 0, 0.24, 0)); }
  if (look.big) body.scale.setScalar(1.1);
  return { root, body, legs, arms, head };
}

// a tiny walk animation: legs and arms swing, she bobs along
export function animate(p, walking, t) {
  const swing = walking ? Math.sin(t * 7) * 0.5 : 0;
  p.legs.forEach((l, i) => (l.rotation.x = i ? swing : -swing));
  p.arms.forEach((a, i) => (a.rotation.x = i ? -swing * 0.6 : swing * 0.6));
  p.body.position.y = walking ? Math.abs(Math.sin(t * 7)) * 0.035 : Math.sin(t * 1.6) * 0.008;
  p.head.rotation.z = walking ? Math.sin(t * 3.5) * 0.05 : Math.sin(t * 0.8) * 0.03;
}
