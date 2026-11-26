// Entry point: boot sequence, the main update / render loop and quality scaling. The game logic lives in the other modules.
import * as THREE from 'three';
import { preload, seedCars } from './cars.js';
import { parkCar, start, updateClassic, updateHUD } from './classic.js';
import { HANDOFF, LEVELS, reduceMotion } from './config.js';
import { addFx, audio, camera, canvas, clock, markAllSlots, parkRadius, renderer, scene, toast, worldToScreen } from './core.js';
import { animateCars, updateFx } from './fx.js';
import { addControls, renderSoundButton, updateMobileControls } from './input.js';
import { addPauseUI, applyCosmetics, setTitleButtons, showLevelSelect, showSceneLab, showTitle, updateBestLine } from './menus.js';
import { updateFigures } from './people.js';
import * as platform from './platform.js';
import { load as loadSave, loadFromPlatform, save } from './progress.js';
import { offerShiftIntro, updateRushRings } from './shifts-world.js';
import { endRush, startRush, updateRush } from './shifts.js';
import { cars, G, rush, slots, tut, tutorial } from './state.js';
import { buildWorld, initLights } from './world.js';

const platformExpected = platform.shouldLoadSDK();
const platformReady = platform.initPlatform();
const touchCapable = navigator.maxTouchPoints > 0
  || 'ontouchstart' in window
  || matchMedia('(any-pointer: coarse)').matches;
document.body.dataset.touch = String(touchCapable);
let saveReady = !platformExpected;
let assetsReady = false;
let cameraFocus = { x: 0, z: -1.7 };
let cameraUsesPortraitFollow = false;

function applyLoadedSave() {
  G.best = save.best;
  G.bestRush = save.bestRush;
  tut.done = save.tut.classic;
  tut.rushDone = save.tut.rush;
  applyCosmetics();
  updateBestLine();
}

function enableTitleWhenReady() {
  if (assetsReady && saveReady) setTitleButtons(true);
}

if (!platformExpected) {
  loadSave();
  applyLoadedSave();
}

/* ---------- touch screens: lift the view clear of the on-screen controls ---------- */
// When the car you drive, the bay or PICK-UP ring it is heading for, or the valet on foot would sit under the pedals,
// the steering wheel or the joystick, the camera pans so it rises above them. The controls keep their full size,
// and the view eases back once nothing important is underneath.
const mobileControlsEl = document.getElementById('mobileControls');
const CAM_ELEVATION_SIN = 25 / Math.hypot(25, 20.7);   // how much screen height one unit of lot depth takes (camera ~50° up)
let liftPx = 0;

function controlRects() {
  if (!mobileControlsEl || mobileControlsEl.dataset.state === 'hidden' || !mobileControlsEl.offsetWidth) return [];
  return [...mobileControlsEl.querySelectorAll('.left-control, .drive-pedals, .mobile-park, .mobile-honk')]
    .filter((el) => el.offsetWidth > 0)
    .map((el) => el.getBoundingClientRect());
}

// What must stay visible: [x, z, radius] in lot units.
function liftTargets() {
  const pts = [];
  const car = G.activeCar;
  if (car) {
    pts.push([car.x, car.z, 1.5]);
    if (car.delivering) pts.push([HANDOFF.x, HANDOFF.z, parkRadius()]);
    else if (car.slot && !car.parked) pts.push([car.slot.x, car.slot.z, parkRadius()]);
  } else if (G.mode === 'rush' && rush.pl && rush.pl.mode === 'foot') pts.push([rush.pl.x, rush.pl.z, 0.8]);
  return pts;
}

// Returns how far (in lot units) to pan the camera towards the front of the lot this frame.
function updateLift(dt) {
  const H = canvas.clientHeight || innerHeight;
  const pxPerUnit = H / ((camera.top - camera.bottom) / camera.zoom);
  let target = 0;
  const rects = G.running && !G.paused ? controlRects() : [];
  if (rects.length) {
    for (const [x, z, r] of liftTargets()) {
      const s = worldToScreen(x, z, 0);
      const y0 = s.y + liftPx;                                   // where it would be on screen with no lift
      const rx = r * pxPerUnit, ry = r * pxPerUnit * CAM_ELEVATION_SIN;
      for (const b of rects) {
        if (s.x + rx < b.left - 10 || s.x - rx > b.right + 10) continue;   // not above this control
        target = Math.max(target, y0 + ry - (b.top - 14));
      }
    }
    target = Math.min(Math.max(0, target), H * 0.24);            // never pan more than about a quarter of the screen
  }
  liftPx += (target - liftPx) * (1 - Math.exp(-dt * 4));         // smooth, no jolts
  if (target === 0 && liftPx < 0.5) liftPx = 0;
  return liftPx / pxPerUnit / CAM_ELEVATION_SIN;
}

function update(dt) {
  if (!G.paused) { updateFigures(dt); updateFx(dt); animateCars(dt); }
  updateRushRings();
  if (G.running && !G.paused && G.mode === 'rush') {
    if (!rush.picking) updateRush(dt);   // the perk picker freezes the whole run
  } else if (G.running && !G.paused) {
    updateClassic(dt);
  } else if (!G.running) {
    markAllSlots(false);
  }

  updateMobileControls();
  const viewWidth = canvas.clientWidth || innerWidth;
  const viewHeight = canvas.clientHeight || innerHeight;
  const portrait = viewWidth / viewHeight < 0.9 && (G.mode === 'rush' || Boolean(G.activeCar));
  if (portrait !== cameraUsesPortraitFollow) {
    cameraUsesPortraitFollow = portrait;
    resize();
  }
  if (portrait) {
    let target = null;
    if (G.running && G.mode === 'rush' && rush.pl) {
      target = rush.pl.mode === 'drive' && G.activeCar ? G.activeCar : rush.pl;
    } else if (G.running && G.activeCar) target = G.activeCar;
    const targetX = target ? target.x : 0;
    const targetZ = target ? target.z : -1.7;
    const blend = 1 - Math.exp(-dt * 5);
    cameraFocus.x += (targetX - cameraFocus.x) * blend;
    cameraFocus.z += (targetZ - cameraFocus.z) * blend;
  } else {
    cameraFocus.x = 0;
    cameraFocus.z = -1.7;
  }

  let cameraShake = 0;
  if (G.shake > 0) {
    cameraShake = (Math.random() - 0.5) * G.shake * 0.7;
    G.shake = Math.max(0, G.shake - dt * 1.6);
  }
  if (portrait) {
    liftPx = 0;
    camera.position.set(cameraFocus.x + cameraShake, 25, cameraFocus.z + 20.7);
    camera.lookAt(cameraFocus.x, 0, cameraFocus.z);
  } else {
    const liftZ = updateLift(dt);   // 0 unless something important would sit under the touch controls
    camera.position.set(cameraShake, 25, 19 + liftZ);
    camera.lookAt(0, 0, -1.7 + liftZ);
  }
  camera.updateMatrixWorld(true);
  if (G.wrongFlash > 0) G.wrongFlash = Math.max(0, G.wrongFlash - dt * 2.5);
  if (G.punch > 0) {
    G.punch = Math.max(0, G.punch - dt * 3.5);
    camera.zoom = 1 + G.punch * 0.02;
    camera.updateProjectionMatrix();
  }
  if (G.flashEl) G.flashEl.style.opacity = reduceMotion ? '0' : String(G.wrongFlash * 0.55);

  audio.engine(G.running && !G.paused && !rush.picking && G.activeCar && G.phase === 'arrival' ? Math.abs(G.activeCar.speed) : null,
    G.activeCar && G.activeCar.file);

  // Music follows the action: more layers and a faster tempo with combo, level and low time.
  if (G.running && !G.paused) {
    if (G.mode === 'rush') {
      audio.musicSet(tutorial.on ? 0.25 : 0.22 + rush.mult * 0.09 + rush.level * 0.02 + (G.seconds < 10 ? 0.15 : 0),
        84 + rush.level * 2 + rush.mult * 2, rush.mult >= 6 ? 2 : 0);
    } else {
      audio.musicSet(0.25 + Math.min(G.streak, 8) * 0.07 + (G.phase === 'pickup' ? 0.15 : 0), 92 + G.shift * 3, 0);
    }
  }
}

/* ---------- quality: weak devices (and slow frame rates) get a lighter renderer ---------- */
const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 4)
  || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
  || matchMedia('(pointer: coarse)').matches;

let quality = 'high';

let fpsFrames = 0, fpsTime = 0, slowRuns = 0;

function setQuality(q) {
  if (q === quality) return;
  quality = q;
  const low = q === 'low';
  const size = low ? 1024 : 2048;
  moonLight.shadow.mapSize.set(size, size);
  if (moonLight.shadow.map) { moonLight.shadow.map.dispose(); moonLight.shadow.map = null; }
  resize();
}

// The whole play area that must always be visible, as world points: the entry lane (x -16.5) to the exit (x 16.5),
// the building front / doors at the back (z -10.2, up to 3 high) and the front curb (z 9.9).
const FIT_POINTS = [];
for (const x of [-16.5, 16.5]) {
  FIT_POINTS.push(new THREE.Vector3(x, 3, -10.2), new THREE.Vector3(x, 0, -10.2), new THREE.Vector3(x, 0, 9.9));
}

// Landscape frames the lot for touch controls; portrait keeps the landscape scale and follows the active valet/car.
function resize() {
  const W = canvas.clientWidth || innerWidth, H = canvas.clientHeight || innerHeight, aspect = W / H;
  const portrait = aspect < 0.9 && (G.mode === 'rush' || Boolean(G.activeCar));
  cameraUsesPortraitFollow = portrait;
  const pixelRatioCap = touchCapable
    ? (quality === 'low' ? 2.25 : 2.5)
    : (quality === 'low' ? 1.75 : 2);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  if (!portrait) cameraFocus = { x: 0, z: -1.7 };
  camera.position.set(portrait ? cameraFocus.x : 0, 25, portrait ? cameraFocus.z + 20.7 : 19);
  camera.lookAt(portrait ? cameraFocus.x : 0, 0, portrait ? cameraFocus.z : -1.7);
  camera.updateMatrixWorld(true);

  // Extents of the play area in camera space (x = screen right, y = screen up).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of FIT_POINTS) {
    const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const spanX = maxX - minX, spanY = maxY - minY;

  // Breathing room in pixels: a little at the top, more at the bottom on touch layouts (on-screen controls).
  const mobileLandscape = W <= 900 && H <= 600 && aspect >= 0.9;
  const padTop = mobileLandscape ? Math.min(H * 0.035, 24) : Math.min(H * 0.05, 40);
  const padBot = portrait ? Math.min(H * 0.2, 170)
    : mobileLandscape ? Math.min(H * 0.09, 58)
      : W <= 900 ? Math.min(H * 0.16, 110) : Math.min(H * 0.04, 30);
  const pf = Math.min(0.5, (padTop + padBot) / H);
  const landscapePad = (Math.min(H * 0.05, 40) + Math.min(H * 0.04, 30)) / H;
  const landscapeScale = Math.max(spanY / (1 - landscapePad), spanX / (16 / 9));

  const visibleH = (portrait ? landscapeScale : Math.max(spanY / (1 - pf), spanX / aspect)) * (mobileLandscape ? 0.95 : 1);
  const visibleW = visibleH * aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + (padTop - padBot) / 2 / H * visibleH;
  const centerX = portrait ? 0 : cx;
  const centerY = portrait ? (padTop - padBot) / 2 / H * visibleH : cy;
  camera.left = centerX - visibleW / 2;
  camera.right = centerX + visibleW / 2;
  camera.top = centerY + visibleH / 2;
  camera.bottom = centerY - visibleH / 2;
  camera.updateProjectionMatrix();
}

function render() {
  clock.update();
  const raw = clock.getDelta();
  const slow = G.slowT > 0;
  G.slowT = Math.max(0, G.slowT - raw);
  const dt = Math.min(0.05, raw) * (slow ? 0.4 : 1);
  // Two slow 3-second windows in a row (under 40 fps) switch to the light renderer.
  if (G.running && !G.paused && quality === 'high' && raw < 0.5) {
    fpsFrames++;
    fpsTime += raw;
    if (fpsTime >= 3) {
      slowRuns = fpsFrames / fpsTime < 40 ? slowRuns + 1 : 0;
      fpsFrames = 0;
      fpsTime = 0;
      if (slowRuns >= 2) setQuality('low');
    }
  }
  // Schedule the next frame first so a single bad frame never stops the loop, but do not hide repeated failures.
  requestAnimationFrame(render);
  let ok = true;
  try { update(dt); } catch (err) { ok = false; reportFrameError(err, 'update'); }
  try { renderer.render(scene, camera); } catch (err) { ok = false; reportFrameError(err, 'render'); }
  if (ok) frameErrors = 0;
}

/* ---------- error handling: log, and after a run of failed frames stop the game and say so ---------- */
const MAX_BAD_FRAMES = 30;   // about half a second of consecutive failures

let frameErrors = 0, errorCardUp = false;

function reportFrameError(err, where) {
  frameErrors++;
  if (frameErrors === 1 || frameErrors % 120 === 0) console.error(`Frame ${where} failed (${frameErrors} in a row)`, err);
  if (frameErrors >= MAX_BAD_FRAMES) showErrorCard(err);
}

function showErrorCard(err) {
  if (errorCardUp) return;
  errorCardUp = true;
  G.paused = true;
  const el = document.createElement('div');
  el.setAttribute('role', 'alertdialog');
  el.style.cssText = 'position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:#0a1822cc;font-family:Nunito,system-ui,sans-serif;color:#fff7e6';
  el.innerHTML = '<div style="max-width:380px;padding:24px 28px;border-radius:22px;background:#0a1822;border:2px solid #ffffff30;text-align:center">'
    + '<h2 style="margin:0 0 8px;font:700 26px Fredoka,system-ui,sans-serif">Something went wrong</h2>'
    + '<p style="margin:0 0 18px;color:#a9bdc9">The game hit an unexpected error. Your progress is saved.</p>'
    + '<button data-act="menu" style="margin:4px;padding:12px 20px;border-radius:14px;border:0;background:#ffc247;color:#2a1b00;font:800 16px Nunito,system-ui,sans-serif;cursor:pointer">Back to title</button>'
    + '<button data-act="reload" style="margin:4px;padding:12px 20px;border-radius:14px;border:2px solid #ffffff30;background:transparent;color:#fff7e6;font:800 16px Nunito,system-ui,sans-serif;cursor:pointer">Reload</button></div>';
  el.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'reload') { location.reload(); return; }
    if (act !== 'menu') return;
    el.remove();
    errorCardUp = false;
    frameErrors = 0;
    try { G.running = false; G.paused = false; showTitle(); } catch (e2) { location.reload(); }
  });
  document.body.appendChild(el);
  console.error('Game stopped after repeated frame errors', err);
}

window.addEventListener('unhandledrejection', (e) => console.error('Unhandled promise rejection', e.reason));

renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showErrorCard(new Error('WebGL context lost')); });

const moonLight = initLights(scene);

G.colliders = buildWorld(scene, slots);

applyCosmetics();

addControls();

addPauseUI();

addFx();

if (lowEnd) setQuality('low');

resize();

renderSoundButton();

platformReady.then(async (ok) => {
  if (ok) {
    platform.onGameSettingsChange((settings) => {
      G.platformMuted = !!(settings && settings.muteAudio === true);
      audio.setEnabled(G.soundOn && !G.platformMuted);
      renderSoundButton();
    });
    const systemInfo = platform.getSystemInfo();
    const deviceType = systemInfo && systemInfo.device && systemInfo.device.type;
    if (deviceType) document.body.dataset.device = deviceType;
    const guest = await platform.isGuestUser();
    loadFromPlatform(undefined, guest);
  } else if (platformExpected) {
    loadSave();
  }
  saveReady = true;
  applyLoadedSave();
  enableTitleWhenReady();
}).catch((err) => {
  console.error('Could not finish platform startup', err);
  if (platformExpected && !platform.isReady()) {
    loadSave();
    applyLoadedSave();
  }
  saveReady = true;
  enableTitleWhenReady();
});

window.focus();

updateBestLine();

updateHUD();

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('fullscreenchange', resize);
document.addEventListener('webkitfullscreenchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

preload()
  .then(() => {
    seedCars(2, false);
    assetsReady = true;
    enableTitleWhenReady();
    platform.loadingComplete();
  })
  .catch((err) => {
    platform.loadingComplete();
    console.error('Could not load bundled car models', err);
    toast('One of the bundled cars failed to load.');
  });

requestAnimationFrame(render);

if (location.search.includes('debug')) {
  window.__valet = { rush, slots, cars, startRush, start, parkCar, THREE, tutorial, save, offerShiftIntro, endRush, LEVELS, showLevelSelect, showSceneLab, colliders: () => G.colliders,
    get car() { return G.activeCar; }, get mode() { return G.mode; }, get phase() { return G.phase; },
    get score() { return G.score; }, set score(v) { G.score = v; }, get seconds() { return G.seconds; }, set seconds(v) { G.seconds = v; } };
}
