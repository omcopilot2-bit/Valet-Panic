// CrazyGames SDK wrapper. Every call is a safe no-op when the SDK is absent (local play, blocked script,
// other hosts), so the game runs identically with or without it. Load it with initPlatform() at boot.
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

let sdk = null;
let playing = false;

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
    const ok = await loadScript(SDK_URL);
    if (!ok || !window.CrazyGames || !window.CrazyGames.SDK) return;
    await window.CrazyGames.SDK.init();
    sdk = window.CrazyGames.SDK;
    try { sdk.game.loadingStop(); } catch (e) { /* optional */ }
  } catch (e) {
    sdk = null;
  }
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

// Midgame ad at a natural break. onStart mutes and pauses, onEnd resumes. Without the SDK onEnd runs straight away.
export function midgameAd(onStart, onEnd) {
  if (!sdk) { onEnd(); return; }
  let done = false;
  const finish = () => { if (done) return; done = true; onEnd(); };
  try {
    sdk.ad.requestAd('midgame', {
      adStarted: () => { try { onStart(); } catch (e) { /* ignore */ } },
      adFinished: finish,
      adError: finish,
    });
  } catch (e) {
    finish();
  }
}