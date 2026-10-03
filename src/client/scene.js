// Renderer, lights, sky and the day/night look.

import * as THREE from "three";

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 600);
scene.fog = new THREE.Fog("#cfe9f7", 90, 230);

// ---------- toon materials ----------

const ramp = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const cache = new Map();
export function toon(color, { emissive = null, transparent = false, opacity = 1, side = THREE.FrontSide } = {}) {
  const key = `${color}|${emissive}|${opacity}|${side}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, transparent: transparent || opacity < 1, opacity, side });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0; m.userData.glow = true; }
  cache.set(key, m);
  return m;
}
export const glowMaterials = () => [...cache.values()].filter((m) => m.userData.glow);
export const outlineMat = new THREE.MeshBasicMaterial({ color: "#4a3040", side: THREE.BackSide });

// ---------- lights ----------

export const hemi = new THREE.HemisphereLight("#ffffff", "#8fbf7a", 1.25);
export const sun = new THREE.DirectionalLight("#fff2dc", 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -42; sun.shadow.camera.right = 42; sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
scene.add(hemi, sun, sun.target);

// ---------- sky ----------

const skyUniforms = { top: { value: new THREE.Color("#7cc8f2") }, horizon: { value: new THREE.Color("#fde7f0") }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color("#fff6d8") }, stars: { value: 0 } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float d = max(dot(vDir, normalize(sunDir)), 0.0);
        c += sunColor * (pow(d, 600.0) * 2.5 + pow(d, 12.0) * 0.18);
        vec3 g = floor(vDir * 180.0);
        float st = step(0.9975, hash(g)) * stars * smoothstep(0.05, 0.4, h);
        c += vec3(st);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// puffy clouds
const clouds = new THREE.Group();
{
  const mat = new THREE.MeshToonMaterial({ color: "#ffffff", gradientMap: ramp, transparent: true, opacity: 0.95 });
  const ball = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(ball, mat);
      const s = 3 + Math.random() * 3.5;
      m.scale.set(s, s * 0.7, s);
      m.position.set((k - n / 2) * 3.4 + Math.random(), Math.random() * 1.5, Math.random() * 3 - 1.5);
      c.add(m);
    }
    const a = Math.random() * Math.PI * 2, r = 110 + Math.random() * 120;
    c.position.set(Math.cos(a) * r, 55 + Math.random() * 30, Math.sin(a) * r - 40);
    c.userData.speed = 0.6 + Math.random() * 0.8;
    clouds.add(c);
  }
  scene.add(clouds);
}

// ---------- the time of day ----------
// minute: minutes since midnight. 08:00 morning, 13:00 noon, 18:30 golden hour, 20:00 dusk, 22:00 night.

const KEYS = [
  { m: 6 * 60, top: "#7a86c8", hor: "#ffc4b0", sun: "#ffc890", si: 1.2, hemi: 0.9, sky: "#ffd2b8", exp: 1.0 },
  { m: 9 * 60, top: "#79c4f0", hor: "#fde6ee", sun: "#fff0d8", si: 2.1, hemi: 1.2, sky: "#ffffff", exp: 1.05 },
  { m: 14 * 60, top: "#6cbcf0", hor: "#e8f5fb", sun: "#fff8ea", si: 2.4, hemi: 1.3, sky: "#ffffff", exp: 1.05 },
  { m: 17.5 * 60, top: "#8ab4e8", hor: "#ffd9b8", sun: "#ffc98a", si: 2.0, hemi: 1.15, sky: "#ffe8d0", exp: 1.05 },
  { m: 19.3 * 60, top: "#6a6ab8", hor: "#ff9e8a", sun: "#ff8a6a", si: 1.3, hemi: 0.9, sky: "#ffb0a0", exp: 1.0 },
  { m: 20.2 * 60, top: "#2e3270", hor: "#8a6aa8", sun: "#9a8ad8", si: 0.5, hemi: 0.6, sky: "#8a8ad8", exp: 1.0 },
  { m: 23 * 60, top: "#141836", hor: "#3a3a72", sun: "#8a9ae8", si: 0.35, hemi: 0.45, sky: "#6a7ad0", exp: 1.05 },
];
const ca = new THREE.Color(), cb = new THREE.Color();
const lerpHex = (a, b, t, out) => out.copy(ca.set(a)).lerp(cb.set(b), t);

export const env = { night: 0, minute: 8 * 60 };

export function setTime(minute, focus) {
  env.minute = minute;
  let i = 0;
  while (i < KEYS.length - 2 && minute > KEYS[i + 1].m) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (minute - a.m) / (b.m - a.m)));
  lerpHex(a.top, b.top, t, skyUniforms.top.value);
  lerpHex(a.hor, b.hor, t, skyUniforms.horizon.value);
  lerpHex(a.sun, b.sun, t, sun.color);
  lerpHex(a.sun, b.sun, t, skyUniforms.sunColor.value);
  lerpHex(a.sky, b.sky, t, hemi.color);
  sun.intensity = a.si + (b.si - a.si) * t;
  hemi.intensity = a.hemi + (b.hemi - a.hemi) * t;
  renderer.toneMappingExposure = a.exp + (b.exp - a.exp) * t;
  scene.fog.color.copy(skyUniforms.horizon.value);
  // the sun arcs from east to west
  const dayT = Math.max(0, Math.min(1, (minute - 6 * 60) / (14 * 60)));
  const ang = Math.PI * (0.12 + dayT * 0.76);
  const night = Math.max(0, Math.min(1, (minute - 19.4 * 60) / 70));
  env.night = night;
  const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang) * 0.9 + 0.25, 0.45).normalize();
  skyUniforms.sunDir.value.copy(dir);
  skyUniforms.stars.value = night;
  const fx = focus?.x || 0, fz = focus?.z || 0;
  // at night the "sun" becomes moonlight from a fixed high angle
  const ld = night > 0.5 ? new THREE.Vector3(-0.4, 0.9, 0.3).normalize() : dir;
  sun.position.set(fx + ld.x * 70, ld.y * 70, fz + ld.z * 70);
  sun.target.position.set(fx, 0, fz);
  for (const m of glowMaterials()) m.emissiveIntensity = Math.max(0, Math.min(1, (minute - 18.6 * 60) / 50)) * (m.userData.maxGlow ?? 1.4);
}

export function updateSky(dt) {
  for (const c of clouds.children) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 240) c.position.x = -240;
  }
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
