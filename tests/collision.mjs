import assert from 'node:assert/strict';
import { carPathHitsCircle, circleVsParkingBox } from '../collision.js';

const car = { x: -16.3, z: 5.9, yaw: Math.PI / 2 };
const planter = { x: -13.55, z: 4.2, r: 1.15, halfX: 0.8, halfZ: 0.8 };

assert.equal(carPathHitsCircle(car, -10.4, 5.9, car.yaw, [planter], 0.02), false,
  'a car must have a clear path along the marked drop-off lane beside the square planter');
assert.equal(carPathHitsCircle(car, -13.55, 4.2, car.yaw, [planter], 0.02), true,
  'the planter footprint must remain solid');
assert.equal(carPathHitsCircle(car, -13.55, 4.2, car.yaw, [{ ...planter, disabled: true }], 0.02), false,
  'a temporarily ghosted recovery obstacle must release a jammed car');
console.log('collision regression checks passed');

const angledStall = { x: 0, z: 0, yaw: Math.PI / 6 };
assert.equal(circleVsParkingBox(0, 0, 0.3, angledStall, 0.95, 1.45)?.depth > 0, true,
  'a walker in a 60-degree closed stall must collide with the rotated footprint');
assert.equal(circleVsParkingBox(0, 2.4, 0.3, angledStall, 0.95, 1.45), null,
  'a walker outside the rotated stall footprint must remain free');
