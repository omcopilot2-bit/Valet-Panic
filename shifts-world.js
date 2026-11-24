// Shifts support: venue layouts and hazards, power-up and bonus tokens, random events, honk and near-miss, the boon picker.
import * as THREE from 'three';
import { CAR_BODY_OFFSETS, CAR_BODY_RADIUS } from './collision.js';
import { duelGoals, HORNS, levelMods, PARKING_LAYOUTS, PARKING_TYPES, POWERUPS, reduceMotion, RUSH_PERKS, SLOT_LAYOUTS, TOKEN_SPOTS } from './config.js';
import { audio, parkRadius, popScore, scene, shuffle, toast, worldToScreen } from './core.js';
import { cancelPeek } from './input.js';
import { dropoff, guide, handoff, otherPeople } from './people.js';
import * as platform from './platform.js';
import { equippedItem } from './progress.js';
import { addTime, cars, G, hooks, keys, rush, slots } from './state.js';
import { customExitRoute, SIDE_R } from './routes.js';
import { applyVenue, updateVenue, venueName } from './venues.js';
import { mat } from './world.js';

// A short random event: a wedding party or a VIP convoy.
export function fireEvent() {
  const opts = ['wedding', 'convoy'];
  const e = opts[Math.floor(Math.random() * opts.length)];
  if (e === 'wedding') {
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
  // ...and a honk also startles the rival if he is running nearby.
  const rv = rush.rival;
  if (rv && rv.state === 'walk' && rv.stun <= 0 && Math.hypot(rv.x - G.activeCar.x, rv.z - G.activeCar.z) < 6) {
    rv.stun = 1.2;
    const s = worldToScreen(rv.x, rv.z, 1.8);
    popScore('Beep! The rival freezes', s.x, s.y, '#6cc8ff');
  }
}

// Squeezing past a cone with a hair to spare slows time for a moment.
export function nearMiss(car) {
  if (G.nearCd > 0 || car.speed < 2.4 || car.delivering) return;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  for (const c of G.colliders) {
    if (!c.lv) continue;
    for (const off of CAR_BODY_OFFSETS) {
      const gap = Math.hypot(car.x + fx * off - c.x, car.z + fz * off - c.z) - (CAR_BODY_RADIUS + c.r);
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
  const type = types[Math.floor(Math.random() * types.length)];
  const pilotSpots = rush.lv.id === 3
    ? [[-12, 0], [-7, 0], [7, 0], [12, 0], [0, 3.8], [0, -3.8], [-12, 6], [12, 6]]
    : rush.lv.id === 5
      ? [[0, -5.8], [0, -2.2], [0, 1.2], [0, 5.2], [-12, -1], [12, -1], [-12, 5.8], [12, 5.8]]
      : rush.lv.id === 6
        ? [[-11, 0], [-5, 0], [0, 0], [5, 0], [11, 0], [-12, -4], [12, 4], [0, 7]]
        : TOKEN_SPOTS;
  const spots = pilotSpots.filter((p) => !G.activeCar || Math.hypot(p[0] - G.activeCar.x, p[1] - G.activeCar.z) > 4);
  const [x, z] = spots[Math.floor(Math.random() * spots.length)];
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

export const tokenDelay = (lo, span) => (lo + Math.random() * span) * (1 - 0.25 * rush.perks.magnet);

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
  const withBoons = lv.id >= 2;
  const picks = withBoons ? shuffle(RUSH_PERKS).slice(0, 3) : [];
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
  perkEl.innerHTML = `<div class="hero"><div class="hero-eyebrow">SHIFT ${lv.id} · ${lv.secs} SECONDS · 📍 ${venueName(lv.id).toUpperCase()}</div>
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
    const digit = /^(Digit|Numpad)([1-3])$/.exec(e.code) ? +e.code.slice(-1) : (e.key >= '1' && e.key <= '3' ? +e.key : 0);   // by position: AZERTY's top row types symbols
    if (withBoons && digit && picks[digit - 1]) { e.preventDefault(); go(picks[digit - 1]); }
    else if (!withBoons && e.key === 'Enter') { e.preventDefault(); go(null); }
  };
  window.addEventListener('keydown', perkKeyHandler);
  const first = perkEl.querySelector('.perk, #startShift');
  if (first) first.focus({ preventScroll: true });
}

/* ---------- shift layout: bay geometry and level props ---------- */
let levelProps = null, fountainAnimation = null;

function clearLevelProps() {
  G.colliders = G.colliders.filter((c) => !c.lv);
  fountainAnimation = null;
  if (levelProps) {
    scene.remove(levelProps);
    levelProps.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    levelProps = null;
  }
  slots.forEach((s) => {
    s.closed = false;
    s.exitRoute = undefined;
    s.layoutYaw = undefined;
    s.mouthDirection = undefined;
    s.routeSideX = undefined;
    s.routePlan = undefined;
    if (s.baseX !== undefined) { s.x = s.baseX; s.z = s.baseZ; s.yaw = s.baseYaw; }
    if (s.group) { s.group.position.set(s.x, 0, s.z); s.group.rotation.y = s.yaw || 0; }
  });
}

export function applyLevelLayout(lv) {
  clearLevelProps();
  applyVenue(lv ? lv.id : 1);   // every shift is set in its own venue (null = the Nocturne Hotel)
  if (!lv) return;
  const pilotLayout = SLOT_LAYOUTS[lv.id];
  const offsets = PARKING_LAYOUTS[lv.id] || PARKING_LAYOUTS[1];
  const parkingType = PARKING_TYPES[lv.id] || '90';
  const oblique = parkingType.includes('60');
  slots.forEach((s, i) => {
    s.closed = false;
    if (s.baseX === undefined) { s.baseX = s.x; s.baseZ = s.z; s.baseYaw = s.yaw; }
    if (pilotLayout) {
      s.x = pilotLayout[i].x;
      s.z = pilotLayout[i].z;
      s.yaw = pilotLayout[i].yaw;
      s.layoutYaw = pilotLayout[i].yaw;
      s.mouthDirection = lv.park === 'reverse' ? 1 : -1;
      s.routeSideX = lv.id === 3 ? SIDE_R : undefined;
      s.routePlan = lv.id === 3 ? 'casino' : undefined;
    } else {
      s.x = s.baseX + offsets[i][0];
      s.z = s.baseZ + offsets[i][1];
      s.layoutYaw = undefined;
    }
    if (!pilotLayout && oblique) {
      const inward = s.baseZ < 0 ? Math.PI / 6 : Math.PI - Math.PI / 6;
      s.yaw = (inward + (lv.park === 'reverse' ? Math.PI : 0)) % (Math.PI * 2);
    } else if (!pilotLayout) s.yaw = lv.park === 'reverse' ? 0 : Math.PI;
    s.exitRoute = pilotLayout ? customExitRoute(s) : undefined;
    if (s.group) { s.group.position.set(s.x, 0, s.z); s.group.rotation.y = s.yaw; }
  });
  levelProps = new THREE.Group();
  scene.add(levelProps);

  if (lv.id === 3) {
    const roundabout = new THREE.Group();
    roundabout.position.set(0, 0, 0.2);
    levelProps.add(roundabout);
    const gold = mat(0xb58a4f, 0.36, 0.62, { emissive: 0x49351d, emissiveIntensity: 0.35 });
    const cyan = mat(0x55d7df, 0.3, 0.48, { emissive: 0x174d55, emissiveIntensity: 0.42 });
    for (const [radius, material] of [[2.65, gold], [3.15, cyan]]) {
      const inlay = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 72), material);
      inlay.rotation.x = Math.PI / 2;
      inlay.position.y = 0.035;
      inlay.receiveShadow = true;
      roundabout.add(inlay);
    }

    const fountain = new THREE.Group();
    fountain.position.set(0, 0, 0);
    roundabout.add(fountain);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.88, 0.32, 48), mat(0x393a4b, 0.3, 0.6));
    rim.position.y = 0.16;
    rim.castShadow = true;
    rim.receiveShadow = true;
    fountain.add(rim);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(1.67, 0.06, 10, 48), gold);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.34;
    fountain.add(trim);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 0.08, 48), mat(0x157c91, 0.2, 0.35, { emissive: 0x07515f, emissiveIntensity: 0.45 }));
    water.position.y = 0.35;
    fountain.add(water);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 24), gold);
    nozzle.position.y = 0.45;
    fountain.add(nozzle);
    const spray = mat(0x9feef7, 0.12, 0.08, { emissive: 0x2ba6b7, emissiveIntensity: 0.45, transparent: true, opacity: 0.9, depthWrite: false });
    const ripples = [0.48, 0.78].map((radius) => {
      const ripple = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0x76ecf3, transparent: true, opacity: 0.55, depthWrite: false }));
      ripple.rotation.x = Math.PI / 2;
      ripple.position.y = 0.405;
      fountain.add(ripple);
      return ripple;
    });
    const dropletCount = 128, streamCount = 8;
    const streamCapacity = Math.ceil(dropletCount / streamCount);
    const random = (seed) => {
      const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return value - Math.floor(value);
    };
    const droplets = Array.from({ length: dropletCount }, (_, i) => {
      const stream = i % streamCount;
      const speed = 1.8 + random(i + 1) * 0.45;
      const gravity = 2.8 + random(i + 257) * 0.35;
      const lifetime = (speed + Math.sqrt(speed * speed - 2 * gravity * 0.11)) / gravity;
      return {
        angle: stream * Math.PI * 2 / streamCount + (random(i + 521) - 0.5) * 0.18,
        phase: (Math.floor(i / streamCount) + 0.15 + random(i + 787) * 0.7) / streamCapacity,
        speed,
        gravity,
        lifetime,
        outwardSpeed: 0.28 + random(i + 1031) * 0.3,
        size: 0.035 + random(i + 1277) * 0.016
      };
    });
    const dropletCloud = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), spray, dropletCount);
    dropletCloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dropletCloud.frustumCulled = false;
    fountain.add(dropletCloud);
    fountainAnimation = { elapsed: 0, water, ripples, droplets, dropletCloud, dropletTransform: new THREE.Object3D() };
  }

  if (lv.id === 5) {
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 12.8),
      new THREE.MeshStandardMaterial({ color: 0x8f1f2f, roughness: 0.78 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.07, 0);
    carpet.receiveShadow = true;
    levelProps.add(carpet);
  }

  if (parkingType.includes('island')) {
    const island = new THREE.Group();
    island.position.set(0, 0, -1.72);
    levelProps.add(island);
    const stone = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.32, 0.9), mat(0x565c53, 0.85));
    stone.position.y = 0.16;
    stone.castShadow = true;
    island.add(stone);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.16, 0.72), mat(0x473e2d, 1));
    soil.position.y = 0.38;
    island.add(soil);
    for (const [x, z, scale] of [[-0.62, 0, 0.72], [0, -0.08, 0.92], [0.62, 0.03, 0.76]]) {
      const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46 * scale, 0), mat(0x376345, 0.9));
      bush.position.set(x, 0.52 + 0.2 * scale, z);
      bush.scale.set(1.1, 0.8, 0.9);
      bush.castShadow = true;
      island.add(bush);
    }
    // median is visual only: a collider here blocked the aisle and exit lane
  }

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
    G.colliders.push({ x, z, r: 0.5, lv: true, kind: 'cone' });
  }

}

// Venue-only animation; level hazards such as cones are updated elsewhere.
export function updateLevelProps(dt) {
  updateVenue(dt);
  if (!fountainAnimation) return;
  const animation = fountainAnimation;
  animation.elapsed += dt;
  animation.water.material.emissiveIntensity = 0.4 + 0.08 * Math.sin(animation.elapsed * 2.4);
  animation.ripples.forEach((ripple, i) => {
    const phase = (animation.elapsed * 0.55 + i * 0.5) % 1;
    const scale = 0.75 + phase * 0.7;
    ripple.scale.set(scale, 1, scale);
    ripple.material.opacity = 0.6 * (1 - phase);
  });
  animation.droplets.forEach((drop, i) => {
    const age = ((animation.elapsed / drop.lifetime + drop.phase) % 1) * drop.lifetime;
    const radius = 0.08 + drop.outwardSpeed * age;
    const y = 0.51 + drop.speed * age - 0.5 * drop.gravity * age * age;
    animation.dropletTransform.position.set(Math.cos(drop.angle) * radius, y, Math.sin(drop.angle) * radius);
    animation.dropletTransform.scale.setScalar(drop.size);
    animation.dropletTransform.updateMatrix();
    animation.dropletCloud.setMatrixAt(i, animation.dropletTransform.matrix);
  });
  animation.dropletCloud.instanceMatrix.needsUpdate = true;
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
