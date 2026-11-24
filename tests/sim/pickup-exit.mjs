import assert from 'node:assert/strict';
import './globals.mjs';
const P = new URL('../../', import.meta.url).href;
const THREE = await import('three');
const core = await import(P + 'core.js');
const state = await import(P + 'state.js');
const people = await import(P + 'people.js');
const driving = await import(P + 'driving.js');
const cfg = await import(P + 'config.js');
const routes = await import(P + 'routes.js');

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

state.cars.clear();
const coneCar = {
  x: cfg.HANDOFF.x, z: cfg.HANDOFF.z, yaw: Math.PI / 2, exitLane: 7.6,
  exitRoute: routes.coneAlleyExitRoute(), exitRouteIndex: 0,
  exitIgnoreFigure: justExitedValet, vx: 0, vz: 0, speed: 0, root: new THREE.Group(),
};
state.cars.add(coneCar);
let joinedRightRoad = false;
let droveDownRightRoad = false;
let finished = false;
for (let i = 0; i < 600; i++) {
  finished = driving.stepExit(coneCar, 1 / 30);
  if (coneCar.x >= cfg.CONE_ALLEY_ROAD.rightX - 0.35 && coneCar.z <= cfg.CONE_ALLEY_ROAD.exitJoinZ + 0.35) {
    joinedRightRoad = true;
  }
  if (joinedRightRoad && coneCar.z > cfg.CONE_ALLEY_ROAD.exitJoinZ + 0.1) droveDownRightRoad = true;
  if (finished) break;
}
assert.ok(joinedRightRoad, 'a Cone Alley departure must reach the right-side road');
assert.ok(droveDownRightRoad, 'a Cone Alley departure must drive down the right-side road');
assert.ok(finished, 'a routed car must finish after reaching its final waypoint');
assert.ok(Math.abs(coneCar.x - cfg.CONE_ALLEY_ROAD.rightX) < 0.01);
assert.ok(Math.abs(coneCar.z - cfg.CONE_ALLEY_ROAD.exitZ) < 0.01);
console.log('Cone Alley right-road departure check passed');
