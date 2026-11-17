// WebAudio helper: reactive procedural music, sampled engine loop + horn/bump/door/coin one-shots, with the original
// synthesised sounds kept as a fallback (used until samples load, or if a file fails to load).
// Everything routes through one master gain, so muting is a single, consistent switch.
// Sample credits (all CC0) are in assets/sounds/CREDITS.txt.

const SAMPLE_DIR = './assets/sounds/';
const SAMPLE_FILES = {
  engine: 'engine_loop.ogg',
  horn: 'horn.ogg',
  bumpHeavy: 'bump_heavy.ogg',
  bumpLight: 'bump_light.ogg',
  door: 'door.ogg',
  coins: 'coins.ogg',
};

export function createAudio(initiallyOn = true) {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let oscGain = null;      // synth engine level (muted once the sampled engine is ready)
  let engineGain = null;   // shared output level for whichever engine is active
  let engineSrc = null;    // looping sample source
  let on = initiallyOn;
  const buffers = {};
  let loading = false;

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
    if (buffers.engine) startEngineSample();
  }

  function startEngineSample() {
    engineSrc = ctx.createBufferSource();
    engineSrc.buffer = buffers.engine;
    engineSrc.loop = true;
    engineSrc.playbackRate.value = 0.8;
    engineSrc.connect(engineGain);
    engineSrc.start();
    oscGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = on ? 1 : 0;
      master.connect(ctx.destination);

      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 56;
      oscGain = ctx.createGain();
      oscGain.gain.value = 1;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 180;
      engineOsc.connect(lowpass).connect(oscGain).connect(engineGain).connect(master);
      engineOsc.start();

      const drone = ctx.createOscillator();
      const droneGain = ctx.createGain();
      drone.type = 'sine';
      drone.frequency.value = 110;
      droneGain.gain.value = 0.012;
      drone.connect(droneGain).connect(master);
      drone.start();

      loadSamples();
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
    g.gain.setValueAtTime(gain, t);
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
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(ctx.currentTime + delay);
    return true;
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
      M.bus.gain.setTargetAtTime(0.16, ctx.currentTime, 0.3);
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
    // Pass the car's speed while driving, or null to silence the engine.
    engine(speed) {
      if (!ctx || !engineGain) return;
      const t = ctx.currentTime;
      if (speed == null) {
        engineGain.gain.setTargetAtTime(0, t, 0.1);
        return;
      }
      if (engineSrc) {
        // Idle burble that revs up with speed (speed tops out around 5.6).
        engineGain.gain.setTargetAtTime(0.12 + Math.min(0.3, speed * 0.07), t, 0.12);
        engineSrc.playbackRate.setTargetAtTime(0.8 + speed * 0.4, t, 0.15);
      } else {
        engineGain.gain.setTargetAtTime(0.018 + Math.min(0.035, speed * 0.00018), t, 0.12);
        engineOsc.frequency.setTargetAtTime(48 + speed * 0.5, t, 0.15);
      }
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