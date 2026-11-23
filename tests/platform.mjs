import assert from 'node:assert/strict';

let settingsListener = null;
let loadingStarts = 0, loadingStops = 0, adRequests = 0;
let storedPlatformSave = null;
let loggedIn = false;
let dataWrites = 0;
const endCounts = { gameplayStart: 0, gameplayStop: 0 };

const sdk = {
  init: async () => {},
  game: {
    settings: { muteAudio: true },
    loadingStart: () => { loadingStarts++; },
    loadingStop: () => { loadingStops++; },
    gameplayStart: () => { endCounts.gameplayStart++; },
    gameplayStop: () => { endCounts.gameplayStop++; },
    addSettingsChangeListener: (listener) => { settingsListener = listener; },
  },
  user: {
    systemInfo: { device: { type: 'mobile' } },
    getUser: async () => loggedIn ? { username: 'TestValet' } : null,
  },
  data: {
    getItem: () => storedPlatformSave,
    setItem: (key, value) => { storedPlatformSave = value; dataWrites++; },
  },
  ad: {
    hasAdblock: async () => false,
    requestAd: (type, callbacks) => {
      adRequests++;
      callbacks.adError({ code: 'adsDisabled', message: 'Ads disabled for this session' });
    },
  },
};

Object.defineProperty(globalThis, 'window', { configurable: true, value: { CrazyGames: { SDK: sdk } } });
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { hostname: 'localhost', search: '?sdk', ancestorOrigins: [], referrer: '' },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { referrer: '', ancestorOrigins: [], getElementById: () => ({ classList: { toggle() {} } }) },
});
const localStore = new Map();
globalThis.localStorage = {
  getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: (key) => localStore.delete(key),
};

const platform = await import('../platform.js?platform-test');
assert.equal(await platform.initPlatform(), true);
assert.equal(loadingStarts, 1);
assert.equal(platform.getSystemInfo().device.type, 'mobile');

const appliedSettings = [];
platform.onGameSettingsChange((settings) => appliedSettings.push(settings.muteAudio));
assert.deepEqual(appliedSettings, [true]);
sdk.game.settings = { muteAudio: false };
settingsListener(sdk.game.settings);
assert.deepEqual(appliedSettings, [true, false]);

platform.loadingComplete();
assert.equal(loadingStops, 1);
const earlyLoadingPlatform = await import('../platform.js?platform-early-loading-test');
earlyLoadingPlatform.loadingComplete();
assert.equal(await earlyLoadingPlatform.initPlatform(), true);
assert.equal(loadingStarts, 1, 'do not start a zero-duration load after loading already completed');
assert.equal(loadingStops, 1);
platform.gameplayStart();
platform.gameplayStop();
assert.deepEqual(endCounts, { gameplayStart: 1, gameplayStop: 1 });

let rewardResult;
platform.rewardedAd(() => {}, (ok, error) => { rewardResult = { ok, code: error.code }; });
assert.deepEqual(rewardResult, { ok: false, code: 'adsDisabled' });
assert.equal(platform.rewardedState(), 'unavailable');

let continued = false;
platform.midgameAd(() => {}, () => { continued = true; });
assert.equal(continued, true);
assert.equal(adRequests, 1);

const midgamePlatform = await import('../platform.js?platform-midgame-test');
assert.equal(await midgamePlatform.initPlatform(), true);
let resumed = false;
midgamePlatform.midgameAd(() => {}, () => { resumed = true; });
assert.equal(resumed, true);
assert.equal(midgamePlatform.rewardedState(), 'unavailable');
let secondRewardCode;
midgamePlatform.rewardedAd(() => {}, (ok, error) => { secondRewardCode = error.code; });
assert.equal(secondRewardCode, 'adsDisabled');
assert.equal(adRequests, 2);
midgamePlatform.loadingComplete();

const appPlatform = await import('../platform.js');
assert.equal(await appPlatform.initPlatform(), true);
assert.equal(await appPlatform.isGuestUser(), true);
const progress = await import('../progress.js');
const staleLocal = JSON.stringify({ xp: 900, levels: { 1: { stars: 3, best: 900 } } });
localStorage.setItem('valetSave2', staleLocal);
storedPlatformSave = JSON.stringify({ xp: 120, levels: { 1: { stars: 1, best: 240 } } });
progress.load();
progress.loadFromPlatform();
assert.equal(progress.save.xp, 120, 'account data wins even when local data ranks higher');
assert.equal(progress.save.levels[1].best, 240);

loggedIn = true;
storedPlatformSave = null;
assert.equal(await appPlatform.isGuestUser(), false);
progress.loadFromPlatform(storedPlatformSave, false);
assert.equal(progress.save.xp, 0, 'a new account does not inherit local progress');
assert.equal(dataWrites, 0, 'no save is pushed to a new account during load');

loggedIn = false;
storedPlatformSave = null;
const writesBeforeMigration = dataWrites;
progress.loadFromPlatform(storedPlatformSave, await appPlatform.isGuestUser());
assert.equal(progress.save.xp, 900, 'legacy data migrates for a guest');
assert.equal(JSON.parse(storedPlatformSave).xp, 900, 'guest migration is saved to CrazyGames Data');
assert.equal(dataWrites, writesBeforeMigration + 1);

const localBeforeSave = localStorage.getItem('valetSave2');
progress.addXp(10);
assert.equal(localStorage.getItem('valetSave2'), localBeforeSave, 'normal platform saves do not maintain a parallel local copy');
assert.equal(JSON.parse(storedPlatformSave).xp, 910);
appPlatform.loadingComplete();

console.log('platform test: all checks passed');
