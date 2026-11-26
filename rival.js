// The rival valet: an AI opponent that races you for the same cars. Split out of shifts.js; it only reads and writes the shared `rush` / `cars` state.
import { buildPlan, clearanceFn, routeAround, stepDrive } from './autodrive.js';
import { HANDOFF, PARKED_HALF, reduceMotion } from './config.js';
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
const RIVAL_HOME = { x: -6.2, z: 7.5 };
const RIVAL_LINES = ['Too slow!', 'Mine!', 'Thanks, rookie!', 'Beep beep!', 'Keys, please!'];
// His cruise speed is rv.drive x this. The shared driver brakes for bends, reverses and creeps into bays like a person would,
// so a trip takes ~2 s longer than the old fixed-speed slide; raise this to make him quicker, lower it to ease him off.
const RIVAL_PACE = 1.3;

// Everything solid he has to steer round: level props, closed bays and every other car.
function obstaclesFor(car) {
  return [
    ...G.colliders.filter((o) => !o.disabled),
    ...slots.filter((s) => s.closed).map((s) => ({ x: s.x, z: s.z, r: Math.hypot(PARKED_HALF.x, PARKED_HALF.z) })),
    ...[...cars].filter((o) => o !== car).map((o) => ({ x: o.x, z: o.z, r: 1.0 })),
  ];
}

// The part of a route still to drive: from the node nearest the car on (a replan must not restart the manoeuvre from scratch).
function remainingRoute(car, route) {
  let best = 0, bestD = Infinity;
  route.forEach((n, i) => { const d = Math.hypot(n.x - car.x, n.z - car.z); if (d < bestD) { bestD = d; best = i; } });
  if (bestD < 0.8 && best < route.length - 1) best++;
  return route.slice(best);
}

// A smooth, drivable plan from where the car is now through the route (see autodrive.js).
function planDrive(car, route) {
  const obstacles = obstaclesFor(car);
  return buildPlan(car, routeAround(car, route, obstacles), { clear: clearanceFn(obstacles) });
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
    const route = parkRoute(s, parkYaw(s));
    car.rivalDrive = { kind: 'park', route, plan: planDrive(car, route), speed: rv.drive * RIVAL_PACE, waitT: 0, ghostT: 0, replanT: 0, age: 0 };
  } else {
    t.call.state = 'rival';
    t.call.slot = s;
    const route = deliverRoute(s, car.yaw);
    car.rivalDrive = { kind: 'deliver', call: t.call, route, plan: planDrive(car, route), speed: rv.drive * RIVAL_PACE, waitT: 0, ghostT: 0, replanT: 0, age: 0 };
    if (s) s.car = null;
    car.slot = null;
    car.parked = false;
    car.snap = null;
  }
  bubble(rline(RIVAL_LINES), car.x, car.z, 2.4);
  audio.play('honk', 0, 'beep');
}

export function stepRivalCar(c, dt) {
  const rd = c.rivalDrive;
  rd.age += dt;
  // The route already goes round every prop and parked car, so only things that MOVE can stop him: other cars on the move.
  // Valets on foot only make him crawl (cars push walkers aside), so a figure standing beside the car never traps it in a tight spot.
  const movers = [...cars].filter((o) => o !== c && !o.parked);
  const people = otherPeople(null).filter((p) => p.fig?.role === 'valet' || p.fig?.role === 'rival');
  const blocked = (x, z, yaw) => carPathBlocked(c, x, z, yaw, movers, 0.08);
  const nearPerson = (x, z, yaw) => carPathHitsCircle(c, x, z, yaw, people, 0.02);
  rd.ghostT = Math.max(0, rd.ghostT - dt);
  rd.replanT = Math.max(0, rd.replanT - dt);
  const state = stepDrive(c, rd.plan, dt, { maxSpeed: rd.speed, blocked: rd.ghostT > 0 ? null : blocked, slow: nearPerson, fx: !reduceMotion });
  if (state === 'blocked') {
    rd.waitT = rd.plan.waitT;
    // Another car is in the way: he stops. After a moment he looks for a way round (from where he is, through the rest of the route),
    // and after a second more he eases through anyway, so the duel can never deadlock.
    if (rd.waitT > 0.45 && !rd.replanT) {
      rd.plan = planDrive(c, remainingRoute(c, rd.route));
      rd.replanT = 1.0;
    }
    if (rd.waitT > 1.5) rd.ghostT = 1.2;
  }
  c.root.position.set(c.x, 0.045, c.z);
  c.root.rotation.y = c.yaw;
  if (state === 'done' || rd.age > 45) finishRivalCar(c);   // a drive can never take forever
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
