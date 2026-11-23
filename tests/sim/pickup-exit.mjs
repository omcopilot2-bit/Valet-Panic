import assert from 'node:assert/strict';
import './globals.mjs';
const P = new URL('../../', import.meta.url).href;
const THREE = await import('three');
const core = await import(P + 'core.js');
const state = await import(P + 'state.js');
const people = await import(P + 'people.js');
const driving = await import(P + 'driving.js');

state.G.colliders = [];
state.cars.clear();
const car = {
  x: 10.4, z: 5.4, yaw: Math.PI / 2, exitLane: 7.6,
  vx: 0, vz: 0, speed: 0, root: new THREE.Group(),
};
state.cars.add(car);
const justExitedValet = people.spawnFigure('valet', car.x, car.z, 0);
justExitedValet.popIn = 0.15;
car.exitIgnoreFigure = justExitedValet;
for (let i = 0; i < 60; i++) driving.stepExit(car, 1 / 30);
assert.ok(car.z > 6.2, 'a car must pull away from the pick-up after its own valet gets out');
console.log('pickup self-clearance check passed');
