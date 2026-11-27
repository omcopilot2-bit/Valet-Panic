// CrazyGames SDK wrapper. Every call is a safe no-op when the SDK is absent (local play, blocked script,
// other hosts), so the game runs identically with or without it. Load it with initPlatform() at boot.
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SDK_INIT_TIMEOUT_MS = 8000;
const USER_LOOKUP_TIMEOUT_MS = 4000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The SDK is only requested when the game is hosted on (or embedded by) CrazyGames, or with ?sdk in the URL for testing.
// On any other host nothing is fetched from a third party.
function onCrazyGames() {
  const hosts = [location.hostname, document.referrer, ...(location.ancestorOrigins ? Array.from(location.ancestorOrigins) : [])];
  return hosts.some((h) => /(^|[/.])crazygames\.(com|net)/i.test(h)) || /[?&]sdk\b/.test(location.search);
}

export const shouldLoadSDK = () => onCrazyGames();

let sdk = null;
let playing = false;
let loadingStarted = false;
let loadingFinished = false;
let dataErrorReported = false;

function loadScript(src, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (window.CrazyGames && window.CrazyGames.SDK) { resolve(true); return; }
    const s = document.createElement('script');
    const timer = setTimeout(() => resolve(false), timeoutMs);
    s.src = src;
    s.async = true;
    s.onload = () => { clearTimeout(timer); resolve(true); };
    s.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(s);
  });
}

export async function initPlatform() {
  try {
    if (!onCrazyGames()) return false;
    const ok = await loadScript(SDK_URL);
    if (!ok || !window.CrazyGames || !window.CrazyGames.SDK) {
      console.error('Could not load the CrazyGames SDK; continuing without platform services.');
      return false;
    }
    await withTimeout(window.CrazyGames.SDK.init(), SDK_INIT_TIMEOUT_MS, 'CrazyGames SDK initialization timed out');
    sdk = window.CrazyGames.SDK;
    if (playing && sdk.game && sdk.game.gameplayStart) sdk.game.gameplayStart();
    try {
      if (!loadingFinished && sdk.game && sdk.game.loadingStart) {
        sdk.game.loadingStart();
        loadingStarted = true;
      }
    } catch (e) { console.error('Could not start CrazyGames loading measurement', e); }
    try { adBlocked = !!(sdk.ad && sdk.ad.hasAdblock && await sdk.ad.hasAdblock()); } catch (e) { adBlocked = false; }
    return true;
  } catch (e) {
    sdk = null;
    console.error('Could not initialize CrazyGames SDK', e);
    return false;
  }
}

export const isReady = () => !!sdk;

export async function isGuestUser() {
  if (!sdk || !sdk.user || typeof sdk.user.getUser !== 'function') return false;
  try { return (await withTimeout(sdk.user.getUser(), USER_LOOKUP_TIMEOUT_MS, 'CrazyGames user lookup timed out')) === null; }
  catch (e) {
    console.error('Could not determine CrazyGames account state; skipping local-save migration', e);
    return false;
  }
}

function stopLoading() {
  if (!loadingStarted || !sdk || !sdk.game || !sdk.game.loadingStop) return;
  try {
    sdk.game.loadingStop();
    loadingStarted = false;
  } catch (e) { console.error('Could not stop CrazyGames loading measurement', e); }
}

export function loadingComplete() {
  loadingFinished = true;
  stopLoading();
}

export function onGameSettingsChange(listener) {
  if (!sdk || !sdk.game) return false;
  try {
    listener(sdk.game.settings || {});
    if (sdk.game.addSettingsChangeListener) sdk.game.addSettingsChangeListener(listener);
    return true;
  } catch (e) {
    console.error('Could not apply CrazyGames game settings', e);
    return false;
  }
}

export function getSystemInfo() {
  try { return sdk && sdk.user ? sdk.user.systemInfo : null; } catch (e) { return null; }
}

/* ---------- saved data (CrazyGames Data module) ---------- */
function reportDataError(operation, error) {
  if (dataErrorReported) return;
  dataErrorReported = true;
  console.error(`Could not ${operation} CrazyGames save data. Check that the Data Module is enabled in the Developer Portal.`, error);
}

export function dataGet(key) {
  if (!sdk) return null;
  if (!sdk.data || typeof sdk.data.getItem !== 'function') {
    reportDataError('read', new Error('CrazyGames Data Module is unavailable'));
    return null;
  }
  try { return sdk.data.getItem(key); }
  catch (e) { reportDataError('read', e); return null; }
}
export function dataSet(key, value) {
  if (!sdk) return false;
  if (!sdk.data || typeof sdk.data.setItem !== 'function') {
    reportDataError('write', new Error('CrazyGames Data Module is unavailable'));
    return false;
  }
  try { sdk.data.setItem(key, value); return true; }
  catch (e) { reportDataError('write', e); return false; }
}

// Call when the player is in a playable state (not menus, intro cards or pause).
export function gameplayStart() {
  if (playing) return;
  playing = true;
  try { if (sdk) sdk.game.gameplayStart(); } catch (e) { /* ignore */ }
}

// Call on every break: menus, results, pause, ads.
export function gameplayStop() {
  if (!playing) return;
  playing = false;
  try { if (sdk) sdk.game.gameplayStop(); } catch (e) { /* ignore */ }
}

// Use sparingly: a special achievement such as a three-star shift.
export function happyTime() {
  try { if (sdk) sdk.game.happytime(); } catch (e) { /* ignore */ }
}

/* ---------- ads ---------- */
let adBlocked = false;
let adsDisabled = false;
let adRunning = false;     // a request is pending or an ad is playing: progression is blocked until it ends
let lastRewardedAt = -Infinity;
const REWARDED_COOLDOWN = 60000;   // ms between rewarded offers, so the button is never pushed

export const adBusy = () => adRunning;

// The results UI offers a button only for 'ready'; other states never leave a dead ad control.
export function rewardedState() {
  if (!sdk || !sdk.ad) return 'none';
  if (adBlocked) return 'blocked';
  if (adsDisabled) return 'unavailable';
  return performance.now() - lastRewardedAt >= REWARDED_COOLDOWN ? 'ready' : 'none';
}

// A transparent full-screen shield with a small label, so nothing can be clicked while an ad is requested or playing.
function shield(on) {
  const el = document.getElementById('adBlock');
  if (el) el.classList.toggle('show', on);
}

// Requests one ad. onStart runs when it actually begins (mute there, not before). onDone(ok, error) runs exactly once.
// ok is true only when the ad played to the end.
// Midgame: continue either way. Rewarded: grant the reward only when ok is true.
function requestAd(type, onStart, onDone) {
  if (!sdk || !sdk.ad || adRunning) { onDone(false, { code: 'unavailable' }); return; }
  adRunning = true;
  shield(true);
  let done = false, guard = 0;
  const finish = (ok, error) => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    adRunning = false;
    shield(false);
    if (type === 'rewarded') lastRewardedAt = performance.now();
    if (error && error.code === 'adsDisabled') adsDisabled = true;
    if (error && error.code === 'adblock') adBlocked = true;
    try { onDone(ok, error); } catch (e) { console.error(e); }
  };
  guard = setTimeout(() => finish(false, { code: 'timeout' }), 90000);   // failsafe: a stalled ad SDK must never leave the screen blocked
  try {
    sdk.ad.requestAd(type, {
      adStarted: () => { try { onStart(); } catch (e) { /* ignore */ } },
      adFinished: () => finish(true),
      adError: (error) => finish(false, error),
    });
  } catch (e) {
    finish(false, e);
  }
}

// Midgame ad at a natural break. onStart mutes and pauses, onEnd resumes even when ads are unavailable.
export function midgameAd(onStart, onEnd) {
  if (!sdk || adBlocked || adsDisabled) { onEnd(); return; }
  requestAd('midgame', onStart, () => onEnd());
}

// Rewarded video: onDone(true) only after the whole ad was watched.
export function rewardedAd(onStart, onDone) {
  if (rewardedState() !== 'ready') { onDone(false, { code: adsDisabled ? 'adsDisabled' : 'unavailable' }); return; }
  requestAd('rewarded', onStart, onDone);
}
