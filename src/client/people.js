// The cast as cute chibi figures: built from simple shapes, merged per body part,
// outlined, and animated by hand (walk cycle, blinking, talking, personality idles).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon, outlineMat, renderer } from "./scene.js";
import * as L from "./layout.js";

const S = {
  sph: new THREE.SphereGeometry(1, 16, 12),
  cap: new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.CylinderGeometry(0.17, 0.34, 0.56, 20),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 28),
  box: new THREE.BoxGeometry(1, 1, 1),
};
const black = "#2a1e2a";

// A see-through silhouette for anyone standing behind a building. It draws only where
// something is already in front of it, and characters draw after it (renderOrder), so
// a visible character covers her own silhouette and only the hidden parts show.
const xrayMat = new THREE.MeshBasicMaterial({ color: "#a77bb0", side: THREE.BackSide, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });

// off during the vote ceremony, where stumps and torches would cut every close-up
export function setXray(on) { xrayMat.visible = on; }

// A part is a list of shapes that get merged into one mesh per material.
class Part {
  constructor() { this.items = []; }
  add(geo, color, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, outline = true, basic = false } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.items.push({ geo, color, m, outline, basic, s: [sx, sy, sz] });
    return this;
  }
  build() {
    const g = new THREE.Group();
    const byColor = new Map(), outlines = [];
    for (const it of this.items) {
      const key = (it.basic ? "b" : "t") + it.color;
      if (!byColor.has(key)) byColor.set(key, []);
      const geo = prep(it.geo).applyMatrix4(it.m);
      byColor.get(key).push(geo);
      if (it.outline) {
        // inverted hull: the same shape grown by a fixed amount, drawn back-faces only
        const grow = 0.022;
        const k = [1 + grow / Math.max(0.02, it.s[0]), 1 + grow / Math.max(0.02, it.s[1]), 1 + grow / Math.max(0.02, it.s[2])];
        const m2 = it.m.clone().multiply(new THREE.Matrix4().makeScale(...k));
        outlines.push(prep(it.geo).applyMatrix4(m2));
      }
    }
    for (const [key, geos] of byColor) {
      const color = key.slice(1);
      const mat = key[0] === "b" ? new THREE.MeshBasicMaterial({ color }) : toon(color);
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true;
      g.add(mesh);
    }
    if (outlines.length) {
      const hull = mergeGeometries(outlines);
      g.add(new THREE.Mesh(hull, outlineMat));
      const xray = new THREE.Mesh(hull, xrayMat);
      xray.userData.xray = true;
      g.add(xray);
    }
    return g;
  }
}
function prep(geo) {
  let g = geo.clone();
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!["position", "normal"].includes(k)) g.deleteAttribute(k);
  return g;
}

// ---------- hair ----------

function hair(p, style, c, accent) {
  const cap = (o = {}) => p.add(S.cap, c, { y: 0.03, z: -0.02, sx: 0.37, sy: 0.37, sz: 0.37, rx: -0.42, ...o });
  const back = (o = {}) => p.add(S.sph, c, { y: -0.02, z: -0.07, sx: 0.355, sy: 0.35, sz: 0.33, ...o });
  const bangs = () => {
    for (const x of [-0.17, -0.06, 0.06, 0.17]) p.add(S.sph, c, { x, y: 0.2 - Math.abs(x) * 0.25, z: 0.24 - Math.abs(x) * 0.25, sx: 0.11, sy: 0.075, sz: 0.08, rz: x * 1.2, outline: false });
  };
  const chain = (x0, y0, z0, dx, dy, dz, n, r) => { for (let i = 0; i < n; i++) p.add(S.sph, c, { x: x0 + dx * i, y: y0 + dy * i, z: z0 + dz * i, sx: r * (1 - i * 0.05), sy: r * 1.1, sz: r * (1 - i * 0.05) }); };
  cap(); back();
  switch (style) {
    case "bigcurls":
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.15 + (i / 8) * 0.7); p.add(S.sph, c, { x: Math.cos(a) * 0.36 * (i % 2 ? 1 : -1), y: -0.1 - (i % 3) * 0.12, z: -Math.sin(a) * 0.22, sx: 0.16, sy: 0.16, sz: 0.16 }); }
      p.add(S.sph, c, { y: 0.3, z: -0.04, sx: 0.3, sy: 0.2, sz: 0.3 });
      for (const x of [-0.3, 0.3]) p.add(S.sph, c, { x, y: -0.42, z: -0.08, sx: 0.14, sy: 0.16, sz: 0.14 });
      bangs(); break;
    case "bob":
      for (const s of [-1, 1]) p.add(S.sph, c, { x: s * 0.29, y: -0.13, z: 0.0, sx: 0.13, sy: 0.24, sz: 0.24 });
      p.add(S.sph, c, { y: -0.16, z: -0.12, sx: 0.36, sy: 0.24, sz: 0.28 });
      p.add(S.box, c, { y: 0.17, z: 0.24, sx: 0.5, sy: 0.12, sz: 0.12, rx: 0.4, outline: false });
      break;
    case "messybun":
      p.add(S.sph, c, { y: 0.38, z: -0.12, sx: 0.16, sy: 0.15, sz: 0.16 });
      for (const [x, y, z] of [[0.12, 0.44, -0.06], [-0.1, 0.42, -0.18], [0.27, 0.0, 0.16], [-0.27, 0.02, 0.16]]) p.add(S.sph, c, { x, y, z, sx: 0.06, sy: 0.1, sz: 0.06, rz: x * 2 });
      bangs(); break;
    case "ponytail":
      p.add(S.torus, accent, { y: 0.16, z: -0.34, sx: 0.06, sy: 0.06, sz: 0.06, rx: 0.9, outline: false });
      p.add(S.sph, c, { y: 0.02, z: -0.48, sx: 0.12, sy: 0.3, sz: 0.12, rx: 0.5 });
      p.add(S.sph, c, { y: -0.24, z: -0.56, sx: 0.09, sy: 0.16, sz: 0.09, rx: 0.2 });
      bangs(); break;
    case "braid":
      chain(0.24, -0.18, 0.02, 0.025, -0.11, 0.035, 6, 0.085);
      p.add(S.sph, accent, { x: 0.39, y: -0.84, z: 0.21, sx: 0.05, sy: 0.05, sz: 0.05, outline: false });
      bangs(); break;
    case "twintails":
      for (const s of [-1, 1]) {
        p.add(S.sph, accent, { x: s * 0.3, y: 0.1, z: -0.08, sx: 0.06, sy: 0.06, sz: 0.06, outline: false });
        p.add(S.sph, c, { x: s * 0.45, y: -0.12, z: -0.1, sx: 0.13, sy: 0.3, sz: 0.13, rz: s * 0.35 });
        p.add(S.sph, c, { x: s * 0.52, y: -0.4, z: -0.12, sx: 0.09, sy: 0.15, sz: 0.09, rz: s * 0.15 });
      }
      bangs(); break;
    case "short":
      for (const [x, z] of [[-0.2, 0.18], [0, 0.26], [0.2, 0.18]]) p.add(S.sph, c, { x, y: 0.23, z, sx: 0.12, sy: 0.08, sz: 0.1, rx: -0.4 });
      for (const s of [-1, 1]) p.add(S.sph, c, { x: s * 0.31, y: 0.0, z: 0.02, sx: 0.07, sy: 0.15, sz: 0.12 });
      break;
    case "long":
      p.add(S.sph, c, { y: -0.4, z: -0.18, sx: 0.36, sy: 0.55, sz: 0.15 });
      for (const s of [-1, 1]) p.add(S.sph, c, { x: s * 0.31, y: -0.3, z: 0.05, sx: 0.09, sy: 0.38, sz: 0.11 });
      bangs(); break;
    case "bun":
      p.add(S.sph, c, { y: 0.2, z: -0.33, sx: 0.16, sy: 0.16, sz: 0.14 });
      p.add(S.cyl, accent, { x: 0.05, y: 0.26, z: -0.36, sx: 0.012, sy: 0.4, sz: 0.012, rz: 1.1, outline: false });
      for (const x of [-0.12, 0.12]) p.add(S.sph, c, { x, y: 0.22, z: 0.25, sx: 0.15, sy: 0.07, sz: 0.08, rz: x * 2, outline: false });
      break;
    case "braids":
      for (const s of [-1, 1]) { chain(s * 0.28, -0.16, 0.08, s * 0.02, -0.105, 0.02, 6, 0.075); p.add(S.sph, accent, { x: s * 0.4, y: -0.8, z: 0.2, sx: 0.045, sy: 0.045, sz: 0.045, outline: false }); }
      p.add(S.cyl, "#e8c36a", { x: 0.18, y: 0.32, z: -0.12, sx: 0.015, sy: 0.32, sz: 0.015, rz: -1.0, outline: false });
      bangs(); break;
    case "puffs":
      for (const s of [-1, 1]) p.add(S.sph, c, { x: s * 0.27, y: 0.3, z: -0.04, sx: 0.18, sy: 0.18, sz: 0.18 });
      bangs(); break;
    case "sidebun":
      p.add(S.sph, c, { x: 0.3, y: 0.22, z: -0.1, sx: 0.16, sy: 0.16, sz: 0.16 });
      p.add(S.sph, c, { x: -0.3, y: -0.2, z: 0.05, sx: 0.08, sy: 0.25, sz: 0.1 });
      bangs(); break;
    default: bangs();
  }
}

function headAccessory(p, look, a = look.accessory) {
  if (!a) return;
  if (a === "sunglasses") { for (const s of [-1, 1]) p.add(S.sph, "#2a2a3a", { x: s * 0.11, y: 0.36, z: 0.12, sx: 0.09, sy: 0.06, sz: 0.04, rx: -0.9, outline: false }); p.add(S.box, "#2a2a3a", { y: 0.37, z: 0.14, sx: 0.08, sy: 0.02, sz: 0.02, rx: -0.9, outline: false }); }
  if (a === "earrings") for (const s of [-1, 1]) { p.add(S.sph, look.accent, { x: s * 0.33, y: -0.14, z: 0.02, sx: 0.04, sy: 0.04, sz: 0.04, outline: false }); p.add(S.sph, look.accent, { x: s * 0.33, y: -0.21, z: 0.02, sx: 0.03, sy: 0.05, sz: 0.03, outline: false }); }
  if (a === "glasses" || a === "roundglasses") {
    const r = a === "glasses" ? 0.07 : 0.088;
    for (const s of [-1, 1]) p.add(S.torus, a === "glasses" ? "#c9a85a" : "#3a2a20", { x: s * 0.12, y: -0.02, z: 0.33, sx: r, sy: r * 0.85, sz: r, outline: false });
    p.add(S.box, "#3a2a20", { y: 0.0, z: 0.34, sx: 0.07, sy: 0.012, sz: 0.012, outline: false });
  }
  if (a === "goggles") {
    p.add(S.torus, "#5a3e2a", { y: 0.17, z: -0.01, sx: 0.355, sy: 0.355, sz: 0.36, rx: Math.PI / 2 - 0.35, outline: false });
    for (const s of [-1, 1]) p.add(S.cyl, "#c98a4a", { x: s * 0.1, y: 0.25, z: 0.26, sx: 0.07, sy: 0.06, sz: 0.07, rx: Math.PI / 2 - 0.45 });
    for (const s of [-1, 1]) p.add(S.sph, "#bfe8ff", { x: s * 0.1, y: 0.265, z: 0.29, sx: 0.06, sy: 0.06, sz: 0.02, rx: -0.45, outline: false });
  }
  if (a === "cateye") {
    for (const s of [-1, 1]) p.add(S.torus, "#2a1e2a", { x: s * 0.12, y: -0.01, z: 0.33, sx: 0.08, sy: 0.06, sz: 0.08, rz: s * -0.35, outline: false });
    for (const s of [-1, 1]) p.add(S.box, "#2a1e2a", { x: s * 0.2, y: 0.03, z: 0.31, sx: 0.04, sy: 0.02, sz: 0.02, rz: s * 0.5, outline: false });
    p.add(S.box, "#2a1e2a", { y: 0.0, z: 0.34, sx: 0.07, sy: 0.012, sz: 0.012, outline: false });
  }
  if (a === "hoops") for (const s of [-1, 1]) p.add(S.torus, "#e8c36a", { x: s * 0.34, y: -0.2, z: 0.02, sx: 0.06, sy: 0.06, sz: 0.06, ry: Math.PI / 2, outline: false });
  if (a === "studs") for (const s of [-1, 1]) p.add(S.sph, "#fffaf0", { x: s * 0.34, y: -0.12, z: 0.03, sx: 0.035, sy: 0.035, sz: 0.035, outline: false });
  if (a === "chandelier") for (const s of [-1, 1]) for (let i = 0; i < 3; i++) p.add(S.sph, i === 2 ? "#cfefff" : "#e8c36a", { x: s * 0.34, y: -0.13 - i * 0.06, z: 0.03, sx: 0.03 + i * 0.01, sy: 0.03 + i * 0.012, sz: 0.03, outline: false, basic: i === 2 });
  if (a === "bow") {
    for (const s of [-1, 1]) p.add(S.sph, look.accent, { x: s * 0.13, y: 0.36, z: -0.1, sx: 0.13, sy: 0.08, sz: 0.05, rz: s * 0.3 });
    p.add(S.sph, look.accent, { y: 0.36, z: -0.09, sx: 0.05, sy: 0.05, sz: 0.05 });
  }
  if (a === "sunhat") {
    p.add(S.cyl, "#ecd28c", { y: 0.27, z: -0.02, sx: 0.62, sy: 0.025, sz: 0.62, rx: -0.12 });
    p.add(S.cap, "#ecd28c", { y: 0.26, z: -0.03, sx: 0.33, sy: 0.3, sz: 0.33, rx: -0.12 });
    p.add(S.cyl, look.accent === "#ffffff" ? look.outfit : look.accent, { y: 0.31, z: -0.03, sx: 0.335, sy: 0.05, sz: 0.335, rx: -0.12, outline: false });
  }
  if (a === "beret") p.add(S.sph, look.outfit === "#2a2430" ? "#d8283c" : "#2a2430", { x: 0.06, y: 0.33, z: -0.03, sx: 0.34, sy: 0.1, sz: 0.32, rz: -0.25, rx: -0.15 });
  if (a === "fascinator") {
    p.add(S.cyl, look.outfit, { x: 0.2, y: 0.3, z: 0.02, sx: 0.12, sy: 0.02, sz: 0.12, rz: -0.6 });
    for (let i = 0; i < 3; i++) p.add(S.capsule, "#ffffff", { x: 0.25 + i * 0.03, y: 0.42 + i * 0.02, z: -0.04 - i * 0.03, sx: 0.015, sy: 0.12, sz: 0.03, rz: -0.6 - i * 0.2, outline: false });
  }
  if (a === "tiara") for (let i = 0; i < 5; i++) { const ang = Math.PI * (0.3 + i * 0.1), big = i === 2; p.add(S.cone, "#f2d36a", { x: Math.cos(ang) * 0.27, y: 0.33 + (big ? 0.04 : 0), z: Math.sin(ang) * 0.13 + 0.02, sx: 0.12, sy: big ? 0.2 : 0.13, sz: 0.12, outline: false }); if (big) p.add(S.sph, "#ff6fa0", { x: 0, y: 0.4, z: 0.16, sx: 0.035, sy: 0.035, sz: 0.035, outline: false, basic: true }); }
  if (a === "flowercrown") for (let i = 0; i < 9; i++) { const ang = Math.PI * (0.05 + (i / 8) * 0.9); p.add(S.sph, i % 2 ? look.accent : "#ffffff", { x: Math.cos(ang) * 0.32, y: 0.22 + Math.sin(ang) * 0.04, z: Math.sin(ang) * 0.12 - 0.02, sx: 0.055, sy: 0.055, sz: 0.055, outline: false }); }
}

// ---------- outfits (the player's wardrobe) ----------

const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getStyle();
// Draws the torso and skirt for an outfit shape; returns the sleeve color.
function dressBody(bp, look) {
  const c = look.outfit, d = look.dress || "frock";
  const shoulders = (col) => bp.add(S.sph, col, { y: 0.86, sx: 0.19, sy: 0.1, sz: 0.17 });
  const straps = (col) => { for (const s of [-1, 1]) bp.add(S.box, col, { x: s * 0.09, y: 0.9, z: 0.02, sx: 0.025, sy: 0.12, sz: 0.16, outline: false }); };
  switch (d) {
    case "sundress":
      bp.add(S.cone, c, { y: 0.6 }); shoulders(look.skin); straps(c);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; bp.add(S.box, "#ffffff", { x: Math.sin(a) * 0.3, y: 0.42, z: Math.cos(a) * 0.3, sx: 0.06, sy: 0.06, sz: 0.06, ry: a, outline: false }); }
      return look.skin;
    case "peasant":
      bp.add(S.cone, c, { y: 0.6 }); shoulders("#fff6e0");
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; bp.add(S.sph, i % 2 ? "#d8283c" : "#ffd76a", { x: Math.sin(a) * 0.33, y: 0.36, z: Math.cos(a) * 0.33, sx: 0.025, sy: 0.025, sz: 0.025, outline: false }); }
      return "#fff6e0";
    case "tea":
      bp.add(S.cone, c, { y: 0.6 }); shoulders(c);
      for (let i = 0; i < 16; i++) { const a = (i * 2.4) % (Math.PI * 2), y = 0.4 + (i % 4) * 0.11, r = 0.33 - (y - 0.32) * 0.3; bp.add(S.sph, c === "#ffffff" ? "#ff8fb8" : "#ffffff", { x: Math.sin(a) * r, y, z: Math.cos(a) * r, sx: 0.025, sy: 0.025, sz: 0.012, ry: a, outline: false, basic: true }); }
      bp.add(S.torus, "#ffffff", { y: 0.92, sx: 0.08, sy: 0.08, sz: 0.08, rx: Math.PI / 2, outline: false });
      return c;
    case "suit": {
      const j = shade(c, 0.8);
      bp.add(S.cone, c, { y: 0.56, sx: 0.85, sz: 0.85, sy: 0.85 });
      bp.add(S.cyl, j, { y: 0.72, sx: 0.2, sy: 0.32, sz: 0.18 });
      shoulders(j);
      for (const s of [-1, 1]) bp.add(S.box, "#fff6e0", { x: s * 0.05, y: 0.8, z: 0.17, sx: 0.05, sy: 0.14, sz: 0.02, rz: s * 0.4, outline: false });
      for (const y of [0.7, 0.62]) bp.add(S.sph, "#e8c36a", { y, z: 0.19, sx: 0.018, sy: 0.018, sz: 0.012, outline: false });
      return j;
    }
    case "overalls": {
      const denim = "#4a6fa8";
      bp.add(S.cone, denim, { y: 0.56, sx: 0.85, sy: 0.7, sz: 0.85 });
      shoulders(c);
      bp.add(S.box, denim, { y: 0.72, z: 0.13, sx: 0.2, sy: 0.18, sz: 0.06 });
      straps(denim);
      for (const s of [-1, 1]) bp.add(S.sph, "#e8c36a", { x: s * 0.08, y: 0.79, z: 0.17, sx: 0.018, sy: 0.018, sz: 0.012, outline: false });
      return c;
    }
    case "leather": {
      const jk = "#2a2228";
      bp.add(S.cone, c, { y: 0.5, sx: 0.9, sy: 0.5, sz: 0.9 });
      bp.add(S.cyl, jk, { y: 0.74, sx: 0.2, sy: 0.3, sz: 0.18 });
      shoulders(jk);
      bp.add(S.box, c, { y: 0.76, z: 0.16, sx: 0.08, sy: 0.22, sz: 0.02, outline: false });
      bp.add(S.box, "#c0c0c8", { x: 0.06, y: 0.72, z: 0.18, sx: 0.012, sy: 0.24, sz: 0.01, outline: false });
      return jk;
    }
    case "slip":
      bp.add(S.cone, c, { y: 0.56, sx: 0.8, sy: 0.95, sz: 0.8 }); shoulders(look.skin); straps(c);
      return look.skin;
    case "sequin":
      bp.add(S.cone, c, { y: 0.6, sx: 0.92, sz: 0.92 }); shoulders(look.skin); straps(c);
      for (let i = 0; i < 40; i++) { const a = (i * 2.39996) % (Math.PI * 2), y = 0.36 + (i / 40) * 0.5, r = (0.34 - (y - 0.32) * 0.3) * 0.93; bp.add(S.sph, i % 3 ? "#fff3b0" : "#ffffff", { x: Math.sin(a) * r, y, z: Math.cos(a) * r, sx: 0.016, sy: 0.016, sz: 0.016, outline: false, basic: true }); }
      return look.skin;
    case "gown":
      bp.add(S.cone, c, { y: 0.45, sx: 1.3, sy: 1.6, sz: 1.3 });
      bp.add(S.sph, c, { y: 0.86, sx: 0.19, sy: 0.1, sz: 0.17 });
      for (const s of [-1, 1]) bp.add(S.sph, shade(c, 1.15), { x: s * 0.2, y: 0.85, sx: 0.08, sy: 0.07, sz: 0.08 });
      bp.add(S.torus, shade(c, 0.75), { y: 0.66, sx: 0.2, sy: 0.2, sz: 0.2, rx: Math.PI / 2, outline: false });
      return look.skin;
    default:
      bp.add(S.cone, c, { y: 0.6 }); shoulders(c);
      return c;
  }
}

function makeBag(look) {
  const b = new Part();
  if (look.bag === "basket") { b.add(S.cyl, "#c89a5a", { y: -0.08, sx: 0.09, sy: 0.08, sz: 0.07 }); b.add(S.torus, "#a87a3a", { y: 0.0, sx: 0.07, sy: 0.08, sz: 0.07, outline: false }); }
  if (look.bag === "tote") { b.add(S.box, "#efe2c4", { y: -0.12, z: 0.0, sx: 0.04, sy: 0.18, sz: 0.16 }); b.add(S.torus, "#efe2c4", { y: 0.0, sx: 0.06, sy: 0.07, sz: 0.06, ry: Math.PI / 2, outline: false }); }
  if (look.bag === "clutch") b.add(S.box, "#e8c36a", { y: 0.0, z: 0.05, sx: 0.05, sy: 0.08, sz: 0.15, rx: 0.2 });
  if (look.bag === "handbag") { const col = look.outfit === "#2a2430" ? "#c94a7a" : "#2a2228"; b.add(S.box, col, { y: -0.1, sx: 0.07, sy: 0.12, sz: 0.17 }); b.add(S.torus, "#e8c36a", { y: -0.03, sx: 0.06, sy: 0.06, sz: 0.06, ry: Math.PI / 2, outline: false }); b.add(S.sph, "#e8c36a", { x: 0.04, y: -0.08, sx: 0.015, sy: 0.015, sz: 0.015, outline: false }); }
  const g = b.build(); g.position.set(0.03, -0.3, 0.02); return g;
}

// ---------- the figure ----------

export function makeCharacter(look, { idle = "none", speed = 1 } = {}) {
  const h = look.height || 1;
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  rig.scale.setScalar(h * 1.12);

  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.085, 0.36, 0); rig.add(pivot);
    const p = new Part();
    p.add(S.capsule, look.skin, { y: -0.15, sx: 0.065, sy: 0.16, sz: 0.065 });
    p.add(S.sph, shoe(look), { y: -0.31, z: 0.03, sx: look.shoe === "clogs" ? 0.1 : 0.085, sy: 0.07, sz: look.shoe === "clogs" ? 0.13 : 0.11 });
    if (look.shoe === "boots") p.add(S.capsule, shoe(look), { y: -0.2, sx: 0.075, sy: 0.08, sz: 0.075 });
    if (look.shoe === "heels") p.add(S.cyl, shoe(look), { y: -0.36, z: -0.05, sx: 0.022, sy: 0.08, sz: 0.022, outline: false });
    if (look.shoe === "sneakers") p.add(S.box, "#e86f9a", { y: -0.35, z: 0.03, sx: 0.15, sy: 0.025, sz: 0.2, outline: false });
    pivot.add(p.build());
    legs.push(pivot);
  }
  // body
  const body = new THREE.Group(); body.position.y = 0.0; rig.add(body);
  const bp = new Part();
  const sleeve = dressBody(bp, look);
  bp.add(S.cyl, look.skin, { y: 0.93, sx: 0.06, sy: 0.08, sz: 0.06, outline: false });
  if (!look.dress || ["frock", "tea", "peasant", "sundress"].includes(look.dress)) bp.add(S.torus, look.dress === "peasant" ? "#d8283c" : look.accent, { y: 0.33, sx: 0.335, sy: 0.335, sz: 0.335, rx: Math.PI / 2, outline: false });
  for (const acc of [look.accessory, look.neck]) {
  if (acc === "pearls") for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; bp.add(S.sph, "#fffaf0", { x: Math.sin(a) * 0.085, y: 0.895 - Math.max(0, Math.cos(a)) * 0.03, z: Math.cos(a) * 0.08, sx: 0.022, sy: 0.022, sz: 0.022, outline: false }); }
  if (acc === "diamonds") { for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; bp.add(S.sph, "#dff6ff", { x: Math.sin(a) * 0.085, y: 0.895 - Math.max(0, Math.cos(a)) * 0.03, z: Math.cos(a) * 0.08, sx: 0.02, sy: 0.02, sz: 0.02, outline: false, basic: true }); } bp.add(S.sph, "#bfe8ff", { y: 0.82, z: 0.15, sx: 0.035, sy: 0.045, sz: 0.025, outline: false, basic: true }); }
  if (acc === "locket") { bp.add(S.torus, "#e8c36a", { y: 0.9, sx: 0.07, sy: 0.07, sz: 0.07, rx: Math.PI / 2 + 0.3, outline: false }); bp.add(S.sph, "#e8c36a", { y: 0.82, z: 0.16, sx: 0.03, sy: 0.035, sz: 0.015, outline: false }); }
  if (acc === "apron") { bp.add(S.box, look.accent, { y: 0.55, z: 0.2, sx: 0.3, sy: 0.4, sz: 0.04, rx: -0.29 }); bp.add(S.torus, look.accent, { y: 0.78, sx: 0.18, sy: 0.18, sz: 0.16, rx: Math.PI / 2, outline: false }); }
  if (acc === "smithapron") { bp.add(S.box, "#5a3e2a", { y: 0.58, z: 0.2, sx: 0.32, sy: 0.5, sz: 0.04, rx: -0.29 }); }
  if (acc === "choker") bp.add(S.torus, look.accent, { y: 0.92, sx: 0.065, sy: 0.065, sz: 0.065, rx: Math.PI / 2, outline: false });
  if (acc === "scarf") { bp.add(S.torus, look.accent, { y: 0.9, sx: 0.12, sy: 0.12, sz: 0.12, rx: Math.PI / 2 }); bp.add(S.box, look.accent, { x: 0.08, y: 0.78, z: 0.14, sx: 0.07, sy: 0.18, sz: 0.03, rz: 0.2 }); }
  if (acc === "sash") bp.add(S.torus, look.accent, { y: 0.66, sx: 0.25, sy: 0.25, sz: 0.25, rx: Math.PI / 2, rz: 0.6 });
  }
  const acc = look.accessory;
  if (look.hairStyle === "twintails" && acc === "goggles") { for (const s of [-1, 1]) bp.add(S.box, look.accent, { x: s * 0.1, y: 0.76, z: 0.14, sx: 0.04, sy: 0.25, sz: 0.03 }); }
  body.add(bp.build());

  // arms
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.2, 0.84, 0); body.add(pivot);
    const p = new Part();
    p.add(S.capsule, sleeve, { y: -0.08, sx: 0.06, sy: look.dress === "gown" || look.dress === "peasant" ? 0.07 : 0.06, sz: 0.06 });
    if (look.dress === "suit" || look.dress === "leather") p.add(S.capsule, sleeve, { y: -0.18, sx: 0.052, sy: 0.07, sz: 0.052 });
    p.add(S.capsule, look.skin, { y: -0.2, sx: 0.048, sy: 0.08, sz: 0.048 });
    p.add(S.sph, look.skin, { y: -0.31, sx: 0.06, sy: 0.06, sz: 0.06 });
    pivot.rotation.z = s * 0.12;
    pivot.add(p.build());
    arms.push(pivot);
  }
  if (look.bag) arms[1].add(makeBag(look));
  if (idle === "cane") {
    const cane = new Part();
    cane.add(S.cyl, "#6a4a2a", { y: -0.3, sx: 0.02, sy: 0.75, sz: 0.02 });
    cane.add(S.torus, "#6a4a2a", { y: 0.07, x: 0.05, sx: 0.06, sy: 0.06, sz: 0.06, ry: Math.PI / 2 });
    const c = cane.build(); c.position.set(0, -0.32, 0.04); arms[1].add(c);
  }
  if (idle === "notes") {
    const nb = new Part(); nb.add(S.box, "#f2e6c8", { sx: 0.12, sy: 0.16, sz: 0.03 }); nb.add(S.box, "#3fa7a0", { z: -0.018, sx: 0.125, sy: 0.165, sz: 0.01, outline: false });
    const n = nb.build(); n.position.set(0.02, -0.33, 0.06); n.rotation.x = -0.6; arms[0].add(n);
  }

  // head
  const head = new THREE.Group(); head.position.y = 1.2; body.add(head);
  const hp = new Part();
  hp.add(S.sph, look.skin, { sx: 0.34, sy: 0.32, sz: 0.32 });
  hp.add(S.sph, look.skin, { y: -0.04, z: 0.315, sx: 0.025, sy: 0.02, sz: 0.02, outline: false });
  for (const s of [-1, 1]) hp.add(S.sph, look.skin, { x: s * 0.33, y: -0.03, sx: 0.05, sy: 0.07, sz: 0.04, outline: false });
  hair(hp, look.hairStyle, look.hair, look.accent);
  headAccessory(hp, look);
  for (const a of [look.hat, look.face, look.ears]) if (a) headAccessory(hp, look, a);
  head.add(hp.build());
  // face parts that animate
  const face = new THREE.Group(); head.add(face);
  const eyeGeo = S.sph, eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * 0.12, -0.02, 0.285); face.add(e);
    const ball = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: black })); ball.scale.set(0.048, 0.064, 0.03); e.add(ball);
    const hl = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: "#ffffff" })); hl.scale.setScalar(0.016); hl.position.set(s * -0.012 + 0.012, 0.025, 0.025); e.add(hl);
    const hl2 = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: "#ffffff" })); hl2.scale.setScalar(0.008); hl2.position.set(-0.012, -0.018, 0.025); e.add(hl2);
    eyes.push(e);
  }
  const brows = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(S.box, new THREE.MeshBasicMaterial({ color: new THREE.Color(look.hair).multiplyScalar(0.6) }));
    b.scale.set(0.075, 0.016, 0.01); b.position.set(s * 0.12, 0.075, 0.3); b.rotation.x = -0.25; face.add(b); brows.push(b);
  }
  const blush = new THREE.MeshBasicMaterial({ color: "#ff9ab0", transparent: true, opacity: 0.55 });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(S.sph, blush); b.scale.set(0.055, 0.032, 0.02); b.position.set(s * 0.2, -0.09, 0.255); b.rotation.y = s * 0.55; face.add(b); }
  const mouth = new THREE.Mesh(S.sph, new THREE.MeshBasicMaterial({ color: "#a03a4a" }));
  mouth.scale.set(0.035, 0.012, 0.012); mouth.position.set(0, -0.13, 0.3); face.add(mouth);

  // a soft shadow blob under the feet for when shadows are thin
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#3a4a3a", transparent: true, opacity: 0.18, depthWrite: false }));
  blob.position.y = 0.06; root.add(blob);

  // highlight ring (who you can talk to / vote for)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ff8fb8", transparent: true, opacity: 0.9, depthWrite: false }));
  ring.position.y = 0.07; ring.visible = false; root.add(ring);

  const st = { phase: Math.random() * 6, blink: 2 + Math.random() * 3, blinkT: 0, talk: 0, idleT: Math.random() * 10, gesture: 0, anger: 0, surprise: 0, look: null, special: 0 };

  function update(dt, t, { speed: v = 0, talking = false, anger = 0, sitting = false } = {}) {
    const moving = v > 0.05;
    const amt = Math.min(1, v / 1.4);
    st.phase += dt * (3 + v * 4.2);
    const sw = Math.sin(st.phase);
    // walk cycle
    for (let i = 0; i < 2; i++) legs[i].rotation.x = (i ? -sw : sw) * 0.75 * amt;
    for (let i = 0; i < 2; i++) { arms[i].rotation.x = (i ? sw : -sw) * 0.65 * amt; arms[i].rotation.z = (i ? 1 : -1) * 0.12; }
    rig.position.y = Math.abs(Math.cos(st.phase)) * 0.06 * amt;
    body.rotation.x = 0.06 * amt;
    body.rotation.z = Math.sin(st.phase) * 0.03 * amt;
    head.rotation.set(0, 0, 0);
    rig.rotation.y = 0;
    // breathing
    body.scale.y = 1 + Math.sin(t * 2.2 + st.idleT) * 0.012;
    if (!moving) {
      st.idleT += dt;
      idleAnim(t, dt, talking);
    }
    // talking: mouth and little nods
    st.talk += dt * (talking ? 14 : 0);
    mouth.scale.y = talking ? 0.012 + Math.abs(Math.sin(st.talk)) * 0.03 : 0.012 + st.surprise * 0.03;
    mouth.scale.x = talking ? 0.032 : 0.035 - st.surprise * 0.012;
    if (talking) { head.rotation.x += Math.sin(st.talk * 0.5) * 0.06; head.rotation.z += Math.sin(st.talk * 0.27) * 0.05; }
    // blinking
    st.blink -= dt;
    if (st.blink < 0) { st.blinkT = 0.13; st.blink = 2.2 + Math.random() * 3.5; }
    st.blinkT -= dt;
    const shut = st.blinkT > 0 ? 0.12 : 1 + st.surprise * 0.3;
    for (const e of eyes) e.scale.y = shut;
    // brows show anger
    st.anger += (anger - st.anger) * Math.min(1, dt * 3);
    brows[0].rotation.z = -st.anger * 0.45; brows[1].rotation.z = st.anger * 0.45;
    for (const b of brows) b.position.y = 0.075 - st.anger * 0.012 + st.surprise * 0.025;
    st.surprise = Math.max(0, st.surprise - dt * 1.2);
    // look at someone
    if (st.look) {
      const wp = new THREE.Vector3(); root.getWorldPosition(wp);
      const yaw = Math.atan2(st.look.x - wp.x, st.look.z - wp.z) - root.rotation.y;
      const ny = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      head.rotation.y = Math.max(-0.7, Math.min(0.7, ny));
    }
    if (sitting) { legs[0].rotation.x = legs[1].rotation.x = -1.4; rig.position.y = -0.18; }
    ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
  }

  function idleAnim(t, dt, talking) {
    const k = st.idleT;
    const cycle = (period, dur) => { const u = (k % period) / dur; return u < 1 ? Math.sin(u * Math.PI) : 0; };
    switch (idle) {
      case "arms": // arms crossed
        arms[0].rotation.set(-1.25, 0, 0.9); arms[1].rotation.set(-1.25, 0, -0.9);
        head.rotation.x = -0.05; break;
      case "primp": { // flips her hair now and then
        const c = cycle(6, 1.4);
        arms[1].rotation.set(-2.6 * c, 0, -0.3 * c - 0.12); head.rotation.z = 0.15 * c; head.rotation.x = -0.12 * c; break;
      }
      case "bounce": rig.position.y = Math.abs(Math.sin(t * 5)) * 0.05 * (cycle(3, 1.2) > 0 ? 1 : 0.2); arms[0].rotation.z = -0.3; arms[1].rotation.z = 0.3; break;
      case "twirl": { const c = cycle(9, 1.6); rig.rotation.y = c > 0 ? ((k % 9) / 1.6) * Math.PI * 2 : 0; arms[0].rotation.z = -0.6 * c - 0.12; arms[1].rotation.z = 0.6 * c + 0.12; head.rotation.x = -0.15; break; }
      case "cane": body.rotation.x = 0.12; arms[1].rotation.set(-0.35, 0, 0.12); break;
      case "notes": arms[0].rotation.set(-1.0, 0, 0.35); arms[1].rotation.set(-1.0 - Math.sin(t * 8) * 0.08, 0, -0.45); head.rotation.x = 0.28 * (cycle(5, 3.5) > 0 ? 1 : 0.2); break;
      case "scheme": arms[0].rotation.set(-0.9, 0, 0.55 + Math.sin(t * 6) * 0.06); arms[1].rotation.set(-0.9, 0, -0.55 - Math.sin(t * 6) * 0.06); head.rotation.x = 0.08; break;
      case "chatter": if (talking) { arms[0].rotation.set(-0.8 + Math.sin(t * 3) * 0.4, 0, -0.3); arms[1].rotation.set(-0.5 + Math.sin(t * 2.3) * 0.5, 0, 0.3); } else { arms[0].rotation.z = -0.25; arms[1].rotation.set(-0.6, 0, -0.4); } break;
      case "eyeroll": { const c = cycle(7, 1.0); head.rotation.x = -0.35 * c; head.rotation.z = 0.12 * c; arms[0].rotation.set(-0.3, 0, 0.6); break; }
      case "fidget": body.rotation.z = Math.sin(t * 1.6) * 0.06; arms[0].rotation.set(-0.7, 0, 0.5); arms[1].rotation.set(-0.7, 0, -0.5); break;
      default: break;
    }
    if (talking && idle !== "arms" && idle !== "chatter" && idle !== "notes") { arms[1].rotation.x = -0.4 + Math.sin(t * 2.6) * 0.35; }
  }

  root.traverse((o) => { if (o.isMesh) o.renderOrder = o.userData.xray ? 1 : 2; });
  return {
    root, rig, head, ring, update,
    lookAt(p) { st.look = p; },
    surprise() { st.surprise = 1; },
    get height() { return 1.65 * h * 1.12; },
  };
}

const shoe = (look) => look.shoeColor || new THREE.Color(look.outfit).multiplyScalar(0.55).getStyle();

// ---------- someone walking around town ----------

export class Walker {
  constructor(model, { x, z, speed = 1.15 }) {
    this.model = model;
    this.x = x; this.z = z;
    this.heading = Math.random() * Math.PI * 2;
    this.path = [];
    this.speedBase = speed;
    this.v = 0;
    this.face = null; // a point to turn toward when standing
    this.frozen = false;
    model.root.position.set(x, 0, z);
  }
  goTo(x, z) {
    this.path = L.findPath(this.x, this.z, x, z);
    this.dest = { x, z };
  }
  stop() { this.path = []; }
  get moving() { return this.path.length > 0 && !this.frozen; }
  update(dt, t, others, extra = {}) {
    let speed = 0;
    if (!this.frozen && this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      const sp = this.speedBase * (extra.hurry ? 1.6 : 1);
      if (d < 0.15) this.path.shift();
      else {
        const step = Math.min(d, sp * dt);
        this.x += (dx / d) * step; this.z += (dz / d) * step;
        this.heading = turn(this.heading, Math.atan2(dx, dz), dt * 8);
        speed = sp;
      }
    } else if (this.face) {
      this.heading = turn(this.heading, Math.atan2(this.face.x - this.x, this.face.z - this.z), dt * 5);
    }
    // keep a little personal space when standing still
    if (!speed && others) for (const o of others) {
      if (o === this) continue;
      const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.75 && d > 0.001) { const push = (0.75 - d) * dt * 2; const nx = this.x + (dx / d) * push, nz = this.z + (dz / d) * push; if (!L.solidAt(nx, nz, 0.2)) { this.x = nx; this.z = nz; } }
    }
    this.v += (speed - this.v) * Math.min(1, dt * 10);
    this.model.root.position.set(this.x, 0, this.z);
    this.model.root.rotation.y = this.heading;
    this.model.update(dt, t, { speed: this.v, ...extra });
  }
}

export function turn(a, b, k) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * Math.min(1, k);
}

// ---------- portraits for the HUD ----------

export function portraits(list) {
  const out = {};
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight("#ffffff", "#c8a0b8", 2.2));
  const dl = new THREE.DirectionalLight("#ffffff", 1.6); dl.position.set(1, 2, 3); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  const rt = new THREE.WebGLRenderTarget(192, 192, { colorSpace: THREE.SRGBColorSpace });
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 192;
  const ctx = canvas.getContext("2d");
  const buf = new Uint8Array(192 * 192 * 4);
  const prevTone = renderer.toneMapping;
  for (const p of list) {
    const m = makeCharacter(p.look, { idle: "none" });
    m.update(0.016, 0, {});
    sc.add(m.root);
    const hy = m.height * 0.76;
    cam.position.set(0.25, hy + 0.05, 1.55);
    cam.lookAt(0, hy - 0.04, 0);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(sc, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, 192, 192, buf);
    renderer.setRenderTarget(null);
    const img = ctx.createImageData(192, 192);
    for (let y = 0; y < 192; y++) img.data.set(buf.subarray((191 - y) * 192 * 4, (192 - y) * 192 * 4), y * 192 * 4);
    ctx.putImageData(img, 0, 0);
    out[p.id] = canvas.toDataURL("image/png");
    sc.remove(m.root);
  }
  renderer.toneMapping = prevTone;
  rt.dispose();
  return out;
}

// ---------- a full-length picture for the wardrobe ----------

let dressing = null;
export function fullPortrait(look, { w = 300, h = 420, angle = 0.35 } = {}) {
  if (!dressing || dressing.w !== w || dressing.h !== h) {
    dressing?.rt.dispose();
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight("#ffffff", "#c8a0b8", 2.2));
    const dl = new THREE.DirectionalLight("#ffffff", 1.6); dl.position.set(1, 2, 3); sc.add(dl);
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    dressing = { w, h, sc, cam: new THREE.PerspectiveCamera(24, w / h, 0.1, 30), rt: new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace }), canvas, ctx: canvas.getContext("2d"), buf: new Uint8Array(w * h * 4), model: null };
  }
  const D = dressing;
  if (D.model) D.sc.remove(D.model.root);
  const m = makeCharacter(look, { idle: "none" });
  m.update(0.016, 0, {});
  m.root.rotation.y = angle;
  D.sc.add(m.root); D.model = m;
  const mid = m.height * 0.5;
  D.cam.position.set(0, mid + 0.3, 6.3);
  D.cam.lookAt(0, mid, 0);
  renderer.setRenderTarget(D.rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(D.sc, D.cam);
  renderer.readRenderTargetPixels(D.rt, 0, 0, w, h, D.buf);
  renderer.setRenderTarget(null);
  const img = D.ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(D.buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  D.ctx.putImageData(img, 0, 0);
  return D.canvas.toDataURL("image/png");
}
