// People (valet, guests, rival, doorman, dog), the drop-off / pick-up rings and the guide arrow.
import * as THREE from 'three';
import { CAR_BODY_OFFSETS, CAR_BODY_RADIUS, circleVsCollider, circleVsParkingBox, separationNormal } from './collision.js';
import { SHADOW_GEO, SHADOW_MAT } from './cars.js';
import { arrivalPath, BOUNDS, BUILDING_MIN_Z, DROPOFF, HANDOFF, HATS, OUTFITS, PARKED_HALF, SPAWN, WALK_Z } from './config.js';
import { scene } from './core.js';
import { equippedItem } from './progress.js';
import { cars, G, rush, slots } from './state.js';
import { addTextTexture } from './world.js';

const SKIN_TONES = [0xf1c8a0, 0xd9a273, 0xb07a52, 0x8a5a3c, 0x5d3a26];

const HAIR_TONES = [0x1c1410, 0x3a2416, 0x6b4a2a, 0xb08a4a, 0x8c8c90, 0x7a2a1e];

const COAT_TONES = [0x6e3b4a, 0x2f4f6e, 0x7a6a3c, 0x3d5b4a, 0x58406e, 0x8a4a3a, 0x30343a, 0xc2b8a2];

const PANT_TONES = [0x20262c, 0x3a3328, 0x2b3a4a, 0x4a4a4a];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Geometry and materials are shared by every figure, so removing a figure never disposes anything.
const FIG = {
  head: new THREE.SphereGeometry(0.15, 16, 12),
  hair: new THREE.SphereGeometry(0.162, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
  torso: new THREE.CapsuleGeometry(0.15, 0.2, 4, 12),
  arm: new THREE.CapsuleGeometry(0.045, 0.22, 4, 8),
  leg: new THREE.CapsuleGeometry(0.065, 0.24, 4, 8),
  hand: new THREE.SphereGeometry(0.05, 8, 6),
  shoe: new THREE.BoxGeometry(0.12, 0.06, 0.2),
  skirt: new THREE.CylinderGeometry(0.15, 0.23, 0.26, 14),
  capTop: new THREE.CylinderGeometry(0.15, 0.17, 0.09, 16),
  capBand: new THREE.CylinderGeometry(0.172, 0.172, 0.025, 16),
  brim: new THREE.BoxGeometry(0.2, 0.025, 0.13),
  hatBrim: new THREE.CylinderGeometry(0.26, 0.26, 0.02, 20),
  hatCrown: new THREE.CylinderGeometry(0.14, 0.16, 0.12, 16),
  belt: new THREE.BoxGeometry(0.36, 0.045, 0.25),
  button: new THREE.SphereGeometry(0.025, 8, 6),
  bag: new THREE.BoxGeometry(0.1, 0.24, 0.3),
  hatBrimS: new THREE.CylinderGeometry(0.2, 0.2, 0.02, 18),
  topCrown: new THREE.CylinderGeometry(0.12, 0.13, 0.2, 16),
  beret: new THREE.SphereGeometry(0.19, 14, 8),
  crownBase: new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16),
  spike: new THREE.ConeGeometry(0.035, 0.09, 6),
  dogBody: new THREE.BoxGeometry(0.16, 0.14, 0.34),
  dogHead: new THREE.BoxGeometry(0.12, 0.11, 0.13),
  dogTail: new THREE.BoxGeometry(0.03, 0.03, 0.14),
  dogLeg: new THREE.BoxGeometry(0.04, 0.14, 0.04),
};

const figMats = new Map();

const figMat = (hex) => {
  let m = figMats.get(hex);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }); figMats.set(hex, m); }
  return m;
};

// A small procedural dog (same pose interface as a person: legs swing when it walks).
function makeDog() {
  const fur = pick([0x8a5a3c, 0xd9c7a0, 0x3a2a20, 0xb07a52]);
  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);
  const add = (geo, x, y, z, parent = upper) => {
    const m = new THREE.Mesh(geo, figMat(fur));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.raycast = () => {};
    parent.add(m);
    return m;
  };
  add(FIG.dogBody, 0, 0.2, 0);
  add(FIG.dogHead, 0, 0.3, 0.2);
  add(FIG.dogTail, 0, 0.27, -0.2).rotation.x = -0.6;
  const legF = new THREE.Group();
  legF.position.set(0, 0.16, 0.1);
  add(FIG.dogLeg, -0.05, -0.08, 0, legF);
  add(FIG.dogLeg, 0.05, -0.08, 0, legF);
  const legB = new THREE.Group();
  legB.position.set(0, 0.16, -0.1);
  add(FIG.dogLeg, -0.05, -0.08, 0, legB);
  add(FIG.dogLeg, 0.05, -0.08, 0, legB);
  root.add(legF, legB);
  return { role: 'dog', root, upper, legL: legF, legR: legB, armL: new THREE.Group(), armR: new THREE.Group(), bag: null };
}

const figures = new Set();

let valetFig = null;

function makePerson(role) {
  if (role === 'dog') return makeDog();
  const valet = role === 'valet' || role === 'rival' || role === 'doorman';
  const skin = pick(SKIN_TONES);
  const outfit = !valet ? null : role === 'rival' ? { coat: 0x1f3a7a, trim: 0xc0d4ff } : role === 'doorman' ? { coat: 0x24262b, trim: 0xd6b674 } : equippedItem('outfit', OUTFITS);
  const coat = valet ? outfit.coat : pick(COAT_TONES);          // valet: the equipped uniform (default Nocturne burgundy)
  const dress = !valet && Math.random() < 0.3;
  const pants = valet ? 0x14181a : pick(PANT_TONES);

  const root = new THREE.Group();
  const upper = new THREE.Group();   // everything above the hips (leans when running, bobs when walking)
  root.add(upper);

  const mk = (geo, color, x, y, z, parent = upper) => {
    const m = new THREE.Mesh(geo, figMat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.raycast = () => {};
    parent.add(m);
    return m;
  };
  const limb = (geo, color, x, y, len, handColor) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    mk(geo, color, 0, -len / 2, 0, pivot);
    if (handColor !== undefined) mk(FIG.hand, handColor, 0, -len - 0.02, 0, pivot);
    return pivot;
  };

  // legs (pivot at the hip), shoes
  const legColor = dress ? skin : pants;
  const legL = limb(FIG.leg, legColor, -0.075, 0.4, 0.4);
  const legR = limb(FIG.leg, legColor, 0.075, 0.4, 0.4);
  mk(FIG.shoe, 0x101010, 0, -0.37, 0.04, legL);
  mk(FIG.shoe, 0x101010, 0, -0.37, 0.04, legR);
  root.add(legL, legR);
  if (dress) mk(FIG.skirt, coat, 0, 0.36, 0, root);

  // torso, arms, head
  const torso = mk(FIG.torso, coat, 0, 0.62, 0);
  torso.scale.set(1.15, 1, 0.8);
  const armL = limb(FIG.arm, coat, -0.2, 0.8, 0.33, skin);
  const armR = limb(FIG.arm, coat, 0.2, 0.8, 0.33, skin);
  upper.add(armL, armR);
  mk(FIG.head, skin, 0, 1.0, 0);

  let bag = null;
  if (valet) {
    mk(FIG.belt, outfit.trim, 0, 0.45, 0);                                   // gold belt
    mk(FIG.button, outfit.trim, -0.05, 0.62, 0.125);                         // gold buttons
    mk(FIG.button, outfit.trim, 0.05, 0.62, 0.125);
    mk(FIG.button, outfit.trim, -0.05, 0.72, 0.115);
    mk(FIG.button, outfit.trim, 0.05, 0.72, 0.115);
    const hat = role === 'valet' ? equippedItem('hat', HATS).id : 'cap';
    if (hat === 'tophat') {
      mk(FIG.hatBrimS, 0x14181a, 0, 1.1, 0);
      mk(FIG.topCrown, 0x14181a, 0, 1.21, 0);
    } else if (hat === 'beret') {
      const b = mk(FIG.beret, outfit.coat, 0.03, 1.12, 0);
      b.scale.set(1, 0.45, 1);
    } else if (hat === 'crown') {
      mk(FIG.crownBase, 0xffd34a, 0, 1.13, 0);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        mk(FIG.spike, 0xffd34a, Math.cos(a) * 0.13, 1.21, Math.sin(a) * 0.13);
      }
    } else {
      mk(FIG.capTop, outfit.coat, 0, 1.13, 0);                                 // peaked valet cap
      mk(FIG.capBand, outfit.trim, 0, 1.095, 0);
      mk(FIG.brim, 0x14181a, 0, 1.085, 0.14);
    }
  } else {
    if (Math.random() < 0.3) {                                            // hat
      mk(FIG.hatBrim, 0x22262a, 0, 1.1, 0);
      mk(FIG.hatCrown, 0x22262a, 0, 1.17, 0);
    } else {
      mk(FIG.hair, pick(HAIR_TONES), 0, 1.01, -0.01);
    }
    if (Math.random() < 0.4) {                                            // carrying a bag
      bag = new THREE.Mesh(FIG.bag, figMat(pick([0x4a3426, 0x2a2f3a, 0x8a6a3a])));
      bag.position.set(0, -0.46, 0);
      bag.castShadow = true;
      bag.raycast = () => {};
      armL.add(bag);
    }
  }

  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);                  // blob shadow, like the cars
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.scale.set(0.26, 0.26, 1);
  shadow.raycast = () => {};
  root.add(shadow);

  return { role, root, upper, legL, legR, armL, armR, bag };
}

export function spawnFigure(role, x, z, yaw = 0) {
  const f = makePerson(role);
  Object.assign(f, {
    anim: 'idle', moveAnim: 'walk', after: 'idle', t: Math.random() * 6, yaw,
    path: null, speed: 0, onDone: null, delay: 0, life: null, poof: null, popIn: 0,
    px: x, pz: z, vs: 0, gait: 0, amp: 0, leanS: 0, blockT: 0, noCollide: false, buildingRoute: false,   // measured speed + gait phase, obstacle bookkeeping
    r: role === 'dog' ? 0.22 : 0.3,
  });
  f.root.position.set(x, 0.02, z);
  f.root.rotation.y = yaw;
  f.root.scale.setScalar(0.001);
  scene.add(f.root);
  figures.add(f);
  return f;
}

function setAnim(f, anim) { f.anim = anim; }

export function walkTo(f, path, speed, onDone, anim = 'walk') {
  f.path = path.map((p) => [p[0], p[1]]);
  f.buildingRoute = (f.role === 'guest' || f.role === 'dog') && (onDone === enterBuilding || path.some((point) => point[1] < BOUNDS.minZ));
  f.speed = speed;
  f.onDone = onDone || null;
  f.moveAnim = anim;
  if (!(f.delay > 0)) f.anim = anim;
}

export function poof(f) { if (f && f.poof === null) f.poof = 0.25; }

export function removeFigure(f) {
  if (!f) return;
  scene.remove(f.root);
  figures.delete(f);
  if (valetFig === f) valetFig = null;
}

export function clearFigures() {
  for (const f of [...figures]) removeFigure(f);
  valetFig = null;
}

// Limbs follow the real ground speed: the stride phase advances with the distance covered (no foot sliding),
// the swing eases in and out instead of snapping between idle / walk / run.
function posePerson(f, dt) {
  const v = f.vs;
  const target = Math.min(1.15, v * 0.22) * (v > 0.12 ? 1 : 0);
  f.amp += (target - f.amp) * Math.min(1, dt * 12);
  f.gait += v * dt * 2.9;
  const lean = Math.max(0, Math.min(1, (v - 3.5) / 1.5)) * 0.28;
  f.leanS += (lean - f.leanS) * Math.min(1, dt * 8);
  const sw = Math.sin(f.gait);
  const amp = f.amp;
  const bob = f.amp > 0.05 ? Math.abs(sw) * 0.03 * Math.min(1, amp / 0.7) : Math.sin(f.t * 2.2) * 0.006;
  f.legL.rotation.x = sw * amp;
  f.legR.rotation.x = -sw * amp;
  f.armL.rotation.x = -sw * amp * 0.9;
  f.armR.rotation.x = sw * amp * 0.9;
  f.armL.rotation.z = -0.06;
  f.armR.rotation.z = 0.06;
  if (f.anim === 'wave' && amp < 0.2) {
    f.armR.rotation.x = 0;
    f.armR.rotation.z = 2.5 + Math.sin(f.t * 11) * 0.28;
  }
  if (f.bag && v < 4) f.armL.rotation.x = -sw * amp * 0.3;     // a heavy bag swings less
  f.upper.rotation.x = f.leanS;
  f.upper.position.y = bob;
}

// Pushes a point (a walker) out of everything solid: props, closed bays, parked and moving cars.
// Returns true when it had to move. `skip` is a car to ignore (the one being boarded).
export function pushFromObstacles(p, r, skip = null) {
  let moved = false;
  const out = (dx, dz, d, min, seed = 'obstacle') => {
    const [nx, nz] = separationNormal(dx, dz, seed);
    p.x += nx * (min - d); p.z += nz * (min - d); moved = true;
  };
  for (const c of G.colliders) {
    if (c.disabled) continue;
    const hit = circleVsCollider(p.x, p.z, r, c, c.kind || 'prop');
    if (hit) { p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth; moved = true; }
  }
  for (const s of slots) {
    if (!s.closed && !(s.car && s.car !== skip)) continue;
    const hit = circleVsParkingBox(p.x, p.z, r, s, PARKED_HALF.x, PARKED_HALF.z);
    if (hit) { p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth; moved = true; }
  }
  for (const c of cars) {
    if (c === skip) continue;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      for (const off of CAR_BODY_OFFSETS) {
        const dx = p.x - (c.x + fx * off), dz = p.z - (c.z + fz * off), d = Math.hypot(dx, dz), min = r + CAR_BODY_RADIUS;
        if (d < min) out(dx, dz, d, min, `${c.id}:${p.role || 'walker'}`);
    }
  }
  return moved;
}

// Live positions of the people the valet and the rival must not walk through.
export function otherPeople(except) {
  const list = [];
  for (const f of figures) {
    if (f === except || f.poof !== null || f.popIn < 0.1) continue;
    if (f.role === 'valet' || f.role === 'rival' || f.role === 'guest' || f.role === 'doorman' || f.role === 'dog') {
      list.push({ x: f.root.position.x, z: f.root.position.z, r: f.r, fig: f });
    }
  }
  return list;
}

// Two walkers never overlap: the one that is not in charge of its own movement gives way.
export function pushFromPeople(p, r, except, passThroughCrowd = false) {
  let moved = false;
  for (const o of otherPeople(except)) {
    // Walking guests / dogs on a building route may overlap each other: the door is one body wide, and two guests pushing each
    // other head-on (one going in, one coming out) used to deadlock the whole queue.
    if (passThroughCrowd && (o.fig?.role === 'guest' || o.fig?.role === 'dog')) continue;
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = r + o.r;
    if (d < min) {
      const [nx, nz] = separationNormal(dx, dz, `${except?.role || p.role || 'walker'}:${o.fig?.role || 'person'}`);
      p.x += nx * (min - d); p.z += nz * (min - d); moved = true;
    }
  }
  return moved;
}

function clearWalkerStep(f, x, z) {
  // The hotel doors sit behind the lot's driving boundary. Let guest routes cross that threshold;
  // keeping the lot bound here strands every arriving/departing guest just outside the building.
  const minZ = f.buildingRoute ? BUILDING_MIN_Z : BOUNDS.minZ;
  if (x < BOUNDS.minX + f.r || x > BOUNDS.maxX - f.r || z < minZ || z > BOUNDS.maxZ - f.r) return false;
  if (f.noCollide) return true;
  // Guests heading for the lobby: once they reach the sidewalk strip behind the bays (and the door steps) nothing on the lot blocks them.
  // Angled and staggered bays used to reach into this strip and trap them just short of the door.
  if (!(f.buildingRoute && z < WALK_Z + 0.55)) {
    const probe = { x, z };
    pushFromObstacles(probe, f.r);
    if (Math.hypot(probe.x - x, probe.z - z) > 0.025) return false;
  }
  for (const o of otherPeople(f)) {
    if (o.fig?.role !== 'valet' && o.fig?.role !== 'rival') continue;
    if (Math.hypot(x - o.x, z - o.z) < f.r + o.r + 0.04) return false;
  }
  return true;
}

// A walker goes in through the lobby door: removed once it is behind the facade (never shrunk or faded in plain view).
export const enterBuilding = (f) => removeFigure(f);

export function updateFigures(dt) {
  // Crowd separation is applied before and after individual walker steps. This keeps guests,
  // the rival valet and the player valet from becoming a permanent stack in the curb/door lane.
  for (let pass = 0; pass < 2; pass++) {
    const active = [...figures].filter((f) =>
      f.poof === null && f.popIn >= 0.1);
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        if (a.buildingRoute && b.buildingRoute
          && (a.role === 'guest' || a.role === 'doorman')
          && (b.role === 'guest' || b.role === 'doorman')) continue;
        const ap = a.root.position, bp = b.root.position;
        const dx = ap.x - bp.x, dz = ap.z - bp.z;
        const d = Math.hypot(dx, dz);
        const min = a.r + b.r + 0.14;
        if (d >= min) continue;
        const angle = d > 0.001 ? Math.atan2(dz, dx)
          : (i * 1.618 + j * 0.913) % (Math.PI * 2);
        const nx = Math.cos(angle), nz = Math.sin(angle);
        const overlap = min - d;
        const aPriority = a.role === 'guest' ? 0.58 : 0.5;
        ap.x += nx * overlap * aPriority;
        ap.z += nz * overlap * aPriority;
        bp.x -= nx * overlap * (1 - aPriority);
        bp.z -= nz * overlap * (1 - aPriority);
      }
    }
  }
  for (const f of [...figures]) {
    f.t += dt;
    if (f.delay > 0) {
      f.delay -= dt;
      if (f.delay <= 0 && f.path) f.anim = f.moveAnim;
    } else if (f.path) {
      const p = f.path[0];
      const dx = p[0] - f.root.position.x, dz = p[1] - f.root.position.z, d = Math.hypot(dx, dz);
      if (d <= 1e-4) f.path.shift();
      else {
        const step = Math.min(f.speed * dt, d);
        const fx = dx / d, fz = dz / d;
        const sx = -fz, sz = fx;
        const choices = [
          [f.root.position.x + fx * step, f.root.position.z + fz * step, d <= f.speed * dt],
          [f.root.position.x + (fx * 0.45 + sx * 0.9) * step, f.root.position.z + (fz * 0.45 + sz * 0.9) * step, false],
          [f.root.position.x + (fx * 0.45 - sx * 0.9) * step, f.root.position.z + (fz * 0.45 - sz * 0.9) * step, false],
        ];
        let best = null, bestD = Infinity;
        for (const [x, z, reachesWaypoint] of choices) {
          if (!clearWalkerStep(f, x, z)) continue;
          const nd = Math.hypot(p[0] - x, p[1] - z);
          if (nd < bestD) { best = [x, z, reachesWaypoint]; bestD = nd; }
        }
        // Boxed in for more than a moment (a valet, a car or a prop in the way): walk straight on instead of freezing forever.
        if (!best) {
          f.stuckT = (f.stuckT || 0) + dt;
          if (f.stuckT > 0.6 && f.role !== 'valet') {
            const [gx, gz] = choices[0];
            if (gx >= BOUNDS.minX && gx <= BOUNDS.maxX && gz >= (f.buildingRoute ? BUILDING_MIN_Z : BOUNDS.minZ) && gz <= BOUNDS.maxZ) best = choices[0];
          }
        } else f.stuckT = 0;
        if (best) {
          f.root.position.x = best[0];
          f.root.position.z = best[1];
          f.yaw = Math.atan2(best[0] - f.px, best[1] - f.pz);
          f.anim = f.moveAnim;
          if (best[2]) f.path.shift();
        } else f.anim = 'idle';
      }
      if (!f.path?.length) {
        f.path = null;
        f.anim = f.after;
        const cb = f.onDone;
        f.onDone = null;
        if (cb) cb(f);
      }
    }
    // Bystanders (guests, the dog, the doorman) never stand inside a car or a prop: they step out of the way.
    if (!f.noCollide && f.poof === null && f.popIn >= 0.1 && (f.role === 'guest' || f.role === 'dog' || f.role === 'doorman')) {
      const pos = f.root.position;
      if (!(f.buildingRoute && pos.z < WALK_Z + 0.55) && pushFromObstacles(pos, f.r)) {
        f.blockT += dt;
      } else f.blockT = 0;
      // Guests and staff give valets personal space; the moving pedestrian yields instead of dragging them.
      if (!f.noCollide) pushFromPeople(pos, f.r, f, f.buildingRoute && !!f.path && (f.role === 'guest' || f.role === 'dog'));
      pos.x = THREE.MathUtils.clamp(pos.x, BOUNDS.minX + f.r, BOUNDS.maxX - f.r);
      pos.z = THREE.MathUtils.clamp(pos.z, (f.buildingRoute ? BUILDING_MIN_Z : BOUNDS.minZ) + f.r, BOUNDS.maxZ - f.r);
    }
    const mx = f.root.position.x - f.px, mz = f.root.position.z - f.pz;
    f.px = f.root.position.x; f.pz = f.root.position.z;
    f.vs += (Math.min(8, Math.hypot(mx, mz) / Math.max(dt, 1e-4)) - f.vs) * Math.min(1, dt * 10);
    const dy = Math.atan2(Math.sin(f.yaw - f.root.rotation.y), Math.cos(f.yaw - f.root.rotation.y));
    f.root.rotation.y += dy * Math.min(1, dt * 12);
    posePerson(f, dt);

    let s = 1;
    if (f.popIn < 0.15) { f.popIn = Math.min(0.15, f.popIn + dt); s = f.popIn / 0.15; }
    if (f.poof !== null) {
      f.poof -= dt;
      if (f.poof <= 0) { removeFigure(f); continue; }
      s *= f.poof / 0.25;
    } else if (f.life !== null) {
      f.life -= dt;
      if (f.life <= 0) f.poof = 0.25;
    }
    f.root.scale.setScalar(Math.max(0.001, s * 1.3));
  }
}

// A guest steps out beside the new car, waves the keys over, then strolls into the lobby.
export function arrivalGuest() {
  const g = spawnFigure('guest', SPAWN.x - 0.7, SPAWN.z + 1.3, 0);
  g.delay = 0.45;
  setAnim(g, 'wave');
  walkTo(g, arrivalPath(), 3.6, enterBuilding);
}

// The valet hops out of a car they just parked and waves.
export function valetHop(car, bay) {
  if (valetFig) removeFigure(valetFig);
  const x = bay.x + 1.4, z = bay.z + 0.3;
  rush.lastPark = { x, z };
  valetFig = spawnFigure('valet', x, z, 0);
  setAnim(valetFig, 'wave');
  valetFig.life = 1.1;
}

/* ---------- drop-off and pick-up rings (Rush Hour) ---------- */
function buildRing(x, z, color, css, label) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.52, 1.7, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);
  const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.52, 48), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.07;
  group.add(fill);
  const tex = addTextTexture(
    [{ text: label, size: 88, font: 'Fredoka, Arial, sans-serif', weight: '700', color: css, y: 128 }],
    { width: 512, height: 256, bg: '#0d1f1b', border: css },
  );
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(0, 0.03, 1.0);
  group.add(decal);
  group.visible = false;
  scene.add(group);
  return { group, ringMat, fillMat };
}

export const handoff = buildRing(HANDOFF.x, HANDOFF.z, 0x5ee6a8, '#5ee6a8', 'PICK-UP');

export const dropoff = buildRing(DROPOFF.x, DROPOFF.z, 0xffc247, '#ffc247', 'DROP-OFF');

/* ---------- guide arrow, dust, sparks and ring bursts ---------- */
export const guide = new THREE.Group();

{
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.75, 3),
    new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  cone.rotation.x = Math.PI / 2;     // the tip points along +z
  cone.position.y = 0.15;
  guide.add(cone);
  guide.visible = false;
  scene.add(guide);
}