// The Shifts HUD: score, duel count, guest / tutorial banner and the urgent-guest card. Pure reads of the shared state, refreshed ~10x a second.
import { quirkLine } from './cars.js';
import { COLOR_NAMES, SPECIALS } from './config.js';
import { colorHex, ui } from './core.js';
import { cars, G, layout, rivalScore, rush, tutorial } from './state.js';

const MODEL_NAMES = { 'sedan.glb': 'sedan', 'suv-luxury.glb': 'luxury SUV', 'sedan-sports.glb': 'sports sedan', 'hatchback-sports.glb': 'sports hatchback', 'taxi.glb': 'taxi' };

function carsStillHere() {
  let n = 0;
  for (const c of cars) if (!c.leaving && !(c.handoffT > 0)) n++;
  return n;
}

const TUTORIAL_TEXT = {
  key: ['TUTORIAL 1/4 · GET THE CAR', 'Run to the 🔑 car', () => `${layout.move} / arrows move you. Run up to the car and you hop in (or press E).`],
  park: ['TUTORIAL 2/4 · PARK IT', null, 'W drives, S reverses, A / D steers. Roll slowly into the glowing ring and it parks itself.'],
  call: ['TUTORIAL 3/4 · A GUEST IS LEAVING', 'Run to the 🔔 car', 'Run up to it to get in, then back out of the bay with S.'],
  deliver: ['TUTORIAL 4/4 · HAND IT OVER', 'Green PICK-UP ring →', 'Drive in and stop (or press Space). Quick hand-offs pay more.'],
  done: ['TUTORIAL COMPLETE', 'Nice work!', 'Now the real clock starts. Perks, combos and crowds ahead.'],
};

export function updateRushHUD() {
  ui.score.textContent = '$' + String(G.score).padStart(3, '0');
  ui.streak.textContent = '×' + rush.mult;
  ui.streak.classList.toggle('hot', rush.mult >= 3);
  const you = rush.parked + rush.delivered, rvN = rivalScore();
  ui.lives.textContent = tutorial.on ? '–' : rush.sceneLab ? 'LAB' : `${you}–${rvN}${you === rvN ? '' : you > rvN ? ' ▲' : ' ▼'}`; // campaign duel score
  ui.lives.style.color = tutorial.on || rush.sceneLab || you === rvN ? '' : you > rvN ? 'var(--mint)' : 'var(--coral)';
  ui.step.textContent = rush.sceneLab ? `SCENE LAB · ${rush.lv.name}` : `SHIFT ${rush.lv.id} · ${rush.lv.name}${rush.stats.perks.length ? ' ' + rush.stats.perks.join('') : ''}`;
  ui.bar.style.width = (tutorial.on || rush.sceneLab ? 0 : Math.min(100, rush.elapsed / rush.lv.secs * 100)) + '%';
  const timeLabel = document.getElementById('timeLabel');
  if (timeLabel) timeLabel.textContent = rush.sceneLab ? 'TEST' : 'TIME';
  ui.brief.dataset.mode = 'arrival';
  ui.jarFill.style.width = (rush.meter * 100) + '%';
  ui.jarLabel.textContent = rush.chain > 0 ? `CHAIN ${rush.chain}` : '';
  ui.jar.style.visibility = rush.chain > 0 && !tutorial.on ? '' : 'hidden';

  ui.title.textContent = '';
  const pl = rush.pl;
  const bayName = (sl) => String(sl ? sl.id : 0).padStart(2, '0');
  if (G.activeCar && G.activeCar.delivering) {
    const dc = G.activeCar.call;
    ui.callLabel.textContent = 'GUEST WAITING · DRIVE TO PICK-UP' + (dc && !tutorial.on ? ` · ${Math.max(0, Math.ceil(dc.left))}s` : '');
    ui.callMain.textContent = 'Green ring → right side';
  } else if (G.activeCar && G.activeCar.slot) {
    const nx = rush.nextSlot && !rush.nextSlot.car ? ' → ' + String(rush.nextSlot.id).padStart(2, '0') : '';
    ui.callLabel.textContent = G.activeCar.vipActive ? `⭐ VIP · DOUBLE TIPS · ${Math.ceil(G.vipLeft)}s` : 'PARK FAST · KEEP THE COMBO';
    ui.callMain.textContent = `Bay ${bayName(G.activeCar.slot)}${nx}`;
  } else {
    const parts = [];
    if (rush.waiting) parts.push(`🔑 Bay ${bayName(rush.waiting.slot)}${tutorial.on ? '' : ` · ${Math.max(0, Math.ceil(rush.waiting.waitLeft))}s`}`);
    for (const call of rush.calls) if (call.state === 'waiting') parts.push(`🔔 Bay ${bayName(call.slot || call.car.slot)}`);    for (const call of rush.calls) if (call.state === 'waiting') parts.push(`🔔 Bay ${bayName(call.slot || call.car.slot)}${tutorial.on ? '' : ` · ${Math.max(0, Math.ceil(call.left))}s`}`);    ui.callLabel.textContent = parts.length ? 'ON FOOT · RUN TO A CAR' : 'ON FOOT · NEXT GUEST COMING';
    ui.callMain.textContent = parts.length ? parts.join('  ·  ') : 'Hang tight…';
  }
  if (rush.sceneLab) {
    ui.callLabel.textContent += ' · SCENE LAB';
  } else if (!tutorial.on) {
    const left = Math.max(0, rush.guestTotal - rush.arrived) + carsStillHere();
    ui.callLabel.textContent += ` · ${left} CAR${left === 1 ? '' : 'S'} LEFT`;
  }
  let text = `Roll into the glowing ring. It parks itself.${quirkLine(G.activeCar)}`;
  const fx = [];
  if (rush.nitro > 0) fx.push(`⚡ NITRO ${Math.ceil(rush.nitro)}s · hold W`);
  if (rush.boost > 0) fx.push(`💰 ×2 TIPS ${Math.ceil(rush.boost)}s`);
  if (rush.coffee > 0) fx.push(`☕ COFFEE ${Math.ceil(rush.coffee)}s`);
  if (rush.wedding > 0) fx.push(`💒 WEDDING +30% ${Math.ceil(rush.wedding)}s`);
  if (fx.length) text = fx.join(' · ');
  else if (G.activeCar && G.activeCar.delivering) text = 'Back out and drive into the green PICK-UP ring. Stop inside and it hands over (or press Space).';
  else if (pl && pl.mode === 'foot') text = rush.near ? '👉 Stay next to the car to hop in (or press E).' : 'You are on foot: follow the arrow to the 🔑 / 🔔 car.';
  ui.text.textContent = text;

  if (tutorial.on && TUTORIAL_TEXT[tutorial.step]) {
    const [label, main, rawBody] = TUTORIAL_TEXT[tutorial.step];
    const body = typeof rawBody === 'function' ? rawBody() : rawBody;
    ui.callLabel.textContent = label;
    ui.callMain.textContent = main || `Drive to bay ${bayName(G.activeCar && G.activeCar.slot)}`;
    ui.text.textContent = body;
  }
  ui.brief.dataset.info = tutorial.on || fx.length ? '1' : '';

  // The most urgent guest's banner: colour swatch + countdown, so the car is easy to find.
  const live = rush.calls.filter((k) => k.state !== 'rival');   // calls the rival is delivering are not yours to chase
  const urgent = live.length ? live.reduce((a, b) => (b.left < a.left ? b : a)) : null;
  if (urgent) {
    const c = urgent.car;
    const who = `<span class="swatch" style="background:${colorHex(c)}"></span>The ${COLOR_NAMES[c.colorIndex].toLowerCase()} ${MODEL_NAMES[c.file] || 'car'}${c.special ? ' ' + SPECIALS[c.special].icon : ''}`;
    if (ui.owner.dataset.k !== who) { ui.owner.dataset.k = who; ui.owner.innerHTML = who; }
    const more = live.length > 1 ? ` · +${live.length - 1} more waiting` : '';
    ui.plate.textContent = tutorial.on ? 'RETURN THEIR CAR' : `RETURN THEIR CAR · ${Math.max(0, Math.ceil(urgent.left))}s${more}`;
    ui.pickup.classList.add('show');
  } else {
    ui.pickup.classList.remove('show');
  }
}
