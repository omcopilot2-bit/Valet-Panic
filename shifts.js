// Duel mode (the Shifts campaign): you are the valet on foot. Arrivals, parking, guest calls, hand-offs, combo, the closing-time ending, results and HUD.
import * as THREE from 'three';
import { disposeCar, makeRandomCar, placeCar, quirkLine, resetLot, seedCars, updateTags } from './cars.js';
import { parkCar } from './classic.js';
import { BOUNDS, COLOR_NAMES, DOOR, DROP_PATH, DROPOFF, duelGoals, duelStars, EXIT_LANE_BACK, EXIT_LANE_FRONT, GUEST_PATH, HANDOFF, LEVELS, MAX_LIVES, PARKED_HALF, reduceMotion, RUSH_PERKS, SPECIALS, VIP_WINDOW } from './config.js';
import { applyModeHud, audio, bayYaw, bubble, coach, colorHex, confetti, formatTime, markAllSlots, markTarget, modelCache, openSlots, parkRadius, parkSpeed, parkYaw, popScore, setSeeds, toast, ui, worldToScreen } from './core.js';
import { angleToBay, drive, hornTick, stepExit, stepSnap } from './driving.js';
import { ringBurst } from './fx.js';
import { cancelPeek } from './input.js';
import { adviceFor, levelBlock, showCard, showLevelSelect, showTitle } from './menus.js';
import { guide, poof, removeFigure, spawnFigure, walkTo } from './people.js';
import * as platform from './platform.js';
import { addXp, levelBest, logRun, persist, recordLevel, save, submitScore } from './progress.js';
import { applyLevelLayout, clearToken, closePerkPicker, collectToken, fireEvent, nearMiss, offerShiftIntro, spawnToken, tokenDelay, tokenTexture, updateLevelProps } from './shifts-world.js';
import { approachPoint, deliverRoute, footRoute, grabRadius, parkRoute } from './routes.js';
import { cars, G, hooks, keys, newRushStats, resetPerks, rush, slots, touch, tut, tutorial } from './state.js';

const rushDrain = () => (1 / Math.max(6, 11 - (rush.level - 1) * 0.5)) * (1 - 0.2 * rush.perks.combo);   // meter empties in 7s, shrinking to 3.5s

const rushLeaveDelay = () => Math.min(34, 20 + rush.level * 1.5);         // how long a parked car lingers before its guest returns

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

const MODEL_NAMES = { 'sedan.glb': 'sedan', 'suv-luxury.glb': 'luxury SUV', 'sedan-sports.glb': 'sports sedan', 'hatchback-sports.glb': 'sports hatchback', 'taxi.glb': 'taxi' };

const LINES = {
  park: ['Nice parking!', 'Smooth!', 'Wow, a pro!', 'Not a scratch!'],
  bad: ['Easy on the paint!', 'Careful!', 'Yikes!', 'My bumper!'],
  hand: ['Thanks, champ!', 'Lovely service!', 'Keep the change!', 'Five stars!'],
};

const rline = (a) => a[Math.floor(Math.random() * a.length)];

// Midgame ad at a natural break (the results screen), at most every second restart. Silent no-op without the SDK.
let adBreaks = 0;

export function withAd(then) {
  adBreaks++;
  if (adBreaks % 2 !== 0) { then(); return; }
  platform.midgameAd(() => audio.pause(true), () => { audio.pause(false); then(); });
}

function loseCombo() {
  if (rush.chain > 0) rush.stats.comboLost++;
  rush.chain = 0; rush.mult = 1; rush.meter = 0;
}

/* ---------- flow ---------- */
// opts: { level } for a campaign shift, { tutorial } for the guided first run.
export function startRush(opts) {
  if (!modelCache.size) { toast('Loading the car collection…'); return; }
  const o = opts && typeof opts === 'object' && !(opts instanceof Event) ? opts : {};
  const isTut = !!o.tutorial;
  const daily = false;
  const lv = isTut ? LEVELS[0] : (LEVELS.find((l) => l.id === o.level) || LEVELS[0]);
  if (!isTut) G.lastRushOpts = { level: lv.id };
  closePerkPicker();
  G.mode = 'rush';
  setSeeds(daily);
  rush.lv = lv;
  applyLevelLayout(lv);
  applyModeHud();
  resetPerks();
  G.score = 0; G.streak = 0; G.sequence = 0; G.shift = 1; G.lives = MAX_LIVES; G.jarLevel = 0; G.wrongThisShift = 0;
  Object.assign(rush, {
    lv, level: lv.diff, elapsed: 0, chain: 0, meter: 0, mult: 1, maxMult: 1, parked: 0,
    spawnIn: 1.5, nextSlot: null, nitro: 0, boost: 0, tokenIn: 28, hudT: 0, lastTick: -1,
    fullWarned: false, autoT: 0, delivered: 0, calls: [], arrived: 0, guestTotal: isTut ? 1 : lv.guests, doneT: null, closingNoted: false,
    waiting: null, inbound: null, pl: null, near: null, rival: null, stallT: 0,
    daily, picking: false, stats: newRushStats(), endNext: null,
    shower: 0, wedding: 0, vipNext: 0, coffee: 0, perfectStreak: 0, hornCd: 0, doorT: 0, doorman: null,
    eventIn: 26 + G.rngMisc() * 10,
    mini: isTut ? null : (lv.id - 1) % MINI_GOALS.length,
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
  if (!isTut) for (const c of cars) if (c.parked) c.leaveIn = lv.callsFrom + 22 + G.rngMisc() * 10;   // the first guests come back soon, so the lot never jams early
  rush.pl = { mode: 'foot', x: -8.4, z: 7.2, yaw: 0, fig: null };   // you: the valet, on foot
  playerExit(-8.4, 7.2);
  rush.doorman = spawnFigure('doorman', 9.2, -7.6, 0);   // the lobby doorman, who tips his hat after every hand-off
  rush.rival = isTut ? null : newRival(lv);              // the AI valet you are racing: whoever parks and returns more cars wins
  updateRushHUD();
  formatTime();
  audio.musicStart();
  platform.gameplayStart();
  const announce = () => {
    if (isTut) return;
    toast(`SHIFT ${lv.id} · ${lv.name} · ${lv.guests} guests · beat the rival!`);
    if (rush.mini !== null) coach(`🎯 Mini-goal: ${MINI_GOALS[rush.mini].text}`, 6000);
  };
  // Shift 1 and the tutorial start at once; every later shift opens with the boon picker, with the clock frozen.
  if (!isTut && lv.id >= 2) { platform.gameplayStop(); offerShiftIntro(announce); }
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
  rush.shower = 0;
  document.body.dataset.weather = rush.lv.grip < 1 ? 'rain' : '';
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
  rush.readyAt = performance.now() + 700;

  const lost = st.guestsLost + st.keysLost;
  const goals = [['★ Beat the rival', dg[0]], ['★★ Win by ' + dg[1], dg[1]], ['★★★ Win by ' + dg[2], dg[2]]].map(([t, g]) => `<span class="${margin >= g ? 'hit' : ''}">${t}</span>`).join('');
  const toNext = stars < 3 ? `<p class="delta ${stars ? 'up' : 'down'}">${dg[stars] - margin} more car${dg[stars] - margin === 1 ? '' : 's'} of lead for ${'★'.repeat(stars + 1)}</p>` : '<p class="delta up">Perfect shift! Maximum stars.</p>';
  const best = levelBest(lv.id);
  const bestNote = info.newBest && info.prevBest > 0 ? `<p class="delta up">▲ New best for this shift: +$${G.score - info.prevBest}</p>`
    : stars >= 3 && info.prevBest > G.score ? `<p class="delta down">$${info.prevBest - G.score} short of your best</p>` : '';
  const unlock = info && info.unlockedNext
    ? `<div class="unlock">🔓 Shift ${info.unlockedNext.id} unlocked: ${info.unlockedNext.name}</div>` : '';
  const nextLv = next ? LEVELS[lv.id] : null;
  const hl = [];
  if (st.bestStreak >= 2) hl.push(`<span>🎯 Perfect streak: ${st.bestStreak}</span>`);
  if (st.fastest !== null) hl.push(`<span>⚡ Fastest hand-off: ${Math.max(1, Math.round(st.fastest))}s</span>`);
  if (rush.maxMult >= 3) hl.push(`<span>🔥 Best combo ×${rush.maxMult}</span>`);
  if (cleared && !st.crashes) hl.push('<span class="medal">🛡️ Zero crashes</span>');
  if (cleared && !lost) hl.push('<span class="medal">🏅 No guest left behind</span>');
  const highlights = (hl.length ? `<div class="highlights">${hl.join('')}</div>` : '')
    + (mini ? `<div class="unlock">🎯 Mini-goal: ${mini.text} ${miniDone ? '✓ +25 XP' : '✗'}</div>` : '');

  showCard(`
    <div class="hero-eyebrow">SHIFT ${lv.id} · ${lv.name.toUpperCase()}</div>
    <h1 style="font-size:clamp(34px,6vw,48px)">${stars ? 'You <em>win!</em>' : margin === 0 ? 'Dead <em>heat.</em>' : 'Rival <em>wins.</em>'}</h1>
    <div class="stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map((i) => `<span class="${i <= stars ? 'on' : ''}" style="--i:${i}">★</span>`).join('')}</div>
    <div class="goals">${goals}</div>
    <p class="delta ${margin > 0 ? 'up' : 'down'}">You ${you} · Rival ${rvN}${margin === 0 ? ' · a tie is not a win' : ''}</p>
    ${cleared ? `<p class="delta up">Every guest served · clean-lot bonus +$${clearBonus}</p>` : '<p class="delta down">Time ran out with cars still in the lot</p>'}
    ${toNext}
    ${bestNote}
    <div class="features">
      <div class="feature"><b>$${G.score}</b>TIPS</div>
      <div class="feature"><b>$${best}</b>SHIFT BEST</div>
      <div class="feature"><b>+${prog.gained}</b>XP</div>
    </div>
    <div class="breakdown">
      <div><b>${rush.parked}</b>PARKED</div>
      <div><b>${rush.delivered}</b>RETURNED</div>
      <div class="${st.crashes ? 'bad' : ''}"><b>${st.crashes}</b>CRASHES</div>
      <div class="${lost ? 'bad' : ''}"><b>${lost}</b>GUESTS LOST</div>
    </div>
    ${highlights}
    ${unlock}
    ${next
      ? `<button class="play rush" id="next" style="margin-top:18px;height:64px">Next: ${nextLv.name} →</button>
         <button class="play ghost" id="again" style="margin-top:10px">Replay for more stars</button>`
      : `<button class="play rush" id="again" style="margin-top:18px;height:64px">${stars ? 'Play again' : 'Try again'}</button>`}
    <button class="play ghost" id="menu" style="margin-top:10px">All shifts</button>
    <button class="play ghost" id="mainMenu" style="margin-top:10px">Main menu</button>
    <div class="retry-hint">PRESS SPACE OR ENTER TO ${next ? 'CONTINUE' : 'RETRY'}</div>
    <div class="advice">💡 ${adviceFor(st)}</div>
    ${levelBlock(prog)}`,
  { ...(next ? { next: () => withAd(() => startRush(next)) } : {}), again: () => withAd(() => startRush(G.lastRushOpts)),
    menu: showLevelSelect, mainMenu: showTitle });
}

// A guest's car arrives on its own and stops at the drop-off. Nobody drives it but you.
function rushSpawn() {
  const free = openSlots().filter((s) => !s.car && ![...cars].some((c) => c.slot === s));   // a bay a car is still driving to counts as taken
  if (!free.length) return false;
  const slot = rush.nextSlot && !rush.nextSlot.car ? rush.nextSlot : free[Math.floor(G.rngCars() * free.length)];
  const car = makeRandomCar();
  car.slot = slot;
  car.tag.visible = false;             // no ID tags in this mode
  car.arriving = true;
  rush.inbound = car;
  rush.arrived++;
  placeCar(car, -16.3, DROPOFF.z, Math.PI / 2);
  const rest = free.filter((s) => s !== slot);
  rush.nextSlot = rest.length && rush.arrived < rush.guestTotal ? rest[Math.floor(G.rngCars() * rest.length)] : null;
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
  car.leaveIn = rushLeaveDelay() * (0.8 + G.rngMisc() * 0.4);
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

// Puts the valet on the ground at (x, z). Used whenever you climb out of a car.
export function playerExit(x, z) {
  const pl = rush.pl;
  if (!pl) return;
  pl.mode = 'foot';
  pl.x = x; pl.z = z; pl.yaw = 0;
  if (pl.fig) removeFigure(pl.fig);
  pl.fig = spawnFigure('valet', x, z, 0);
}

const carCircleDist = (car, x, z) => {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  return Math.min(
    Math.hypot(x - (car.x + fx * 0.75), z - (car.z + fz * 0.75)),
    Math.hypot(x - (car.x - fx * 0.75), z - (car.z - fz * 0.75)),
  );
};

// WASD / arrows move the valet around the lot (screen directions). Cars, planters and bollards are solid.
function updateFoot(dt) {
  const pl = rush.pl;
  if (!pl || pl.mode !== 'foot') { rush.near = null; rush.enterT = 0; guide.visible = false; return; }
  const kx = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0) + touch.jx;
  const kz = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) + touch.jz;
  const len = Math.hypot(kx, kz);
  const sp = (rush.nitro > 0 ? 7 : 4.8) * (rush.coffee > 0 ? 1.35 : 1) * (1 + 0.12 * rush.perks.legs);
  if (len > 0) {
    const mag = Math.min(1, len);   // the joystick is analog: a gentle push walks slower
    pl.x += kx / len * sp * mag * dt;
    pl.z += kz / len * sp * mag * dt;
    pl.yaw = Math.atan2(kx, kz);
  }
  const r = 0.3;
  pl.x = THREE.MathUtils.clamp(pl.x, BOUNDS.minX + r, BOUNDS.maxX - r);
  pl.z = THREE.MathUtils.clamp(pl.z, BOUNDS.minZ + r, BOUNDS.maxZ - r);
  for (const c of G.colliders) {
    const dx = pl.x - c.x, dz = pl.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
    if (d < min) { pl.x += dx / (d || 1) * (min - d); pl.z += dz / (d || 1) * (min - d); }
  }
  for (const s of slots) {
    if (!s.closed) continue;
    const cx = THREE.MathUtils.clamp(pl.x, s.x - PARKED_HALF.x, s.x + PARKED_HALF.x);
    const cz = THREE.MathUtils.clamp(pl.z, s.z - PARKED_HALF.z, s.z + PARKED_HALF.z);
    const dx = pl.x - cx, dz = pl.z - cz, d = Math.hypot(dx, dz);
    if (d < 1e-4) pl.z = s.z + PARKED_HALF.z + r;
    else if (d < r) { pl.x += dx / d * (r - d); pl.z += dz / d * (r - d); }
  }
  for (const car of cars) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    for (const off of [0.75, -0.75]) {
      const dx = pl.x - (car.x + fx * off), dz = pl.z - (car.z + fz * off), d = Math.hypot(dx, dz), min = r + 0.85;
      if (d < min) { pl.x += dx / (d || 1) * (min - d); pl.z += dz / (d || 1) * (min - d); }
    }
  }
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
    rush.enterT = (rush.enterT || 0) + dt;
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
  const remain = DROPOFF.x - c.x;
  const sp = Math.min(5, 0.8 + remain * 1.6);
  c.x = Math.min(DROPOFF.x, c.x + sp * dt);
  c.root.position.set(c.x, 0.045, c.z);
  if (c.x < DROPOFF.x - 0.02) return;
  c.arriving = false;
  c.speed = 0;
  rush.inbound = null;
  rush.waiting = c;
  c.waiting = true;
  c.waitLeft = keyWait();
  addMark(c, 'key', 0xffc247);
  const g = spawnFigure('guest', DROPOFF.x + 0.3, DROPOFF.z - 1.3, 0);
  walkTo(g, DROP_PATH, 3.3, (f) => poof(f));
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
  c.exitLane = c.z;
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
  const blocked = [...cars].some((c) => c.leaving && Math.hypot(c.x - DROPOFF.x, c.z - DROPOFF.z) < 3.5);
  if (!hasFree && !rush.fullWarned) { rush.fullWarned = true; toast('Lot full! Hang on for a free bay…'); }
  if (hasFree && !blocked && rushSpawn()) rush.fullWarned = false;
  else rush.spawnIn = 0.2;
}

/* ---------- guest calls (several at once from level 3) ---------- */
function startCall(car) {
  const total = callWait();                                     // seconds the guest will wait
  const idx = rush.calls.length;
  const guest = spawnFigure('guest', DOOR.x, DOOR.z, 0);
  guest.after = 'wave';
  const path = GUEST_PATH.map((p) => p.slice());
  for (const p of path.slice(-2)) p[1] -= idx * 0.9;           // later guests queue along the curb instead of overlapping
  walkTo(guest, path, 3.2);
  addMark(car, 'bell', 0xff8a3d);
  car.called = true;
  car.leaveIn = undefined;
  let dog = null;
  if (car.special === 'dog') {
    dog = spawnFigure('dog', DOOR.x + 0.6, DOOR.z + 0.2, 0);
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
      if ((d <= parkRadius() * 0.6 && car.speed <= parkSpeed() * 0.7) || (d <= parkRadius() && car.speed < 0.4)) {
        call.holdT += dt;
        if (call.holdT > 0.3) { deliverCar(); break; }
      } else call.holdT = 0;
    }
  }
}

// Space bar while delivering: hand over instantly if you are inside the ring and slow enough.
export function tryHandoff() {
  const car = G.activeCar, call = car && car.call;
  if (!call || call.state !== 'driving') return;
  const d = Math.hypot(car.x - HANDOFF.x, car.z - HANDOFF.z);
  if (d > parkRadius()) { toast('Drive into the green PICK-UP ring first.'); return; }
  if (car.speed > parkSpeed()) { toast('Ease off the throttle before you hand over.'); return; }
  deliverCar();
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
  car.handoffT = 1.0;                      // stands still while the guest gets in, then drives off
  G.activeCar = null;
  rush.autoT = 0;

  // People: you climb out, the guest walks over and gets in.
  const guest = call.guest;
  if (guest) walkTo(guest, [[car.x + 0.9, car.z + 0.9]], 3.8, (f) => removeFigure(f));
  playerExit(car.x - 0.3, car.z + 1.4);

  const s = worldToScreen(car.x, car.z, 1.4);
  popScore(`${quick ? 'QUICK ' : ''}HAND-OFF +$${tip}`, s.x, s.y);
  bubble(Math.random() < 0.4 ? `💵 Left $${5 + Math.floor(Math.random() * 6)} under the wiper` : rline(LINES.hand), car.x, car.z, 2.4);
  if (rush.pl) rush.pl.celebT = 1.2;
  if (rush.doorman) { rush.doorman.anim = 'wave'; rush.doorT = 1.3; }   // the doorman tips his hat
  if (!tutorial.on) {
    const took = call.total - call.left;
    if (rush.stats.fastest === null || took < rush.stats.fastest) rush.stats.fastest = took;
  }
  if (call.dog) walkTo(call.dog, [[car.x + 0.9, car.z + 1.6]], 3.8, (f) => removeFigure(f));
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
    car.exitLane = car.z < -1.4 ? EXIT_LANE_BACK : car.z < 3.6 ? EXIT_LANE_FRONT : car.z;
    playerExit(car.x, car.z + 1.4);
  } else {
    car.called = false;
    car.leaveIn = rushLeaveDelay() * (0.8 + G.rngMisc() * 0.4);
  }
}

/* ---------- the rival valet: an AI opponent racing you for the same cars ---------- */
// He takes keys at the drop-off and hands cars over at the pick-up, exactly like you. Whoever reaches a car first gets it.
// Every park and every return counts one point; when the shift ends, more points than the rival means you win.
const RIVAL_HOME = { x: -6.2, z: 7.5 };
const RIVAL_LINES = ['Too slow!', 'Mine!', 'Thanks, rookie!', 'Beep beep!', 'Keys, please!'];

function newRival(lv) {
  const d = lv.diff;
  return {
    fig: spawnFigure('rival', RIVAL_HOME.x, RIVAL_HOME.z, 0),
    x: RIVAL_HOME.x, z: RIVAL_HOME.z, state: 'idle',   // idle | walk | drive
    think: 0.6, stun: 0, target: null, path: [], recheck: 0.4,
    walk: 3.4 + d * 0.17,                              // run speed (you run at 4.8)
    drive: 3.0 + d * 0.15,                             // driving speed (you top out at 4.4)
    react: Math.max(0.35, 1.6 - d * 0.12),             // seconds he takes to notice a new job
    parked: 0, delivered: 0,
  };
}

export const rivalScore = () => (rush.rival ? rush.rival.parked + rush.rival.delivered : 0);

const rivalAvail = (t) => (t.kind === 'park' ? rush.waiting === t.car && t.car.waiting : rush.calls.includes(t.call) && t.call.state === 'waiting');

// Picks the job he can win: the shortest trip, with a bonus for waiting guests (they cost points when they leave)
// and for jobs about to expire, and a penalty for cars you are clearly closer to (unless nothing else is left).
function rivalPickJob(rv) {
  const jobs = [];
  if (rush.waiting && rush.waiting.waiting) jobs.push({ kind: 'park', car: rush.waiting, urgent: rush.waiting.waitLeft < 8 });
  for (const call of rush.calls) if (call.state === 'waiting') jobs.push({ kind: 'deliver', car: call.car, call, urgent: call.left < call.total * 0.4 });
  const pl = rush.pl && rush.pl.mode === 'foot' ? rush.pl : null;   // if you are driving, you are busy
  let best = null, bs = Infinity;
  for (const t of jobs) {
    const a = approachPoint(t.kind, t.car);
    const mine = Math.hypot(a.x - rv.x, a.z - rv.z) / rv.walk;
    let s = mine - (t.kind === 'deliver' ? 0.8 : 0) - (t.urgent ? 1.2 : 0);
    if (pl) {
      const yours = Math.hypot(a.x - pl.x, a.z - pl.z) / 4.8;
      if (yours < mine * 0.7) s += 4;                // you would get there first: go for something else
    }
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

function updateRival(dt) {
  const rv = rush.rival;
  if (!rv || tutorial.on || rv.state === 'drive') return;
  if (rv.stun > 0) { rv.stun -= dt; rv.fig.anim = 'idle'; return; }
  if (rv.state === 'idle') {
    rv.fig.anim = 'idle';
    rv.think -= dt;
    if (rv.think > 0) return;
    const best = rivalPickJob(rv);
    if (!best) { rv.think = 0.2; return; }
    rv.target = best;
    rv.path = footRoute(rv, approachPoint(best.kind, best.car));
    rv.state = 'walk';
    rv.recheck = 0.4;
  }
  const t = rv.target;
  if (!t || !rivalAvail(t)) {                       // you got there first (or the guest left): look for something else
    rv.target = null; rv.state = 'idle'; rv.think = rv.react * 0.3; rv.fig.anim = 'idle';
    return;
  }
  // Every so often he re-evaluates: if you are about to beat him to this car, he switches to a better one.
  rv.recheck -= dt;
  if (rv.recheck <= 0) {
    rv.recheck = 0.4;
    const better = rivalPickJob(rv);
    if (better && better !== t && better.car !== t.car) {
      rv.target = better;
      rv.path = footRoute(rv, approachPoint(better.kind, better.car));
      return;
    }
  }
  const p = rv.path[0];
  if (p) {
    const dx = p[0] - rv.x, dz = p[1] - rv.z, d = Math.hypot(dx, dz), step = rv.walk * dt;
    if (d <= step) { rv.x = p[0]; rv.z = p[1]; rv.path.shift(); }
    else { rv.x += dx / d * step; rv.z += dz / d * step; rv.fig.yaw = Math.atan2(dx, dz); }
  }
  rv.fig.root.position.set(rv.x, 0.02, rv.z);
  rv.fig.anim = 'run';
  if (Math.hypot(rv.x - t.car.x, rv.z - t.car.z) <= grabRadius(t.kind)) { rivalTake(t); return; }
  if (!rv.path.length) { rv.target = null; rv.state = 'idle'; rv.think = 0.3; rv.fig.anim = 'idle'; }
}

// He reached the car first: he hops in and drives it along a fixed route.
function rivalTake(t) {
  const rv = rush.rival, car = t.car, s = car.slot;
  if (rv.fig) { poof(rv.fig); rv.fig = null; }
  rv.state = 'drive';
  rv.target = null;
  clearMark(car);
  if (t.kind === 'park') {
    rush.waiting = null;
    car.waiting = false;
    rush.spawnIn = 3 + rush.lv.gap * 4;
    car.vipActive = false;
    car.rivalDrive = { kind: 'park', path: parkRoute(s, parkYaw()), i: 0, speed: rv.drive };
  } else {
    t.call.state = 'rival';
    t.call.slot = s;
    car.rivalDrive = { kind: 'deliver', call: t.call, path: deliverRoute(s, car.yaw), i: 0, speed: rv.drive };
    if (s) s.car = null;
    car.slot = null;
    car.parked = false;
    car.snap = null;
  }
  bubble(rline(RIVAL_LINES), car.x, car.z, 2.4);
  audio.play('honk', 0, 'beep');
}

function stepRivalCar(c, dt) {
  const rd = c.rivalDrive, n = rd.path[rd.i];
  const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot(dx, dz), step = rd.speed * dt;
  const want = n.yaw !== undefined ? n.yaw : d > 0.05 ? Math.atan2(dx, dz) : c.yaw;
  const diff = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
  c.yaw += THREE.MathUtils.clamp(diff, -4.5 * dt, 4.5 * dt);
  if (d <= step) { c.x = n.x; c.z = n.z; rd.i++; }
  else { c.x += dx / d * step; c.z += dz / d * step; }
  c.root.position.set(c.x, 0.045, c.z);
  c.root.rotation.y = c.yaw;
  if (rd.i >= rd.path.length) finishRivalCar(c);
}

function rivalExit(x, z) {
  const rv = rush.rival;
  rv.x = x; rv.z = z;
  rv.fig = spawnFigure('rival', x, z, 0);
  rv.state = 'idle';
  rv.think = rv.react;
}

function finishRivalCar(c) {
  const rv = rush.rival, rd = c.rivalDrive;
  c.rivalDrive = null;
  c.speed = 0; c.vx = 0; c.vz = 0;
  if (rd.kind === 'park') {
    const bay = c.slot;
    c.snap = { x0: c.x, z0: c.z, y0: c.yaw, t: 0 };
    c.parked = true;
    c.tagTimer = 0;
    c.tag.visible = false;
    c.leaveIn = rushLeaveDelay() * (0.8 + G.rngMisc() * 0.4);
    c.bump = 0.25;
    bay.car = c;
    rv.parked++;
    ringBurst(bay.x, bay.z, 0xff8a8a);
    const s = worldToScreen(bay.x, bay.z, 1.2);
    popScore('RIVAL PARKED', s.x, s.y, '#ff8a8a');
    rivalExit(bay.x + 1.4, bay.z < 0 ? -2.05 : 3.55);
  } else {
    const call = rd.call;
    c.handoffT = 1.0;                                // stands still while the guest gets in, then drives off
    if (call.guest) walkTo(call.guest, [[c.x + 0.9, c.z + 0.9]], 3.8, (f) => removeFigure(f));
    if (call.dog) walkTo(call.dog, [[c.x + 0.9, c.z + 1.6]], 3.8, (f) => removeFigure(f));
    if (rush.doorman) { rush.doorman.anim = 'wave'; rush.doorT = 1.3; }
    endCall(call);
    rv.delivered++;
    ringBurst(HANDOFF.x, HANDOFF.z, 0xff8a8a);
    const s = worldToScreen(c.x, c.z, 1.4);
    popScore('RIVAL RETURNED ONE', s.x, s.y, '#ff8a8a');
    rivalExit(c.x - 0.3, c.z + 1.4);
  }
  updateRushHUD();
}

export function updateRush(dt) {
  G.bumpCd -= dt;
  if (!tutorial.on && rush.doneT == null) { rush.elapsed += dt; G.seconds -= dt; }
  if (rush.nitro > 0) rush.nitro -= dt;
  if (rush.boost > 0) rush.boost -= dt;
  if (rush.coffee > 0) rush.coffee -= dt;
  if (rush.wedding > 0) rush.wedding -= dt;
  if (rush.shower > 0) {
    rush.shower -= dt;
    if (rush.shower <= 0) document.body.dataset.weather = rush.lv.grip < 1 ? 'rain' : '';
  }
  rush.hornCd -= dt;
  G.nearCd -= dt;
  if (rush.doorT > 0) {
    rush.doorT -= dt;
    if (rush.doorT <= 0 && rush.doorman) rush.doorman.anim = 'idle';
  }
  stepSnap(dt);
  updateTags(dt);
  updateLevelProps(dt);

  if (G.seconds <= 0) { G.seconds = 0; formatTime(); endRush(); return; }

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
      if (d <= parkRadius() * 0.6 && slowEnough && angleToBay(ac) <= 0.7) {
        rush.autoT += dt;
        if (rush.autoT > 0.3) { rush.autoT = 0; rush.stillT = 0; parkCar(); }
      } else {
        rush.autoT = 0;
        // Safety net: stopped inside the ring but crooked? After a moment the valet straightens the car, so you are never stuck.
        if (d <= parkRadius() * 0.9 && Math.abs(ac.speed) < 0.5) {
          rush.stillT = (rush.stillT || 0) + dt;
          if (rush.stillT > 0.6) {
            const Yb = bayYaw(ac.yaw);
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
  const closing = !tutorial.on && rush.arrived >= rush.guestTotal;   // last guest is in: every car gets called back
  // Guests start leaving a little way into the shift, once at least 2 cars are in the lot (whoever parked them: you, the rival or the starting cars).
  const parkedInLot = [...cars].filter((c) => c.parked && !c.leaving).length;
  let maxCalls = closing ? Math.min(2, rush.lv.calls) : (rush.elapsed >= rush.lv.callsFrom + 15 && parkedInLot >= 2) ? (rush.elapsed < 40 ? 1 : Math.min(2, rush.lv.calls)) : 0;
  // Safety net against a frozen shift: if nothing is going on and no guest can arrive (full lot, or just a long dead spell), a guest comes back for their car regardless of the timers above.
  const idle = !tutorial.on && !rush.waiting && !rush.inbound && !G.activeCar && !rush.calls.length && rush.arrived < rush.guestTotal && ![...cars].some((c) => c.rivalDrive || c.arriving);
  const lotFull = !openSlots().some((s) => !s.car && ![...cars].some((c) => c.slot === s));
  rush.stallT = idle ? rush.stallT + dt : 0;
  const stuck = idle && rush.stallT > (lotFull ? 2 : 9);
  if (stuck && !closing) maxCalls = Math.max(maxCalls, 1);
  for (const c of [...cars]) {
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
      // Delivered: the car turns to face the exit while the guest climbs in, then drives off.
      c.handoffT -= dt;
      const diff = Math.atan2(Math.sin(Math.PI / 2 - c.yaw), Math.cos(Math.PI / 2 - c.yaw));
      c.yaw += THREE.MathUtils.clamp(diff, -1.8 * dt, 1.8 * dt);
      c.root.rotation.y = c.yaw;
      if (c.handoffT <= 0) { c.leaving = true; c.exit = true; c.exitLane = c.z; }
    } else if (c.parked && c.leaveIn !== undefined && !c.snap && !c.called) {
      if ((closing || stuck) && c.leaveIn > 3) c.leaveIn = 3;
      c.leaveIn -= dt;
      if (c.leaveIn <= 0 && rush.calls.length < maxCalls) startCall(c);   // stays due until there is room at the curb
    }
  }

  // Closing time: when the last guest has arrived and the lot is empty, the shift is complete.
  if (!tutorial.on) {
    if (!closing) {
      rush.eventIn -= dt;
      if (rush.eventIn <= 0) { fireEvent(); rush.eventIn = 28 + G.rngMisc() * 14; }
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
  if (!tutorial.on) {
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

const TUTORIAL_TEXT = {
  key: ['TUTORIAL 1/4 · GET THE CAR', 'Run to the 🔑 car', 'WASD / arrows move you. Run up to the car and you hop in (or press E).'],
  park: ['TUTORIAL 2/4 · PARK IT', null, 'W drives, S reverses, A / D steers. Roll slowly into the glowing ring and it parks itself.'],
  call: ['TUTORIAL 3/4 · A GUEST IS LEAVING', 'Run to the 🔔 car', 'Run up to it to get in, then back out of the bay with S.'],
  deliver: ['TUTORIAL 4/4 · HAND IT OVER', 'Green PICK-UP ring →', 'Drive in and stop (or press Space). Quick hand-offs pay more.'],
  done: ['TUTORIAL COMPLETE', 'Nice work!', 'Now the real clock starts. Perks, combos and crowds ahead.'],
};

export function updateRushHUD() {
  ui.score.textContent = '$' + String(G.score).padStart(3, '0');
  ui.streak.textContent = '×' + rush.mult;
  ui.streak.classList.toggle('hot', rush.mult >= 3);
  const you = rush.parked + rush.delivered, rvN = rivalScore();
  ui.lives.textContent = tutorial.on ? '–' : `${you}–${rvN}`;                  // the duel score: you – rival
  ui.lives.style.color = tutorial.on || you === rvN ? '' : you > rvN ? 'var(--mint)' : 'var(--coral)';
  ui.step.textContent = `SHIFT ${rush.lv.id} · ${rush.lv.name}${rush.stats.perks.length ? ' ' + rush.stats.perks.join('') : ''}`;
  ui.bar.style.width = (tutorial.on ? 0 : Math.min(100, rush.elapsed / rush.lv.secs * 100)) + '%';
  ui.brief.dataset.mode = 'arrival';
  ui.jarFill.style.width = (rush.meter * 100) + '%';
  ui.jarLabel.textContent = rush.chain > 0 ? `CHAIN ${rush.chain}` : '';
  ui.jar.style.visibility = rush.chain > 0 && !tutorial.on ? '' : 'hidden';

  ui.title.textContent = '';
  const pl = rush.pl;
  const bayName = (sl) => String(sl ? sl.id : 0).padStart(2, '0');
  if (G.activeCar && G.activeCar.delivering) {
    ui.callLabel.textContent = 'GUEST WAITING · DRIVE TO PICK-UP';
    ui.callMain.textContent = 'Green ring → right side';
  } else if (G.activeCar && G.activeCar.slot) {
    const nx = rush.nextSlot && !rush.nextSlot.car ? ' → ' + String(rush.nextSlot.id).padStart(2, '0') : '';
    ui.callLabel.textContent = G.activeCar.vipActive ? `⭐ VIP · DOUBLE TIPS · ${Math.ceil(G.vipLeft)}s` : 'PARK FAST · KEEP THE COMBO';
    ui.callMain.textContent = `Bay ${bayName(G.activeCar.slot)}${nx}`;
  } else {
    const parts = [];
    if (rush.waiting) parts.push(`🔑 Bay ${bayName(rush.waiting.slot)}${tutorial.on ? '' : ` · ${Math.max(0, Math.ceil(rush.waiting.waitLeft))}s`}`);
    for (const call of rush.calls) if (call.state === 'waiting') parts.push(`🔔 Bay ${bayName(call.slot || call.car.slot)}`);
    ui.callLabel.textContent = parts.length ? 'ON FOOT · RUN TO A CAR' : 'ON FOOT · NEXT GUEST COMING';
    ui.callMain.textContent = parts.length ? parts.join('  ·  ') : 'Hang tight…';
  }
  if (!tutorial.on) {
    const left = Math.max(0, rush.guestTotal - rush.arrived) + [...cars].filter((c) => !c.leaving && !(c.handoffT > 0)).length;
    ui.callLabel.textContent += ` · ${left} CAR${left === 1 ? '' : 'S'} LEFT`;
  }
  let text = `Roll into the glowing ring. It parks itself.${quirkLine(G.activeCar)}`;
  const fx = [];
  if (rush.nitro > 0) fx.push(`⚡ NITRO ${Math.ceil(rush.nitro)}s · hold W`);
  if (rush.boost > 0) fx.push(`💰 ×2 TIPS ${Math.ceil(rush.boost)}s`);
  if (rush.coffee > 0) fx.push(`☕ COFFEE ${Math.ceil(rush.coffee)}s`);
  if (rush.wedding > 0) fx.push(`💒 WEDDING +30% ${Math.ceil(rush.wedding)}s`);
  if (rush.shower > 0) fx.push('🌧️ SHOWER: slippery!');
  if (fx.length) text = fx.join(' · ');
  else if (G.activeCar && G.activeCar.delivering) text = 'Back out and drive into the green PICK-UP ring. Stop inside and it hands over (or press Space).';
  else if (pl && pl.mode === 'foot') text = rush.near ? '👉 Stay next to the car to hop in (or press E).' : 'You are on foot: follow the arrow to the 🔑 / 🔔 car.';
  ui.text.textContent = text;

  if (tutorial.on && TUTORIAL_TEXT[tutorial.step]) {
    const [label, main, body] = TUTORIAL_TEXT[tutorial.step];
    ui.callLabel.textContent = label;
    ui.callMain.textContent = main || `Drive to bay ${bayName(G.activeCar && G.activeCar.slot)}`;
    ui.text.textContent = body;
  }
  ui.brief.dataset.info = tutorial.on || fx.length ? '1' : '';

  // The most urgent guest's banner: colour swatch + countdown, so the car is easy to find.
  const live = rush.calls.filter((k) => k.state !== 'rival');   // calls the rival is delivering are not yours to chase
  const urgent = live.length ? live.reduce((a, b) => (b.left < a.left ? b : a)) : null;
  if (urgent) {
    const c = urgent.car;
    const who = `<span class="swatch" style="background:${colorHex(c)}"></span>The ${COLOR_NAMES[c.colorIndex].toLowerCase()} ${MODEL_NAMES[c.file] || 'car'}${c.special ? ' ' + SPECIALS[c.special].icon : ''}`;
    if (ui.owner.dataset.k !== who) { ui.owner.dataset.k = who; ui.owner.innerHTML = who; }
    const more = live.length > 1 ? ` · +${live.length - 1} more waiting` : '';
    ui.plate.textContent = tutorial.on ? 'RETURN THEIR CAR' : `RETURN THEIR CAR · ${Math.max(0, Math.ceil(urgent.left))}s${more}`;
    ui.pickup.classList.add('show');
  } else {
    ui.pickup.classList.remove('show');
  }
}