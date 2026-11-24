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
  const pts = slot.z > 0
    ? [{ x: slot.x, z: LANE_CROSS }, { x: slot.x, z: slot.z, yaw: parkYaw }]
    : [{ x: SIDE_L, z: 5.2 }, { x: SIDE_L, z: LANE_BACK }, { x: slot.x, z: LANE_BACK }];
  if (slot.z < 0) pts.push({ x: slot.x, z: slot.z, yaw: parkYaw });
  return pts;
}

// Driving route from a bay to the PICK-UP ring: back out first (heading pinned), then round the open lanes.
export function deliverRoute(slot, carYaw) {
  if (Number.isFinite(slot.layoutYaw)) {
    const mouth = { ...layoutMouth(slot, carYaw), yaw: carYaw };
    return [mouth, ...layoutAisle(slot, mouth), { x: HANDOFF.x, z: HANDOFF.z, yaw: Math.PI / 2 }];
  }
  if (slot.z > 0) {
    return [{ x: slot.x, z: LANE_CROSS, yaw: carYaw }, { x: SIDE_R, z: LANE_CROSS }, { x: SIDE_R, z: 4.8 }, { x: HANDOFF.x, z: HANDOFF.z, yaw: Math.PI / 2 }];
  }
  return [{ x: slot.x, z: LANE_BACK, yaw: carYaw }, { x: SIDE_R, z: LANE_BACK }, { x: SIDE_R, z: 4.8 }, { x: HANDOFF.x, z: HANDOFF.z, yaw: Math.PI / 2 }];
}

export function customExitRoute(slot) {
  if (!Number.isFinite(slot.layoutYaw)) return undefined;
  const mouth = { ...layoutMouth(slot), yaw: slot.yaw };
  return [mouth, ...layoutAisle(slot, mouth), { x: EXIT_X, z: 6.2 }];
}
