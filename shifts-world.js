// Shifts support: level layout (closed bays, cones, luggage cart, rain), power-up and bonus tokens, random events, honk and near-miss, the boon picker.
import * as THREE from 'three';
import { duelGoals, HORNS, levelMods, PARKED_HALF, POWERUPS, reduceMotion, RUSH_PERKS, TOKEN_SPOTS } from './config.js';
import { audio, parkRadius, popScore, scene, shuffle, toast, worldToScreen } from './core.js';
import { cancelPeek } from './input.js';
import { dropoff, guide, handoff } from './people.js';
import * as platform from './platform.js';
import { equippedItem } from './progress.js';
import { addTime, G, hooks, keys, rush, slots } from './state.js';
import { applyVenue, updateVenue, venueName } from './venues.js';
import { mat } from './world.js';

// A short random event: a shower, a wedding party or a VIP convoy.
export function fireEvent() {
  const opts = ['wedding', 'convoy'];
  if (rush.lv.grip >= 1) opts.push('shower');
  const e = opts[Math.floor(G.rngMisc() * opts.length)];
  if (e === 'shower') {
    rush.shower = 14;
    document.body.dataset.weather = 'rain';
    toast('🌧️ A sudden shower! The tarmac is slippery for 14s.');
  } else if (e === 'wedding') {
    rush.wedding = 15;
    toast('💒 Wedding party! All tips +30% for 15s.');
  } else {
    rush.vipNext = 3;
    toast('🚙 VIP convoy! The next 3 cars are VIPs.');
  }
  audio.play('vip');
}

// H: honk. A tap of the horn makes the bellhop pause for a moment.
export function honk() {
  if (!G.running || G.paused || rush.picking || G.mode !== 'rush' || !G.activeCar || rush.hornCd > 0) return;
  rush.hornCd = 0.7;
  audio.play('honk', 0, equippedItem('horn', HORNS).id);
  if (cart && Math.hypot(cart.x - G.activeCar.x, cart.z - G.activeCar.z) < 5.5) {
    cart.pause = 1.8;
    const s = worldToScreen(cart.x, cart.z, 1.5);
    popScore('Beep! The cart stops', s.x, s.y, '#6cc8ff');
  }
  // ...and a honk also startles the rival if he is running nearby.
  const rv = rush.rival;
  if (rv && rv.state === 'walk' && rv.stun <= 0 && Math.hypot(rv.x - G.activeCar.x, rv.z - G.activeCar.z) < 6) {
    rv.stun = 1.2;
    const s = worldToScreen(rv.x, rv.z, 1.8);
    popScore('Beep! The rival freezes', s.x, s.y, '#6cc8ff');
  }
}

// Squeezing past a cone or the luggage cart with a hair to spare slows time for a moment.
export function nearMiss(car) {
  if (G.nearCd > 0 || car.speed < 2.4 || car.delivering) return;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  for (const c of G.colliders) {
    if (!c.lv) continue;
    for (const off of [0.75, -0.75]) {
      const gap = Math.hypot(car.x + fx * off - c.x, car.z + fz * off - c.z) - (0.85 + c.r);
      if (gap > 0.02 && gap < 0.22) {
        G.nearCd = 5;
        G.slowT = reduceMotion ? 0 : 0.55;
        G.score += 3;
        const s = worldToScreen(car.x, car.z, 1.4);
        popScore('CLOSE! +$3', s.x, s.y, '#6cc8ff');
        audio.play('power');
        return;
      }
    }
  }
}

/* ---------- power-up tokens ---------- */
// Vector icons drawn on the marker badge (emoji render differently on every OS).
function drawIcon(c, kind, css) {
  c.fillStyle = css;
  c.strokeStyle = css;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 9;
  if (kind === 'key') {
    c.beginPath(); c.arc(44, 64, 15, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(59, 64); c.lineTo(100, 64); c.moveTo(86, 64); c.lineTo(86, 78); c.moveTo(100, 64); c.lineTo(100, 76); c.stroke();
  } else if (kind === 'bell') {
    c.beginPath();
    c.moveTo(32, 84); c.quadraticCurveTo(42, 78, 43, 58); c.quadraticCurveTo(45, 34, 64, 34);
    c.quadraticCurveTo(83, 34, 85, 58); c.quadraticCurveTo(86, 78, 96, 84); c.closePath(); c.fill();
    c.beginPath(); c.arc(64, 93, 7, 0, Math.PI * 2); c.fill();
  } else if (kind === 'nitro') {
    c.beginPath(); c.moveTo(72, 22); c.lineTo(40, 70); c.lineTo(62, 70); c.lineTo(54, 106); c.lineTo(90, 54); c.lineTo(68, 54); c.closePath(); c.fill();
  } else if (kind === 'time') {
    c.beginPath(); c.arc(64, 64, 30, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 44); c.moveTo(64, 64); c.lineTo(78, 72); c.stroke();
  } else if (kind === 'coin') {
    c.beginPath(); c.arc(64, 64, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0a1822';
    c.font = '700 46px Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('$', 64, 68);
  } else if (kind === 'coffee') {
    c.beginPath(); c.moveTo(34, 52); c.lineTo(86, 52); c.lineTo(80, 90); c.lineTo(40, 90); c.closePath(); c.fill();
    c.beginPath(); c.arc(90, 66, 10, -Math.PI / 2, Math.PI / 2); c.stroke();
    c.beginPath(); c.moveTo(52, 40); c.quadraticCurveTo(46, 32, 54, 24); c.moveTo(68, 40); c.quadraticCurveTo(62, 32, 70, 24); c.stroke();
  } else {
    c.beginPath(); c.arc(64, 64, 32, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0a1822';
    c.font = '700 44px Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('x2', 64, 66);
  }
}

export function tokenTexture(emoji, color) {
  const can = document.createElement('canvas');
  can.width = can.height = 128;
  const c = can.getContext('2d');
  c.fillStyle = '#0a1822';
  c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.fill();
  c.lineWidth = 8;
  c.strokeStyle = '#' + color.toString(16).padStart(6, '0');
  c.stroke();
  drawIcon(c, emoji, '#' + color.toString(16).padStart(6, '0'));
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function spawnToken() {
  const types = Object.keys(POWERUPS);
  const type = types[Math.floor(G.rngTok() * types.length)];
  const spots = TOKEN_SPOTS.filter((p) => !G.activeCar || Math.hypot(p[0] - G.activeCar.x, p[1] - G.activeCar.z) > 4);
  const [x, z] = spots[Math.floor(G.rngTok() * spots.length)];
  const def = POWERUPS[type];
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.09, 8, 40),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  group.add(ring);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tokenTexture(type, def.color), transparent: true, toneMapped: false, depthWrite: false,
  }));
  sprite.scale.set(1.2, 1.2, 1);
  sprite.position.y = 1.3;
  sprite.raycast = () => {};
  group.add(sprite);
  scene.add(group);
  rush.token = { type, x, z, group, ring, sprite, life: 12 + 3 * rush.perks.magnet };
}

export function clearToken() {
  const t = rush.token;
  if (!t) return;
  scene.remove(t.group);
  t.ring.geometry.dispose();
  t.ring.material.dispose();
  t.sprite.material.map.dispose();
  t.sprite.material.dispose();
  rush.token = null;
}

export const tokenDelay = (lo, span) => (lo + G.rngTok() * span) * (1 - 0.25 * rush.perks.magnet);

export function collectToken() {
  const t = rush.token;
  const def = POWERUPS[t.type];
  if (t.type === 'time') addTime(4);
  else if (t.type === 'nitro') rush.nitro = 4;
  else if (t.type === 'coin') G.score += 15;
  else if (t.type === 'coffee') rush.coffee = 8;
  else rush.boost = 8;
  const s = worldToScreen(t.x, t.z, 1.5);
  popScore(def.pop, s.x, s.y);
  toast(def.toast);
  audio.play('power');
  if (!reduceMotion) G.punch = 1;
  clearToken();
  rush.tokenIn = tokenDelay(24, 10);
  hooks.rushHud();
}

/* ---------- perk picker (every level-up) ---------- */
let perkEl = null, perkKeyHandler = null;

export function closePerkPicker() {
  if (perkEl) { perkEl.remove(); perkEl = null; }
  if (perkKeyHandler) { window.removeEventListener('keydown', perkKeyHandler); perkKeyHandler = null; }
  rush.picking = false;
}

function applyRushPerk(p) {
  rush.perks[p.key]++;
  rush.stats.perks.push(p.icon);
  if (p.key === 'time') addTime(8);
  if (p.key === 'start') { rush.chain = 6; rush.mult = 3; rush.maxMult = 3; rush.meter = 1; }
  toast(`${p.icon} ${p.name}`);
  audio.play('chain', 5);
}

// The shift intro: what is special about this shift, the star goals, and (from shift 2) a boon to take with you.
// The clock does not run until you pick or press Start.
export function offerShiftIntro(onDone) {
  const lv = rush.lv;
  const withBoons = lv.id >= 2 || rush.daily;
  const picks = withBoons ? shuffle(RUSH_PERKS, G.rngMisc).slice(0, 3) : [];
  rush.picking = true;
  keys.clear();
  cancelPeek();
  audio.engine(null);
  const t = document.getElementById('toast');
  if (t) t.classList.remove('show');
  const mods = levelMods(lv).map((m) => `<span class="mod">${m.icon} ${m.name}</span>`).join('');
  perkEl = document.createElement('div');
  perkEl.className = 'overlay';
  perkEl.setAttribute('role', 'dialog');
  perkEl.setAttribute('aria-label', `Shift ${lv.id}: ${lv.name}`);
  perkEl.innerHTML = `<div class="hero"><div class="hero-eyebrow">${rush.daily ? 'DAILY RUN' : 'SHIFT ' + lv.id} · ${lv.secs} SECONDS · 📍 ${venueName(lv.id).toUpperCase()}</div>
    <h1 style="font-size:clamp(34px,6vw,50px)">${lv.name}</h1>
    <p>${lv.tagline}</p>
    ${mods ? `<div class="mods" style="justify-content:center;margin-top:10px">${mods}</div>` : ''}
    <div class="intro-rule">🏁 <b>Duel:</b> a rival valet is after the same cars. Park and return more cars than he does.</div>
    <div class="goals"><span>★ Beat the rival</span><span>★★ Win by ${duelGoals(lv)[1]}</span><span>★★★ Win by ${duelGoals(lv)[2]}</span></div>
    ${withBoons
      ? `<div class="intro-rule">Pick a boon for this shift (press 1, 2 or 3):</div>
         <div class="perks">${picks.map((p, i) => `<button class="perk" data-i="${i}"><b>${p.icon} ${p.name}</b><span>${p.desc}</span><em>THIS SHIFT<kbd>${i + 1}</kbd></em></button>`).join('')}</div>`
      : '<button class="play" id="startShift">Start shift</button><div class="retry-hint">OR PRESS ENTER</div>'}
    </div>`;
  document.body.appendChild(perkEl);
  const go = (p) => {
    closePerkPicker();
    platform.gameplayStart();
    keys.clear();
    if (p) applyRushPerk(p);
    hooks.rushHud();
    audio.play('good');
    if (onDone) onDone();
  };
  perkEl.querySelectorAll('.perk').forEach((b) => b.addEventListener('click', () => { audio.ensure(); go(picks[+b.dataset.i]); }));
  const sb = perkEl.querySelector('#startShift');
  if (sb) sb.addEventListener('click', () => { audio.ensure(); go(null); });
  perkKeyHandler = (e) => {
    if (withBoons && e.key >= '1' && e.key <= '3' && picks[+e.key - 1]) { e.preventDefault(); go(picks[+e.key - 1]); }
    else if (!withBoons && e.key === 'Enter') { e.preventDefault(); go(null); }
  };
  window.addEventListener('keydown', perkKeyHandler);
  const first = perkEl.querySelector('.perk, #startShift');
  if (first) first.focus({ preventScroll: true });
}

/* ---------- shift layout: closed bays, cones, the luggage cart, rain ---------- */
let levelProps = null, cart = null;

// Orange-and-white hazard stripes with CLOSED on top of a closed bay's barrier block.
function closedTexture() {
  const can = document.createElement('canvas');
  can.width = 190; can.height = 290;
  const c = can.getContext('2d');
  c.fillStyle = '#20262a';
  c.fillRect(0, 0, 190, 290);
  c.save();
  c.beginPath(); c.rect(0, 0, 190, 290); c.rect(18, 18, 154, 254); c.clip('evenodd');
  c.fillStyle = '#ff7a1a';
  for (let i = -300; i < 480; i += 44) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 22, 0); c.lineTo(i + 22 + 290, 290); c.lineTo(i + 290, 290); c.fill();
  }
  c.restore();
  c.fillStyle = '#fff7e6';
  c.font = '700 40px Arial, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.translate(95, 145); c.rotate(-Math.PI / 2); c.fillText('CLOSED', 0, 0); c.restore();
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function clearLevelProps() {
  G.colliders = G.colliders.filter((c) => !c.lv);
  if (levelProps) {
    scene.remove(levelProps);
    levelProps.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    levelProps = null;
  }
  cart = null;
  slots.forEach((s) => { s.closed = false; });
  document.body.dataset.weather = '';
}

export function applyLevelLayout(lv) {
  clearLevelProps();
  applyVenue(lv ? lv.id : 1);   // every shift is set in its own venue (null = the Nocturne Hotel)
  if (!lv) return;
  levelProps = new THREE.Group();
  scene.add(levelProps);

  slots.forEach((s, i) => {
    if (lv.bays.includes(i)) return;
    s.closed = true;                       // behaves like a parked car: solid, never assigned to a guest
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.3),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.13, depthWrite: false }));
    hatch.rotation.x = -Math.PI / 2;
    hatch.position.set(s.x, 0.06, s.z);
    levelProps.add(hatch);
    // A visible barrier exactly where the solid collision is, so a closed bay never feels like an invisible wall.
    const blk = new THREE.Mesh(new THREE.BoxGeometry(PARKED_HALF.x * 2, 0.42, PARKED_HALF.z * 2), mat(0x2a2f33, 0.7));
    blk.position.set(s.x, 0.21, s.z);
    blk.castShadow = true;
    blk.receiveShadow = true;
    levelProps.add(blk);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(PARKED_HALF.x * 2 - 0.1, PARKED_HALF.z * 2 - 0.1),
      new THREE.MeshBasicMaterial({ map: closedTexture(), toneMapped: false }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(s.x, 0.435, s.z);
    levelProps.add(top);
  });

  for (const [x, z] of lv.cones) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 12), mat(0xff7a1a, 0.5));
    cone.position.set(x, 0.5, z);
    cone.castShadow = true;
    levelProps.add(cone);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.95), mat(0x20262a, 0.7));
    base.position.set(x, 0.04, z);
    levelProps.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.18, 12), mat(0xf4f4ee, 0.5));
    band.position.set(x, 0.55, z);
    levelProps.add(band);
    G.colliders.push({ x, z, r: 0.45, lv: true });
  }

  if (lv.cart) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.95), mat(0xd6b674, 0.3, 0.7));
    body.position.y = 0.45;
    g.add(body);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), mat(0xd6b674, 0.3, 0.7));
    rail.position.set(-0.8, 0.9, 0);
    g.add(rail);
    for (const [dx, col] of [[-0.35, 0x7a1f2e], [0.3, 0x2f4a86]]) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.7), mat(col, 0.6));
      bag.position.set(dx, 0.8, 0);
      bag.castShadow = true;
      g.add(bag);
    }
    levelProps.add(g);
    cart = { group: g, def: lv.cart, t: Math.PI * 0.5, x: lv.cart.x0, z: lv.cart.z, r: 0.9, lv: true };
    G.colliders.push(cart);
    updateLevelProps(0);
  }
  document.body.dataset.weather = lv.grip < 1 ? 'rain' : '';
}

// Moves the luggage cart back and forth across the lot.
export function updateLevelProps(dt) {
  updateVenue(dt);
  if (!cart) return;
  if (cart.pause > 0) { cart.pause -= dt; return; }
  cart.t += dt * cart.def.speed;
  const u = 0.5 + 0.5 * Math.sin(cart.t);
  cart.x = cart.def.x0 + (cart.def.x1 - cart.def.x0) * u;
  cart.group.position.set(cart.x, 0, cart.z);
  cart.group.rotation.y = Math.cos(cart.t) >= 0 ? Math.PI / 2 : -Math.PI / 2;
}

// Shows the PICK-UP and DROP-OFF rings while a shift is running, and hides the guide arrow otherwise.
export function updateRushRings() {
  const rushOn = G.running && G.mode === 'rush';
  if (!rushOn) guide.visible = false;
  const ringOn = rushOn && rush.calls.length > 0;
  const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.03;
  handoff.group.visible = !!ringOn;
  dropoff.group.visible = rushOn;
  if (ringOn) {
    const act = rush.calls.some((c) => c.state === 'driving');
    handoff.group.scale.setScalar(parkRadius() / 1.7 * pulse);
    handoff.ringMat.opacity = act ? 0.85 : 0.35;
    handoff.fillMat.opacity = act ? 0.16 : 0.06;
  }
  if (rushOn) {
    const w = !!rush.waiting;
    dropoff.group.scale.setScalar(1.35 * pulse);
    dropoff.ringMat.opacity = w ? 0.85 : 0.3;
    dropoff.fillMat.opacity = w ? 0.14 : 0.05;
  }
}
