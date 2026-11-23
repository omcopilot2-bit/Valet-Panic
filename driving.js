// Driving physics, collisions and the helpers shared by both modes (snap-into-bay, exit, bay highlights).
import * as THREE from 'three';
import { CAR_BODY_OFFSETS, CAR_BODY_RADIUS, carPathBlocked, carPathHitsCircle, circleVsCollider, circleVsParkingBox, separationNormal } from './collision.js';
import { angleDifference, BOUNDS, PARKED_HALF, reduceMotion } from './config.js';
import { audio, gripOf, parkRadius, parkSpeed, parkYaw, toast } from './core.js';
import { puff } from './fx.js';
import { otherPeople } from './people.js';
import { rushBump } from './shifts.js';
import { cars, G, keys, rush, slots } from './state.js';

export function angleToBay(car) {
  return angleDifference(car.yaw, parkYaw(car.slot));
}

export function hornTick(car, dt) {
  car.honk -= dt;
  if (car.honk <= 0 && car.speed > 0.4) {
    car.honk = 2.2 + Math.random() * 2;
    car.yaw += (Math.random() - 0.5) * 0.7;
    if (!reduceMotion) G.shake = 0.5;
    audio.play('honk');
    toast('📯 HONK! It startles you.');
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Leaves its bay (nose-in cars reverse out, nose-out cars drive out), straightens up in the lane, then turns right and drives off.
// The heading always turns smoothly: it never snaps.
export function stepExit(car, dt) {
  let nextX = car.x, nextZ = car.z, nextYaw = car.yaw;
  if (car.exitRoute && car.exitRoute.length) {
    let i = car.exitRouteIndex || 0;
    let target = car.exitRoute[i];
    let dx = target.x - car.x, dz = target.z - car.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.28 && i < car.exitRoute.length - 1) {
      car.exitRouteIndex = ++i;
      target = car.exitRoute[i];
      dx = target.x - car.x;
      dz = target.z - car.z;
      d = Math.hypot(dx, dz);
    }
    const want = target.yaw !== undefined ? target.yaw : d > 0.05 ? Math.atan2(dx, dz) : car.yaw;
    const diff = wrapAngle(want - car.yaw);
    nextYaw += Math.max(-3 * dt, Math.min(3 * dt, diff));
    const turn = Math.min(1, Math.abs(diff) / 1.2);
    const step = 4.2 * (1 - turn * 0.35) * dt;
    nextX = d <= step ? target.x : car.x + dx / d * step;
    nextZ = d <= step ? target.z : car.z + dz / d * step;
  } else
  if (car.z < car.exitLane - 0.02) {
    // line the car up with the bay axis (nearest of 0 / PI), and only roll once it is roughly straight
    const axis = Math.cos(car.yaw) >= 0 ? 0 : Math.PI;
    const diff = wrapAngle(axis - car.yaw);
    nextYaw += Math.max(-3 * dt, Math.min(3 * dt, diff));
    const align = Math.max(0, (Math.abs(Math.cos(nextYaw)) - 0.35) / 0.65);
    nextZ = Math.min(car.exitLane, car.z + 3.8 * dt * align);
  } else {
    const diff = wrapAngle(Math.PI / 2 - car.yaw);
    nextYaw += Math.max(-3 * dt, Math.min(3 * dt, diff));
    nextX += 4.8 * dt * Math.max(0.25, Math.sin(nextYaw));
  }
  // The valet who just climbed out stands beside this same car; don't let that scripted hand-off pose trap it.
  const peopleWithRightOfWay = otherPeople(null).filter((p) => (p.fig?.role === 'valet' || p.fig?.role === 'rival') && p.fig !== car.exitIgnoreFigure);
  if (carPathBlocked(car, nextX, nextZ, nextYaw, cars, 0.08)
    || carPathHitsCircle(car, nextX, nextZ, nextYaw, [...G.colliders, ...peopleWithRightOfWay], 0.08)) {
    car.speed = car.vx = car.vz = 0;             // delivery traffic waits until the lane is clear...
    car.blockT = (car.blockT || 0) + dt;
    if (car.blockT < 2.2) return false;          // ...but never forever: after a couple of seconds it creeps through (no deadlocks)
  } else car.blockT = 0;
  const oldX = car.x, oldZ = car.z;
  car.x = nextX; car.z = nextZ; car.yaw = nextYaw;
  car.vx = dt > 0 ? (nextX - oldX) / dt : 0;
  car.vz = dt > 0 ? (nextZ - oldZ) / dt : 0;
  car.speed = Math.hypot(car.vx, car.vz);
  car.root.position.set(car.x, 0.045, car.z);
  car.root.rotation.y = car.yaw;
  if (car.x > 15) car.exitIgnoreFigure = null;
  return car.x > 15;
}

export function stepSnap(dt) {
  for (const c of cars) {
    const a = c.snap;
    if (!a) continue;
    const b = c.slot;
    if (!b) { c.snap = null; continue; }
    a.t = Math.min(1, a.t + dt / 0.28);
    const e = a.t * a.t * (3 - 2 * a.t);
    c.x = a.x0 + (b.x - a.x0) * e;
    c.z = a.z0 + (b.z - a.z0) * e;
    const Y = parkYaw(b);
    c.yaw = a.y0 + Math.atan2(Math.sin(Y - a.y0), Math.cos(Y - a.y0)) * e;
    c.root.position.set(c.x, 0.045, c.z);
    c.root.rotation.y = c.yaw;
    if (a.t >= 1) c.snap = null;
  }
}

function pushCar(car, nx, nz, push, quiet = false) {
  car.x += nx * push;
  car.z += nz * push;
  const vn = car.vx * nx + car.vz * nz;
  if (vn < 0) {
    car.vx -= 1.3 * vn * nx;
    car.vz -= 1.3 * vn * nz;
    if (!quiet && -vn > 1.2 && G.bumpCd <= 0) {
      G.bumpCd = 0.5;
      car.bump = 0.25;
      for (let i = 0; i < 6; i++) {
        puff(car.x - nx * 0.9, 0.45, car.z - nz * 0.9, {
          color: 0xffd34a, size: 0.28, life: 0.35, vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 2,
          vz: (Math.random() - 0.5) * 4, grow: 0.4, opacity: 0.95, add: true,
        });
      }
      if (G.mode === 'rush') rushBump(car);
      if (!reduceMotion) G.shake = 0.35;
      audio.play('bump');
    }
  }
}

// The car is approximated by two circles (nose + tail) so long sides and noses collide consistently.
function resolveCollisions(car) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), r = CAR_BODY_RADIUS;
  for (const off of CAR_BODY_OFFSETS) {
    const px = car.x + fx * off, pz = car.z + fz * off;

    for (const c of G.colliders) {
      if (c.disabled || car.propGhostT > 0) continue;
      const hit = circleVsCollider(px, pz, r, c, `${car.id}:${c.kind || 'prop'}`);
      if (hit) pushCar(car, hit.nx, hit.nz, hit.depth);
    }

    // Cars that are on the move (the rival's, guests arriving or leaving, a car being handed over) are solid too:
    // parked cars are already covered by their bay's box below.
    for (const o of cars) {
      if (car.propGhostT > 0) continue;
      if (o === car || (o.parked && o.slot && !o.rivalDrive)) continue;
      const ox = Math.sin(o.yaw), oz = Math.cos(o.yaw);
      for (const oo of CAR_BODY_OFFSETS) {
        const dx = px - (o.x + ox * oo), dz = pz - (o.z + oz * oo), d = Math.hypot(dx, dz), min = r + CAR_BODY_RADIUS;
        if (d < min) {
          const [nx, nz] = separationNormal(dx, dz, `${car.id}:${o.id}`);
          pushCar(car, nx, nz, min - d, true);
        }
      }
    }

    // People on foot (the rival, guests, the doorman, the dog) are solid for a car too: it never drives through them.
    for (const o of otherPeople(null)) {
      if (car.propGhostT > 0) continue;
      const dx = px - o.x, dz = pz - o.z, d = Math.hypot(dx, dz), min = r + o.r;
      if (d < min) {
        const [nx, nz] = separationNormal(dx, dz, `${car.id}:${o.fig?.role || 'person'}`);
        pushCar(car, nx, nz, min - d, true);
      }
    }

    for (const s of slots) {
      if (car.propGhostT > 0) continue;
      if (!s.car && !s.closed) continue;     // a closed bay is as solid as a parked car
      const hit = circleVsParkingBox(px, pz, r, s, PARKED_HALF.x, PARKED_HALF.z);
      if (hit) pushCar(car, hit.nx, hit.nz, hit.depth);
    }
  }
}

export function drive(car, dt) {
  const forward = keys.has('ArrowUp') || keys.has('w');
  const back = keys.has('ArrowDown') || keys.has('s');
  const left = keys.has('ArrowLeft') || keys.has('a');
  const right = keys.has('ArrowRight') || keys.has('d');
  const throttle = (forward ? 1 : 0) - (back ? 1 : 0);
  const steer = (left ? 1 : 0) - (right ? 1 : 0);
  const q = car.quirk;
  const fX = Math.sin(car.yaw), fZ = Math.cos(car.yaw);
  car.propGhostT = Math.max(0, (car.propGhostT || 0) - dt);
  const beforeMoveX = car.x, beforeMoveZ = car.z;
  const nitro = G.mode === 'rush' && rush.nitro > 0;
  const vmax = (nitro ? 6.2 : 4.4) * (car.special === 'vintage' ? 0.8 : 1);

  const fw0 = car.vx * fX + car.vz * fZ;
  const accel = throttle !== 0 && Math.sign(throttle) !== Math.sign(fw0) && Math.abs(fw0) > 0.3 ? 9 : (nitro ? 11 : 6);   // braking bites harder than accelerating
  car.vx += fX * throttle * accel * dt;
  car.vz += fZ * throttle * accel * dt;

  const slick = 1 - gripOf();                       // 0 on dry tarmac, ~0.55 in the rain
  const drag = Math.pow(throttle === 0 ? (q === 'brakes' ? 0.993 : 0.965 + slick * 0.03) : 0.994, dt * 60);
  car.vx *= drag;
  car.vz *= drag;

  // tyre grip: bleed off sideways velocity
  {
    const fw = car.vx * fX + car.vz * fZ;
    const lx = car.vx - fX * fw, lz = car.vz - fZ * fw;
    const k = 1 - Math.pow(q === 'brakes' ? 0.93 : 0.84 + slick * 0.15, dt * 60);
    car.vx -= lx * k;
    car.vz -= lz * k;
  }

  car.speed = Math.hypot(car.vx, car.vz);
  if (car.speed > vmax) {
    car.vx *= vmax / car.speed;
    car.vz *= vmax / car.speed;
    car.speed = vmax;
  }

  // Realistic steering: a car only turns while it rolls (no spinning on the spot), and the wheel reverses when backing up.
  {
    const fwd = car.vx * fX + car.vz * fZ;
    car.yaw += steer * dt * 1.5 * (q === 'wide' ? 0.65 : 1) * (1 - slick * 0.3) * Math.min(1, Math.abs(fwd) / 1.3) * Math.sign(fwd);
  }

  // Park assist: close to your own bay and slow, the car gently straightens and drifts into the middle.
  const bay = car.slot;
  if (bay) {
    const dx = bay.x - car.x, dz = bay.z - car.z, d = Math.hypot(dx, dz);
    if (d < parkRadius() * 1.3 && car.speed < parkSpeed() * 1.5) {
      const Yb = parkYaw(bay);
      const diff = Math.atan2(Math.sin(Yb - car.yaw), Math.cos(Yb - car.yaw));
      if (Math.abs(diff) < 1.3) car.yaw += diff * Math.min(1, dt * 2.2) * (steer ? 0.3 : 1);
      if (throttle === 0 && d < parkRadius()) {
        const pull = Math.min(1, dt * 1.2);
        car.x += dx * pull;
        car.z += dz * pull;
      }
    }
  }

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  if (car.x < BOUNDS.minX || car.x > BOUNDS.maxX || car.z < BOUNDS.minZ || car.z > BOUNDS.maxZ) {
    car.x = THREE.MathUtils.clamp(car.x, BOUNDS.minX, BOUNDS.maxX);
    car.z = THREE.MathUtils.clamp(car.z, BOUNDS.minZ, BOUNDS.maxZ);
    car.vx *= -0.24;
    car.vz *= -0.24;
    car.speed *= 0.55;
  }

  resolveCollisions(car);
  const directedProgress = ((car.x - beforeMoveX) * fX + (car.z - beforeMoveZ) * fZ) * Math.sign(throttle || 1);
  if (throttle && car.speed > 0.7 && directedProgress < 0.025) {
    car.propStuckT = (car.propStuckT || 0) + dt;
    if (car.propStuckT > 0.7) {
      // Player input always wins eventually: briefly ghost solid scenery so an awkward prop contact cannot trap the car.
      car.propGhostT = 0.65;
      car.propStuckT = 0;
    }
  } else car.propStuckT = 0;
  car.speed = Math.hypot(car.vx, car.vz);
  car.dustT = (car.dustT || 0) - dt;
  if (car.dustT <= 0 && car.speed > 2.0 && (nitro || Math.abs(car.vx * fZ - car.vz * fX) > 0.9)) {   // dust only when sliding
    const lat = Math.abs(car.vx * fZ - car.vz * fX);          // sideways slip
    car.dustT = lat > 0.9 ? 0.04 : 0.09;
    puff(car.x - fX * 1.3 + (Math.random() - 0.5) * 0.5, 0.15, car.z - fZ * 1.3 + (Math.random() - 0.5) * 0.5, {
      color: nitro ? 0x6cc8ff : (lat > 0.9 ? 0xe8eef0 : 0xaab6bb), size: nitro ? 0.5 : 0.45, life: 0.55, vy: 0.4, grow: 2.2,
      opacity: nitro ? 0.7 : (lat > 0.9 ? 0.55 : 0.28), add: nitro,
    });
  }
  if (car.tailMat) {
    const braking = throttle !== 0 && Math.sign(throttle) !== Math.sign(fw0) && Math.abs(fw0) > 0.3;
    car.tailMat.color.setHex(braking ? 0xff2a1a : throttle < 0 ? 0xffe8c0 : 0x7a1410);
  }
  // Body pitch under throttle and roll in corners.
  if (!reduceMotion && car.body) {
    const fwdS = car.vx * fX + car.vz * fZ;
    const roll = steer * Math.min(1, Math.abs(fwdS) / 3) * 0.035;
    const pitch = -throttle * Math.min(1, car.speed / 2 + 0.3) * 0.02;
    const k = Math.min(1, dt * 6);
    car.body.rotation.z += (roll - car.body.rotation.z) * k;
    car.body.rotation.x += (pitch - car.body.rotation.x) * k;
  }
  car.root.position.set(car.x, 0.045, car.z);
  car.root.rotation.y = car.yaw;
}
