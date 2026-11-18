// Driving physics, collisions and the helpers shared by both modes (snap-into-bay, exit, bay highlights).
import * as THREE from 'three';
import { BOUNDS, PARKED_HALF, reduceMotion } from './config.js';
import { audio, bayYaw, gripOf, parkRadius, parkSpeed, toast } from './core.js';
import { puff } from './fx.js';
import { rushBump } from './shifts.js';
import { cars, G, keys, rush, slots, touch } from './state.js';

export function angleToBay(car) {
  const Y = bayYaw(car.yaw);   // either direction counts: front-in or back-in
  return Math.abs(Math.atan2(Math.sin(car.yaw - Y), Math.cos(car.yaw - Y)));
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

// Backs the car out of its bay into a lane, then drives off to the right.
export function stepExit(car, dt) {
  if (car.z < car.exitLane - 0.02) {
    car.z = Math.min(car.exitLane, car.z + 3.8 * dt);
    car.yaw = Math.PI;
  } else {
    car.yaw = Math.max(Math.PI / 2, car.yaw - 3 * dt);
    car.x += 4.8 * dt * Math.max(0.25, Math.sin(car.yaw));
  }
  car.root.position.set(car.x, 0.045, car.z);
  car.root.rotation.y = car.yaw;
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
    const Y = bayYaw(a.y0);
    c.yaw = a.y0 + Math.atan2(Math.sin(Y - a.y0), Math.cos(Y - a.y0)) * e;
    c.root.position.set(c.x, 0.045, c.z);
    c.root.rotation.y = c.yaw;
    if (a.t >= 1) c.snap = null;
  }
}

function pushCar(car, nx, nz, push) {
  car.x += nx * push;
  car.z += nz * push;
  const vn = car.vx * nx + car.vz * nz;
  if (vn < 0) {
    car.vx -= 1.3 * vn * nx;
    car.vz -= 1.3 * vn * nz;
    if (-vn > 1.2 && G.bumpCd <= 0) {
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
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), r = 0.85;
  for (const off of [0.75, -0.75]) {
    const px = car.x + fx * off, pz = car.z + fz * off;

    for (const c of G.colliders) {
      const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz), min = r + c.r;
      if (d < min) pushCar(car, dx / (d || 1), dz / (d || 1), min - d);
    }

    for (const s of slots) {
      if (!s.car && !s.closed) continue;     // a closed bay is as solid as a parked car
      const cx = THREE.MathUtils.clamp(px, s.x - PARKED_HALF.x, s.x + PARKED_HALF.x);
      const cz = THREE.MathUtils.clamp(pz, s.z - PARKED_HALF.z, s.z + PARKED_HALF.z);
      let dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d < 1e-4) {
          // centre is inside the box: leave through the nearest face
          const ox = PARKED_HALF.x - Math.abs(px - s.x), oz = PARKED_HALF.z - Math.abs(pz - s.z);
          if (ox < oz) { dx = Math.sign(px - s.x) || 1; dz = 0; d = -ox; }
          else { dx = 0; dz = Math.sign(pz - s.z) || 1; d = -oz; }
          pushCar(car, dx, dz, r - d);
        } else {
          pushCar(car, dx / d, dz / d, r - d);
        }
      }
    }
  }
}

export function drive(car, dt) {
  const forward = keys.has('ArrowUp') || keys.has('w');
  const back = keys.has('ArrowDown') || keys.has('s');
  const left = keys.has('ArrowLeft') || keys.has('a');
  const right = keys.has('ArrowRight') || keys.has('d');
  const throttle = THREE.MathUtils.clamp((forward ? 1 : 0) - (back ? 1 : 0) + (touch.gas ? 1 : 0) - (touch.brake ? 1 : 0), -1, 1);
  const steer = THREE.MathUtils.clamp((left ? 1 : 0) - (right ? 1 : 0) + touch.steer, -1, 1);   // the wheel gives analog steering
  const q = car.quirk;
  const fX = Math.sin(car.yaw), fZ = Math.cos(car.yaw);
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
      const Yb = bayYaw(car.yaw);
      const diff = Math.atan2(Math.sin(Yb - car.yaw), Math.cos(Yb - car.yaw));
      if (Math.abs(diff) < 1.3) car.yaw += diff * Math.min(1, dt * 2.2) * (Math.abs(steer) > 0.1 ? 0.3 : 1);
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
  // Rain: little splashes behind the wheels.
  if (gripOf() < 1 && car.speed > 1.5) {
    car.splashT = (car.splashT || 0) - dt;
    if (car.splashT <= 0) {
      car.splashT = 0.08;
      for (let i = 0; i < 2; i++) {
        puff(car.x - fX * 1.1 + (Math.random() - 0.5), 0.1, car.z - fZ * 1.1 + (Math.random() - 0.5), {
          color: 0xcfe8ff, size: 0.22, life: 0.35, vy: 1.4, vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, grow: 1.8, opacity: 0.55,
        });
      }
    }
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
