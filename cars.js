// Cars: model loading, tinting, tags and tail lights, random car generation, the lot reset.
import * as THREE from 'three';
import { updateHUD } from './classic.js';
import { CAR_COLORS, MODEL_FILES, PEEK_COST, PEEK_TIME, QUIRK_ORDER, QUIRKS, SPECIAL_KEYS } from './config.js';
import { difficulty, loader, modelCache, openSlots, paintPool, parkYaw, popScore, scene, shuffle, ui, worldToScreen } from './core.js';
import { clearFx } from './fx.js';
import { cancelPeek } from './input.js';
import { clearFigures } from './people.js';
import { clearToken } from './shifts-world.js';
import { clearMark, endCall } from './shifts.js';
import { cars, G, perks, rush, slots, tutorial } from './state.js';
import { addTextTexture } from './world.js';

// Shared by every car, so never disposed per-car.
export const SHADOW_GEO = new THREE.CircleGeometry(1.18, 32);

export const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false });

const LIGHT_GEO = new THREE.BoxGeometry(0.22, 0.1, 0.06);

function cloneMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
}

function normalizeModel(root) {
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.scale.setScalar(2.85 / Math.max(size.x, size.z));
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  root.position.x -= (bb.min.x + bb.max.x) / 2;
  root.position.z -= (bb.min.z + bb.max.z) / 2;
  root.position.y -= bb.min.y;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  cloneMaterials(root);
  return root;
}

export async function preload() {
  // Make sure the UI font is ready before it is baked into tag textures.
  const fontReady = document.fonts ? document.fonts.load('700 40px Fredoka').catch(() => {}) : Promise.resolve();
  const models = MODEL_FILES.map((f) => new Promise((resolve, reject) => {
    loader.load(`./assets/vehicles/${f}`, (g) => {
      try { modelCache.set(f, normalizeModel(g.scene)); resolve(); }
      catch (error) { reject(error); }
    }, undefined, reject);
  }));
  const results = await Promise.allSettled([fontReady, ...models]);
  const fallback = modelCache.values().next().value;
  if (!fallback) {
    const failed = results.find((result) => result.status === 'rejected');
    throw failed ? failed.reason : new Error('No vehicle models could be loaded');
  }
  for (const file of MODEL_FILES) {
    if (modelCache.has(file)) continue;
    console.warn(`Could not load ${file}; using another bundled car model instead.`);
    modelCache.set(file, fallback);
  }
}

function tintCar(root, color) {
  const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.8);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach((m) => {
      if (!m || !m.color || m.transparent || m.opacity < 1) return;
      if (/glass|window|light|wheel|tire|tyre|rubber|chrome|plate/.test((m.name || '').toLowerCase())) return;
      m.color.copy(tint);
    });
  });
}

function tagLabel(car) {
  return car.id + (car.quirk ? ' ' + QUIRKS[car.quirk].icon : '') + (car.vip ? ' ⭐' : '');
}

function makeCar(file, color, id, colorIndex, quirk = null, vip = false, special = null) {
  const body = modelCache.get(file).clone(true);
  cloneMaterials(body);
  tintCar(body, color);

  const wrapper = new THREE.Group();
  wrapper.add(body);

  const car = {
    id, file, color, colorIndex, quirk, vip, special, vipActive: vip,
    root: wrapper, body, tag: null,
    x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0,
    slot: null, parked: false, exit: false, exitLane: 0, snap: null, honk: 2,
    parkQuality: 0, tagTimer: 0, peekTimer: 0, peeked: false,
  };

  const icons = (quirk ? 1 : 0) + (vip ? 1 : 0);
  const size = icons === 0 ? (id.length === 1 ? 100 : 78) : icons === 1 ? 58 : 46;
  const tagTex = addTextTexture(
    [{ text: tagLabel(car), size, font: 'Fredoka, Arial, sans-serif', weight: '700', color: '#fff7e6', y: 67 }],
    { width: 256, height: 128, bg: '#0a1822', border: vip ? '#ffe28a' : '#ffc247' },
  );
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, toneMapped: false, depthWrite: false }));
  tag.position.set(0, 1.9, 0);
  tag.scale.set(1.15, 0.58, 1);
  tag.raycast = () => {};      // tags never intercept clicks
  wrapper.add(tag);
  car.tag = tag;

  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  shadow.scale.set(0.9, 1.4, 1);
  shadow.raycast = () => {};   // ...and neither do the fake shadows
  wrapper.add(shadow);

  // Headlights and tail lights (the tail lights glow red when you brake, white when you reverse).
  car.tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1410, toneMapped: false });
  car.headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false });
  for (const sx of [-0.42, 0.42]) {
    const t = new THREE.Mesh(LIGHT_GEO, car.tailMat);
    t.position.set(sx, 0.55, -1.42);
    t.raycast = () => {};
    wrapper.add(t);
    const h = new THREE.Mesh(LIGHT_GEO, car.headMat);
    h.position.set(sx, 0.52, 1.42);
    h.raycast = () => {};
    wrapper.add(h);
  }

  wrapper.userData.gameCar = car;
  cars.add(car);
  return car;
}

// Free GPU memory for a car that has left the lot.
export function disposeCar(car) {
  clearMark(car);
  scene.remove(car.root);
  cars.delete(car);
  car.body.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  if (car.tailMat) { car.tailMat.dispose(); car.headMat.dispose(); }
  if (car.tag) {
    car.tag.material.map.dispose();
    car.tag.material.dispose();
  }
}

export function placeCar(car, x, z, yaw) {
  car.x = x; car.z = z; car.yaw = yaw;
  car.root.position.set(x, 0.04, z);
  car.root.rotation.y = yaw;
  scene.add(car.root);
}

// Early shifts use a single digit; two digits arrive from shift 3.
function newId() {
  const used = new Set([...cars].map((c) => c.id));
  if (G.shift <= 2) {
    const free = '123456789'.split('').filter((d) => !used.has(d));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
  }
  let id;
  do { id = String(Math.floor(10 + Math.random() * 90)); } while (used.has(id));
  return id;
}

// Quirks are introduced one at a time; the newest one shows up most.
function pickQuirk() {
  if (G.mode === 'rush') {                            // each shift lists which quirks may appear
    const list = rush.lv.quirks;
    if (!list.length || Math.random() >= 0.15 + rush.lv.diff * 0.04) return null;
    return list[Math.floor(Math.random() * list.length)];
  }
  const d = difficulty();
  if (d < 2) return null;
  if (Math.random() >= Math.min(0.5, 0.1 + d * 0.08)) return null;
  const avail = QUIRK_ORDER.slice(0, Math.min(QUIRK_ORDER.length, d - 1));
  const newest = avail[avail.length - 1];
  return Math.random() < 0.5 ? newest : avail[Math.floor(Math.random() * avail.length)];
}

export function makeRandomCar(withExtras = true) {
  const id = newId();

  // Avoid a parked car that looks identical (same model + colour).
  const parked = [...cars].filter((c) => c.parked);
  let file, colorIndex;
  const pool = paintPool();
  for (let t = 0; t < 40; t++) {
    file = MODEL_FILES[Math.floor(Math.random() * MODEL_FILES.length)];
    colorIndex = pool[Math.floor(Math.random() * pool.length)];
    if (!parked.some((c) => c.file === file && c.colorIndex === colorIndex)) break;
  }

  let quirk = null, vip = false, special = null;
  if (withExtras) {
    quirk = pickQuirk();
    const d = difficulty();
    if (G.mode === 'rush') {
      vip = Math.random() < rush.lv.vipRate;
      if (rush.vipNext > 0) { vip = true; rush.vipNext--; }
      if (!vip && !tutorial.on && rush.lv.diff >= 2 && Math.random() < Math.min(0.3, 0.05 + rush.lv.diff * 0.02)) {
        special = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)];
      }
    }
    else if (d >= 3 && Math.random() < Math.min(0.25, 0.06 + d * 0.03)) vip = true;
  }
  return makeCar(file, CAR_COLORS[colorIndex], id, colorIndex, quirk, vip, special);
}

export function seedCars(n = 2, showTags = true, reveal = 0) {
  const pool = shuffle(openSlots()).slice(0, n);
  for (const s of pool) {
    const car = makeRandomCar(false);
    car.parked = true;
    car.tag.visible = showTags;
    car.tagTimer = showTags ? reveal : 0;
    car.slot = s;
    s.car = car;
    placeCar(car, s.x, s.z, parkYaw(s));
  }
}

export function resetLot() {
  cancelPeek();
  for (const call of [...rush.calls]) endCall(call);
  rush.calls = [];
  rush.waiting = null;
  rush.inbound = null;
  rush.near = null;
  clearFigures();
  clearToken();
  clearFx();
  rush.nitro = 0;
  rush.boost = 0;
  for (const c of [...cars]) disposeCar(c);
  slots.forEach((s) => { s.car = null; });
  G.activeCar = null;
  G.pickupCar = null;
  ui.pickup.classList.remove('show');
}

// Parked cars show their tag while tagTimer / peekTimer run, fading out at the end.
export function updateTags(dt) {
  for (const c of cars) {
    if (!c.parked || !c.tag) continue;
    if (c.tagTimer > 0) c.tagTimer = Math.max(0, c.tagTimer - dt);
    if (c.peekTimer > 0) c.peekTimer = Math.max(0, c.peekTimer - dt);
    const t = Math.max(c.tagTimer, c.peekTimer);
    c.tag.visible = t > 0;
    c.tag.material.opacity = Math.min(1, t / 0.5);
  }
}

// Look at a parked car's tag during a pickup. Costs a little unless you own the Master Key.
export function peekCar(car) {
  if (G.phase !== 'pickup' || !car || !car.parked) return;
  if (!car.peeked) {
    car.peeked = true;
    if (!perks.peek) {
      G.score = Math.max(0, G.score - PEEK_COST);
      const s = worldToScreen(car.x, car.z, 1.5);
      popScore(`− $${PEEK_COST}`, s.x, s.y);
      updateHUD();
    }
  }
  car.peekTimer = PEEK_TIME;
  car.tag.visible = true;
  car.tag.material.opacity = 1;
}

export function quirkLine(car) {
  return car && car.quirk ? ` ${QUIRKS[car.quirk].icon} ${QUIRKS[car.quirk].name}: ${QUIRKS[car.quirk].tip}` : '';
}
