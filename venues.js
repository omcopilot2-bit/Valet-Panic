// Venues: every shift is set in a different place. A venue restyles the lighting, sky, lot surface and backdrop.
// The bay layout, lanes, rings and rival routes are shared by all venues (collisions and routes.js depend on them),
// so a venue is dressing around the same playfield. Tall pieces (towers, cranes, mountains) only show on tall / portrait screens,
// because the camera looks down at the lot; the low strip behind the top row, the lot surface and the lighting carry the look everywhere.
import * as THREE from 'three';
import { DOOR } from './config.js';
import { loader, renderer, scene } from './core.js';
import { addTextTexture, mat, rig, shell, surf } from './world.js';

/* ---------- theme table ---------- */
// lights = [hotel, warm, cool] point lights as [color, intensity]; asphalt.tex is a procedural surface (see lotTexture).
const VENUES = {
  1: { name: 'Nocturne Hotel', shell: true, bg: '#11293a', fog: ['#11293a', 0.011], exposure: 1.45, hemi: [0xb8dcf0, 0x30444e, 2.0], moon: [0xb2d5db, 2.4, [-12, 22, 12]],
    lights: [[0xeab96d, 38], [0xf3cb7a, 15], [0x57a5b1, 12]], ground: 0x0f2431, asphalt: { color: 0x35616f, rough: 0.45, metal: 0.12, tex: null } },
  2: { name: 'Seaside Resort', shell: false, bg: '#8fd6f2', fog: ['#bfe9f7', 0.005], exposure: 1.05, hemi: [0xffffff, 0xd9c79a, 2.3], moon: [0xfff0d0, 3.0, [-10, 24, 10]],
    lights: [[0xffffff, 0], [0xffffff, 0], [0xffffff, 0]], ground: 0xe3cf9c, asphalt: { color: 0xffffff, rough: 0.8, metal: 0, tex: 'paver' } },
  3: { name: 'Neon Strip Casino', shell: false, bg: '#3a1a64', fog: ['#3a1a64', 0.006], exposure: 1.6, hemi: [0xd4c4ff, 0x6a4a96, 2.6], moon: [0xc8b8ff, 2.6, [-12, 22, 12]],
    lights: [[0xff3da8, 40], [0x38e8ff, 22], [0xa060ff, 18]], ground: 0x3a2260, asphalt: { color: 0xffffff, rough: 0.3, metal: 0.3, tex: 'neon' } },
  4: { name: 'Building Site', shell: false, bg: '#e9a86a', fog: ['#d9a066', 0.009], exposure: 1.15, hemi: [0xffe3b8, 0x6a5030, 2.1], moon: [0xffc27a, 2.8, [14, 14, 10]],
    lights: [[0xffb060, 10], [0xffffff, 0], [0xffffff, 0]], ground: 0x8a7048, asphalt: { color: 0xffffff, rough: 0.95, metal: 0, tex: 'dirt' } },
  5: { name: 'Grand Opera House', shell: false, bg: '#2a4258', fog: ['#2a4258', 0.008], exposure: 1.5, hemi: [0xb4cadc, 0x3c5262, 2.3], moon: [0xc0d4e8, 2.6, [-12, 22, 12]],
    lights: [[0xffc27a, 34], [0xffd9a0, 18], [0x5aa0c0, 10]], ground: 0x23384a, asphalt: { color: 0xffffff, rough: 0.15, metal: 0.45, tex: 'wet' } },
  6: { name: 'Airport Terminal', shell: false, bg: '#a9c4d6', fog: ['#b6cddb', 0.007], exposure: 1.1, hemi: [0xeef6ff, 0x7d8790, 2.4], moon: [0xffffff, 2.4, [-10, 24, 12]],
    lights: [[0xffffff, 0], [0xffffff, 0], [0xffffff, 0]], ground: 0x6d767d, asphalt: { color: 0xffffff, rough: 0.7, metal: 0, tex: 'concrete' } },
  7: { name: 'Old Town Square', shell: false, bg: '#5a4060', fog: ['#5e4666', 0.008], exposure: 1.45, hemi: [0xffdcb8, 0x6a5050, 2.3], moon: [0xffd8aa, 2.6, [-12, 20, 12]],
    lights: [[0xffb060, 26], [0xffcf80, 20], [0xff8a60, 10]], ground: 0x5c4a42, asphalt: { color: 0xffffff, rough: 0.9, metal: 0, tex: 'cobble' } },
  8: { name: 'Red Carpet Gala', shell: false, bg: '#3e1420', fog: ['#3e1420', 0.008], exposure: 1.5, hemi: [0xffe4c4, 0x5a2430, 2.3], moon: [0xffe8c0, 2.6, [-12, 22, 12]],
    lights: [[0xffc860, 40], [0xff7a7a, 16], [0xffd890, 14]], ground: 0x3a1620, asphalt: { color: 0xffffff, rough: 0.3, metal: 0.2, tex: 'checker' } },
  9: { name: 'Alpine Lodge', shell: false, bg: '#3a5666', fog: ['#4a6676', 0.009], exposure: 1.5, hemi: [0xb4d0dc, 0x40584c, 2.3], moon: [0xc0d8e4, 2.6, [-12, 22, 12]],
    lights: [[0xffa860, 28], [0xffc080, 14], [0x4a7a8a, 10]], ground: 0x2c4236, asphalt: { color: 0xffffff, rough: 0.85, metal: 0, tex: 'gravel' } },
  10: { name: 'Skyline Rooftop', shell: true, bg: '#14224a', fog: ['#14224a', 0.007], exposure: 1.5, hemi: [0xbcd0ff, 0x34407a, 2.2], moon: [0xd0dcff, 2.6, [-12, 22, 12]],
    lights: [[0xeab96d, 40], [0xff9ad0, 16], [0x6aa8ff, 14]], ground: 0x1e2c60, asphalt: { color: 0xffffff, rough: 0.35, metal: 0.25, tex: 'rooftop' } },
};

export const venueName = (id) => (VENUES[id] || VENUES[1]).name;

/* ---------- state and helpers ---------- */
let root = null, cache = new Map(), tick = null, built = 0, lotTex = null, gTex = null, T = 0;
const commercialCache = new Map();

const pick = (a) => a[(Math.random() * a.length) | 0];

function reset() {
  if (root) {
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    root = null;
  }
  cache = new Map();
  tick = null;
}

// Cached materials (disposed with the venue).
const M = (color, rough = 0.7, metal = 0, ex) => {
  const k = `${color}|${rough}|${metal}|${ex ? JSON.stringify(ex) : ''}`;
  let m = cache.get(k);
  if (!m) { m = mat(color, rough, metal, ex); cache.set(k, m); }
  return m;
};
const E = (color, i = 1.4) => M(color, 0.4, 0, { emissive: color, emissiveIntensity: i });

const put = (o, x, y, z) => { o.position.set(x, y, z); root.add(o); return o; };

function box(x, y, z, w, h, d, mt, shadow = true) {
  const o = put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt), x, y, z);
  o.castShadow = shadow; o.receiveShadow = true;
  return o;
}
function cyl(x, y, z, rt, rb, h, mt, seg = 14) {
  const o = put(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mt), x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}
function cone(x, y, z, r, h, mt, seg = 10) {
  const o = put(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mt), x, y, z);
  o.castShadow = true;
  return o;
}
function ball(x, y, z, r, mt, sx = 1, sy = 1, sz = 1) {
  const o = put(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mt), x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}
function flatPlane(x, y, z, w, d, mt) {
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mt);
  o.rotation.x = -Math.PI / 2;
  o.receiveShadow = true;
  return put(o, x, y, z);
}
// A triangular prism roof. halfW = half the width of the base, height = ridge height, len = length of the ridge.
// The ridge runs along x, or along z when alongZ is set (a gable facing the street).
function roof(x, yb, z, halfW, height, len, mt, alongZ = false) {
  const r = halfW / 0.866;
  const g = new THREE.CylinderGeometry(r, r, len, 3);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  const o = new THREE.Mesh(g, mt);
  const sy = height / (1.5 * r);
  o.scale.y = sy;
  o.castShadow = true;
  if (alongZ) o.rotation.y = Math.PI / 2;
  return put(o, x, yb + 0.5 * r * sy, z);
}
function glow(x, y, z, size, color, op = 0.7) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  s.raycast = () => {};
  return put(s, x, y, z);
}
function sign(x, y, z, w, h, text, color, bg, border) {
  const cw = 1024, ch = Math.max(64, Math.round(1024 * h / w));
  const tex = addTextTexture([{ text, size: Math.round(ch * 0.52), font: 'Fredoka, Arial, sans-serif', weight: '700', color, y: ch / 2 + ch * 0.03 }], { width: cw, height: ch, bg, border });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
  m.raycast = () => {};
  return put(m, x, y, z);
}

function commercialBuilding(name, x, z, targetHeight, rotation = 0) {
  const addModel = (source) => {
    if (!root) return;
    const model = source.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) model.scale.multiplyScalar(targetHeight / size.y);
    model.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(model);
    const centre = fitted.getCenter(new THREE.Vector3());
    model.position.add(new THREE.Vector3(x - centre.x, -fitted.min.y, z - centre.z));
    model.rotation.y = rotation;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      o.raycast = () => {};
    });
    root.add(model);
  };

  if (commercialCache.has(name)) {
    addModel(commercialCache.get(name));
    return;
  }
  loader.load(`./assets/kenney-city-commercial/Models/GLB format/${name}`, (gltf) => {
    commercialCache.set(name, gltf.scene);
    addModel(gltf.scene);
  }, undefined, (error) => console.warn(`Commercial backdrop failed: ${name}`, error));
}
// A wall of windows painted on a canvas (cheap: one plane instead of hundreds of boxes). Faces +z (towards the camera).
function facade(x, y, z, w, h, cols, rows, { bg = '#101820', lit = '#ffd27a', p = 0.55, seed = 1 } = {}) {
  const can = document.createElement('canvas');
  can.width = 128;
  can.height = Math.max(64, Math.round(128 * h / w));
  const c = can.getContext('2d');
  c.fillStyle = bg;
  c.fillRect(0, 0, can.width, can.height);
  const cw = can.width / cols, ch = can.height / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const s = Math.sin((i * 12.9898 + j * 78.233 + seed * 37.7) * 43758.5453) * 43758.5453;
      const r = s - Math.floor(s);
      c.fillStyle = r < p ? lit : '#ffffff14';
      c.fillRect(i * cw + cw * 0.2, j * ch + ch * 0.2, cw * 0.6, ch * 0.58);
    }
  }
  const tex = new THREE.CanvasTexture(can);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.raycast = () => {};
  return put(m, x, y, z);
}
// The lobby door the guests walk to is at x 10.5: every venue puts a lit entrance there.
function entrance(zFront) {
  DOOR.z = zFront;   // guests walk to / from this door

  box(10.5, 1.25, zFront - 0.02, 2.1, 2.5, 0.12, M(0x0a0f12, 0.3, 0.5));
  box(10.5, 1.25, zFront + 0.03, 1.7, 2.1, 0.05, E(0xffc87a, 0.9), false);
  glow(10.5, 1.5, zFront + 0.8, 3.4, 0xffc87a, 0.55);
}
function lamp(x, z, h, color, size = 3) {
  cyl(x, h / 2, z, 0.05, 0.08, h, M(0x30383a, 0.4, 0.7), 8);
  box(x, h, z, 0.34, 0.2, 0.34, E(color, 2), false);
  glow(x, h, z, size, color, 0.7);
}
function palm(x, z, h = 4.2) {
  const t = cyl(x, h / 2, z, 0.12, 0.2, h, M(0x8a6a44, 0.9), 8);
  t.rotation.z = 0.05;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const l = ball(x + Math.cos(a) * 0.9, h - 0.25, z + Math.sin(a) * 0.9, 0.55, M(0x2f9a4a, 0.8), 2.0, 0.12, 0.6);
    l.rotation.y = -a;
  }
  ball(x, h, z, 0.2, M(0x5a3a22));
}
function pine(x, z, h = 4.5) {
  cyl(x, 0.3, z, 0.15, 0.2, 0.6, M(0x4a3020), 8);
  for (let i = 0; i < 3; i++) cone(x, 0.6 + h * 0.3 + i * h * 0.26, z, 1.25 - i * 0.28, h * 0.45, M(0x1f4a35, 0.9), 9);
}

function glowTexture() {
  const can = document.createElement('canvas');
  can.width = can.height = 64;
  const c = can.getContext('2d');
  const g = c.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, '#ffffffff');
  g.addColorStop(0.4, '#ffffff55');
  g.addColorStop(1, '#ffffff00');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- lot surfaces ---------- */
const PERIOD = { paver: 8, neon: 8, dirt: 10, wet: 10, concrete: 8, cobble: 8, checker: 16, gravel: 8, rooftop: 8 };

function lotTexture(kind) {
  const can = document.createElement('canvas');
  can.width = can.height = 256;
  const c = can.getContext('2d');
  let s = 20260;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const choose = (a) => a[(rnd() * a.length) | 0];
  const fill = (col) => { c.fillStyle = col; c.fillRect(0, 0, 256, 256); };
  const speck = (n, cols, sz = 2) => { for (let i = 0; i < n; i++) { c.fillStyle = choose(cols); c.fillRect(rnd() * 256, rnd() * 256, sz, sz); } };
  const grid = (step, col, w) => {
    c.strokeStyle = col; c.lineWidth = w; c.beginPath();
    for (let p = 0; p <= 256; p += step) { c.moveTo(p, 0); c.lineTo(p, 256); c.moveTo(0, p); c.lineTo(256, p); }
    c.stroke();
  };
  const blobs = (n, col, alpha, rmin, rmax) => {
    c.globalAlpha = alpha; c.fillStyle = col;
    for (let i = 0; i < n; i++) { c.beginPath(); c.ellipse(rnd() * 256, rnd() * 256, rmin + rnd() * (rmax - rmin), (rmin + rnd() * (rmax - rmin)) * 0.7, rnd() * 3, 0, 6.283); c.fill(); }
    c.globalAlpha = 1;
  };
  switch (kind) {
    case 'paver':
      fill('#9d8f78');
      for (let r = 0; r < 8; r++) for (let x = -64; x < 256; x += 64) { c.fillStyle = choose(['#d8cbb0', '#c9baa0', '#d2c4a8']); c.fillRect(x + (r % 2) * 32 + 1, r * 32 + 1, 62, 30); }
      break;
    case 'neon':
      fill('#4c4088'); speck(500, ['#5c4fa0', '#53478f'], 3); grid(64, '#ff3da840', 2); grid(128, '#38e8ff66', 3); speck(24, ['#ffffff'], 2);
      break;
    case 'dirt':
      fill('#8c7049'); speck(1200, ['#7c6240', '#9b7f55', '#6f5636'], 3);
      blobs(0, '#000', 0, 1, 2);
      c.globalAlpha = 0.35; c.fillStyle = '#5b4529'; c.fillRect(60, 0, 22, 256); c.fillRect(150, 0, 22, 256); c.globalAlpha = 1;
      blobs(3, '#6f8795', 0.5, 14, 26);
      break;
    case 'wet':
      fill('#4a5d6c'); speck(700, ['#566b7b', '#3e505d'], 2); blobs(14, '#8fb4cc', 0.1, 14, 34);
      break;
    case 'concrete':
      fill('#a2a9ae'); speck(700, ['#979ea3', '#adb4b9'], 2); grid(128, '#6f767b', 3);
      break;
    case 'cobble':
      fill('#6a5a4e');
      for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
        c.fillStyle = choose(['#8d7d6e', '#7c6c5f', '#9a8a7a', '#6e6054']);
        c.beginPath(); c.ellipse(x + (y / 32 % 2) * 16 + 16, y + 16, 14, 13, 0, 0, 6.283); c.fill();
      }
      break;
    case 'checker':
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? '#8a2438' : '#3a3a44'; c.fillRect(i * 32, j * 32, 32, 32); }
      grid(128, '#c9a24a', 4);
      break;
    case 'gravel':
      fill('#56676a'); speck(1600, ['#657678', '#4a5a5c', '#74868a', '#86989b'], 2); blobs(7, '#d4e2e6', 0.45, 20, 40);
      break;
    case 'rooftop':
      fill('#3c4e78'); speck(300, ['#475a88'], 3); grid(128, '#d4ae52', 4); grid(64, '#566a98', 1);
      break;
    default:
      fill('#3a4a50');
  }
  const t = new THREE.CanvasTexture(can);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(31 / PERIOD[kind], 22 / PERIOD[kind]);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- the venues ---------- */
function seaside() {
  box(0, -0.2, -34, 140, 0.1, 26, M(0x2db4d8, 0.15, 0.1), false);   // the sea, seen on tall screens
  box(0, 2.0, -12.6, 27, 4.0, 4.4, M(0xf6efe0, 0.6));
  facade(0, 2.7, -10.38, 26, 1.8, 13, 2, { bg: '#2a7090', lit: '#c8ecff', p: 0.85, seed: 2 });
  box(0, 4.15, -11.2, 28, 0.3, 6.0, M(0xffffff, 0.5));
  for (let k = 0, i = -13; i <= 13; i += 2, k++) box(i, 3.2, -9.7, 1.9, 0.1, 1.5, M(k % 2 ? 0x19b5c8 : 0xffffff, 0.7), false).rotation.x = 0.4;
  sign(0, 5.1, -8.3, 8, 1.3, 'SEASIDE RESORT', '#12a4c4', '#ffffff', '#12a4c4');
  for (const x of [-14.2, -6.2, 5.2, 14.2]) palm(x, -8.8);
  for (const [x, c] of [[-11, 0xff6b5e], [-1.5, 0xffc247], [2.5, 0x19b5c8]]) {
    cyl(x, 1.0, -9.4, 0.04, 0.04, 2, M(0xeeeeee, 0.5), 8);
    cone(x, 2.1, -9.4, 1.2, 0.5, M(c, 0.7), 12);
  }
  [0xff6b5e, 0xffc247, 0x5ee6a8, 0x6cc8ff].forEach((c, i) => { const b = box(-7.6 + i * 0.45, 1.1, -10.1, 0.3, 2.1, 0.08, M(c, 0.4)); b.rotation.z = 0.08 * (i - 1.5); });
  entrance(-10.36);
}

function casino() {
  const pink = E(0xff3da8, 1.6), cyan = E(0x38e8ff, 1.6);
  commercialBuilding('building-l.glb', -8.8, -16.8, 6.2, 0);
  commercialBuilding('building-m.glb', 1.0, -17.2, 6.6, 0);
  commercialBuilding('building-n.glb', 10.8, -16.8, 6.0, 0);
  box(0, 6.85, -9.95, 24.2, 0.14, 0.14, pink, false);
  box(0, 0.2, -9.95, 24.2, 0.14, 0.14, cyan, false);
  const lucky = sign(0, 7.6, -9.5, 8, 1.6, 'LUCKY 7', '#ffdf5a', '#1a0630', '#ff3da8');
  box(10.5, 3.0, -9.5, 3.4, 0.18, 1.4, cyan, false);
  entrance(-9.9);
  for (const x of [-14.6, -7, 7, 14.6]) lamp(x, -8.3, 3.4, x < 0 ? 0xff3da8 : 0x38e8ff, 3.4);
  for (let i = 0; i < 8; i++) {   // neon skyline on tall screens
    const x = -21 + i * 6, h = 10 + ((i * 37) % 9);
    box(x, h / 2, -17, 3.4, h, 2.4, M(0x0f0a20, 0.5, 0.2));
    facade(x, h / 2, -15.78, 3.2, h - 0.4, 5, Math.round(h / 1.6), { bg: '#0f0a20', lit: i % 2 ? '#38e8ff' : '#ff3da8', p: 0.4, seed: i });
    box(x, h + 0.1, -17, 3.5, 0.2, 2.5, i % 2 ? cyan : pink, false);
  }
  tick = () => {
    lucky.material.color.setScalar(Math.sin(T * 23) > 0.92 ? 0.55 : 1);
    pink.emissiveIntensity = 1.3 + 0.4 * Math.sin(T * 3);
    cyan.emissiveIntensity = 1.3 + 0.4 * Math.sin(T * 3 + 2);
  };
}

function buildingSite() {
  const conc = M(0xa5a59e, 0.9);
  for (let f = 0; f < 6; f++) {
    box(0, 0.2 + f * 2.4, -12, 15, 0.3, 4.4, M(0x8e8e88, 0.9));
    if (f < 5) for (const x of [-7, -3.5, 0, 3.5, 7]) for (const z of [-13.8, -10.4]) box(x, 1.4 + f * 2.4, z, 0.45, 2.4, 0.45, conc);
  }
  const net = new THREE.Mesh(new THREE.PlaneGeometry(15, 7.4), new THREE.MeshBasicMaterial({ color: 0x3fa34d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  net.raycast = () => {};
  put(net, 0, 3.8, -10.05);
  for (let k = 0, x = -14; x <= 14; x += 1.5, k++) {   // barrier blocks, with a gap at the site gate
    if (Math.abs(x - 10.5) < 1.3) continue;
    box(x, 0.45, -9.0, 1.3, 0.9, 0.35, M(k % 2 ? 0xff7a1a : 0xf4f4ee, 0.6));
  }
  box(-13.3, 1.2, -10.8, 4.6, 2.4, 2.2, M(0x2f6fb0, 0.6, 0.3));
  box(-13.3, 3.6, -10.8, 4.6, 2.4, 2.2, M(0xc0392b, 0.6, 0.3));
  box(13.8, 1.2, -11.2, 4.2, 2.4, 2.2, M(0xe0a020, 0.6, 0.3));
  box(10.5, 1.1, -10.4, 3, 2.2, 2, M(0xdcdcdc, 0.5));   // site office behind the gate
  entrance(-9.38);
  cone(-4.2, 0.8, -10.6, 1.7, 1.6, M(0x9a7e55, 1), 12);
  cone(-1.8, 0.55, -10.4, 1.2, 1.1, M(0x8a6f48, 1), 12);
  sign(-6.6, 1.7, -8.8, 3, 0.9, 'SLOW - WORKERS', '#161616', '#ffc400', '#161616');
  for (const x of [-14.6, 14.6]) {
    cyl(x, 2.0, -8.3, 0.06, 0.08, 4, M(0x30383a, 0.4, 0.7), 8);
    box(x, 4.1, -8.3, 0.9, 0.5, 0.2, E(0xfff2c8, 2), false);
    glow(x, 4.1, -8.3, 4, 0xfff2c8, 0.55);
  }
  // Tower crane (tall screens only). The jib swings slowly.
  box(13.5, 8.2, -15.5, 0.7, 16.4, 0.7, M(0xf2b01e, 0.5));
  const jib = new THREE.Group();
  jib.position.set(13.5, 16.8, -15.5);
  root.add(jib);
  const part = (x, y, w, h, d, mt) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt); o.position.set(x, y, 0); o.castShadow = true; jib.add(o); };
  part(-6, 0, 14, 0.45, 0.45, M(0xf2b01e, 0.5));
  part(3, 0, 5, 0.45, 0.45, M(0xf2b01e, 0.5));
  part(4.2, -0.6, 1.2, 0.9, 0.9, M(0x555555, 0.8));
  part(-10, -2.2, 0.06, 4, 0.06, M(0x222222, 0.8));
  part(-10, -4.4, 0.7, 0.5, 0.7, M(0xff7a1a, 0.6));
  tick = () => { jib.rotation.y = Math.sin(T * 0.18) * 0.3; };
}

function opera() {
  const stone = M(0xcfc8b6, 0.6), col = M(0xe3dccb, 0.5);
  box(0, 0.12, -9.1, 17, 0.24, 1.2, M(0x8d887c, 0.8));
  box(0, 0.36, -9.7, 15, 0.24, 1.2, M(0x8d887c, 0.8));
  commercialBuilding('building-h.glb', -7.2, -16.8, 6.0, 0);
  commercialBuilding('building-j.glb', 2.4, -17.2, 6.4, 0);
  commercialBuilding('building-i.glb', 11.0, -16.8, 5.8, 0);
  for (let x = -6; x <= 6; x += 2) cyl(x, 2.8, -9.4, 0.34, 0.4, 5.2, col);
  sign(0, 5.55, -8.35, 6, 0.6, 'GRAND OPERA', '#ffe08a', '#1b1b24', '#d6b674');
  ball(0, 7.4, -12.4, 3.2, M(0x3b7a6e, 0.35, 0.5), 1, 0.75, 1);
  entrance(-10.06);
  for (const x of [-14.2, -9.5, 9.5, 14.2]) lamp(x, -8.4, 3.2, 0xffc27a, 3.2);
}

function airport() {
  commercialBuilding('low-detail-building-wide-a.glb', -8.8, -16.8, 3.8, 0);
  commercialBuilding('low-detail-building-wide-b.glb', 1.2, -17.2, 4.1, 0);
  commercialBuilding('low-detail-building-wide-a.glb', 10.8, -16.8, 3.8, 0);
  box(0, 4.7, -9.6, 30, 0.3, 3.4, M(0xffffff, 0.35, 0.1));
  box(0, 4.5, -7.95, 30, 0.08, 0.08, M(0xffc247, 0.4), false);
  for (let x = -13; x <= 13; x += 4.33) cyl(x, 2.35, -8.1, 0.14, 0.14, 4.7, M(0xb8c2cc, 0.3, 0.7), 8);
  sign(0, 5.35, -8.0, 7, 1.1, 'DEPARTURES', '#ffd34a', '#0f2a3d', '#ffd34a');
  entrance(-10.08);
  cyl(-12.5, 5.5, -15, 0.9, 1.2, 11, M(0xdde3e8, 0.5));   // control tower and jet: visible on tall screens
  box(-12.5, 11.4, -15, 3, 1.5, 3, M(0x6fa8c8, 0.2, 0.6, { emissive: 0x335a70, emissiveIntensity: 0.5 }));
  const jet = new THREE.Group();
  jet.position.set(6, 1.5, -17.5);
  root.add(jet);
  const jm = (geo, mt, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = true; jet.add(o); return o; };
  const white = M(0xf4f6f8, 0.4, 0.2);
  jm(new THREE.CylinderGeometry(0.9, 0.9, 12, 14), white, 0, 0, 0, Math.PI / 2);
  jm(new THREE.ConeGeometry(0.9, 1.8, 14), white, 6.9, 0, 0, -Math.PI / 2);
  jm(new THREE.BoxGeometry(2.6, 0.12, 10.5), white, 0.5, -0.2, 0);
  jm(new THREE.BoxGeometry(1.4, 2.2, 0.12), M(0x1d6fb8, 0.4), -5.4, 1.3, 0);
  jm(new THREE.BoxGeometry(1.0, 0.1, 3.6), white, -5.4, 0.4, 0);
  for (const z of [-2.6, 2.6]) jm(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 12), M(0x9aa4ad, 0.3, 0.6), 1.2, -0.7, z, Math.PI / 2);
}

function oldTown() {
  const widths = [3.4, 3.0, 3.8, 3.2, 3.6, 3.0, 3.8, 3.4, 3.2, 3.6, 3.0, 3.4];
  const walls = [0xd9a07a, 0xc9d6c0, 0xe8c76b, 0xb97a6a, 0xa8b8d0, 0xe3b8a0];
  const shops = { 1: 'CAFE', 4: 'INN', 7: 'BAKERY', 10: 'BOOKS' };
  let x = -14.4;
  widths.forEach((w, i) => {
    const h = 3.6 + ((i * 7) % 5) * 0.35, cx = x + w / 2;
    box(cx, h / 2, -11.7, w, h, 4, M(walls[i % walls.length], 0.8));
    roof(cx, h, -11.7, w / 2 + 0.15, 1.3, 4.3, M(0x7a3b2e, 0.8), true);
    facade(cx, h / 2 + 0.3, -9.68, w - 0.5, h - 1.2, 2, 2, { bg: '#2a1d22', lit: '#ffd27a', p: 0.7, seed: i + 1 });
    if (shops[i]) {
      sign(cx, 2.5, -9.35, 1.8, 0.55, shops[i], '#fff3d6', '#5a2a22', '#d6b674');
      box(cx, 3.0, -9.3, w - 0.4, 0.08, 0.9, M(i % 2 ? 0xb8322a : 0xf4f4ee, 0.8), false).rotation.x = 0.35;
    }
    x += w;
  });
  entrance(-9.66);
  for (let i = 0; i < 24; i++) glow(-14 + i * 1.2, 3.8 - 0.45 * Math.sin(i / 23 * Math.PI * 3), -9.1, 0.9, 0xffd27a, 0.9);   // string lights
  for (const lx of [-14.6, -4, 4.5, 14.6]) lamp(lx, -8.2, 3.2, 0xffb868, 3);
}

function gala() {
  const gold = M(0xd6b674, 0.3, 0.7, { emissive: 0x5a431e, emissiveIntensity: 0.3 });
  box(0, 3.6, -12.4, 24, 7.2, 4.6, M(0x1c0c10, 0.4, 0.3));
  facade(0, 3.0, -10.08, 23, 4.4, 12, 2, { bg: '#2a0c12', lit: '#ffd890', p: 0.7, seed: 4 });
  for (const x of [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 13]) cyl(x, 3.2, -9.7, 0.28, 0.3, 6.4, gold);
  box(0, 6.4, -9.8, 24.4, 0.35, 0.6, gold);
  box(0, 0.25, -9.8, 24.4, 0.3, 0.6, gold);
  sign(0, 5.0, -9.6, 9, 1.7, 'THE GALA', '#ffe08a', '#2a0c12', '#d6b674');
  const carpet = M(0xa0122a, 0.9);
  flatPlane(0, 0.03, -8.5, 28, 1.4, carpet);
  box(0, 0.04, -7.78, 28, 0.03, 0.08, gold, false);
  box(0, 0.04, -9.22, 28, 0.03, 0.08, gold, false);
  for (let px = -13; px <= 13; px += 2.2) {
    if (Math.abs(px - 10.5) < 1.2) continue;
    cyl(px, 0.45, -7.75, 0.05, 0.05, 0.9, gold, 8);
    ball(px, 0.95, -7.75, 0.08, gold);
  }
  entrance(-10.06);
  for (const x of [-9, -3, 3, 9]) glow(x, 4.3, -9.4, 2.6, 0xffd890, 0.7);
  const beams = [];   // searchlights sweeping the sky
  for (const [bx, base] of [[-14.5, -0.25], [14.5, 0.25]]) {
    const g = new THREE.CylinderGeometry(0.15, 1.3, 26, 16, 1, true);
    g.translate(0, 13, 0);
    const o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    o.raycast = () => {};
    put(o, bx, 0.2, -9);
    o.userData.base = base;
    beams.push(o);
  }
  tick = () => beams.forEach((b, i) => { b.rotation.z = b.userData.base + Math.sin(T * 0.7 + i * 2) * 0.28; b.rotation.x = Math.sin(T * 0.5 + i) * 0.15; });
}

function lodge() {
  box(0, 2.0, -12.4, 20, 4.0, 4.4, M(0x5a3a22, 0.9));
  for (let j = 0; j < 7; j++) box(0, 0.3 + j * 0.55, -10.17, 20, 0.06, 0.08, M(0x3a2414, 0.9), false);
  facade(-4.5, 2.2, -10.14, 7, 1.7, 4, 1, { bg: '#241608', lit: '#ffb860', p: 1, seed: 3 });
  facade(3.5, 2.2, -10.14, 5, 1.7, 3, 1, { bg: '#241608', lit: '#ffb860', p: 1, seed: 8 });
  roof(0, 4.0, -12.4, 3.4, 2.4, 21, M(0x2c3a36, 0.9));
  box(-6, 6.3, -12.6, 1, 3, 1, M(0x6a6a66, 0.9));
  sign(-1, 3.5, -9.1, 4, 0.8, 'ALPINE LODGE', '#ffe3b0', '#3a2414', '#d6b674');
  entrance(-10.18);
  for (const [x, z, h] of [[-15, -9.5, 5], [-12.8, -9.8, 4.4], [13, -9.6, 4.6], [15.2, -9.3, 5.2], [-16.3, -4, 4.4], [16.3, -2, 4.6], [-16.3, 3, 4.8], [16.3, 4.5, 4.4]]) pine(x, z, h);
  for (const [x, r, h] of [[-12, 9, 11], [4, 11, 13], [18, 8, 10]]) {   // mountains on tall screens
    cone(x, h / 2, -28, r, h, M(0x7e8e98, 1), 7);
    cone(x, h - 1.4, -28, r * 0.28, 2.8, M(0xf2f6f8, 0.9), 7);
  }
  for (const lx of [-14.6, -5.5, 5.5, 14.6]) lamp(lx, -8.4, 3.0, 0xffa860, 3);
}

function finale() {
  const gold = 0xffd27a;
  for (let i = 0; i < 9; i++) {   // skyscrapers behind the hotel (tall screens)
    const x = -24 + i * 6, h = 14 + ((i * 53) % 13);
    box(x, h / 2, -27, 4.2, h, 3, M(0x0b1230, 0.4, 0.4));
    facade(x, h / 2, -25.48, 4, h - 0.6, 6, Math.round(h / 1.5), { bg: '#0b1230', lit: i % 3 ? '#ffd27a' : '#9ad0ff', p: 0.45, seed: i + 11 });
    if (i % 2 === 0) ball(x, h + 0.4, -27, 0.25, E(0xff4040, 2));
  }
  ball(-14, 19, -30, 2.6, E(0xdfe8ff, 1));   // the moon
  for (let x = -13; x <= 13; x += 1.3) glow(x, 4.3, -8.1, 0.8, gold, 0.8);   // festival lights along the canopy
  const fw = [];
  let nextFw = 0.5;
  tick = (dt) => {
    nextFw -= dt;
    if (nextFw <= 0 && fw.length < 60) {
      nextFw = 1.6 + Math.random() * 1.8;
      const cx = -14 + Math.random() * 28, cy = 12 + Math.random() * 6, col = pick([0xffd27a, 0xff7ad0, 0x7ad8ff, 0xa0ff9a]);
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: col, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.set(0.7, 0.7, 1);
        s.raycast = () => {};
        put(s, cx, cy, -22);
        fw.push({ s, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 1.6 });
      }
    }
    for (let i = fw.length - 1; i >= 0; i--) {
      const f = fw[i];
      f.life -= dt;
      if (f.life <= 0) { root.remove(f.s); f.s.material.dispose(); fw.splice(i, 1); continue; }
      f.vy -= 2 * dt;
      f.s.position.x += f.vx * dt;
      f.s.position.y += f.vy * dt;
      f.s.material.opacity = f.life / 1.6 * 0.9;
    }
  };
}

const BUILD = { 2: seaside, 3: casino, 4: buildingSite, 5: opera, 6: airport, 7: oldTown, 8: gala, 9: lodge, 10: finale };

/* ---------- public API ---------- */
// Sets the venue for a shift id (null / unknown = the Nocturne Hotel). Cheap when the venue does not change.
export function applyVenue(id = 1) {
  if (!rig.hemi || !surf.ground) return;
  const key = VENUES[id] ? id : 1;
  if (key === built) return;
  built = key;
  const v = VENUES[key];
  reset();
  scene.background.set(v.bg);
  scene.fog.color.set(v.fog[0]);
  scene.fog.density = v.fog[1];
  renderer.toneMappingExposure = v.exposure;
  rig.hemi.color.setHex(v.hemi[0]);
  rig.hemi.groundColor.setHex(v.hemi[1]);
  rig.hemi.intensity = v.hemi[2];
  rig.moon.color.setHex(v.moon[0]);
  rig.moon.intensity = v.moon[1];
  rig.moon.position.set(...v.moon[2]);
  [rig.hotel, rig.warm, rig.cool].forEach((l, i) => { l.color.setHex(v.lights[i][0]); l.intensity = v.lights[i][1]; });
  surf.ground.color.setHex(v.ground);
  const a = surf.asphalt, ap = v.asphalt;
  if (lotTex) { lotTex.dispose(); lotTex = null; }
  if (ap.tex) { lotTex = lotTexture(ap.tex); a.map = lotTex; a.color.setHex(0xffffff); } else { a.map = null; a.color.setHex(ap.color); }
  a.roughness = ap.rough;
  a.metalness = ap.metal;
  a.needsUpdate = true;
  shell.visible = !!v.shell;
  root = new THREE.Group();
  scene.add(root);
  if (gTex) gTex.dispose();
  gTex = glowTexture();
  T = 0;
  DOOR.z = -9.08;   // the hotel's door; the other venues' entrance() moves it
  if (BUILD[key]) BUILD[key]();
}

// Per-frame animation for the current venue (neon flicker, crane, searchlights, fireworks). Called while a shift runs.
export function updateVenue(dt) {
  if (!tick) return;
  T += dt;
  tick(dt);
}
