// Visual effects: dust, sparks, splashes, expanding rings, squash-and-settle animation.
import * as THREE from 'three';
import { reduceMotion } from './config.js';
import { scene } from './core.js';
import { cars } from './state.js';

const FX_MAX = 70;

const fxList = [];

const RING_GEO = new THREE.RingGeometry(0.88, 1, 48);

const FX_TEX = (() => {
  const can = document.createElement('canvas');
  can.width = can.height = 64;
  const c = can.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#ffffff88');
  g.addColorStop(1, '#ffffff00');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// A soft round sprite that drifts, grows and fades. o: color, size, life, vx / vy / vz, grow, opacity, add (additive glow).
export function puff(x, y, z, o = {}) {
  if (reduceMotion || fxList.length >= FX_MAX) return;
  const m = new THREE.SpriteMaterial({ map: FX_TEX, color: o.color ?? 0xcfd8dc, transparent: true, opacity: o.opacity ?? 0.5, depthWrite: false, toneMapped: false });
  if (o.add) m.blending = THREE.AdditiveBlending;
  const s = new THREE.Sprite(m);
  s.position.set(x, y, z);
  s.raycast = () => {};
  const size = o.size ?? 0.6;
  s.scale.setScalar(size);
  scene.add(s);
  fxList.push({ s, m, ring: false, life: o.life ?? 0.6, max: o.life ?? 0.6, vx: o.vx ?? 0, vy: o.vy ?? 0.5, vz: o.vz ?? 0, grow: o.grow ?? 1.6, size, op: o.opacity ?? 0.5 });
}

// An expanding ring on the ground (parks and hand-offs).
export function ringBurst(x, z, color = 0xffd34a) {
  if (reduceMotion || fxList.length >= FX_MAX) return;
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const s = new THREE.Mesh(RING_GEO, m);
  s.rotation.x = -Math.PI / 2;
  s.position.set(x, 0.1, z);
  s.raycast = () => {};
  s.scale.setScalar(0.6);
  scene.add(s);
  fxList.push({ s, m, ring: true, life: 0.55, max: 0.55, vx: 0, vy: 0, vz: 0, grow: 2.6, size: 0.6, op: 0.8 });
}

export function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.life -= dt;
    if (f.life <= 0) { scene.remove(f.s); f.m.dispose(); fxList.splice(i, 1); continue; }
    const t = 1 - f.life / f.max;
    f.s.position.x += f.vx * dt;
    f.s.position.y += f.vy * dt;
    f.s.position.z += f.vz * dt;
    f.s.scale.setScalar(f.ring ? f.size + f.grow * t : f.size * (1 + (f.grow - 1) * t));
    f.m.opacity = f.op * (1 - t);
  }
}

export function clearFx() {
  for (const f of fxList) { scene.remove(f.s); f.m.dispose(); }
  fxList.length = 0;
}

// Squash-and-settle after a crash or a park.
export function animateCars(dt) {
  for (const c of cars) {
    if (!(c.bump > 0)) continue;
    c.bump = reduceMotion ? 0 : Math.max(0, c.bump - dt);
    const b = c.bump / 0.25;
    c.root.scale.set(1 + b * 0.06, 1 - b * 0.08, 1 + b * 0.06);
  }
}
