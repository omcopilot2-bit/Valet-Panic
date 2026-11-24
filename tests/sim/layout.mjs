import assert from 'node:assert/strict';
import './globals.mjs';
const P = new URL('../../', import.meta.url).href;
const core = await import(P + 'core.js');
const config = await import(P + 'config.js');
const state = await import(P + 'state.js');
const world = await import(P + 'world.js');
const shiftsWorld = await import(P + 'shifts-world.js');
const routes = await import(P + 'routes.js');
const collision = await import(P + 'collision.js');

state.G.colliders = world.buildWorld(core.scene, state.slots);
for (const level of config.LEVELS) {
  shiftsWorld.applyLevelLayout(level);
  assert.deepEqual(level.bays, state.slots.map((_, i) => i), `shift ${level.id} makes every bay available`);
  state.slots.forEach((slot, i) => {
    const [dx, dz] = config.PARKING_LAYOUTS[level.id][i];
    const pilotBay = config.SLOT_LAYOUTS[level.id] && config.SLOT_LAYOUTS[level.id][i];
    const expectedX = pilotBay ? pilotBay.x : config.SLOT_POSITIONS[i][0] + dx;
    const expectedZ = pilotBay ? pilotBay.z : config.SLOT_POSITIONS[i][1] + dz;
    const inward = config.SLOT_POSITIONS[i][1] < 0 ? Math.PI / 6 : Math.PI - Math.PI / 6;
    const expectedYaw = pilotBay ? pilotBay.yaw
      : config.PARKING_TYPES[level.id].includes('60') ? (inward + (level.park === 'reverse' ? Math.PI : 0)) % (Math.PI * 2)
        : level.park === 'reverse' ? 0 : Math.PI;
    assert.equal(slot.x, expectedX, `shift ${level.id} stall ${i + 1} x position`);
    assert.equal(slot.z, expectedZ, `shift ${level.id} stall ${i + 1} z position`);
    assert.equal(slot.group.position.x, slot.x, `shift ${level.id} visible bay follows its route position`);
    assert.equal(slot.group.position.z, slot.z, `shift ${level.id} visible bay follows its route position`);
    assert.equal(slot.yaw, expectedYaw, `shift ${level.id} stall ${i + 1} has its configured heading`);
    assert.equal(slot.group.rotation.y, expectedYaw, `shift ${level.id} visible bay rotates with its parking angle`);
    assert.equal(slot.closed, false, `shift ${level.id} bay ${i + 1} has no closure blocker`);
    if (!pilotBay && config.PARKING_TYPES[level.id].includes('60')) {
      assert.ok(Math.abs(slot.yaw - (config.SLOT_POSITIONS[i][1] < 0
        ? Math.PI / 6 + (level.park === 'reverse' ? Math.PI : 0)
        : Math.PI - Math.PI / 6 + (level.park === 'reverse' ? Math.PI : 0)) % (Math.PI * 2)) < 1e-9,
      `shift ${level.id} uses its angled stall heading`);
    }
    assert.equal(state.G.colliders.some((collider) => collider.kind === 'parking-island'), false, 'decorative islands do not create hidden parking blockers');
  });
  if (level.id === 4) {
    const cones = state.G.colliders.filter((collider) => collider.kind === 'cone');
    assert.equal(cones.length, 4, 'Cone Alley keeps four cones as optional driving hazards');
    for (let i = 0; i < cones.length; i++) {
      assert.ok(Math.hypot(cones[i].x - config.SPAWN.x, cones[i].z - config.SPAWN.z) > collision.CAR_BODY_RADIUS + cones[i].r + 0.8,
        `Cone Alley cone ${i + 1} leaves a clear spawn approach`);
      for (let j = i + 1; j < cones.length; j++) {
        assert.ok(Math.hypot(cones[i].x - cones[j].x, cones[i].z - cones[j].z) >= 4.9,
          `Cone Alley cones ${i + 1} and ${j + 1} leave a wider maneuvering gap`);
      }
    }
  }
  if (level.id === 3) {
    for (let i = 0; i < state.slots.length; i++) {
      for (let j = i + 1; j < state.slots.length; j++) {
        assert.equal(collision.carBodiesOverlapAt(
          state.slots[i].x, state.slots[i].z, state.slots[i].yaw,
          state.slots[j], state.slots[j].x, state.slots[j].z, state.slots[j].yaw,
        ), false, `Casino bays ${i + 1} and ${j + 1} leave room for parked cars`);
      }
      const slot = state.slots[i];
      const mouth = routes.parkRoute(slot, slot.yaw)[0];
      const exit = routes.deliverRoute(slot, slot.yaw)[0];
      const approach = routes.approachPoint('deliver', { x: slot.x, z: slot.z, slot });
      const exitLane = slot.exitRoute;
      assert.ok(Math.abs(mouth.x - slot.x) < 1e-9, `Casino bay ${i + 1} parking route enters through its mouth`);
      assert.ok(Math.abs(mouth.z - (slot.z + (i < 4 ? 2.2 : -2.2))) < 1e-9, `Casino bay ${i + 1} parking route faces the aisle`);
      assert.ok(Math.abs(exit.x - mouth.x) < 1e-9, `Casino bay ${i + 1} exit route backs through its mouth`);
      assert.ok(Math.abs(exit.z - mouth.z) < 1e-9, `Casino bay ${i + 1} exit route backs through its mouth`);
      assert.ok(Math.abs(approach.x - mouth.x) < 1e-9, `Casino bay ${i + 1} valet approach matches its mouth`);
      assert.ok(Math.abs(approach.z - (slot.z + (i < 4 ? 2 : -2))) < 1e-9, `Casino bay ${i + 1} valet approach is within reach`);
      assert.equal(exitLane[1].x, routes.SIDE_R, `Casino bay ${i + 1} exits via the side aisle`);
      assert.equal(exitLane[1].z, mouth.z, `Casino bay ${i + 1} clears the fountain before turning`);
      assert.equal(exitLane[2].x, routes.SIDE_R, `Casino bay ${i + 1} stays in the side aisle`);
      assert.equal(exitLane[2].z, 5.6, `Casino bay ${i + 1} reaches the front exit lane`);
      const delivery = routes.deliverRoute(slot, slot.yaw);
      assert.equal(delivery[1].x, routes.SIDE_R, `Casino bay ${i + 1} rival route uses the side aisle`);
      assert.equal(delivery[1].z, mouth.z, `Casino bay ${i + 1} rival clears the fountain before turning`);
      assert.equal(delivery[2].x, routes.SIDE_R, `Casino bay ${i + 1} rival remains in the side aisle`);
      assert.equal(delivery[2].z, 5.6, `Casino bay ${i + 1} rival reaches the pickup lane`);
      assert.ok(exitLane[exitLane.length - 1].x > 15, `Casino bay ${i + 1} exit route clears the lot`);
    }
  }
}
shiftsWorld.applyLevelLayout(null);
state.slots.forEach((slot, i) => {
  assert.equal(slot.x, config.SLOT_POSITIONS[i][0], 'classic mode restores the default bay x position');
  assert.equal(slot.z, config.SLOT_POSITIONS[i][1], 'classic mode restores the default bay z position');
  assert.equal(slot.yaw, undefined, 'classic mode restores unrotated 90-degree bays');
});
console.log('per-shift parking layout checks passed');
