// Keyboard, mouse and touch input, plus peeking at parked cars.
import { peekCar } from './cars.js';
import { parkCar, retrieveCar } from './classic.js';
import { PEEK_DWELL } from './config.js';
import { keyName } from './keymap.js';
import { $, audio, camera, canvas, pointer, raycaster, ui } from './core.js';
import { bindTitle, setPaused } from './menus.js';
import * as platform from './platform.js';
import { honk } from './shifts-world.js';
import { startRush, withAd } from './shifts.js';
import { cars, G, keys, layout, rush } from './state.js';

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
  window.addEventListener('blur', () => keys.clear());
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

  document.querySelectorAll('.mobile-controls').forEach((el) => el.addEventListener('contextmenu', (e) => e.preventDefault()));
  document.querySelectorAll('.pad button').forEach((b) => {
    const k = b.dataset.key;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(k); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, () => keys.delete(k)));
  });
  $('#parkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); parkCar(); });
  $('#honkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); honk(); });

  bindTitle();

  ui.soundBtn.addEventListener('click', () => {
    G.soundOn = !G.soundOn;
    renderSoundButton();
    try { localStorage.setItem('valetMute', G.soundOn ? '0' : '1'); } catch (e) { /* ignore */ }
    audio.setEnabled(G.soundOn && !G.platformMuted);
  });
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
