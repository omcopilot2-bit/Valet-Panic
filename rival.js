// The rival valet: an AI opponent that races you for the same cars. Split out of shifts.js; it only reads and writes the shared `rush` / `cars` state.
import * as THREE from 'three';
import { BOUNDS, HANDOFF, PARKED_HALF } from './config.js';
import { carPathBlocked, carPathHitsCircle } from './collision.js';
import { audio, bubble, parkYaw, popScore, worldToScreen } from './core.js';
import { ringBurst } from './fx.js';
import { otherPeople, poof, pushFromObstacles, pushFromPeople, spawnFigure, walkTo } from './people.js';
import { approachPoint, deliverRoute, footRoute, grabRadius, parkRoute } from './routes.js';
import { cars, G, rush, slots, tutorial } from './state.js';

import { boardCar, clearMark, endCall, handoffSpots, rline, rushLeaveDelay } from './shifts.js';
import { updateRushHUD } from './hud.js';

/* ---------- the rival valet: an AI opponent racing you for the same cars ---------- */
// He takes keys at the drop-off and hands cars over at the pick-up, exactly like you. Whoever reaches a car first gets it.
// Every park and every return counts one point; when the shift ends, more points than the rival means you win.
const GRID_CLEAR = 1.05;   // A* obstacle clearance (1.35 was wider than the aisles and left the rival boxed in)
const RIVAL_HOME = { x: -6.2, z: 7.5 };
const RIVAL_LINES = ['Too slow!', 'Mine!', 'Thanks, rookie!', 'Beep beep!', 'Keys, please!'];

function gridPath(from, to, obstacles) {
  const step = 0.45;
  const minX = Math.floor(BOUNDS.minX / step), maxX = Math.ceil(BOUNDS.maxX / step);
  const minZ = Math.floor(BOUNDS.minZ / step), maxZ = Math.ceil(BOUNDS.maxZ / step);
  const start = { x: Math.round(from.x / step), z: Math.round(from.z / step) };
  const goal = { x: Math.round(to.x / step), z: Math.round(to.z / step) };
  const key = (x, z) => `${x},${z}`;
  const blocked = (x, z) => {
    const px = x * step, pz = z * step;
    return obstacles.some((o) => {
      if (o.halfX !== undefined && o.halfZ !== undefined) {
        const qx = Math.max(o.x - o.halfX, Math.min(px, o.x + o.halfX));
        const qz = Math.max(o.z - o.halfZ, Math.min(pz, o.z + o.halfZ));
        return Math.hypot(px - qx, pz - qz) < GRID_CLEAR;
      }
      return Math.hypot(px - o.x, pz - o.z) < o.r + GRID_CLEAR;
    });
  };
  if (blocked(start.x, start.z) || blocked(goal.x, goal.z)) return null;

  const startKey = key(start.x, start.z), goalKey = key(goal.x, goal.z);
  const open = [{ ...start, g: 0, f: Math.hypot(goal.x - start.x, goal.z - start.z) }];
  const scores = new Map([[startKey, 0]]);
  const parents = new Map();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const current = open.splice(best, 1)[0];
    const currentKey = key(current.x, current.z);
    if (current.g !== scores.get(currentKey)) continue;
    if (currentKey === goalKey) {
      const path = [];
      let at = goalKey;
      while (at !== startKey) {
        const [x, z] = at.split(',').map(Number);
        path.push({ x: x * step, z: z * step });
        at = parents.get(at);
      }
      path.reverse();
      return path;
    }

    for (const [dx, dz] of dirs) {
      const x = current.x + dx, z = current.z + dz;
      if (x < minX || x > maxX || z < minZ || z > maxZ || blocked(x, z)) continue;
      if (dx && dz && (blocked(current.x + dx, current.z) || blocked(current.x, current.z + dz))) continue;
      const nextKey = key(x, z);
      const g = current.g + (dx && dz ? Math.SQRT2 : 1);
      if (g >= (scores.get(nextKey) ?? Infinity)) continue;
      scores.set(nextKey, g);
      parents.set(nextKey, currentKey);
      open.push({ x, z, g, f: g + Math.hypot(goal.x - x, goal.z - z) });
    }
  }
  return null;
}

// Collapse the grid's 0.45-unit stair steps into long, clear segments so steering does not twitch at every node.
function smoothGridPath(from, path, obstacles) {
  const clearSegment = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.18));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps, x = a.x + dx * f, z = a.z + dz * f;
      if (obstacles.some((o) => {
        if (o.halfX !== undefined && o.halfZ !== undefined) {
          const qx = Math.max(o.x - o.halfX, Math.min(x, o.x + o.halfX));
          const qz = Math.max(o.z - o.halfZ, Math.min(z, o.z + o.halfZ));
          return Math.hypot(x - qx, z - qz) < GRID_CLEAR;
        }
        return Math.hypot(x - o.x, z - o.z) < o.r + GRID_CLEAR;
      })) return false;
    }
    return true;
  };
  const result = [];
  let anchor = from, i = 0;
  while (i < path.length) {
    let furthest = i;
    for (let j = i; j < path.length; j++) {
      if (!clearSegment(anchor, path[j])) break;
      furthest = j;
    }
    result.push(path[furthest]);
    anchor = path[furthest];
    i = furthest + 1;
  }
  return result;
}

function routeAroundLevelProps(car, route) {
  const obstacles = [
    ...G.colliders.filter((o) => !o.disabled),
    ...slots.filter((s) => s.closed).map((s) => ({ x: s.x, z: s.z, r: Math.hypot(PARKED_HALF.x, PARKED_HALF.z) })),
    ...[...cars].filter((o) => o !== car).map((o) => ({ x: o.x, z: o.z, r: 1.0 })),
  ];
  if (!obstacles.length) return route;
  const path = [];
  let from = { x: car.x, z: car.z };
  for (const point of route) {
    const leg = gridPath(from, point, obstacles);
    if (!leg) {
      // A moving car can temporarily occupy the target; the driver waits and replans on the next clear window.
      path.push(point);
    } else {
      path.push(...smoothGridPath(from, leg, obstacles), point);
    }
    from = point;
  }
  return path;
}

export function newRival(lv) {
  const d = lv.diff;
  return {
    fig: spawnFigure('rival', RIVAL_HOME.x, RIVAL_HOME.z, 0),
    x: RIVAL_HOME.x, z: RIVAL_HOME.z, state: 'idle',   // idle | walk | drive
    think: 0.6, stun: 0, target: null, path: [], recheck: 0.4,
    walk: 3.4 + d * 0.17,                              // run speed (you run at 4.8)
    drive: 3.0 + d * 0.15,                             // driving speed (you top out at 4.4)
    react: Math.max(0.35, 1.6 - d * 0.12),             // seconds he takes to notice a new job
    parked: 0, delivered: 0,
  };
}

const rivalAvail = (t) => (t.kind === 'park' ? rush.waiting === t.car && t.car.waiting : rush.calls.includes(t.call) && t.call.state === 'waiting');

// Picks the job he can win: the shortest trip, with a bonus for waiting guests (they cost points when they leave)
// and for jobs about to expire, and a penalty for cars you are clearly closer to (unless nothing else is left).
function rivalPickJob(rv) {
  const jobs = [];
  if (rush.waiting && rush.waiting.waiting) jobs.push({ kind: 'park', car: rush.waiting, urgent: rush.waiting.waitLeft < 8 });
  for (const call of rush.calls) if (call.state === 'waiting') jobs.push({ kind: 'deliver', car: call.car, call, urgent: call.left < call.total * 0.4 });
  const pl = rush.pl && rush.pl.mode === 'foot' ? rush.pl : null;   // if you are driving, you are busy
  let best = null, bs = Infinity;
  for (const t of jobs) {
    const a = approachPoint(t.kind, t.car);
    const mine = Math.hypot(a.x - rv.x, a.z - rv.z) / rv.walk;
    let s = mine - (t.kind === 'deliver' ? 0.8 : 0) - (t.urgent ? 1.2 : 0);
    if (pl) {
      const yours = Math.hypot(a.x - pl.x, a.z - pl.z) / 4.8;
      if (yours < mine * 0.7) s += 4;                // you would get there first: go for something else
    }
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

export function updateRival(dt) {
  const rv = rush.rival;
  if (!rv || tutorial.on || rv.state === 'drive') return;
  if (rv.stun > 0) { rv.stun -= dt; rv.fig.anim = 'idle'; return; }
  if (rv.state === 'idle') {
    rv.fig.anim = 'idle';
    rv.think -= dt;
    if (rv.think > 0) return;
    const best = rivalPickJob(rv);
    if (!best) { rv.think = 0.2; return; }
    rv.target = best;
    rv.path = footRoute(rv, approachPoint(best.kind, best.car));
    rv.state = 'walk';
    rv.recheck = 0.4;
  }
  const t = rv.target;
  if (!t || !rivalAvail(t)) {                       // you got there first (or the guest left): look for something else
    rv.target = null; rv.state = 'idle'; rv.think = rv.react * 0.3; rv.fig.anim = 'idle';
    return;
  }
  // Every so often he re-evaluates: if you are about to beat him to this car, he switches to a better one.
  rv.recheck -= dt;
  if (rv.recheck <= 0) {
    rv.recheck = 0.4;
    const better = rivalPickJob(rv);
    if (better && better !== t && better.car !== t.car) {
      rv.target = better;
      rv.path = footRoute(rv, approachPoint(better.kind, better.car));
      return;
    }
  }
  const p = rv.path[0];
  const oldX = rv.x, oldZ = rv.z;
  if (p) {
    const dx = p[0] - rv.x, dz = p[1] - rv.z, d = Math.hypot(dx, dz), step = rv.walk * dt;
    if (d <= step) { rv.x = p[0]; rv.z = p[1]; rv.path.shift(); }
    else { rv.x += dx / d * step; rv.z += dz / d * step; rv.fig.yaw = Math.atan2(dx, dz); }
  }
  pushFromObstacles(rv, 0.3);          // the rival never walks through parked cars, props or other people either
  if (pushFromPeople(rv, 0.3, rv.fig)) {
    rv.recheck = Math.min(rv.recheck, 0.15);
  }
  // Check the intended approach before separation pushes can nudge him just beyond the grab radius.
  if (Math.hypot(rv.x - t.car.x, rv.z - t.car.z) <= grabRadius(t.kind) + 0.35) { rivalTake(t); return; }
  rv.fig.root.position.set(rv.x, 0.02, rv.z);
  rv.fig.anim = Math.hypot(rv.x - oldX, rv.z - oldZ) > 0.02 ? 'run' : 'idle';
  if (!rv.path.length) {
    // If contact resolution kept him a step short, make another short approach instead of idling in front of the car.
    if (Math.hypot(rv.x - t.car.x, rv.z - t.car.z) <= grabRadius(t.kind) + 0.75) { rivalTake(t); return; }
    rv.path = footRoute(rv, approachPoint(t.kind, t.car));
    rv.fig.anim = 'idle';
  }
}

// He reached the car first: he hops in and drives it along a fixed route.
function rivalTake(t) {
  const rv = rush.rival, car = t.car, s = car.slot;
  if (rv.fig) { poof(rv.fig); rv.fig = null; }
  rv.state = 'drive';
  rv.target = null;
  clearMark(car);
  if (t.kind === 'park') {
    rush.waiting = null;
    car.waiting = false;
    rush.spawnIn = 3 + rush.lv.gap * 4;
    car.vipActive = false;
    car.rivalDrive = { kind: 'park', path: routeAroundLevelProps(car, parkRoute(s, parkYaw(s))), i: 0, speed: rv.drive, steer: 0 };
  } else {
    t.call.state = 'rival';
    t.call.slot = s;
    car.rivalDrive = { kind: 'deliver', call: t.call, path: routeAroundLevelProps(car, deliverRoute(s, car.yaw)), i: 0, speed: rv.drive, steer: 0 };
    if (s) s.car = null;
    car.slot = null;
    car.parked = false;
    car.snap = null;
  }
  bubble(rline(RIVAL_LINES), car.x, car.z, 2.4);
  audio.play('honk', 0, 'beep');
}

export function stepRivalCar(c, dt) {
  const rd = c.rivalDrive, n = rd.path[rd.i];
  const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot(dx, dz);
  const want = n.yaw !== undefined ? n.yaw : d > 0.05 ? Math.atan2(dx, dz) : c.yaw;
  const diff = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
  const desiredSteer = THREE.MathUtils.clamp(diff * 2.4, -3.2, 3.2);
  rd.steer = THREE.MathUtils.clamp(rd.steer || 0, desiredSteer - 7 * dt, desiredSteer + 7 * dt);
  const yawStep = THREE.MathUtils.clamp(rd.steer * dt, Math.min(0, diff), Math.max(0, diff));
  const nextYaw = c.yaw + yawStep;
  const turn = Math.min(1, Math.abs(diff) / 1.2);
  const step = rd.speed * (1 - turn * 0.4) * dt;
  const nextX = d <= step ? n.x : c.x + dx / d * step;
  const nextZ = d <= step ? n.z : c.z + dz / d * step;
  const peopleWithRightOfWay = otherPeople(null).filter((p) => p.fig?.role === 'valet' || p.fig?.role === 'rival');
  if (carPathBlocked(c, nextX, nextZ, nextYaw, cars, 0.08)
    || carPathHitsCircle(c, nextX, nextZ, nextYaw, [...G.colliders, ...peopleWithRightOfWay], 0.08)) {
    rd.waitT = (rd.waitT || 0) + dt;
    c.speed = c.vx = c.vz = 0;                      // the AI yields; it never forces its way through a valet's car
    if (rd.waitT > 0.45 && !rd.replanT) {
      const goal = rd.path[rd.path.length - 1];
      const detour = routeAroundLevelProps(c, [goal]);
      if (detour && detour.length) { rd.path = detour; rd.i = 0; }
      rd.replanT = 1.0;
    }
    rd.replanT = Math.max(0, (rd.replanT || 0) - dt);
    if (rd.waitT < 3) return;                       // still yielding; after 3 s he creeps on so two cars can never deadlock
  } else rd.waitT = 0;
  rd.waitT = rd.waitT > 3 ? rd.waitT : 0;
  rd.replanT = Math.max(0, (rd.replanT || 0) - dt);
  const oldX = c.x, oldZ = c.z;
  c.yaw = nextYaw;
  c.x = nextX; c.z = nextZ;
  if (d <= step) rd.i++;
  c.vx = dt > 0 ? (c.x - oldX) / dt : 0;
  c.vz = dt > 0 ? (c.z - oldZ) / dt : 0;
  c.speed = Math.hypot(c.vx, c.vz);
  c.root.position.set(c.x, 0.045, c.z);
  c.root.rotation.y = c.yaw;
  if (rd.i >= rd.path.length) finishRivalCar(c);
}

function rivalExit(x, z) {
  const rv = rush.rival;
  rv.x = x; rv.z = z;
  rv.fig = spawnFigure('rival', x, z, 0);
  rv.state = 'idle';
  rv.think = rv.react;
  return rv.fig;
}

function finishRivalCar(c) {
  const rv = rush.rival, rd = c.rivalDrive;
  c.rivalDrive = null;
  c.speed = 0; c.vx = 0; c.vz = 0;
  if (rd.kind === 'park') {
    const bay = c.slot;
    c.snap = { x0: c.x, z0: c.z, y0: c.yaw, t: 0 };
    c.parked = true;
    c.tagTimer = 0;
    c.tag.visible = false;
    c.leaveIn = rushLeaveDelay() * (0.8 + Math.random() * 0.4);
    c.bump = 0.25;
    bay.car = c;
    rv.parked++;
    ringBurst(bay.x, bay.z, 0xff8a8a);
    const s = worldToScreen(bay.x, bay.z, 1.2);
    popScore('RIVAL PARKED', s.x, s.y, '#ff8a8a');
    rivalExit(bay.x + 1.4, bay.z < 0 ? -2.05 : 3.55);
  } else {
    const call = rd.call;
    c.handoffT = 1.2;                                // waits for the guest, then clears the curb by the front exit lane
    const spots = handoffSpots(c, call.guest);
    boardCar(call.guest, spots.guest);
    if (call.dog) { call.dog.noCollide = true; walkTo(call.dog, [[spots.guest.x, spots.guest.z + 0.5]], 3.8, (f) => poof(f)); }
    if (rush.doorman) { rush.doorman.anim = 'wave'; rush.doorT = 1.3; }
    endCall(call);
    rv.delivered++;
    ringBurst(HANDOFF.x, HANDOFF.z, 0xff8a8a);
    const s = worldToScreen(c.x, c.z, 1.4);
    popScore('RIVAL RETURNED ONE', s.x, s.y, '#ff8a8a');
    c.exitIgnoreFigure = rivalExit(spots.valet.x, spots.valet.z);
  }
  updateRushHUD();
}
