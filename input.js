// Keyboard, mouse and touch input, plus peeking at parked cars.
import { peekCar } from './cars.js';
import { parkCar, retrieveCar } from './classic.js';
import { PEEK_DWELL } from './config.js';
import { $, audio, camera, canvas, pointer, raycaster, ui } from './core.js';
import { bindTitle, setPaused } from './menus.js';
import { honk } from './shifts-world.js';
import { startRush, withAd } from './shifts.js';
import { cars, G, keys, rush, touch } from './state.js';

/* ---------- touch controls: steering wheel + pedals when driving, joystick when on foot ---------- */
const byId = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function resetTouch() {
  touch.steer = 0; touch.gas = false; touch.brake = false; touch.jx = 0; touch.jz = 0;
  const knob = byId('joyKnob');
  if (knob) knob.style.transform = 'translate(-50%,-50%)';
  const rim = byId('wheelRim');
  if (rim) { rim.style.transition = 'transform .18s ease-out'; rim.style.transform = 'rotate(0deg)'; }
  for (const id of ['gasBtn', 'brakeBtn']) { const b = byId(id); if (b) b.classList.remove('down'); }
}

// Called every frame: shows the wheel + pedals while driving and the joystick while on foot.
export function syncControls() {
  const foot = G.mode === 'rush' && G.running && rush.pl && rush.pl.mode === 'foot';
  const m = foot ? 'foot' : 'car';
  if (document.body.dataset.ctl !== m) { document.body.dataset.ctl = m; resetTouch(); }
  if ((!G.running || G.paused || rush.picking) && (touch.gas || touch.brake || touch.steer || touch.jx || touch.jz)) resetTouch();
}

function bindJoystick() {
  const joy = byId('joy'), knob = byId('joyKnob');
  if (!joy || !knob) return;
  let id = null;
  const update = (e) => {
    const r = joy.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const lim = r.width * 0.34;
    const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy) || 1;
    const v = Math.min(1, d / lim);
    const mag = v < 0.14 ? 0 : (v - 0.14) / 0.86;                 // small dead zone, then analog
    touch.jx = dx / d * mag;
    touch.jz = dy / d * mag;
    const k = Math.min(d, lim);
    knob.style.transform = `translate(calc(-50% + ${dx / d * k}px), calc(-50% + ${dy / d * k}px))`;
  };
  const end = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    touch.jx = 0; touch.jz = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  };
  joy.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    try { joy.setPointerCapture(id); } catch (err) { /* ignore */ }
    update(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); update(e); } });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => joy.addEventListener(ev, end));
}

function bindWheel() {
  const wheel = byId('wheel'), rim = byId('wheelRim');
  if (!wheel || !rim) return;
  let id = null, a0 = 0;
  const angle = (e) => {
    const r = wheel.getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));   // clockwise from straight up
  };
  const update = (e) => {
    let rel = angle(e) - a0;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    rel = clamp(rel, -1.4, 1.4);                                  // about 80 degrees of lock each way
    const s = clamp(rel / 1.15, -1, 1);
    touch.steer = Math.abs(s) < 0.05 ? 0 : -s;                    // turning the wheel right steers right
    rim.style.transition = 'none';
    rim.style.transform = `rotate(${rel}rad)`;
  };
  const end = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    touch.steer = 0;
    rim.style.transition = 'transform .18s ease-out';
    rim.style.transform = 'rotate(0deg)';
  };
  wheel.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    a0 = angle(e);
    try { wheel.setPointerCapture(id); } catch (err) { /* ignore */ }
    update(e);
  });
  wheel.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); update(e); } });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => wheel.addEventListener(ev, end));
}

function bindPedal(btnId, prop) {
  const b = byId(btnId);
  if (!b) return;
  let id = null;
  const up = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    touch[prop] = false;
    b.classList.remove('down');
  };
  b.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    try { b.setPointerCapture(id); } catch (err) { /* ignore */ }
    touch[prop] = true;
    b.classList.add('down');
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, up));
}

function addTouchControls() {
  bindJoystick();
  bindWheel();
  bindPedal('gasBtn', 'gas');
  bindPedal('brakeBtn', 'brake');
  // No copy / paste / share / image menus when a finger rests on the game for a while.
  const coarse = matchMedia('(pointer: coarse)');
  window.addEventListener('contextmenu', (e) => { if (coarse.matches || e.pointerType === 'touch') e.preventDefault(); });
  document.addEventListener('selectstart', (e) => { if (coarse.matches) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS pinch while playing
}

// Peeking: mouse = hover for a moment, touch/pen = press and hold. A quick click/tap selects the car.
let peekTimerId = 0, peekArmed = null, peekFired = false;

function carAt(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = (e.clientX - r.left) / r.width * 2 - 1;
  pointer.y = -(e.clientY - r.top) / r.height * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // Only parked cars are raycast targets (tags and fake shadows opt out of raycasting).
  const targets = [...cars].filter((c) => c.parked && c.slot).map((c) => c.root);
  const hit = raycaster.intersectObjects(targets, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.gameCar) o = o.parent;
  return o ? o.userData.gameCar : null;
}

function armPeek(car) {
  if (peekArmed === car) return;
  cancelPeek();
  if (!car) return;
  peekArmed = car;
  peekTimerId = setTimeout(() => { peekTimerId = 0; peekFired = true; peekCar(car); }, PEEK_DWELL * 1000);
}

export function cancelPeek() {
  clearTimeout(peekTimerId);
  peekTimerId = 0;
  peekArmed = null;
}

export function addControls() {
  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Rush end screen: Space / Enter restarts instantly.
    if (G.mode === 'rush' && G.phase === 'over' && (e.code === 'Space' || e.key === 'Enter')
        && !ui.overlay.classList.contains('hide') && !ui.overlay.classList.contains('title')
        && performance.now() > rush.readyAt && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
      e.preventDefault();
      audio.ensure();
      withAd(() => startRush(rush.endNext || G.lastRushOpts));
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys.add(k);
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) parkCar(); }
    else if (k === 'e' && !e.repeat) parkCar();
    if (k === 'h' && !e.repeat) honk();
    if (e.key === 'Escape' || k === 'p') setPaused(!G.paused);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => { keys.clear(); resetTouch(); });
  window.addEventListener('pointerdown', () => window.focus());   // keep keyboard focus when embedded in an iframe

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (G.phase !== 'pickup' || G.paused) { cancelPeek(); return; }
    armPeek(carAt(e));
  });
  canvas.addEventListener('pointerleave', cancelPeek);

  canvas.addEventListener('pointerdown', (e) => {
    if (G.phase !== 'pickup' || G.paused) return;
    const car = carAt(e);
    if (!car) return;
    if (e.pointerType === 'mouse') { cancelPeek(); retrieveCar(car); return; }
    peekFired = false;
    armPeek(car);
  });
  const release = (e) => {
    if (e.pointerType === 'mouse') return;
    const car = peekArmed, fired = peekFired;
    cancelPeek();
    peekFired = false;
    if (!fired && car && G.phase === 'pickup' && !G.paused && e.type === 'pointerup') retrieveCar(car);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  addTouchControls();
  $('#parkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); parkCar(); });
  $('#honkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); honk(); });

  bindTitle();

  ui.soundBtn.addEventListener('click', () => {
    G.soundOn = !G.soundOn;
    renderSoundButton();
    try { localStorage.setItem('valetMute', G.soundOn ? '0' : '1'); } catch (e) { /* ignore */ }
    audio.setEnabled(G.soundOn);
  });
}

export function renderSoundButton() {
  ui.soundBtn.textContent = G.soundOn ? '♫' : '♪';
  ui.soundBtn.style.color = G.soundOn ? '#e9c477' : '';
  ui.soundBtn.setAttribute('aria-pressed', String(!G.soundOn));
}
