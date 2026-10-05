// Gossiptown's music and sound, all synthesized live with Web Audio (no sound files):
//   - music: a small sequencer playing a score for each part of the game (title, the
//     day, golden hour, Primrose's show, the vote, cat fights, night), crossfading
//     between them, plus stingers for big moments
//   - voices: every woman babbles in her own voice as her words appear
//   - sounds: footsteps, emotes, the crowd, bells, ballots, fights, the UI
//   - ambience: wind, birds, crickets, the fountain, the river, the tavern, the fire
// Pausing suspends the whole audio graph.

const A = {
  ctx: null, master: null, music: null, sfx: null, amb: null, verb: null, comp: null, noise: null,
  vol: { music: 0.7, sfx: 0.85, muted: false }, paused: false, ready: false,
};
export const audioState = A;

// ---------- setup ----------

export function initAudio(vol) {
  if (vol) Object.assign(A.vol, vol);
  if (A.ctx) { resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  A.ctx = new Ctx();
  buildGraph(A.ctx, A.ctx.destination);
  A.ready = true;
  applyVolumes();
  startAmbience();
  setInterval(tickMusic, 25);
}

// Build the mix: three buses into a gentle compressor, with a shared reverb.
function buildGraph(ctx, out) {
  A.comp = ctx.createDynamicsCompressor();
  A.comp.threshold.value = -14; A.comp.ratio.value = 3; A.comp.attack.value = 0.01; A.comp.release.value = 0.25;
  A.master = ctx.createGain(); A.master.gain.value = 0.9;
  A.comp.connect(A.master); A.master.connect(out);
  A.music = ctx.createGain(); A.sfx = ctx.createGain(); A.amb = ctx.createGain();
  for (const b of [A.music, A.sfx, A.amb]) b.connect(A.comp);
  A.verb = ctx.createConvolver();
  A.verb.buffer = impulse(ctx, 1.8, 2.6);
  const vg = ctx.createGain(); vg.gain.value = 0.32;
  A.verb.connect(vg); vg.connect(A.comp);
  A.noise = noiseBuffer(ctx);
}

function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function impulse(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}

export function setVolumes(v) { Object.assign(A.vol, v); applyVolumes(); }
function applyVolumes() {
  if (!A.ctx) return;
  const t = A.ctx.currentTime, m = A.vol.muted ? 0 : 1;
  A.music.gain.setTargetAtTime(0.34 * A.vol.music * m, t, 0.05);
  A.sfx.gain.setTargetAtTime(0.9 * A.vol.sfx * m, t, 0.05);
  A.amb.gain.setTargetAtTime(0.55 * A.vol.sfx * m, t, 0.05);
}
export function toggleMute() { A.vol.muted = !A.vol.muted; applyVolumes(); return A.vol.muted; }

// Pause stops everything: the music, the voices, the town.
export function setPaused(on) {
  A.paused = on;
  if (!A.ctx) return;
  if (on) A.ctx.suspend().catch(() => {}); else resume();
}
function resume() { if (A.ctx && !A.paused && A.ctx.state !== "running") A.ctx.resume().catch(() => {}); }

const now = () => A.ctx.currentTime;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- building blocks ----------

function osc(ctx, type, f, t) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; }
function gainEnv(ctx, t, a, peak, d, rest = 0.0001) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(rest, t + a + d);
  return g;
}
function noiseSrc(ctx, t, dur) {
  const s = ctx.createBufferSource(); s.buffer = A.noise; s.loop = true;
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  return s;
}
function filt(ctx, type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function send(node, dest, wet = 0) {
  node.connect(dest);
  if (wet > 0) { const g = A.ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(A.verb); }
}
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes.at(-1); }

// ---------- instruments (shared by the music and the sounds) ----------
// Each plays one note at time t into `out`.

const INST = {
  pluck(ctx, out, t, m, dur, v = 0.5) { // a bright, woody ukulele-ish pluck
    const f = mtof(m), g = gainEnv(ctx, t, 0.004, v * 0.5, Math.max(0.25, dur * 1.6));
    const lp = filt(ctx, "lowpass", 3200); lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
    const o1 = osc(ctx, "triangle", f, t), o2 = osc(ctx, "sawtooth", f * 1.003, t); const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); chain(lp, g); send(g, out, 0.15);
    for (const o of [o1, o2]) { o.start(t); o.stop(t + dur * 1.6 + 0.4); }
  },
  marimba(ctx, out, t, m, dur, v = 0.5) {
    const f = mtof(m), g = gainEnv(ctx, t, 0.003, v * 0.55, 0.55), g4 = gainEnv(ctx, t, 0.002, v * 0.16, 0.12);
    const o1 = osc(ctx, "sine", f, t), o4 = osc(ctx, "sine", f * 3.98, t);
    o1.connect(g); o4.connect(g4); send(g, out, 0.22); send(g4, out, 0.1);
    for (const o of [o1, o4]) { o.start(t); o.stop(t + 0.8); }
  },
  glock(ctx, out, t, m, dur, v = 0.4) {
    const f = mtof(m + 12), g = gainEnv(ctx, t, 0.002, v * 0.32, 1.3), gi = gainEnv(ctx, t, 0.002, v * 0.08, 0.35);
    const o1 = osc(ctx, "sine", f, t), oi = osc(ctx, "sine", f * 5.4, t);
    o1.connect(g); oi.connect(gi); send(g, out, 0.35); send(gi, out, 0.2);
    for (const o of [o1, oi]) { o.start(t); o.stop(t + 1.5); }
  },
  musicbox(ctx, out, t, m, dur, v = 0.35) {
    const f = mtof(m + 12) * rnd(0.997, 1.003), g = gainEnv(ctx, t, 0.002, v * 0.3, 1.6), g2 = gainEnv(ctx, t, 0.001, v * 0.07, 0.3);
    const o1 = osc(ctx, "sine", f, t), o2 = osc(ctx, "triangle", f * 4, t);
    o1.connect(g); o2.connect(g2); send(g, out, 0.45); send(g2, out, 0.3);
    for (const o of [o1, o2]) { o.start(t); o.stop(t + 1.8); }
  },
  bass(ctx, out, t, m, dur, v = 0.6) {
    const f = mtof(m), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(v * 0.3, t + Math.min(dur, 0.25)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    const lp = filt(ctx, "lowpass", 520);
    const o1 = osc(ctx, "triangle", f, t), o2 = osc(ctx, "sine", f, t);
    o1.connect(lp); o2.connect(lp); chain(lp, g); g.connect(out);
    for (const o of [o1, o2]) { o.start(t); o.stop(t + dur + 0.12); }
  },
  pad(ctx, out, t, m, dur, v = 0.25) {
    const f = mtof(m), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.12, t + Math.min(0.6, dur * 0.4));
    g.gain.setValueAtTime(v * 0.12, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.9);
    const lp = filt(ctx, "lowpass", 1100);
    for (const d of [-7, 7, 0]) { const o = osc(ctx, d ? "sawtooth" : "triangle", f, t); o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + 1); }
    chain(lp, g); send(g, out, 0.5);
  },
  brass(ctx, out, t, m, dur, v = 0.45) {
    const f = mtof(m), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.32, t + 0.03);
    g.gain.setValueAtTime(v * 0.28, t + Math.max(0.04, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const lp = filt(ctx, "lowpass", 400, 1.2); lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 0.05); lp.frequency.exponentialRampToValueAtTime(1300, t + 0.25);
    for (const d of [0, 6]) { const o = osc(ctx, "sawtooth", f, t); o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + 0.2); }
    chain(lp, g); send(g, out, 0.2);
  },
  lead(ctx, out, t, m, dur, v = 0.35) { // a cheeky square lead with vibrato
    const f = mtof(m), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.16, t + 0.015);
    g.gain.setValueAtTime(v * 0.13, t + Math.max(0.02, dur - 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    const o = osc(ctx, "square", f, t), lfo = osc(ctx, "sine", 5.5, t), lg = ctx.createGain(); lg.gain.value = 12;
    lfo.connect(lg); lg.connect(o.detune);
    const lp = filt(ctx, "lowpass", 2400);
    chain(o, lp, g); send(g, out, 0.25);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.15); lfo.stop(t + dur + 0.15);
  },
  kick(ctx, out, t, v = 0.8) {
    const o = osc(ctx, "sine", 130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = gainEnv(ctx, t, 0.002, v * 0.9, 0.28); chain(o, g); g.connect(out); o.start(t); o.stop(t + 0.32);
  },
  snare(ctx, out, t, v = 0.5) {
    const n = noiseSrc(ctx, t, 0.2), bp = filt(ctx, "bandpass", 1900, 0.6), g = gainEnv(ctx, t, 0.002, v * 0.5, 0.16);
    chain(n, bp, g); send(g, out, 0.15);
    const o = osc(ctx, "triangle", 190, t), go = gainEnv(ctx, t, 0.002, v * 0.4, 0.08); chain(o, go); go.connect(out); o.start(t); o.stop(t + 0.12);
  },
  clap(ctx, out, t, v = 0.5) {
    const n = noiseSrc(ctx, t, 0.25), bp = filt(ctx, "bandpass", 1300, 0.9), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (const k of [0, 0.011, 0.022]) { g.gain.setValueAtTime(v * 0.55, t + k); g.gain.exponentialRampToValueAtTime(v * 0.08, t + k + 0.009); }
    g.gain.setValueAtTime(v * 0.45, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    chain(n, bp, g); send(g, out, 0.25);
  },
  hat(ctx, out, t, v = 0.3, open = false) {
    const n = noiseSrc(ctx, t, 0.3), hp = filt(ctx, "highpass", 7500), g = gainEnv(ctx, t, 0.001, v * 0.28, open ? 0.22 : 0.04);
    chain(n, hp, g); g.connect(out);
  },
  shaker(ctx, out, t, v = 0.25) {
    const n = noiseSrc(ctx, t, 0.12), bp = filt(ctx, "bandpass", 6500, 1.2), g = gainEnv(ctx, t, 0.012, v * 0.2, 0.05);
    chain(n, bp, g); g.connect(out);
  },
  tick(ctx, out, t, v = 0.3) {
    const o = osc(ctx, "sine", 2400, t), g = gainEnv(ctx, t, 0.001, v * 0.18, 0.025); chain(o, g); g.connect(out); o.start(t); o.stop(t + 0.05);
  },
  timpani(ctx, out, t, m, v = 0.7) {
    const f = mtof(m), o = osc(ctx, "sine", f * 1.06, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = gainEnv(ctx, t, 0.004, v * 0.8, 0.9); chain(o, g); send(g, out, 0.3); o.start(t); o.stop(t + 1);
    const n = noiseSrc(ctx, t, 0.1), lp = filt(ctx, "lowpass", 300), gn = gainEnv(ctx, t, 0.002, v * 0.3, 0.08); chain(n, lp, gn); gn.connect(out);
  },
  cymbal(ctx, out, t, v = 0.35, len = 1.6) {
    const n = noiseSrc(ctx, t, len), hp = filt(ctx, "highpass", 5000), g = gainEnv(ctx, t, 0.003, v * 0.3, len);
    chain(n, hp, g); send(g, out, 0.3);
  },
};

// ---------- the score ----------
// Chords are [root midi, intervals]. Each part is a function of the 16th step in the
// bar, the bar's chord, the bar and the loop, and plays into the track's own gain.

const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM7 = [0, 4, 7, 10], MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10];
const C = (root, q) => ({ root, q });
const pc = (m, root) => (((m - root) % 12) + 12) % 12;
const tones = (ch, lo, hi) => { const out = []; for (let m = lo; m <= hi; m++) if (ch.q.includes(pc(m, ch.root))) out.push(m); return out; };
const scaleNotes = (tonic, kind, lo, hi) => { const steps = kind === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]; const out = []; for (let m = lo; m <= hi; m++) if (steps.includes(((m - tonic) % 12 + 12) % 12)) out.push(m); return out; };

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A melody for a chord loop: four-bar phrases (motif, answer, motif again fitted to
// the new chord, cadence), chord tones on strong beats, stepwise motion in between.
function compose(chords, { seed, tonic, kind = "major", lo, hi, rhythms, cadence }) {
  const r = rng(seed), scale = scaleNotes(tonic, kind, lo, hi);
  const near = (list, m) => list.reduce((b, x) => (Math.abs(x - m) < Math.abs(b - m) ? x : b), list[0]);
  let prev = near(scale, (lo + hi) / 2);
  const bars = [];
  let motif = null;
  chords.forEach((ch, bi) => {
    const pos = bi % 4;
    const rhythm = pos === 3 ? cadence : rhythms[pos === 2 ? 0 : pos === 1 ? 1 + Math.floor(r() * (rhythms.length - 1)) : 0];
    const ct = tones(ch, lo, hi);
    const notes = [];
    rhythm.forEach(([s, d], i) => {
      const strong = s % 8 === 0 || i === 0 || i === rhythm.length - 1;
      let m;
      if (pos === 2 && motif && motif[i] !== undefined) {
        m = prev + motif[i];
        if (strong) m = near(ct, m); else m = near(scale, m);
      } else if (strong) {
        const opts = [...ct].sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev)).slice(0, 3);
        m = opts[Math.floor(r() * opts.length)];
      } else {
        const idx = scale.indexOf(near(scale, prev));
        const step = [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
        m = scale[Math.max(0, Math.min(scale.length - 1, idx + step))];
      }
      if (pos === 3 && i === rhythm.length - 1) { const roots = ct.filter((x) => pc(x, ch.root) === 0); m = near(roots.length ? roots : ct, prev); }
      notes.push({ s, d, m });
      prev = m;
    });
    if (pos === 0) motif = notes.map((n, i) => (i ? n.m - notes[i - 1].m : 0));
    bars.push(notes);
  });
  return bars;
}

const R = { // rhythm templates: [step, length in steps]
  bouncy: [[0, 2], [3, 1], [4, 2], [6, 2], [8, 3], [12, 2], [14, 2]],
  skip: [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]],
  lilt: [[2, 2], [4, 2], [6, 4], [10, 2], [12, 2], [14, 2]],
  long: [[0, 6], [6, 2], [8, 8]],
  end: [[0, 4], [4, 4], [8, 8]],
  waltz: [[0, 4], [4, 2], [6, 2], [8, 8]],
  swing: [[0, 3], [3, 1], [4, 4], [10, 2], [12, 4]],
  stab: [[0, 2], [2, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
};

function makeTracks() {
  // ---- the day: sunny, bouncy F major ----
  const dayChords = [C(53, MAJ), C(50, MIN), C(46, MAJ), C(48, MAJ), C(46, MAJ), C(48, MAJ), C(45, MIN), C(50, MIN), C(53, MAJ), C(50, MIN), C(55, MIN), C(48, DOM7), C(46, MAJ), C(48, DOM7), C(53, MAJ), C(53, MAJ)];
  const dayMel = compose(dayChords, { seed: 11, tonic: 65, lo: 67, hi: 84, rhythms: [R.bouncy, R.skip, R.lilt], cadence: R.end });
  const day = {
    bpm: 102, swing: 0.14, chords: dayChords,
    play(I, out, t, s, bar, ch, loop, sd, extra) {
      const r = ch.root;
      if (s === 0) INST.bass(A.ctx, out, t, r - 12, sd * 3, 0.65);
      if (s === 6) INST.bass(A.ctx, out, t, r - 12 + 7, sd * 1.5, 0.45);
      if (s === 8) INST.bass(A.ctx, out, t, r - 12 + (ch.q[1] === 3 ? 7 : 7), sd * 3, 0.55);
      if (s === 14) INST.bass(A.ctx, out, t, r - 12 + 12 - 1 + (bar % 2), sd, 0.4);
      // the ukulele: a strum on the one, chops on the offbeats
      const up = ch.q.map((i) => r + 12 + i);
      if (s === 0) up.forEach((m, k) => INST.pluck(A.ctx, out, t + k * 0.012, m, sd * 2, 0.36));
      if (s === 4 || s === 10 || s === 12) up.forEach((m, k) => INST.pluck(A.ctx, out, t + k * 0.008, m, sd, 0.22));
      if (s % 2 === 0) INST.shaker(A.ctx, out, t, s % 4 === 0 ? 0.6 : 0.35);
      if (s === 0 || s === 8) INST.kick(A.ctx, out, t, 0.45);
      if (s === 4 || s === 12) INST.clap(A.ctx, out, t, 0.22);
      if (extra.afternoon && s % 4 === 2) INST.hat(A.ctx, out, t, 0.35);
      const phase = loop % 4;
      if (phase !== 2) for (const n of dayMel[bar]) if (n.s === s) {
        INST.marimba(A.ctx, out, t, n.m, sd * n.d, 0.5);
        if (phase === 1 || phase === 3) INST.glock(A.ctx, out, t, n.m, sd * n.d, 0.22);
      }
    },
  };
  // ---- golden hour: the plotting gets serious, D minor ----
  const eveChords = [C(50, MIN), C(46, MAJ), C(53, MAJ), C(48, MAJ), C(50, MIN), C(46, MAJ), C(43, MIN), C(45, MAJ)];
  const eveMel = compose(eveChords, { seed: 23, tonic: 62, kind: "minor", lo: 62, hi: 79, rhythms: [R.long, R.lilt, R.skip], cadence: R.end });
  const evening = {
    bpm: 88, swing: 0.08, chords: eveChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s === 0) INST.pad(A.ctx, out, t, r, sd * 16, 0.9), INST.pad(A.ctx, out, t, r + ch.q[1], sd * 16, 0.7), INST.pad(A.ctx, out, t, r + 7, sd * 16, 0.7);
      if (s === 0 || s === 10) INST.bass(A.ctx, out, t, r - 12, sd * 4, 0.6);
      if (s % 2 === 0) { const arp = [0, 7, 12, ch.q[1] + 12, 7, 12, ch.q[1], 7]; INST.pluck(A.ctx, out, t, r + 12 + arp[(s / 2) % 8], sd, 0.18); }
      if (s % 4 === 0) INST.tick(A.ctx, out, t, s % 8 === 0 ? 0.5 : 0.3);
      if (loop % 2 === 1) for (const n of eveMel[bar]) if (n.s === s) INST.glock(A.ctx, out, t, n.m, sd * n.d, 0.25);
    },
  };
  // ---- Primrose's show: a brassy, swinging game-show tune in Bb ----
  const showChords = [C(46, MAJ7), C(43, DOM7), C(48, MIN7), C(41, DOM7), C(46, MAJ7), C(43, DOM7), C(48, MIN7), C(41, DOM7)];
  const showMel = compose(showChords, { seed: 37, tonic: 70, lo: 70, hi: 86, rhythms: [R.swing, R.stab, R.bouncy], cadence: R.end });
  const show = {
    bpm: 122, swing: 0.2, chords: showChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s % 4 === 0) { const walk = [0, 4, 7, 9]; INST.bass(A.ctx, out, t, r - 12 + walk[s / 4], sd * 3.5, 0.6); }
      if (s === 4 || s === 12) INST.clap(A.ctx, out, t, 0.32), INST.snare(A.ctx, out, t, 0.18);
      if (s % 2 === 0) INST.hat(A.ctx, out, t, s % 4 === 2 ? 0.4 : 0.22);
      if (s === 0) INST.kick(A.ctx, out, t, 0.5);
      if (s === 6 || s === 14) ch.q.map((i) => r + 12 + i).forEach((m) => INST.brass(A.ctx, out, t, m, sd * 1.4, 0.32));
      for (const n of showMel[bar]) if (n.s === s) INST.lead(A.ctx, out, t, n.m, sd * n.d * 0.9, loop % 2 ? 0.42 : 0.32);
    },
  };
  // ---- the vote: a heartbeat at the firepit, A minor with a harmonic-minor sting ----
  const voteChords = [C(45, MIN), C(41, MAJ), C(38, MIN), C(40, MAJ)];
  const vote = {
    bpm: 70, swing: 0, chords: voteChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s === 0) { INST.pad(A.ctx, out, t, r, sd * 16, 1); INST.pad(A.ctx, out, t, r + 12 + ch.q[1], sd * 16, 0.6); INST.bass(A.ctx, out, t, r - 12, sd * 14, 0.5); }
      if (s === 0 || s === 3) INST.kick(A.ctx, out, t, s ? 0.35 : 0.55);
      if (s % 2 === 0) INST.tick(A.ctx, out, t, 0.35);
      if (s === 8 && bar % 2 === 1) INST.glock(A.ctx, out, t, r + 24 + ch.q[2], sd * 4, 0.22);
      if (s === 12 && bar === 3) INST.glock(A.ctx, out, t, r + 24 + 4, sd * 4, 0.25);
    },
  };
  // ---- a cat fight: fast and silly, E minor ----
  const fightChords = [C(52, MIN), C(48, MAJ), C(50, MAJ), C(47, MAJ)];
  const riff = [0, 0, 12, 0, 10, 0, 7, 0, 0, 0, 12, 0, 14, 12, 10, 7];
  const fight = {
    bpm: 160, swing: 0, chords: fightChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s % 4 === 0) INST.kick(A.ctx, out, t, 0.7);
      if (s === 4 || s === 12) INST.snare(A.ctx, out, t, 0.5);
      if (s % 2 === 1) INST.hat(A.ctx, out, t, 0.3);
      if (s % 2 === 0) INST.bass(A.ctx, out, t, r - 12 + (s % 8 === 6 ? 7 : 0), sd * 1.5, 0.55);
      if (s % 2 === 0 || s === 13) INST.lead(A.ctx, out, t, r + 12 + riff[s], sd * 0.9, 0.3);
    },
  };
  // ---- night: a music-box lullaby in C ----
  const nightChords = [C(48, MAJ), C(45, MIN), C(41, MAJ), C(43, MAJ), C(48, MAJ), C(45, MIN), C(41, MAJ), C(43, DOM7)];
  const nightMel = compose(nightChords, { seed: 5, tonic: 72, lo: 72, hi: 88, rhythms: [R.waltz, R.long, R.lilt], cadence: R.end });
  const night = {
    bpm: 72, swing: 0, chords: nightChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s === 0) INST.pad(A.ctx, out, t, r, sd * 16, 0.6), INST.bass(A.ctx, out, t, r - 12, sd * 12, 0.35);
      if (s % 4 === 2) INST.musicbox(A.ctx, out, t, r + [7, 12, 16, 12][(s - 2) / 4] - (ch.q[1] === 3 ? (s === 10 ? 1 : 0) : 0), sd * 2, 0.18);
      for (const n of nightMel[bar]) if (n.s === s) INST.musicbox(A.ctx, out, t, n.m, sd * n.d, 0.32);
    },
  };
  // ---- the title: the town's theme, G major ----
  const titleChords = [C(55, MAJ), C(52, MIN), C(48, MAJ), C(50, MAJ), C(55, MAJ), C(52, MIN), C(48, MAJ), C(50, DOM7)];
  const titleMel = compose(titleChords, { seed: 3, tonic: 67, lo: 67, hi: 83, rhythms: [R.skip, R.bouncy, R.lilt], cadence: R.end });
  const title = {
    bpm: 94, swing: 0.1, chords: titleChords,
    play(I, out, t, s, bar, ch, loop, sd) {
      const r = ch.root;
      if (s === 0) { INST.pad(A.ctx, out, t, r, sd * 16, 0.7); INST.pad(A.ctx, out, t, r + 12 + ch.q[1], sd * 16, 0.5); INST.bass(A.ctx, out, t, r - 12, sd * 6, 0.5); }
      if (s === 8) INST.bass(A.ctx, out, t, r - 12 + 7, sd * 6, 0.4);
      if (s % 2 === 0) { const arp = [0, 7, 12, 7 + 12, 12 + ch.q[1], 12, 7, ch.q[1]]; INST.pluck(A.ctx, out, t, r + 12 + arp[(s / 2) % 8], sd, 0.16); }
      for (const n of titleMel[bar]) if (n.s === s) { INST.glock(A.ctx, out, t, n.m, sd * n.d, 0.3); if (loop % 2) INST.marimba(A.ctx, out, t, n.m - 12, sd * n.d, 0.35); }
      if (loop % 2 && s % 4 === 0) INST.shaker(A.ctx, out, t, 0.4);
    },
  };
  return { day, evening, show, vote, fight, night, title };
}

// ---------- the music player ----------
// Tracks crossfade. A lookahead scheduler keeps notes tight even when frames stutter.

let TRACKS = null;
const players = []; // { name, track, gain, step, next, fading }
let wanted = null, extra = {};

export function music(name, opts = {}) {
  extra = { ...extra, ...opts };
  if (name === wanted) return;
  wanted = name;
  if (!A.ctx) return;
  switchTo(name);
}
function switchTo(name) {
  TRACKS ||= makeTracks();
  const t = now();
  for (const p of players) if (!p.fading) { p.fading = t + 1.4; p.gain.gain.cancelScheduledValues(t); p.gain.gain.setTargetAtTime(0.0001, t, 0.4); }
  if (!name || !TRACKS[name]) return;
  const g = A.ctx.createGain(); g.gain.value = 0.0001; g.connect(A.music);
  g.gain.setTargetAtTime(1, t + 0.05, 0.5);
  players.push({ name, track: TRACKS[name], gain: g, step: 0, next: t + 0.1, fading: 0 });
}
function tickMusic() {
  if (A.rendering) return;
  if (!A.ctx || A.paused || A.ctx.state !== "running") return;
  if (wanted && !players.some((p) => !p.fading && p.name === wanted)) switchTo(wanted);
  const t = now();
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    if (p.fading && t > p.fading) { p.gain.disconnect(); players.splice(i, 1); continue; }
    const tr = p.track, sd = 60 / tr.bpm / 4;
    if (p.next < t - 0.3) p.next = t + 0.05; // after a stall, pick up from now
    while (p.next < t + 0.15) {
      const s = p.step % 16, bar = Math.floor(p.step / 16) % tr.chords.length, loop = Math.floor(p.step / 16 / tr.chords.length);
      const at = p.next + (s % 2 ? tr.swing * sd : 0);
      if (!p.fading || at < p.fading - 0.6) try { tr.play(INST, p.gain, at, s, bar, tr.chords[bar], loop, sd, extra); } catch (e) { console.warn(e); }
      p.step++; p.next += sd;
    }
  }
}

// Duck the music under a big moment.
function duck(amount = 0.35, secs = 1.5) {
  if (!A.ctx) return;
  const t = now(), g = A.music.gain, base = 0.34 * A.vol.music * (A.vol.muted ? 0 : 1);
  g.cancelScheduledValues(t); g.setTargetAtTime(base * amount, t, 0.05); g.setTargetAtTime(base, t + secs, 0.4);
}

// ---------- stingers ----------

const STINGS = {
  drama(t) { const o = A.sfx; INST.brass(A.ctx, o, t, 50, 0.16, 0.6); INST.brass(A.ctx, o, t + 0.22, 53, 0.16, 0.6); INST.brass(A.ctx, o, t + 0.44, 49, 0.9, 0.7); INST.timpani(A.ctx, o, t + 0.44, 37, 0.7); return 1.3; },
  bad(t) { const o = A.ctx.createOscillator(), g = gainEnv(A.ctx, t, 0.02, 0.18, 0.6), lp = filt(A.ctx, "lowpass", 900); o.type = "sawtooth"; o.frequency.setValueAtTime(233, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.55); chain(o, lp, g); g.connect(A.sfx); o.start(t); o.stop(t + 0.7); return 0.7; },
  good(t) { [72, 76, 79, 84, 88].forEach((m, i) => INST.glock(A.ctx, A.sfx, t + i * 0.06, m, 0.3, 0.35)); return 0.6; },
  showOpen(t) { const o = A.sfx; [58, 62, 65, 70].forEach((m, i) => INST.brass(A.ctx, o, t + i * 0.12, m, i === 3 ? 0.8 : 0.1, 0.55)); [62, 65, 70].forEach((m) => INST.brass(A.ctx, o, t + 0.36, m, 0.8, 0.35)); for (let i = 0; i < 6; i++) INST.snare(A.ctx, o, t + i * 0.06, 0.15 + i * 0.05); INST.cymbal(A.ctx, o, t + 0.36, 0.5, 2); INST.kick(A.ctx, o, t + 0.36, 0.7); return 1.6; },
  fanfare(t) { const o = A.sfx; const mel = [[67, 0.15], [67, 0.15], [67, 0.15], [72, 0.6], [71, 0.15], [72, 0.15], [76, 0.9]]; let k = 0; for (const [m, d] of mel) { INST.brass(A.ctx, o, t + k, m, d, 0.6); INST.brass(A.ctx, o, t + k, m - 12, d, 0.3); k += d + 0.04; } INST.cymbal(A.ctx, o, t + 1.2, 0.6, 2.5); INST.timpani(A.ctx, o, t + 1.2, 36, 0.8); return 2.8; },
  sad(t) { const o = A.sfx; [[55, 0.35], [54, 0.35], [53, 0.35], [52, 1.2]].reduce((k, [m, d]) => { INST.lead(A.ctx, o, t + k, m, d, 0.6); return k + d + 0.05; }, 0); return 2.4; },
  eliminated(t) { const o = A.sfx; INST.timpani(A.ctx, o, t, 33, 1); INST.kick(A.ctx, o, t, 1); [76, 72, 69, 64].forEach((m, i) => INST.glock(A.ctx, o, t + 0.3 + i * 0.22, m, 0.4, 0.35)); INST.pad(A.ctx, o, t, 45, 1.6, 0.8); return 2.2; },
  drumroll(t, len = 2) { for (let k = 0; k < len; k += 0.045) INST.snare(A.ctx, A.sfx, t + k, 0.08 + (k / len) * 0.3); INST.cymbal(A.ctx, A.sfx, t + len, 0.5, 1.6); INST.kick(A.ctx, A.sfx, t + len, 0.8); return len + 0.5; },
  morning(t) { [72, 76, 79, 84].forEach((m, i) => INST.marimba(A.ctx, A.sfx, t + i * 0.1, m, 0.3, 0.5)); return 0.8; },
  nightfall(t) { [79, 76, 72, 67].forEach((m, i) => INST.musicbox(A.ctx, A.sfx, t + i * 0.18, m, 0.4, 0.45)); return 1.2; },
};
export function sting(name, arg) {
  if (!A.ready || !STINGS[name]) return;
  resume();
  const len = STINGS[name](now() + 0.02, arg);
  duck(0.3, len);
}

// ---------- voices ----------
// Everyone babbles in her own voice while her words appear: a syllable per few letters,
// shaped by the vowels in what she says, pitched and timbred to her personality.

const VOICES = {
  player: { pitch: 69, wave: "triangle", speed: 0.068, range: 5 },
  primrose: { pitch: 72, wave: "triangle", speed: 0.062, range: 7, bright: 1.2 },
  celeste: { pitch: 67, wave: "triangle", speed: 0.075, range: 6, glide: true },
  odette: { pitch: 60, wave: "sawtooth", speed: 0.08, range: 3, dark: true },
  wren: { pitch: 70, wave: "triangle", speed: 0.058, range: 8 },
  sylvie: { pitch: 64, wave: "triangle", speed: 0.085, range: 2, dark: true },
  marigold: { pitch: 71, wave: "sine", speed: 0.07, range: 4, soft: true },
  pippa: { pitch: 76, wave: "triangle", speed: 0.052, range: 9 },
  brenna: { pitch: 57, wave: "square", speed: 0.08, range: 3, dark: true },
  juniper: { pitch: 68, wave: "sine", speed: 0.09, range: 5, breath: true },
  hesper: { pitch: 62, wave: "triangle", speed: 0.09, range: 4, vibrato: true },
  tansy: { pitch: 69, wave: "square", speed: 0.06, range: 5 },
};
const VOWEL = { a: [800, 1200], e: [450, 2100], i: [320, 2600], o: [520, 900], u: [380, 750], y: [320, 2400] };
const babbling = new Map(); // id -> stop time

export function voice(id, text, { gain = 1, muffled = false } = {}) {
  if (!A.ready || A.paused || !text) return;
  const v = VOICES[id] || VOICES.player;
  const letters = text.replace(/[^a-z]/gi, "");
  if (!letters.length) return;
  const vowels = (text.toLowerCase().match(/[aeiouy]/g) || ["a"]);
  const n = Math.max(2, Math.min(muffled ? 7 : 16, Math.ceil(letters.length / 3.2)));
  let t = Math.max(now() + 0.02, babbling.get(id) || 0);
  if (t > now() + 1.2) return; // she is still talking; don't pile up
  const ask = /\?\s*$/.test(text), shout = /!/.test(text);
  const vol = (muffled ? 0.25 : 0.5) * gain * (shout ? 1.15 : 1) * (v.soft ? 0.8 : 1);
  for (let i = 0; i < n; i++) {
    const vow = VOWEL[vowels[i % vowels.length]] || VOWEL.a;
    let semi = Math.round((Math.sin(i * 1.7 + letters.charCodeAt(i % letters.length)) * 0.5 + 0.5) * v.range) - v.range / 2;
    if (ask && i >= n - 2) semi += 3 + i - (n - 2) * 2;
    if (!ask && i === n - 1) semi -= 2;
    syllable(t, v, mtof(v.pitch + semi), vow, vol, muffled);
    t += v.speed * rnd(0.85, 1.2) + (i % 4 === 3 ? v.speed * 0.6 : 0);
  }
  babbling.set(id, t);
}
// One syllable as a bubble's text appears: called by the bubble for every few letters.
const lastSyl = new Map();
export function speakTick(id, ch, { gain = 1, muffled = false, ask = false, end = false } = {}) {
  if (!A.ready || A.paused || A.ctx.state !== "running") return;
  const v = VOICES[id] || VOICES.player, t = now() + 0.005;
  if ((lastSyl.get(id) || 0) > t) return;
  lastSyl.set(id, t + v.speed * 0.8);
  const c = (ch || "a").toLowerCase(), code = c.charCodeAt(0) || 97;
  const vow = VOWEL[c] || VOWEL["aeiou"[code % 5]];
  let semi = Math.round(((Math.sin(code * 1.3 + (performance.now() / 97)) + 1) / 2) * v.range - v.range / 2);
  if (end) semi += ask ? 4 : -2;
  syllable(t, v, mtof(v.pitch + semi), vow, (muffled ? 0.22 : 0.42) * gain * (v.soft ? 0.8 : 1), muffled);
}

function syllable(t, v, f, [f1, f2], vol, muffled) {
  const ctx = A.ctx, len = v.speed * 0.9;
  const o = osc(ctx, v.wave, f, t);
  if (v.glide) o.frequency.exponentialRampToValueAtTime(f * 0.94, t + len);
  if (v.vibrato) { const l = osc(ctx, "sine", 7, t), lg = ctx.createGain(); lg.gain.value = 30; l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + len + 0.05); }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.008);
  g.gain.setValueAtTime(vol * 0.4, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const b1 = filt(ctx, "bandpass", f1 * (v.dark ? 0.85 : 1) * (v.bright || 1), 3), b2 = filt(ctx, "bandpass", f2 * (v.dark ? 0.85 : 1) * (v.bright || 1), 5);
  const dry = ctx.createGain(); dry.gain.value = 0.25;
  o.connect(b1); o.connect(b2); o.connect(dry);
  const sum = ctx.createGain(); sum.gain.value = 1.6;
  b1.connect(sum); b2.connect(sum); dry.connect(sum);
  const lp = filt(ctx, "lowpass", muffled ? 900 : 3200); sum.connect(lp);
  const tail = lp;
  tail.connect(g); send(g, A.sfx, 0.06);
  o.start(t); o.stop(t + len + 0.05);
  if (v.breath) { const n = noiseSrc(ctx, t, len), bp = filt(ctx, "bandpass", f2, 2), gn = gainEnv(ctx, t, 0.01, vol * 0.12, len); chain(n, bp, gn); gn.connect(A.sfx); }
}

// ---------- sounds ----------

export function sfx(name, opts = {}) {
  if (!A.ready || A.paused) return;
  resume();
  const ctx = A.ctx, t = now() + 0.01, o = A.sfx, gain = opts.gain ?? 1;
  const blip = (f0, f1, len, v = 0.25, type = "sine") => { const x = osc(ctx, type, f0, t), g = gainEnv(ctx, t, 0.004, v * gain, len); x.frequency.exponentialRampToValueAtTime(f1, t + len); chain(x, g); send(g, o, 0.1); x.start(t); x.stop(t + len + 0.05); };
  const hiss = (f, q, len, v = 0.2, type = "bandpass", at = t, f2) => { const n = noiseSrc(ctx, at, len), b = filt(ctx, type, f, q), g = gainEnv(ctx, at, Math.min(0.03, len / 3), v * gain, len); if (f2) b.frequency.exponentialRampToValueAtTime(f2, at + len); chain(n, b, g); send(g, o, 0.1); };
  switch (name) {
    case "click": blip(900, 1300, 0.05, 0.18); break;
    case "key": hiss(rnd(3000, 5000), 2, 0.025, 0.12, "bandpass"); break;
    case "send": blip(700, 1100, 0.08, 0.18); setTimeout(() => sfx("click", { gain: 0.6 }), 60); break;
    case "tip": INST.glock(ctx, o, t, 84, 0.2, 0.35); INST.glock(ctx, o, t + 0.09, 88, 0.3, 0.35); break;
    case "toast": INST.marimba(ctx, o, t, 84, 0.2, 0.4); break;
    case "tea": hiss(2400, 1, 0.45, 0.12, "bandpass", t, 700); INST.glock(ctx, o, t + 0.25, 79, 0.2, 0.3); INST.glock(ctx, o, t + 0.33, 83, 0.2, 0.3); break;
    case "paper": for (let k = 0; k < 4; k++) hiss(rnd(2500, 4500), 1.5, 0.06, 0.16, "bandpass", t + k * 0.05); break;
    case "pickup": [76, 81, 88].forEach((m, i) => INST.glock(ctx, o, t + i * 0.07, m, 0.2, 0.35)); break;
    case "pin": blip(1800, 1200, 0.04, 0.25, "square"); hiss(3000, 1, 0.15, 0.1, "bandpass", t + 0.03); break;
    case "creak": { const x = osc(ctx, "sawtooth", 85, t), b = filt(ctx, "bandpass", 700, 6), g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); for (let k = 0; k < 0.6; k += 0.03) g.gain.setValueAtTime(rnd(0.02, 0.16) * gain, t + k); g.gain.setValueAtTime(0.0001, t + 0.62); x.frequency.linearRampToValueAtTime(120, t + 0.6); b.frequency.linearRampToValueAtTime(1100, t + 0.6); chain(x, b, g); g.connect(o); x.start(t); x.stop(t + 0.65); break; }
    case "whoosh": hiss(400, 1.2, 0.45, 0.25, "bandpass", t, 3200); break;
    case "thunk": blip(170, 90, 0.12, 0.45); hiss(500, 1, 0.06, 0.12, "lowpass"); break;
    case "tally": INST.marimba(ctx, o, t, 79 + (opts.n || 0), 0.15, 0.5); break;
    case "fizzle": hiss(5000, 0.8, 0.9, 0.14, "highpass", t, 2000); break;
    case "pow": blip(700, 90, 0.16, 0.3, "square"); hiss(1200, 0.6, 0.1, 0.35); break;
    case "slap": hiss(2600, 0.7, 0.05, 0.5, "highpass"); blip(220, 120, 0.06, 0.3); break;
    case "tap": blip(500, 300, 0.04, 0.2, "square"); break;
    case "step": {
      const surf = opts.surface || "grass", v = (opts.gain ?? 1) * 0.6;
      // soft, low footfalls: a hissy step every third of a second reads as static
      if (surf === "stone") { blip(rnd(150, 180), 80, 0.045, 0.22 * v); hiss(rnd(700, 900), 0.8, 0.03, 0.06 * v, "lowpass"); }
      else if (surf === "wood") { blip(rnd(230, 270), 160, 0.07, 0.3 * v, "triangle"); hiss(600, 0.8, 0.04, 0.05 * v, "lowpass"); }
      else { hiss(rnd(450, 650), 0.7, 0.07, 0.12 * v, "lowpass"); blip(rnd(110, 130), 70, 0.05, 0.12 * v); }
      break;
    }
    case "bell": { // the town bell: an inharmonic bronze strike
      const strikes = opts.strikes || 3;
      for (let k = 0; k < strikes; k++) bellStrike(t + k * 1.1, 196, 0.5 * gain, 3.2);
      break;
    }
    case "hour": bellStrike(t, 262, 0.18 * gain, 2.2); break;
    case "handbell": for (let k = 0; k < 6; k++) bellStrike(t + k * 0.16, k % 2 ? 1046 : 880, 0.12 * gain, 0.7); break;
    case "pause": blip(600, 200, 0.18, 0.2, "triangle"); break;
    case "unpause": blip(300, 800, 0.15, 0.2, "triangle"); break;
    case "board": hiss(1800, 0.8, 0.22, 0.14, "bandpass", t, 4200); break;
    default: break;
  }
}
function bellStrike(t, f, v, len) {
  const ctx = A.ctx;
  [[0.5, 1], [1, 0.8], [1.19, 0.5], [1.56, 0.4], [2, 0.35], [2.66, 0.2], [3.01, 0.15]].forEach(([r, a]) => {
    const x = osc(ctx, "sine", f * r, t), g = gainEnv(ctx, t, 0.003, v * a * 0.35, len / (r * 0.7 + 0.6));
    chain(x, g); send(g, A.sfx, 0.4); x.start(t); x.stop(t + len + 0.2);
  });
}

// Emotes get a little sound, in the woman's own voice where it's vocal.
export function emote(id, kind, { gain = 1 } = {}) {
  if (!A.ready || A.paused) return;
  const ctx = A.ctx, t = now() + 0.01, v = VOICES[id] || VOICES.player, o = A.sfx;
  const vocal = (vow, semis, spacing = 0.11, vol = 0.45) => semis.forEach((s, i) => syllable(t + i * spacing, { ...v, speed: Math.max(0.08, v.speed * 1.3) }, mtof(v.pitch + s), VOWEL[vow], vol * gain, false));
  switch (kind) {
    case "laugh": vocal("a", [5, 3, 1, 0], 0.1); break;
    case "gasp": { const n = noiseSrc(ctx, t, 0.25), b = filt(ctx, "bandpass", 1200, 1.5), g = gainEnv(ctx, t, 0.08, 0.2 * gain, 0.15); b.frequency.exponentialRampToValueAtTime(2600, t + 0.22); chain(n, b, g); g.connect(o); vocal("o", [7], 0.1, 0.3); break; }
    case "anger": { const x = osc(ctx, "sawtooth", mtof(v.pitch - 17), t), tr = osc(ctx, "sine", 24, t), tg = ctx.createGain(), g = gainEnv(ctx, t, 0.03, 0.22 * gain, 0.35), lp = filt(ctx, "lowpass", 700); const trem = ctx.createGain(); tg.gain.value = 0.35; trem.gain.value = 0.65; tr.connect(tg); tg.connect(trem.gain); chain(x, lp, trem, g); g.connect(o); x.start(t); tr.start(t); x.stop(t + 0.45); tr.stop(t + 0.45); break; }
    case "heart": INST.glock(ctx, o, t, 76, 0.2, 0.4 * gain); INST.glock(ctx, o, t + 0.1, 81, 0.3, 0.4 * gain); break;
    case "sparkle": case "star": case "gift": case "flower": [84, 88, 91, 96].forEach((m, i) => INST.glock(ctx, o, t + i * 0.05, m - (kind === "star" ? 5 : 0), 0.15, 0.22 * gain)); break;
    case "sad": [76, 72, 69].forEach((m, i) => INST.glock(ctx, o, t + i * 0.16, m, 0.3, 0.3 * gain)); break;
    case "whisper": { const n = noiseSrc(ctx, t, 0.45), hp = filt(ctx, "highpass", 3000), g = gainEnv(ctx, t, 0.08, 0.1 * gain, 0.35); chain(n, hp, g); g.connect(o); break; }
    case "suspicious": vocal("u", [0, 1], 0.16, 0.3); break;
    case "cringe": vocal("i", [10, 12], 0.07, 0.35); break;
    case "question": vocal("e", [0, 4], 0.1, 0.3); break;
    case "wave": vocal("i", [4, 7], 0.09, 0.3); break;
    case "handshake": sfx("tap"); setTimeout(() => sfx("tap"), 120); break;
    case "vote": sfx("thunk"); break;
    case "bell": sfx("handbell", { gain: 0.6 * gain }); break;
    case "crown": STINGS.good(t); break;
    case "pow": sfx("pow", { gain }); break;
    case "tea": sfx("tea", { gain: 0.6 * gain }); break;
    default: break;
  }
}

// The crowd at a show: applause, laughter, gasps and groans, scaled by how many react.
export function crowd({ loved = 0, amused = 0, cringed = 0, offended = 0 } = {}) {
  if (!A.ready || A.paused) return;
  const ctx = A.ctx, t = now() + 0.02;
  if (loved) { const n = 14 + loved * 10; for (let i = 0; i < n; i++) INST.clap(ctx, A.sfx, t + rnd(0, 1.6) * Math.min(1, 0.4 + i / n), rnd(0.16, 0.36) * Math.min(1, 0.5 + loved * 0.12)); }
  const ids = Object.keys(VOICES).filter((k) => k !== "player" && k !== "primrose");
  if (amused) for (let p = 0; p < Math.min(5, amused); p++) { const v = VOICES[ids[Math.floor(Math.random() * ids.length)]]; const st = t + rnd(0, 0.4); [5, 3, 1, 0, -1].slice(0, 3 + (p % 3)).forEach((s, i) => syllable(st + i * 0.11, { ...v, speed: 0.1 }, mtof(v.pitch + s + rnd(-1, 1)), VOWEL.a, 0.2, false)); }
  if (offended) choir(t, offended, [60, 63], "o", 0.9, 1.15); // "ooOOH"
  if (cringed) choir(t + 0.1, cringed, [58, 55], "a", 0.8, 0.85); // "awww"
}
function choir(t, count, [m0, m1], vow, len, glide) {
  const ctx = A.ctx, [f1, f2] = VOWEL[vow];
  for (let i = 0; i < Math.min(6, count + 1); i++) {
    const f = mtof(rnd(m0 - 2, m1 + 2)), x = osc(ctx, "sawtooth", f, t), g = ctx.createGain();
    x.frequency.exponentialRampToValueAtTime(f * glide, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const b1 = filt(ctx, "bandpass", f1, 4), b2 = filt(ctx, "bandpass", f2, 6), s = ctx.createGain(); s.gain.value = 2;
    x.connect(b1); x.connect(b2); b1.connect(s); b2.connect(s); chain(s, g); send(g, A.sfx, 0.3);
    x.start(t); x.stop(t + len + 0.05);
  }
}

// A scuffle while a cat fight's dust cloud rolls: thumps, slaps and squeals.
export function scuffle(secs) {
  if (!A.ready || A.paused) return;
  for (let k = 0.05; k < secs; k += rnd(0.16, 0.34)) setTimeout(() => {
    const r = Math.random();
    if (r < 0.4) sfx("slap", { gain: rnd(0.4, 0.8) }); else if (r < 0.75) sfx("thunk", { gain: rnd(0.3, 0.6) }); else sfx("pow", { gain: rnd(0.2, 0.4) });
  }, k * 1000);
}

// ---------- ambience ----------
// Continuous beds whose levels follow where you are and what time it is.

const amb = {};
function bed(type, f, q) {
  const ctx = A.ctx, n = ctx.createBufferSource(); n.buffer = A.noise; n.loop = true;
  const b = filt(ctx, type, f, q), g = ctx.createGain(); g.gain.value = 0;
  chain(n, b, g); g.connect(A.amb); n.start();
  return { g, b };
}
function startAmbience() {
  amb.wind = bed("lowpass", 380, 0.5);
  amb.water = bed("lowpass", 650, 0.4);
  amb.river = bed("lowpass", 480, 0.4);
  amb.murmur = bed("lowpass", 420, 0.6);
  amb.fire = bed("lowpass", 220, 0.7);
  amb.lastBird = 0; amb.lastCricket = 0; amb.lastCrackle = 0; amb.lastMurmur = 0;
}

const SPOTS = { fountain: { x: 0, z: 0 }, tavern: { x: -15, z: 5.6 }, firepit: { x: -26, z: -37 }, hall: { x: -38, z: -2.6 } };
const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
let lastHour = -1;

// Called every frame with where the listener is and the time of day.
export function updateAudio({ x = 0, z = 0, minute = 600, mode = "play", night = false, fireLit = false, riverDist = 99, crowdHere = 0 } = {}) {
  if (!A.ready || A.paused || A.ctx.state !== "running") return;
  const t = now(), h = minute / 60, set = (node, v) => node.g.gain.setTargetAtTime(v, t, 0.6);
  const p = { x, z };
  const day = !night && h >= 6.5 && h < 19.5, dusk = h >= 17.5 || night;
  set(amb.wind, 0.05 + (night ? 0.04 : 0) + Math.sin(t * 0.13) * 0.02);
  set(amb.water, mode === "title" ? 0.015 : Math.max(0, 0.07 * (1 - dist(p, SPOTS.fountain) / 16)));
  set(amb.river, Math.max(0, 0.07 * (1 - riverDist / 14)));
  set(amb.murmur, (crowdHere ? 0.025 : 0) + Math.max(0, 0.06 * (1 - dist(p, SPOTS.tavern) / 14)) * (h > 11 ? 1 : 0.4));
  set(amb.fire, fireLit ? 0.12 : Math.max(0, 0.05 * (1 - dist(p, SPOTS.firepit) / 10)));
  amb.water.b.frequency.setTargetAtTime(600 + Math.sin(t * 0.7) * 80, t, 0.5);
  // birds by day, crickets by night, the fire crackling
  if (day && mode !== "vote" && t > amb.lastBird) { amb.lastBird = t + rnd(1.2, 4.5); bird(t + 0.02); }
  if (dusk && t > amb.lastCricket) { amb.lastCricket = t + rnd(0.4, 1.1); cricket(t + 0.02, night ? 1 : 0.5); }
  const nearFire = fireLit || dist(p, SPOTS.firepit) < 10;
  if (nearFire && t > amb.lastCrackle) { amb.lastCrackle = t + rnd(0.05, 0.35); crackle(t + 0.01, fireLit ? 1 : 0.5); }
  // the town hall clock strikes the hour
  const hr = Math.floor(h);
  if (mode === "play" && hr !== lastHour) { if (lastHour >= 0 && hr >= 9 && hr <= 19) sfx("hour", { gain: Math.max(0.3, 1 - dist(p, SPOTS.hall) / 70) }); lastHour = hr; }
}
function bird(t) {
  const ctx = A.ctx, pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.8, 0.8); pan.connect(A.amb);
  const base = rnd(2400, 4200), notes = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < notes; i++) {
    const s = t + i * rnd(0.08, 0.14), x = osc(ctx, "sine", base * rnd(0.9, 1.1), s), g = gainEnv(ctx, s, 0.01, 0.05, 0.07);
    x.frequency.exponentialRampToValueAtTime(base * rnd(1.15, 1.5), s + 0.06);
    chain(x, g); g.connect(pan); x.start(s); x.stop(s + 0.1);
  }
}
function cricket(t, v) {
  const ctx = A.ctx, pan = ctx.createStereoPanner(); pan.pan.value = rnd(-1, 1); pan.connect(A.amb);
  // a soft chirp: a sine pulsed on and off by a 0..1 tremolo, inside a quiet envelope
  const x = osc(ctx, "sine", rnd(3900, 4400), t), am = osc(ctx, "square", 30, t), ag = ctx.createGain(), trem = ctx.createGain(), g = ctx.createGain();
  ag.gain.value = 0.5; trem.gain.value = 0.5; am.connect(ag); ag.connect(trem.gain);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012 * v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  chain(x, trem, g); g.connect(pan); x.start(t); am.start(t); x.stop(t + 0.3); am.stop(t + 0.3);
}
function crackle(t, v) {
  const ctx = A.ctx, n = noiseSrc(ctx, t, 0.02), hp = filt(ctx, "highpass", rnd(1500, 4000)), g = gainEnv(ctx, t, 0.001, rnd(0.03, 0.12) * v, 0.015);
  chain(n, hp, g); g.connect(A.amb);
}

// ---------- for tests: render offline and measure ----------
async function renderWith(secs, fn) {
  const off = new OfflineAudioContext(2, 44100 * secs, 44100);
  const keep = { ...A };
  A.rendering = true;
  buildGraph(off, off.destination);
  A.ctx = off; A.music.gain.value = 0.42; A.sfx.gain.value = 0.9; A.amb.gain.value = 0.55;
  let buf;
  try { fn(); buf = await off.startRendering(); } finally { Object.assign(A, keep); A.rendering = false; }
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0, hi = 0, bad = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (!Number.isFinite(d[i])) bad++; if (a > peak) peak = a; sum += d[i] * d[i]; if (i) hi += (d[i] - d[i - 1]) ** 2; }
  // `harsh`: how much of the sound is high, hissy energy (a sine at 1 kHz is about 0.14, white noise about 1.4)
  return { peak, rms: Math.sqrt(sum / d.length), harsh: Math.sqrt(hi / Math.max(1e-12, sum)), bad };
}
export function renderTrack(name, secs = 6) {
  TRACKS ||= makeTracks();
  const tr = TRACKS[name], sd = 60 / tr.bpm / 4;
  return renderWith(secs, () => {
    for (let step = 0, at = 0.05; at < secs - 0.5; step++, at += sd) {
      const s = step % 16, bar = Math.floor(step / 16) % tr.chords.length, loop = Math.floor(step / 16 / tr.chords.length);
      tr.play(INST, A.music, at + (s % 2 ? tr.swing * sd : 0), s, bar, tr.chords[bar], loop, sd, {});
    }
  });
}
// what you'd actually hear standing somewhere: ambience beds plus the critters, for level checks
const EMO = ["laugh", "gasp", "anger", "heart", "sparkle", "sad", "whisper", "suspicious", "cringe", "question", "wave", "handshake", "vote", "crown", "pow", "tea"];
export function renderScene(kind, secs = 4) {
  return renderWith(secs, () => {
    A.ready = true; A.paused = false;
    startAmbience();
    const lv = { plaza: { water: 0.07, wind: 0.05 }, tavern: { murmur: 0.06, wind: 0.05 }, river: { river: 0.07, wind: 0.05 }, night: { wind: 0.09, fire: 0.12 } }[kind] || {};
    for (const [k, v] of Object.entries(lv)) amb[k].g.gain.value = v;
    if (kind === "night") for (let s = 0.05; s < secs - 0.4; s += 0.55) { cricket(s, 1); if (Math.random() < 0.5) cricket(s + 0.2, 1); }
    if (kind === "night") for (let s = 0.05; s < secs - 0.2; s += 0.15) crackle(s, 1);
    if (kind === "plaza") for (let s = 0.1; s < secs - 0.4; s += 1.4) bird(s);
  });
}
// a voice line, a crowd, or a stinger, for level checks
export function renderMoment(kind, secs = 3) {
  return renderWith(secs, () => {
    A.ready = true; A.paused = false;
    if (kind === "voice") { const v = VOICES.celeste; for (let i = 0; i < 14; i++) syllable(0.05 + i * v.speed, v, mtof(v.pitch + (i % 5) - 2), VOWEL["aeiou"[i % 5]], 0.42, false); }
    else if (kind === "crowd") crowd({ loved: 4, amused: 2, offended: 2 });
    else if (EMO.includes(kind)) emote("celeste", kind);
    else if (kind.startsWith("sfx:")) sfx(kind.slice(4));
    else STINGS[kind]?.(0.05);
  });
}
