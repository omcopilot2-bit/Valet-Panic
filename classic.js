// Classic mode: park each guest in an assigned bay, remember the ID, hand back the right car. Also the Classic HUD and perk screens.
import { disposeCar, makeRandomCar, placeCar, quirkLine, resetLot, seedCars, updateTags } from './cars.js';
import { COLOR_NAMES, EXIT_LANE_BACK, EXIT_LANE_FRONT, JAR_BONUS, JAR_SIZE, MAX_LIVES, PEEK_COST, PERKS, QUIRKS, reduceMotion, SPAWN, TAG_TIME, VIP_WINDOW } from './config.js';
import { applyModeHud, audio, coach, colorHex, comboMul, confetti, formatTime, freeGuesses, markAllSlots, markTarget, modelCache, PARK_ANGLE, parkRadius, parkSpeed, pickupPatience, popScore, quotaFor, shiftTime, shuffle, tipMul, toast, ui, worldToScreen } from './core.js';
import { angleToBay, drive, hornTick, stepExit, stepSnap } from './driving.js';
import { cancelPeek } from './input.js';
import { deltaLine, levelBlock, showCard, showTitle } from './menus.js';
import { arrivalGuest, valetHop } from './people.js';
import * as platform from './platform.js';
import { addXp, persist, save } from './progress.js';
import { applyLevelLayout } from './shifts-world.js';
import { canHandoff, playerExit, rushInteract, rushParked, tryHandoff } from './shifts.js';
import { updateRushHUD } from './hud.js';
import { cars, G, keys, perks, resetPerks, rush, slots, tut, tutorial } from './state.js';

// All tips go through here so the tip jar can track milestones.
function addScore(n) {
  G.score = Math.max(0, G.score + n);
  if (n > 0 && G.score >= (G.jarLevel + 1) * JAR_SIZE) {
    G.jarLevel = Math.floor(G.score / JAR_SIZE);
    G.score += JAR_BONUS;
    ui.jar.classList.remove('pop');
    void ui.jar.offsetWidth; // restart the animation
    ui.jar.classList.add('pop');
    audio.play('jar');
    setTimeout(() => toast(`🪙 Tip jar full! +$${JAR_BONUS}`), 350);
  }
}

export function arrivalText() {
  const vipPart = G.activeCar.vipActive ? `⭐ VIP: park within ${Math.ceil(G.vipLeft)}s for double tips. ` : '';
  return `${vipPart}Park it in the glowing bay and remember the ID.${quirkLine(G.activeCar)}`;
}

function pickupText() {
  const left = Math.max(0, freeGuesses() - G.wrongThisShift);
  const guess = left > 0 ? `${left} free wrong guess left this shift.` : 'A wrong car is a strike.';
  return `Click the car with that ID. ${guess} Hover or press-and-hold to peek at a tag (${perks.peek ? 'free' : '−$' + PEEK_COST}).`;
}

export function spawnArrival() {
  if (!G.running) return;
  const free = slots.filter((s) => !s.car);
  if (!free.length) { callPickup(); return; }

  G.activeCar = makeRandomCar();
  G.activeCar.slot = free[Math.floor(Math.random() * free.length)];
  placeCar(G.activeCar, SPAWN.x, SPAWN.z, SPAWN.yaw);
  arrivalGuest();
  G.phase = 'arrival';
  G.phaseTimer = 0;
  G.vipLeft = G.activeCar.vip ? VIP_WINDOW : 0;
  G.lastVipSec = -1;
  updateHUD();

  const bay = String(G.activeCar.slot.id).padStart(2, '0');
  const extras = (G.activeCar.vip ? ' · ⭐ VIP' : '') + (G.activeCar.quirk ? ` · ${QUIRKS[G.activeCar.quirk].icon} ${QUIRKS[G.activeCar.quirk].name}` : '');
  toast(`Guest ${G.activeCar.id} → bay ${bay}${extras}`);
  if (G.activeCar.vip) audio.play('vip');

  if (!tut.done && !tut.arrive) {
    tut.arrive = true;
    coach('Memorise the ID tags. Each one stays readable for a couple of seconds after parking, and a car\'s colour helps too! W drives, A / D steers, SPACE parks in the glowing ring.', 10000);
  }
}

export function parkCar() {
  if (G.paused || rush.picking) return;
  if (G.mode === 'rush' && G.running && rush.pl && rush.pl.mode === 'foot') { rushInteract(); return; }   // on foot: Space / E gets in a car
  if (!G.activeCar || G.phase !== 'arrival') return;
  if (G.activeCar.delivering) { tryHandoff(); return; }   // Rush Hour: Space hands the guest's car over
  const car = G.activeCar, bay = car.slot;
  const R = parkRadius(), S = parkSpeed();
  const dist = Math.hypot(car.x - bay.x, car.z - bay.z);
  const ang = angleToBay(car);
  const spd = Math.abs(car.speed);
  if (dist > R) { toast('Follow the gold light to your assigned bay.'); return; }
  if (spd > S) { toast('Ease off the throttle before you park.'); return; }
  if (ang > PARK_ANGLE) { toast(G.mode === 'rush' && rush.lv.park === 'reverse' ? 'Back in: the nose must face out of the bay.' : 'Line the nose up with the bay first.'); return; }

  // Parking quality: centred, straight and gentle earns a bigger tip.
  const q = Math.max(0, 1 - (dist / R) * 0.4 - (ang / PARK_ANGLE) * 0.4 - (spd / S) * 0.2);
  const perfect = q > 0.8;
  if (G.mode === 'rush') { rushParked(car, bay, q, perfect); playerExit(bay.x + 1.4, bay.z + 0.3); if (perfect && rush.pl) rush.pl.celebT = 1.2; return; }
  valetHop(car, bay);
  let tip = 15 + Math.round(q * 10) + (car.quirk ? 10 : 0);
  if (perfect) { G.streak++; tip += 8 + Math.min(G.streak, 10) * 2; }  // perfect parks feed the combo
  if (car.vipActive) tip *= 2;
  tip = Math.round(tip * tipMul() * comboMul());

  car.snap = { x0: car.x, z0: car.z, y0: car.yaw, t: 0 };
  car.speed = 0; car.vx = 0; car.vz = 0;
  car.parked = true;
  car.tagTimer = TAG_TIME + perks.memory * 2;   // tag stays readable, then fades
  car.tag.visible = true;
  car.tag.material.opacity = 1;
  car.parkQuality = q;
  bay.car = car;
  G.activeCar = null;
  G.phase = 'parked';
  G.phaseTimer = 0;
  addScore(tip);
  updateHUD();

  const label = perfect ? `Perfect park! combo ×${G.streak}` : q > 0.55 ? 'Nice park!' : 'Parked.';
  toast(`${label} +$${tip}${car.vipActive ? ' (VIP ×2)' : ''}`);
  const s = worldToScreen(bay.x, bay.z, 1.2);
  popScore(`+ $${tip}`, s.x, s.y);
  if (perfect) { confetti(bay.x, bay.z); audio.play('perfect'); }
  else audio.play('good');
}

export function canUseAction() {
  if (!G.running || G.paused || rush.picking) return false;
  if (G.mode === 'rush' && rush.pl && rush.pl.mode === 'foot') return Boolean(rush.near);
  const car = G.activeCar;
  if (!car || G.phase !== 'arrival') return false;
  if (car.delivering) return canHandoff();
  const bay = car.slot;
  return Boolean(bay)
    && Math.hypot(car.x - bay.x, car.z - bay.z) <= parkRadius()
    && Math.abs(car.speed) <= parkSpeed()
    && angleToBay(car) <= PARK_ANGLE;
}

export function callPickup() {
  const occupied = slots.filter((s) => s.car);
  if (!occupied.length) { G.phase = 'arrival'; spawnArrival(); return; }

  for (const c of cars) { c.peeked = false; c.peekTimer = 0; }
  G.pickupCar = occupied[Math.floor(Math.random() * occupied.length)].car;
  G.phase = 'pickup';
  G.phaseTimer = 0;
  G.pickupLeft = pickupPatience()
    * (G.pickupCar.quirk === 'leaky' ? 0.7 : 1)
    * (G.pickupCar.vip ? 0.85 : 1);
  ui.plate.dataset.t = '';
  updateHUD();
  ui.pickup.classList.add('show');
  ui.owner.innerHTML = `Guest ${G.pickupCar.id} · <span class="swatch" style="background:${colorHex(G.pickupCar)}"></span>${COLOR_NAMES[G.pickupCar.colorIndex]}`;
  ui.plate.textContent = `GUEST ${G.pickupCar.id} · PLEASE RETURN THEIR CAR`;
  toast(`The lobby is calling for car ${G.pickupCar.id}.`);

  if (!tut.done && !tut.pickup) {
    tut.pickup = true;
    coach('The lobby wants a car. Click the one with that ID. Not sure? Hover (or press and hold) a car to peek at its tag for −$5. Your first wrong guess each shift is free.', 11000);
  }
}

export function retrieveCar(car) {
  if (G.phase !== 'pickup' || !G.pickupCar || !car.parked) return;
  cancelPeek();

  if (car === G.pickupCar) {
    let bonus = 25 + Math.min(G.streak, 8) * 5 + (car.quirk ? 10 : 0) + (car.vip ? 20 : 0);
    bonus = Math.round(bonus * tipMul());
    G.streak++; G.served++; G.sequence++;
    addScore(bonus);
    if (!tut.done) {
      tut.done = true;
      save.tut.classic = true;
      persist();
      if (G.coachEl) G.coachEl.style.opacity = '0';
    }
    const bay = car.slot;
    car.exitLane = bay.z < 0 ? EXIT_LANE_BACK : EXIT_LANE_FRONT;
    car.exitRoute = bay.exitRoute;
    car.exitRouteIndex = 0;
    bay.car = null;
    car.slot = null;
    car.exit = true;
    car.parked = false;
    car.tagTimer = 0;
    car.peekTimer = 0;
    car.tag.visible = true;
    car.tag.material.opacity = 1;
    G.activeCar = car;
    G.pickupCar = null;
    G.phase = 'exit';
    G.phaseTimer = 0;
    ui.pickup.classList.remove('show');
    markAllSlots(false);
    updateHUD();
    toast(`Perfect hand-off. +$${bonus}`);
    const s = worldToScreen(car.x, car.z, 1.2);
    popScore(`+ $${bonus}`, s.x, s.y);
    audio.play('good');
    return;
  }

  // Wrong car. The first mistake of each shift (more with Spare Key) is a free pass.
  G.wrongThisShift++;
  G.score = Math.max(0, G.score - 10);
  if (G.wrongThisShift <= freeGuesses()) {
    G.streak = 0;
    G.wrongFlash = 0.6;
    audio.play('bad');
    updateHUD();
    toast('Wrong keys! −$10 · free pass used');
    return;
  }
  const timeLoss = G.shift === 1 ? 0 : 2;
  G.seconds = Math.max(0, G.seconds - timeLoss);
  strike();
  if (G.lives > 0) toast(`Wrong keys! −$10${timeLoss ? ` · −${timeLoss} sec` : ''} · strike`);
}

export function failPickup() {
  const id = G.pickupCar ? G.pickupCar.id : '';
  cancelPeek();
  G.pickupCar = null;
  ui.pickup.classList.remove('show');
  markAllSlots(false);
  G.phase = 'parked';
  G.phaseTimer = 0;
  G.seconds = Math.max(0, G.seconds - 2);
  G.score = Math.max(0, G.score - 15);
  strike();
  if (G.lives > 0) toast(`Guest ${id} gave up waiting. −$15 · −2 sec · strike`);
}

function strike() {
  G.lives = Math.max(0, G.lives - 1);
  G.streak = 0;
  G.wrongFlash = 1;
  if (!reduceMotion) G.shake = 0.6;
  audio.play('bad');
  updateHUD();
  if (G.lives <= 0) endShift();
}

export function finishExit() {
  if (G.activeCar) { disposeCar(G.activeCar); G.activeCar = null; }
  G.phase = 'arrival';
  G.phaseTimer = 1;
  updateHUD();
  if (G.served >= G.quota) completeShift();
}

/* ---------- shifts ---------- */
function beginShift() {
  resetLot();
  G.seconds = shiftTime();
  G.running = true;
  G.paused = false;
  G.pickupLeft = 0;
  G.served = 0;
  G.wrongThisShift = 0;
  G.quota = quotaFor(G.shift);
  G.phase = 'arrival';
  G.phaseTimer = 0.3;
  ui.overlay.classList.add('hide');
  document.body.classList.remove('menu');
  const n = Math.min(2 + Math.floor(G.shift / 2), 5);
  seedCars(n, true, 3 + n * 1.5 + perks.memory * 2);
  updateHUD();
  formatTime();
  spawnArrival();
  audio.musicStart();
  platform.gameplayStart();
}

export function start() {
  if (!modelCache.size) { toast('Loading the car collection…'); return; }
  G.mode = 'classic';
  tutorial.on = false;
  rush.picking = false;
  applyLevelLayout(null);
  applyModeHud();
  G.score = 0; G.streak = 0; G.sequence = 0; G.shift = 1; G.lives = MAX_LIVES; G.jarLevel = 0;
  resetPerks();
  beginShift();
}

function nextShift() {
  G.shift++;
  G.lives = Math.min(MAX_LIVES, G.lives + 1);
  beginShift();
}

function saveBest() {
  if (G.score <= G.best) return false;
  G.best = G.score;
  save.best = G.best;
  persist();
  return true;
}

export function endShift() {
  G.running = false;
  G.paused = false;
  cancelPeek();
  if (G.pauseOverlay) G.pauseOverlay.classList.add('hide');
  G.phase = 'over';
  platform.gameplayStop();
  keys.clear();
  audio.engine(null);
  audio.musicStop(1.2);
  ui.pickup.classList.remove('show');
  const prevBest = G.best;
  const record = saveBest();
  const prog = addXp(Math.round(G.score / 8) + G.sequence * 6 + G.shift * 10);
  const fired = G.lives <= 0;
  showCard(`
    <div class="hero-eyebrow">NOCTURNE HOTEL · ${fired ? 'THREE STRIKES' : 'OUT OF TIME'}</div>
    <h1>${fired ? 'You are<br><em>fired.</em>' : 'The night<br><em>got away.</em>'}</h1>
    <p>You served ${G.sequence} guest${G.sequence === 1 ? '' : 's'} across ${G.shift} shift${G.shift === 1 ? '' : 's'}.</p>
    ${deltaLine(G.score, prevBest, record)}
    <div class="hero-rule"></div>
    <div class="features">
      <div class="feature"><b>$${G.score}</b>TOTAL TIPS</div>
      <div class="feature"><b>$${G.best}</b>BEST NIGHT</div>
      <div class="feature"><b>${G.shift}</b>SHIFT REACHED</div>
    </div>
    ${levelBlock(prog)}
    <button class="play" id="again">Try again</button>
    <button class="play ghost" id="menu">Main menu</button>
    <div class="hero-foot">THE CITY WILL STILL BE HERE TOMORROW</div>`,
  { again: start, menu: showTitle });
}

function ownedPerksLine() {
  const owned = PERKS.filter((p) => perks[p.key] > 0).map((p) => `${p.icon} ${p.name}${perks[p.key] > 1 ? ' ×' + perks[p.key] : ''}`);
  return owned.length ? 'YOUR PERKS: ' + owned.join(' · ') : 'PICK A PERK TO BUILD YOUR NIGHT';
}

function completeShift() {
  G.running = false;
  G.phase = 'over';
  platform.gameplayStop();
  cancelPeek();
  keys.clear();
  audio.engine(null);
  audio.musicStop(0.8);
  ui.pickup.classList.remove('show');
  const bonus = Math.ceil(G.seconds) * 2 + G.lives * 10;
  addScore(bonus);
  updateHUD();
  saveBest();

  // Offer three random perks that are not maxed out yet.
  const offer = shuffle(PERKS.filter((p) => perks[p.key] < p.max)).slice(0, 3);
  const handlers = {};
  let choices;
  if (offer.length) {
    choices = `<div class="perks">${offer.map((p, i) => `
      <button class="perk" id="perk${i}"><b>${p.icon} ${p.name}</b><span>${p.desc}</span><em>Lv ${perks[p.key]} → ${perks[p.key] + 1}</em></button>`).join('')}</div>`;
    offer.forEach((p, i) => { handlers['perk' + i] = () => { perks[p.key]++; nextShift(); }; });
  } else {
    choices = `<button class="play" id="next">Start shift ${G.shift + 1}</button>`;
    handlers.next = nextShift;
  }

  showCard(`
    <div class="hero-eyebrow">SHIFT ${G.shift} COMPLETE</div>
    <h1>Smooth<br><em>service.</em></h1>
    <p>Pick a perk for shift ${G.shift + 1}: ${quotaFor(G.shift + 1)} guests, shorter patience, new quirks.</p>
    <div class="hero-rule"></div>
    <div class="features">
      <div class="feature"><b>$${G.score}</b>TOTAL TIPS</div>
      <div class="feature"><b>+$${bonus}</b>SHIFT BONUS</div>
      <div class="feature"><b>${'♥'.repeat(G.lives)}</b>STRIKES LEFT</div>
    </div>
    ${choices}
    <div class="hero-foot">${ownedPerksLine()} · ONE STRIKE IS RESTORED EACH SHIFT</div>`,
  handlers);
}

export function updateHUD() {
  if (G.mode === 'rush') { updateRushHUD(); return; }
  ui.score.textContent = '$' + String(G.score).padStart(3, '0');
  ui.streak.textContent = '×' + G.streak;
  ui.streak.classList.toggle('hot', G.streak >= 3);
  ui.step.textContent = `Shift ${G.shift} · ${G.served}/${G.quota}`;
  ui.bar.style.width = Math.min(100, G.served / Math.max(1, G.quota) * 100) + '%';
  ui.brief.dataset.mode = G.phase === 'pickup' ? 'pickup' : G.phase === 'exit' ? 'exit' : 'arrival';
  ui.lives.textContent = '♥'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, MAX_LIVES - G.lives));

  const jar = Math.max(0, Math.min(JAR_SIZE, G.score - G.jarLevel * JAR_SIZE));
  ui.jar.style.visibility = '';
  ui.jarFill.style.width = jar + '%';
  ui.jarLabel.textContent = `TIP JAR $${jar} / $${JAR_SIZE}`;

  if (G.phase === 'arrival' && G.activeCar) {
    ui.title.textContent = 'A new set of keys.';
    ui.text.textContent = arrivalText();
    ui.callLabel.textContent = G.activeCar.vipActive ? 'VIP GUEST · PARK IN BAY' : 'NEW GUEST · PARK IN BAY';
    ui.callMain.textContent = `Car ${G.activeCar.id}${G.activeCar.vip ? ' ⭐' : ''} → bay ${String(G.activeCar.slot.id).padStart(2, '0')}`;
  } else if (G.phase === 'pickup' && G.pickupCar) {
    ui.title.textContent = 'The lobby is calling.';
    ui.text.textContent = pickupText();
    ui.callLabel.textContent = 'LOBBY CALL · TAP THE CAR';
    ui.callMain.textContent = `Guest wants car ${G.pickupCar.id} · ${COLOR_NAMES[G.pickupCar.colorIndex]}`;
  } else if (G.phase === 'exit') {
    ui.title.textContent = 'Beautifully handled.';
    ui.text.textContent = 'Nice! Your next guest is on the way.';
    ui.callLabel.textContent = 'HAND-OFF';
    ui.callMain.textContent = 'Returning to the lobby';
  } else {
    ui.title.textContent = 'The first impression.';
    ui.text.textContent = 'Park each car, then return the right one when the lobby calls.';
    ui.callLabel.textContent = 'NEXT ARRIVAL';
    ui.callMain.textContent = 'A guest is pulling in';
  }
}

// One frame of Classic mode. (The shift clock is paused during a pickup: the guest's own timer is the only pressure then.)
export function updateClassic(dt) {
  // The shift clock is paused during a pickup: the guest's own timer is the only pressure then.
  if (G.phase !== 'pickup') G.seconds -= dt;
  G.bumpCd -= dt;
  stepSnap(dt);
  updateTags(dt);

  if (G.seconds <= 0) { G.seconds = 0; formatTime(); endShift(); return; }

  G.phaseTimer += dt;

  if (G.phase === 'arrival' && G.activeCar) {
    drive(G.activeCar, dt);
    if (G.activeCar.quirk === 'horn') hornTick(G.activeCar, dt);
    markAllSlots(false);
    markTarget(G.activeCar.slot, true);

    if (G.activeCar.vipActive) {
      G.vipLeft -= dt;
      if (G.vipLeft <= 0) {
        G.activeCar.vipActive = false;
        toast('⭐ The VIP got impatient. No double tip this time.');
        updateHUD();
      } else if (Math.ceil(G.vipLeft) !== G.lastVipSec) {
        G.lastVipSec = Math.ceil(G.vipLeft);
        ui.text.textContent = arrivalText();
      }
    }
  } else if (G.phase === 'parked' && G.phaseTimer > 1.8) {
    const occupied = slots.filter((s) => s.car).length;
    // Never call a pickup while a tag is still readable: the memory window should always be fair.
    const memorising = [...cars].some((c) => c.parked && c.tagTimer > 0);
    if (!memorising && occupied >= 2 && (Math.random() < 0.58 || occupied === slots.length)) callPickup();
    else { G.phase = 'arrival'; spawnArrival(); }
  } else if (G.phase === 'pickup') {
    markAllSlots(false);
    G.pickupLeft -= dt;
    // Mercy hint: in the last 3 seconds the requested car's bay lights up.
    if (G.pickupCar && G.pickupLeft <= 3 && G.pickupCar.slot) markTarget(G.pickupCar.slot, true);
    const left = Math.max(0, Math.ceil(G.pickupLeft));
    if (G.pickupCar && ui.plate.dataset.t !== String(left)) {
      ui.plate.dataset.t = String(left);
      ui.plate.textContent = `GUEST ${G.pickupCar.id} · ${left}s · CLICK THEIR CAR`;
    }
    if (G.pickupLeft <= 0) failPickup();
  } else if (G.phase === 'exit' && G.activeCar) {
    if (stepExit(G.activeCar, dt)) finishExit();
  } else if (G.phase === 'arrival' && !G.activeCar && G.phaseTimer > 1.2) {
    spawnArrival();
  }
  formatTime();
}
