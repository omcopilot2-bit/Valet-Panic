// Waypoints for the AI rival valet: where he walks and drives so he stays in the open lanes instead of cutting through parked cars.
// Pure data and maths (no scene, no DOM), so tests/smoke.mjs can check the routes without a browser.
import { CONE_ALLEY_ROAD, DROPOFF, HANDOFF } from './config.js';

export const LANE_BACK = -1.72;      // gap between the two bay rows
export const LANE_FRONT = 5.6;       // open lane in front of the bottom row
export const LANE_CROSS = 3.3;       // below the level hazards, for obstacle-aware rival routing
export const SIDE_L = -11.4;         // free column on the left (the arrival portico)
export const SIDE_R = 11.4;          // free column on the right
export const EXIT_X = 16.2;          // cars are disposed once their centre clears x=15
export const APPROACH_TOP = -2.05;   // where a valet stands to reach a car in the top row
export const APPROACH_BOTTOM = 3.55; // ... and in the bottom row

export function coneAlleyArrivalRoute() {
  return [
    { x: DROPOFF.x, z: CONE_ALLEY_ROAD.arrivalStartZ, yaw: 0 },
    { x: DROPOFF.x, z: DROPOFF.z, yaw: 0 },
  ];
}

export function coneAlleyExitRoute() {
  return [
    { x: HANDOFF.x, z: CONE_ALLEY_ROAD.exitJoinZ },
    { x: CONE_ALLEY_ROAD.rightX, z: CONE_ALLEY_ROAD.exitJoinZ },
    { x: CONE_ALLEY_ROAD.rightX, z: CONE_ALLEY_ROAD.exitZ },
  ];
}

// 'F' = open area in front of the bottom row, 'B' = the lane between the rows, 'M' = anywhere else.
export const zoneOf = (z) => (z > 3 ? 'F' : z < -1.2 ? 'B' : 'M');

// Walking route as [x, z] points. Same zone: straight there. Otherwise round the nearer side column.
export function footRoute(from, to) {
  const zf = zoneOf(from.z);
  if (zf === zoneOf(to.z) && zf !== 'M') return [[to.x, to.z]];
  const sx = from.x + to.x < 0 ? SIDE_L : SIDE_R;
  return [[sx, from.z], [sx, to.z], [to.x, to.z]];
}

function layoutMouth(slot, yaw = slot.yaw, distance = 2.2) {
  const direction = slot.mouthDirection || -1;
  return {
    x: slot.x + direction * Math.sin(yaw) * distance,
    z: slot.z + direction * Math.cos(yaw) * distance,
  };
}

function layoutAisle(slot, mouth) {
  if (slot.routePlan === 'casino') {
    return [{ x: slot.routeSideX, z: mouth.z }, { x: slot.routeSideX, z: LANE_FRONT }];
  }
  return [{ x: SIDE_R, z: 5.6 }];
}

// Where the rival must stand to take a car. kind 'park' = a freshly dropped-off car, 'deliver' = a parked car a guest wants back.
export function approachPoint(kind, car) {
  if (kind === 'park') return { x: car.x, z: car.z + 1.7 };
  if (car.slot && Number.isFinite(car.slot.layoutYaw)) {
    return layoutMouth(car.slot, car.slot.yaw, 2.0);
  }
  return { x: car.x, z: car.slot && car.slot.z < 0 ? APPROACH_TOP : APPROACH_BOTTOM };
}

// How close he has to get to grab the car (distance to the car's centre).
export const grabRadius = (kind) => (kind === 'park' ? 2.0 : 2.8);

// Driving route from the drop-off to a bay. A node's `yaw` pins the heading (used for reversing in).
export function parkRoute(slot, parkYaw) {
  if (Number.isFinite(slot.layoutYaw)) {
    return [layoutMouth(slot, parkYaw), { x: slot.x, z: slot.z, yaw: parkYaw }];
  }
  const bottom = slot.z > 0;
  const backIn = Math.cos(parkYaw) > 0.01;   // nose-out bays: the car has to reverse in
  const lane = bottom ? LANE_CROSS : LANE_BACK;
  // Reversing in: drive past the bay, stop, then back round into it (a pinned heading that points away from the way the car
  // travels makes the driver reverse the last stretch by itself).
  const swing = backIn ? [{ x: slot.x + 1.9, z: bottom ? 4.9 : LANE_BACK }, { x: slot.x, z: bottom ? 3.7 : -2.0, rev: true }] : [];
  const pts = bottom
    ? (backIn ? swing : [{ x: slot.x, z: 4.5 }])
    : [{ x: SIDE_L, z: 5.2 }, { x: SIDE_L, z: LANE_BACK }, ...(backIn ? swing : [{ x: slot.x - 1.2, z: LANE_BACK + 0.45 }, { x: slot.x, z: LANE_BACK }])];
  pts.push({ x: slot.x, z: slot.z, yaw: parkYaw });
  return pts;
}

// Last stretch into the PICK-UP ring (x 10.4, facing +x like the player). Coming from the west it is one straight roll in,
// so the car arrives already pointing the right way. Coming down the right-hand column (top-row bays) it swings in and
// stops facing south. The old route ran on to x 11.4 first and then slid back into the ring while spinning on the spot.
const RING_LEAD = 2.6;
export function ringApproach(fromX) {
  if (fromX <= HANDOFF.x - 1.2) {
    const lead = { x: HANDOFF.x - RING_LEAD, z: HANDOFF.z };
    return (fromX < lead.x - 0.8 ? [lead] : []).concat([{ x: HANDOFF.x, z: HANDOFF.z }]);
  }
  return [{ x: HANDOFF.x, z: HANDOFF.z - 0.9 }, { x: HANDOFF.x, z: HANDOFF.z }];
}

// Driving route from a bay to the PICK-UP ring: back out first (heading pinned), then round the open lanes.
export function deliverRoute(slot, carYaw) {
  if (Number.isFinite(slot.layoutYaw)) {
    const mouth = { ...layoutMouth(slot, carYaw), yaw: carYaw };
    const aisle = layoutAisle(slot, mouth);
    // The aisle may end east of the ring: the last node then rolls in without a pinned heading (a pinned one made the car spin on the spot).
    return [mouth, ...aisle, { x: HANDOFF.x, z: HANDOFF.z }];
  }
  const bottom = slot.z > 0;
  // A nose-in car backs out straight, then keeps reversing along the aisle: the curve swings its nose round to face the ring,
  // so it can drive off forwards with room to spare. A nose-out car just drives out.
  const backing = Math.cos(carYaw) < -0.01;
  const lane = bottom ? 4.9 : LANE_BACK;
  const out = backing
    // swing as far as 2.4, but never into the props on the left
    ? [{ x: slot.x, z: lane, rev: true }, { x: slot.x - Math.max(0.9, Math.min(2.4, slot.x + 11)), z: lane, rev: true }]
    : [{ x: slot.x, z: lane }];
  const outX = out[out.length - 1].x;
  if (bottom) return [...out, ...ringApproach(outX)];
  // Top row: along the gap between the rows to the right-hand column, down it, then into the ring.
  return [...out, { x: SIDE_R, z: LANE_BACK }, { x: SIDE_R, z: LANE_CROSS }, ...ringApproach(SIDE_R)];
}

export function customExitRoute(slot) {
  if (!Number.isFinite(slot.layoutYaw)) return undefined;
  const mouth = { ...layoutMouth(slot), yaw: slot.yaw };
  return [mouth, ...layoutAisle(slot, mouth), { x: EXIT_X, z: 6.2 }];
}
