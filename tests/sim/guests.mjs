import assert from 'node:assert/strict';
import './globals.mjs';

const P = new URL('../../', import.meta.url).href;
const core = await import(P + 'core.js');
const { G } = await import(P + 'state.js');
const people = await import(P + 'people.js');
G.colliders = [];

const guest = people.spawnFigure('guest', 10.5, -7.1);
people.walkTo(guest, [[10.5, -10.5]], 3, people.enterBuilding);
for (let i = 0; i < 60 && core.scene.children.includes(guest.root); i++) people.updateFigures(1 / 30);
assert.equal(core.scene.children.includes(guest.root), false, 'a guest must cross the lot edge and enter the lobby');
console.log('guest lobby route check passed');
