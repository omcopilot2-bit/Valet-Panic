// Shared mutable state. ES module imports are read-only bindings, so every variable that more than one module
// reassigns lives on the `G` object (G.score, G.running, ...). Objects that are only mutated (rush, tutorial, cars...) are exported directly.
import { LEVELS, MAX_LIVES, PERKS, RUSH_PERKS } from './config.js';
import { SLOT_POSITIONS } from './world.js';

export const G = {
  colliders: [],
  soundOn: undefined,
  running: false,
  paused: false,
  phase: 'arrival', // arrival | parked | pickup | exit | over
  activeCar: null,
  pickupCar: null,
  score: 0,
  streak: 0,
  served: 0,
  sequence: 0,
  shift: 1,
  quota: 3,
  lives: undefined,
  best: 0,
  seconds: 100,
  phaseTimer: 0,
  pickupLeft: 0,
  vipLeft: 0,
  lastVipSec: -1,
  wrongThisShift: 0,
  jarLevel: 0,
  shake: 0,
  wrongFlash: 0,
  bumpCd: 0,
  punch: 0,
  mode: 'classic', // 'classic' | 'rush'
  bestRush: 0,
  rngCars: Math.random,
  rngTok: Math.random,
  rngMisc: Math.random, // Seeded random streams (the Daily Run gives every player the same cars and power-up timings).
  toastTimer: 0,
  coachTimer: 0,
  coachEl: null,
  flashEl: null,
  pauseOverlay: null,
  lastRushOpts: undefined,
  slowT: 0,
  nearCd: 0,
};

export const perks = {};

export function resetPerks() { PERKS.forEach((p) => { perks[p.key] = 0; }); }

resetPerks();

export const slots = SLOT_POSITIONS.map((p, i) => ({ id: i + 1, x: p[0], z: p[1], car: null, glow: null }));

export const cars = new Set();

G.lives = MAX_LIVES;

export const newRushStats = () => ({ crashes: 0, comboLost: 0, guestsLost: 0, keysLost: 0, perfects: 0, quick: 0, perks: [], bestStreak: 0, fastest: null });

export const rush = {
  lv: LEVELS[0],                    // the shift being played
  level: 1, elapsed: 0, chain: 0, meter: 0, mult: 1, maxMult: 1, parked: 0,
  spawnIn: 0, nextSlot: null, nitro: 0, boost: 0, token: null, tokenIn: 28,
  hudT: 0, lastTick: -1, fullWarned: false, autoT: 0, readyAt: 0,
  delivered: 0, calls: [],          // guests waiting at the PICK-UP curb (several at higher levels)
  waiting: null, inbound: null, pl: null, near: null, rival: null, stallT: 0,   // rival: the AI valet you race (null in the tutorial)
  daily: false, picking: false, musicT: 0, stats: newRushStats(),
  perks: Object.fromEntries(RUSH_PERKS.map((p) => [p.key, 0])),
};

// The clock can only be topped up a little (power-up, Extra Time boon).
export const rushCap = () => rush.lv.secs + 8 * rush.perks.time + 10;

export const addTime = (s) => { G.seconds = Math.min(rushCap(), G.seconds + s); };

// Late-bound callbacks, so a low-level module can call into a higher one without importing it (keeps the import graph acyclic).
export const hooks = { rushHud: () => {} };

// Guided first run: the clock is frozen and one car walks you through the whole loop.
export const tutorial = { on: false, step: '', dist: 0, spawned: false, doneAt: 0 };

export const keys = new Set();

// Touch controls: steering wheel (steer: +1 = full left, -1 = full right), gas / brake pedals and the on-foot joystick (jx / jz in -1..1, screen directions).
export const touch = { steer: 0, gas: false, brake: false, jx: 0, jz: 0 };

export const tut = { arrive: false, pickup: false, done: false, rushDone: false };
