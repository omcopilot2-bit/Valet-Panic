// Screens: title, locker, level select, pause, end-card helpers and the title-screen button bindings.
import { resetLot, seedCars } from './cars.js';
import { start } from './classic.js';
import { BAY_THEMES, CONFETTI, HATS, HORNS, levelMods, LEVELS, OUTFITS, PAINTS } from './config.js';
import { $, applyModeHud, audio, modelCache, TITLE_HTML, toast, ui } from './core.js';
import { cancelPeek } from './input.js';
import * as platform from './platform.js';
import { equip, equippedItem, isLevelUnlocked, isUnlocked, levelBest, levelInfo, levelStars, runLogSummary, save, totalStars } from './progress.js';
import { applyLevelLayout } from './shifts-world.js';
import { finishTutorial, startRush } from './shifts.js';
import { G, keys, rush, tut, tutorial } from './state.js';
import { venueName } from './venues.js';
import { setBayTheme } from './world.js';

/* ---------- end-screen helpers ---------- */
// "▲ New best" or "$N short of your best" so a run always ends with a target for the next one.
export function deltaLine(sc, prev, record) {
  if (record && prev > 0) return `<p class="delta up">▲ New best! +$${sc - prev} over your old record</p>`;
  if (record) return `<p class="delta up">▲ First record set: $${sc}</p>`;
  if (!prev) return '<p class="delta">Park a car to put a score on the board.</p>';
  const gap = prev - sc;
  const pct = prev ? Math.round(sc / prev * 100) : 0;
  return `<p class="delta ${gap <= prev * 0.15 ? 'up' : 'down'}">$${gap} short of your best (${pct}%)</p>`;
}

// XP bar (animated after the card is drawn) plus any new unlocks.
export function levelBlock(prog) {
  const li = levelInfo();
  const pre = levelInfo(save.xp - prog.gained);
  const startPct = pre.level === li.level ? Math.round(pre.into / pre.need * 100) : 0;
  const endPct = Math.round(li.into / li.need * 100);
  setTimeout(() => { const f = document.getElementById('xpFill'); if (f) f.style.width = endPct + '%'; }, 80);
  return `<div class="lvl"><b>Level ${li.level}</b> · +${prog.gained} XP${prog.after > prog.before ? ' · LEVEL UP!' : ''}
    <span class="xpbar"><i id="xpFill" style="width:${startPct}%"></i></span>
    ${prog.unlocked.map((t) => `<div class="unlock">🔓 ${t}</div>`).join('')}</div>`;
}

// One piece of advice based on what actually cost the player the most this run.
export function adviceFor(st) {
  const items = [
    { cost: st.guestsLost * 3, text: `${st.guestsLost} guest${st.guestsLost === 1 ? '' : 's'} walked out. Run to 🔔 cars first: they pay more and add more time.` },
    { cost: st.keysLost * 3, text: `${st.keysLost} dropped-off car${st.keysLost === 1 ? '' : 's'} sat too long. Watch the countdown by the 🔑 and get there before it empties.` },
    { cost: st.crashes * 1.5, text: `${st.crashes} crash${st.crashes === 1 ? '' : 'es'} bled your combo meter. Ease off near parked cars, or pick Bumper Guards.` },
    { cost: st.comboLost * 2.5, text: `Your combo dropped ${st.comboLost} time${st.comboLost === 1 ? '' : 's'}. Park again before the meter empties to keep the chain.` },
  ].filter((i) => i.cost > 0).sort((a, b) => b.cost - a.cost);
  if (!items.length && st.parked + st.delivered === 0) return 'Nothing parked this time. Run to the 🔑 car, press E, and drive into the glowing bay.';
  return items.length ? items[0].text : 'A clean run: no crashes, no walk-outs. Try a later shift for a tougher test.';
}

/* ---------- Locker: equip what you unlock ---------- */
export function applyCosmetics() { setBayTheme(equippedItem('bay', BAY_THEMES)); }

function showLocker() {
  const li = levelInfo();
  const handlers = { lockBack: showTitle };
  const row = (title, kind, list) => `<div><h3>${title}</h3><div class="chips">${list.map((it) => {
    const open = isUnlocked(it);
    const on = equippedItem(kind, list).id === it.id;
    const id = `eq_${kind}_${it.id}`;
    if (open) handlers[id] = () => { equip(kind, it.id); applyCosmetics(); if (kind === 'horn') audio.play('honk', 0, it.id); showLocker(); };
    return `<button class="chip${on ? ' on' : ''}" id="${id}"${open ? '' : ' disabled'}>${open ? '' : `🔒 Lv ${it.level} · `}${it.name}${on ? ' ✓' : ''}</button>`;
  }).join('')}</div></div>`;
  const paints = PAINTS.filter((p) => p.level).map((p) => {
    const open = p.level <= li.level;
    return `<span class="chip" style="opacity:${open ? 1 : 0.45};cursor:default"><span class="swatch" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>${open ? '' : `🔒 Lv ${p.level} · `}${p.name}</span>`;
  }).join('');
  showCard(`
    <div class="hero-eyebrow">VALET LOCKER · LEVEL ${li.level}</div>
    <h1>Your<br><em>locker.</em></h1>
    <p>Earn XP from every run to unlock uniforms, bay lines, confetti and new car paints.</p>
    <div class="lockers">
      ${row('UNIFORM', 'outfit', OUTFITS)}
      ${row('BAY LINES', 'bay', BAY_THEMES)}
      ${row('CONFETTI', 'confetti', CONFETTI)}
      ${row('VALET HAT', 'hat', HATS)}
      ${row('CAR HORN (press H when driving)', 'horn', HORNS)}
      <div><h3>CAR PAINTS (appear on the lot automatically)</h3><div class="chips">${paints}</div></div>
    </div>
    <button class="play ghost" id="lockBack">Back</button>`, handlers);
}

export function showCard(html, handlers) {
  document.body.classList.add('menu');
  ui.overlay.classList.remove('title');
  ui.hero.innerHTML = html;
  ui.overlay.classList.remove('hide');
  for (const [id, fn] of Object.entries(handlers)) {
    document.getElementById(id).addEventListener('click', () => { audio.ensure(); fn(); });
  }
}

export function updateBestLine() {
  const el = $('#bestLine');
  if (!el) return;
  const parts = [];
  if (G.best > 0) parts.push(`Memory $${G.best}`);
  if (totalStars() > 0) parts.push(`Duel ★ ${totalStars()}/${LEVELS.length * 3}`);
  el.textContent = parts.length ? `Best night: ${parts.join(' · ')}` : '';

  const li = levelInfo();
  const prof = $('#profileLine');
  if (prof) {
    prof.innerHTML = `Valet level ${li.level} · ${li.into}/${li.need} XP<span class="xpbar"><i style="width:${Math.round(li.into / li.need * 100)}%"></i></span>`;
  }
}

// Restores the original title screen (used by "Main menu").
export function showTitle() {
  G.running = false;
  G.paused = false;
  G.mode = 'classic';
  rush.sceneLab = false;
  applyModeHud();
  G.phase = 'arrival';
  tutorial.on = false;
  const timeLabel = document.getElementById('timeLabel');
  if (timeLabel) timeLabel.textContent = 'TIME';
  rush.picking = false;
  audio.musicStop(0.5);
  platform.gameplayStop();
  applyLevelLayout(null);
  resetLot();
  seedCars(2, false);
  document.body.classList.add('menu');
  ui.overlay.classList.add('title');
  ui.overlay.classList.remove('hide');
  ui.hero.innerHTML = TITLE_HTML;
  bindTitle();
  updateBestLine();
}

function buildPause() {
  G.pauseOverlay = document.createElement('div');
  G.pauseOverlay.className = 'overlay hide';
  G.pauseOverlay.innerHTML = `<div class="hero"><div class="hero-eyebrow">NOCTURNE HOTEL · ON BREAK</div><h1>Shift <em>paused.</em></h1><p>The guests can wait a moment. Your clock is stopped.</p><button class="play" id="resume">Resume</button><button class="play ghost" id="skipTut" style="display:none">Skip tutorial</button><button class="play ghost" id="pauseSceneLab" style="display:none">Choose another scene</button><button class="play ghost" id="pauseMenu">Main menu</button><div class="hero-foot">P OR THE PAUSE BUTTON TO RESUME</div></div>`;
  document.body.appendChild(G.pauseOverlay);
  G.pauseOverlay.querySelector('#resume').addEventListener('click', () => setPaused(false));
  G.pauseOverlay.querySelector('#pauseMenu').addEventListener('click', () => {
    G.pauseOverlay.classList.add('hide');
    G.paused = false;
    audio.pause(false);
    keys.clear();
    showTitle();
  });
  G.pauseOverlay.querySelector('#pauseSceneLab').addEventListener('click', () => {
    G.pauseOverlay.classList.add('hide');
    G.paused = false;
    audio.pause(false);
    keys.clear();
    showSceneLab();
  });
  G.pauseOverlay.querySelector('#skipTut').addEventListener('click', () => {
    G.pauseOverlay.classList.add('hide');
    G.paused = false;
    audio.pause(false);
    finishTutorial(true);
  });
}

export function setPaused(p) {
  if (!G.running || p === G.paused || rush.picking) return;   // the perk picker owns the pause while it is open
  G.paused = p;
  keys.clear();
  cancelPeek();
  if (p) platform.gameplayStop(); else platform.gameplayStart();
  if (!G.pauseOverlay) buildPause();
  G.pauseOverlay.classList.toggle('hide', !p);
  G.pauseOverlay.querySelector('#skipTut').style.display = tutorial.on ? '' : 'none';
  G.pauseOverlay.querySelector('#pauseSceneLab').style.display = rush.sceneLab ? '' : 'none';
  audio.pause(p);
}

export function addPauseUI() {
  const b = document.createElement('button');
  b.className = 'sound';
  b.id = 'pauseBtn';
  b.setAttribute('aria-label', 'Pause');
  b.textContent = '❚❚';
  b.style.fontSize = '15px';
  ui.soundBtn.parentNode.insertBefore(b, ui.soundBtn);
  b.addEventListener('click', () => setPaused(true));

  // Tab hidden -> pause. (Window blur no longer pauses, so clicking devtools is fine.)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { setPaused(true); audio.pause(true); }
    else if (!G.paused) audio.pause(false);
  });
}

export function setTitleButtons(savesReady = true) {
  const ready = savesReady && modelCache.size > 0;
  const a = $('#start'), b = $('#startRush');
  const log = $('#logBtn');
  const sceneLab = $('#sceneLabBtn');
  if (a) a.textContent = ready ? 'Memory' : 'Loading…';
  if (b) b.textContent = ready ? 'Duel' : 'Loading…';
  document.querySelectorAll('#start, #startRush, #tutorialBtn, #levelsBtn, #locker, #logBtn, #sceneLabBtn')
    .forEach((el) => { el.disabled = !ready; });
  if (log) log.hidden = !new URLSearchParams(location.search).has('debug');
  if (sceneLab) sceneLab.hidden = !new URLSearchParams(location.search).has('debug');
}

// The shift the Shifts button plays: the first unlocked one with no stars yet, else the first not at 3 stars.
function nextShiftId() {
  const f = LEVELS.find((l) => isLevelUnlocked(l.id) && levelStars(l.id) === 0) || LEVELS.find((l) => levelStars(l.id) < 3);
  return f ? f.id : 1;
}

// Playtest helper: copies every logged run plus a per-shift summary as JSON, so star goals can be tuned from real sessions.
function copyPlaytestLog() {
  if (!save.runLog.length) { toast('No runs logged yet. Play a shift first.'); return; }
  const txt = JSON.stringify({ summary: runLogSummary(), runs: save.runLog }, null, 1);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => toast(`Copied ${save.runLog.length} runs to the clipboard`), () => { window.prompt('Copy the playtest log:', txt); });
  } else window.prompt('Copy the playtest log:', txt);
}

export function bindTitle() {
  setTitleButtons();
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  on('#start', () => { audio.ensure(); start(); });
  on('#startRush', () => { audio.ensure(); if (tut.rushDone) startRush({ level: nextShiftId() }); else startRush({ tutorial: true }); });   // the very first visit is the guided run
  on('#tutorialBtn', () => { audio.ensure(); startRush({ tutorial: true }); });
  on('#locker', showLocker);
  on('#logBtn', copyPlaytestLog);
  on('#levelsBtn', () => { audio.ensure(); showLevelSelect(); });
  on('#sceneLabBtn', () => { audio.ensure(); showSceneLab(); });
}

// Unlocked-only campaign selection remains unchanged; the scene lab is an explicit, non-recording test path.
export function showSceneLab() {
  showTitle();
  applyLevelLayout(null);
  const handlers = { sceneLabBack: showTitle };
  const cards = LEVELS.map((lv) => {
    const id = `scene_${lv.id}`;
    handlers[id] = () => startRush({ level: lv.id, sceneLab: true });
    const mods = levelMods(lv).map((m) => `<span class="mod">${m.icon} ${m.name}</span>`).join('');
    return `<button class="lvl-card" id="${id}">
      <b><i>${lv.id}</i>${lv.name}</b>
      <span class="tag">📍 ${venueName(lv.id)} · ${lv.tagline}</span>
      <div class="mods">${mods}</div>
      <div class="meta"><span>Scene &amp; parking layout</span><span>${lv.bays.length} bays</span></div></button>`;
  }).join('');
  showCard(`
    <div class="hero-eyebrow">DEVELOPER PLAYTEST · NO CAMPAIGN PROGRESS</div>
    <h1 style="font-size:clamp(34px,6vw,50px)">Scene <em>lab.</em></h1>
    <p style="font-size:16px">Every venue is available. Walk and drive the real layout; runs here do not affect stars, scores, XP, or saves. Pause to return and pick another scene.</p>
    <div class="levels">${cards}</div>
    <button class="play ghost" id="sceneLabBack">Back</button>`, handlers);
}

// Level select: every shift with its stars, best score and what makes it different.
export function showLevelSelect() {
  applyLevelLayout(null);
  const handlers = { lvBack: showTitle };
  let highlighted = false;
  const cards = LEVELS.map((lv) => {
    const open = isLevelUnlocked(lv.id);
    const st = levelStars(lv.id);
    const id = `lv_${lv.id}`;
    const isNext = open && st === 0 && !highlighted;
    if (isNext) highlighted = true;
    if (open) handlers[id] = () => startRush({ level: lv.id });
    const mods = open ? levelMods(lv).map((m) => `<span class="mod">${m.icon} ${m.name}</span>`).join('') : '';
    return `<button class="lvl-card${isNext ? ' next' : ''}" id="${id}"${open ? '' : ' disabled'}>
      <b><i>${lv.id}</i>${lv.name}</b>
      <span class="tag">${open ? `📍 ${venueName(lv.id)} · ${lv.tagline}` : 'Earn a star on the previous shift to unlock.'}</span>
      <div class="mods">${mods}</div>
      <div class="meta"><span class="st">${[1, 2, 3].map((i) => `<span class="${i <= st ? 'on' : ''}">★</span>`).join('')}</span>
      <span>${open ? (levelBest(lv.id) ? `Best $${levelBest(lv.id)}` : lv.secs + 's') : '🔒'}</span></div></button>`;
  }).join('');
  showCard(`
    <div class="hero-eyebrow">SHIFTS · ★ ${totalStars()} / ${LEVELS.length * 3}</div>
    <h1 style="font-size:clamp(34px,6vw,50px)">Pick a <em>shift.</em></h1>
    <p style="font-size:16px">Hit the tip goals to earn stars. Every shift plays differently.</p>
    <div class="levels">${cards}</div>
    <button class="play ghost" id="lvBack">Back</button>`, handlers);
}