// Entry point: boot sequence, the main update / render loop and quality scaling. The game logic lives in the other modules.
import * as THREE from 'three';
import { preload, seedCars } from './cars.js';
import { parkCar, start, updateClassic, updateHUD } from './classic.js';
import { LEVELS, reduceMotion } from './config.js';
import { addFx, audio, camera, clock, markAllSlots, renderer, scene, toast } from './core.js';
import { animateCars, updateFx } from './fx.js';
import { addControls, renderSoundButton } from './input.js';
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
let saveReady = !platformExpected;
let assetsReady = false;

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

  // Fixed camera: position and angle never change (the frustum is fitted to the screen in resize()). Only screen shake moves it.
  camera.position.x = 0;
  if (G.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * G.shake * 0.7;
    G.shake = Math.max(0, G.shake - dt * 1.6);
  }
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
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 1.6));
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

// Fixed camera, any screen: the camera never moves; the orthographic frustum is fitted so every FIT_POINT is on screen.
function resize() {
  const W = innerWidth, H = innerHeight, aspect = W / H;
  renderer.setSize(W, H, false);
  camera.position.set(0, 25, 19);
  camera.lookAt(0, 0, -1.7);
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
  const padTop = Math.min(H * 0.05, 40);
  const padBot = W <= 900 ? Math.min(H * 0.16, 110) : Math.min(H * 0.04, 30);
  const pf = Math.min(0.5, (padTop + padBot) / H);

  const visibleH = Math.max(spanY / (1 - pf), spanX / aspect);   // whichever dimension is tighter decides the zoom
  const visibleW = visibleH * aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + (padTop - padBot) / 2 / H * visibleH;
  camera.left = cx - visibleW / 2;
  camera.right = cx + visibleW / 2;
  camera.top = cy + visibleH / 2;
  camera.bottom = cy - visibleH / 2;
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
