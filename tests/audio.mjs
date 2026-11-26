// WebAudio helper: reactive procedural music, model-specific engines, and sampled horn/bump/door/coin effects.
// Everything routes through one master gain, so muting is a single, consistent switch.
// Sample credits (all CC0) are in assets/sounds/CREDITS.txt.
//
// ENGINES: each car is rendered at startup into seamless looping buffers (low / mid / high RPM) using a
// small combustion model (per-cylinder firing pulses -> exhaust resonances -> muffler -> saturation).
// While driving, the three loops are crossfaded and pitched with RPM, so every car has its own firing
// order, tone and character. No sample files are needed for engines.

const SAMPLE_DIR = './assets/sounds/';
const SAMPLE_FILES = {
  horn: 'horn.ogg',
  bumpHeavy: 'bump_heavy.ogg',
  bumpLight: 'bump_light.ogg',
  door: 'door.ogg',
  coins: 'coins.ogg',
};

// Volume of each kind of sound (1 = as it was). The limiter in ensure() keeps the louder mix from clipping.
const VOL = {
  door: 0.25,       // the door thunk on parks and hand-offs: was far too loud
  horn: 1.6,
  bumpHeavy: 1.4,
  bumpLight: 1.4,
  coins: 1.5,
  blip: 2.5,        // every synth beep: combo, perfect, power-up, VIP, tick, beep-beep horn...
  music: 0.45,      // background music (was 0.22)
  engine: 1.6,      // engine, turbo whistle and blow-off
  road: 2.0,        // tyre / road noise
};

// cyl/idle/redline/firing/amps: engine layout. jitter/ampJitter: cycle-to-cycle irregularity.
// pulseMs/noise/noiseMs/tick: combustion thump, hiss/rasp and valve/injector clatter.
// res: exhaust resonances [freqHz, ringing 0..1, gain]. lp: muffler cutoff. drive: saturation.
// shiftSpeeds/cutoff/rise: gearbox and live brightness (as before).
export const ENGINE_PROFILES = {
  // Family sedan: smooth, ordinary inline-4
  'sedan.glb': {
    cyl: 4, idle: 800, redline: 6200, jitter: 0.15, ampJitter: 0.08,
    pulseMs: 3.2, noise: 0.22, noiseMs: 1.6, tick: 0.08,
    res: [[150, 0.994, 1], [330, 0.99, 0.7], [700, 0.985, 0.35]], dry: 0.5, lp: 2200, drive: 1.5,
    shiftSpeeds: [1.05, 2.25], cutoff: 900, rise: 170,
  },
  // Luxury SUV: quiet, deep, muffled V6
  'suv-luxury.glb': {
    cyl: 6, idle: 650, redline: 5400, jitter: 0.08, ampJitter: 0.05,
    pulseMs: 4.5, noise: 0.12, noiseMs: 2.2, tick: 0.04,
    res: [[95, 0.996, 1], [210, 0.992, 0.8], [430, 0.985, 0.3]], dry: 0.35, lp: 1300, drive: 1.1,
    shiftSpeeds: [0.95, 2.05], cutoff: 700, rise: 120,
  },
  // Sports sedan: lumpy, burbling V8 with uneven bank amplitudes
  'sedan-sports.glb': {
    cyl: 8, idle: 750, redline: 7200, jitter: 0.3, ampJitter: 0.12,
    amps: [1, 0.65, 0.9, 0.6, 1, 0.65, 0.9, 0.6],
    pulseMs: 3.8, noise: 0.3, noiseMs: 2, tick: 0.06,
    res: [[85, 0.997, 1.2], [170, 0.994, 0.9], [380, 0.99, 0.6], [900, 0.98, 0.35]], dry: 0.45, lp: 2800, drive: 2.0,
    shiftSpeeds: [1.2, 2.7], cutoff: 1500, rise: 240,
  },
  // Hot hatch: high-revving, raspy turbo four with whistle and blow-off
  'hatchback-sports.glb': {
    cyl: 4, idle: 900, redline: 7600, jitter: 0.1, ampJitter: 0.1,
    pulseMs: 2.2, noise: 0.35, noiseMs: 1.2, tick: 0.15,
    res: [[210, 0.993, 1], [480, 0.99, 0.8], [1050, 0.985, 0.6], [2200, 0.97, 0.25]], dry: 0.5, lp: 3600, drive: 2.2,
    turbo: true,
    shiftSpeeds: [1.1, 2.45], cutoff: 1250, rise: 210,
  },
  // Taxi: clattery, lumpy diesel four
  'taxi.glb': {
    cyl: 4, idle: 750, redline: 4800, jitter: 0.35, ampJitter: 0.2,
    pulseMs: 2, noise: 0.9, noiseMs: 1.0, tick: 0.5,
    res: [[130, 0.993, 1], [290, 0.99, 0.8], [600, 0.985, 0.5]], dry: 0.6, lp: 1700, drive: 1.8,
    shiftSpeeds: [1, 2.2], cutoff: 720, rise: 140,
  },
};

export function gearForSpeed(speed, shiftSpeeds, currentGear = 0, hysteresis = 0.18) {
  let gear = Math.max(0, Math.min(shiftSpeeds.length, currentGear));
  while (gear < shiftSpeeds.length && speed >= shiftSpeeds[gear]) gear++;
  while (gear > 0 && speed < shiftSpeeds[gear - 1] - hysteresis) gear--;
  return gear;
}

// Legacy helper kept for compatibility (returned an oscillator frequency, not real RPM).
export function engineRpm(speed, profile, gear) {
  const gearStart = gear > 0 ? profile.shiftSpeeds[gear - 1] : 0;
  const gearEnd = profile.shiftSpeeds[gear] ?? 5.6;
  const gearProgress = Math.max(0, Math.min(1, (Math.min(speed, 5.6) - gearStart) / (gearEnd - gearStart)));
  return (profile.base ?? 70) + gear * (profile.gearStep ?? 55) + gearProgress * (profile.rev ?? 108);
}

// Real engine RPM for a speed/gear: climbs through each gear and drops back after each upshift.
export function engineRevs(speed, profile, gear) {
  const top = profile.redline * 0.92;
  const start = gear > 0 ? profile.shiftSpeeds[gear - 1] : 0;
  const end = profile.shiftSpeeds[gear] ?? 5.6;
  const prog = Math.max(0, Math.min(1, (Math.min(speed, 5.6) - start) / (end - start)));
  const lo = gear === 0 ? profile.idle * 1.15 : top * 0.58;
  return lo + (top - lo) * prog;
}

/* ---------- engine loop renderer (pure JS, no WebAudio needed) ---------- */
const RENDER_SR = 32000;
const LAYER_BRIGHT = [0.75, 1, 1.3];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resonate(x, f, r, sr) {
  const len = x.length;
  const a1 = 2 * r * Math.cos(2 * Math.PI * f / sr), a2 = -r * r, g = 1 - r;
  const out = new Float32Array(len);
  let y1 = 0, y2 = 0;
  for (let n = 0; n < len * 2; n++) {      // two passes so the loop is seamless
    const i = n % len;
    const y = g * x[i] + a1 * y1 + a2 * y2;
    y2 = y1; y1 = y;
    if (n >= len) out[i] = y;
  }
  return out;
}

function onePoleLow(x, fc, sr) {
  const len = x.length, a = 1 - Math.exp(-2 * Math.PI * fc / sr);
  const out = new Float32Array(len);
  let y = 0;
  for (let n = 0; n < len * 2; n++) {
    const i = n % len;
    y += a * (x[i] - y);
    if (n >= len) out[i] = y;
  }
  return out;
}

// Renders ~1 s of seamlessly looping engine at `rpm` for profile `p`.
export function renderEngineLoop(p, rpm, bright = 1, seed = 1, sr = RENDER_SR) {
  const cycleSec = 120 / rpm;                                   // one 4-stroke cycle = 720 deg
  const cycles = Math.max(2, Math.round(1.1 / cycleSec));
  const len = Math.round(cycleSec * cycles * sr);
  const x = new Float32Array(len);
  const rand = rng(seed);
  const firing = p.firing || Array.from({ length: p.cyl }, (_, k) => k / p.cyl);
  const pulseN = Math.max(8, Math.round(sr * p.pulseMs / 1000));
  const noiseN = Math.max(4, Math.round(sr * p.noiseMs / 1000));
  const tickOff = Math.round(sr * 0.004);

  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < p.cyl; k++) {
      const jit = (rand() - 0.5) * p.jitter / p.cyl;
      const i0 = Math.floor(((c + firing[k] + jit) / cycles) * len);
      const amp = (p.amps ? p.amps[k % p.amps.length] : 1) * (1 + (rand() - 0.5) * p.ampJitter);
      for (let n = 0; n < pulseN; n++) {                         // combustion thump
        const s = Math.sin(Math.PI * n / pulseN);
        x[(i0 + n) % len] += amp * s * s;
      }
      for (let n = 0; n < noiseN * 5; n++) {                     // exhaust hiss / diesel rasp
        x[(i0 + n) % len] += amp * p.noise * (rand() * 2 - 1) * Math.exp(-n / noiseN);
      }
      const j = (i0 + tickOff) % len;                            // valve / injector tick
      const sign = rand() > 0.5 ? 1 : -1;
      x[j] += amp * p.tick * sign;
      x[(j + 1) % len] -= amp * p.tick * sign;
    }
  }

  const mix = new Float32Array(len);
  for (let i = 0; i < len; i++) mix[i] = x[i] * p.dry;
  for (const [f, r, g] of p.res) {
    const y = resonate(x, f, r, sr);
    for (let i = 0; i < len; i++) mix[i] += y[i] * g * 6;
  }
  let y = onePoleLow(mix, p.lp * bright, sr);
  y = onePoleLow(y, p.lp * bright * 1.6, sr);
  const dc = onePoleLow(y, 35, sr);                              // remove DC / sub-rumble
  let peak = 0;
  for (let i = 0; i < len; i++) {
    y[i] = Math.tanh((y[i] - dc[i]) * p.drive);
    peak = Math.max(peak, Math.abs(y[i]));
  }
  const norm = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < len; i++) y[i] *= norm;
  return y;
}

function layerRpms(p) {
  return [p.idle * 1.15, p.idle + (p.redline - p.idle) * 0.42, p.redline * 0.82];
}

function layerWeights(rpm, rpms) {
  const w = [0, 0, 0];
  if (rpm <= rpms[0]) w[0] = 1;
  else if (rpm >= rpms[2]) w[2] = 1;
  else {
    const i = rpm < rpms[1] ? 0 : 1;
    const f = (rpm - rpms[i]) / (rpms[i + 1] - rpms[i]);
    w[i] = Math.cos(f * Math.PI / 2);
    w[i + 1] = Math.sin(f * Math.PI / 2);
  }
  return w;
}

export function createAudio(initiallyOn = true) {
  let ctx = null;
  let master = null;
  let engineFilter = null;
  let engineGain = null;   // shared output level for whichever engine is active
  let engineShiftGain = null;
  let roadGain = null;
  let turboOsc = null;
  let turboGain = null;
  let on = initiallyOn;
  const buffers = {};
  let loading = false;
  let engineModel = null;
  let engineGear = 0;
  let lastEngineSpeed = 0;
  let lastEngineTime = 0;
  let load = 0.4;
  let active = null;       // currently sounding engine voice
  const voices = {};       // rendered loop buffers per model

  async function loadSamples() {
    if (loading || !ctx) return;
    loading = true;
    await Promise.all(Object.entries(SAMPLE_FILES).map(async ([key, file]) => {
      try {
        const res = await fetch(SAMPLE_DIR + file);
        if (!res.ok) throw new Error(res.status);
        const data = await res.arrayBuffer();
        buffers[key] = await ctx.decodeAudioData(data);
      } catch (e) { /* keep the synth fallback for this sound */ }
    }));
  }

  function getVoice(key) {
    if (voices[key]) return voices[key];
    const p = ENGINE_PROFILES[key];
    const rpms = layerRpms(p);
    const seed = 1000 + Object.keys(ENGINE_PROFILES).indexOf(key) * 97;
    const bufs = rpms.map((r, i) => {
      const data = renderEngineLoop(p, r, LAYER_BRIGHT[i], seed + i);
      const b = ctx.createBuffer(1, data.length, RENDER_SR);
      b.copyToChannel(data, 0);
      return b;
    });
    return (voices[key] = { bufs, rpms });
  }

  function prefetchVoices() {
    const keys = Object.keys(ENGINE_PROFILES);
    let i = 0;
    const next = () => { if (i < keys.length) { getVoice(keys[i++]); setTimeout(next, 120); } };
    setTimeout(next, 300);
  }

  function activate(key) {
    const v = getVoice(key);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(engineFilter);
    const layers = v.bufs.map((buf) => {
      const s = ctx.createBufferSource();
      const g = ctx.createGain();
      s.buffer = buf;
      s.loop = true;
      g.gain.value = 0;
      s.connect(g).connect(out);
      s.start(0, Math.random() * buf.duration);
      return { s, g };
    });
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    return { out, layers, rpms: v.rpms };
  }

  function deactivate(a) {
    if (!a) return;
    a.out.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => {
      a.layers.forEach((l) => { try { l.s.stop(); } catch (e) { /* already stopped */ } });
      a.out.disconnect();
    }, 500);
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = on ? 1 : 0;
      // A gentle limiter: everything can play louder without crackling when several sounds overlap.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(ctx.destination);

      // engine chain: voice -> filter -> level -> shift cut -> master
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.Q.value = 0.7;
      engineFilter.frequency.value = 2000;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineShiftGain = ctx.createGain();
      engineShiftGain.gain.value = 1;
      engineFilter.connect(engineGain).connect(engineShiftGain).connect(master);

      // road / tyre noise, scales with speed
      const nLen = ctx.sampleRate * 2;
      const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
      const nd = nBuf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < nLen; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.3; nd[i] = b; }
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = nBuf;
      nSrc.loop = true;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = 350;
      nFilter.Q.value = 0.6;
      roadGain = ctx.createGain();
      roadGain.gain.value = 0;
      nSrc.connect(nFilter).connect(roadGain).connect(master);
      nSrc.start();

      // turbo whistle (only audible on turbo cars)
      turboOsc = ctx.createOscillator();
      turboOsc.type = 'sine';
      turboOsc.frequency.value = 2000;
      turboGain = ctx.createGain();
      turboGain.gain.value = 0;
      turboOsc.connect(turboGain).connect(master);
      turboOsc.start();

      loadSamples();
      prefetchVoices();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function blip(type, f0, f1, gain, dur, delay = 0) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + Math.min(dur, 0.15));
    g.gain.setValueAtTime(gain * VOL.blip, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // One-shot sample. Returns false if the sample is not available so callers can fall back.
  function sample(key, gain = 1, rate = 1, delay = 0) {
    const buf = buffers[key];
    if (!ctx || !on || !buf) return false;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    g.gain.value = gain * (VOL[key] ?? 1);
    src.connect(g).connect(master);
    src.start(ctx.currentTime + delay);
    return true;
  }

  // Turbo blow-off: short filtered-noise "pssh" on upshift
  function blowOff() {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
    f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * VOL.engine, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const jitter = (base, amt = 0.08) => base * (1 + (Math.random() - 0.5) * 2 * amt);

  /* ---------- procedural music ----------
     A tiny step sequencer (16th notes) over an A-minor loop: Am - F - C - G.
     Layers fade in with `intensity` (0..1): kick + bass + pad always, hats, snare, then arpeggios.
     Tempo and key are set by the game from the combo and level. */
  const M = { timer: 0, step: 0, next: 0, running: false, bus: null, noise: null, intensity: 0.2, bpm: 100, key: 0 };
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // MIDI: Am F C G
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function noiseBuffer() {
    if (M.noise) return M.noise;
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    M.noise = buf;
    return buf;
  }

  function tone(type, midi, t, dur, gain, cutoff = 2400, attack = 0.005) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = mtof(midi + M.key);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(M.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function hit(t, kind) {
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(130, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g).connect(M.bus);
      osc.start(t);
      osc.stop(t + 0.22);
      return;
    }
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuffer();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7500 : 1800;
    g.gain.setValueAtTime(kind === 'hat' ? 0.07 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.04 : 0.14));
    src.connect(f).connect(g).connect(M.bus);
    src.start(t);
    src.stop(t + 0.18);
  }

  function playStep(s, t) {
    const k = M.intensity;
    const chord = CHORDS[Math.floor(s / 16) % 4];
    const i = s % 16;
    const calm = k < 0.3;

    if (calm ? i % 8 === 0 : i % 4 === 0) hit(t, 'kick');
    if (i === 0) for (const n of chord) tone('triangle', n, t, 60 / M.bpm * 4 * 0.95, 0.05, 900, 0.18);   // pad
    if ([0, 3, 6, 8, 11, 14].includes(i)) tone('triangle', chord[0] - 24 + (i === 6 || i === 14 ? 7 : 0), t, 0.2, 0.2, 520);
    if (k > 0.3 && i % 2 === 1) hit(t, 'hat');
    if (k > 0.6 && (i === 4 || i === 12)) hit(t, 'snare');
    if (k > 0.45) {
      const order = [0, 1, 2, 1];
      tone('square', chord[order[i % 4]] + 12, t, 0.13, 0.04 + 0.03 * k, 1800 + 2000 * k);
      if (k > 0.8 && i % 2 === 0) tone('square', chord[order[(i + 2) % 4]] + 24, t, 0.1, 0.025, 3200);
    }
  }

  function musicTick() {
    if (!ctx || !M.running) return;
    while (M.next < ctx.currentTime + 0.16) {
      playStep(M.step, M.next);
      M.next += 60 / M.bpm / 4;
      M.step++;
    }
  }

  return {
    ensure,
    // Music: start() after a user gesture, set() every frame-ish, stop() to fade out.
    musicStart() {
      ensure();
      if (!ctx) return;
      if (!M.bus) {
        M.bus = ctx.createGain();
        M.bus.gain.value = 0;
        M.bus.connect(master);
      }
      M.bus.gain.cancelScheduledValues(ctx.currentTime);
      M.bus.gain.setTargetAtTime(VOL.music, ctx.currentTime, 0.3);
      if (M.running) return;
      M.running = true;
      M.step = 0;
      M.next = ctx.currentTime + 0.08;
      M.timer = setInterval(musicTick, 40);
    },
    musicSet(intensity, bpm, key = 0) {
      M.intensity = Math.max(0, Math.min(1, intensity));
      M.bpm = Math.max(70, Math.min(170, bpm));
      M.key = key;
    },
    musicStop(fade = 0.6) {
      if (!ctx || !M.running) return;
      M.bus.gain.cancelScheduledValues(ctx.currentTime);
      M.bus.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      M.running = false;
      clearInterval(M.timer);
    },
    setEnabled(v) {
      on = v;
      if (ctx) master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.05);
      if (v) ensure();
    },
    // Pause/resume the whole context (used for game pause and tab hide only).
    pause(p) {
      if (!ctx) return;
      if (p) ctx.suspend();
      else ctx.resume();
    },
    // Pass the car's speed and model while driving, or null to silence the engine.
    engine(speed, model) {
      if (!ctx || !engineGain) return;
      const t = ctx.currentTime;
      if (speed == null) {
        engineGain.gain.setTargetAtTime(0, t, 0.1);
        roadGain.gain.setTargetAtTime(0, t, 0.1);
        turboGain.gain.setTargetAtTime(0, t, 0.05);
        engineShiftGain.gain.setTargetAtTime(1, t, 0.05);
        lastEngineSpeed = 0;
        engineGear = 0;
        load = 0.4;
        return;
      }
      const key = ENGINE_PROFILES[model] ? model : 'taxi.glb';
      const profile = ENGINE_PROFILES[key];
      if (engineModel !== key) {
        deactivate(active);
        active = activate(key);
        engineModel = key;
        engineGear = 0;
      }

      // throttle load from acceleration: pushing = loud/bright, coasting = quieter/duller
      const dt = t - lastEngineTime;
      if (dt > 0.005 && dt < 0.5) {
        const accel = (speed - lastEngineSpeed) / dt;
        const target = Math.max(0.25, Math.min(1, 0.45 + accel * 2.5));
        load += (target - load) * Math.min(1, dt * 6);
      }
      lastEngineTime = t;

      const nextGear = gearForSpeed(speed, profile.shiftSpeeds, engineGear);
      const upshift = nextGear > engineGear;
      engineGear = nextGear;
      const rpm = engineRevs(speed, profile, engineGear);

      if (upshift) {                                    // brief torque cut on each shift
        engineShiftGain.gain.cancelScheduledValues(t);
        engineShiftGain.gain.setValueAtTime(1, t);
        engineShiftGain.gain.linearRampToValueAtTime(0.35, t + 0.03);
        engineShiftGain.gain.linearRampToValueAtTime(1, t + 0.2);
        if (profile.turbo) blowOff();
      }

      const w = layerWeights(rpm, active.rpms);
      active.layers.forEach((l, i) => {
        l.s.playbackRate.setTargetAtTime(rpm / active.rpms[i], t, upshift ? 0.02 : 0.06);
        l.g.gain.setTargetAtTime(w[i], t, 0.05);
      });

      const norm = Math.max(0, Math.min(1, (rpm - profile.idle) / (profile.redline - profile.idle)));
      engineGain.gain.setTargetAtTime((0.28 + norm * 0.2) * (0.7 + 0.3 * load) * VOL.engine, t, 0.08);
      engineFilter.frequency.setTargetAtTime((profile.cutoff + speed * profile.rise) * 2 * (0.55 + 0.45 * load), t, 0.12);
      roadGain.gain.setTargetAtTime(Math.pow(Math.min(speed / 5.6, 1), 1.5) * 0.07 * VOL.road, t, 0.15);
      if (profile.turbo) {
        turboOsc.frequency.setTargetAtTime(1800 + norm * 4200, t, 0.1);
        turboGain.gain.setTargetAtTime(0.012 * load * norm * norm * VOL.engine, t, 0.12);
      } else {
        turboGain.gain.setTargetAtTime(0, t, 0.05);
      }
      lastEngineSpeed = speed;
    },
    play(kind, n = 0, style = 'classic') {
      switch (kind) {
        case 'honk':
          if (style === 'beep') { blip('square', 440, 440, 0.03, 0.12); return blip('square', 554, 554, 0.03, 0.16, 0.16); }
          if (style === 'trumpet') { blip('sawtooth', 392, 392, 0.04, 0.4); blip('sawtooth', 494, 494, 0.035, 0.4, 0.02); return blip('sawtooth', 587, 587, 0.03, 0.45, 0.04); }
          if (sample('horn', 0.5, jitter(1, 0.04))) return;
          return blip('square', 330, 330, 0.03, 0.25);
        case 'bump':
          if (sample(Math.random() < 0.5 ? 'bumpHeavy' : 'bumpLight', 0.7, jitter(1, 0.1))) return;
          return blip('triangle', 120, 50, 0.08, 0.2);
        case 'good': // door thunk when a car is parked or handed back
          blip('sine', 640, 920, 0.045, 0.18);
          return sample('door', 0.35, jitter(1.1, 0.05));
        case 'vip': return blip('sine', 760, 1180, 0.05, 0.28);
        case 'chain': { // combo level-up: pitch climbs with the multiplier
          const f = 520 * Math.pow(1.0595, Math.min(n, 8) * 2);
          blip('triangle', f, f * 1.5, 0.05, 0.22);
          return blip('sine', f * 2, f * 2, 0.03, 0.3, 0.07);
        }
        case 'power': // power-up pickup
          blip('square', 500, 1000, 0.03, 0.2);
          return blip('sine', 1000, 1500, 0.05, 0.25, 0.08);
        case 'tick': return blip('square', 900, 900, 0.02, 0.05);
        case 'perfect': { // quick rising arpeggio; each perfect in a row climbs two semitones
          const k = Math.pow(1.0595, (Math.min(Math.max(n, 1), 8) - 1) * 2);
          sample('door', 0.3, 1.15);
          blip('sine', 880 * k, 880 * k, 0.05, 0.14, 0);
          blip('sine', 1175 * k, 1175 * k, 0.05, 0.14, 0.09);
          return blip('sine', 1568 * k, 1568 * k, 0.055, 0.3, 0.18);
        }
        case 'jar': // coin clink
          if (sample('coins', 0.6)) return;
          blip('triangle', 1400, 1400, 0.04, 0.1, 0);
          return blip('triangle', 2100, 2100, 0.04, 0.22, 0.07);
        default: // 'bad' (wrong keys / strike): dull metallic knock plus the old descending blip
          sample('bumpLight', 0.5, 0.7);
          return blip('sine', 210, 115, 0.045, 0.18);
      }
    },
  };
}