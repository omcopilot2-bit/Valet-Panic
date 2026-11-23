// Renderer, scene, camera, DOM references, audio, tuning formulas and small UI helpers (toasts, score pops, bubbles, confetti).
// This file imports nothing from the other game modules, so it is always evaluated first.
import * as THREE from 'three';
import { GLTFLoader } from './assets/three/GLTFLoader.js';
import { createAudio } from './audio.js';
import { CAR_COLORS, CONFETTI, PAINT_LEVEL, PARK_ANGLE, reduceMotion } from './config.js';
import { equippedItem, playerLevel } from './progress.js';
import { G, perks, rush, slots } from './state.js';

export { PARK_ANGLE };

export const canvas = document.querySelector('#game');

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });

renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));

renderer.shadowMap.enabled = true;

renderer.shadowMap.type = THREE.PCFShadowMap;

renderer.toneMapping = THREE.ACESFilmicToneMapping;

renderer.toneMappingExposure = 1.4;

renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();

scene.background = new THREE.Color('#11293a');

scene.fog = new THREE.FogExp2('#11293a', 0.011);

export const camera = new THREE.OrthographicCamera(-17, 17, 9.56, -9.56, 0.1, 130);

camera.position.set(0, 25, 19);

camera.lookAt(0, 0, -1.7);

export const clock = new THREE.Timer();
clock.connect(document);

export const loader = new GLTFLoader();

export const modelCache = new Map();

export const raycaster = new THREE.Raycaster();

export const pointer = new THREE.Vector2();

export const $ = (sel) => document.querySelector(sel);

export const ui = {
  time: $('#time'), score: $('#score'), streak: $('#streak'), lives: $('#lives'),
  step: $('#step'), bar: $('#stepBar'), brief: $('#brief'),
  title: $('#objectiveTitle'), text: $('#objectiveText'),
  callLabel: $('#callLabel'), callMain: $('#callMain'),
  overlay: $('#overlay'), hero: $('.hero'), toast: $('#toast'),
  pickup: $('#pickup'), owner: $('#ownerText'), plate: $('#plateText'),
  soundBtn: $('#sound'), jar: $('.jar'), jarFill: $('#jarFill'), jarLabel: $('#jarLabel'),
};

export const TITLE_HTML = ui.hero.innerHTML; // remembered so we can restore the title screen

const storedSoundOn = (() => { try { return localStorage.getItem('valetMute') !== '1'; } catch (e) { return true; } })();

export const audio = createAudio(storedSoundOn);

G.soundOn = storedSoundOn;

export const followCam = new THREE.Vector3();

/* ---------- derived tuning ---------- */
export const shiftTime = () => (G.shift === 1 ? 110 : 95) + perks.time * 10;

export const quotaFor = (s) => (s === 1 ? 3 : s + 2);

export const parkRadius = () => 1.9 + 0.25 * perks.ring + (G.mode === 'rush' ? (0.4 + 0.25 * rush.perks.ring) * rush.lv.ringScale + (rush.lv.ringScale - 1) * 1.9 : 0);

export const parkSpeed = () => 2.2 + 0.4 * perks.ring + (G.mode === 'rush' ? (0.6 + 0.3 * rush.perks.ring + 2.2 * (rush.lv.speedScale - 1)) : 0);

// Which way a parked car faces: nose-in (towards the hotel) or, on Reverse shifts, nose-out.
export const parkYaw = (target = null) => target && Number.isFinite(target.yaw)
  ? target.yaw
  : (G.mode === 'rush' && rush.lv.park === 'reverse' ? 0 : Math.PI);

export const gripOf = () => (G.mode === 'rush' ? rush.lv.grip : 1);

export const openSlots = () => slots.filter((s) => !s.closed);

export const tipMul = () => 1 + 0.2 * perks.tips;

export const comboMul = () => 1 + Math.min(G.streak, 10) * 0.05;

export const freeGuesses = () => 1 + perks.guess;

export const pickupPatience = () => Math.max(10, 20 - (G.shift - 1) * 0.75 - G.served * 0.1) + perks.patience * 3;

// Quirks, VIPs and ID digits scale with the shift (Classic) or the level (Rush Hour).
export const difficulty = () => (G.mode === 'rush' ? rush.level : G.shift);

// Only paints the player has unlocked appear on the lot.
export const paintPool = () => {
  const lv = playerLevel();
  return CAR_COLORS.map((_, i) => i).filter((i) => PAINT_LEVEL[i] <= lv);
};

const _wp = new THREE.Vector3();

export function worldToScreen(x, z, y = 0.5) {
  const p = _wp.set(x, y, z).project(camera);
  return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
}

export function shuffle(a, rng = Math.random) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function colorHex(car) { return '#' + car.color.toString(16).padStart(6, '0'); }

export function confetti(x, z) {
  if (reduceMotion) return;
  const { x: sx, y: sy } = worldToScreen(x, z);
  const colors = equippedItem('confetti', CONFETTI).colors;
  for (let i = 0; i < 24; i++) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;width:8px;height:12px;border-radius:2px;background:${colors[i % colors.length]};z-index:3;pointer-events:none`;
    document.body.appendChild(d);
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 130;
    const anim = d.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v - 60 + 150}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)' });
    anim.onfinish = () => d.remove();
  }
}

export function addFx() {
  G.coachEl = document.createElement('div');
  G.coachEl.style.cssText = 'position:fixed;left:50%;top:230px;transform:translateX(-50%);z-index:3;pointer-events:none;max-width:min(420px,86vw);text-align:center;padding:12px 20px;background:#0a1822;border:2px solid #ffc247;border-radius:16px;color:#fff7e6;font:700 15px/1.4 Nunito,system-ui,sans-serif;opacity:0;transition:opacity .3s';
  document.body.appendChild(G.coachEl);
  G.flashEl = document.createElement('div');
  G.flashEl.style.cssText = 'position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,transparent 40%,#fd4a3a 140%)';
  document.body.appendChild(G.flashEl);
}

export function coach(text, ms = 6500) {
  if (!G.coachEl) return;
  G.coachEl.textContent = text;
  G.coachEl.style.opacity = '1';
  clearTimeout(G.coachTimer);
  G.coachTimer = setTimeout(() => { G.coachEl.style.opacity = '0'; }, ms);
}

export function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(G.toastTimer);
  G.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

export function popScore(text, x, y, color) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  if (color) el.style.color = color;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

// A little speech bubble that floats up from a spot on the lot.
export function bubble(text, x, z, y = 2.1) {
  const s = worldToScreen(x, z, y);
  const el = document.createElement('div');
  el.className = 'bubble';
  el.textContent = text;
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

export function formatTime() {
  const n = Math.max(0, Math.ceil(G.seconds));
  ui.time.textContent = `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function markTarget(slot, on) {
  if (!slot) return;
  slot.glow.material.opacity = on ? 0.8 : 0;
  if (on) {
    slot.glow.material.color.set(0xffc247);
    // The painted ring is ~1.7 units; scale it to match the (more forgiving) parking radius.
    slot.glow.scale.setScalar(parkRadius() / 1.7 * (1 + Math.sin(performance.now() * 0.005) * 0.04));
  }
}

export function markAllSlots(on) { for (const s of slots) markTarget(s, on); }

export function applyModeHud() {
  const labels = document.querySelectorAll('.metric label');
  if (labels[2]) labels[2].textContent = G.mode === 'rush' ? 'COMBO' : 'STREAK';
  if (labels[3]) labels[3].textContent = G.mode === 'rush' ? 'YOU–RIVAL' : 'STRIKES';
  document.body.dataset.mode = G.mode;
  const pb = document.querySelector('#parkBtn');
  if (pb) pb.textContent = G.mode === 'rush' ? 'ACTION' : 'PARK';
  ui.time.classList.remove('low');
  ui.lives.style.color = '';
}
