// Static scene: lighting, forecourt, hotel, bays, props, and the circle colliders for props.
import * as THREE from 'three';

export { SLOT_POSITIONS } from './config.js';   // plain data lives in config.js so tests can load it without a DOM

/* ---------- small helpers ---------- */
export function mat(color, roughness = 0.7, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function box(parent, x, y, z, sx, sy, sz, material, cast = true, receive = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

function cylinder(parent, x, y, z, rTop, rBottom, h, material, segments = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function plane(parent, x, y, z, w, h, material, rotX = -Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.rotation.x = rotX;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function addTextTexture(lines, options = {}) {
  const w = options.width || 1024;
  const h = options.height || 256;
  const can = document.createElement('canvas');
  can.width = w;
  can.height = h;
  const c = can.getContext('2d');
  const draw = () => {
    c.fillStyle = options.bg || '#10201d';
    c.fillRect(0, 0, w, h);
    if (options.border) {
      c.strokeStyle = options.border;
      c.lineWidth = 4;
      c.strokeRect(10, 10, w - 20, h - 20);
    }
    lines.forEach((line, i) => {
      c.fillStyle = line.color || '#e5ca8d';
      c.font = `${line.weight || '500'} ${line.size || 70}px ${line.font || 'Georgia'}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(line.text, w / 2, line.y ?? h * (i === 0 ? 0.44 : 0.77));
    });
  };
  draw();
  const tex = new THREE.CanvasTexture(can);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Decals are drawn at import time, usually before the web font has loaded. Redraw them once it arrives.
  if (document.fonts && lines.some((l) => l.font && l.font.includes('Fredoka'))) {
    const spec = lines.find((l) => l.font && l.font.includes('Fredoka'));
    const face = `${spec.weight || '500'} 40px Fredoka`;
    if (!document.fonts.check(face)) document.fonts.load(face).then(() => { draw(); tex.needsUpdate = true; }).catch(() => {});
  }
  return tex;
}

function glowTexture(color = '#f4ce82') {
  const can = document.createElement('canvas');
  can.width = can.height = 128;
  const c = can.getContext('2d');
  const g = c.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, color + '99');
  g.addColorStop(0.18, color + '45');
  g.addColorStop(1, color + '00');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function billboard(parent, x, y, z, w, h, texture) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
  );
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const warmGlow = glowTexture('#f2bf69');

const materials = {
  asphalt: mat(0x35616f, 0.45, 0.12),
  concrete: mat(0x353a34, 0.72),
  trim: mat(0x9c8a67, 0.4, 0.65),
  green: mat(0x213a30, 0.85),
  goldLine: mat(0xcdb16f, 0.48, 0.35, { emissive: 0x5a431e, emissiveIntensity: 0.4 }),
  whiteLine: mat(0xc6cec0, 0.65, 0, { emissive: 0x444d42, emissiveIntensity: 0.15 }),
  bayLine: mat(0xc6cec0, 0.65, 0, { emissive: 0x444d42, emissiveIntensity: 0.15 }),   // bay outlines only (unlockable themes)
};

// Recolours every bay outline: { color, emissive, glow }.
export function setBayTheme(t) {
  materials.bayLine.color.setHex(t.color);
  materials.bayLine.emissive.setHex(t.emissive);
  materials.bayLine.emissiveIntensity = t.glow;
}

/* ---------- hooks for venues.js (each shift is set in a different place) ----------
   rig: the lights a venue recolours. surf: the lot and ground materials. shell: the Nocturne Hotel dressing
   (building, lamps, canopy, skyline) that other venues hide and replace with their own backdrop. */
export const rig = {};
export const surf = { asphalt: materials.asphalt, ground: null };
export const shell = new THREE.Group();

/* ---------- lighting ----------
   Point lights are the expensive part of PBR shading. The original scene had ~44;
   this one keeps 8 real point lights and fakes the rest with emissive meshes and glow sprites. */
export function initLights(scene) {
  rig.hemi = new THREE.HemisphereLight(0xb8dcf0, 0x20323c, 1.9);
  scene.add(rig.hemi);

  const moon = new THREE.DirectionalLight(0xb2d5db, 2.4);
  moon.position.set(-12, 22, 12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
  moon.shadow.bias = -0.0003;
  moon.shadow.normalBias = 0.025;
  scene.add(moon);
  rig.moon = moon;

  const hotel = new THREE.PointLight(0xeab96d, 38, 18, 1.8);
  rig.hotel = hotel;
  hotel.position.set(0, 6, -8.2);
  scene.add(hotel);
  const warm = new THREE.PointLight(0xf3cb7a, 15, 15, 1.8);
  warm.position.set(-8, 3, -3);
  scene.add(warm);
  rig.warm = warm;
  const cool = new THREE.PointLight(0x57a5b1, 12, 18, 2);
  rig.cool = cool;
  cool.position.set(9, 5, 2);
  scene.add(cool);
  return moon;
}

/* ---------- props ---------- */
function makePlanter(scene, x, z, size = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);
  box(group, 0, 0.18, 0, size, 0.36, size, materials.concrete);
  box(group, 0, 0.37, 0, size * 0.9, 0.08, size * 0.9, materials.trim, false);
  box(group, 0, 0.43, 0, size * 0.78, 0.08, size * 0.78, mat(0x171e17, 0.95), false);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    const r = 0.1 + (i % 3) * 0.09;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + (i % 2) * 0.08, 1), materials.green);
    bush.position.set(Math.cos(a) * r, 0.7 + (i % 3) * 0.07, Math.sin(a) * r);
    bush.scale.set(1, 0.8, 1);
    bush.castShadow = true;
    group.add(bush);
  }
}

function makeLamp(scene, x, z, height = 5, withLight = true) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  const metal = mat(0x303b37, 0.3, 0.75);
  cylinder(g, 0, height / 2, 0, 0.055, 0.085, height, metal, 10);
  box(g, 0.42, height, 0, 0.95, 0.12, 0.42, metal);
  box(g, 0.42, height - 0.12, 0, 0.58, 0.05, 0.25, mat(0xe9c176, 0.24, 0.15, { emissive: 0xffc467, emissiveIntensity: 2 }));
  if (withLight) {
    const p = new THREE.PointLight(0xffca7b, 23, 9, 2);
    p.position.set(0.42, height - 0.2, 0);
    g.add(p);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: warmGlow, color: 0xffd18e, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.position.set(0.42, height - 0.18, 0);
  s.scale.set(3.3, 3.3, 1);
  g.add(s);
}

function makeBuilding(scene) {
  const g = new THREE.Group();
  scene.add(g);
  g.position.set(0, 0, -12);
  const stone = mat(0x303832, 0.4, 0.22);
  const roof = mat(0x1d2925, 0.42, 0.5);
  const black = mat(0x101918, 0.18, 0.45);
  const gold = mat(0xd6b674, 0.3, 0.7, { emissive: 0x745a2c, emissiveIntensity: 0.32 });
  const glassA = mat(0x17221f, 0.13, 0.55, { emissive: 0x1a2925, emissiveIntensity: 0.45 });
  const glassB = mat(0x233935, 0.2, 0.5, { emissive: 0x715c39, emissiveIntensity: 0.16 });

  box(g, 0, 1.85, 0, 25, 3.7, 5.8, stone);
  box(g, 0, 3.9, 0, 25.6, 0.42, 6.4, roof);
  box(g, 0, 2.1, 3.02, 25.1, 0.19, 0.16, gold);
  box(g, 0, 0.16, 2.98, 25, 0.32, 0.2, roof);
  for (let x = -10.5; x <= 10.5; x += 3) {
    box(g, x, 2, 2.92, 2.18, 2.65, 0.08, black, false);
    box(g, x - 1.09, 2, 3, 0.06, 2.78, 0.12, gold, false);
    box(g, x + 1.09, 2, 3, 0.06, 2.78, 0.12, gold, false);
    box(g, x, 2, 0.2, 2.12, 2.7, 0.06, glassA, false);
    box(g, x, 2.08, 0.24, 1.95, 2.48, 0.05, glassB, false);
    box(g, x, 2, 3.08, 0.045, 2.63, 0.12, gold, false);
  }
  for (const x of [-8.2, -6.9, 6.9, 8.2]) {
    cylinder(g, x, 2.1, 3.7, 0.19, 0.22, 4.15, gold, 16);
    cylinder(g, x, 4.25, 3.7, 0.33, 0.33, 0.12, roof, 16);
    cylinder(g, x, 0.07, 3.7, 0.34, 0.34, 0.13, roof, 16);
  }
  box(g, 0, 3.1, 3.55, 13.8, 0.38, 1.1, roof);
  box(g, 0, 3.32, 4.05, 13.2, 0.09, 0.14, gold);

  const marqueeTex = addTextTexture([
    { text: 'NOCTURNE', size: 104, weight: '600', font: 'Georgia', y: 108 },
    { text: 'HOTEL  ·  ROOFTOP', size: 29, font: 'Arial', weight: '500', y: 191, color: '#dfc98f' },
  ], { width: 1200, height: 240, bg: '#111b18', border: '#907449' });
  billboard(g, 0, 5.1, 3.36, 9.5, 1.9, marqueeTex);

  for (let i = -4; i <= 4; i += 2) {
    if (i === -2 || i === 2) {
      const p = new THREE.PointLight(0xffc568, 12, 7, 2);
      p.position.set(i, 3.5, 4.5);
      g.add(p);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: warmGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.65,
    }));
    s.position.set(i, 3.5, 4.35);
    s.scale.set(3.5, 3.5, 1);
    g.add(s);
  }
}

function makeBay(scene, slot) {
  const g = new THREE.Group();
  g.position.set(slot.x, 0, slot.z);
  scene.add(g);
  const line = materials.bayLine;
  const len = 4.55, w = 3.5, th = 0.075;
  box(g, -w / 2, 0.035, 0, th, 0.04, len, line, false);
  box(g, w / 2, 0.035, 0, th, 0.04, len, line, false);
  box(g, 0, 0.035, -len / 2, w, 0.04, th, line, false);

  const numberTex = addTextTexture(
    [{ text: String(slot.id).padStart(2, '0'), size: 156, font: 'Georgia', color: '#c9b47d', y: 133 }],
    { width: 256, height: 256, bg: '#17221e' },
  );
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.05),
    new THREE.MeshBasicMaterial({ map: numberTex, toneMapped: false }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(0, 0.024, 1.58);
  g.add(decal);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.52, 1.7, 64),
    new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.075;
  g.add(halo);
  slot.glow = halo;
  slot.group = g;
}

/* ---------- world ---------- */
// Returns an array of {x, z, r} circle colliders for solid props.
export function buildWorld(scene, slots) {
  const colliders = [];

  surf.ground = mat(0x0f2431, 0.95);
  plane(scene, 0, -0.28, -1, 52, 42, surf.ground);
  scene.add(shell);
  plane(scene, 0, -0.12, -1, 31, 22, materials.asphalt);
  const curb = mat(0x51534a, 0.75);
  const edge = mat(0xc7ac70, 0.42, 0.45);
  box(scene, 0, 0.03, -12.15, 30, 0.26, 0.42, curb);
  box(scene, 0, 0.18, -11.92, 29.6, 0.08, 0.16, edge);
  box(scene, 0, 0.05, 9.7, 31, 0.18, 0.42, curb);
  box(scene, -15, 0.05, -1.2, 0.4, 0.18, 22, curb);
  box(scene, 15, 0.05, -1.2, 0.4, 0.18, 22, curb);

  // wet-look portico, drive lane and painted arrival markings
  plane(scene, -11.4, -0.035, 3.8, 5.3, 4.1, mat(0x252c27, 0.24, 0.38));
  for (let z = -7; z < 8; z += 2.4) box(scene, -11.4, 0.012, z, 0.09, 0.018, 1.12, materials.goldLine, false);
  for (let z = -8; z < 8; z += 0.9) {
    box(scene, -13.6, 0.014, z, 0.08, 0.02, 0.38, materials.whiteLine, false);
    box(scene, -9.2, 0.014, z, 0.08, 0.02, 0.38, materials.whiteLine, false);
  }
  box(scene, -11.4, 0.025, -7.8, 4.7, 0.04, 0.12, materials.goldLine, false);
  box(scene, -11.4, 0.025, 8, 4.7, 0.04, 0.12, materials.goldLine, false);

  // reflection strips on the wet asphalt
  const reflect = mat(0x71847c, 0.16, 0.7, { transparent: true, opacity: 0.2 });
  for (let i = 0; i < 23; i++) {
    const x = -13.7 + ((i * 37) % 274) / 10;
    const z = -8.8 + ((i * 19) % 163) / 10;
    const r = box(scene, x, -0.015, z, 0.24 + (i % 4) * 0.1, 0.008, 0.05, reflect, false, false);
    r.rotation.y = ((i * 17) % 90) * Math.PI / 180;
  }

  makeBuilding(shell);
  slots.forEach((s) => makeBay(scene, s));

  // Only three lamps carry a real light; the rest are emissive + glow sprite.
  for (let x = -14; x <= 14; x += 7) makeLamp(shell, x, -8.5, 4.4, x % 14 === 0);

  // Planters are solid.
  for (const z of [-2.3, 4.2]) {
    for (const x of [-13.55, 13.55]) {
      makePlanter(scene, x, z, 1.6);
      colliders.push({ x, z, r: 1.15, halfX: 0.8, halfZ: 0.8, kind: 'planter' });
    }
  }

  // Bollards line the outer lanes, leaving the end of the cross-lane open for cars exiting the back row.
  for (let z = -7; z <= -3.8; z += 1.6) {
    for (const x of [-12.3, 12.3]) {
      cylinder(scene, x, 0.42, z, 0.16, 0.2, 0.84, materials.trim, 16);
      cylinder(scene, x, 0.85, z, 0.22, 0.22, 0.08, materials.goldLine, 16);
      colliders.push({ x, z, r: 0.26, kind: 'bollard' });
    }
  }

  // low canopy slab behind the top row (emissive tips instead of point lights)
  const canopy = mat(0x18231f, 0.26, 0.58);
  box(shell, 0, 0.08, -9.45, 14, 0.18, 5.2, canopy);
  box(shell, 0, 0.2, -6.83, 14.25, 0.1, 0.2, materials.goldLine);
  const tip = mat(0xf4c977, 0.3, 0, { emissive: 0xf4c977, emissiveIntensity: 1.6 });
  for (const x of [-6.5, -4.3, 4.3, 6.5]) {
    box(shell, x, 1.5, -7.1, 0.13, 3, 0.13, materials.trim);
    box(shell, x, 3.05, -7.1, 0.22, 0.12, 0.22, tip, false, false);
  }

  // city silhouettes with lit windows (no per-building lights)
  const cityMat = mat(0x18231f, 0.75, 0.18);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0xc5a163, emissive: 0xf4c879, emissiveIntensity: 0.55 });
  for (let i = 0; i < 24; i++) {
    const x = -28 + i * 2.45;
    const ht = 3 + (Math.sin(i * 8.31) + 1) * 3.8;
    const w = 1.5 + (i % 3) * 0.35;
    box(shell, x, ht / 2, -20, w, ht, 1.5, cityMat, false);
    for (let fy = 0.8; fy < ht - 0.3; fy += 0.95) {
      for (let fx = -w / 2 + 0.3; fx < w / 2 - 0.18; fx += 0.48) {
        if ((i * 3 + Math.round(fy * 4) + Math.round(fx * 7)) % 3 === 0) continue;
        box(shell, x + fx, fy, -19.22, 0.16, 0.28, 0.035, windowMat, false, false);
      }
    }
  }

  // arrival arrows
  const arrow = mat(0xe6c27c, 0.35, 0.3, { emissive: 0x95713b, emissiveIntensity: 0.7 });
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 3), arrow);
    a.rotation.z = -Math.PI / 2;
    a.position.set(-8.7, 0.12, 2 + i * 0.9);
    scene.add(a);
  }

  return colliders;
}
