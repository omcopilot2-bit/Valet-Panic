// The end-of-shift results card (stars, goals, breakdown, highlights, next / replay buttons). It only builds HTML from the numbers
// endRush() hands it, and calls back through `go` so it never needs to import the game loop.
import { LEVELS } from './config.js';
import { adviceFor, levelBlock, showCard, showLevelSelect, showTitle } from './menus.js';
import { levelBest, levelInfo } from './progress.js';
import { G, rush } from './state.js';

// Bonus-XP video on the results card. Only shown when ads can run (button), or one explanatory line when an ad blocker is on.
// It never blocks anything: Next / Replay work without it, and it sits above them in the same place every time.
function rewardBlock(rw) {
  if (!rw) return '';
  if (rw.state === 'ready') return `<button class="play rush reward" id="rewardXp"><span aria-hidden="true">▶</span> Watch a video · bonus +${rw.xp} XP</button><div class="adnote" id="adNote"></div>`;
  if (rw.state === 'blocked') return '<div class="adnote">An ad blocker is on, so the bonus-XP video is unavailable. Everything else works as normal.</div>';
  if (rw.state === 'unavailable') return '<div class="adnote">Video ads are unavailable for this session. Continue without the bonus, or try again later.</div>';
  return '';
}

function claimReward(rw) {
  const btn = document.getElementById('rewardXp'), note = document.getElementById('adNote');
  if (!btn) return;
  btn.disabled = true;
  rw.claim((p, error) => {
    if (!p) {
      btn.remove();
      if (note) note.textContent = error && error.code === 'adsDisabled'
        ? 'Video ads are disabled for this session. Continue without the bonus.'
        : error && error.code === 'adblock'
          ? 'An ad blocker prevented the video. Everything else works as normal.'
          : 'No video was available. Continue now, or try again later.';
      return;
    }
    btn.remove();
    if (note) note.textContent = `✓ Bonus added: +${p.gained} XP${p.after > p.before ? ' · LEVEL UP!' : ''}`;
    const tile = document.getElementById('xpTile'), li = levelInfo(), fill = document.getElementById('xpFill');
    if (tile) tile.textContent = '+' + (rw.xp + p.gained);
    if (fill) fill.style.width = Math.round(li.into / li.need * 100) + '%';
    const lvl = document.querySelector('.lvl');
    if (lvl) p.unlocked.forEach((t) => { const d = document.createElement('div'); d.className = 'unlock'; d.textContent = '🔓 ' + t; lvl.appendChild(d); });
  });
}

export function showShiftResults(r, go) {
  const { lv, st, mini, miniDone, cleared, clearBonus, you, rvN, margin, dg, stars, info, prog, next } = r;
  const lost = st.guestsLost + st.keysLost;
  const goals = [['★ Beat the rival', dg[0]], ['★★ Win by ' + dg[1], dg[1]], ['★★★ Win by ' + dg[2], dg[2]]].map(([t, g]) => `<span class="${margin >= g ? 'hit' : ''}">${t}</span>`).join('');
  const toNext = stars < 3 ? `<p class="delta ${stars ? 'up' : 'down'}">${dg[stars] - margin} more car${dg[stars] - margin === 1 ? '' : 's'} of lead for ${'★'.repeat(stars + 1)}</p>` : '<p class="delta up">Perfect shift! Maximum stars.</p>';
  const best = levelBest(lv.id);
  const bestNote = info.newBest && info.prevBest > 0 ? `<p class="delta up">▲ New best for this shift: +$${G.score - info.prevBest}</p>`
    : stars >= 3 && info.prevBest > G.score ? `<p class="delta down">$${info.prevBest - G.score} short of your best</p>` : '';
  const unlock = info && info.unlockedNext
    ? `<div class="unlock">🔓 Shift ${info.unlockedNext.id} unlocked: ${info.unlockedNext.name}</div>` : '';
  const nextLv = next ? LEVELS[lv.id] : null;
  const hl = [];
  if (st.bestStreak >= 2) hl.push(`<span>🎯 Perfect streak: ${st.bestStreak}</span>`);
  if (st.fastest !== null) hl.push(`<span>⚡ Fastest hand-off: ${Math.max(1, Math.round(st.fastest))}s</span>`);
  if (rush.maxMult >= 3) hl.push(`<span>🔥 Best combo ×${rush.maxMult}</span>`);
  if (cleared && !st.crashes) hl.push('<span class="medal">🛡️ Zero crashes</span>');
  if (cleared && !lost) hl.push('<span class="medal">🏅 No guest left behind</span>');
  const highlights = (hl.length ? `<div class="highlights">${hl.join('')}</div>` : '')
    + (mini ? `<div class="unlock">🎯 Mini-goal: ${mini.text} ${miniDone ? '✓ +25 XP' : '✗'}</div>` : '');

  showCard(`
    <div class="hero-eyebrow">SHIFT ${lv.id} · ${lv.name.toUpperCase()}</div>
    <h1 style="font-size:clamp(34px,6vw,48px)">${stars ? 'You <em>win!</em>' : margin === 0 ? 'Dead <em>heat.</em>' : 'Rival <em>wins.</em>'}</h1>
    <div class="stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map((i) => `<span class="${i <= stars ? 'on' : ''}" style="--i:${i}">★</span>`).join('')}</div>
    <div class="goals">${goals}</div>
    <p class="delta ${margin > 0 ? 'up' : 'down'}">You ${you} · Rival ${rvN}${margin === 0 ? ' · a tie is not a win' : ''}</p>
    ${cleared ? `<p class="delta up">Every guest served · clean-lot bonus +$${clearBonus}</p>` : '<p class="delta down">Time ran out with cars still in the lot</p>'}
    ${toNext}
    ${bestNote}
    <div class="features">
      <div class="feature"><b>$${G.score}</b>TIPS</div>
      <div class="feature"><b>$${best}</b>SHIFT BEST</div>
      <div class="feature"><b id="xpTile">+${prog.gained}</b>XP</div>
    </div>
    <div class="breakdown">
      <div><b>${rush.parked}</b>PARKED</div>
      <div><b>${rush.delivered}</b>RETURNED</div>
      <div class="${st.crashes ? 'bad' : ''}"><b>${st.crashes}</b>CRASHES</div>
      <div class="${lost ? 'bad' : ''}"><b>${lost}</b>GUESTS LOST</div>
    </div>
    ${highlights}
    ${unlock}
    ${rewardBlock(go.reward)}
    ${next
      ? `<button class="play rush" id="next" style="margin-top:18px;height:64px">Next: ${nextLv.name} →</button>
         <button class="play ghost" id="again" style="margin-top:10px">Replay for more stars</button>`
      : `<button class="play rush" id="again" style="margin-top:18px;height:64px">${stars ? 'Play again' : 'Try again'}</button>`}
    <button class="play ghost" id="menu" style="margin-top:10px">All shifts</button>
    <button class="play ghost" id="mainMenu" style="margin-top:10px">Main menu</button>
    <div class="retry-hint">PRESS SPACE OR ENTER TO ${next ? 'CONTINUE' : 'RETRY'}</div>
    <div class="advice">💡 ${adviceFor(st)}</div>
    ${levelBlock(prog)}`,
  { ...(go.next ? { next: go.next } : {}), ...(go.reward && go.reward.state === 'ready' ? { rewardXp: () => claimReward(go.reward) } : {}), again: go.again, menu: showLevelSelect, mainMenu: showTitle });
}
