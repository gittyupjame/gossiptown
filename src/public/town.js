// The town in 3D: painted ground, water, buildings with signs and awnings, trees,
// lamps, the fountain, the gazebo stage, and all the little things in between.
// Three.js units are map tiles: x is east, z is south (map y), y is up.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as map from "./map.js";

// ---------- materials and small helpers ----------

export const bands = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 235, 235, 235, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();
const cache = new Map();
export const toon = (color, extra = {}) => {
  const key = color + JSON.stringify(extra);
  if (!extra.map && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: bands, ...extra });
  if (!extra.map) cache.set(key, m);
  return m;
};
export const OUTLINE = new THREE.MeshBasicMaterial({ color: "#5a4048", side: THREE.BackSide });

const mesh = (geo, mat, { cast = true, receive = false } = {}) => {
  const m = new THREE.Mesh(geo, typeof mat === "string" ? toon(mat) : mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
};
export const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
// a dark shell just behind a shape, which reads as a cartoon outline
export function outline(m, k = 0.045) {
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.scale.setScalar(1 + k);
  o.castShadow = false;
  m.add(o);
  return m;
}
const rbox = (w, h, d, color, r = 0.08) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), color);
const box = (w, h, d, color) => mesh(new THREE.BoxGeometry(w, h, d), color);
const cyl = (rt, rb, h, color, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), color);
const ball = (r, color, seg = 16) => mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), color);
const cone = (r, h, color, seg = 16) => mesh(new THREE.ConeGeometry(r, h, seg), color);

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const stripes = (a, b, n = 6) => canvasTex(64, 8, (g, w, h) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * w) / n, 0, w / n + 1, h); } });

function signTex(text, bg, fg) {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 34); g.fill();
    g.strokeStyle = fg; g.lineWidth = 6; g.beginPath(); g.roundRect(14, 14, w - 28, h - 28, 26); g.stroke();
    g.fillStyle = fg; g.font = `600 ${text.length > 14 ? 50 : 60}px Fredoka, ui-rounded, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

// ---------- the ground ----------

const PX = 32; // pixels per tile on the ground picture
function rng(seed) { let x = seed * 2654435761 >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

function paintGround() {
  return canvasTex(map.W * PX, map.H * PX, (g, w, h) => {
    const r = rng(7);
    // grass with soft patches of lighter and darker green
    g.fillStyle = "#a4d982"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = ["rgba(140,206,110,0.35)", "rgba(184,232,140,0.35)", "rgba(126,192,98,0.3)"][Math.floor(r() * 3)];
      grd.addColorStop(0, c); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const tiles = (t) => { const out = []; for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) if (map.ground[y][x] === t) out.push([x, y]); return out; };
    // round blobs per tile, so paths and patios have soft, rounded edges
    const blobs = (list, color, grow = 0.62) => { g.fillStyle = color; for (const [x, y] of list) { g.beginPath(); g.roundRect((x + 0.5 - grow) * PX, (y + 0.5 - grow) * PX, grow * 2 * PX, grow * 2 * PX, PX * 0.45); g.fill(); } };
    blobs(tiles("n"), "#f6e2b2", 0.75);
    blobs(tiles("p"), "#e2cfae", 0.66); blobs(tiles("p"), "#f3e6cc", 0.56);
    for (const [x, y] of tiles("p")) for (let i = 0; i < 3; i++) { g.fillStyle = r() < 0.5 ? "#e9dcc0" : "#fbf2e0"; g.beginPath(); g.ellipse((x + r()) * PX, (y + r()) * PX, 3 + r() * 4, 2 + r() * 3, r() * 3, 0, 7); g.fill(); }
    // plaza cobbles
    blobs(tiles("c"), "#d8ccc4", 0.62);
    for (const [x, y] of tiles("c")) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = ["#f2ebe6", "#ece2dc", "#f8f2ee", "#e6dcd8"][Math.floor(r() * 4)];
      g.beginPath(); g.roundRect(x * PX + i * 8 + 1 + (j % 2) * 3, y * PX + j * 8 + 1, 6, 6, 2.5); g.fill();
    }
    // a pink rose pattern in the middle of the square
    g.strokeStyle = "rgba(244,166,190,0.75)"; g.lineWidth = 7;
    for (const rad of [3.6, 4.6]) { g.beginPath(); g.arc(32 * PX, 25 * PX, rad * PX, 0, Math.PI * 2); g.stroke(); }
    // patio tiles
    blobs(tiles("k"), "#f0d4cc", 0.6);
    for (const [x, y] of tiles("k")) { g.fillStyle = (x + y) % 2 ? "#fff6ee" : "#ffe4ea"; g.fillRect(x * PX + 1.5, y * PX + 1.5, PX - 3, PX - 3); }
    // wooden deck
    for (const [x, y] of tiles("d")) {
      g.fillStyle = "#e0b088"; g.fillRect(x * PX, y * PX, PX, PX);
      g.fillStyle = "#c8946c"; for (let i = 0; i < 4; i++) g.fillRect(x * PX, y * PX + i * 8, PX, 1.5);
      g.fillStyle = "#ecc29c"; g.fillRect(x * PX + ((y * 7) % 4) * 8, y * PX + 2, 1.5, 5);
    }
    // soft shade under and around buildings, so they sit on the ground
    for (const o of map.objects) if (o.kind === "building") {
      const grd = g.createLinearGradient(0, (o.y + o.h) * PX, 0, (o.y + o.h + 0.9) * PX);
      grd.addColorStop(0, "rgba(70,50,60,0.22)"); grd.addColorStop(1, "rgba(70,50,60,0)");
      g.fillStyle = grd; g.fillRect((o.x - 0.2) * PX, (o.y + o.h) * PX, (o.w + 0.4) * PX, 0.9 * PX);
    }
  });
}

function water(scene, x0, y0, w, h, time) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { time, size: { value: new THREE.Vector2(w, h) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; uniform vec2 size; varying vec2 vUv;
      void main() {
        vec2 p = vUv * size;
        float edge = min(min(p.x, size.x - p.x), min(p.y, size.y - p.y));
        vec3 deep = vec3(0.36, 0.71, 0.92), shallow = vec3(0.56, 0.86, 0.96);
        vec3 c = mix(shallow, deep, smoothstep(0.0, 1.4, edge));
        float wave = sin(p.x * 2.3 + time * 1.3) * sin(p.y * 3.1 - time * 0.9);
        c += vec3(0.12) * smoothstep(0.82, 1.0, wave);
        c = mix(vec3(1.0), c, smoothstep(0.05, 0.28, edge + 0.04 * sin(p.x * 6.0 + time * 2.0)));
        gl_FragColor = vec4(c, 0.96);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x0 + w / 2, 0.03, y0 + h / 2);
  m.receiveShadow = true;
  scene.add(m);
}

// grass tufts and tiny flowers scattered over the grass
function scatter(scene) {
  const r = rng(11);
  const spotsG = [];
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) if (map.ground[y][x] === "g" && !map.blocked[y][x]) spotsG.push([x, y]);
  const n = 2600;
  const tuft = new THREE.ConeGeometry(0.05, 0.22, 4);
  const grass = new THREE.InstancedMesh(tuft, toon("#ffffff"), n);
  const flowersN = 500;
  const petal = new THREE.SphereGeometry(0.06, 6, 4);
  const flowers = new THREE.InstancedMesh(petal, toon("#ffffff"), flowersN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const GREENS = ["#86c866", "#96d474", "#7aba5c", "#a8de84"].map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const [x, y] = spotsG[Math.floor(r() * spotsG.length)];
    p.set(x + r(), 0.1, y + r());
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5));
    s.setScalar(0.7 + r() * 0.8);
    grass.setMatrixAt(i, m4.compose(p, q, s));
    grass.setColorAt(i, GREENS[Math.floor(r() * GREENS.length)]);
  }
  const FL = ["#ff9ab8", "#fff07a", "#ffffff", "#b8a0ff", "#ffb07a"].map((c) => new THREE.Color(c));
  for (let i = 0; i < flowersN; i++) {
    const [x, y] = spotsG[Math.floor(r() * spotsG.length)];
    p.set(x + r(), 0.08, y + r()); q.identity(); s.setScalar(0.8 + r() * 0.6);
    flowers.setMatrixAt(i, m4.compose(p, q, s));
    flowers.setColorAt(i, FL[Math.floor(r() * FL.length)]);
  }
  scene.add(grass, flowers);
}

// ---------- the town ----------

export function buildTown(scene) {
  const time = { value: 0 };
  const glow = []; // things that light up at night: { mat, base }
  const groundMat = new THREE.MeshLambertMaterial({ map: paintGround() });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.W, map.H), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(map.W / 2, 0, map.H / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  // the land beyond the edge of the map, so the town does not float in the sky
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: "#8ccf6e" }));
  beyond.rotation.x = -Math.PI / 2; beyond.position.set(map.W / 2, -0.02, map.H / 2);
  beyond.receiveShadow = true;
  scene.add(beyond);
  water(scene, 9, 17, 6, 5, time);
  water(scene, 2, 42, map.W - 4, 2, time);
  scatter(scene);

  // everything that never moves goes in here, and is merged into a few big meshes at the end
  const root = new THREE.Group();
  scene.add(root);
  const fountainDrops = [];
  for (const o of map.objects) {
    const g = new THREE.Group();
    const add = (m) => (g.add(m), m);
    const cx = o.x + (o.w || 1) / 2, cz = o.y + (o.h || 1) / 2;
    g.position.set(cx, 0, cz);
    switch (o.kind) {
      case "building": building(g, o, glow); break;
      case "tree": tree(g, o); break;
      case "lamp": {
        add(cyl(0.05, 0.07, 1.6, "#5a5a7a", 8)).position.y = 0.8;
        add(cyl(0.12, 0.14, 0.08, "#5a5a7a", 8)).position.y = 0.04;
        const lm = toon("#fff6cc", { emissive: new THREE.Color("#ffd26a"), emissiveIntensity: 0.2 });
        glow.push({ mat: lm, base: 0.2, night: 2.2 });
        add(at(mesh(new THREE.SphereGeometry(0.17, 16, 12), lm), 0, 1.72, 0));
        add(cone(0.2, 0.16, "#5a5a7a", 8)).position.y = 1.92;
        break;
      }
      case "flowers":
        for (let i = 0; i < 5; i++) add(at(ball(0.09, ["#ff8fb0", "#fff07a", "#ffffff", "#c4a0ff"][i % 4], 8), (i % 3) * 0.22 - 0.22, 0.12, Math.floor(i / 3) * 0.22 - 0.1));
        add(at(ball(0.2, "#7cc866", 10), 0, 0.05, 0)).scale.set(1.6, 0.5, 1.3);
        break;
      case "bush":
        add(outline(at(ball(0.42, "#6cc06a", 14), 0, 0.32, 0)));
        add(at(ball(0.3, "#7ed07a", 12), 0.25, 0.42, 0.12));
        for (let i = 0; i < 4; i++) add(at(ball(0.06, "#ff9ab8", 8), Math.cos(i * 1.7) * 0.35, 0.55, Math.sin(i * 1.7) * 0.3 + 0.1));
        break;
      case "bench": {
        const w = o.w || 2;
        add(rbox(w - 0.2, 0.08, 0.42, "#e0a070", 0.03)).position.y = 0.38;
        add(at(rbox(w - 0.2, 0.3, 0.07, "#e0a070", 0.03), 0, 0.6, -0.2));
        for (const sx of [-1, 1]) add(at(box(0.07, 0.38, 0.4, "#6a5a6a"), sx * (w / 2 - 0.25), 0.19, 0));
        g.position.x = o.x + w / 2;
        break;
      }
      case "planter":
        add(outline(at(rbox(0.8, 0.5, 0.8, "#f0e6f4", 0.1), 0, 0.25, 0)));
        add(at(ball(0.36, "#78c86a", 12), 0, 0.62, 0));
        for (let i = 0; i < 6; i++) add(at(ball(0.07, ["#ff8fb0", "#ffd84f"][i % 2], 8), Math.cos(i) * 0.25, 0.85, Math.sin(i) * 0.25));
        break;
      case "fountain": fountain(g, fountainDrops); break;
      case "gazebo": gazebo(g, o, glow); break;
      case "tvcamera": {
        for (let i = 0; i < 3; i++) { const leg = add(cyl(0.025, 0.025, 1.3, "#3a3a44", 6)); leg.position.set(Math.cos(i * 2.1) * 0.2, 0.62, Math.sin(i * 2.1) * 0.2); leg.rotation.set(Math.sin(i * 2.1) * 0.25, 0, -Math.cos(i * 2.1) * 0.25); }
        const cam = add(outline(at(rbox(0.5, 0.32, 0.3, "#3a3a4a", 0.05), 0, 1.35, 0)));
        add(at(cyl(0.1, 0.12, 0.25, "#2a2a34", 12), 0, 1.35, 0.25)).rotation.x = Math.PI / 2;
        const rec = toon("#ff4a5a", { emissive: new THREE.Color("#ff2030"), emissiveIntensity: 1.2 });
        add(at(mesh(new THREE.SphereGeometry(0.04, 8, 6), rec), 0.18, 1.5, 0.1));
        g.lookAt(32, 0, 19); g.rotation.x = 0; g.rotation.z = 0;
        g.userData.blink = rec;
        void cam;
        break;
      }
      case "bunting": bunting(root, o, o.high ? 3.2 : 2.6); continue;
      case "stringlights": stringLights(root, o, glow); continue;
      case "salonchair":
        add(outline(at(rbox(0.5, 0.45, 0.5, "#ff9ac0", 0.1), 0, 0.42, 0)));
        add(at(rbox(0.5, 0.5, 0.12, "#ff9ac0", 0.06), 0, 0.85, -0.2));
        add(at(cyl(0.05, 0.12, 0.25, "#c0c0d0", 10), 0, 0.12, 0));
        add(at(mesh(new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon("#e6e0f0")), 0, 1.25, -0.12));
        break;
      case "mirror":
        add(outline(at(rbox(0.7, 1.2, 0.12, "#ffd86a", 0.1), 0, 0.9, 0)));
        add(at(rbox(0.55, 1.0, 0.04, toon("#dff2ff", { emissive: new THREE.Color("#a8d8ff"), emissiveIntensity: 0.3 }), 0.08), 0, 0.92, 0.06));
        add(at(box(0.4, 0.3, 0.3, "#ffd86a"), 0, 0.15, 0));
        break;
      case "cafetable":
        add(at(cyl(0.38, 0.38, 0.05, "#ffffff", 20), 0, 0.62, 0));
        add(at(cyl(0.04, 0.06, 0.6, "#8a8aa0", 8), 0, 0.31, 0));
        add(at(cyl(0.03, 0.03, 1.5, "#ffffff", 6), 0, 1.3, 0));
        add(outline(at(mesh(new THREE.ConeGeometry(0.9, 0.42, 12, 1, true), toon("#ffffff", { map: stripes(o.color, "#ffffff", 12), side: THREE.DoubleSide })), 0, 2.0, 0)));
        add(at(ball(0.06, "#ffffff", 8), 0, 2.24, 0));
        for (const sx of [-1, 1]) add(at(rbox(0.32, 0.4, 0.32, o.color, 0.08), sx * 0.6, 0.2, 0));
        add(at(cyl(0.06, 0.05, 0.12, "#ffffff", 10), 0.1, 0.71, 0.05));
        break;
      case "winetable":
        add(at(rbox(0.9, 0.08, 0.9, "#c8946c", 0.03), 0, 0.62, 0));
        add(at(cyl(0.05, 0.08, 0.6, "#6a4a3a", 8), 0, 0.31, 0));
        add(at(cyl(0.05, 0.06, 0.32, "#7a2a4a", 8), 0.15, 0.82, 0));
        add(at(cyl(0.05, 0.03, 0.14, toon("#ffd8e4", { transparent: true, opacity: 0.8 }), 8), -0.18, 0.73, 0.1));
        for (const sx of [-1, 1]) add(at(rbox(0.32, 0.42, 0.32, "#e8b088", 0.05), sx * 0.65, 0.21, 0));
        break;
      case "breadcart":
        add(outline(at(rbox(1.2, 0.55, 0.7, "#f4c4a0", 0.06), 0, 0.55, 0)));
        for (const sx of [-1, 1]) add(at(cyl(0.22, 0.22, 0.06, "#8a5a4a", 14), sx * 0.45, 0.22, 0.38)).rotation.x = Math.PI / 2;
        for (let i = 0; i < 4; i++) { const b = add(at(ball(0.13, "#e6a060", 10), i * 0.26 - 0.39, 0.9, 0)); b.scale.set(1.4, 0.8, 0.9); }
        add(at(mesh(new THREE.BoxGeometry(1.3, 0.06, 0.8), toon("#ffffff", { map: stripes("#f4a6b8", "#ffffff", 10) })), 0, 1.4, 0));
        for (const sx of [-1, 1]) add(at(cyl(0.025, 0.025, 0.55, "#ffffff", 6), sx * 0.6, 1.12, 0));
        break;
      case "rack":
        add(at(cyl(0.025, 0.025, 1.2, "#c8c0d8", 6), 0, 1.25, 0)).rotation.z = Math.PI / 2;
        for (const sx of [-1, 1]) add(at(cyl(0.03, 0.03, 1.25, "#c8c0d8", 6), sx * 0.6, 0.62, 0));
        ["#ff9ac0", "#b49cf0", "#ffd86a", "#7cd0c0"].forEach((c, i) => { const d = add(at(mesh(new THREE.ConeGeometry(0.18, 0.6, 10), toon(c)), -0.38 + i * 0.25, 0.92, 0)); d.castShadow = true; });
        break;
      case "mannequin":
        add(at(cyl(0.03, 0.12, 0.7, "#c8c0d8", 8), 0, 0.35, 0));
        add(outline(at(mesh(new THREE.ConeGeometry(0.3, 0.8, 16), toon("#b49cf0")), 0, 1.0, 0)));
        add(at(ball(0.13, "#f4ece6", 12), 0, 1.48, 0));
        break;
      case "mailbox":
        if (o.small) { add(at(cyl(0.03, 0.03, 0.7, "#ffffff", 6), 0, 0.35, 0)); add(outline(at(rbox(0.25, 0.22, 0.35, "#ff7a8a", 0.06), 0, 0.78, 0))); }
        else { add(outline(at(rbox(0.5, 0.9, 0.45, "#5a8ad8", 0.12), 0, 0.45, 0))); add(at(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.45, 16, 1, false, 0, Math.PI), toon("#5a8ad8")), 0, 0.9, 0)).rotation.z = Math.PI / 2; add(at(box(0.3, 0.05, 0.02, "#2a3a5a"), 0, 0.72, 0.23)); }
        break;
      case "fence": {
        const [tx] = o.to; const w = tx - o.x + 1;
        for (let i = 0; i <= w * 2; i++) add(at(rbox(0.1, 0.55, 0.06, "#ffffff", 0.03), -w / 2 + i * 0.5, 0.28, 0.4));
        add(at(box(w, 0.06, 0.04, "#ffffff"), 0, 0.35, 0.4));
        add(at(box(w, 0.06, 0.04, "#ffffff"), 0, 0.18, 0.4));
        g.position.x = o.x + w / 2;
        break;
      }
      case "flowercart":
        add(outline(at(rbox(1, 0.4, 0.6, "#a8e0a0", 0.06), 0, 0.45, 0)));
        for (const sx of [-1, 1]) add(at(cyl(0.18, 0.18, 0.05, "#6a8a5a", 12), sx * 0.38, 0.18, 0.32)).rotation.x = Math.PI / 2;
        for (let i = 0; i < 8; i++) add(at(ball(0.1, ["#ff8fb0", "#ffffff", "#ffd84f", "#c4a0ff"][i % 4], 8), (i % 4) * 0.22 - 0.33, 0.72, Math.floor(i / 4) * 0.2 - 0.1));
        break;
      case "flowerpots":
        for (let i = 0; i < 3; i++) { add(at(cyl(0.16, 0.12, 0.28, "#e0906a", 12), i * 0.35 - 0.35, 0.14, 0)); add(at(ball(0.18, "#7cc866", 10), i * 0.35 - 0.35, 0.38, 0)); add(at(ball(0.06, "#ff8fb0", 8), i * 0.35 - 0.3, 0.52, 0.06)); }
        break;
      case "pond": continue;
      case "lilypad": {
        const pad = add(at(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 14, 1, false, 0, Math.PI * 1.8), toon("#6cc06a")), 0, 0.06, 0));
        pad.castShadow = false;
        if ((o.x + o.y) % 2) add(at(ball(0.08, "#ffb0c8", 8), 0.05, 0.12, 0));
        break;
      }
    }
    root.add(g);
  }
  mergeStatic(root);
  return {
    glow, time,
    update(t, night) {
      time.value = t;
      for (const gl of glow) gl.mat.emissiveIntensity = gl.base + (gl.night - gl.base) * night;
      for (const d of fountainDrops) {
        d.userData.t = (d.userData.t + 0.016) % 1;
        const k = d.userData.t;
        d.position.set(Math.cos(d.userData.a) * k * 0.9, 1.9 + k * 0.6 - k * k * 1.6, Math.sin(d.userData.a) * k * 0.9);
      }
    },
  };
}

// A building: rounded walls, a pitched roof, a door with a sign and an awning on the front,
// and windows that glow in the evening.
function building(g, o, glow) {
  const west = o.front === "west";
  const W = west ? o.h : o.w, D = west ? o.w : o.h; // width along the front, depth back from it
  const inner = new THREE.Group();
  if (west) inner.rotation.y = -Math.PI / 2;
  g.add(inner);
  const H = o.tall ? 3.6 : o.small ? 2.0 : 2.6;
  const wall = outline(at(rbox(W - 0.2, H, D - 0.3, o.wall, 0.18), 0, H / 2, 0), 0.02);
  wall.receiveShadow = true;
  inner.add(wall);
  inner.add(at(rbox(W, 0.28, D - 0.1, o.trim, 0.06), 0, 0.14, 0));
  // roof: a long triangle, overhanging the walls
  const shape = new THREE.Shape();
  const rw = D / 2 + 0.35, rh = o.small ? 1.3 : 1.5;
  shape.moveTo(-rw, 0); shape.lineTo(0, rh); shape.lineTo(rw, 0); shape.lineTo(-rw, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: W + 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  roofGeo.translate(0, 0, -(W + 0.3) / 2);
  const roof = outline(mesh(roofGeo, o.roof), 0.02);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = H - 0.05;
  inner.add(roof);
  const front = (D - 0.3) / 2 + 0.01;
  // door
  const door = outline(at(rbox(0.9, 1.4, 0.12, "#a86a5a", 0.12), 0, 0.72, front), 0.03);
  inner.add(door);
  inner.add(at(ball(0.05, "#ffd86a", 8), 0.28, 0.72, front + 0.08));
  inner.add(at(rbox(1.1, 0.12, 0.2, o.trim, 0.04), 0, 1.48, front));
  // windows, lit at night
  const glass = toon("#cfeeff", { emissive: new THREE.Color("#ffd890"), emissiveIntensity: 0.05 });
  glow.push({ mat: glass, base: 0.05, night: 0.9 });
  const winY = o.tall ? [1.1, 2.5] : [1.1];
  const xs = o.small ? [-W / 2 + 0.75, W / 2 - 0.75] : [-W / 2 + 1.0, W / 2 - 1.0, ...(W > 8 ? [-W / 4 - 0.4, W / 4 + 0.4] : [])];
  for (const wy of winY) for (const wx of xs) {
    inner.add(at(rbox(0.82, 0.82, 0.08, o.trim, 0.08), wx, wy + 0.1, front));
    inner.add(at(rbox(0.64, 0.64, 0.06, glass, 0.06), wx, wy + 0.1, front + 0.03));
    inner.add(at(box(0.04, 0.64, 0.02, o.trim), wx, wy + 0.1, front + 0.07));
    inner.add(at(box(0.64, 0.04, 0.02, o.trim), wx, wy + 0.1, front + 0.07));
    if (wy < 2) {
      inner.add(at(rbox(0.9, 0.18, 0.25, "#c08060", 0.04), wx, wy - 0.38, front + 0.12));
      for (let i = 0; i < 4; i++) inner.add(at(ball(0.07, ["#ff8fb0", "#ffffff", "#ffd84f", "#ff8fb0"][i], 8), wx - 0.3 + i * 0.2, wy - 0.24, front + 0.15));
    }
  }
  if (o.awning) {
    const aw = new THREE.Mesh(new THREE.BoxGeometry(Math.min(W - 1, 4.2), 0.06, 1.0), toon("#ffffff", { map: stripes(o.awning[0], o.awning[1], 12) }));
    aw.castShadow = true;
    aw.position.set(0, 1.9, front + 0.45); aw.rotation.x = 0.32;
    inner.add(aw);
    for (let i = 0; i < 9; i++) inner.add(at(ball(0.07, i % 2 ? o.awning[1] : o.awning[0], 8), -Math.min(W - 1, 4.2) / 2 + 0.2 + i * (Math.min(W - 1, 4.2) - 0.4) / 8, 1.72, front + 0.93));
  }
  if (o.name) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: signTex(o.name, "#fffaf2", o.roof), transparent: true }));
    sign.position.set(0, o.tall ? 3.25 : o.awning ? 2.32 : 2.1, front + 0.06);
    inner.add(sign);
  }
  if (o.clock) {
    const tower = outline(at(rbox(1.8, 1.8, 1.8, o.wall, 0.12), 0, H + 1.4, 0), 0.02);
    inner.add(tower);
    const spire = at(cone(1.45, 1.4, o.roof, 4), 0, H + 3.0, 0); spire.rotation.y = Math.PI / 4; inner.add(spire);
    const face = at(cyl(0.6, 0.6, 0.06, "#ffffff", 24), 0, H + 1.45, 0.92); face.rotation.x = Math.PI / 2; inner.add(face);
    inner.add(at(box(0.05, 0.45, 0.03, "#4a4a6a"), 0, H + 1.6, 0.97));
    inner.add(at(box(0.32, 0.05, 0.03, "#4a4a6a"), 0.12, H + 1.45, 0.97));
    for (const sx of [-1, 1]) for (const sx2 of [-2.6, 2.6]) inner.add(at(cyl(0.14, 0.16, H - 0.2, "#ffffff", 12), sx * 0.9 + sx2 * 0 + (sx2 > 0 ? 1.6 : -1.6), (H - 0.2) / 2, front + 0.45));
  }
  if (o.small || !o.clock) inner.add(at(rbox(0.45, 0.9, 0.45, "#c8a8a0", 0.05), W / 2 - 1.0, H + 0.75, -D / 6));
}

function tree(g, o) {
  const r = rng(o.x * 31 + o.y * 17)();
  const s = (o.edge ? 1.25 : 1.0) * (0.85 + r * 0.35);
  g.position.x += (r - 0.5) * 0.3;
  g.add(outline(at(cyl(0.12 * s, 0.17 * s, 0.9 * s, "#a07050", 8), 0, 0.45 * s, 0), 0.06));
  const k = o.kind2;
  if (k === 0) { // round and fluffy
    const greens = ["#6cc46a", "#7ed27a", "#5eb862"];
    g.add(outline(at(ball(0.62 * s, greens[0], 16), 0, 1.25 * s, 0), 0.04));
    g.add(at(ball(0.45 * s, greens[1], 14), 0.35 * s, 1.5 * s, 0.15 * s));
    g.add(at(ball(0.4 * s, greens[2], 14), -0.35 * s, 1.4 * s, 0.1 * s));
    g.add(at(ball(0.32 * s, "#92de88", 12), 0.05 * s, 1.75 * s, 0.25 * s));
    if (r > 0.6) for (let i = 0; i < 5; i++) g.add(at(ball(0.07 * s, "#ff6a7a", 8), Math.cos(i * 1.3) * 0.55 * s, 1.2 * s + (i % 2) * 0.3 * s, Math.sin(i * 1.3) * 0.45 * s + 0.2 * s));
  } else if (k === 1) { // a pine
    g.add(outline(at(cone(0.7 * s, 1.0 * s, "#4eae74", 12), 0, 1.1 * s, 0), 0.04));
    g.add(at(cone(0.55 * s, 0.85 * s, "#5cc082", 12), 0, 1.6 * s, 0));
    g.add(at(cone(0.38 * s, 0.7 * s, "#6ed292", 12), 0, 2.05 * s, 0));
  } else { // cherry blossom
    g.add(outline(at(ball(0.6 * s, "#ffb4cc", 16), 0, 1.3 * s, 0), 0.04));
    g.add(at(ball(0.42 * s, "#ffc8d8", 14), 0.32 * s, 1.55 * s, 0.1 * s));
    g.add(at(ball(0.38 * s, "#ff9ec0", 14), -0.35 * s, 1.45 * s, 0.12 * s));
    g.add(at(ball(0.28 * s, "#ffd8e4", 12), 0, 1.8 * s, 0.22 * s));
  }
}

function fountain(g, drops) {
  const stone = "#f2ece8";
  g.add(outline(at(cyl(2.0, 2.15, 0.55, stone, 32), 0, 0.27, 0), 0.02));
  const water = toon("#8fd6f4", { emissive: new THREE.Color("#5ab8e8"), emissiveIntensity: 0.25 });
  g.add(at(mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.05, 32), water), 0, 0.5, 0));
  g.add(at(cyl(0.3, 0.4, 1.2, stone, 16), 0, 1.0, 0));
  g.add(outline(at(cyl(0.9, 0.5, 0.28, stone, 24), 0, 1.6, 0), 0.03));
  g.add(at(mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 24), water), 0, 1.74, 0));
  g.add(at(ball(0.2, "#ffb4cc", 14), 0, 1.95, 0));
  g.add(at(ball(0.12, "#ffffff", 10), 0, 2.15, 0));
  for (let i = 0; i < 16; i++) {
    const d = at(mesh(new THREE.SphereGeometry(0.05, 6, 4), water), 0, 2, 0);
    d.userData = { a: (i / 16) * Math.PI * 2, t: i / 16, dynamic: true };
    d.castShadow = false;
    g.add(d); drops.push(d);
  }
}

function gazebo(g, o, glow) {
  // a round wooden stage with white posts and a pink domed roof
  g.position.set(o.x + o.w / 2, 0, o.y + o.h / 2 - 0.2);
  g.add(outline(at(cyl(3.0, 3.2, 0.5, "#e8b48c", 32), 0, 0.25, 0), 0.02));
  g.add(at(cyl(3.05, 3.05, 0.08, "#ffffff", 32), 0, 0.52, 0));
  // a half-dome shell behind the stage, open at the front so everyone can see the host
  const shell = outline(at(mesh(new THREE.SphereGeometry(3.1, 40, 16, Math.PI, Math.PI, 0, Math.PI / 2), toon("#ff9ec0", { side: THREE.DoubleSide })), 0, 0.5, -0.1), 0.015);
  shell.scale.set(1, 1.05, 0.85);
  g.add(shell);
  const inside = at(mesh(new THREE.SphereGeometry(3.0, 40, 16, Math.PI, Math.PI, 0, Math.PI / 2), toon("#fff2f6", { side: THREE.BackSide })), 0, 0.5, -0.1);
  inside.scale.set(1, 1.05, 0.85);
  g.add(inside);
  for (const sx of [-1, 1]) g.add(at(cyl(0.12, 0.14, 2.8, "#ffffff", 12), sx * 3.0, 1.9, 0.1));
  for (const sx of [-1, 1]) g.add(at(ball(0.2, "#ffd86a", 12), sx * 3.0, 3.4, 0.1));
  // a banner along the front of the stage
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.7), new THREE.MeshBasicMaterial({ map: signTex("THE VOTE", "#ff6a9a", "#ffffff"), transparent: true }));
  banner.position.set(0, 0.32, 3.12);
  g.add(banner);
  // fairy lights round the roof edge
  const bulb = toon("#fff2b0", { emissive: new THREE.Color("#ffd870"), emissiveIntensity: 0.4 });
  glow.push({ mat: bulb, base: 0.4, night: 2.5 });
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI; g.add(at(mesh(new THREE.SphereGeometry(0.08, 8, 6), bulb), Math.cos(a) * 3.15, 0.5 + Math.sin(a) * 3.25, -0.1)); }
  // a little lectern for the host
  g.add(outline(at(rbox(0.7, 0.62, 0.4, "#ff9ec0", 0.08), 0, 0.85, 1.25), 0.03));
}

function catenary(a, b, sag, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * sag, a.z + (b.z - a.z) * t)); }
  return pts;
}

function bunting(scene, o, h) {
  const a = new THREE.Vector3(o.x + 0.5, h, o.y + 0.5), b = new THREE.Vector3(o.to[0] + 0.5, h, o.to[1] + 0.5);
  const pts = catenary(a, b, 0.6, 40);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#8a6a7a" })));
  for (const pa of [a, b]) { const pole = cyl(0.06, 0.07, h, "#ffffff", 8); pole.position.set(pa.x, h / 2, pa.z); scene.add(pole); }
  const COL = ["#ff8fb0", "#ffd84f", "#8fd0ff", "#b49cf0", "#7cd0a0"];
  const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0, -0.42, 0)]);
  tri.computeVertexNormals();
  for (let i = 1; i < pts.length - 1; i += 1) {
    const f = new THREE.Mesh(tri, toon(COL[i % COL.length], { side: THREE.DoubleSide }));
    f.position.copy(pts[i]); f.castShadow = true;
    scene.add(f);
  }
}

function stringLights(scene, o, glow) {
  const h = 2.6;
  const a = new THREE.Vector3(o.x + 0.5, h, o.y + 0.5), b = new THREE.Vector3(o.to[0] + 0.5, h, o.to[1] + 0.5);
  const pts = catenary(a, b, 0.5, 24);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#4a3a3a" })));
  for (const pa of [a, b]) { const pole = cyl(0.05, 0.06, h, "#6a4a3a", 8); pole.position.set(pa.x, h / 2, pa.z); scene.add(pole); }
  const bulb = toon("#fff2b0", { emissive: new THREE.Color("#ffc860"), emissiveIntensity: 0.3 });
  glow.push({ mat: bulb, base: 0.3, night: 2.6 });
  for (let i = 1; i < pts.length - 1; i++) { const m = mesh(new THREE.SphereGeometry(0.07, 8, 6), bulb); m.position.copy(pts[i]).y -= 0.08; scene.add(m); }
}

// Hundreds of small parts make hundreds of draw calls. Bake every part that never moves
// into one mesh per material, which the graphics card can draw in one go.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const done = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.dynamic || o.material.isShaderMaterial) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
    groups.get(key).geos.push(g);
    done.push(o);
  });
  for (const o of done) { const kids = o.children.filter((c) => !done.includes(c)); for (const c of kids) root.attach(c); o.removeFromParent(); }
  for (const { mat, cast, receive, geos } of groups.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), mat);
    merged.castShadow = cast; merged.receiveShadow = receive;
    root.add(merged);
  }
}
