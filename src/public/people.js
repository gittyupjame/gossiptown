// The people of Thistlewick: round little 3D women with big heads, faces that change
// with their mood, their own hair, outfits and accessories, and simple animations
// (walking, breathing, blinking, talking, gesturing). Also the little icons that pop up
// over heads, and portrait pictures for the menus.

import * as THREE from "three";
import { toon, outline, at } from "./town.js";

// Hair styles: long, waves, bob, bun, ponytail, pigtails, curly, pixie, updo.
// Patterns on the dress: dots, stripes, or plain.
export const LOOKS = {
  player:   { skin: "#ffe0cc", hair: "#7a4a32", style: "ponytail", dress: "#5ec8c0", trim: "#ffffff", top: "#ffd86a", bow: "#ff7aa8", color: "#ff7aa8" },
  vivienne: { skin: "#fbe2d2", hair: "#f4dc8a", style: "waves", dress: "#b48cf0", trim: "#ffe8a0", pearls: true, shades: "#3a2a3a", color: "#b48cf0", height: 1.04 },
  pippa:    { skin: "#ffdcc0", hair: "#ff9a5a", style: "pigtails", dress: "#ff9ac0", trim: "#ffffff", pattern: "dots", bow: "#ff5a8a", color: "#ff9ac0", height: 0.94 },
  ivy:      { skin: "#e8b48a", hair: "#3a2228", style: "curly", dress: "#ff5a7a", trim: "#ffd86a", hoops: "#ffd86a", color: "#ff5a7a" },
  wren:     { skin: "#ffe2cc", hair: "#d8583a", style: "bun", dress: "#d84a6a", trim: "#fff2e0", pattern: "stripes", apron: "#fff4ea", color: "#d84a6a" },
  sylvie:   { skin: "#f6d8bc", hair: "#2e2438", style: "pixie", dress: "#5a6a8a", trim: "#2e2438", beanie: "#ffb84a", color: "#ffb84a" },
  marigold: { skin: "#ffe6d4", hair: "#f8c860", style: "bob", dress: "#ffc4d4", trim: "#ffffff", apron: "#ffffff", headband: "#ff8fb0", color: "#f8c860" },
  odette:   { skin: "#f0caa8", hair: "#4a3a4a", style: "updo", dress: "#4a7ac0", trim: "#ffd86a", glasses: true, color: "#4a7ac0", height: 1.03 },
  juniper:  { skin: "#d8a47e", hair: "#8a9a4a", style: "long", dress: "#9ad07a", trim: "#ffffff", crown: true, color: "#9ad07a" },
  hesper:   { skin: "#f6dccc", hair: "#eeeaf4", style: "updo", dress: "#6a5aa8", trim: "#ffd86a", shawl: "#c8b8e8", glasses: true, color: "#6a5aa8", height: 1.02 },
  honey:    { skin: "#ffe0c8", hair: "#ffd060", style: "waves", dress: "#ffd84f", trim: "#ff6a9a", sash: "#ff6a9a", color: "#ffd84f", height: 1.05 },
};

const m = (color, extra) => toon(color, extra);
const part = (geo, color, cast = true) => { const x = new THREE.Mesh(geo, typeof color === "string" ? m(color) : color); x.castShadow = cast; return x; };
const sphere = (r, c, w = 20, h = 14) => part(new THREE.SphereGeometry(r, w, h), c);
const capsule = (r, l, c) => part(new THREE.CapsuleGeometry(r, l, 6, 12), c);

function dressTex(look) {
  if (!look.pattern) return null;
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = look.dress; g.fillRect(0, 0, 128, 64);
  g.fillStyle = look.trim;
  if (look.pattern === "dots") for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { g.beginPath(); g.arc(x * 16 + (y % 2) * 8 + 4, y * 16 + 8, 3.5, 0, 7); g.fill(); }
  if (look.pattern === "stripes") for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 6, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makePerson(look) {
  const root = new THREE.Group();   // stands on the ground
  const body = new THREE.Group();   // turns to face where she walks, and bobs
  root.add(body);
  body.scale.setScalar(look.height || 1);

  // a soft round shadow under her feet
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: "#3a2a3a", transparent: true, opacity: 0.2, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015;
  root.add(sh);

  // legs and shoes
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.085, 0.3, 0);
    hip.add(at(capsule(0.052, 0.16, look.skin), 0, -0.13, 0));
    const shoe = sphere(0.075, "#6a4a5a", 12, 8); shoe.scale.set(1, 0.65, 1.35);
    hip.add(at(shoe, 0, -0.26, 0.03));
    body.add(hip); legs.push(hip);
  }
  // the dress: a bell shape turned on a lathe
  const prof = [[0.0, 0.2], [0.27, 0.22], [0.29, 0.26], [0.25, 0.4], [0.2, 0.55], [0.17, 0.68], [0.15, 0.78], [0.1, 0.82], [0.0, 0.83]].map(([x, y]) => new THREE.Vector2(x, y));
  const tex = dressTex(look);
  if (tex) tex.repeat.set(4, 2);
  const dress = outline(part(new THREE.LatheGeometry(prof, 28), tex ? m("#ffffff", { map: tex }) : look.dress), 0.04);
  body.add(dress);
  { const hem = at(part(new THREE.TorusGeometry(0.275, 0.025, 8, 28), look.trim), 0, 0.23, 0); hem.rotation.x = Math.PI / 2; body.add(hem); }
  if (look.top) { const top = part(new THREE.CylinderGeometry(0.16, 0.2, 0.26, 20), look.top); top.position.y = 0.68; body.add(top); }
  if (look.apron) { const ap = part(new THREE.SphereGeometry(0.27, 16, 10, -0.7, 1.4, 0.75, 0.9), look.apron); ap.position.y = 0.58; body.add(ap); }
  if (look.shawl) { const s = part(new THREE.SphereGeometry(0.24, 18, 10, 0, Math.PI * 2, 0.35, 0.9), look.shawl); s.position.y = 0.72; body.add(s); }
  if (look.sash) { const s = part(new THREE.TorusGeometry(0.21, 0.035, 6, 20), look.sash); s.position.y = 0.58; s.rotation.set(Math.PI / 2, 0.6, 0); body.add(s); }
  if (look.pearls) for (let i = 0; i < 9; i++) { const a = Math.PI * (0.15 + (i / 8) * 0.7); body.add(at(sphere(0.022, "#ffffff", 6, 4), Math.cos(a) * 0.12, 0.8 - Math.sin(a) * 0.05, Math.sin(a) * 0.1 + 0.02)); }

  // arms
  const arms = [];
  for (const side of [-1, 1]) {
    const sh2 = new THREE.Group(); sh2.position.set(side * 0.18, 0.74, 0);
    sh2.add(at(capsule(0.045, 0.2, look.top || look.dress), 0, -0.13, 0));
    sh2.add(at(sphere(0.055, look.skin, 10, 8), 0, -0.29, 0));
    sh2.rotation.z = side * 0.18;
    body.add(sh2); arms.push(sh2);
  }

  // the head: big and round
  const head = new THREE.Group(); head.position.y = 1.1;
  body.add(head);
  const skull = outline(sphere(0.34, look.skin, 28, 20), 0.035);
  skull.scale.set(1, 0.96, 0.95);
  head.add(skull);
  hair(head, look);

  // the face
  const face = new THREE.Group(); face.position.z = 0.3;
  head.add(face);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(side * 0.12, -0.01, 0.0);
    const ball = sphere(0.062, "#3a2632", 16, 12); ball.scale.set(0.82, 1.08, 0.45);
    eye.add(ball);
    eye.add(at(sphere(0.02, new THREE.MeshBasicMaterial({ color: "#ffffff" }), 8, 6), side * -0.014 + 0.012, 0.025, 0.03));
    eye.add(at(sphere(0.009, new THREE.MeshBasicMaterial({ color: "#ffffff" }), 6, 4), -0.015, -0.02, 0.03));
    const lash = part(new THREE.BoxGeometry(0.05, 0.012, 0.01), "#3a2632", false); lash.position.set(side * 0.05, 0.05, 0.02); lash.rotation.z = side * -0.5;
    eye.add(lash);
    face.add(eye); eyes.push(eye);
  }
  const brows = [-1, 1].map((side) => { const b = part(new THREE.CapsuleGeometry(0.012, 0.07, 4, 6), look.hair === "#eeeaf4" ? "#b8b0c8" : look.hair, false); b.rotation.z = Math.PI / 2; b.position.set(side * 0.12, 0.1, 0.0); face.add(b); return b; });
  for (const side of [-1, 1]) { const bl = sphere(0.05, m("#ff9aa8", { transparent: true, opacity: 0.6 }), 12, 8); bl.scale.set(1.2, 0.6, 0.3); bl.position.set(side * 0.19, -0.085, -0.02); face.add(bl); }
  // mouths for each mood; only one shows at a time
  const mouths = {
    smile: part(new THREE.TorusGeometry(0.04, 0.01, 6, 14, Math.PI), "#8a3a4a", false),
    open: sphere(0.035, "#a83a5a", 12, 8),
    smirk: part(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI * 0.7), "#8a3a4a", false),
    frown: part(new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI), "#8a3a4a", false),
    o: part(new THREE.TorusGeometry(0.025, 0.01, 6, 12), "#8a3a4a", false),
  };
  mouths.smile.rotation.z = Math.PI; mouths.smile.position.set(0, -0.08, 0.02);
  mouths.open.scale.set(1.1, 0.8, 0.4); mouths.open.position.set(0, -0.1, 0.0);
  mouths.smirk.rotation.z = Math.PI * 1.15; mouths.smirk.position.set(0.02, -0.09, 0.02);
  mouths.frown.position.set(0, -0.115, 0.02);
  mouths.o.position.set(0, -0.1, 0.02);
  for (const k in mouths) { mouths[k].visible = k === "smile"; face.add(mouths[k]); }
  accessories(head, look);

  // a see-through silhouette that only shows when she is behind a wall or a roof
  const ghost = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0.5, depthFunc: THREE.GreaterDepth, depthWrite: false });
  for (const src of [skull, dress]) { const gm = new THREE.Mesh(src.geometry, ghost); gm.renderOrder = 5; gm.castShadow = false; src.add(gm); }

  return { root, body, legs, arms, head, eyes, brows, mouths, mood: "happy", talkUntil: 0, gestureUntil: 0, blinkAt: Math.random() * 4 };
}

function hair(head, look) {
  const H = m(look.hair);
  const add = (mesh) => { mesh.castShadow = true; head.add(mesh); return mesh; };
  // the top of the head and the back
  add(outline(new THREE.Mesh(new THREE.SphereGeometry(0.36, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), H), 0.03)).scale.set(1.0, 1.0, 0.98);
  const backLen = { long: 0.85, waves: 0.85, bob: 0.7, curly: 0.75, pixie: 0.55 }[look.style] ?? 0.62;
  add(new THREE.Mesh(new THREE.SphereGeometry(0.355, 28, 16, Math.PI, Math.PI, 0, Math.PI * backLen), H));
  // a fringe of little rounded locks across the forehead
  const fringe = look.style === "updo" ? 3 : 5;
  for (let i = 0; i < fringe; i++) {
    const a = -0.9 + (1.8 * i) / (fringe - 1);
    const lock = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), H));
    lock.scale.set(1.1, 0.75, 0.6);
    lock.position.set(Math.sin(a) * 0.27, 0.2 - Math.abs(a) * 0.05, Math.cos(a) * 0.2);
  }
  const s = look.style;
  if (s === "long" || s === "waves") {
    const back = add(outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.35, 6, 16), H), 0.03)); back.position.set(0, -0.32, -0.12); back.scale.set(1.1, 1, 0.6);
    for (const side of [-1, 1]) { const lock = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 4, 10), H)); lock.position.set(side * 0.3, -0.2, 0.06); }
    if (s === "waves") for (let i = 0; i < 5; i++) { const c = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), H)); c.position.set(-0.24 + i * 0.12, -0.56, -0.1); }
  }
  if (s === "bob") for (const side of [-1, 1]) { const b = add(outline(new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), H), 0.04)); b.scale.set(0.7, 1.15, 1.1); b.position.set(side * 0.29, -0.12, -0.03); }
  if (s === "bun" || s === "updo") { const b = add(outline(new THREE.Mesh(new THREE.SphereGeometry(s === "updo" ? 0.2 : 0.16, 16, 12), H), 0.05)); b.position.set(0, s === "updo" ? 0.38 : 0.32, -0.12); if (s === "updo") b.scale.set(1, 1.25, 1); }
  if (s === "ponytail") { const t = add(outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 12), H), 0.05)); t.position.set(0, -0.05, -0.38); t.rotation.x = 0.5; }
  if (s === "pigtails") for (const side of [-1, 1]) { const t = add(outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.22, 6, 12), H), 0.05)); t.position.set(side * 0.38, -0.05, -0.04); t.rotation.z = side * 0.4; }
  if (s === "curly") for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const c = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), H)); c.position.set(Math.cos(a) * 0.33, -0.05 + Math.sin(i * 1.7) * 0.15, Math.sin(a) * 0.25 - 0.08); }
}

function accessories(head, look) {
  const add = (mesh) => { head.add(mesh); return mesh; };
  if (look.bow) for (const side of [-1, 1]) { const b = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), m(look.bow))); b.scale.set(1.3, 0.85, 0.5); b.position.set(side * 0.1, 0.33, -0.05 + (look.style === "ponytail" ? -0.2 : 0)); }
  if (look.headband) { const t = add(new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 28, Math.PI), m(look.headband))); t.rotation.set(0, Math.PI / 2, 0); t.position.y = 0.06; t.rotation.x = -0.25; }
  if (look.beanie) { const b = add(outline(new THREE.Mesh(new THREE.SphereGeometry(0.37, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.38), m(look.beanie)), 0.03)); b.position.y = 0.04; add(at(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), m("#ffffff")), 0, 0.42, 0)); }
  if (look.shades) { for (const side of [-1, 1]) { const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16), m(look.shades))); l.rotation.x = 1.2; l.position.set(side * 0.11, 0.3, 0.17); } }
  if (look.glasses) for (const side of [-1, 1]) { const r = add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 18), m("#c8a050"))); r.position.set(side * 0.12, -0.01, 0.33); }
  if (look.hoops) for (const side of [-1, 1]) { const r = add(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), m(look.hoops))); r.position.set(side * 0.33, -0.16, 0.02); r.rotation.y = Math.PI / 2; }
  if (look.crown) for (let i = 0; i < 9; i++) { const a = Math.PI * (0.05 + i / 8 * 0.9); const f = add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), m(["#ff9ab8", "#ffffff", "#ffd86a"][i % 3]))); f.position.set(-Math.cos(a) * 0.32, 0.2 + Math.sin(a) * 0.06, Math.sin(a) * 0.12); }
}

// ---------- moods and animation ----------

const BROWS = { happy: [0.1, 0], smug: [0.1, -0.2], angry: [0.07, 0.45], shocked: [0.15, 0], sad: [0.1, -0.35], suspicious: [0.08, 0.25], curious: [0.13, -0.1], neutral: [0.1, 0], sly: [0.09, 0.3] };
const MOUTH = { happy: "smile", smug: "smirk", angry: "frown", shocked: "o", sad: "frown", suspicious: "smirk", curious: "smile", neutral: "smile", sly: "smirk" };

export function setMood(p, mood) { if (mood) p.mood = mood; }

export function animate(p, { walking, t, dt, talking, lookAt }) {
  const swing = walking ? Math.sin(t * 9) * 0.6 : 0;
  p.legs.forEach((l, i) => (l.rotation.x = i ? swing : -swing));
  const gesture = p.gestureUntil > t;
  p.arms.forEach((a, i) => {
    a.rotation.x = walking ? (i ? -swing : swing) * 0.8 : gesture && i === 1 ? -1.1 + Math.sin(t * 6) * 0.25 : 0;
    a.rotation.z = (i ? 1 : -1) * (gesture && i === 1 ? 0.5 : 0.18 + Math.sin(t * 1.3 + i) * 0.03);
  });
  p.body.position.y = walking ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;
  p.body.rotation.x = walking ? 0.06 : 0;
  const breath = 1 + Math.sin(t * 2.2) * 0.012;
  p.body.children[2]?.scale?.set(1, breath, 1);
  p.head.rotation.z = walking ? Math.sin(t * 4.5) * 0.06 : Math.sin(t * 0.9) * 0.05;
  p.head.rotation.y = lookAt ?? Math.sin(t * 0.4) * 0.15;
  // blink
  p.blinkAt -= dt;
  const closed = p.blinkAt < 0.12 && p.blinkAt > 0;
  if (p.blinkAt <= 0) p.blinkAt = 2 + Math.random() * 4;
  for (const e of p.eyes) e.scale.y = closed ? 0.12 : p.mood === "shocked" ? 1.25 : p.mood === "sly" || p.mood === "suspicious" ? 0.7 : 1;
  // eyebrows and mouth follow the mood; the mouth flaps while she talks
  const [by, tilt] = BROWS[p.mood] || BROWS.neutral;
  p.brows.forEach((b, i) => { b.position.y = by; b.rotation.z = Math.PI / 2 + (i ? -tilt : tilt); });
  const want = talking && Math.sin(t * 18) > 0 ? "open" : MOUTH[p.mood] || "smile";
  for (const k in p.mouths) p.mouths[k].visible = k === want;
}

// ---------- icons over heads ----------

const EMOJI = { angry: "💢", shocked: "❗", heart: "💗", handshake: "🤝", sly: "😏", doubt: "🤨", exclaim: "‼️", annoyed: "😤", think: "💭", vote: "🗳️", sparkle: "✨", tea: "☕" };
const iconCache = {};
export function emoteSprite(kind) {
  if (!iconCache[kind]) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(255,255,255,0.92)"; g.beginPath(); g.arc(64, 60, 50, 0, 7); g.fill();
    g.beginPath(); g.moveTo(52, 104); g.lineTo(64, 124); g.lineTo(76, 104); g.fill();
    g.font = "64px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(EMOJI[kind] || "❔", 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    iconCache[kind] = new THREE.SpriteMaterial({ map: t, depthTest: false });
  }
  const s = new THREE.Sprite(iconCache[kind].clone());
  s.scale.set(0.55, 0.55, 1);
  s.renderOrder = 10;
  return s;
}

// ---------- portraits ----------

let pr = null;
export function portrait(look) {
  if (!pr) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(160, 160);
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#ffffff", "#c8b0c0", 2.2));
    const sun = new THREE.DirectionalLight("#ffffff", 1.4); sun.position.set(1, 2, 3); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0.35, 1.25, 2.2); camera.lookAt(0, 1.0, 0);
    pr = { renderer, scene, camera };
  }
  const p = makePerson(look);
  p.root.rotation.y = 0.25;
  pr.scene.add(p.root);
  animate(p, { walking: false, t: 1, dt: 0, talking: false });
  pr.renderer.render(pr.scene, pr.camera);
  const url = pr.renderer.domElement.toDataURL();
  pr.scene.remove(p.root);
  return url;
}
