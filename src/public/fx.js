// The renderer and the camera effects: soft shadows, a gentle glow on lights, a
// tilt-shift blur at the top and bottom of the screen (it makes the town look like a
// small model), a vignette, and a sky that changes colour through the day.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

export function makeRenderer(holder) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  holder.appendChild(renderer.domElement);
  return renderer;
}

// a little colour lift after tone mapping: a touch more saturation and warmth
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.12 }, warmth: { value: 0.02 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float saturation; uniform float warmth; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb += vec3(warmth, warmth * 0.4, -warmth * 0.6);
      gl_FragColor = c;
    }`,
};

export function makeComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.55, 0.88);
  composer.addPass(bloom);
  const tiltH = new ShaderPass(HorizontalTiltShiftShader);
  const tiltV = new ShaderPass(VerticalTiltShiftShader);
  tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.52;
  composer.addPass(tiltH); composer.addPass(tiltV);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 0.95; vignette.uniforms.darkness.value = 1.05;
  composer.addPass(vignette);
  return {
    composer, bloom, grade,
    setSize(w, h) {
      composer.setSize(w, h);
      tiltH.uniforms.h.value = 1.6 / w;
      tiltV.uniforms.v.value = 1.6 / h;
    },
  };
}

// A big sphere around everything, painted with a gradient from the horizon up.
export function makeSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color("#8fd0f6") }, bottom: { value: new THREE.Color("#fde6ee") } },
    vertexShader: `varying vec3 vPos; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
      void main() { float h = clamp(normalize(vPos - cameraPosition).y * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat);
  scene.add(sky);
  return sky;
}

// Light and colour through the day. minute: minutes since midnight.
const KEYS = [
  { m: 7 * 60,  sun: "#ffd2b0", sunI: 1.6, hemi: 1.15, top: "#9ccdf0", bottom: "#ffe2d6", fog: "#f6e0e0", bloom: 0.25 },
  { m: 10 * 60, sun: "#fff4e4", sunI: 2.4, hemi: 1.35, top: "#86c8f4", bottom: "#e8f6ff", fog: "#e2f2fc", bloom: 0.22 },
  { m: 15 * 60, sun: "#fff0dc", sunI: 2.3, hemi: 1.3,  top: "#8acaf2", bottom: "#f2f4ff", fog: "#e8f0fa", bloom: 0.22 },
  { m: 18 * 60, sun: "#ffb27a", sunI: 1.9, hemi: 1.05, top: "#f0a8c0", bottom: "#ffd8a8", fog: "#f8d4c4", bloom: 0.35 },
  { m: 19 * 60 + 30, sun: "#c8a0ff", sunI: 0.9, hemi: 0.75, top: "#4a4a9a", bottom: "#d88aa8", fog: "#8a78a8", bloom: 0.6 },
  { m: 21 * 60, sun: "#9ab0ff", sunI: 0.45, hemi: 0.55, top: "#1e2458", bottom: "#4a4a86", fog: "#3a3a6a", bloom: 0.85 },
];
const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
export function lightAt(minute) {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].m <= minute) i++;
  const a = KEYS[i], b = KEYS[Math.min(KEYS.length - 1, i + 1)];
  const t = a === b ? 0 : Math.max(0, Math.min(1, (minute - a.m) / (b.m - a.m)));
  const n = (k) => a[k] + (b[k] - a[k]) * t;
  return { sun: lerpC(a.sun, b.sun, t), sunI: n("sunI"), hemi: n("hemi"), top: lerpC(a.top, b.top, t), bottom: lerpC(a.bottom, b.bottom, t), fog: lerpC(a.fog, b.fog, t), bloom: n("bloom"), night: Math.max(0, Math.min(1, (minute - 18.5 * 60) / 90)) };
}
