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

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "string" ? mat(color) : color);
const cyl = (rt, rb, h, color, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === "string" ? mat(color) : color);
const ball = (r, color, seg = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), typeof color === "string" ? mat(color) : color);
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

function stripes(a, b) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 2;
  const g = c.getContext("2d");
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 4, 0, 4, 2); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t });
}

// ---------- the town ----------

export function buildTown(scene) {
  const tex = new THREE.CanvasTexture(paintGround(map));
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(globe);

  // walls: one block per wall tile, wood or stone, with a lighter top
  const walls = { w: { body: mat("#a8703f"), cap: mat("#d09a62") }, v: { body: mat("#9a948a"), cap: mat("#c4beb4") } };
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const t = map.ground[y][x];
    if (t === "w" || t === "v") {
      const g = new THREE.Group();
      const s = placeOn(g, x + 0.5, y + 0.5);
      g.add(at(box(s.width, 0.6, 1, walls[t].body), 0, 0.3, 0));
      g.add(at(box(s.width + 0.04, 0.1, 1.04, walls[t].cap), 0, 0.65, 0));
      scene.add(g);
    } else if (t === "t") {
      scene.add(tree(x, y));
    } else if (t === "x") {
      scene.add(fence(x, y));
    }
  }
  for (const o of map.objects) scene.add(thing(o));
  return globe;
}

function tree(x, y) {
  const g = new THREE.Group();
  placeOn(g, x + 0.5, y + 0.5);
  const r = ((x * 31 + y * 17) % 7) / 7;
  const size = 0.85 + r * 0.35;
  g.add(at(cyl(0.09, 0.13, 0.5, "#8a5a32", 6), 0, 0.25, 0));
  if (r < 0.5) {
    g.add(at(ball(0.5 * size, ["#4fae4a", "#5cba52", "#46a046"][Math.floor(r * 6) % 3], 7), 0, 0.85 * size, 0));
    g.add(at(ball(0.3 * size, "#6ccc5c", 6), 0.18, 1.05 * size, 0.15));
  } else {
    g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.5 * size, 0.8 * size, 7), mat("#3f9a54")), 0, 0.75 * size, 0));
    g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.38 * size, 0.6 * size, 7), mat("#4cae5e")), 0, 1.15 * size, 0));
  }
  g.rotation.y = r * 6;
  return g;
}

function fence(x, y) {
  const g = new THREE.Group();
  const s = placeOn(g, x + 0.5, y + 0.5);
  const isF = (xx, yy) => map.ground[yy]?.[map.wrapX(xx)] === "x";
  const wood = mat("#b9854e");
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

export const LOOKS = {
  player:   { skin: "#ffd8b8", hair: "#7a4a28", shirt: "#4a7ae0", pants: "#3a3a58", boots: "#5a3a22", scarf: "#f0c040" },
  brannoc:  { skin: "#e8b48a", hair: "#4a3020", shirt: "#6a6a72", pants: "#4a3a2c", boots: "#2a2018", apron: "#8a5a32", beard: true, big: true },
  pip:      { skin: "#ffd8b0", hair: "#e8803a", shirt: "#5aba5a", pants: "#6a5a4a", boots: "#4a3020" },
  marigold: { skin: "#ffe0c8", hair: "#f4d070", shirt: "#f090b0", pants: "#8a6a7a", boots: "#6a4a3a", apron: "#ffffff", long: true },
  odo:      { skin: "#f0c8a0", hair: "#2a2424", shirt: "#8a5ab8", pants: "#3a3448", boots: "#2a2424", hat: "#5a3a22" },
  wren:     { skin: "#ffd8b8", hair: "#d0503a", shirt: "#3aa8a8", pants: "#5a4a4a", boots: "#4a3020", apron: "#f4ead8", long: true },
  silas:    { skin: "#f4d0b0", hair: "#2a2430", shirt: "#b03a3a", pants: "#2a2a34", boots: "#1e1a1a" },
  hesper:   { skin: "#f4d8c4", hair: "#f4f4fa", shirt: "#3a4a8a", pants: "#3a4a8a", boots: "#2a2a3a", robe: true, long: true },
  juniper:  { skin: "#d8a880", hair: "#5a6a30", shirt: "#7aa848", pants: "#7aa848", boots: "#5a4a30", robe: true, long: true },
};

export function makePerson(look) {
  const root = new THREE.Group();   // placed on the globe
  const body = new THREE.Group();   // turns to face where they walk, and bobs
  root.add(body);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
  root.add(shadow);

  const legs = [];
  if (look.robe) {
    body.add(at(cyl(0.17, 0.27, 0.5, look.shirt, 12), 0, 0.25, 0));
  } else {
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.08, 0.24, 0);
      hip.add(at(box(0.11, 0.18, 0.12, look.pants), 0, -0.09, 0));
      hip.add(at(box(0.12, 0.07, 0.15, look.boots), 0, -0.2, 0.02));
      body.add(hip); legs.push(hip);
    }
  }
  body.add(at(cyl(0.16, 0.2, 0.3, look.shirt, 12), 0, 0.38, 0));
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.21, 0.5, 0);
    sh.add(at(cyl(0.05, 0.05, 0.22, look.shirt, 6), 0, -0.1, 0));
    sh.add(at(ball(0.055, look.skin, 6), 0, -0.23, 0));
    sh.rotation.z = side * 0.15;
    body.add(sh); arms.push(sh);
  }
  if (look.apron) body.add(at(box(0.24, 0.26, 0.03, look.apron), 0, 0.36, 0.19));
  if (look.scarf) body.add(at(cyl(0.18, 0.18, 0.07, look.scarf, 12), 0, 0.53, 0));

  const head = new THREE.Group(); head.position.y = 0.76;
  body.add(head);
  head.add(ball(0.24, look.skin, 16));
  // hair: a cap over the top and the back of the head
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.255, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(look.hair)));
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.252, 16, 10, Math.PI, Math.PI, 0, Math.PI * (look.long ? 0.82 : 0.62)), mat(look.hair)));
  for (const side of [-1, 1]) {
    head.add(at(ball(0.035, "#2a1a1a", 6), side * 0.085, 0.0, 0.215));
    const blush = ball(0.04, mat("#ff9aa8", { transparent: true, opacity: 0.7 }), 6); blush.scale.set(1, 0.6, 0.4);
    head.add(at(blush, side * 0.14, -0.07, 0.19));
  }
  if (look.beard) head.add(at(box(0.3, 0.14, 0.1, look.hair), 0, -0.15, 0.17));
  if (look.hat) { head.add(at(cyl(0.34, 0.34, 0.03, look.hat, 14), 0, 0.17, 0)); head.add(at(cyl(0.2, 0.22, 0.2, look.hat, 12), 0, 0.28, 0)); }
  if (look.big) body.scale.setScalar(1.15);
  return { root, body, legs, arms, head };
}

// a tiny walk animation: legs and arms swing, the body bobs
export function animate(p, walking, t) {
  const swing = walking ? Math.sin(t * 11) * 0.6 : 0;
  p.legs.forEach((l, i) => (l.rotation.x = i ? swing : -swing));
  p.arms.forEach((a, i) => (a.rotation.x = i ? -swing * 0.7 : swing * 0.7));
  p.body.position.y = walking ? Math.abs(Math.sin(t * 11)) * 0.05 : Math.sin(t * 2) * 0.008;
}
