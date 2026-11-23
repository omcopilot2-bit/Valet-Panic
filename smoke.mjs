// Browser-free checks of the data and the pure logic: level definitions, unlock chain, XP curve, duel star thresholds,
// save merging and every rival route. It does not play the game.   Run:  node tests/smoke.mjs
import assert from 'node:assert/strict';
import { angleDifference, BOUNDS, duelGoals, duelStars, HANDOFF, HANDOFF_ANGLE, HANDOFF_YAW, LEVELS, PARKED_HALF, PARKING_LAYOUTS, PARKING_TYPES, PARK_ANGLE, SLOT_LAYOUTS, SLOT_POSITIONS } from './config.js';
import { ENGINE_PROFILES, engineRpm, gearForSpeed } from './audio.js';
import { approachPoint, deliverRoute, footRoute, parkRoute } from './routes.js';
import { keyName } from './keymap.js';
import { addXp, isLevelUnlocked, levelInfo, loadFromPlatform, recordLevel, save, xpToNext } from './progress.js';
import { MODEL_FILES } from './config.js';

const localStore = new Map();
globalThis.localStorage = {
  getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: (key) => localStore.delete(key),
};

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const inBounds = (p) => p.x >= BOUNDS.minX && p.x <= BOUNDS.maxX && p.z >= BOUNDS.minZ && p.z <= BOUNDS.maxZ;
// A point is inside a parked car's box if it is within PARKED_HALF of a bay centre.
const insideBay = (p, ignore) => SLOT_POSITIONS.some(([x, z], i) => i !== ignore && Math.abs(p.x - x) < PARKED_HALF.x && Math.abs(p.z - z) < PARKED_HALF.z);

test('levels are numbered 1..N with sane fields', () => {
  LEVELS.forEach((lv, i) => {
    assert.equal(lv.id, i + 1);
    assert.ok(lv.secs > 0 && lv.guests > 0 && lv.diff >= 1, `shift ${lv.id}`);
    assert.ok(lv.bays.length >= 2 && lv.bays.every((b) => b >= 0 && b < SLOT_POSITIONS.length), `bays of shift ${lv.id}`);
    assert.ok(lv.grip > 0 && lv.grip <= 1, `grip of shift ${lv.id}`);
    assert.equal(lv.cart, null, `shift ${lv.id} has no luggage-cart obstruction`);
  });
  assert.equal(new Set(LEVELS.map((lv) => lv.bays.join(','))).size, LEVELS.length, 'every shift has its own open-bay footprint');
  assert.equal(new Set(Object.values(PARKING_LAYOUTS).map((layout) => layout.map((p) => p.join(',')).join('|'))).size, LEVELS.length, 'every shift has its own physical stall arrangement');
  assert.ok(Object.values(PARKING_TYPES).some((kind) => kind.includes('60')), 'the campaign includes angled stalls');
  assert.ok(Object.values(PARKING_TYPES).some((kind) => kind.includes('island')), 'the campaign includes landscaped median layouts');
  for (const lv of LEVELS) {
    const layout = PARKING_LAYOUTS[lv.id];
    assert.equal(layout.length, SLOT_POSITIONS.length, `shift ${lv.id} has a centre for each stall`);
    const placed = SLOT_POSITIONS.map(([x, z], i) => [x + layout[i][0], z + layout[i][1]]);
    placed.forEach(([x, z]) => assert.ok(x > BOUNDS.minX + 2 && x < BOUNDS.maxX - 2 && z > BOUNDS.minZ + 1.5 && z < BOUNDS.maxZ - 3, `shift ${lv.id} stall remains on the lot`));
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
      assert.ok(Math.hypot(placed[a][0] - placed[b][0], placed[a][1] - placed[b][1]) > 3.6, `shift ${lv.id} stalls do not overlap`);
    }
  }
});

test('each car model has a distinct engine profile', () => {
  const profiles = MODEL_FILES.map((model) => ENGINE_PROFILES[model]);
  assert.ok(profiles.every(Boolean), 'every vehicle has an engine profile');
  assert.equal(new Set(profiles.map((p) => `${p.cyl}/${p.idle}/${p.redline}/${p.pulseMs}/${p.lp}/${p.drive}`)).size, MODEL_FILES.length);
  assert.ok(profiles.every((p) => p.shiftSpeeds.length === 2 && p.redline > p.idle), 'all models have three forward gears');
});

test('engine shifts up twice and does not hunt around a shift point', () => {
  const profile = ENGINE_PROFILES['sedan.glb'];
  const { shiftSpeeds } = profile;
  assert.equal(gearForSpeed(0, shiftSpeeds), 0);
  assert.equal(gearForSpeed(shiftSpeeds[0], shiftSpeeds), 1);
  assert.equal(gearForSpeed(shiftSpeeds[0] - 0.05, shiftSpeeds, 1), 1, 'hysteresis prevents gear hunting');
  assert.equal(gearForSpeed(shiftSpeeds[0] - 0.2, shiftSpeeds, 1), 0);
  assert.equal(gearForSpeed(shiftSpeeds[1], shiftSpeeds, 1), 2);
  assert.ok(engineRpm(shiftSpeeds[0] - 0.01, profile, 0) - engineRpm(shiftSpeeds[0] + 0.01, profile, 1) > 40,
    'the first upshift drops engine pitch audibly');
  assert.ok(engineRpm(shiftSpeeds[1] - 0.01, profile, 1) - engineRpm(shiftSpeeds[1] + 0.01, profile, 2) > 40,
    'the second upshift drops engine pitch audibly');
  assert.ok(engineRpm(shiftSpeeds[1] + 0.4, profile, 2) > engineRpm(shiftSpeeds[1], profile, 2),
    'engine pitch rises again after each shift');
  for (const model of MODEL_FILES) {
    const modelProfile = ENGINE_PROFILES[model];
    modelProfile.shiftSpeeds.forEach((speed, gear) => {
      assert.ok(engineRpm(speed - 0.01, modelProfile, gear) - engineRpm(speed + 0.01, modelProfile, gear + 1) > 40,
        `${model} has a clear pitch drop at shift ${gear + 1}`);
    });
  }
});

test('parking and hand-offs require the correct facing', () => {
  assert.ok(angleDifference(Math.PI + 0.1, Math.PI) < PARK_ANGLE, 'slight bay alignment error is accepted');
  assert.ok(angleDifference(0, Math.PI) > PARK_ANGLE, 'opposite bay direction is rejected');
  assert.ok(angleDifference(HANDOFF_YAW + HANDOFF_ANGLE + 0.01, HANDOFF_YAW) > HANDOFF_ANGLE, 'misaligned hand-off is rejected');
  assert.ok(angleDifference(HANDOFF_YAW - Math.PI * 2, HANDOFF_YAW) < HANDOFF_ANGLE, 'wrapped heading is handled');
});

test('pilot layouts have real bay positions and level-aware rival routes', () => {
  for (const levelId of [3, 5, 6]) {
    const layout = SLOT_LAYOUTS[levelId];
    assert.equal(layout.length, 8, `shift ${levelId} keeps eight bays`);
    layout.forEach((bay, i) => {
      assert.ok(bay.x >= BOUNDS.minX + 2 && bay.x <= BOUNDS.maxX - 2, `shift ${levelId} bay ${i + 1} is horizontally reachable`);
      assert.ok(bay.z >= BOUNDS.minZ + 1.5 && bay.z <= BOUNDS.maxZ - 2, `shift ${levelId} bay ${i + 1} is vertically reachable`);
      const slot = { id: i + 1, ...bay, layoutYaw: bay.yaw };
      for (const route of [parkRoute(slot, bay.yaw), deliverRoute(slot, bay.yaw)]) {
        route.forEach((point) => {
          assert.ok(inBounds(point), `shift ${levelId} route point is in bounds`);
        });
      }
      const approach = approachPoint('deliver', { slot });
      assert.ok(inBounds(approach), `shift ${levelId} bay ${i + 1} has a reachable foot approach`);
    });
  }
  assert.notEqual(SLOT_LAYOUTS[3][0].x, SLOT_LAYOUTS[5][0].x, 'casino and opera use distinct geometry');
  assert.notEqual(SLOT_LAYOUTS[5][0].z, SLOT_LAYOUTS[6][0].z, 'opera and airport use distinct geometry');
  const casino = SLOT_LAYOUTS[3];
  assert.ok(casino.every((bay) => Math.hypot(bay.x, bay.z - 0.2) > 4.4),
    'casino bays keep clear of the centre fountain');
  const airport = SLOT_LAYOUTS[6];
  assert.ok(airport.slice(0, 4).every((bay) => bay.z <= -5),
    'airport top row uses a real rear kerb line');
  assert.ok(airport.slice(4).every((bay) => bay.z >= 5),
    'airport bottom row uses a real front kerb line');
});

test('duel goals are strictly increasing and stars follow the margin', () => {
  for (const lv of LEVELS) {
    const [a, b, c] = duelGoals(lv);
    assert.equal(a, 1);
    assert.ok(a < b && b < c, `goals of shift ${lv.id}: ${a}/${b}/${c}`);
    assert.equal(duelStars(lv, 0), 0, 'a tie is not a win');
    assert.equal(duelStars(lv, a), 1);
    assert.equal(duelStars(lv, b), 2);
    assert.equal(duelStars(lv, c), 3);
  }
});

test('unlock chain: a shift needs a win in the one before', () => {
  assert.ok(isLevelUnlocked(1));
  assert.ok(!isLevelUnlocked(2));
  recordLevel(LEVELS[0], 100, 0);
  assert.ok(!isLevelUnlocked(2), 'zero stars must not unlock');
  recordLevel(LEVELS[0], 100, 1);
  assert.ok(isLevelUnlocked(2));
  assert.ok(!isLevelUnlocked(3));
  assert.equal(save.levels[1].stars, 1);
  recordLevel(LEVELS[0], 50, 0);
  assert.equal(save.levels[1].stars, 1, 'a worse run never lowers the stars');
  assert.equal(save.levels[1].best, 100, 'nor the best score');
});

test('XP curve: levels rise monotonically', () => {
  let last = 0;
  for (let l = 1; l <= 30; l++) { const x = xpToNext(l); assert.ok(x > last); last = x; }
  assert.equal(levelInfo(0).level, 1);
  assert.ok(levelInfo(100000).level >= 30);
});

test('every rival route stays in bounds and out of other bays', () => {
  const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  SLOT_POSITIONS.forEach(([x, z], i) => {
    const slot = { id: i + 1, x, z };
    for (const yaw of yaws) {
      for (const route of [parkRoute(slot, yaw), deliverRoute(slot, yaw)]) {
        route.forEach((p, k) => {
          assert.ok(inBounds(p), `bay ${i + 1} node ${k} out of bounds: ${p.x},${p.z}`);
          assert.ok(!insideBay(p, i), `bay ${i + 1} node ${k} inside another bay: ${p.x},${p.z}`);
        });
      }
    }
    assert.ok(inBounds(approachPoint('deliver', { x, z, slot })), `approach to bay ${i + 1}`);
  });
  const last = deliverRoute({ x: 3.05, z: -4.55 }, 0).at(-1);
  assert.equal(last.x, HANDOFF.x);
  assert.equal(last.z, HANDOFF.z);
});

test('foot routes never end somewhere else', () => {
  const pts = [{ x: -6, z: 7.5 }, { x: 9, z: -2 }, { x: HANDOFF.x, z: HANDOFF.z }, { x: -9, z: -3 }];
  for (const a of pts) for (const b of pts) {
    const r = footRoute(a, b);
    assert.deepEqual(r.at(-1), [b.x, b.z]);
    r.forEach(([x, z]) => assert.ok(inBounds({ x, z })));
  }
});

test('movement keys follow the physical key, so AZERTY gets ZQSD', () => {
  assert.equal(keyName({ code: 'KeyW', key: 'z' }), 'w', 'AZERTY: the key in the W position');
  assert.equal(keyName({ code: 'KeyA', key: 'q' }), 'a');
  assert.equal(keyName({ code: 'KeyW', key: 'w' }), 'w', 'QWERTY unchanged');
  assert.equal(keyName({ code: 'KeyZ', key: 'w' }), 'w', 'the letter on the key still works');
  assert.equal(keyName({ code: 'ArrowUp', key: 'ArrowUp' }), 'ArrowUp');
  assert.equal(keyName({ code: 'KeyE', key: 'E' }), 'e');
  assert.equal(keyName({ code: 'KeyH', key: 'h' }), 'h');
});

test('platform save is authoritative and logged-in accounts ignore stale local data', () => {
  const local = { xp: 1000, levels: { 1: { stars: 3, best: 900 } } };
  localStorage.setItem('valetSave2', JSON.stringify(local));
  const account = { xp: 120, levels: { 1: { stars: 1, best: 240 } } };
  const loaded = loadFromPlatform(JSON.stringify(account), false);
  assert.deepEqual(loaded, { hasPlatformSave: true, migratedLegacySave: false });
  assert.equal(save.xp, 120);
  assert.equal(save.levels[1].best, 240);
  loadFromPlatform(null, false);
  assert.equal(save.xp, 0, 'a new account must not inherit another local save');
});

test('legacy local progress migrates only for a guest without platform data', () => {
  const migrated = loadFromPlatform(null, true);
  assert.deepEqual(migrated, { hasPlatformSave: false, migratedLegacySave: true });
  assert.equal(save.xp, 1000);
  assert.equal(save.levels[1].stars, 3);
});

test('bonus XP from a rewarded ad adds the run XP a second time', () => {
  const p0 = save.xp;
  const first = addXp(120);
  const bonus = addXp(first.gained);
  assert.equal(save.xp, p0 + 240);
  assert.equal(bonus.gained, 120);
});

console.log(`\n${n} checks passed`);
