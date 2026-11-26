import assert from 'node:assert/strict';
import './sim/globals.mjs';
const THREE = await import('three');
const { G, cars } = await import('../state.js');
const { stepRivalCar } = await import('../rival.js');

function makeCar(id, x, z, yaw, path, speed = 3.4) {
  return {
    id, x, z, yaw, vx: 0, vz: 0, speed: 0, root: new THREE.Group(),
    rivalDrive: { kind: 'park', path, i: 0, speed, steer: 0 },
  };
}

G.colliders = [];
cars.clear();
const turningCar = makeCar('turning', 0, 0, 0, [{ x: 30, z: 0 }]);
cars.add(turningCar);
for (let i = 0; i < 120; i++) {
  const oldX = turningCar.x, oldZ = turningCar.z;
  const oldYaw = turningCar.yaw;
  stepRivalCar(turningCar, 1 / 60);
  const dx = turningCar.x - oldX, dz = turningCar.z - oldZ;
  const yawChange = Math.atan2(
    Math.sin(turningCar.yaw - oldYaw),
    Math.cos(turningCar.yaw - oldYaw),
  );
  assert.ok(Math.abs(yawChange) <= 3.2 / 60 + 1e-6, 'rival steering turns gradually');
  assert.ok(dx >= 0 && Math.abs(dz) < 1e-8, 'rival keeps moving directly along its route');
}
assert.ok(Math.abs(turningCar.yaw - Math.PI / 2) < 0.05, 'rival smoothly aligns with its waypoint');

cars.clear();
const pinnedCar = makeCar('pinned', 0, 0, Math.PI, [
  { x: 0.4, z: 0, yaw: Math.PI },
  { x: 5, z: 0 },
]);
cars.add(pinnedCar);
for (let i = 0; i < 60; i++) stepRivalCar(pinnedCar, 1 / 60);
assert.equal(pinnedCar.rivalDrive.i, 1, 'rival clears a nearby pinned-heading waypoint');

const reverseCar = makeCar('reverse', 0, 0, 0, [{ x: 0.5, z: 0, yaw: Math.PI }, { x: 50, z: 0 }]);
cars.clear();
cars.add(reverseCar);
for (let i = 0; i < 180; i++) {
  const oldYaw = reverseCar.yaw;
  stepRivalCar(reverseCar, 1 / 60);
  const yawChange = Math.atan2(
    Math.sin(reverseCar.yaw - oldYaw),
    Math.cos(reverseCar.yaw - oldYaw),
  );
  assert.ok(Math.abs(yawChange) <= 3.2 / 60 + 1e-6, 'reverse approach keeps rotating at the normal steering rate');
  if (reverseCar.rivalDrive.i === 1) break;
}
assert.equal(reverseCar.rivalDrive.i, 1, 'reverse approach waits to align instead of snapping at the waypoint');
assert.ok(Math.abs(Math.atan2(Math.sin(reverseCar.yaw - Math.PI), Math.cos(reverseCar.yaw - Math.PI))) < 0.05,
  'reverse approach finishes facing its pinned heading');

const pinnedWrapCar = makeCar('pinned-wrap', 0, 0, Math.PI + 0.01, [
  { x: 0, z: 0, yaw: -Math.PI + 0.01 },
  { x: 50, z: 0 },
]);
cars.clear();
cars.add(pinnedWrapCar);
stepRivalCar(pinnedWrapCar, 1 / 60);
assert.ok(Math.abs(pinnedWrapCar.yaw - (Math.PI + 0.01)) < 1e-6,
  'pinned headings equivalent across the angle boundary do not snap a full rotation');

const wraparoundCar = makeCar('wraparound', 0, 0, Math.PI - 0.01, [{ x: -0.3, z: -10 }]);
cars.clear();
cars.add(wraparoundCar);
stepRivalCar(wraparoundCar, 1 / 60);
const yawChange = Math.atan2(
  Math.sin(wraparoundCar.yaw - (Math.PI - 0.01)),
  Math.cos(wraparoundCar.yaw - (Math.PI - 0.01)),
);
assert.ok(Math.abs(yawChange) < 0.1, 'rival takes the short turn across the angle boundary');

const squeezingCar = makeCar('squeezing', 0, 0, Math.PI / 2, [{ x: 10, z: 0 }]);
cars.clear();
cars.add(squeezingCar);
G.colliders = [{ x: 1.7, z: 0.95, r: 0.2 }];
stepRivalCar(squeezingCar, 0.3);
assert.ok(squeezingCar.x > 0 && squeezingCar.speed > 0,
  'rival keeps moving when a small sideways adjustment clears an obstacle');
assert.ok(squeezingCar.z < 0, 'rival squeezes past the clear side instead of only braking short');
G.colliders = [];

const nearGoalCar = makeCar('near-goal', 0, 0, Math.PI / 2, [{ x: 1.02, z: 0 }, { x: 50, z: 0 }]);
cars.clear();
cars.add(nearGoalCar);
G.colliders = [{ x: 1, z: 0.95, r: 0.2 }];
stepRivalCar(nearGoalCar, 0.3);
assert.ok(nearGoalCar.z < 0 && nearGoalCar.rivalDrive.i === 0,
  'an obstacle sidestep does not mark the unreached waypoint complete');
stepRivalCar(nearGoalCar, 0.3);
assert.equal(nearGoalCar.rivalDrive.i, 1, 'rival rejoins the route after clearing the obstacle');
G.colliders = [];

console.log('rival steering checks passed');
