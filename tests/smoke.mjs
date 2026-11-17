// Data and save-logic smoke test. Run with: node tests/smoke.mjs   (no browser, no assets needed)
globalThis.matchMedia = () => ({ matches: false });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const cfg = await import('../config.js');
const prog = await import('../progress.js');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL', msg); } };

// --- levels
const { LEVELS } = cfg;
ok(LEVELS.length === 10, 'ten shifts');
LEVELS.forEach((lv, i) => {
  ok(lv.id === i + 1, `level ${i + 1}: id matches position`);
  ok(lv.stars.length === 3 && lv.stars[0] < lv.stars[1] && lv.stars[1] < lv.stars[2], `level ${lv.id}: star goals ascend`);
  ok(lv.bays.every((b) => Number.isInteger(b) && b >= 0 && b < 8), `level ${lv.id}: bay indexes valid`);
  ok(new Set(lv.bays).size === lv.bays.length, `level ${lv.id}: bays unique`);
  ok(lv.bays.length >= 2, `level ${lv.id}: at least 2 open bays`);
  ok(lv.guests >= 1 && lv.guests <= lv.bays.length + 8, `level ${lv.id}: guest count sane`);
  ok(['nose', 'reverse'].includes(lv.park), `level ${lv.id}: park mode`);
  ok(lv.quirks.every((q) => cfg.QUIRKS[q]), `level ${lv.id}: known quirks`);
  ok(lv.callsFrom + 15 < lv.secs, `level ${lv.id}: calls start before the clock runs out`);
  cfg.levelMods(lv);
});
ok(cfg.DAILY_LEVEL_IDS.every((id) => LEVELS.some((l) => l.id === id)), 'daily ids exist');
ok(cfg.RUSH_PERKS.length >= 3 && cfg.RUSH_PERKS.every((p) => p.key && p.name && p.desc), 'boons well-formed');
ok(new Set(cfg.RUSH_PERKS.map((p) => p.key)).size === cfg.RUSH_PERKS.length, 'boon keys unique');

// --- progress
prog.load();
ok(prog.levelInfo(0).level === 1, 'xp 0 = level 1');
ok(prog.levelInfo(prog.xpToNext(1)).level === 2, 'level 2 at xpToNext(1)');
ok(prog.levelInfo(1e9).level === prog.MAX_PLAYER_LEVEL, 'level cap');
ok(prog.isLevelUnlocked(1) && !prog.isLevelUnlocked(2), 'only shift 1 unlocked at start');
const lv1 = LEVELS[0];
ok(prog.starsFor(lv1, 0) === 0 && prog.starsFor(lv1, lv1.stars[2]) === 3, 'starsFor');
const info = prog.recordLevel(lv1, lv1.stars[0]);
ok(info.firstClear && info.unlockedNext && info.unlockedNext.id === 2, 'first clear unlocks shift 2');
ok(prog.isLevelUnlocked(2), 'shift 2 now unlocked');
const info2 = prog.recordLevel(lv1, 1);
ok(!info2.firstClear && prog.levelStars(1) === 1, 'a worse run never lowers stars');
ok(prog.seedFromKey('2026-11-16') === prog.seedFromKey('2026-11-16'), 'seed deterministic');
const a = prog.mulberry32(42), b = prog.mulberry32(42);
ok(a() === b() && a() === b(), 'mulberry32 deterministic');
ok(prog.dailyLevel('2026-11-16').id === prog.dailyLevel('2026-11-16').id, 'daily level deterministic');

// --- run log
for (let i = 0; i < 70; i++) prog.logRun({ shift: 1, score: 100 + i, stars: i % 4, cleared: i % 2 === 0 });
ok(prog.save.runLog.length === 60, 'run log capped at 60');
const sum = prog.runLogSummary();
ok(sum.length === 1 && sum[0].runs === 60 && sum[0].max === 169, 'run log summary');
ok(store.get('valetSave2') && JSON.parse(store.get('valetSave2')).runLog.length === 60, 'run log persisted');

// --- rival duel
const SLOTS = [[-9.1, -4.55], [-3.05, -4.55], [3.05, -4.55], [9.1, -4.55], [-9.1, 1.12], [-3.05, 1.12], [3.05, 1.12], [9.1, 1.12]].map(([x, z]) => ({ x, z }));
for (const lv of LEVELS) {
  const g = cfg.duelGoals(lv);
  ok(g[0] === 1 && g[0] < g[1] && g[1] < g[2], `level ${lv.id}: duel goals ascend (${g})`);
  ok(g[2] <= lv.guests * 2, `level ${lv.id}: 3 stars is reachable (${g[2]} <= ${lv.guests * 2} moves)`);
  ok(cfg.duelStars(lv, 0) === 0 && cfg.duelStars(lv, -3) === 0, `level ${lv.id}: a tie or a loss is 0 stars`);
  ok(cfg.duelStars(lv, 1) === 1 && cfg.duelStars(lv, g[2]) === 3, `level ${lv.id}: star thresholds`);
}
const dstars = prog.recordLevel(LEVELS[4], 50, 2);
ok(dstars.stars === 2 && prog.levelStars(5) === 2, 'recordLevel takes duel stars');

const R = await import('../routes.js');
const half = cfg.PARKED_HALF, CAR_R = 0.85;
// does the segment a->b pass through a parked-car box (grown by the car radius)? `skip` = the car's own bay
const hitsBay = (a, b, skip) => {
  for (let i = 0; i <= 40; i++) {
    const x = a.x + (b.x - a.x) * i / 40, z = a.z + (b.z - a.z) * i / 40;
    for (const s of SLOTS) {
      if (s === skip) continue;
      if (Math.abs(x - s.x) < half.x + CAR_R - 0.05 && Math.abs(z - s.z) < half.z + CAR_R - 0.05) return true;
    }
  }
  return false;
};
const inBounds = (p) => p.x >= cfg.BOUNDS.minX && p.x <= cfg.BOUNDS.maxX && p.z >= cfg.BOUNDS.minZ && p.z <= cfg.BOUNDS.maxZ;
const DROP = { x: cfg.DROPOFF.x, z: cfg.DROPOFF.z };
for (const slot of SLOTS) {
  const tag = `bay (${slot.x},${slot.z})`;
  const routes = {
    park: [DROP, ...R.parkRoute(slot, Math.PI)],
    parkReverse: [DROP, ...R.parkRoute(slot, 0)],
    deliver: [{ x: slot.x, z: slot.z }, ...R.deliverRoute(slot, Math.PI)],
  };
  for (const [name, pts] of Object.entries(routes)) {
    ok(pts.every(inBounds), `${tag} ${name}: every node is inside the lot`);
    for (let i = 0; i + 1 < pts.length; i++) ok(!hitsBay(pts[i], pts[i + 1], slot), `${tag} ${name}: segment ${i} stays out of other bays`);
  }
  ok(routes.deliver.at(-1).x === cfg.HANDOFF.x && routes.deliver.at(-1).z === cfg.HANDOFF.z, `${tag}: delivery ends on the pick-up ring`);
  const last = routes.park.at(-1);
  ok(last.x === slot.x && last.z === slot.z, `${tag}: park route ends in the bay`);
  // walking: from the start area and from the pick-up area to this bay's approach point
  const ap = R.approachPoint('deliver', { x: slot.x, z: slot.z, slot });
  for (const from of [{ x: -6.2, z: 7.5 }, { x: 10.4, z: 6.8 }, { x: -10.4, z: 7.6 }, { x: ap.x, z: R.APPROACH_TOP }, { x: 0, z: R.APPROACH_BOTTOM }]) {
    const pts = [from, ...R.footRoute(from, ap).map(([x, z]) => ({ x, z }))];
    ok(pts.every(inBounds), `${tag}: walking route in bounds from (${from.x},${from.z})`);
    for (let i = 0; i + 1 < pts.length; i++) ok(!hitsBay(pts[i], pts[i + 1], null), `${tag}: walk from (${from.x},${from.z}) avoids bays, segment ${i}`);
    ok(Math.hypot(pts.at(-1).x - slot.x, pts.at(-1).z - slot.z) <= R.grabRadius('deliver'), `${tag}: approach point is inside the grab radius`);
  }
}
const dropCar = { x: cfg.DROPOFF.x, z: cfg.DROPOFF.z };
const dp = R.approachPoint('park', dropCar);
ok(Math.hypot(dp.x - dropCar.x, dp.z - dropCar.z) <= R.grabRadius('park') && inBounds(dp), 'drop-off approach point is reachable and inside the grab radius');

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('smoke test: all checks passed');
