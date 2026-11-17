// Entry point: boot sequence, the main update / render loop and quality scaling. The game logic lives in the other modules.
import * as THREE from 'three';
import { preload, seedCars } from './cars.js';
import { parkCar, start, updateClassic, updateHUD } from './classic.js';
import { LEVELS, reduceMotion } from './config.js';
import { addFx, audio, camera, clock, followCam, markAllSlots, renderer, scene, toast } from './core.js';
import { animateCars, updateFx } from './fx.js';
import { addControls, renderSoundButton } from './input.js';
import { addPauseUI, applyCosmetics, setTitleButtons, showLevelSelect, updateBestLine } from './menus.js';
import { updateFigures } from './people.js';
import * as platform from './platform.js';
import { load as loadSave, save } from './progress.js';
import { offerShiftIntro, updateRushRings } from './shifts-world.js';
import { endRush, startRush, updateRush } from './shifts.js';
import { cars, G, rush, slots, tut, tutorial } from './state.js';
import { buildWorld, initLights } from './world.js';

loadSave();

G.best = save.best;

G.bestRush = save.bestRush;

tut.done = save.tut.classic;

tut.rushDone = save.tut.rush;

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

  // Slow, composed camera drift that keeps the active car in the playfield.
  const focus = G.activeCar && G.phase === 'arrival' ? G.activeCar : (G.mode === 'rush' && G.running && rush.pl && rush.pl.mode === 'foot' ? rush.pl : null);
  const lookX = focus ? THREE.MathUtils.clamp(focus.x * 0.08, -0.8, 0.8) : (!G.running ? Math.sin(performance.now() * 0.0003) * 1.1 : 0);
  followCam.x += (lookX - followCam.x) * Math.min(1, dt * 0.75);
  camera.position.x = followCam.x;
  camera.lookAt(followCam.x, 0, -1.7);
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

  audio.engine(G.running && !G.paused && !rush.picking && G.activeCar && G.phase === 'arrival' ? Math.abs(G.activeCar.speed) : null);

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

function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  const visibleW = aspect > 1.2 ? 33 : 25;
  const visibleH = visibleW / aspect;
  camera.left = -visibleW / 2;
  camera.right = visibleW / 2;
  camera.top = visibleH / 2;
  camera.bottom = -visibleH / 2;
  camera.updateProjectionMatrix();
}

function render() {
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
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

const moonLight = initLights(scene);

G.colliders = buildWorld(scene, slots);

applyCosmetics();

addControls();

addPauseUI();

addFx();

if (lowEnd) setQuality('low');

resize();

renderSoundButton();

platform.initPlatform();

window.focus();

updateBestLine();

updateHUD();

window.addEventListener('resize', resize);

preload()
  .then(() => { seedCars(2, false); setTitleButtons(); })
  .catch((err) => {
    console.error('Could not load bundled car models', err);
    toast('One of the bundled cars failed to load.');
  });

requestAnimationFrame(render);

if (location.search.includes('debug')) {
  window.__valet = { rush, slots, cars, startRush, start, parkCar, THREE, tutorial, save, offerShiftIntro, endRush, LEVELS, showLevelSelect, colliders: () => G.colliders,
    get car() { return G.activeCar; }, get mode() { return G.mode; }, get phase() { return G.phase; },
    get score() { return G.score; }, set score(v) { G.score = v; }, get seconds() { return G.seconds; }, set seconds(v) { G.seconds = v; } };
}
