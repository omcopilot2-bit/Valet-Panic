import assert from 'node:assert/strict';
import './sim/globals.mjs';

const THREE = await import('three');
const state = await import('../state.js');
const { drive } = await import('../driving.js');
const { G, cars, keys, touchInput } = state;

G.mode = 'classic';
G.colliders = [];
keys.clear();
cars.clear();

const car = {
  id: 'mobile-drive-test',
  x: 0, z: 0, yaw: 0, vx: 0, vz: 3, speed: 3,
  root: new THREE.Group(),
};
cars.add(car);
touchInput.steer = 0;
touchInput.steerTarget = 0;

for (const dt of [1 / 60, 1 / 30, 0.05]) {
  car.x = 0; car.z = 0; car.yaw = 0; car.vx = 0; car.vz = 3; car.speed = 3;
  touchInput.gas = false;
  touchInput.brake = true;
  touchInput.reverse = false;
  let minimumForwardSpeed = Infinity;
  for (let frame = 0; frame < Math.ceil(1.5 / dt); frame++) {
    drive(car, dt);
    minimumForwardSpeed = Math.min(minimumForwardSpeed, car.vz);
  }
  assert.ok(minimumForwardSpeed >= -1e-6, `brake must not select reverse at dt=${dt}`);
  assert.ok(car.speed < 0.02, `brake must stop forward motion at dt=${dt}`);

  touchInput.brake = false;
  touchInput.reverse = true;
  for (let frame = 0; frame < Math.ceil(0.6 / dt); frame++) drive(car, dt);
  assert.ok(car.vz < -0.5, `reverse must drive backwards at dt=${dt}`);

  touchInput.reverse = false;
  touchInput.brake = true;
  let maximumForwardSpeed = -Infinity;
  for (let frame = 0; frame < Math.ceil(1.5 / dt); frame++) {
    drive(car, dt);
    maximumForwardSpeed = Math.max(maximumForwardSpeed, car.vz);
  }
  assert.ok(maximumForwardSpeed <= 1e-6, `braking in reverse must not kick forward at dt=${dt}`);
  assert.ok(car.speed < 0.02, `brake must stop reverse motion at dt=${dt}`);
}

touchInput.brake = false;
touchInput.reverse = false;
cars.clear();
console.log('mobile brake and reverse checks passed');
