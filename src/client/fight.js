// The cartoon cat fight: a rolling dust cloud with arms, stars and comic-book words
// flying out of it, while the two women inside jostle about.

import * as THREE from "three";
import { scene, toon, outlineMat } from "./scene.js";
import * as B from "./bubbles.js";

const puffGeo = new THREE.IcosahedronGeometry(1, 1);
const PUFF = ["#fff6ea", "#f6e6d2", "#ffffff", "#efdcc6"];
const WORDS = ["POW!", "SLAP!", "YANK!", "BAP!", "OOF!", "HMPH!", "SCRATCH!", "THWAP!"];

// Starts a cloud over two walkers. Returns { update(dt), stop() }; stop() removes it.
export function dustCloud(wa, wb, { ida, idb } = {}) {
  const g = new THREE.Group();
  const centre = () => new THREE.Vector3((wa.x + wb.x) / 2, 0, (wa.z + wb.z) / 2);
  g.position.copy(centre());
  const puffs = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(puffGeo, toon(PUFF[i % PUFF.length]));
    const o = new THREE.Mesh(puffGeo, outlineMat);
    o.scale.setScalar(1.06); m.add(o);
    m.userData = { a: (i / 9) * Math.PI * 2, r: 0.55 + Math.random() * 0.35, y: 0.5 + Math.random() * 1.0, s: 0.45 + Math.random() * 0.3, sp: 3 + Math.random() * 3 };
    m.renderOrder = 3;
    g.add(m); puffs.push(m);
  }
  // a flailing arm or two poking out
  const arms = [];
  for (let i = 0; i < 2; i++) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 8), toon(i ? "#f4c7a8" : "#e8b48f"));
    arm.renderOrder = 3; g.add(arm); arms.push(arm);
  }
  scene.add(g);
  const home = { a: { x: wa.x, z: wa.z }, b: { x: wb.x, z: wb.z } };
  let t = 0, nextWord = 0.2;
  return {
    update(dt) {
      t += dt;
      g.position.lerp(centre(), Math.min(1, dt * 4));
      for (const p of puffs) {
        const u = p.userData;
        u.a += dt * u.sp * 0.6;
        const k = 1 + Math.sin(t * 9 + u.a * 3) * 0.18;
        p.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t * 7 + u.a) * 0.15, Math.sin(u.a) * u.r);
        p.scale.setScalar(u.s * k);
      }
      arms.forEach((arm, i) => {
        const a = t * (6 + i * 2.3) + i * 2;
        arm.position.set(Math.cos(a) * 0.95, 1.0 + Math.sin(t * 11 + i) * 0.3, Math.sin(a) * 0.95);
        arm.rotation.set(Math.sin(t * 13 + i) * 1.2, a, Math.PI / 2 + Math.sin(t * 8) * 0.5);
      });
      // the two inside bump about
      const j = (w, h, ph) => { w.x = h.x + Math.sin(t * 17 + ph) * 0.16; w.z = h.z + Math.cos(t * 13 + ph) * 0.16; w.heading += dt * 9; };
      j(wa, home.a, 0); j(wb, home.b, 2);
      if ((nextWord -= dt) < 0) {
        nextWord = 0.35 + Math.random() * 0.35;
        const id = Math.random() < 0.5 ? ida : idb;
        if (id) Math.random() < 0.7 ? B.pop(id, WORDS[Math.floor(Math.random() * WORDS.length)]) : B.emote(id, Math.random() < 0.5 ? "star" : "anger");
      }
    },
    stop() {
      scene.remove(g);
      wa.x = home.a.x; wa.z = home.a.z; wb.x = home.b.x; wb.z = home.b.z;
    },
  };
}
