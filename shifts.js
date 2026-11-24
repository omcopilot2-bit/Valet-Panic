// Duel mode (the Shifts campaign): you are the valet on foot. Arrivals, parking, guest calls, hand-offs, combo and the closing-time ending. The HUD lives in hud.js, the results card in results.js, the rival in rival.js.
import * as THREE from 'three';
import { CAR_BODY_OFFSETS, CAR_BODY_RADIUS, carPathBlocked, carPathHitsCircle, circleVsCollider, circleVsParkingBox, separationNormal } from './collision.js';
import { disposeCar, makeRandomCar, placeCar, resetLot, seedCars, updateTags } from './cars.js';
import { parkCar } from './classic.js';
import { angleDifference, BOUNDS, DOOR, dropPath, DROPOFF, duelGoals, exitPath, duelStars, EXIT_LANE_BACK, EXIT_LANE_FRONT, HANDOFF, HANDOFF_ANGLE, HANDOFF_YAW, LEVELS, MAX_LIVES, PARKED_HALF, reduceMotion, RUSH_PERKS, SPECIALS, VIP_WINDOW } from './config.js';
import { applyModeHud, audio, bubble, coach, confetti, formatTime, markAllSlots, markTarget, modelCache, openSlots, parkRadius, parkSpeed, parkYaw, PARK_ANGLE, popScore, toast, ui, worldToScreen } from './core.js';
import { angleToBay, drive, hornTick, stepExit, stepSnap } from './driving.js';
import { ringBurst } from './fx.js';
import { armResultsKeys, cancelPeek } from './input.js';
import { enterBuilding, guide, otherPeople, poof, pushFromPeople, removeFigure, spawnFigure, walkTo } from './people.js';
import * as platform from './platform.js';
import { addXp, logRun, persist, recordLevel, save, submitScore } from './progress.js';
import { applyLevelLayout, clearToken, closePerkPicker, collectToken, fireEvent, nearMiss, offerShiftIntro, spawnToken, tokenDelay, tokenTexture, updateLevelProps } from './shifts-world.js';
import { cars, G, hooks, keys, newRushStats, resetPerks, rivalScore, rush, slots, touchInput, tut, tutorial } from './state.js';
import { newRival, stepRivalCar, updateRival } from './rival.js';
import { updateRushHUD } from './hud.js';
import { showShiftResults } from './results.js';
import { coneAlleyArrivalRoute, coneAlleyExitRoute } from './routes.js';

const rushDrain = () => (1 / Math.max(6, 11 - (rush.level - 1) * 0.5)) * (1 - 0.2 * rush.perks.combo);   // meter empties in 7s, shrinking to 3.5s

export const rushLeaveDelay = () => Math.min(34, 20 + rush.level * 1.5);         // how long a parked car lingers before its guest returns

const rushTip = (base) => Math.round(base * rush.mult * (rush.boost > 0 ? 2 : 1) * (rush.wedding > 0 ? 1.3 : 1) * (1 + 0.2 * rush.perks.tips));

const keyWait = () => Math.max(22, 36 - (rush.level - 1) * 1.5) * (1 + 0.15 * rush.perks.calm);    // how long a dropped-off car may sit

const callWait = () => Math.max(28, 46 - (rush.level - 1) * 1.5) * (1 + 0.15 * rush.perks.calm);   // how long a guest waits at the curb

G.lastRushOpts = { level: 1 };

hooks.rushHud = updateRushHUD;   // lets shifts-world refresh the HUD without importing this module

// A small mini-goal for every shift. Done = +25 XP on the results screen.
const MINI_GOALS = [
  { text: 'Park 3 cars perfectly', done: (st) => st.perfects >= 3 },
  { text: 'Finish with zero crashes', done: (st) => st.crashes === 0 },
  { text: 'Make 2 quick hand-offs', done: (st) => st.quick >= 2 },
  { text: 'Reach a ×4 combo', done: (st, r) => r.maxMult >= 4 },
];


const LINES = {
  park: ['Nice parking!', 'Smooth!', 'Wow, a pro!', 'Not a scratch!'],
  bad: ['Easy on the paint!', 'Careful!', 'Yikes!', 'My bumper!'],
  hand: ['Thanks, champ!', 'Lovely service!', 'Keep the change!', 'Five stars!'],
};

export const rline = (a) => a[Math.floor(Math.random() * a.length)];

// Midgame ad at a natural break (the results screen), at most every second restart. Silent no-op without the SDK.
let adBreaks = 0;

let skipNextMidgame = false;   // a rewarded video was just watched: never put a midgame ad right behind it

export function withAd(then) {
  if (platform.adBusy()) return;   // an ad is already requested or playing: ignore repeated clicks
  if (skipNextMidgame) { skipNextMidgame = false; then(); return; }
  adBreaks++;
  if (adBreaks % 2 !== 0) { then(); return; }
  platform.midgameAd(() => audio.pause(true), () => { audio.pause(false); then(); });
}

function loseCombo() {
  if (rush.chain > 0) rush.stats.comboLost++;
  rush.chain = 0; rush.mult = 1; rush.meter = 0;
}

// Allocation-free scans over the live car set (these run every frame).
const carBuf = [];
const anyCar = (pred) => { for (const c of cars) if (pred(c)) return true; return false; };

/* ---------- flow ---------- */
// opts: { level } for a campaign shift, { tutorial } for the guided first run, { sceneLab } for a non-recording sandbox.
export function startRush(opts) {
  if (!modelCache.size) { toast('Loading the car collection…'); return; }
  const o = opts && typeof opts === 'object' && !(opts instanceof Event) ? opts : {};
  const isTut = !!o.tutorial;
  const sceneLab = !!o.sceneLab;
  const lv = isTut ? LEVELS[0] : (LEVELS.find((l) => l.id === o.level) || LEVELS[0]);
  if (!isTut && !sceneLab) G.lastRushOpts = { level: lv.id };
  closePerkPicker();
  G.mode = 'rush';
  rush.lv = lv;
  applyLevelLayout(lv);
  applyModeHud();
  resetPerks();
  G.score = 0; G.streak = 0; G.sequence = 0; G.shift = 1; G.lives = MAX_LIVES; G.jarLevel = 0; G.wrongThisShift = 0;
  Object.assign(rush, {
    lv, level: lv.diff, sceneLab, elapsed: 0, chain: 0, meter: 0, mult: 1, maxMult: 1, parked: 0,
    spawnIn: 1.5, nextSlot: null, nitro: 0, boost: 0, tokenIn: 28, hudT: 0, lastTick: -1,
    fullWarned: false, autoT: 0, delivered: 0, calls: [], arrived: 0, guestTotal: sceneLab ? Infinity : isTut ? 1 : lv.guests, doneT: null, closingNoted: false,
    waiting: null, inbound: null, pl: null, near: null, rival: null, stallT: 0,
    picking: false, stats: newRushStats(), endNext: null,
    wedding: 0, vipNext: 0, coffee: 0, perfectStreak: 0, hornCd: 0, doorT: 0, doorman: null,
    enterT: 0, stillT: 0, lastPark: null,
    eventIn: 26 + Math.random() * 10,
    mini: isTut || sceneLab ? null : (lv.id - 1) % MINI_GOALS.length,
    perks: Object.fromEntries(RUSH_PERKS.map((p) => [p.key, 0])),
  });
  Object.assign(tutorial, { on: isTut, step: 'key', spawned: false, doneT: 0 });
  resetLot();
  G.seconds = lv.secs;
  G.running = true;
  G.paused = false;
  G.phase = 'arrival';
  G.phaseTimer = 0;
  ui.overlay.classList.add('hide');
  document.body.classList.remove('menu');
  // A few cars are already in the lot, and they drive off on their own (the tutorial lot starts nearly empty).
  seedCars(isTut ? 1 : Math.min(3, Math.floor(lv.bays.length / 2)), false);
  if (!isTut) for (const c of cars) if (c.parked) c.leaveIn = lv.callsFrom + 22 + Math.random() * 10;   // the first guests come back soon, so the lot never jams early
  rush.pl = { mode: 'foot', x: -8.4, z: 7.2, yaw: 0, fig: null };   // you: the valet, on foot
  playerExit(-8.4, 7.2);
  rush.doorman = spawnFigure('doorman', DOOR.x - 1.4, Math.max(DOOR.z + 1.2, -8.2), 0);   // the lobby doorman, who tips his hat after every hand-off
  rush.doorman.buildingRoute = true;   // he stands on the door step, behind the lot boundary, so he must not be pulled back onto the lot
  rush.rival = isTut || sceneLab ? null : newRival(lv); // the AI valet is disabled for tutorials and layout playtests
  updateRushHUD();
  formatTime();
  audio.musicStart();
  platform.gameplayStart();
  const announce = () => {
    if (isTut) return;
    if (sceneLab) { toast(`SCENE LAB · SHIFT ${lv.id} · ${lv.name} · NO PROGRESS SAVED`); return; }
    toast(`SHIFT ${lv.id} · ${lv.name} · ${lv.guests} guests · beat the rival!`);
    if (rush.mini !== null) coach(`🎯 Mini-goal: ${MINI_GOALS[rush.mini].text}`, 6000);
  };
  // Shift 1 and the tutorial start at once; every later shift opens with the boon picker, with the clock frozen.
  if (!isTut && !sceneLab && lv.id >= 2) { platform.gameplayStop(); offerShiftIntro(announce); }
  else announce();
}

// Ends the guided run (done or skipped) and starts shift 1 for real.
export function finishTutorial(skipped) {
  tutorial.on = false;
  tut.rushDone = true;
  save.tut.rush = true;
  persist();
  startRush({ level: 1 });
  toast(skipped ? 'Tutorial skipped. Good luck!' : '🎉 Tutorial complete! Here is your first real shift.');
}

export function endRush(cleared = false) {
  G.running = false;
  G.paused = false;
  cancelPeek();
  keys.clear();
  audio.engine(null);
  audio.musicStop(1.2);
  closePerkPicker();
  if (G.pauseOverlay) G.pauseOverlay.classList.add('hide');
  G.phase = 'over';
  platform.gameplayStop();
  clearToken();
  for (const call of [...rush.calls]) endCall(call);
  ui.time.classList.remove('low');

  const lv = rush.lv;
  const clearBonus = cleared ? 20 + Math.floor(G.seconds) : 0;   // finishing early pays
  G.score += clearBonus;
  const st = rush.stats;
  st.parked = rush.parked;
  st.delivered = rush.delivered;
  // The duel: you win by parking and returning more cars than the rival. Tips still count for the score and the leaderboard.
  const you = rush.parked + rush.delivered;
  const rvN = rivalScore();
  const margin = you - rvN;
  const dg = duelGoals(lv);
  const stars = duelStars(lv, margin);
  if (stars >= 3) platform.happyTime();
  const mini = rush.mini !== null && rush.mini !== undefined ? MINI_GOALS[rush.mini] : null;
  const miniDone = !!mini && mini.done(st, rush);
  let xp = Math.round(G.score / 8) + rush.parked * 3 + rush.delivered * 6 + stars * 30 + (miniDone ? 25 : 0);
  const info = recordLevel(lv, G.score, stars);
  if (info.firstClear) xp += 40;
  submitScore('shift' + lv.id, G.score);
  const prog = addXp(xp);
  logRun({
    shift: lv.id, score: G.score, stars, cleared,
    secsLeft: Math.round(G.seconds), secsTotal: lv.secs, parked: rush.parked, delivered: rush.delivered,
    you, rival: rvN, margin,
    crashes: st.crashes, guestsLost: st.guestsLost, keysLost: st.keysLost, maxMult: rush.maxMult,
    boon: st.perks.join(''), miniDone,
  });
  const next = stars >= 1 && LEVELS[lv.id] ? { level: lv.id + 1 } : null;   // LEVELS[id] is the following shift
  rush.endNext = next || G.lastRushOpts;
  armResultsKeys();

  showShiftResults({ lv, st, mini, miniDone, cleared, clearBonus, you, rvN, margin, dg, stars, info, prog, next }, {
    next: next ? () => withAd(() => startRush(next)) : null,
    again: () => withAd(() => startRush(G.lastRushOpts)),
    // Optional bonus: watch a video, get this shift's XP a second time. Granted only if the ad finished; XP is never needed to progress.
    reward: {
      state: platform.rewardedState(),
      xp: prog.gained,
      claim: (done) => platform.rewardedAd(() => audio.pause(true), (ok, error) => {
        audio.pause(false);
        if (!ok) { done(null, error); return; }
        skipNextMidgame = true;
        done(addXp(prog.gained));
      }),
    },
  });
}

// A guest's car arrives on its own and stops at the drop-off. Nobody drives it but you.
function rushSpawn() {
  const free = openSlots().filter((s) => !s.car && !anyCar((c) => c.slot === s));   // a bay a car is still driving to counts as taken
  if (!free.length) return false;
  const slot = rush.nextSlot && !rush.nextSlot.car ? rush.nextSlot : free[Math.floor(Math.random() * free.length)];
  const car = makeRandomCar();
  car.slot = slot;
  car.tag.visible = false;             // no ID tags in this mode
  car.arriving = true;
  rush.inbound = car;
  rush.arrived++;
  if (rush.lv.id === 4) {
    car.arrivalRoute = coneAlleyArrivalRoute();
    car.arrivalRouteIndex = 0;
    car.exitRoute = coneAlleyExitRoute();
    placeCar(car, car.arrivalRoute[0].x, car.arrivalRoute[0].z, car.arrivalRoute[0].yaw);
  } else placeCar(car, -16.3, DROPOFF.z, Math.PI / 2);
  const rest = free.filter((s) => s !== slot);
  rush.nextSlot = rest.length && rush.arrived < rush.guestTotal ? rest[Math.floor(Math.random() * rest.length)] : null;
  if (tutorial.on) tutorial.spawned = true;
  if (car.vip) audio.play('vip');
  updateRushHUD();
  return true;
}

export function rushParked(car, bay, q, perfect) {
  const prevMult = rush.mult;
  rush.chain += perfect ? 2 : 1;
  rush.meter = 1;
  rush.mult = 1 + Math.min(7, Math.floor(rush.chain / 3));
  rush.maxMult = Math.max(rush.maxMult, rush.mult);
  if (perfect) {
    rush.stats.perfects++;
    rush.perfectStreak++;
    rush.stats.bestStreak = Math.max(rush.stats.bestStreak, rush.perfectStreak);
  } else rush.perfectStreak = 0;

  let base = 10 + Math.round(q * 10) + (perfect ? 8 : 0) + (car.quirk ? 6 : 0);
  if (car.vipActive) base *= 2;
  if (car.special === 'celeb') base = Math.round(base * 1.8);
  else if (car.special === 'vintage') base = Math.round(base * 1.5);
  const tip = rushTip(base);
  G.score += tip;
  rush.parked++;
  G.sequence++;

  car.snap = { x0: car.x, z0: car.z, y0: car.yaw, t: 0 };
  car.speed = 0; car.vx = 0; car.vz = 0;
  car.parked = true;
  car.tagTimer = 0;
  car.tag.visible = false;
  car.parkQuality = q;
  car.leaveIn = rushLeaveDelay() * (0.8 + Math.random() * 0.4);
  car.bump = 0.25;
  ringBurst(bay.x, bay.z, perfect ? 0xffd34a : 0x9fd8ff);
  bay.car = car;
  G.activeCar = null;
  rush.spawnIn = 2.5 + rush.lv.gap * 3;
  rush.autoT = 0;

  const s = worldToScreen(bay.x, bay.z, 1.2);
  popScore(`${perfect ? 'PERFECT ' : ''}+$${tip}`, s.x, s.y);
  if (perfect) {
    bubble(rline(LINES.park), bay.x, bay.z, 2.4);
    if (rush.stats.perfects % 3 === 0) {   // every third perfect park fills the tip jar
      G.score += 10;
      popScore('🪙 TIP JAR +$10', s.x, s.y - 30, '#ffd34a');
      audio.play('jar');
    }
  }
  if (car.special === 'celeb') popScore('📸 FLASH!', s.x + 46, s.y - 26, '#ffffff');
  if (rush.mult > prevMult) {
    popScore(`COMBO ×${rush.mult}!`, innerWidth / 2, Math.max(150, innerHeight * 0.3), '#6cc8ff');
    audio.play('chain', rush.mult);
    if (!reduceMotion) G.punch = 1;
  } else if (perfect) {
    audio.play('perfect', rush.perfectStreak);
  } else {
    audio.play('good');
  }
  if (perfect) {
    confetti(bay.x, bay.z);
    if (!reduceMotion) G.punch = Math.max(G.punch, 0.6);
  }
  if (tutorial.on) { tutorial.step = 'call'; startCall(car); }   // guided run: the guest wants to leave right away
  updateRushHUD();
}

export function rushBump(car) {
  rush.stats.crashes++;
  if (rush.chain > 0) rush.meter = Math.max(0, rush.meter - (rush.perks.guards ? 0.15 : 0.3));
  const s = worldToScreen(car.x, car.z, 1.4);
  popScore('CRASH', s.x, s.y, '#ff6b5e');
  rush.perfectStreak = 0;
  bubble(rline(LINES.bad), car.x, car.z, 2.2);
  if (car.special === 'vintage') { G.score = Math.max(0, G.score - 10); popScore('VINTAGE DAMAGE −$10', s.x, s.y - 28, '#ff6b5e'); }
}

/* ---------- you are the valet: on foot, in a car, and guest calls (Rush Hour) ---------- */
function addMark(car, emoji, color) {
  clearMark(car);
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tokenTexture(emoji, color), transparent: true, toneMapped: false, depthWrite: false,
  }));
  m.scale.set(0.9, 0.9, 1);
  m.position.set(0, 2.15, 0);
  m.raycast = () => {};
  car.root.add(m);
  car.mark = m;
}

export function clearMark(car) {
  const m = car && car.mark;
  if (!m) return;
  if (m.parent) m.parent.remove(m);
  m.material.map.dispose();
  m.material.dispose();
  car.mark = null;
}

// The two spots beside a car (left / right of its heading), `dist` from its centre line.
function carSides(car, dist, fwd = 0) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
  return [
    { x: car.x + rx * dist + fx * fwd, z: car.z + rz * dist + fz * fwd },
    { x: car.x - rx * dist + fx * fwd, z: car.z - rz * dist + fz * fwd },
  ];
}

// Hand-off: the guest boards from the side nearest to them, the valet steps out on the opposite side (never inside the car's body).
export function handoffSpots(car, guestFig) {
  const sides = carSides(car, 1.05, 0.1);
  let gi = 0;
  if (guestFig) {
    const gp = guestFig.root.position;
    gi = Math.hypot(sides[0].x - gp.x, sides[0].z - gp.z) <= Math.hypot(sides[1].x - gp.x, sides[1].z - gp.z) ? 0 : 1;
  }
  const valet = carSides(car, 1.9, -0.2)[1 - gi];
  return { guest: sides[gi], valet };
}

// A guest walks up to the car door and gets in (a quick hop-in, not a vanish at a distance).
export function boardCar(fig, spot) {
  if (!fig) return;
  fig.noCollide = true;
  walkTo(fig, [[spot.x, spot.z]], 3.8, (f) => poof(f));
}

// Puts the valet on the ground at (x, z). Used whenever you climb out of a car.
export function playerExit(x, z) {
  const pl = rush.pl;
  if (!pl) return;
  pl.mode = 'foot';
  pl.x = x; pl.z = z; pl.yaw = 0;
  if (pl.fig) removeFigure(pl.fig);
  pl.fig = spawnFigure('valet', x, z, 0);
  return pl.fig;
}

const carCircleDist = (car, x, z) => {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  return Math.min(
    ...CAR_BODY_OFFSETS.map((off) => Math.hypot(x - (car.x + fx * off), z - (car.z + fz * off))),
  );
};

// WASD / arrows move the valet around the lot (screen directions). Cars, planters and bollards are solid.
function updateFoot(dt) {
  const pl = rush.pl;
  if (!pl || pl.mode !== 'foot') { rush.near = null; rush.enterT = 0; guide.visible = false; return; }
  const kx = THREE.MathUtils.clamp((keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0) + touchInput.walkX, -1, 1);
  const kz = THREE.MathUtils.clamp((keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) + touchInput.walkY, -1, 1);
  const len = Math.hypot(kx, kz);
  const sp = (rush.nitro > 0 ? 7 : 4.8) * (rush.coffee > 0 ? 1.35 : 1) * (1 + 0.12 * rush.perks.legs);
  if (len > 0) {
    pl.x += kx / len * sp * dt;
    pl.z += kz / len * sp * dt;
    pl.yaw = Math.atan2(kx, kz);
  }
  const r = 0.3;
  pl.x = THREE.MathUtils.clamp(pl.x, BOUNDS.minX + r, BOUNDS.maxX - r);
  pl.z = THREE.MathUtils.clamp(pl.z, BOUNDS.minZ + r, BOUNDS.maxZ - r);
  for (const c of G.colliders) {
    if (c.disabled) continue;
    const hit = circleVsCollider(pl.x, pl.z, r, c, `player:${c.kind || 'prop'}`);
    if (hit) { pl.x += hit.nx * hit.depth; pl.z += hit.nz * hit.depth; }
  }
  for (const s of slots) {
    if (!s.closed) continue;
    const hit = circleVsParkingBox(pl.x, pl.z, r, s, PARKED_HALF.x, PARKED_HALF.z);
    if (hit) { pl.x += hit.nx * hit.depth; pl.z += hit.nz * hit.depth; }
  }
  for (const car of cars) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    for (const off of CAR_BODY_OFFSETS) {
      const dx = pl.x - (car.x + fx * off), dz = pl.z - (car.z + fz * off), d = Math.hypot(dx, dz), min = r + CAR_BODY_RADIUS;
      if (d < min) {
        const [nx, nz] = separationNormal(dx, dz, `player:${car.id}`);
        pl.x += nx * (min - d); pl.z += nz * (min - d);
      }
    }
  }
  // other people are solid too: the rival, guests, the dog and the doorman
  pushFromPeople(pl, r, pl.fig);
  pl.x = THREE.MathUtils.clamp(pl.x, BOUNDS.minX + r, BOUNDS.maxX - r);
  pl.z = THREE.MathUtils.clamp(pl.z, BOUNDS.minZ + r, BOUNDS.maxZ - r);
  if (pl.fig) {
    pl.fig.root.position.set(pl.x, 0.02, pl.z);
    pl.fig.yaw = pl.yaw;
    pl.fig.anim = len > 0 ? 'run' : (pl.celebT > 0 ? 'wave' : 'idle');
    if (pl.celebT > 0) pl.celebT -= dt;
  }

  // Which car can you get into right now?
  let near = null, best = 2.0;
  const cand = [];
  if (rush.waiting && rush.waiting.waiting) cand.push(rush.waiting);
  for (const call of rush.calls) if (call.state === 'waiting') cand.push(call.car);
  for (const c of cand) {
    const d = carCircleDist(c, pl.x, pl.z);
    if (d < best) { best = d; near = c; }
  }
  rush.near = near;

  // Run up to the car and you hop in (E / Space still work).
  if (near && best < 1.5) {
    rush.enterT += dt;
    if (rush.enterT > 0.2) { rush.enterT = 0; guide.visible = false; enterCar(near); return; }
  } else rush.enterT = 0;

  // Guide arrow: points from the valet to the car that needs attention.
  let tgt = rush.waiting && rush.waiting.waiting ? rush.waiting : null;
  if (!tgt) {
    const w = rush.calls.filter((k) => k.state === 'waiting').sort((a, b) => a.left - b.left)[0];
    if (w) tgt = w.car;
  }
  if (tgt) {
    const gx = tgt.x - pl.x, gz = tgt.z - pl.z, gd = Math.hypot(gx, gz);
    if (gd > 3) {
      guide.visible = true;
      guide.position.set(pl.x + gx / gd * 1.7, 0, pl.z + gz / gd * 1.7);
      guide.rotation.y = Math.atan2(gx, gz);
      guide.children[0].material.color.set(tgt === rush.waiting ? 0xffc247 : 0xff8a3d);
    } else guide.visible = false;
  } else guide.visible = false;

  if (rush.token && Math.hypot(pl.x - rush.token.x, pl.z - rush.token.z) < 1.3) collectToken();
}

// E / Space / the Park button while on foot.
export function rushInteract() {
  const pl = rush.pl;
  if (!pl || pl.mode !== 'foot') return;
  const car = rush.near;
  if (!car) { toast('Run next to the 🔑 or 🔔 car, then press E.'); return; }
  enterCar(car);
}

function enterCar(car) {
  const pl = rush.pl;
  if (pl.fig) { poof(pl.fig); pl.fig = null; }
  pl.mode = 'drive';
  rush.near = null;
  clearMark(car);
  car.speed = 0; car.vx = 0; car.vz = 0;
  if (car === rush.waiting) {
    // A freshly dropped-off car: take it to its bay.
    rush.waiting = null;
    car.waiting = false;
    rush.spawnIn = 3 + rush.lv.gap * 4;
    car.vipActive = car.vip;
    G.vipLeft = car.vip ? VIP_WINDOW : 0;
    G.activeCar = car;
    if (tutorial.on) tutorial.step = 'park';
    toast(`Park it in bay ${String(car.slot.id).padStart(2, '0')}!`);
  } else {
    // A guest's parked car: back it out yourself and drive it to the pick-up ring.
    const call = car.call;
    const slot = car.slot;
    call.slot = slot;
    if (slot) slot.car = null;
    car.slot = null;
    car.parked = false;
    car.snap = null;
    car.vipActive = false;
    car.tag.visible = false;
    car.delivering = true;
    car.honk = 2;
    call.state = 'driving';
    G.activeCar = car;
    if (tutorial.on) tutorial.step = 'deliver';
    toast('Back it out and drive to the green PICK-UP ring →');
  }
  audio.play('good');
  updateRushHUD();
}

// The guest's car pulls up to the drop-off on its own; the guest steps out and heads into the lobby.
function stepArrive(c, dt) {
  let nextX, nextZ, nextYaw = c.yaw, arrived;
  if (c.arrivalRoute && c.arrivalRoute.length) {
    let i = c.arrivalRouteIndex || 0;
    let target = c.arrivalRoute[i];
    let dx = target.x - c.x, dz = target.z - c.z;
    let distance = Math.hypot(dx, dz);
    if (distance < 0.28 && i < c.arrivalRoute.length - 1) {
      target = c.arrivalRoute[++i];
      c.arrivalRouteIndex = i;
      dx = target.x - c.x;
      dz = target.z - c.z;
      distance = Math.hypot(dx, dz);
    }
    const want = target.yaw !== undefined ? target.yaw : distance > 0.05 ? Math.atan2(dx, dz) : c.yaw;
    const diff = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
    nextYaw += Math.max(-3 * dt, Math.min(3 * dt, diff));
    const step = Math.min(distance, Math.min(5, 0.8 + distance * 1.6) * dt);
    nextX = distance <= step ? target.x : c.x + dx / distance * step;
    nextZ = distance <= step ? target.z : c.z + dz / distance * step;
    arrived = i === c.arrivalRoute.length - 1 && distance <= step;
  } else {
    const remain = DROPOFF.x - c.x;
    const step = Math.min(5, 0.8 + remain * 1.6) * dt;
    nextX = Math.min(DROPOFF.x, c.x + step);
    nextZ = c.z;
    arrived = nextX >= DROPOFF.x - 0.02;
  }
  const peopleWithRightOfWay = otherPeople(null).filter((p) => p.fig?.role === 'valet' || p.fig?.role === 'rival');
  if (carPathBlocked(c, nextX, nextZ, nextYaw, cars, 0.08)
    || carPathHitsCircle(c, nextX, nextZ, nextYaw, [...G.colliders, ...peopleWithRightOfWay], 0.02)) {
    c.speed = c.vx = c.vz = 0;                 // arrivals wait for active valet traffic to clear (but not forever)
    c.blockT = (c.blockT || 0) + dt;
    if (c.blockT < 2.5) return;
  } else c.blockT = 0;
  const oldX = c.x, oldZ = c.z;
  c.x = nextX; c.z = nextZ; c.yaw = nextYaw;
  c.vx = dt > 0 ? (nextX - oldX) / dt : 0;
  c.vz = dt > 0 ? (nextZ - oldZ) / dt : 0;
  c.speed = Math.hypot(c.vx, c.vz);
  c.root.position.set(c.x, 0.045, c.z);
  c.root.rotation.y = c.yaw;
  if (!arrived) return;
  c.arriving = false;
  c.arrivalRoute = null;
  c.arrivalRouteIndex = 0;
  c.speed = c.vx = c.vz = 0;
  rush.inbound = null;
  rush.waiting = c;
  c.waiting = true;
  c.waitLeft = keyWait();
  addMark(c, 'key', 0xffc247);
  const g = spawnFigure('guest', DROPOFF.x + 0.3, DROPOFF.z - 1.3, 0);
  walkTo(g, dropPath(), 3.6, enterBuilding);
  if (c.special) bubble(SPECIALS[c.special].line, DROPOFF.x + 0.3, DROPOFF.z - 1.3);
  audio.play('good');
  toast(`Guest dropped off${c.vip ? ' ⭐ VIP' : ''}${c.special ? ' ' + SPECIALS[c.special].icon + ' ' + SPECIALS[c.special].name : ''} → bay ${String(c.slot.id).padStart(2, '0')}. Run to the 🔑 car!`);
  updateRushHUD();
}

// Nobody took the keys in time: the guest drives off annoyed.
function keyExpired() {
  const c = rush.waiting;
  if (!c) return;
  rush.waiting = null;
  c.waiting = false;
  clearMark(c);
  c.slot = null;
  c.leaving = true;
  c.exit = true;
  c.exitLane = EXIT_LANE_FRONT;
  rush.stats.keysLost++;
  G.score = Math.max(0, G.score - 15);
  loseCombo();
  rush.spawnIn = 3.0;
  audio.play('bad');
  if (!reduceMotion) { G.shake = 0.4; G.wrongFlash = 0.4; }
  popScore('CAR LEFT  −$15', innerWidth / 2, Math.max(150, innerHeight * 0.3), '#ff6b5e');
  toast('😤 Nobody took their keys. The guest drove off. −$15 · combo lost');
}

function arrivalTick(dt) {
  if (rush.waiting || rush.inbound) return;
  if (rush.arrived >= rush.guestTotal) return;   // everyone has arrived: now it is about emptying the lot
  if (tutorial.on && tutorial.spawned) return;
  rush.spawnIn -= dt;
  if (rush.spawnIn > 0) return;
  const hasFree = openSlots().some((s) => !s.car);
  // Don't spawn while any moving car (leaving, driven by you or the rival, being handed over) is near the drop-off or the entry lane.
  const blocked = anyCar((c) => !(c.parked && c.slot) && (Math.hypot(c.x - DROPOFF.x, c.z - DROPOFF.z) < 4.2 || Math.hypot(c.x + 16.3, c.z - DROPOFF.z) < 3.5));
  if (!hasFree && !rush.fullWarned) { rush.fullWarned = true; toast('Lot full! Hang on for a free bay…'); }
  if (hasFree && !blocked && rushSpawn()) rush.fullWarned = false;
  else rush.spawnIn = 0.2;
}

/* ---------- guest calls (several at once from level 3) ---------- */
function startCall(car) {
  const total = callWait();                                     // seconds the guest will wait
  const idx = rush.calls.length;
  const guest = spawnFigure('guest', DOOR.x, DOOR.z - 0.45, 0);   // steps out of the lobby door
  guest.after = 'wave';
  const path = exitPath().map((p) => p.slice());
  for (const p of path.slice(-2)) p[1] -= idx * 0.9;           // later guests queue along the curb instead of overlapping
  walkTo(guest, path, 3.2);
  addMark(car, 'bell', 0xff8a3d);
  car.called = true;
  car.leaveIn = undefined;
  let dog = null;
  if (car.special === 'dog') {
    dog = spawnFigure('dog', DOOR.x + 0.6, DOOR.z - 0.4, 0);
    walkTo(dog, path.map((p) => [p[0] + 0.7, p[1] + 0.25]), 3.2);
  }
  const call = { car, guest, dog, total, left: total, state: 'waiting', holdT: 0, slot: car.slot };
  car.call = call;
  rush.calls.push(call);
  audio.play('vip');
  toast(`🔔 A guest wants to leave! Their car is in bay ${String(car.slot.id).padStart(2, '0')}`);
  updateRushHUD();
}

export function endCall(call) {
  if (!call) return;
  clearMark(call.car);
  call.car.call = null;
  const i = rush.calls.indexOf(call);
  if (i >= 0) rush.calls.splice(i, 1);
}

function updateCalls(dt) {
  for (const call of [...rush.calls]) {
    const car = call.car;
    if (!tutorial.on) call.left -= dt;     // the guest is waiting the whole time: running, driving, everything
    if (call.left <= 0 && call.state !== 'rival') { failCall(call); continue; }   // a call the rival is already delivering is never failed
    if (call.state === 'driving' && G.activeCar === car) {
      const d = Math.hypot(car.x - HANDOFF.x, car.z - HANDOFF.z);
      const aligned = angleDifference(car.yaw, HANDOFF_YAW) <= HANDOFF_ANGLE;
      if (aligned && ((d <= parkRadius() * 0.6 && car.speed <= parkSpeed() * 0.7) || (d <= parkRadius() && car.speed < 0.4))) {
        call.holdT += dt;
        if (call.holdT > 0.3) { deliverCar(); break; }
      } else call.holdT = 0;
    }
  }
}

// Space bar while delivering: hand over instantly if you are inside the ring and slow enough.
export function tryHandoff() {
  const status = handoffStatus();
  if (status === 'none') return;
  if (status === 'distance') { toast('Drive into the green PICK-UP ring first.'); return; }
  if (status === 'speed') { toast('Ease off the throttle before you hand over.'); return; }
  if (status === 'alignment') { toast('Line the car up facing the PICK-UP curb before hand-over.'); return; }
  deliverCar();
}

export function canHandoff() {
  return handoffStatus() === 'ready';
}

function handoffStatus() {
  const car = G.activeCar, call = car && car.call;
  if (!call || call.state !== 'driving') return 'none';
  const d = Math.hypot(car.x - HANDOFF.x, car.z - HANDOFF.z);
  if (d > parkRadius()) return 'distance';
  if (car.speed > parkSpeed()) return 'speed';
  if (angleDifference(car.yaw, HANDOFF_YAW) > HANDOFF_ANGLE) return 'alignment';
  return 'ready';
}

function deliverCar() {
  const car = G.activeCar, call = car && car.call;
  if (!call) return;
  const frac = Math.max(0, call.left / call.total);
  const quick = frac > 0.5;
  const prevMult = rush.mult;
  rush.chain += quick ? 2 : 1;
  rush.meter = 1;
  rush.mult = 1 + Math.min(7, Math.floor(rush.chain / 3));
  rush.maxMult = Math.max(rush.maxMult, rush.mult);
  if (quick) rush.stats.quick++;

  let base = 18 + Math.round(frac * 12) + (car.quirk ? 6 : 0) + (car.vip ? 15 : 0);
  if (car.special === 'celeb') base = Math.round(base * 1.8);
  else if (car.special === 'tourist') base += 12;
  else if (car.special === 'dog') base += 8;
  const tip = rushTip(base);
  G.score += tip;
  rush.delivered++;
  G.sequence++;

  car.speed = 0; car.vx = 0; car.vz = 0;
  car.delivering = false;
  car.handoffT = 1.2;                      // waits for the guest, then clears the curb by the front exit lane
  G.activeCar = null;
  rush.autoT = 0;

  // People: you climb out on one side, the guest walks over and gets in on the other.
  const guest = call.guest;
  const spots = handoffSpots(car, guest);
  boardCar(guest, spots.guest);
  car.exitIgnoreFigure = playerExit(spots.valet.x, spots.valet.z);

  const s = worldToScreen(car.x, car.z, 1.4);
  popScore(`${quick ? 'QUICK ' : ''}HAND-OFF +$${tip}`, s.x, s.y);
  bubble(Math.random() < 0.4 ? `💵 Left $${5 + Math.floor(Math.random() * 6)} under the wiper` : rline(LINES.hand), car.x, car.z, 2.4);
  if (rush.pl) rush.pl.celebT = 1.2;
  if (rush.doorman) { rush.doorman.anim = 'wave'; rush.doorT = 1.3; }   // the doorman tips his hat
  if (!tutorial.on) {
    const took = call.total - call.left;
    if (rush.stats.fastest === null || took < rush.stats.fastest) rush.stats.fastest = took;
  }
  if (call.dog) { call.dog.noCollide = true; walkTo(call.dog, [[spots.guest.x, spots.guest.z + 0.5]], 3.8, (f) => poof(f)); }
  if (rush.mult > prevMult) {
    popScore(`COMBO ×${rush.mult}!`, innerWidth / 2, Math.max(150, innerHeight * 0.3), '#6cc8ff');
    audio.play('chain', rush.mult);
    if (!reduceMotion) G.punch = 1;
  } else audio.play(quick ? 'perfect' : 'good');
  if (quick) confetti(car.x, car.z);
  ringBurst(HANDOFF.x, HANDOFF.z, 0x5ee6a8);
  endCall(call);
  if (tutorial.on) { tutorial.step = 'done'; tutorial.doneT = 2.6; }
  updateRushHUD();
}

function failCall(call) {
  const car = call.car;
  poof(call.guest);
  poof(call.dog);
  const wasDriving = call.state === 'driving' && G.activeCar === car;
  endCall(call);
  rush.stats.guestsLost++;
  G.score = Math.max(0, G.score - 20);
  loseCombo();
  audio.play('bad');
  if (!reduceMotion) { G.shake = 0.5; G.wrongFlash = 0.6; }
  popScore('GUEST LEFT  −$20', innerWidth / 2, Math.max(150, innerHeight * 0.3), '#ff6b5e');
  toast('😤 The guest gave up waiting. −$20 · combo lost');
  if (wasDriving) {
    // You are thrown out; the car heads for the exit on its own. It uses one of the two clear lanes so it never
    // drives through the parked rows.
    G.activeCar = null;
    car.delivering = false;
    car.leaving = true;
    car.exit = true;
    car.exitLane = car.z < -1.4 ? EXIT_LANE_BACK : EXIT_LANE_FRONT;
    car.exitRoute = car.slot && car.slot.exitRoute ? car.slot.exitRoute : undefined;
    car.exitRouteIndex = 0;
    const sp = carSides(car, 1.9)[0];
    car.exitIgnoreFigure = playerExit(sp.x, sp.z);
  } else {
    car.called = false;
    car.leaveIn = rushLeaveDelay() * (0.8 + Math.random() * 0.4);
  }
}

export function updateRush(dt) {
  G.bumpCd -= dt;
  if (!tutorial.on && rush.doneT == null) {
    rush.elapsed += dt;
    if (!rush.sceneLab) G.seconds -= dt;
  }
  if (rush.nitro > 0) rush.nitro -= dt;
  if (rush.boost > 0) rush.boost -= dt;
  if (rush.coffee > 0) rush.coffee -= dt;
  if (rush.wedding > 0) rush.wedding -= dt;
  rush.hornCd -= dt;
  G.nearCd -= dt;
  if (rush.doorT > 0) {
    rush.doorT -= dt;
    if (rush.doorT <= 0 && rush.doorman) rush.doorman.anim = 'idle';
  }
  stepSnap(dt);
  updateTags(dt);
  updateLevelProps(dt);

  if (!rush.sceneLab && G.seconds <= 0) { G.seconds = 0; formatTime(); endRush(); return; }

  // Guided run: after the hand-over, wait a moment and start the real thing.
  if (tutorial.on && tutorial.step === 'done') {
    tutorial.doneT -= dt;
    if (tutorial.doneT <= 0) { finishTutorial(false); return; }
  }

  // Combo meter drains; let it empty and the chain is lost.
  if (rush.chain > 0 && !tutorial.on) {
    rush.meter -= dt * rushDrain();
    if (rush.meter <= 0) {
      loseCombo();
      popScore('COMBO LOST', innerWidth / 2, Math.max(150, innerHeight * 0.3), '#ff6b5e');
    }
  }

  updateCalls(dt);

  // A dropped-off car cannot wait forever: it blocks the next arrival.
  if (rush.waiting && !tutorial.on) {
    rush.waiting.waitLeft -= dt;
    if (rush.waiting.waitLeft <= 0) keyExpired();
  }

  if (G.activeCar) {
    drive(G.activeCar, dt);
    if (G.activeCar.quirk === 'horn') hornTick(G.activeCar, dt);
    nearMiss(G.activeCar);

    if (G.activeCar.vipActive) {
      G.vipLeft -= dt;
      if (G.vipLeft <= 0) { G.activeCar.vipActive = false; toast('⭐ The VIP got impatient. No double tip.'); }
    }

    // Auto-park: ease into the middle of the ring, straight and slow, and it parks itself.
    if (G.activeCar && !G.activeCar.snap && !G.activeCar.delivering) {
      const b = G.activeCar.slot;
      const d = Math.hypot(G.activeCar.x - b.x, G.activeCar.z - b.z);
      const ac = G.activeCar;
      const slowEnough = Math.abs(ac.speed) <= parkSpeed() * 0.7;
      if (d <= parkRadius() * 0.6 && slowEnough && angleToBay(ac) <= PARK_ANGLE) {
        rush.autoT += dt;
        if (rush.autoT > 0.3) { rush.autoT = 0; rush.stillT = 0; parkCar(); }
      } else {
        rush.autoT = 0;
        // Safety net: stopped inside the ring but crooked? After a moment the valet straightens the car, so you are never stuck.
        if (d <= parkRadius() * 0.9 && Math.abs(ac.speed) < 0.5) {
          rush.stillT += dt;
          if (rush.stillT > 0.6) {
            const Yb = parkYaw(b);
            const diff = Math.atan2(Math.sin(Yb - ac.yaw), Math.cos(Yb - ac.yaw));
            ac.yaw += diff * Math.min(1, dt * 4);
            ac.root.rotation.y = ac.yaw;
          }
        } else rush.stillT = 0;
      }
    }

    if (G.activeCar && rush.token && Math.hypot(G.activeCar.x - rush.token.x, G.activeCar.z - rush.token.z) < 1.5) collectToken();
  }

  updateFoot(dt);
  updateRival(dt);
  arrivalTick(dt);

  // Parked cars wait for their guest to come back. When one is ready, the lobby calls for it.
  const closing = !tutorial.on && !rush.sceneLab && rush.arrived >= rush.guestTotal;   // last guest is in: every car gets called back
  // Guests start leaving a little way into the shift, once at least 2 cars are in the lot (whoever parked them: you, the rival or the starting cars).
  let parkedInLot = 0;
  for (const c of cars) if (c.parked && !c.leaving) parkedInLot++;
  let maxCalls = closing ? Math.min(2, rush.lv.calls) : (rush.elapsed >= rush.lv.callsFrom + 15 && parkedInLot >= 2) ? (rush.elapsed < 40 ? 1 : Math.min(2, rush.lv.calls)) : 0;
  // Safety net against a frozen shift: if nothing is going on and no guest can arrive (full lot, or just a long dead spell), a guest comes back for their car regardless of the timers above.
  const idle = !tutorial.on && !rush.waiting && !rush.inbound && !G.activeCar && !rush.calls.length && rush.arrived < rush.guestTotal && !anyCar((c) => c.rivalDrive || c.arriving);
  const lotFull = !openSlots().some((s) => !s.car && !anyCar((c) => c.slot === s));
  rush.stallT = idle ? rush.stallT + dt : 0;
  const stuck = idle && rush.stallT > (lotFull ? 2 : 9);
  if (stuck && !closing) maxCalls = Math.max(maxCalls, 1);
  carBuf.length = 0;
  for (const c of cars) carBuf.push(c);   // a reused snapshot: cars are added and disposed inside the loop
  for (const c of carBuf) {
    if (c.mark) {
      c.mark.position.y = 2.15 + Math.sin(performance.now() * 0.005 + c.x) * 0.1;
      c.mark.scale.setScalar(c === rush.near ? 1.25 : 0.9);
      // The 🔑 blinks when its owner is about to give up.
      c.mark.visible = c !== rush.waiting || c.waitLeft > 6 || Math.floor(performance.now() / 180) % 2 === 0;
    }
    if (stuck && c.parked && !c.called && !c.snap && c.leaveIn === undefined) c.leaveIn = 3;
    if (c.arriving) stepArrive(c, dt);
    else if (c.rivalDrive) stepRivalCar(c, dt);
    else if (c.leaving) {
      if (stepExit(c, dt)) disposeCar(c);
    } else if (c.handoffT > 0) {
      // Delivered: the car stands still while the guest climbs in...
      c.handoffT -= dt;
      if (c.handoffT <= 0) {
        // Clear the curb before taking the front exit lane.
        c.leaving = true; c.exit = true; c.exitLane = EXIT_LANE_FRONT;
        c.exitRoute = rush.lv.id === 4 ? coneAlleyExitRoute()
          : c.slot && c.slot.exitRoute ? c.slot.exitRoute : undefined;
        c.exitRouteIndex = 0;
      }
    } else if (c.parked && c.leaveIn !== undefined && !c.snap && !c.called) {
      if ((closing || stuck) && c.leaveIn > 3) c.leaveIn = 3;
      c.leaveIn -= dt;
      if (c.leaveIn <= 0 && rush.calls.length < maxCalls) startCall(c);   // stays due until there is room at the curb
    }
  }

  // Closing time: when the last guest has arrived and the lot is empty, the shift is complete.
  if (!tutorial.on) {
    if (!closing && !rush.sceneLab) {
      rush.eventIn -= dt;
      if (rush.eventIn <= 0) { fireEvent(); rush.eventIn = 28 + Math.random() * 14; }
    }
    if (closing && !rush.closingNoted) { rush.closingNoted = true; toast('🌙 Last guest! Hand every car back to finish the shift.'); }
    if (closing && rush.doneT == null && cars.size === 0 && !rush.waiting && !rush.inbound && !G.activeCar && !rush.calls.length) {
      rush.doneT = 1.8;
      toast('🎉 Lot empty! Every guest served.');
      audio.play('perfect');
      if (!reduceMotion) G.punch = 1;
      confetti(0, 0);
    }
    if (rush.doneT != null) { rush.doneT -= dt; if (rush.doneT <= 0) { endRush(true); return; } }
  }

  // Power-up lifecycle (none in the guided run).
  if (!tutorial.on && !rush.sceneLab) {
    if (rush.token) {
      const t = rush.token;
      t.life -= dt;
      const bob = Math.sin(performance.now() * 0.006);
      t.sprite.position.y = 1.3 + bob * 0.15;
      t.ring.rotation.z += dt * 1.5;
      t.group.visible = t.life > 3 || Math.floor(t.life * 4) % 2 === 0;   // blink when about to vanish
      if (t.life <= 0) { clearToken(); rush.tokenIn = tokenDelay(20, 10); }
    } else {
      rush.tokenIn -= dt;
      if (rush.tokenIn <= 0) spawnToken();
    }
  }

  markAllSlots(false);
  if (G.activeCar) {
    markTarget(G.activeCar.slot, true);
    const nx = rush.nextSlot;
    if (nx && !nx.car && nx !== G.activeCar.slot) {
      nx.glow.material.opacity = 0.3;
      nx.glow.material.color.set(0x6cc8ff);
      nx.glow.scale.setScalar(parkRadius() / 1.7);
    }
  }

  // Highlight each called car's bay (orange) until it is out of the bay.
  for (const cl of rush.calls) {
    if (cl.state !== 'waiting' || !cl.car.slot) continue;
    const g = cl.car.slot.glow;
    g.material.opacity = 0.8;
    g.material.color.set(0xff8a3d);
    g.scale.setScalar(1.3 * (1 + Math.sin(performance.now() * 0.006) * 0.05));
  }

  formatTime();
  const low = G.seconds < 10 && !tutorial.on;
  ui.time.classList.toggle('low', low);
  if (low && Math.ceil(G.seconds) !== rush.lastTick) { rush.lastTick = Math.ceil(G.seconds); audio.play('tick'); }

  rush.hudT -= dt;
  if (rush.hudT <= 0) { rush.hudT = 0.1; updateRushHUD(); }
}
