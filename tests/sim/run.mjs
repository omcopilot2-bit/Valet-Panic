import './globals.mjs';
const P = (process.env.PROJ || new URL('../../', import.meta.url).pathname.replace(/\/$/, '')) + '/';
const THREE = await import('three');
await import(P + 'cars.js');
const core = await import(P + 'core.js');
const cfg = await import(P + 'config.js');
const state = await import(P + 'state.js');
const shifts = await import(P + 'shifts.js');
const sw = await import(P + 'shifts-world.js');
const people = await import(P + 'people.js');
const routes = await import(P + 'routes.js');
const world = await import(P + 'world.js');
const prog = await import(P + 'progress.js');
const { G, rush, slots, cars, tutorial } = state;

prog.load();
G.colliders = world.buildWorld(core.scene, slots);
for (const f of cfg.MODEL_FILES) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 2.8), new THREE.MeshStandardMaterial({ color: 0x888888 })));
  core.modelCache.set(f, g);
}

const DT = 1 / 30;
const viol = new Set();
let tick = 0;
function bot(mode) {
  tick++;
  if (mode === 'slow' && tick % 75 !== 0) return;   // acts once every 2.5s: constantly racing the rival
  const pl = rush.pl;
  if (!pl) return;
  if (mode === 'afk') return;
  if (mode === 'onepark' && rush.parked >= 1) { if (pl.mode === 'foot') { pl.x = 12.5; pl.z = -7; if (pl.fig) pl.fig.root.position.set(pl.x, 0.02, pl.z); } return; }   // wanders off to a corner
  if (pl.mode === 'foot') {
    const w = rush.waiting && rush.waiting.waiting ? rush.waiting : null;
    const call = rush.calls.find((c) => c.state === 'waiting');
    if (w) { pl.x = w.x; pl.z = w.z + 0.9; }
    else if (call) { const c = call.car; const p = routes.approachPoint('deliver', c); pl.x = p.x; pl.z = p.z; }
  } else if (G.activeCar) {
    const c = G.activeCar;
    c.vx = c.vz = c.speed = 0;
    if (c.delivering) { c.x = cfg.HANDOFF.x; c.z = cfg.HANDOFF.z; c.yaw = cfg.HANDOFF_YAW; }
    else if (c.slot) { c.x = c.slot.x; c.z = c.slot.z; c.yaw = core.parkYaw(c.slot); }
  }
  // The headless bot moves the state directly; keep the rendered/collision figure in sync with that shortcut.
  if (pl.mode === 'foot' && pl.fig) pl.fig.root.position.set(pl.x, 0.02, pl.z);
}

export function sim(level, mode, maxSim = 900) {
  const seeds = []; // keep runs independent
  shifts.startRush({ level });
  sw.closePerkPicker();
  let last = '', lastChange = 0, maxGap = 0, gapAt = '', t = 0;
  while (G.running && t < maxSim) {
    G.seconds = Math.max(G.seconds, 1e5);            // no clock: this is a liveness test
    bot(mode);
    shifts.updateRush(DT);
    people.updateFigures(DT);
    t += DT;
    const seen = new Map();
    for (const c of cars) {
      if (c.slot) { if (seen.has(c.slot)) viol.add(`two cars share bay ${c.slot.id}`); seen.set(c.slot, c); }
      if (c.parked && c.slot && c.slot.car !== c) viol.add('parked car not registered in its bay');
      if (c.parked && !c.slot) viol.add('parked car without a bay');
    }
    for (const sl of slots) {
      if (sl.car && !cars.has(sl.car)) viol.add('bay holds a disposed car');
      if (sl.car && sl.car.slot !== sl) viol.add('bay.car.slot mismatch');
      if (sl.car && sl.closed) viol.add('car in a closed bay');
    }
    const sig = [rush.parked, rush.delivered, rush.rival ? rush.rival.parked + rush.rival.delivered : 0, rush.arrived, cars.size, rush.stats.guestsLost, rush.stats.keysLost, rush.calls.length].join();
    if (sig !== last) { last = sig; lastChange = t; }
    if (t - lastChange > maxGap) { maxGap = t - lastChange; gapAt = `${sig} @${Math.round(t)}s`; }
  }
  const cleared = rush.doneT != null;
  const you = rush.parked + rush.delivered, rv = rush.rival ? rush.rival.parked + rush.rival.delivered : 0;
  return { level, mode, cleared, t: Math.round(t), you, rv, arrived: `${rush.arrived}/${rush.guestTotal}`, maxGap: Math.round(maxGap), gapAt, lost: rush.stats.guestsLost + rush.stats.keysLost };
}

if (process.env.REPEAT) {
  const [lv, mode, n] = process.env.REPEAT.split(':');
  let fails = 0;
  for (let i = 0; i < +n; i++) {
    const r = sim(+lv, mode, 500);
    if (!r.cleared) {
      fails++;
      if (fails === 1) {
        console.log('FAIL', r);
        console.log('state: waiting', !!rush.waiting, rush.waiting && { slot: rush.waiting.slot && rush.waiting.slot.id, waitLeft: rush.waiting.waitLeft }, 'inbound', !!rush.inbound, 'active', !!G.activeCar, 'calls', rush.calls.map((c) => c.state + ' left=' + Math.round(c.left)).join('|'), 'rival', rush.rival.state, 'tgt', !!rush.rival.target, 'think', rush.rival.think, 'stall', rush.stallT, 'spawnIn', rush.spawnIn, 'nextSlot', rush.nextSlot && rush.nextSlot.id);
        for (const c of cars) console.log(' car', c.id, { parked: c.parked, called: c.called, leaveIn: c.leaveIn && Math.round(c.leaveIn), leaving: c.leaving, slot: c.slot && c.slot.id, rivalDrive: !!c.rivalDrive, handoffT: c.handoffT, delivering: c.delivering, waiting: c.waiting, arriving: c.arriving, x: +c.x.toFixed(1), z: +c.z.toFixed(1), snap: !!c.snap });
        console.log('slots', slots.map((s) => s.id + ':' + (s.car ? s.car.id : s.closed ? 'X' : '-')).join(' '));
      }
    }
  }
  console.log(`${fails}/${n} runs did not finish`);
  console.log('invariant violations:', viol.size ? [...viol].join('; ') : 'none');
  process.exit(0);
}
if (process.env.DUMP) {
  const [lv, mode] = process.env.DUMP.split(':');
  const r = sim(+lv, mode, 400);
  console.log(r);
  console.log('state: waiting', !!rush.waiting, 'inbound', !!rush.inbound, 'active', !!G.activeCar, 'calls', rush.calls.map((c) => c.state + ' left=' + Math.round(c.left)).join('|'), 'rival', rush.rival && rush.rival.state, 'picking', rush.picking, 'doneT', rush.doneT, 'closingNoted', rush.closingNoted);
  for (const c of cars) console.log(' car', c.id, { parked: c.parked, called: c.called, leaveIn: c.leaveIn && Math.round(c.leaveIn), leaving: c.leaving, slot: c.slot && c.slot.id, rivalDrive: !!c.rivalDrive, handoffT: c.handoffT, delivering: c.delivering, x: +c.x.toFixed(1), z: +c.z.toFixed(1), exit: c.exit });
  process.exit(0);
}
const levels = (process.env.LEVELS || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const modes = (process.env.MODES || 'afk,onepark,bot').split(',');
let bad = 0;
for (const mode of modes) for (const lv of levels) {
  const r = sim(lv, mode);
  const flag = !r.cleared ? (mode === 'afk' ? '  (AFK player never finishes: expected only if guests keep leaving)' : '  <<< NOT FINISHED') : r.maxGap > 60 ? '  <<< LONG STALL' : '';
  if (flag.includes('<<<')) bad++;
  console.log(`${mode.padEnd(8)} L${String(lv).padEnd(2)} cleared=${r.cleared ? 'yes' : 'NO '} sim=${String(r.t).padStart(4)}s you=${r.you} rival=${r.rv} arrived=${r.arrived} lost=${r.lost} longestNoProgress=${r.maxGap}s${flag}`);
}
console.log(bad ? `${bad} problem run(s)` : 'no stalls found');

console.log('invariant violations:', viol.size ? [...viol].join('; ') : 'none');
