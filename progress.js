// Save data, XP / player level, unlock rules, the daily seed and the local leaderboards.
// Everything lives in one localStorage record so it can be exported or reset in one place.
import { PAINTS, OUTFITS, BAY_THEMES, CONFETTI, HATS, HORNS, LEVELS, DAILY_LEVEL_IDS } from './config.js';

const KEY = 'valetSave2';
export const MAX_PLAYER_LEVEL = 30;

const DEFAULTS = () => ({
  xp: 0,
  best: 0,            // best Classic night
  bestRush: 0,        // best Rush run
  tut: { classic: false, rush: false },
  equipped: { outfit: 'burgundy', bay: 'classic', confetti: 'party', hat: 'cap', horn: 'classic' },
  topRush: [],        // [{ score, date }] best five Rush runs (legacy)
  levels: {},         // { [levelId]: { stars, best } } campaign progress
  daily: { date: '', attempts: 0, best: 0 },
  dailyBoard: [],     // [{ date, score }] best ten daily scores of all time
  streak: { count: 0, last: '' },
  stats: { runs: 0, parked: 0, delivered: 0, bestMult: 1 },
  runLog: [],         // last 60 finished Shifts / Daily runs, for tuning the star goals from real play
});

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

export const save = DEFAULTS();

function merge(target, src) {
  for (const k of Object.keys(target)) {
    if (src && src[k] !== undefined && src[k] !== null) {
      // An empty default object (like `levels`) is a free-form map: take the saved one whole.
      if (target[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) && Object.keys(target[k]).length) merge(target[k], src[k]);
      else target[k] = src[k];
    }
  }
}

export function load() {
  let data = null;
  try { data = JSON.parse(safeGet(KEY) || 'null'); } catch (e) { data = null; }
  if (data) merge(save, data);
  else {
    // First launch of this version: carry over the old single-value keys.
    save.best = +safeGet('valetBest') || 0;
    save.bestRush = +safeGet('valetBestRush') || 0;
    save.tut.classic = safeGet('valetTut') === '1';
    save.tut.rush = safeGet('valetTutRush') === '1';
  }
  return save;
}

export function persist() { safeSet(KEY, JSON.stringify(save)); }

/* ---------- XP and levels ---------- */
// XP needed to go from level n to n + 1.
export const xpToNext = (level) => 80 + 40 * (level - 1);

export function levelInfo(xp = save.xp) {
  let level = 1, into = xp;
  while (level < MAX_PLAYER_LEVEL && into >= xpToNext(level)) { into -= xpToNext(level); level++; }
  const need = level >= MAX_PLAYER_LEVEL ? 1 : xpToNext(level);
  return { level, into: level >= MAX_PLAYER_LEVEL ? 1 : into, need };
}
export const playerLevel = () => levelInfo().level;

const ALL_ITEMS = [
  ...PAINTS.filter((p) => p.level).map((p) => ({ level: p.level, text: `🎨 ${p.name} car paint` })),
  ...OUTFITS.filter((o) => o.level > 1).map((o) => ({ level: o.level, text: `🧥 ${o.name} uniform` })),
  ...BAY_THEMES.filter((b) => b.level > 1).map((b) => ({ level: b.level, text: `🅿️ ${b.name} bay lines` })),
  ...CONFETTI.filter((c) => c.level > 1).map((c) => ({ level: c.level, text: `🎉 ${c.name} confetti` })),
  ...HATS.filter((h) => h.level > 1).map((h) => ({ level: h.level, text: `🎩 ${h.name} hat` })),
  ...HORNS.filter((h) => h.level > 1).map((h) => ({ level: h.level, text: `📯 ${h.name} car horn` })),
];

// Awards XP and reports which levels and unlocks it triggered.
export function addXp(n) {
  const before = levelInfo().level;
  save.xp += Math.max(0, Math.round(n));
  const after = levelInfo().level;
  const unlocked = ALL_ITEMS.filter((it) => it.level > before && it.level <= after).map((it) => it.text);
  persist();
  return { before, after, unlocked, gained: Math.max(0, Math.round(n)) };
}

export const isUnlocked = (item) => (item.level || 1) <= playerLevel();

export function equip(kind, id) { save.equipped[kind] = id; persist(); }
export function equippedItem(kind, list) {
  const found = list.find((i) => i.id === save.equipped[kind] && isUnlocked(i));
  return found || list[0];
}

/* ---------- daily run ---------- */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function seedFromKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Small, fast seeded generator, so every player gets the same cars on the same day.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailyToday() {
  const today = dateKey();
  if (save.daily.date !== today) save.daily = { date: today, attempts: 0, best: 0 };
  return save.daily;
}

function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

// Records a finished daily run. Returns the rank on the all-time board and the streak bonus XP.
export function recordDaily(score) {
  const d = dailyToday();
  d.attempts++;
  const isBest = score > d.best;
  if (isBest) d.best = score;

  const today = d.date;
  let bonusXp = 0;
  if (save.streak.last !== today) {
    save.streak.count = save.streak.last === dayBefore(today) ? save.streak.count + 1 : 1;
    save.streak.last = today;
    bonusXp = Math.min(100, 20 * save.streak.count);   // first run of the day pays a streak bonus
  }

  const entry = { date: today, score };
  if (score > 0) {                                   // a $0 run never earns a board place
    save.dailyBoard.push(entry);
    save.dailyBoard.sort((a, b) => b.score - a.score);
    save.dailyBoard = save.dailyBoard.slice(0, 10);
  }
  const rank = save.dailyBoard.indexOf(entry) + 1;   // 0 when it did not make the board
  persist();
  return { rank, isBest, bonusXp, streak: save.streak.count, attempts: d.attempts, todayBest: d.best };
}

export function recordRush(score, stats) {
  const prevBest = save.bestRush;
  const record = score > prevBest;
  if (record) save.bestRush = score;
  save.topRush.push({ score, date: dateKey() });
  save.topRush.sort((a, b) => b.score - a.score);
  save.topRush = save.topRush.slice(0, 5);
  save.stats.runs++;
  save.stats.parked += stats.parked || 0;
  save.stats.delivered += stats.delivered || 0;
  save.stats.bestMult = Math.max(save.stats.bestMult, stats.maxMult || 1);
  persist();
  return { prevBest, record };
}

// Appends one finished run to the playtest log (newest last, capped).
export function logRun(entry) {
  save.runLog.push({ ...entry, at: new Date().toISOString() });
  if (save.runLog.length > 60) save.runLog = save.runLog.slice(-60);
  persist();
}

// Per-shift summary of the log: runs, score range and how often each star goal was reached.
export function runLogSummary() {
  const by = {};
  for (const r of save.runLog) {
    const k = String(r.shift);
    const b = by[k] || (by[k] = { shift: r.shift, runs: 0, min: Infinity, max: 0, sum: 0, wins: 0, star1: 0, star2: 0, star3: 0, cleared: 0 });
    b.runs++; b.min = Math.min(b.min, r.score); b.max = Math.max(b.max, r.score); b.sum += r.score;
    if (r.margin > 0) b.wins++;
    if (r.stars >= 1) b.star1++;
    if (r.stars >= 2) b.star2++;
    if (r.stars >= 3) b.star3++;
    if (r.cleared) b.cleared++;
  }
  return Object.values(by).map((b) => ({ ...b, avg: Math.round(b.sum / b.runs) }));
}

// Hook for a real online leaderboard (CrazyGames / your own backend). Local-only for now.
export function submitScore(/* mode, score */) { /* no-op until a backend exists */ }

/* ---------- campaign shifts ---------- */
export const levelStars = (id) => (save.levels[id] ? save.levels[id].stars : 0);
export const levelBest = (id) => (save.levels[id] ? save.levels[id].best : 0);
export const isLevelUnlocked = (id) => id <= 1 || levelStars(id - 1) >= 1;
export const totalStars = () => LEVELS.reduce((n, l) => n + levelStars(l.id), 0);
export const starsFor = (lv, score) => lv.stars.filter((g) => score >= g).length;

// Records a finished shift and reports what changed (new stars, a new level unlocked...).
export function recordLevel(lv, score, stars = starsFor(lv, score)) {
  const prev = save.levels[lv.id] || { stars: 0, best: 0 };
  const info = {
    stars, prevStars: prev.stars, prevBest: prev.best,
    newBest: score > prev.best, firstClear: stars >= 1 && prev.stars === 0,
    unlockedNext: null,
  };
  save.levels[lv.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, score) };
  const next = LEVELS.find((l) => l.id === lv.id + 1);
  if (info.firstClear && next) info.unlockedNext = next;
  persist();
  return info;
}

// Which shift today's Daily Run plays (same for everyone on a given date).
export function dailyLevel(key = dateKey()) {
  const id = DAILY_LEVEL_IDS[seedFromKey(key) % DAILY_LEVEL_IDS.length];
  return LEVELS.find((l) => l.id === id);
}