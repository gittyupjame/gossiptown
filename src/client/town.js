// Builds the town: ground, water, roads, buildings, nature, props and ambient particles.
// Static meshes are merged by material at the end so the whole town costs few draw calls.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { scene, toon, glowMaterials } from "./scene.js";
import * as L from "./layout.js";
import { PLACES } from "../core/cast.js";

const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const R = (a, b) => a + rnd() * (b - a);

// ---------- canvas textures ----------

function canvasTex(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const cobbleTex = (base = "#ead9bd", repeat = [1, 1]) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#cdb898"; g.fillRect(0, 0, w, h);
  const r2 = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const cx = (x + 0.5 + (y % 2) * 0.5) * 32, cy = (y + 0.5) * 32;
    const shade = 0.9 + r2() * 0.18;
    const c = new THREE.Color(base).multiplyScalar(shade);
    g.fillStyle = `#${c.getHexString()}`;
    g.beginPath();
    g.ellipse(cx % w, cy, 13 + r2() * 2, 12 + r2() * 2, r2(), 0, Math.PI * 2);
    g.fill();
    if (cx > w - 16) { g.beginPath(); g.ellipse(cx - w, cy, 13, 12, 0, 0, Math.PI * 2); g.fill(); }
  }
}, { repeat });

export function signTex(text, { bg = "#fff8ec", fg = "#5a3e2a", border = "#b5643c", font = "Pacifico, Fredoka, cursive" } = {}) {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = border; roundRect(g, 0, 0, w, h, 28); g.fill();
    g.fillStyle = bg; roundRect(g, 8, 8, w - 16, h - 16, 22); g.fill();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    let size = 64;
    g.font = `${size}px ${font}`;
    while (g.measureText(text).width > w - 60 && size > 20) { size -= 4; g.font = `${size}px ${font}`; }
    g.fillText(text, w / 2, h / 2 + 4);
  });
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const stripeTex = (a, b, n = 8) => canvasTex(256, 64, (g, w, h) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * w) / n, 0, w / n + 1, h); } g.fillStyle = a; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(((i + 0.5) * w) / n, h - 2, w / n / 2, 0, Math.PI); g.fill(); } });

// ---------- helpers that build into a parent group ----------

const staticRoot = new THREE.Group();
const dynamicRoot = new THREE.Group();
scene.add(staticRoot, dynamicRoot);
export const animated = []; // { update(t, dt) }

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 14),
  sph: new THREE.SphereGeometry(1, 16, 12),
  sphLo: new THREE.SphereGeometry(1, 9, 7),
  blob: new THREE.IcosahedronGeometry(1, 2),
  tiny: new THREE.OctahedronGeometry(1, 0),
  cone5: new THREE.ConeGeometry(1, 1, 5),
  dode: new THREE.DodecahedronGeometry(1, 0),
};
const box = (p, w, h, d, color, x, y, z, o = {}) => mesh(G.box, typeof color === "string" ? toon(color) : color, p, x, y, z, { ...o, sx: w, sy: h, sz: d });
const cyl = (p, r, h, color, x, y, z, o = {}) => mesh(o.six ? G.cyl6 : G.cyl, typeof color === "string" ? toon(color) : color, p, x, y, z, { ...o, sx: r, sy: h, sz: r });
const sph = (p, r, color, x, y, z, o = {}) => mesh(o.lo ? G.sphLo : G.sph, typeof color === "string" ? toon(color) : color, p, x, y, z, { sx: r * (o.sx || 1), sy: r * (o.sy || 1), sz: r * (o.sz || 1), rx: o.rx || 0, ry: o.ry || 0, shadow: o.shadow ?? true });

const windowGlow = toon("#ffe6a8", { emissive: "#ffc46a" });
windowGlow.userData.maxGlow = 1.2;

// ---------- ground ----------

function groundHeight(x, z) {
  // the valley rises into soft hills outside the town
  const ex = Math.max(0, Math.abs(x) - 54), ezN = Math.max(0, -66 - z), ezS = Math.max(0, z - 46);
  let h = (ex * ex + ezN * ezN + ezS * ezS) * 0.035;
  h += Math.sin(x * 0.11) * Math.cos(z * 0.09) * Math.min(1, (ex + ezN + ezS) * 0.15) * 2.2;
  const shoreL = (((x - L.LAKE.x) / L.LAKE.rx) ** 2 + ((z - L.LAKE.z) / L.LAKE.rz) ** 2);
  const dr = L.distToPolyline(x, z, L.RIVER) - L.RIVER_W / 2;
  if (shoreL < 1) h = -1.1 * Math.min(1, (1 - shoreL) * 6);
  if (dr < 0) h = Math.min(h, -0.9 * Math.min(1, -dr * 1.2));
  return h;
}

function buildGround() {
  const size = 300, seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color("#9ed37a"), grassB = new THREE.Color("#7fc06a"), grassC = new THREE.Color("#b6de86"), sand = new THREE.Color("#f2dfb0"), hill = new THREE.Color("#8ac47a"), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 11;
    const h = groundHeight(x, z);
    pos.setY(i, h);
    pos.setZ(i, z);
    const n = Math.sin(x * 0.23 + Math.cos(z * 0.17) * 2) * 0.5 + Math.sin(z * 0.31 - x * 0.07) * 0.5;
    c.copy(grassA).lerp(n > 0 ? grassC : grassB, Math.abs(n) * 0.6);
    const shoreL = Math.sqrt(((x - L.LAKE.x) / L.LAKE.rx) ** 2 + ((z - L.LAKE.z) / L.LAKE.rz) ** 2);
    const dr = L.distToPolyline(x, z, L.RIVER) - L.RIVER_W / 2;
    if (shoreL < 1.12 || dr < 1.0) c.lerp(sand, 0.85);
    if (h > 0.4) c.lerp(hill, Math.min(1, h * 0.08));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon("#fff").gradientMap }));
  m.receiveShadow = true;
  scene.add(m);
}

// stylized water with moving ripples and sparkles
export const waterUniforms = { time: { value: 0 }, night: { value: 0 } };
function buildWater() {
  const geo = new THREE.PlaneGeometry(300, 300, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...waterUniforms, fogColor: { value: new THREE.Color() }, fogNear: { value: 0 }, fogFar: { value: 0 } },
    fog: true, transparent: true,
    vertexShader: `varying vec2 vXZ; #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vXZ = wp.xz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <(\w+)>/g, "\n#include <$1>\n"),
    fragmentShader: `uniform float time; uniform float night; varying vec2 vXZ; #include <fog_pars_fragment>
      void main(){
        vec2 p = vXZ * 0.35;
        float w = sin(p.x * 1.7 + time * 0.9 + sin(p.y * 1.3 + time * 0.6)) * 0.5 + sin(p.y * 2.1 - time * 0.7 + sin(p.x * 0.9)) * 0.5;
        vec3 deep = mix(vec3(0.33, 0.70, 0.86), vec3(0.12, 0.18, 0.40), night);
        vec3 light = mix(vec3(0.62, 0.90, 0.96), vec3(0.30, 0.36, 0.62), night);
        vec3 c = mix(deep, light, smoothstep(0.55, 0.95, w));
        float sp = step(0.985, fract(sin(dot(floor(vXZ * 2.0), vec2(12.9898, 78.233)) + floor(time * 2.0)) * 43758.5453));
        c += sp * 0.35 * (1.0 - night * 0.6);
        gl_FragColor = vec4(c, 0.92);
        #include <fog_fragment>
      }`.replace(/#include <(\w+)>/g, "\n#include <$1>\n"),
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, -0.25, -11);
  scene.add(m);
}

// ---------- roads ----------

function buildRoads() {
  const tex = cobbleTex("#ecdcc0");
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toon("#fff").gradientMap });
  const edge = toon("#d8c4a0");
  for (const r of L.ROADS) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const geo = new THREE.PlaneGeometry(r.w, len);
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * r.w / 3, uv.getY(k) * len / 3);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((ax + bx) / 2, 0.03, (az + bz) / 2);
      m.rotation.y = Math.atan2(bx - ax, bz - az);
      m.receiveShadow = true;
      staticRoot.add(m);
      const e = mesh(G.box, edge, staticRoot, (ax + bx) / 2, 0.02, (az + bz) / 2, { sx: r.w + 0.5, sy: 0.04, sz: len, ry: Math.atan2(bx - ax, bz - az), shadow: false });
      e.receiveShadow = true;
    }
    for (const [x, z] of r.pts) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r.w / 2, 20).rotateX(-Math.PI / 2), mat);
      c.position.set(x, 0.031, z); c.receiveShadow = true; staticRoot.add(c);
    }
  }
  // the plaza
  const ptex = cobbleTex("#f0e0c6", [6, 6]);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(L.PLAZA.r, 48).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: ptex, gradientMap: toon("#fff").gradientMap }));
  plaza.position.set(L.PLAZA.x, 0.04, L.PLAZA.z); plaza.receiveShadow = true; staticRoot.add(plaza);
  const ring = new THREE.Mesh(new THREE.RingGeometry(L.PLAZA.r - 0.05, L.PLAZA.r + 0.5, 64).rotateX(-Math.PI / 2), toon("#d2bc98"));
  ring.position.set(0, 0.045, 0); staticRoot.add(ring);
  // a rose pattern in the middle of the plaza
  const rose = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.1, 48).rotateX(-Math.PI / 2), toon("#e8b4a0"));
  rose.position.set(0, 0.05, 0); staticRoot.add(rose);
}

// ---------- buildings ----------

const ROT = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

function gableRoof(p, w, d, wallH, peak, color, wall, over = 0.45) {
  const slant = Math.hypot(d / 2 + over, peak);
  const ang = Math.atan2(peak, d / 2);
  const mat = toon(color);
  for (const side of [-1, 1]) {
    const m = box(p, w + over * 2, 0.28, slant, mat, 0, wallH + peak / 2 + 0.08, side * (d / 4 + over / 2) * 0.98, { rx: side * ang });
    m.castShadow = true;
  }
  // gable ends
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, peak)]);
  const tri = new THREE.ExtrudeGeometry(shape, { depth: w - 0.02, bevelEnabled: false });
  tri.translate(0, 0, -(w - 0.02) / 2);
  tri.rotateY(Math.PI / 2);
  mesh(tri, toon(wall), p, 0, wallH, 0);
  // ridge cap
  box(p, w + over * 2 + 0.1, 0.22, 0.34, toon(new THREE.Color(color).multiplyScalar(0.8).getStyle()), 0, wallH + peak + 0.12, 0);
}

function windowAt(p, x, y, z, ry, { w = 1.0, h = 1.15, shutter = null, flowers = null } = {}) {
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = ry;
  p.add(g);
  box(g, w + 0.22, h + 0.22, 0.12, "#ffffff", 0, 0, 0.02);
  box(g, w, h, 0.1, windowGlow, 0, 0, 0.06);
  box(g, 0.07, h, 0.12, "#ffffff", 0, 0, 0.1);
  box(g, w, 0.07, 0.12, "#ffffff", 0, 0, 0.1);
  if (shutter) for (const s of [-1, 1]) box(g, 0.32, h + 0.1, 0.07, shutter, s * (w / 2 + 0.3), 0, 0.04);
  if (flowers) {
    box(g, w + 0.3, 0.26, 0.34, "#a8744a", 0, -h / 2 - 0.2, 0.2);
    for (let i = 0; i < 5; i++) sph(g, 0.13, flowers[i % flowers.length], -w / 2 + 0.1 + (i * (w - 0.2)) / 4, -h / 2 - 0.02, 0.24, { lo: true });
  }
  return g;
}

function door(p, x, z, ry, color = "#8a5a3a", h = 1.9) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry; p.add(g);
  box(g, 1.25, h + 0.15, 0.12, "#ffffff", 0, (h + 0.15) / 2, 0.01);
  box(g, 1.05, h, 0.14, color, 0, h / 2, 0.04);
  cyl(g, 0.525, 0.14, color, 0, h, 0.04, { rx: Math.PI / 2 });
  sph(g, 0.06, "#e8c36a", 0.35, h * 0.5, 0.14, { lo: true });
  box(g, 1.5, 0.12, 0.7, "#c9b394", 0, 0.06, 0.5);
}

function hangingSign(p, text, x, y, z, ry, colors) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; p.add(g);
  const tex = signTex(text, colors);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.position.z = 0.06;
  g.add(m);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  back.rotation.y = Math.PI; back.position.z = -0.01;
  g.add(back);
  return g;
}

function awning(p, colors, w, y, z) {
  const tex = stripeTex(colors[0], colors[1], 10);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.4), new THREE.MeshToonMaterial({ map: tex, gradientMap: toon("#fff").gradientMap, side: THREE.DoubleSide }));
  m.position.set(0, y, z + 0.6); m.rotation.x = -Math.PI / 2 + 0.55;
  m.castShadow = true;
  p.add(m);
  const frill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.3), new THREE.MeshToonMaterial({ map: tex, gradientMap: toon("#fff").gradientMap, side: THREE.DoubleSide }));
  frill.position.set(0, y - 0.65, z + 1.2);
  p.add(frill);
}

function chimney(p, x, y, z, color = "#b8a090") {
  box(p, 0.7, 1.6, 0.7, color, x, y, z);
  box(p, 0.85, 0.2, 0.85, "#8a7a6a", x, y + 0.85, z);
  smokeSources.push(new THREE.Vector3());
  const idx = smokeSources.length - 1;
  p.updateMatrixWorld?.();
  pendingSmoke.push({ p, x, y: y + 1, z, idx });
}
const smokeSources = [], pendingSmoke = [];

function makeBuilding(b) {
  const g = new THREE.Group();
  g.position.set(b.x, 0, b.z);
  g.rotation.y = ROT[b.face];
  const side = b.face === "e" || b.face === "w";
  const w = side ? b.d : b.w, d = side ? b.w : b.d, h = b.h;
  box(g, w + 0.3, 0.45, d + 0.3, "#c9bba8", 0, 0.22, 0);
  box(g, w, h, d, b.wall, 0, h / 2 + 0.2, 0);
  // timber trim
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.24, h, 0.24, b.trim, sx * (w / 2), h / 2 + 0.2, sz * (d / 2));
  box(g, w + 0.06, 0.2, d + 0.06, b.trim, 0, h + 0.15, 0);
  if (b.floors === 2) box(g, w + 0.06, 0.16, d + 0.06, b.trim, 0, h / 2 + 0.2, 0);
  if (b.kind === "glass") {
    // a greenhouse: glass panels in a white frame
    g.remove(g.children[1]);
    const glass = toon("#bfefff", { opacity: 0.45 });
    box(g, w, h, d, glass, 0, h / 2 + 0.2, 0, { shadow: false });
    for (let i = -2; i <= 2; i++) box(g, 0.1, h, d + 0.05, "#ffffff", (i * w) / 4.4, h / 2 + 0.2, 0);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 16, 1, false, 0, Math.PI), glass);
    roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.position.y = h + 0.2;
    g.add(roof);
    for (let i = 0; i < 8; i++) sph(g, R(0.4, 0.6), ["#6ab06a", "#8acb6a", "#5a9a6a"][i % 3], R(-w / 2 + 0.6, w / 2 - 0.6), R(0.6, 1.2), R(-d / 2 + 0.6, d / 2 - 0.6), { lo: true });
    door(g, 0, d / 2, 0, "#ffffff");
    staticRoot.add(g);
    return g;
  }
  gableRoof(g, w, d, h + 0.2, b.kind === "hall" ? 2.6 : Math.min(2.6, d * 0.42), b.roof, b.wall);
  door(g, b.kind === "tavern" ? -w / 4 : 0, d / 2, 0, b.trim);
  const shutter = new THREE.Color(b.roof).lerp(new THREE.Color("#ffffff"), 0.15).getStyle();
  const flowers = ["#ff7aa8", "#ffd76a", "#ffffff", "#ff9a6a", "#c8a0ff"];
  const wx = [];
  for (let x = -w / 2 + 1.5; x <= w / 2 - 1.4; x += 2.4) if (Math.abs(x - (b.kind === "tavern" ? -w / 4 : 0)) > 1.3) wx.push(x);
  for (const x of wx) windowAt(g, x, 1.65, d / 2, 0, { shutter, flowers: b.kind === "smithy" ? null : flowers });
  if (b.floors === 2 || b.kind === "hall") for (const x of [...wx, b.kind === "tavern" ? -w / 4 : 0]) windowAt(g, x, h - 0.6, d / 2, 0, { w: 0.9, h: 0.9, shutter });
  for (const sx of [-1, 1]) windowAt(g, sx * (w / 2), 1.65, 0, sx * Math.PI / 2, { shutter });
  for (const x of wx.slice(0, 2)) windowAt(g, x, 1.65, -d / 2, Math.PI, {});
  if (b.awning) awning(g, b.awning, w - 0.6, 2.75, d / 2);
  if (b.sign) {
    if (b.kind === "shop" || b.kind === "smithy") {
      const s = hangingSign(g, b.sign, 0, h + 0.2 + 0.1, d / 2 + 0.2, 0, { border: b.trim, fg: b.trim });
      s.position.y = b.awning ? 3.55 : h - 0.2;
      if (b.awning) s.position.y = Math.min(h - 0.1, 3.75);
    } else hangingSign(g, b.sign, b.kind === "tavern" ? w / 4 : 0, h - (b.kind === "hall" ? 0.9 : 0.4), d / 2 + 0.12, 0, { border: b.trim, fg: b.trim });
  }
  if (b.kind !== "hall") chimney(g, w / 2 - 1.2, h + 1.6, -d / 4, b.kind === "smithy" ? "#7a6a5a" : "#c8b0a0");
  if (b.kind === "hall") clockTower(g, w, d, h);
  if (b.kind === "smithy") smithyExtras(g, w, d);
  if (b.kind === "tavern") tavernExtras(g, w, d);
  if (b.id === "bakery") cafeTables(g, d, ["#ffd76a", "#ffffff"]);
  if (b.id === "salon") salonExtras(g, w, d);
  if (b.id === "gazette") gazetteExtras(g, w, d);
  staticRoot.add(g);
  return g;
}

let clockHands = null;
function clockTower(g, w, d, h) {
  const tw = 3.2, th = 5.5;
  box(g, tw, th, tw, "#efe7f5", 0, h + th / 2, 0);
  box(g, tw + 0.2, 0.25, tw + 0.2, "#34406a", 0, h + th, 0);
  const roof = mesh(new THREE.ConeGeometry(tw * 0.85, 3.2, 4), toon("#4a5a8a"), g, 0, h + th + 1.7, 0, { ry: Math.PI / 4 });
  roof.castShadow = true;
  sph(g, 0.25, "#e8c36a", 0, h + th + 3.4, 0);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), toon("#fffaf0", { emissive: "#fff2c0" }));
  face.position.set(0, h + th - 1.4, tw / 2 + 0.02);
  g.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.1, 8, 32), toon("#c9a85a"));
  rim.position.copy(face.position); g.add(rim);
  const hands = new THREE.Group(); hands.position.copy(face.position); hands.position.z += 0.05; g.add(hands);
  const hr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.04), toon("#34406a")); hr.geometry.translate(0, 0.27, 0); hands.add(hr);
  const mn = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.04), toon("#34406a")); mn.geometry.translate(0, 0.42, 0); hands.add(mn);
  clockHands = { hr, mn };
  // pillars at the door
  for (const sx of [-1, 1]) cyl(g, 0.28, h - 0.4, "#ffffff", sx * 1.6, (h - 0.4) / 2 + 0.2, d / 2 + 0.9);
  box(g, 4.2, 0.3, 1.6, "#ffffff", 0, h - 0.1, d / 2 + 0.7);
  for (let i = 0; i < 3; i++) box(g, 4.4 - i * 0.3, 0.2, 0.5, "#e6dccc", 0, 0.1 + i * 0.2, d / 2 + 1.9 - i * 0.45);
  // flags
  for (const sx of [-1, 1]) { cyl(g, 0.05, 3.2, "#ffffff", sx * (w / 2 + 0.8), 1.6, d / 2 + 1.2); box(g, 0.9, 0.55, 0.03, sx > 0 ? "#e8577e" : "#4a5a8a", sx * (w / 2 + 0.8) + 0.45, 2.9, d / 2 + 1.2); }
}

function smithyExtras(g, w, d) {
  // the open forge in front, under a lean-to
  const fx = w / 2 - 2.2, fz = d / 2 + 1.6;
  box(g, 3.6, 0.15, 2.6, "#7a4a3a", fx - 0.6, 2.7, fz - 0.2, { rx: 0.18 });
  for (const sx of [-1, 1]) cyl(g, 0.1, 2.6, "#5a3a2a", fx - 0.6 + sx * 1.6, 1.3, fz + 0.9);
  box(g, 1.4, 0.9, 1.1, "#8a7a6a", fx, 0.45, fz - 0.3);
  const coals = box(g, 1.0, 0.12, 0.7, toon("#ff7a3a", { emissive: "#ff5a1a" }), fx, 0.95, fz - 0.3);
  coals.material.userData.maxGlow = 2.2;
  forgeGlow.push(new THREE.Vector3(fx, 1.2, fz - 0.3));
  // anvil
  const ax = -w / 4, az = d / 2 + 2.2;
  box(g, 0.5, 0.55, 0.4, "#5a5a62", ax, 0.28, az);
  box(g, 1.0, 0.25, 0.42, "#6a6a74", ax, 0.66, az);
  cyl(g, 0.12, 0.4, "#6a6a74", ax + 0.6, 0.66, az, { rz: Math.PI / 2 });
  cyl(g, 0.45, 0.8, "#7a5a3a", ax - 1.6, 0.4, az + 0.2);
  sph(g, 0.42, "#6ab0e0", ax - 1.6, 0.7, az + 0.2, { sy: 0.1 });
  for (let i = 0; i < 3; i++) box(g, 0.12, 1.3, 0.05, "#9a9aa6", -w / 2 + 0.8 + i * 0.3, 0.9, d / 2 + 0.1, { rz: R(-0.1, 0.1) });
}
const forgeGlow = [];

function cafeTables(g, d, colors) {
  for (const [x, z] of [[-2.4, d / 2 + 2.6], [2.2, d / 2 + 2.8]]) {
    cyl(g, 0.55, 0.06, "#ffffff", x, 0.85, z);
    cyl(g, 0.06, 0.85, "#a0a0a8", x, 0.43, z);
    cyl(g, 0.06, 2.4, "#ffffff", x, 1.2, z);
    const um = mesh(new THREE.ConeGeometry(1.3, 0.55, 10), new THREE.MeshToonMaterial({ map: stripeTex(colors[0], colors[1], 10), gradientMap: toon("#fff").gradientMap }), g, x, 2.45, z);
    um.castShadow = true;
    for (const a of [0, Math.PI]) { const cx = x + Math.cos(a) * 0.9, cz = z + Math.sin(a) * 0.9; cyl(g, 0.24, 0.06, "#ff9ab8", cx, 0.5, cz); cyl(g, 0.04, 0.5, "#a0a0a8", cx, 0.25, cz); }
  }
  // a bread sign on a stand
  box(g, 0.08, 1.1, 0.08, "#8a5a3a", -4, 0.55, d / 2 + 0.9);
  sph(g, 0.4, "#e8a85a", -4, 1.35, d / 2 + 0.9, { sx: 1.4, sy: 0.7 });
}

function salonExtras(g, w, d) {
  // a striped pole and a pair of pink benches
  const px = w / 2 - 0.6, pz = d / 2 + 0.5;
  cyl(g, 0.16, 2.2, new THREE.MeshToonMaterial({ map: stripeTex("#ff8fb8", "#ffffff", 8), gradientMap: toon("#fff").gradientMap }), px, 1.3, pz);
  sph(g, 0.2, "#ffffff", px, 2.5, pz);
  for (const x of [-2.3, 2.0]) { box(g, 1.6, 0.14, 0.5, "#ff9ab8", x, 0.55, d / 2 + 2.2); for (const sx of [-0.6, 0.6]) box(g, 0.1, 0.5, 0.4, "#ffffff", x + sx, 0.27, d / 2 + 2.2); }
  // the clothes rack: where the newcomer changes her look
  const rx = -w / 2 - 0.1, rz = d / 2 + 0.75;
  for (const sx of [-0.75, 0.75]) { cyl(g, 0.04, 1.9, "#c9a85a", rx + sx, 0.95, rz); cyl(g, 0.22, 0.05, "#c9a85a", rx + sx, 0.03, rz); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), toon("#c9a85a")); bar.rotation.z = Math.PI / 2; bar.position.set(rx, 1.85, rz); g.add(bar);
  ["#ff8fb8", "#6b4a9a", "#ffd76a", "#2a2430", "#7fbf8f", "#d8283c"].forEach((c, i) => {
    const x = rx - 0.55 + i * 0.22;
    const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.17, 0.75, 10), toon(c)); dr.position.set(x, 1.38, rz); dr.rotation.y = i; g.add(dr);
    sph(g, 0.03, "#c9a85a", x, 1.82, rz);
  });
  // a big mirror
  const mir = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), toon("#d8f2ff", { emissive: "#c8e8ff" }));
  mir.position.set(-w / 2 + 1.2, 2.1, d / 2 + 0.08); g.add(mir);
}

function gazetteExtras(g, w, d) {
  // paper stand and pinned notices
  box(g, 1.1, 1.0, 0.6, "#3fa7a0", w / 2 - 1.0, 0.5, d / 2 + 1.0);
  box(g, 1.0, 0.06, 0.55, "#ffffff", w / 2 - 1.0, 1.03, d / 2 + 1.0, { rx: -0.2 });
  const board = new THREE.Group(); board.position.set(-w / 2 + 1.3, 0, d / 2 + 1.3); g.add(board);
  for (const sx of [-0.7, 0.7]) box(board, 0.1, 1.9, 0.1, "#5a3e2a", sx, 0.95, 0);
  box(board, 1.6, 1.0, 0.08, "#c9a070", 0, 1.4, 0);
  for (let i = 0; i < 5; i++) box(board, R(0.3, 0.45), R(0.3, 0.45), 0.02, ["#ffffff", "#fff4c8", "#ffd8e8"][i % 3], R(-0.55, 0.55), R(1.1, 1.7), 0.05, { rz: R(-0.2, 0.2) });
}

function tavernExtras(g, w, d) {
  // the patio: tables, benches, barrels and string lights
  const pz = d / 2 + 3.2;
  for (const x of [-w / 2 + 2, 0.5, w / 2 - 1.6]) {
    box(g, 1.8, 0.12, 0.9, "#9a6a44", x, 0.8, pz);
    for (const sx of [-0.7, 0.7]) box(g, 0.12, 0.8, 0.8, "#7a4a2a", x + sx, 0.4, pz);
    for (const sz of [-0.8, 0.8]) box(g, 1.8, 0.1, 0.35, "#8a5a34", x, 0.48, pz + sz);
    sph(g, 0.12, "#ffcf5a", x - 0.4, 0.95, pz, { lo: true });
  }
  for (let i = 0; i < 3; i++) cyl(g, 0.45, 1.0, "#8a5a34", w / 2 + 0.7, 0.5, d / 2 - 1 - i * 1.0, {});
  const bulbs = toon("#fff3c0", { emissive: "#ffd36a" });
  bulbs.userData.maxGlow = 2.4;
  for (const sx of [-w / 2 - 0.2, w / 2 + 0.2]) cyl(g, 0.08, 3.2, "#5a3e2a", sx, 1.6, pz + 2.0);
  for (let i = 0; i <= 18; i++) {
    const t = i / 18, x = -w / 2 - 0.2 + t * (w + 0.4), y = 3.1 - Math.sin(t * Math.PI) * 0.6;
    sph(g, 0.09, bulbs, x, y, pz + 2.0, { lo: true, shadow: false });
  }
  for (let i = 0; i <= 10; i++) { const t = i / 10; sph(g, 0.09, bulbs, -w / 2 - 0.2 + t * 0.1, 3.1 - t * 0.2, d / 2 + 0.2 + t * 1.8, { lo: true, shadow: false }); }
  // a kettle sign hanging on a bracket
  box(g, 0.08, 0.08, 1.2, "#3a2a20", w / 4 + 1.8, 3.2, d / 2 + 0.6);
  sph(g, 0.35, "#5a4a3a", w / 4 + 1.8, 2.75, d / 2 + 1.1, { sy: 0.8 });
}

function makeCottage(c) {
  const b = { ...c, ...L.COTTAGE_SIZE, trim: new THREE.Color(c.roof).multiplyScalar(0.7).getStyle(), kind: "cottage", sign: null, awning: null };
  const g = new THREE.Group();
  g.position.set(c.x, 0, c.z);
  g.rotation.y = ROT[c.face];
  const side = c.face === "e" || c.face === "w";
  const w = side ? b.d : b.w, d = side ? b.w : b.d, h = b.h;
  box(g, w + 0.3, 0.4, d + 0.3, "#c9bba8", 0, 0.2, 0);
  box(g, w, h, d, c.wall, 0, h / 2 + 0.2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.22, h, 0.22, b.trim, sx * w / 2, h / 2 + 0.2, sz * d / 2);
  gableRoof(g, w, d, h + 0.2, 2.1, c.roof, c.wall, 0.4);
  door(g, -0.9, d / 2, 0, b.trim, 1.75);
  windowAt(g, 1.3, 1.6, d / 2, 0, { shutter: c.roof, flowers: ["#ff7aa8", "#ffd76a", "#ffffff"] });
  windowAt(g, 0, h + 1.0, d / 2 - 0.2, 0, { w: 0.7, h: 0.7 });
  for (const sx of [-1, 1]) windowAt(g, sx * w / 2, 1.6, 0, sx * Math.PI / 2, { w: 0.8, h: 0.9 });
  chimney(g, w / 2 - 0.9, h + 1.3, -0.6, "#c8b0a0");
  // a little front garden with a picket fence and a name plate
  const fz = d / 2 + 2.6;
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.5) if (Math.abs(x + 0.9) > 0.7) box(g, 0.12, 0.7, 0.07, "#ffffff", x, 0.35, fz);
  for (const y of [0.25, 0.55]) {
    const l0 = -w / 2, l1 = -1.6, r0 = -0.2, r1 = w / 2;
    box(g, l1 - l0, 0.07, 0.05, "#ffffff", (l0 + l1) / 2, y, fz);
    box(g, r1 - r0, 0.07, 0.05, "#ffffff", (r0 + r1) / 2, y, fz);
  }
  for (let i = 0; i < 6; i++) sph(g, R(0.18, 0.28), ["#ff7aa8", "#ffd76a", "#ffffff", "#c8a0ff", "#ff9a6a"][i % 5], R(0.4, w / 2 - 0.4), 0.25, R(d / 2 + 0.7, fz - 0.4), { lo: true });
  sph(g, 0.6, "#6aba6a", -w / 2 + 0.6, 0.45, d / 2 + 1.2, { lo: true });
  // mailbox with the owner's name
  if (c.id !== "player") {
    cyl(g, 0.05, 1.0, "#8a5a3a", -2.1, 0.5, fz + 0.3);
    box(g, 0.5, 0.35, 0.3, c.roof, -2.1, 1.1, fz + 0.3);
  }
  staticRoot.add(g);
}

// ---------- the fountain, market, dock, firepit, gate, bridge ----------

const fountainDrops = [];
function buildFountain() {
  const g = new THREE.Group(); g.position.set(L.FOUNTAIN.x, 0, L.FOUNTAIN.z); staticRoot.add(g);
  cyl(g, 2.6, 0.7, "#e8e0f0", 0, 0.35, 0, {});
  cyl(g, 2.25, 0.2, "#d8d0e8", 0, 0.72, 0, {});
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.25, 32).rotateX(-Math.PI / 2), toon("#8ad8f0"));
  water.position.y = 0.66; g.add(water);
  cyl(g, 0.35, 1.6, "#e8e0f0", 0, 1.3, 0, {});
  cyl(g, 1.1, 0.25, "#e8e0f0", 0, 2.1, 0, {});
  sph(g, 0.35, "#ffd0e0", 0, 2.6, 0);
  const geo = new THREE.SphereGeometry(0.07, 6, 5);
  const mat = toon("#bfefff");
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(geo, mat); m.userData = { t: Math.random(), a: Math.random() * Math.PI * 2 }; dynamicRoot.add(m); fountainDrops.push(m); }
  // benches around the plaza
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, r = 7.6;
    const bg = new THREE.Group(); bg.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); bg.rotation.y = -a - Math.PI / 2; staticRoot.add(bg);
    box(bg, 1.8, 0.12, 0.55, "#c98a5a", 0, 0.5, 0);
    box(bg, 1.8, 0.45, 0.1, "#c98a5a", 0, 0.85, -0.25);
    for (const sx of [-0.75, 0.75]) box(bg, 0.12, 0.5, 0.5, "#4a4a58", sx, 0.25, 0);
    L.OBSTACLES.push({ x: bg.position.x, z: bg.position.z, r: 0.7 });
  }
  // flower beds
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, r = 5.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    cyl(staticRoot, 1.1, 0.4, "#c9bba8", x, 0.2, z, {});
    for (let k = 0; k < 9; k++) sph(staticRoot, 0.2, ["#ff7aa8", "#ffd76a", "#ffffff", "#c8a0ff"][k % 4], x + R(-0.7, 0.7), 0.5, z + R(-0.7, 0.7), { lo: true });
    L.OBSTACLES.push({ x, z, r: 1.1 });
  }
  // bunting across the plaza
  const flagGeo = new THREE.ConeGeometry(0.22, 0.45, 3);
  flagGeo.rotateX(Math.PI);
  const cols = ["#ff8fb8", "#ffd76a", "#8ad0ff", "#9ae0a8", "#c8a0ff"];
  for (const [a, b] of [[[-9, -6], [9, 6]], [[-9, 6], [9, -6]]]) {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = 8.2 - Math.sin(t * Math.PI) * 1.0;
      const f = mesh(flagGeo, toon(cols[i % cols.length]), staticRoot, x, y - 0.25, z, { shadow: false });
      f.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    }
    for (const p of [a, b]) cyl(staticRoot, 0.08, 8.4, "#ffffff", p[0], 4.2, p[1]);
  }
}

function buildMarket() {
  for (const s of L.MARKET_STALLS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); g.rotation.y = s.rot; staticRoot.add(g);
    box(g, 3.4, 0.9, 1.4, "#c98a5a", 0, 0.45, 0);
    box(g, 3.6, 0.1, 1.6, "#e8b07a", 0, 0.95, 0);
    for (const sx of [-1.65, 1.65]) for (const sz of [-0.7, 0.7]) cyl(g, 0.06, 2.6, "#8a5a3a", sx, 1.3, sz);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.0), new THREE.MeshToonMaterial({ map: stripeTex(s.colors[0], s.colors[1], 10), gradientMap: toon("#fff").gradientMap, side: THREE.DoubleSide }));
    roof.position.set(0, 2.75, 0.1); roof.rotation.x = -Math.PI / 2 + 0.25; roof.castShadow = true; g.add(roof);
    const fruit = [["#ff5a5a", "#ffd04a", "#8ad04a"], ["#ff9a3a", "#ffe08a"], ["#a05ac8", "#ff7a9a"], ["#8ad04a", "#d84a4a"]][Math.floor(rnd() * 4)];
    for (let i = 0; i < 3; i++) {
      box(g, 0.9, 0.3, 0.7, "#b07a4a", -1.1 + i * 1.1, 1.15, 0.1);
      for (let k = 0; k < 6; k++) sph(g, 0.13, fruit[k % fruit.length], -1.1 + i * 1.1 + R(-0.3, 0.3), 1.38, 0.1 + R(-0.22, 0.22), { lo: true, shadow: false });
    }
    for (let i = 0; i < 2; i++) box(g, 0.7, 0.6, 0.7, "#b07a4a", R(-1.4, 1.4), 0.3, 1.1, { ry: R(0, 1) });
  }
  // Odette's scale
  const sg = new THREE.Group(); sg.position.set(20, 1.0, -4.3); staticRoot.add(sg);
  cyl(sg, 0.04, 0.6, "#e8c36a", 0, 0.3, 0);
  box(sg, 0.8, 0.04, 0.04, "#e8c36a", 0, 0.6, 0);
  for (const sx of [-0.38, 0.38]) cyl(sg, 0.16, 0.04, "#e8c36a", sx, 0.42, 0);
}

function buildDock() {
  const g = new THREE.Group(); g.position.set(L.DOCK.x, 0, L.DOCK.z); staticRoot.add(g);
  for (let i = 0; i < 26; i++) box(g, L.DOCK.w, 0.12, 0.42, i % 2 ? "#c9955a" : "#b8844a", 0, 0.18, 2.6 - i * 0.5);
  for (let i = 0; i <= 4; i++) for (const sx of [-1, 1]) cyl(g, 0.14, 1.6, "#8a5a34", sx * (L.DOCK.w / 2 + 0.05), -0.2, 2.6 - i * 3);
  // a rowboat
  const boat = new THREE.Group(); boat.position.set(3.2, -0.15, -6); boat.rotation.y = 0.4; g.add(boat);
  sph(boat, 1, "#e86f6f", 0, 0, 0, { sx: 0.9, sy: 0.35, sz: 2.0 });
  sph(boat, 0.95, "#fff3e0", 0, 0.12, 0, { sx: 0.75, sy: 0.25, sz: 1.8 });
  animated.push({ update: (t) => { boat.position.y = -0.15 + Math.sin(t * 1.2) * 0.05; boat.rotation.z = Math.sin(t * 0.9) * 0.04; } });
  // lily pads and reeds
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = R(0.6, 0.95);
    const x = L.LAKE.x + Math.cos(a) * L.LAKE.rx * r, z = L.LAKE.z + Math.sin(a) * L.LAKE.rz * r;
    if (Math.abs(x - L.DOCK.x) < 3) continue;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(R(0.35, 0.6), 12, 0.3, Math.PI * 1.85).rotateX(-Math.PI / 2), toon("#6ab86a"));
    pad.position.set(x, -0.2, z); pad.rotation.y = rnd() * 6; staticRoot.add(pad);
    if (i % 4 === 0) sph(staticRoot, 0.12, "#ffb3d0", x, -0.1, z, { lo: true });
  }
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, r = R(1.0, 1.08);
    const x = L.LAKE.x + Math.cos(a) * L.LAKE.rx * r, z = L.LAKE.z + Math.sin(a) * L.LAKE.rz * r;
    if (Math.hypot(x - L.DOCK.x, z - (L.DOCK.z + 1)) < 4 || Math.abs(x - 26) < 4) continue;
    for (let k = 0; k < 3; k++) cyl(staticRoot, 0.04, R(0.8, 1.4), "#5a9a5a", x + R(-0.3, 0.3), 0.4, z + R(-0.3, 0.3), { rz: R(-0.15, 0.15) });
  }
}

export const firepit = { torches: [], fireLight: null, flames: [], stumps: [] };
function buildFirepit() {
  const g = new THREE.Group(); g.position.set(L.FIREPIT.x, 0, L.FIREPIT.z); staticRoot.add(g);
  // packed earth circle
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(L.FIREPIT.r + 1.4, 40).rotateX(-Math.PI / 2), toon("#d8b88a"));
  dirt.position.y = 0.035; dirt.receiveShadow = true; g.add(dirt);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; sph(g, 0.32, "#9a9aa6", Math.cos(a) * 1.2, 0.15, Math.sin(a) * 1.2, { sy: 0.6 }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; cyl(g, 0.13, 1.4, "#7a4a2a", Math.cos(a) * 0.4, 0.25, Math.sin(a) * 0.4, { rz: Math.PI / 2 - 0.3, ry: a }); }
  // the stumps, placed later around the ring by the vote scene as needed; draw 12 now
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * 4.4, z = Math.sin(a) * 4.4;
    cyl(g, 0.45, 0.5, "#a0703e", x, 0.25, z);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), toon("#e8c690"));
    top.position.set(x, 0.51, z); g.add(top);
    firepit.stumps.push({ x: L.FIREPIT.x + x, z: L.FIREPIT.z + z, a });
  }
  // the host's podium on the lake side
  const pg = new THREE.Group(); pg.position.set(L.HOST_SPOT.x - L.FIREPIT.x, 0, L.HOST_SPOT.z - L.FIREPIT.z + 0.9); g.add(pg);
  box(pg, 1.2, 1.1, 0.7, "#e86f9a", 0, 0.55, 0);
  box(pg, 1.4, 0.12, 0.9, "#ffffff", 0, 1.14, 0);
  // tall torches around the ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 7.2, z = Math.sin(a) * 7.2;
    cyl(g, 0.08, 2.4, "#5a3e2a", x, 1.2, z);
    cyl(g, 0.2, 0.3, "#3a2a20", x, 2.45, z);
    firepit.torches.push(new THREE.Vector3(L.FIREPIT.x + x, 2.75, L.FIREPIT.z + z));
  }
  firepit.fire = new THREE.Vector3(L.FIREPIT.x, 0.6, L.FIREPIT.z);
  const light = new THREE.PointLight("#ff9a4a", 0, 22, 1.6);
  light.position.set(L.FIREPIT.x, 2, L.FIREPIT.z);
  scene.add(light);
  firepit.fireLight = light;
  // a wooden sign on the path
  const sg = new THREE.Group(); sg.position.set(-14, 0, -27); sg.rotation.y = 0.9; staticRoot.add(sg);
  cyl(sg, 0.07, 1.6, "#7a4a2a", 0, 0.8, 0);
  const s = hangingSign(sg, "Firepit", 0, 1.5, 0.05, 0, { border: "#7a4a2a", fg: "#e8577e" }); s.scale.setScalar(0.6);
}

function buildGate() {
  const g = new THREE.Group(); g.position.set(L.GATE.x, 0, L.GATE.z); staticRoot.add(g);
  for (const sx of [-2.6, 2.6]) { cyl(g, 0.3, 4.2, "#8a5a34", sx, 2.1, 0); sph(g, 0.35, "#e86f9a", sx, 4.35, 0); }
  box(g, 6.2, 0.35, 0.5, "#8a5a34", 0, 3.8, 0);
  const s = hangingSign(g, "Gossiptown", 0, 3.2, 0.3, Math.PI, { border: "#8a5a34", fg: "#e8577e" });
  s.scale.set(1.3, 1.3, 1);
  for (let i = 0; i < 16; i++) sph(g, 0.16, ["#ff7aa8", "#ffffff", "#ffd76a"][i % 3], -2.6 + (i / 15) * 5.2, 4.0 + Math.sin((i / 15) * Math.PI) * 0.15, 0.25, { lo: true });
  // fence along the town edge on either side of the gate
  for (const dir of [-1, 1]) for (let x = 3.4; x < 20; x += 1.2) { box(staticRoot, 0.15, 0.9, 0.15, "#ffffff", dir * x, 0.45, L.GATE.z); box(staticRoot, 1.25, 0.1, 0.06, "#ffffff", dir * (x + 0.6), 0.65, L.GATE.z); }
}

function buildBridge() {
  const g = new THREE.Group(); g.position.set(L.BRIDGE.x, 0, L.BRIDGE.z); g.rotation.y = Math.PI / 2; staticRoot.add(g);
  for (let i = 0; i < 18; i++) { const t = i / 17 - 0.5; box(g, L.BRIDGE.w, 0.15, 0.5, i % 2 ? "#c9955a" : "#b8844a", 0, 0.25 + Math.cos(t * Math.PI) * 0.35, t * L.BRIDGE.len); }
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 6; i++) { const t = i / 6 - 0.5; cyl(g, 0.08, 1.1, "#ffffff", sx * (L.BRIDGE.w / 2), 0.8 + Math.cos(t * Math.PI) * 0.35, t * L.BRIDGE.len); }
    for (let i = 0; i < 6; i++) { const t0 = i / 6 - 0.5, t1 = (i + 1) / 6 - 0.5; const y0 = 1.3 + Math.cos(t0 * Math.PI) * 0.35, y1 = 1.3 + Math.cos(t1 * Math.PI) * 0.35; box(g, 0.1, 0.1, L.BRIDGE.len / 6 + 0.05, "#ffffff", sx * (L.BRIDGE.w / 2), (y0 + y1) / 2, ((t0 + t1) / 2) * L.BRIDGE.len, { rx: -Math.atan2(y1 - y0, L.BRIDGE.len / 6) }); }
  }
}

function buildGarden() {
  // raised beds of herbs and flowers in front of the greenhouse
  const rows = [[-38, 16], [-38, 19.5], [-38, 23], [-33, 15.5]];
  for (const [x, z] of rows) {
    box(staticRoot, 3.2, 0.4, 1.4, "#a8744a", x, 0.2, z);
    box(staticRoot, 3.0, 0.1, 1.2, "#6a4a32", x, 0.42, z);
    for (let i = 0; i < 8; i++) sph(staticRoot, R(0.18, 0.3), ["#6ab06a", "#8acb6a", "#c8a0ff", "#ffd76a", "#ff9ac0"][Math.floor(rnd() * 5)], x - 1.2 + (i % 4) * 0.8, 0.6, z + (i < 4 ? -0.3 : 0.3), { lo: true });
    L.OBSTACLES.push({ x: x - 0.9, z, r: 0.9 }, { x: x + 0.9, z, r: 0.9 });
  }
  // a scarecrow-ish wind chime post and a bee hive
  cyl(staticRoot, 0.06, 2.4, "#7a4a2a", -31, 1.2, 22);
  for (let i = 0; i < 4; i++) cyl(staticRoot, 0.03, R(0.3, 0.6), "#c8d0e0", -31 + (i - 1.5) * 0.12, 1.9, 22);
  for (let i = 0; i < 3; i++) cyl(staticRoot, 0.4 - i * 0.06, 0.35, "#ffd04a", -41, 0.2 + i * 0.32, 26.5);
  L.OBSTACLES.push({ x: -41, z: 26.5, r: 0.6 });
}

// ---------- nature ----------

function instanced(geo, mat, list, { shadow = true } = {}) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((it, i) => {
    o.position.set(it.x, it.y || 0, it.z);
    o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    o.scale.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (it.color) m.setColorAt(i, new THREE.Color(it.color));
  });
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  return m;
}

function clearSpot(x, z, pad) {
  if (L.solidAt(x, z, pad)) return false;
  if (L.onRoad(x, z) || L.onBridge(x, z)) return false;
  for (const p of Object.values(L.PLACE_SPOTS)) if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return false;
  if (Math.hypot(x - L.FIREPIT.x, z - L.FIREPIT.z) < L.FIREPIT.r + 2) return false;
  if (Math.abs(x) < 3 && z > 40) return false;
  return true;
}

function buildNature() {
  const trunks = [], canopies = [], pines = [], pineTrunks = [], bushes = [], flowers = [], stems = [], tufts = [], rocks = [];
  let forest = {};
  const greens = ["#7cc46a", "#6ab45e", "#8fd27a", "#5fa85a", "#9ad67e"], blossom = ["#ffc0d6", "#ffaccb", "#ffd3e2"], autumn = ["#ffb35a", "#ff9a5a", "#ffd06a"];
  const tree = (x, z, s, kind) => {
    const h = 1.6 * s;
    trunks.push({ x, z, y: h / 2, sx: 0.22 * s, sy: h, sz: 0.22 * s });
    const pal = kind === "blossom" ? blossom : kind === "autumn" ? autumn : greens;
    const base = pal[Math.floor(rnd() * pal.length)];
    canopies.push({ x, z, y: h + 0.9 * s, s: 1.25 * s, color: base });
    canopies.push({ x: x + 0.6 * s, z: z + 0.2 * s, y: h + 0.6 * s, s: 0.85 * s, color: base });
    canopies.push({ x: x - 0.5 * s, z: z - 0.3 * s, y: h + 0.75 * s, s: 0.9 * s, color: base });
    canopies.push({ x: x + 0.1 * s, z: z - 0.1 * s, y: h + 1.6 * s, s: 0.75 * s, color: base });
  };
  const pine = (x, z, s) => {
    pineTrunks.push({ x, z, y: 0.6 * s, sx: 0.25 * s, sy: 1.2 * s, sz: 0.25 * s });
    const c = ["#4f9a6a", "#5aa874", "#468a60"][Math.floor(rnd() * 3)];
    for (let k = 0; k < 3; k++) pines.push({ x, z, y: (1.6 + k * 1.1) * s, sx: (1.6 - k * 0.4) * s, sy: 1.8 * s, sz: (1.6 - k * 0.4) * s, color: c });
  };
  // the forest around the valley: no shadows out there, so it is cheap
  const lists = { trunks, canopies, pines, pineTrunks };
  for (let i = 0; i < 650; i++) {
    const x = R(-130, 130), z = R(-150, 120);
    const inside = x > L.BOUNDS.x0 + 4 && x < L.BOUNDS.x1 - 4 && z > L.BOUNDS.z0 + 4 && z < L.BOUNDS.z1 - 4;
    if (inside) continue;
    if (Math.abs(x) < 4 && z > 40 && z < 70) continue; // the road out of town stays clear
    const y = groundHeight(x, z);
    if (y < -0.2) continue;
    const before = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.length]));
    if (rnd() < 0.55) pine(x, z, R(1.1, 1.9)); else tree(x, z, R(1.1, 1.8), rnd() < 0.15 ? "autumn" : "green");
    for (const [k, l] of Object.entries(lists)) for (let j = before[k]; j < l.length; j++) l[j].y += Math.max(0, y);
  }
  forest = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.splice(0)]));
  // trees in town
  let placed = 0;
  for (let i = 0; i < 1400 && placed < 120; i++) {
    const x = R(L.BOUNDS.x0 + 4, L.BOUNDS.x1 - 4), z = R(L.BOUNDS.z0 + 4, L.BOUNDS.z1 - 4);
    if (!clearSpot(x, z, 2.8)) continue;
    if (L.OBSTACLES.some((o) => Math.hypot(o.x - x, o.z - z) < 3.6)) continue;
    const near = Math.hypot(x, z) < 26;
    const s = R(0.9, 1.35);
    if (rnd() < 0.18 && !near) pine(x, z, s); else tree(x, z, s, near && rnd() < 0.45 ? "blossom" : rnd() < 0.08 ? "autumn" : "green");
    L.OBSTACLES.push({ x, z, r: 0.45 * s });
    placed++;
  }
  // bushes, flowers, grass and rocks
  for (let i = 0; i < 1600; i++) {
    const x = R(L.BOUNDS.x0 + 3, L.BOUNDS.x1 - 3), z = R(L.BOUNDS.z0 + 3, L.BOUNDS.z1 - 3);
    if (!clearSpot(x, z, 0.8)) continue;
    const r = rnd();
    if (r < 0.1) { const s = R(0.5, 0.9); bushes.push({ x, z, y: s * 0.5, sx: s * 1.2, sy: s * 0.85, sz: s, color: greens[Math.floor(rnd() * 5)] }); if (s > 0.7) L.OBSTACLES.push({ x, z, r: s * 0.7 }); }
    else if (r < 0.55) { const c = ["#ff7aa8", "#ffd76a", "#ffffff", "#c8a0ff", "#ff9a6a", "#8ad0ff"][Math.floor(rnd() * 6)]; for (let k = 0; k < 4; k++) { const fx = x + R(-0.5, 0.5), fz = z + R(-0.5, 0.5), h = R(0.25, 0.45); flowers.push({ x: fx, z: fz, y: h, s: R(0.09, 0.14), color: c }); stems.push({ x: fx, z: fz, y: h / 2, sx: 0.02, sy: h, sz: 0.02 }); } }
    else if (r < 0.94) for (let k = 0; k < 3; k++) tufts.push({ x: x + R(-0.4, 0.4), z: z + R(-0.4, 0.4), y: 0.15, sx: R(0.06, 0.1), sy: R(0.3, 0.5), sz: R(0.06, 0.1), rz: R(-0.3, 0.3), color: ["#6ab45e", "#7cc46a", "#5fa85a"][k] });
    else { const s = R(0.3, 0.7); rocks.push({ x, z, y: s * 0.3, s, ry: rnd() * 6, color: ["#b8b8c8", "#a8a8b8", "#c8c0c8"][Math.floor(rnd() * 3)] }); if (s > 0.5) L.OBSTACLES.push({ x, z, r: s * 0.7 }); }
  }
  const white = toon("#ffffff");
  instanced(G.cyl6, toon("#9a6a44"), trunks);
  instanced(G.blob, white, canopies);
  instanced(G.cyl6, toon("#7a5a3a"), pineTrunks);
  instanced(G.cone, white, pines);
  instanced(G.cyl6, toon("#9a6a44"), forest.trunks, { shadow: false });
  instanced(G.blob, white, forest.canopies, { shadow: false });
  instanced(G.cyl6, toon("#7a5a3a"), forest.pineTrunks, { shadow: false });
  instanced(G.cone5, white, forest.pines, { shadow: false });
  instanced(G.blob, white, bushes);
  instanced(G.tiny, white, flowers, { shadow: false });
  instanced(G.cyl6, toon("#5a9a5a"), stems, { shadow: false });
  instanced(G.cone5, white, tufts, { shadow: false });
  instanced(G.dode, white, rocks);
}

// lamp posts along the roads
function buildLamps() {
  const posts = [], heads = [];
  const lampMat = toon("#fff6d0", { emissive: "#ffd46a" });
  lampMat.userData.maxGlow = 2.2;
  const add = (x, z) => { if (L.solidAt(x, z, 0.6)) return; posts.push({ x, z, y: 1.5, sx: 0.09, sy: 3, sz: 0.09 }); heads.push({ x, z, y: 3.15, s: 0.28 }); L.OBSTACLES.push({ x, z, r: 0.25 }); };
  for (const r of L.ROADS) for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let d = 5; d < len - 3; d += 12) add(ax + ((bx - ax) * d) / len + nx * (r.w / 2 + 0.7), az + ((bz - az) * d) / len + nz * (r.w / 2 + 0.7));
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(Math.cos(a) * 9.8, Math.sin(a) * 9.8); }
  instanced(G.cyl, toon("#4a4a58"), posts);
  instanced(G.sph, lampMat, heads, { shadow: false });
  return heads;
}

// ---------- ambient life ----------

export const fx = {};
function buildParticles() {
  // drifting petals
  const n = 140;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([R(-50, 50), R(1, 12), R(-50, 40)], i * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const petalTex = canvasTex(32, 32, (g) => { g.fillStyle = "#ffc0d6"; g.beginPath(); g.ellipse(16, 16, 12, 7, 0.6, 0, Math.PI * 2); g.fill(); });
  const petals = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.35, map: petalTex, transparent: true, depthWrite: false }));
  dynamicRoot.add(petals);
  fx.petals = petals;
  // fireflies
  const fgeo = new THREE.BufferGeometry();
  const fpos = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) fpos.set([R(-55, 55), R(0.5, 3), R(-60, 45)], i * 3);
  fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
  const glowTex = canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,200,1)"); gr.addColorStop(1, "rgba(255,220,120,0)"); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
  fx.glowTex = glowTex;
  const flies = new THREE.Points(fgeo, new THREE.PointsMaterial({ size: 0.6, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  dynamicRoot.add(flies);
  fx.flies = flies;
  // chimney smoke
  const smokeTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  fx.smoke = [];
  staticRoot.updateMatrixWorld(true);
  for (const sp of pendingSmoke) {
    const v = new THREE.Vector3(sp.x, sp.y, sp.z);
    sp.p.localToWorld(v);
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5, color: "#f4f0f8" }));
      s.userData = { base: v.clone(), t: k / 5 };
      dynamicRoot.add(s);
      fx.smoke.push(s);
    }
  }
  // fire at the firepit and torches
  const fireTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 40, 0, 32, 36, 30); gr.addColorStop(0, "rgba(255,250,200,1)"); gr.addColorStop(0.35, "rgba(255,170,60,0.9)"); gr.addColorStop(1, "rgba(255,80,40,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  fx.fireTex = fireTex;
  fx.flames = [];
  const flame = (pos, scale, group) => {
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      s.userData = { base: pos.clone(), t: k / 4, scale, group };
      dynamicRoot.add(s);
      fx.flames.push(s);
    }
  };
  flame(firepit.fire, 2.2, "pit");
  firepit.torches.forEach((t, i) => flame(t, 0.8, "torch" + i));
  forgeGlow.forEach((p) => { const v = p.clone(); const b = L.BUILDINGS.find((b) => b.id === "smithy"); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ROT[b.face]); v.x += b.x; v.z += b.z; flame(v, 0.7, "forge"); });
  // butterflies
  fx.butterflies = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const c = ["#ffd76a", "#ff9ac0", "#ffffff", "#8ad0ff"][i % 4];
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), toon(c, { side: THREE.DoubleSide })); w.position.x = s * 0.12; w.userData.side = s; g.add(w); }
    g.userData = { cx: R(-40, 40), cz: R(-30, 35), r: R(2, 6), sp: R(0.3, 0.7), ph: rnd() * 6 };
    dynamicRoot.add(g);
    fx.butterflies.push(g);
  }
}

export const fireState = { pit: 0, torches: [] }; // 0..1 brightness, set by the vote scene

export function updateTown(t, dt, night) {
  waterUniforms.time.value = t;
  waterUniforms.night.value = night;
  for (const a of animated) a.update(t, dt);
  // fountain
  for (const d of fountainDrops) {
    d.userData.t = (d.userData.t + dt * 0.7) % 1;
    const u = d.userData.t, a = d.userData.a;
    d.position.set(Math.cos(a) * u * 1.2, 2.7 + u * 1.2 - u * u * 3.2, Math.sin(a) * u * 1.2);
  }
  // petals drift
  const p = fx.petals.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) + dt * (0.6 + Math.sin(t + i) * 0.3), y = p.getY(i) - dt * 0.35, z = p.getZ(i) + Math.sin(t * 0.7 + i) * dt * 0.3;
    if (y < 0.1) { y = R(8, 12); x = R(-50, 50); z = R(-50, 40); }
    if (x > 55) x = -55;
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  fx.petals.material.opacity = 1 - night;
  // fireflies come out at night
  fx.flies.material.opacity = night * (0.7 + Math.sin(t * 3) * 0.2);
  const f = fx.flies.geometry.attributes.position;
  for (let i = 0; i < f.count; i++) f.setY(i, 1.4 + Math.sin(t * 0.8 + i * 1.7) * 0.9);
  f.needsUpdate = true;
  for (const s of fx.smoke) {
    s.userData.t = (s.userData.t + dt * 0.12) % 1;
    const u = s.userData.t;
    s.position.set(s.userData.base.x + Math.sin(u * 4 + t * 0.3) * 0.3 + u * 1.2, s.userData.base.y + u * 3.5, s.userData.base.z);
    s.scale.setScalar(0.5 + u * 1.6);
    s.material.opacity = 0.45 * (1 - u) * (1 - night * 0.6);
  }
  for (const s of fx.flames) {
    s.userData.t = (s.userData.t + dt * 1.6) % 1;
    const u = s.userData.t, g = s.userData.group;
    const level = g === "pit" ? fireState.pit : g === "forge" ? 0.8 : fireState.torches[+g.slice(5)] ?? 0;
    s.position.set(s.userData.base.x + Math.sin(u * 9 + t) * 0.08 * s.userData.scale, s.userData.base.y + u * 0.7 * s.userData.scale, s.userData.base.z);
    s.scale.setScalar(s.userData.scale * (1 - u * 0.6) * (0.85 + Math.sin(t * 13 + u * 5) * 0.15));
    s.material.opacity = level * (1 - u);
  }
  if (firepit.fireLight) firepit.fireLight.intensity = fireState.pit * (28 + Math.sin(t * 11) * 4 + Math.sin(t * 17) * 3);
  for (const b of fx.butterflies) {
    const u = b.userData;
    const a = t * u.sp + u.ph;
    b.position.set(u.cx + Math.cos(a) * u.r, 1.2 + Math.sin(t * 2 + u.ph) * 0.4, u.cz + Math.sin(a * 1.3) * u.r);
    b.rotation.y = -a;
    for (const w of b.children) w.rotation.y = w.userData.side * (0.4 + Math.sin(t * 18 + u.ph) * 0.9);
    b.visible = night < 0.5;
  }
}

export function setClockHands(minute) {
  if (!clockHands) return;
  clockHands.hr.rotation.z = -((minute / 60) % 12) / 12 * Math.PI * 2;
  clockHands.mn.rotation.z = -(minute % 60) / 60 * Math.PI * 2;
}

// ---------- labels for places ----------

export const placeLabels = Object.entries(L.PLACE_SPOTS).map(([id, p]) => ({ id, name: PLACES[id].short, x: p.x, z: p.z }));

// ---------- bake ----------

function bake() {
  staticRoot.updateMatrixWorld(true);
  const buckets = new Map();
  const keep = [];
  staticRoot.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.map || o.material.transparent && o.material.opacity < 1) { keep.push(o); return; }
    const key = o.material.uuid + (o.castShadow ? "s" : "");
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    let g = o.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    buckets.get(key).geos.push(g);
  });
  const merged = new THREE.Group();
  for (const { mat, cast, geos } of buckets.values()) {
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    merged.add(m);
  }
  for (const o of keep) { o.updateMatrixWorld(true); const w = o.matrixWorld.clone(); o.removeFromParent(); w.decompose(o.position, o.quaternion, o.scale); merged.add(o); }
  scene.remove(staticRoot);
  scene.add(merged);
}

// ---------- the Whisper's notice board ----------
// Anyone can pin an anonymous note here. The pinned notes are drawn live on top.
const boardNotes = new THREE.Group();
function buildBoard() {
  const g = new THREE.Group(); g.position.set(L.BOARD.x, 0, L.BOARD.z); staticRoot.add(g);
  for (const sx of [-1, 1]) cyl(g, 0.08, 2.2, "#7a5236", sx * 0.95, 1.1, 0);
  box(g, 2.2, 1.3, 0.12, "#7a5236", 0, 1.55, 0);
  box(g, 2.0, 1.1, 0.06, "#d9a86a", 0, 1.55, 0.06);
  box(g, 2.5, 0.14, 0.4, "#3a8f8a", 0, 2.3, 0.05);
  // a couple of old notices that never come down
  box(g, 0.42, 0.5, 0.02, "#fffbe8", -0.6, 1.62, 0.1);
  box(g, 0.36, 0.3, 0.02, "#e8f6ff", 0.55, 1.35, 0.1);
  L.OBSTACLES.push({ x: L.BOARD.x - 0.95, z: L.BOARD.z, r: 0.25 }, { x: L.BOARD.x + 0.95, z: L.BOARD.z, r: 0.25 }, { x: L.BOARD.x, z: L.BOARD.z, r: 0.5 });
  boardNotes.position.copy(g.position);
  scene.add(boardNotes);
}
const NOTE_SPOTS = [[-0.1, 1.75, -0.12], [0.3, 1.8, 0.1], [-0.25, 1.3, 0.06], [0.15, 1.38, -0.08], [0.72, 1.82, 0.14], [-0.75, 1.25, -0.1]];
export function setBoardNotes(n) {
  while (boardNotes.children.length > n) boardNotes.remove(boardNotes.children.at(-1));
  while (boardNotes.children.length < Math.min(n, NOTE_SPOTS.length)) {
    const [x, y, rz] = NOTE_SPOTS[boardNotes.children.length];
    const note = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.02), toon("#ffd6e6"));
    note.position.set(x, y, 0.11); note.rotation.z = rz;
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), toon("#e8577e"));
    pin.position.set(0, 0.15, 0.02); note.add(pin);
    boardNotes.add(note);
  }
}

export function buildTown() {
  buildGround();
  buildWater();
  buildRoads();
  for (const b of L.BUILDINGS) makeBuilding(b);
  for (const c of L.COTTAGES) makeCottage(c);
  buildFountain();
  buildMarket();
  buildDock();
  buildFirepit();
  buildGate();
  buildBridge();
  buildGarden();
  buildBoard();
  buildLamps();
  buildNature();
  buildParticles();
  bake();
  L.buildGrid();
}
