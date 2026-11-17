// Waypoints for the AI rival valet: where he walks and drives so he stays in the open lanes instead of cutting through parked cars.
// Pure data and maths (no scene, no DOM), so tests/smoke.mjs can check the routes without a browser.
import { HANDOFF } from './config.js';

export const LANE_BACK = -1.72;      // gap between the two bay rows
export const LANE_FRONT = 5.6;       // open lane in front of the bottom row
export const SIDE_L = -11.4;         // free column on the left (the arrival portico)
export const SIDE_R = 11.4;          // free column on the right
export const APPROACH_TOP = -2.05;   // where a valet stands to reach a car in the top row
export const APPROACH_BOTTOM = 3.55; // ... and in the bottom row

// 'F' = open area in front of the bottom row, 'B' = the lane between the rows, 'M' = anywhere else.
export const zoneOf = (z) => (z > 3 ? 'F' : z < -1.2 ? 'B' : 'M');

// Walking route as [x, z] points. Same zone: straight there. Otherwise round the nearer side column.
export function footRoute(from, to) {
  const zf = zoneOf(from.z);
  if (zf === zoneOf(to.z) && zf !== 'M') return [[to.x, to.z]];
  const sx = from.x + to.x < 0 ? SIDE_L : SIDE_R;
  return [[sx, from.z], [sx, to.z], [to.x, to.z]];
}

// Where the rival must stand to take a car. kind 'park' = a freshly dropped-off car, 'deliver' = a parked car a guest wants back.
export function approachPoint(kind, car) {
  if (kind === 'park') return { x: car.x, z: car.z + 1.7 };
  return { x: car.x, z: car.slot && car.slot.z < 0 ? APPROACH_TOP : APPROACH_BOTTOM };
}

// How close he has to get to grab the car (distance to the car's centre).
export const grabRadius = (kind) => (kind === 'park' ? 2.0 : 2.8);

// Driving route from the drop-off to a bay. A node's `yaw` pins the heading (used for reversing in).
export function parkRoute(slot, parkYaw) {
  const pts = slot.z > 0
    ? [{ x: slot.x, z: LANE_FRONT }]
    : [{ x: SIDE_L, z: 5.2 }, { x: SIDE_L, z: LANE_BACK }, { x: slot.x, z: LANE_BACK }];
  pts.push({ x: slot.x, z: slot.z, yaw: parkYaw });
  return pts;
}

// Driving route from a bay to the PICK-UP ring: back out first (heading pinned), then round the open lanes.
export function deliverRoute(slot, carYaw) {
  if (slot.z > 0) {
    return [{ x: slot.x, z: LANE_FRONT, yaw: carYaw }, { x: HANDOFF.x, z: 5.5 }, { x: HANDOFF.x, z: HANDOFF.z, yaw: Math.PI / 2 }];
  }
  return [{ x: slot.x, z: LANE_BACK, yaw: carYaw }, { x: SIDE_R, z: LANE_BACK }, { x: SIDE_R, z: 4.8 }, { x: HANDOFF.x, z: HANDOFF.z, yaw: Math.PI / 2 }];
}
