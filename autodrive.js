// The driver behind every AI car (the rival, arriving guests, cars leaving the lot).
// Pure maths: no scene and no DOM, so tests/ can run whole drives in node.
//
// It works like a person at the wheel instead of a point chasing waypoints:
//   - the route is turned into smooth curves (corners are rounded, but only as far as the lane allows);
//   - the car has a speed: it accelerates, brakes for bends, for the end of the route and for anything in its way;
//   - the wheel turns at a limited rate and the car only turns while it rolls (the same rule your own car follows);
//   - reversing is real: it stops at a gear change, backs tail-first along the curve, then drives off again;
//   - it looks ahead along the path (pure pursuit), so it eases into bends and straightens up on the final approach.
import { BOUNDS } from './config.js';

export const DRIVER = {
  turnRate: 1.5,      // max yaw rate (rad/s) once rolling: the same number drive() uses for your car
  rollSpeed: 1.3,     // below this speed the wheel bites less, so a car never spins on the spot
  accel: 7.5,
  revAccel: 4.6,
  brake: 10,
  latAccel: 6,      // how hard it is willing to corner: sets the speed through a bend
  steerRate: 6,       // how fast the wheel moves (full lock in ~0.17 s): the lag that stops twitchy steering
  revSpeed: 3.6,      // fastest reverse
  gearPause: 0.1,     // seconds stopped when it changes gear
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- finding a way round obstacles (A* on a grid, then straightened) ---------- */
export const GRID_CLEAR = 1.05;   // 1.35 was wider than the aisles and left the rival boxed in

const hitsObstacle = (o, px, pz, clear) => {
  if (o.halfX !== undefined && o.halfZ !== undefined) {
    const qx = Math.max(o.x - o.halfX, Math.min(px, o.x + o.halfX));
    const qz = Math.max(o.z - o.halfZ, Math.min(pz, o.z + o.halfZ));
    return Math.hypot(px - qx, pz - qz) < clear;
  }
  return Math.hypot(px - o.x, pz - o.z) < o.r + clear;
};

function gridPath(from, to, obstacles) {
  const step = 0.45;
  const minX = Math.floor(BOUNDS.minX / step), maxX = Math.ceil(BOUNDS.maxX / step);
  const minZ = Math.floor(BOUNDS.minZ / step), maxZ = Math.ceil(BOUNDS.maxZ / step);
  const start = { x: Math.round(from.x / step), z: Math.round(from.z / step) };
  const goal = { x: Math.round(to.x / step), z: Math.round(to.z / step) };
  const key = (x, z) => `${x},${z}`;
  const blocked = (x, z) => obstacles.some((o) => hitsObstacle(o, x * step, z * step, GRID_CLEAR));
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

// Collapse the grid's stair steps into long clear segments.
function smoothGridPath(from, path, obstacles) {
  const clearSegment = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.18));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (obstacles.some((o) => hitsObstacle(o, a.x + dx * f, a.z + dz * f, GRID_CLEAR))) return false;
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

// Takes route nodes ({x, z, yaw?, rev?}) and returns the same route with extra nodes that go round the obstacles
// ({x, z, r} circles or {x, z, halfX, halfZ} boxes). A reverse leg stays a reverse leg. Nodes keep their flags.
export function routeAround(from, route, obstacles) {
  if (!obstacles.length) return route;
  const out = [];
  let at = { x: from.x, z: from.z };
  for (let point of route) {
    const goal = { x: clamp(point.x, BOUNDS.minX, BOUNDS.maxX), z: clamp(point.z, BOUNDS.minZ, BOUNDS.maxZ) };   // off-screen exits are not on the grid
    // An exit goal off the edge of the grid can land inside a prop (the back lane runs into a planter): aim for the nearest free spot instead.
    if (goal.x !== point.x || goal.z !== point.z) {
      for (let r = 0; r <= 3.2 && obstacles.some((o) => hitsObstacle(o, goal.x, goal.z, GRID_CLEAR)); r += 0.45) {
        const free = [0, 1, -1].flatMap((s) => [s * r]).map((dz) => ({ x: goal.x, z: clamp(point.z + dz, BOUNDS.minZ, BOUNDS.maxZ) })).find((p) => !obstacles.some((o) => hitsObstacle(o, p.x, p.z, GRID_CLEAR)));
        if (free) { goal.z = free.z; break; }
      }
    }
    if (goal.z !== clamp(point.z, BOUNDS.minZ, BOUNDS.maxZ)) point = { ...point, z: goal.z };   // stay on the clear line all the way off-screen
    const leg = gridPath(at, goal, obstacles);
    if (leg) {
      const mid = smoothGridPath(at, leg, obstacles).map((p) => (point.rev ? { ...p, rev: true } : p));
      if (mid.length && Math.hypot(mid[mid.length - 1].x - point.x, mid[mid.length - 1].z - point.z) < 0.5) mid.pop();   // the real node carries the flags
      out.push(...mid, point);
    } else out.push(point);   // a moving car can sit on the target for a moment: the driver waits and replans
    at = point;
  }
  return out;
}

// True when a car-sized circle at (x, z) clears every obstacle by `margin` beyond its own radius.
export const clearanceFn = (obstacles, margin = 0.85) => (x, z) => !obstacles.some((o) => hitsObstacle(o, x, z, margin));

/* ---------- turning route nodes into a smooth drivable plan ---------- */
function densify(nodes) {
  const pts = [{ x: nodes[0].x, z: nodes[0].z }];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return pts;
}

// Round every bend with a quadratic curve, as wide as the lane allows: if a rounded corner would touch something,
// it is retried tighter, down to a sharp corner (which the car then takes slowly).
function smoothPolyline(nodes, clear) {
  if (nodes.length < 3) return densify(nodes);
  let cut = 1.7;
  for (let attempt = 0; attempt < 4; attempt++, cut *= 0.55) {
    const out = [nodes[0]];
    let ok = true;
    for (let i = 1; i < nodes.length - 1 && ok; i++) {
      const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      const ux = (b.x - a.x) / l1, uz = (b.z - a.z) / l1, vx = (c.x - b.x) / l2, vz = (c.z - b.z) / l2;
      if (Math.acos(clamp(ux * vx + uz * vz, -1, 1)) < 0.09) { out.push(b); continue; }
      const d = Math.min(cut, l1 * 0.45, l2 * 0.45);
      const p0 = { x: b.x - ux * d, z: b.z - uz * d }, p2 = { x: b.x + vx * d, z: b.z + vz * d };
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const u = 1 - t;
        const x = u * u * p0.x + 2 * u * t * b.x + t * t * p2.x, z = u * u * p0.z + 2 * u * t * b.z + t * t * p2.z;
        if (clear && !clear(x, z)) { ok = false; break; }
        out.push({ x, z });
      }
    }
    if (ok) { out.push(nodes[nodes.length - 1]); return densify(out); }
  }
  return densify(nodes);
}

// start: { x, z, yaw }.  nodes: route nodes { x, z, yaw?, rev? }.
// A node flagged rev, or pinned to a heading that points away from the way the car travels to it, is reached in reverse.
// options: clear (x, z) -> bool for rounding corners safely, flow (never slow down for the end: cars driving off),
//          v0 (speed already rolling, for a car that arrives from off-screen).
export function buildPlan(start, nodes, o = {}) {
  const pts = [{ x: start.x, z: start.z }], gears = [];
  for (const n of nodes) {
    const p = pts[pts.length - 1];
    const dx = n.x - p.x, dz = n.z - p.z;
    if (Math.hypot(dx, dz) < 0.05) continue;
    let g = 1;
    if (n.rev) g = -1;
    else if (n.yaw !== undefined && Math.sin(n.yaw) * dx + Math.cos(n.yaw) * dz < 0) g = -1;
    pts.push({ x: n.x, z: n.z });
    gears.push(g);
  }
  const segs = [];
  let cur = null;
  for (let i = 0; i < gears.length; i++) {
    if (!cur || cur.gear !== gears[i]) { cur = { gear: gears[i], nodes: [pts[i]] }; segs.push(cur); }
    cur.nodes.push(pts[i + 1]);
  }
  for (const s of segs) {
    s.pts = smoothPolyline(s.nodes, o.clear);
    s.cum = [0];
    for (let i = 1; i < s.pts.length; i++) s.cum.push(s.cum[i - 1] + Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].z - s.pts[i - 1].z));
  }
  return { segs, si: 0, k: 0, v: o.v0 || 0, steer: 0, pause: 0, waitT: 0, flow: !!o.flow, done: segs.length === 0 };
}

export const planEnd = (plan) => {
  const s = plan.segs[plan.segs.length - 1];
  return s ? s.pts[s.pts.length - 1] : null;
};

/* ---------- driving the plan ---------- */
// Moves the car one frame along the plan. options: maxSpeed, blocked(x, z, yaw) -> bool (something solid and moving: brake and wait),
// slow(x, z, yaw) -> bool (people on foot: crawl past), fx (body roll and pitch).
// Returns 'driving', 'blocked' (braking for something in the way) or 'done'.
export function stepDrive(car, plan, dt, o = {}) {
  const seg = plan.segs[plan.si];
  if (plan.done || !seg) { plan.done = true; return 'done'; }
  const g = seg.gear, pts = seg.pts, cum = seg.cum, last = pts.length - 1;
  const prevV = plan.v;

  let status = 'driving', vt = 0, ang = 0, braking = false;
  if (plan.pause > 0) {
    plan.pause -= dt;
    plan.v = 0;
    braking = true;
  } else {
    // where along the path the car is
    let k = plan.k, dk = Math.hypot(pts[k].x - car.x, pts[k].z - car.z);
    while (k < last) {
      const dn = Math.hypot(pts[k + 1].x - car.x, pts[k + 1].z - car.z);
      if (dn > dk) break;
      k++; dk = dn;
    }
    plan.k = k;
    const travel = car.yaw + (g < 0 ? Math.PI : 0);
    const rem = k >= last ? Math.max(0, (pts[last].x - car.x) * Math.sin(travel) + (pts[last].z - car.z) * Math.cos(travel)) : cum[last] - cum[k] + dk * 0.5;

    // steering (Stanley): follow the path's curvature, then remove the heading error and the sideways offset from the path
    const sp = plan.v;
    const isLast = plan.si === plan.segs.length - 1;
    const stops = !(isLast && plan.flow);     // this stretch ends in a stop (a bay, a ring, a gear change)
    const ka = Math.min(k, Math.max(0, last - 2)), kb = Math.min(ka + 2, last), kc = Math.min(ka + 5, last);
    const tangent = Math.atan2(pts[kb].x - pts[ka].x, pts[kb].z - pts[ka].z);
    const ahead = Math.atan2(pts[kc].x - pts[kb].x, pts[kc].z - pts[kb].z);
    const curvature = kc > kb ? wrap(ahead - tangent) / Math.max(0.2, cum[kc] - cum[ka] - (cum[kb] - cum[ka]) * 0.5 - 0.1) : 0;
    const side = (car.x - pts[ka].x) * Math.cos(tangent) - (car.z - pts[ka].z) * Math.sin(tangent);   // + = displaced towards increasing yaw
    const vEff = Math.max(sp, 0.7);
    ang = wrap(tangent - travel) - Math.atan(2.4 * side / (vEff + 0.6));
    const sf = Math.min(1, vEff / DRIVER.rollSpeed);
    const cmd = clamp((curvature * vEff + 2.8 * ang) / (DRIVER.turnRate * sf), -1, 1);
    plan.steer += clamp(cmd - plan.steer, -DRIVER.steerRate * dt, DRIVER.steerRate * dt);

    // speed: the slowest of the cruise speed, the next bend, the car's own heading error and the end of the route
    const vMax = g > 0 ? o.maxSpeed : Math.min(o.maxSpeed, DRIVER.revSpeed);
    const horizon = 2.6 + sp * 0.8;
    let kmax = 0, h0 = null;
    for (let i = k; i + 3 <= last && cum[i] - cum[k] < horizon; i += 3) {
      const h1 = Math.atan2(pts[i + 3].x - pts[i].x, pts[i + 3].z - pts[i].z);
      if (h0 !== null) kmax = Math.max(kmax, Math.abs(wrap(h1 - h0)) / Math.max(0.2, cum[i + 3] - cum[i]));
      h0 = h1;
    }
    const vCurve = kmax > 0.02 ? Math.max(1.15, Math.sqrt(DRIVER.latAccel / kmax)) : Infinity;
    const vAlign = Math.max(0.9, vMax * (1 - 0.65 * Math.min(1, Math.abs(ang) / 1.3)));
    const vEnd = stops ? Math.min(Math.sqrt(2 * DRIVER.brake * 0.75 * Math.max(0, rem - 0.05)), 0.8 + rem * 0.5) : Infinity;   // and it creeps in the last metre or two
    vt = Math.min(vMax, vCurve, vAlign, vEnd);
    if (rem > 0.05) vt = Math.max(vt, Math.min(0.5, vMax));   // never stall a hair short of the end

    // traffic: look where the car will be and stop short of anything there
    if (o.blocked) {
      const reach = 0.75 + sp * 0.45 + sp * sp / (2 * DRIVER.brake);
      const dirX = Math.sin(travel), dirZ = Math.cos(travel);
      if (o.blocked(car.x + dirX * reach, car.z + dirZ * reach, car.yaw)) { vt = 0; status = 'blocked'; }
    }
    // people on foot in the way: ease past at a crawl and let them step aside (cars already push walkers out of the way), never stop
    if (o.slow && status !== 'blocked') {
      const reach = 0.75 + sp * 0.45;
      if (o.slow(car.x + Math.sin(travel) * reach, car.z + Math.cos(travel) * reach, car.yaw)) vt = Math.max(Math.min(vt, 1.1), Math.min(0.6, vMax));
    }

    // throttle and brake
    if (plan.v < vt) plan.v = Math.min(vt, plan.v + (g > 0 ? DRIVER.accel : DRIVER.revAccel) * dt);
    else plan.v = Math.max(vt, plan.v - DRIVER.brake * dt);
    braking = plan.v < prevV - 0.02 * 60 * dt || (vt === 0 && plan.v < 0.2);

    // roll: the car only turns while it moves
    const dyaw = plan.steer * DRIVER.turnRate * Math.min(1, plan.v / DRIVER.rollSpeed) * dt;
    const mid = car.yaw + dyaw * 0.5;
    car.yaw += dyaw;
    car.x += Math.sin(mid) * plan.v * g * dt;
    car.z += Math.cos(mid) * plan.v * g * dt;

    // end of this stretch
    const endD = Math.hypot(pts[last].x - car.x, pts[last].z - car.z);
    const past = (pts[last].x - car.x) * Math.sin(car.yaw + (g < 0 ? Math.PI : 0)) + (pts[last].z - car.z) * Math.cos(car.yaw + (g < 0 ? Math.PI : 0)) < 0;
    if (k >= last - 1 && (endD < 0.14 || past || rem < 0.05) && !(plan.flow && plan.si === plan.segs.length - 1)) {
      plan.v = 0;
      if (plan.si === plan.segs.length - 1) plan.done = true;
      else { plan.si++; plan.k = 0; plan.pause = DRIVER.gearPause; }
    } else if (plan.flow && plan.si === plan.segs.length - 1 && k >= last && (endD < 0.3 || past || rem < 0.05)) plan.done = true;
  }

  car.vx = Math.sin(car.yaw) * plan.v * g;
  car.vz = Math.cos(car.yaw) * plan.v * g;
  car.speed = plan.v;
  plan.waitT = status === 'blocked' && plan.v < 0.05 ? plan.waitT + dt : status === 'blocked' ? plan.waitT : 0;

  // lights and body: the same cues your own car shows
  if (car.tailMat) car.tailMat.color.setHex(braking ? 0xff2a1a : g < 0 && plan.v > 0.05 ? 0xffe8c0 : 0x7a1410);
  if (o.fx && car.body) {
    const accelAlong = dt > 0 ? (plan.v - prevV) / dt * g : 0;
    const roll = clamp(plan.steer * Math.min(1, plan.v / 3) * 0.035, -0.04, 0.04);
    const pitch = clamp(accelAlong * 0.0035, -0.03, 0.03);
    const blend = Math.min(1, dt * 6);
    car.body.rotation.z += (roll - car.body.rotation.z) * blend;
    car.body.rotation.x += (pitch - car.body.rotation.x) * blend;
  }
  if (plan.done) {
    if (car.tailMat) car.tailMat.color.setHex(0x7a1410);                                   // parked: lights back to idle
    if (o.fx && car.body) { car.body.rotation.x = 0; car.body.rotation.z = 0; }
    return 'done';
  }
  return status;
}
