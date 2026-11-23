import assert from 'node:assert/strict';
import './globals.mjs';
const P = new URL('../../', import.meta.url).href;
const core = await import(P + 'core.js');
const config = await import(P + 'config.js');
const state = await import(P + 'state.js');
const world = await import(P + 'world.js');
const shiftsWorld = await import(P + 'shifts-world.js');

state.G.colliders = world.buildWorld(core.scene, state.slots);
for (const level of config.LEVELS) {
  shiftsWorld.applyLevelLayout(level);
  assert.equal(state.G.colliders.some((collider) => collider.kind === 'parking-island'), config.PARKING_TYPES[level.id].includes('island'), `shift ${level.id} has the planned physical median`);
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
    if (config.PARKING_TYPES[level.id].includes('60')) {
      assert.ok(Math.abs(slot.yaw - (config.SLOT_POSITIONS[i][1] < 0
        ? Math.PI / 6 + (level.park === 'reverse' ? Math.PI : 0)
        : Math.PI - Math.PI / 6 + (level.park === 'reverse' ? Math.PI : 0)) % (Math.PI * 2)) < 1e-9,
      `shift ${level.id} uses its angled stall heading`);
    }
  });
}
shiftsWorld.applyLevelLayout(null);
state.slots.forEach((slot, i) => {
  assert.equal(slot.x, config.SLOT_POSITIONS[i][0], 'classic mode restores the default bay x position');
  assert.equal(slot.z, config.SLOT_POSITIONS[i][1], 'classic mode restores the default bay z position');
  assert.equal(slot.yaw, undefined, 'classic mode restores unrotated 90-degree bays');
});
console.log('per-shift parking layout checks passed');
