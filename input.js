// Keyboard, mouse and touch input, plus peeking at parked cars.
import { peekCar } from './cars.js';
import { canUseAction, parkCar, retrieveCar } from './classic.js';
import { PEEK_DWELL } from './config.js';
import { keyName } from './keymap.js';
import { $, audio, camera, canvas, pointer, raycaster, ui } from './core.js';
import { bindTitle, setPaused } from './menus.js';
import * as platform from './platform.js';
import { honk } from './shifts-world.js';
import { startRush, withAd } from './shifts.js';
import { cars, G, keys, layout, rush, touchInput } from './state.js';

// Peeking: mouse = hover for a moment, touch/pen = press and hold. A quick click/tap selects the car.
let peekTimerId = 0, peekArmed = null, peekFired = false;
let walkPointer = null, steerPointer = null, steerStartValue = 0, steerLastAngle = null, steerAccumulatedAngle = 0;
const mobileControlsElement = $('#mobileControls');

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function resetWalk() {
  walkPointer = null;
  touchInput.walkX = 0;
  touchInput.walkY = 0;
  const knob = $('#walkKnob');
  if (knob) knob.style.transform = 'translate(0px, 0px)';
}

function resetSteering() {
  steerPointer = null;
  touchInput.steer = 0;
  touchInput.steerTarget = 0;
  steerLastAngle = null;
  steerAccumulatedAngle = 0;
  const wheel = $('#steeringWheel');
  if (wheel) wheel.style.transform = 'rotate(0deg)';
  const control = $('#steerControl');
  if (control) {
    control.classList.remove('is-turning');
    control.setAttribute('aria-valuenow', '0');
  }
}

function resetPedals() {
  touchInput.gas = false;
  touchInput.brake = false;
  touchInput.reverse = false;
}

export function updateMobileControls() {
  const control = mobileControlsElement;
  if (!control) return;

  let state = 'hidden';
  if (G.running && !G.paused && !rush.picking) {
    if (G.mode === 'rush' && rush.pl) state = rush.pl.mode === 'foot' ? 'walking' : 'driving';
    else if (G.mode === 'classic' && G.activeCar) state = 'driving';
  }

  if (control.dataset.state !== state) {
    if (control.dataset.state === 'walking') resetWalk();
    if (control.dataset.state === 'driving') { resetSteering(); resetPedals(); }
    control.dataset.state = state;
  }
  control.classList.toggle('has-action', state !== 'hidden' && canUseAction());
}

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

// Keys physically held down. When the results card appears, the ones still held are ignored until released, so a player who is
// still mashing Space as the clock hits zero cannot skip the card by accident. A deliberate fresh press works instantly.
const down = new Set();
const heldAtEnd = new Set();
export function armResultsKeys() { heldAtEnd.clear(); down.forEach((c) => heldAtEnd.add(c)); }

// Show ZQSD instead of WASD on a French layout (Chromium only; elsewhere the label stays WASD).
function labelMoveKeys() {
  try {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
    navigator.keyboard.getLayoutMap().then((m) => {
      if (m.get('KeyW') !== 'z') return;
      layout.move = 'ZQSD';
      document.querySelectorAll('.hero-foot').forEach((el) => { el.textContent = el.textContent.replace('WASD', 'ZQSD'); });
      const w = document.querySelector('.instruction .key');
      if (w) w.textContent = 'Z';
    }).catch(() => {});
  } catch (e) { /* optional */ }
}

export function addControls() {
  labelMoveKeys();
  window.addEventListener('blur', () => down.clear());
  window.addEventListener('keydown', (e) => {
    const k = keyName(e);
    down.add(e.code);
    // Rush end screen: Space / Enter restarts instantly.
    if (G.mode === 'rush' && G.phase === 'over' && (e.code === 'Space' || e.key === 'Enter')
        && !e.repeat && !heldAtEnd.has(e.code) && !platform.adBusy()
        && !ui.overlay.classList.contains('hide') && !ui.overlay.classList.contains('title')
        && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
      e.preventDefault();
      audio.ensure();
      withAd(() => startRush(rush.endNext || G.lastRushOpts));
      return;
    }
    // Menus: let Space / Enter activate the focused button normally (and never "park" from a menu).
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (onButton && (!G.running || G.paused) && (e.code === 'Space' || e.key === 'Enter')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys.add(k);
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) parkCar(); }
    else if (k === 'e' && !e.repeat) parkCar();
    if (k === 'h' && !e.repeat) honk();
    if (k === 'p') setPaused(!G.paused);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Meta') keys.clear();   // macOS swallows the keyup of letters while Cmd is held: never leave a key stuck
    keys.delete(keyName(e));
    down.delete(e.code);
    heldAtEnd.delete(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    resetWalk();
    resetSteering();
    resetPedals();
  });
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

  const mobileControls = mobileControlsElement;
  mobileControls.addEventListener('contextmenu', (e) => e.preventDefault());

  const walkStick = $('#walkStick');
  const walkKnob = $('#walkKnob');
  const moveWithStick = (e) => {
    if (walkPointer !== e.pointerId || mobileControls.dataset.state !== 'walking') return;
    const rect = walkStick.getBoundingClientRect();
    const radius = Math.max(1, (rect.width - walkKnob.offsetWidth) / 2 - 2);
    let x = (e.clientX - (rect.left + rect.width / 2)) / radius;
    let y = (e.clientY - (rect.top + rect.height / 2)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    touchInput.walkX = x;
    touchInput.walkY = y;
    walkKnob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
  };
  walkStick.addEventListener('pointerdown', (e) => {
    if (mobileControls.dataset.state !== 'walking') return;
    e.preventDefault();
    walkPointer = e.pointerId;
    walkStick.setPointerCapture(e.pointerId);
    moveWithStick(e);
  });
  walkStick.addEventListener('pointermove', moveWithStick);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => {
    walkStick.addEventListener(event, (e) => { if (walkPointer === e.pointerId) resetWalk(); });
  });

  const steerControl = $('#steerControl');
  const steeringWheel = $('#steeringWheel');
  const moveSteering = (e) => {
    if (steerPointer !== e.pointerId || mobileControls.dataset.state !== 'driving') return;
    const rect = steerControl.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < rect.width * 0.2) {
      steerLastAngle = null;
      return;
    }
    const angle = Math.atan2(dy, dx);
    if (steerLastAngle !== null) {
      let delta = angle - steerLastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      else if (delta < -Math.PI) delta += Math.PI * 2;
      steerAccumulatedAngle += delta;
    }
    steerLastAngle = angle;
    touchInput.steerTarget = clamp(steerStartValue - steerAccumulatedAngle / (Math.PI * 4 / 3), -1, 1);
    steeringWheel.style.transform = `rotate(${-touchInput.steerTarget * 270}deg)`;
    steerControl.setAttribute('aria-valuenow', String(Math.round(touchInput.steerTarget * 100)));
  };
  steerControl.addEventListener('pointerdown', (e) => {
    if (mobileControls.dataset.state !== 'driving') return;
    e.preventDefault();
    steerPointer = e.pointerId;
    steerControl.classList.add('is-turning');
    steerStartValue = touchInput.steer;
    steerAccumulatedAngle = 0;
    steerLastAngle = null;
    steerControl.setPointerCapture(e.pointerId);
    moveSteering(e);
  });
  steerControl.addEventListener('pointermove', moveSteering);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => {
    steerControl.addEventListener(event, (e) => {
      if (steerPointer !== e.pointerId) return;
      steerPointer = null;
      steerLastAngle = null;
      touchInput.steerTarget = 0;
      steerControl.classList.remove('is-turning');
      steeringWheel.style.transform = 'rotate(0deg)';
      steerControl.setAttribute('aria-valuenow', '0');
    });
  });

  const bindPedal = (button, pedal) => {
    let pointerId = null;
    const release = (e) => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      pointerId = null;
      touchInput[pedal] = false;
    };
    button.addEventListener('pointerdown', (e) => {
      if (mobileControls.dataset.state !== 'driving') return;
      e.preventDefault();
      pointerId = e.pointerId;
      button.setPointerCapture(e.pointerId);
      touchInput.gas = pedal === 'gas';
      touchInput.brake = pedal === 'brake';
      touchInput.reverse = pedal === 'reverse';
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => button.addEventListener(event, release));
  };
  bindPedal($('#gasBtn'), 'gas');
  bindPedal($('#brakeBtn'), 'brake');
  bindPedal($('#reverseBtn'), 'reverse');
  $('#parkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); parkCar(); });
  $('#honkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); honk(); });

  bindTitle();

  ui.soundBtn.addEventListener('click', () => {
    G.soundOn = !G.soundOn;
    renderSoundButton();
    try { localStorage.setItem('valetMute', G.soundOn ? '0' : '1'); } catch (e) { /* ignore */ }
    audio.setEnabled(G.soundOn && !G.platformMuted);
  });

  const fullscreenBtn = $('#fullscreenBtn');
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', renderFullscreenButton);
  document.addEventListener('webkitfullscreenchange', renderFullscreenButton);
  renderFullscreenButton();
}

export function renderSoundButton() {
  const enabled = G.soundOn && !G.platformMuted;
  ui.soundBtn.disabled = G.platformMuted;
  ui.soundBtn.textContent = enabled ? '♫' : '♪';
  ui.soundBtn.style.color = enabled ? '#e9c477' : '';
  ui.soundBtn.title = G.platformMuted ? 'Muted by platform settings' : enabled ? 'Mute sound' : 'Enable sound';
  ui.soundBtn.setAttribute('aria-label', G.platformMuted ? 'Sound muted by platform settings' : enabled ? 'Mute sound' : 'Enable sound');
  ui.soundBtn.setAttribute('aria-pressed', String(enabled));
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function renderFullscreenButton() {
  const button = $('#fullscreenBtn');
  if (!button) return;
  const active = isFullscreen();
  button.textContent = active ? '×' : '⛶';
  button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(active));
}

async function toggleFullscreen() {
  if (isFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) {
      toast('This browser does not support exiting fullscreen from the game.');
      return;
    }
    try { await exit.call(document); }
    catch (error) {
      console.warn('Fullscreen exit was denied by the browser.', error);
      toast('The browser could not exit fullscreen. Use its fullscreen control.');
    }
    return;
  }

  const root = document.documentElement;
  if (!root.requestFullscreen && !root.webkitRequestFullscreen) {
    toast('Fullscreen is not supported in this browser.');
    return;
  }
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else await root.webkitRequestFullscreen();
  } catch (error) {
    console.warn('Fullscreen request was denied by the browser.', error);
    toast('Fullscreen was blocked. Try the browser fullscreen control.');
    return;
  }

  if (matchMedia('(pointer: coarse)').matches && screen.orientation && screen.orientation.lock) {
    try { await screen.orientation.lock('landscape'); }
    catch (error) {
      console.warn('Landscape orientation lock is unavailable.', error);
      toast('Fullscreen is on. Rotate your phone to landscape for the full view.');
    }
  }
}
