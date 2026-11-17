# Valet Panic — Nocturne Hotel

An isometric 3D browser game prototype. The level is a single rooftop hotel valet forecourt. Two modes, picked on the title screen:

- **Classic** – guests arrive in distinct cars, you park each in its assigned bay, then find the right vehicle when the lobby calls.
- **Shifts** – a 10-level arcade campaign, played as a **duel against an AI rival valet**. Both of you work the same lot and race for the same cars; whoever parks and returns more cars before the shift ends wins. Each shift has its own parking rules and a results screen. Park fast, chain combos, hand cars back to guests, and beat the rival to them.
- **Daily Run** – one harder shift per day, the same for everyone (seeded cars), with a streak bonus.

## Shifts (campaign)
Each shift has a set number of guests (5–10), a time limit (110–195 s) and its own rules. **You must beat the rival to unlock the next shift** (1 star); replay to win by more for 2 and 3 stars. **The shift ends when the lot is empty**: after the last guest has arrived, "closing time" begins and the level completes once every car has been handed back (or the clock runs out). The results screen shows stars, XP, unlocks, your clear bonus, the mini-goal and what cost you the most, with a one-key "Next shift".

| # | Shift | What is different |
|---|---|---|
| 1 | Welcome Shift | 4 bays, wide rings, gentle pace |
| 2 | Lunch Rush | All 8 bays, guests start leaving |
| 3 | Reverse Night | **Back into the bay** (nose must face out), 6 bays |
| 4 | Cone Alley | Traffic cones turn the approach into a slalom |
| 5 | Rainy Evening | **Slippery tarmac** (rain), two guests at the curb |
| 6 | Cart Crossing | A bellhop's **luggage cart** sweeps across the lot |
| 7 | Tight Squeeze | Only 4 bays open, **tiny rings**, slower park speed |
| 8 | VIP Gala | Half the guests are VIPs (double tips), noisy quirk cars |
| 9 | Valet Storm | Rain + cones + three guests at once |
| 10 | Midnight Finale | Reverse parking + luggage cart + VIPs |

Closed bays are marked in red and are solid (the collider sits exactly on the closed bay, so open bays are never blocked). All the numbers live in `LEVELS` in `config.js` (`guests`, `secs`, `stars`, `callsFrom`, `calls`…); **the star goals are first estimates, so tune them after playtests.**

### The rival duel
- **Score:** every car you park and every car you return is 1 point; the same for the rival. The HUD box **YOU–RIVAL** shows the live score (green when you lead, red when you trail).
- **Stars:** ★ beat the rival (a tie is not a win) · ★★ win by about 20% of the shift's car moves · ★★★ win by about 40% (`duelGoals()` in `config.js`; e.g. shift 1 is win / +2 / +4). Tips still count for the score, the shift best and the Daily leaderboard, but no longer decide stars.
- **How he plays:** he stands near the start, notices a new job after a short reaction delay, runs to it and, if you have not taken it first, hops in and drives it along a fixed lane route (`routes.js`). Two kinds of job: the 🔑 car at the drop-off, or a 🔔 car a guest wants back. If you reach a car first, he goes looking for another. He never crashes and never fails a guest, so the only way to beat him is speed and combos.
- **Difficulty** rises with the shift (`diff`): his run speed is 2.6 + 0.2×diff (you run at 4.8), driving speed 2.6 + 0.16×diff (you top out at 4.4), and he notices a job after 2.4 − 0.17×diff seconds. **These numbers are untested first guesses.**
- **Honk (H / HONK button)** freezes a rival who is running within a few metres for about a second.
- The tutorial has no rival. The Daily Run is a duel too, on a harder shift.

### How a shift plays
- **You ARE the valet, on foot.** WASD / arrows run around the lot. No ID tags, no strikes, no memory. Pressing play on the title screen jumps straight into your next shift (the Shifts card says "Start here"); **📋 All shifts** opens the level list.
- **Shift intro and boons.** Shift 1 and the tutorial start at once. From shift 2 (and in the Daily Run) a short intro card shows what is special about the shift and the star goals, and you pick 1 of 3 **boons** (press 1, 2 or 3). The clock is frozen until you pick. A toast and the **mini-goal** (a small optional challenge worth +25 XP) appear once the shift starts. A doorman stands at the drop-off.
- **Arrivals.** A guest's car pulls up at the gold **DROP-OFF**; a 🔑 floats over it. Run to it, press **E / Space**, drive to the glowing bay and it parks itself (roll in straight and slow). If nobody takes the keys in time (about 24 s, shorter later; the 🔑 blinks) the guest drives off: −$15 and the combo is lost.
- **Departures.** Pickup calls start late (each level has a `callsFrom` time, and at least 2 cars must be in the lot, whoever parked them) and are spaced out. **Safety net:** if nothing is happening and no guest can arrive (the lot is full for 2 s, or a dead spell of 9 s), a guest is called back at once, so a full lot can never freeze a shift. The guest walks to the green **PICK-UP** curb (🔔 over the car, orange bay). Run to the car, reverse out, drive into the PICK-UP ring and stop (or press Space). Quick hand-offs (more than 50% patience left) pay more and give double combo points. A guest who gives up costs −$20 and the combo.
- **Closing time.** After the last arrival, remaining cars are called back one by one. When the lot is empty you get a clear bonus and the level completes.
- **Combo.** Each park or hand-off fills the combo meter; perfect parks and quick hand-offs count double (the chime rises with your streak). Every 3 chain points adds ×1 to all tips (up to ×8). The meter drains in about 7 s; a hard crash knocks 30% off it.
- **Special guests (shift 2+):** 🎬 Celebrity (tips ×1.8), 🚙 Vintage car (crashes cost $10), 🗺️ Tourist (+$12), 🐕 Dog guest (+$8, the dog comes along). They speak in a bubble when they arrive.
- **Random events:** 🌧️ a shower (slippery for 14 s), 💒 a wedding party (+30% tips for 15 s), 🚙 a VIP convoy (next 3 cars are VIPs).
- **Pickups on the lot** appear later in the shift (not at the start) and last 12 s: ⚡ Nitro, ⏱️ +5 s, 💰 ×2 tips, 🪙 Lucky coin (+$15), ☕ Coffee (run faster). A few bonus tokens also sit around the lot.
- **Honk (H):** a tap of the horn makes the luggage cart stop for a moment. The sound depends on your equipped horn.
- **Near miss:** squeezing past a cone or the cart with a hair to spare gives +$3 and a short slow-motion moment.
- **HUD.** The YOU–RIVAL box shows the duel score.
- **Tutorial.** The first time you open Shifts you get a 4-step guided run (clock frozen) that leads into shift 1. Replay it from the title screen; Skip is in the pause menu.
- **Instant retry / continue:** Space or Enter on the results screen (Next shift after a win, retry after a loss).
- **Boons** (`RUSH_PERKS` in `config.js`) last for one shift only: Head Start, Extra Time, Big Tipper, Slow Burn, Wide Ring, Sneakers, Bumper Guards, Calm Guests, Power Magnet. They are opened by `offerShiftIntro()` from `startRush()`.
- **Playtest log.** Every finished shift or Daily Run is appended to `save.runLog` (last 60: score, stars, time left, crashes, guests lost, combo, boon). **📊 Copy playtest log** on the title screen copies the runs plus a per-shift summary (how often each star goal was reached) as JSON. Use it to tune `stars` in `LEVELS`.

## Daily Run
One shift (shifts 3–10, chosen by the date) with a seeded lot: everyone gets the same cars, bays, mini-goal and power-up timings that day (local time), using only the base car paints. Retry as often as you like; your best of the day and your all-time top ten are kept. The first Daily Run of each day pays a streak bonus in XP (20 per day of streak, up to 100).
The leaderboard is local to the browser. `submitScore()` in `progress.js` is the hook for a real online board.

## Progression and the Locker
Every run earns XP (Classic, shifts and the Daily Run; stars and first clears pay extra). Player levels unlock cosmetics, which you equip in the **Locker** on the title screen:
- Uniforms (levels 2, 4, 6, 9), **hats** (Top Hat 3, Beret 5, Gold Crown 8), **horns** (Beep Beep 4, Trumpet 6), bay-line themes (3, 5, 7), confetti styles (4, 6, 8) and four extra car paints (3, 5, 7, 9) that start appearing on the lot.
- Progress (including shift stars) lives in one `localStorage` record (`valetSave2`); the old single-value keys are migrated on first launch.

## Classic mode: how a night works
*Classic got a gentler first-pass retune (longer clock, more patient guests, fewer quirk and VIP cars, a bit more breathing room between cars). It is untested: use the same playtest approach as for Shifts.*

- **Shift 1 is a tutorial:** 3 guests, 110 seconds, single-digit IDs, no quirks. Later shifts have 4, 5, 6… guests and 95 seconds. Two-digit IDs arrive from shift 3.
- Three strikes ends the night. A guest who gives up waiting is a strike. One strike is restored after each completed shift.
- **Quirks arrive one per shift:** 🛞 Bad Brakes (shift 2), ⭕ Wide Turn (3), 💧 Leaky Roof (4), 📯 Loud Horn (5). The newest one shows up most. Quirk cars pay extra.
- **VIP guests (⭐, from shift 3):** park within 16 seconds for double tips; they tip more on pickup but are less patient.
- Best night is saved in localStorage.
- Sound: a procedural music loop (no audio files) that gains layers and tempo with your streak (Classic) or combo and level (Shifts).

### Memory is fair
- After you park, the car's tag stays readable for 2 seconds, then fades. No pickup is called while a tag is still readable.
- The pickup banner shows the guest's car colour, so colour is a real memory aid.
- **Peek:** hover a car for a moment (mouse), or press and hold (touch), to see its tag for 2.5s. It costs $5 (free with Master Key).

### Mistakes are cheaper
- The first wrong car each shift is a free pass (−$10, streak reset). After that it is a strike. Spare Key adds more free passes.
- The shift clock pauses during a pickup; only the guest's own timer runs. Guests wait about 20s at first (down 0.75s per shift, minimum 10s). A strike costs 2 seconds on the clock.
- **Mercy hint:** in the last 3 seconds of a pickup, the requested car's bay lights up.

### Driving helps you
- Snappier steering, quicker coasting stop, a bigger parking ring and speed limit.
- **Park assist:** near your own bay and slow, the car straightens itself and drifts toward the middle.

### Perks, combo and juice
- After each shift, pick 1 of 3 perks (they stack): Long Memory, Wide Ring, Spare Key, Big Tipper, Calm Guests, Extra Hour, Master Key.
- **Parking quality:** tips grow with how centred, straight and gentle you park. A perfect park adds to your combo, with confetti and a chime.
- Combo (streak) boosts all tips by up to +50%. Wrong cars and timeouts reset it.
- **Tip jar:** every $100 of tips fills it and pays a $10 bonus.

## Controls
- WASD / arrow keys: drive and steer (in Shifts: run, when you are on foot)
- E / Space / ACTION button: get into a car (Shifts, on foot), park, or hand a car over. In Shifts you also hop in by running up to the 🔑 / 🔔 car, and a gold arrow points the way.
- Space: park when you are in the highlighted bay, lined up and moving slowly
- Click/tap a parked car: return the car requested by the lobby
- Esc, P or the ❚❚ button: pause (switching tabs also pauses)
- H, or the on-screen HONK button on touch: honk (Shifts, while driving)
- ♫: toggle sound
- Touch: on-screen arrows, Park / Action and (in Shifts) Honk buttons on narrow screens

## Run locally
The game uses ES modules, so serve it over HTTP rather than opening `index.html` as `file://`:

```
python -m http.server 5173
```

Then visit http://127.0.0.1:5173.

Add `?debug` to the URL to expose `window.__valet` (state, `startRush`, `endRush`, `offerShiftIntro`, the save record) for automated tests (`startRush({level: N})`, `showLevelSelect()`, `endRush()`, score/seconds setters).

## Project layout
Flat ES modules, no build step. `index.html` loads `game.js`, which imports the rest.

| File | What it holds |
|---|---|
| `index.html` | markup and styles |
| `game.js` | **entry point**: boot, the main `update()` / render loop (camera, shake, engine audio, music), quality scaling, `?debug` hook |
| `state.js` | shared state: the `G` object (score, mode, running, phase…) plus `rush`, `tutorial`, `perks`, `keys`, `cars`, `slots`, `addTime()` and the late-bound `hooks` |
| `core.js` | renderer, scene, camera, DOM `ui` refs, difficulty and tuning helpers, toast / coach / popScore, confetti |
| `cars.js` | car models, spawning, placement, tags, peek |
| `driving.js` | car physics, collisions, parking assist, exit lane |
| `people.js` | procedural valet and guest figures, walking, hand-off and drop-off rings |
| `fx.js` | particles, rings, car animation |
| `input.js` | keyboard, mouse, touch, sound button |
| `menus.js` | title screen, level select, locker, cards, pause |
| **`classic.js`** | **Classic mode**: arrivals, pickups, strikes, perks, shift end, per-frame `updateClassic()` |
| **`shifts.js`** | **Shifts / Daily Run**: start and end of a shift, arrivals, calls, closing time, combo, mini-goals, HUD, the **rival AI**, `updateRush()` |
| `routes.js` | pure waypoint helpers for the rival (walking and driving lanes, approach points); unit-tested |
| `shifts-world.js` | Shifts support: level layout (closed bays, cones, cart, rain), tokens and power-ups, events, honk, near miss, boon picker |
| `config.js` | all tuning constants and static data (`LEVELS`, perks, quirks, specials, cosmetics, layout) |
| `progress.js` | save record, XP and levels, unlock rules, daily seed, local leaderboards |
| `platform.js` | CrazyGames SDK wrapper (no-op without the SDK) |
| `world.js` | lighting, forecourt, hotel, bays, props and prop colliders |
| `audio.js` | sampled engine loop and effects with synth fallback, procedural music |
| `assets/` | bundled Three.js, Kenney car models and sounds (`assets/sounds/CREDITS.txt`) |

**Shared state rule:** ES imports are read-only, so any value that several modules reassign lives on the `G` object (`G.score += 5`). Objects that are only mutated (`rush`, `keys`…) are exported directly. `shifts-world` no longer imports `shifts`: the two things it needed (`addTime`, the HUD refresh) live in `state.js` (`addTime`, `hooks.rushHud`, which `shifts.js` fills in). Some other modules still import each other in a cycle (e.g. `cars` ↔ `classic`, `cars` ↔ `shifts`); that is safe because they only reference each other's functions inside function bodies. Don't call another game module's function at module top level.

## Technical notes (Stage 3)
- Point lights cut from ~44 to 8 (emissive meshes and glow sprites fake the rest) for weaker GPUs and mobile.
- Cars dispose their cloned materials and tag textures when they leave the lot.
- Click picking raycasts parked cars only; tags and fake shadows never intercept clicks.
- Collisions: cars are two circles vs. parked-car boxes, planters and bollards. Bollards moved out of the bays.
- Exit: cars back out of the bay into a lane and drive off, instead of driving through neighbours.
- Main menu button on the end screen restores the title screen.
- Reduced-motion users get no screen shake, red flash or particles. Pinch-zoom is no longer disabled.
- Quality: devices with 4 GB RAM or less, 4 cores or fewer, or a touch screen start in a lighter mode (pixel ratio 1, 1024 shadow map). Any device drops to it after about six seconds under 40 fps.
- Game feel: dust trails (blue with nitro), crash sparks, a squash on crashes and parks, and an expanding ring on parks and hand-offs.

## Tests
`node tests/smoke.mjs` checks the data and save logic without a browser: level definitions, unlock chain, XP curve, daily seed, run log, the duel star thresholds and every rival route (in bounds, never through a parked-car bay, ends on the right spot). It does not play the game.

`tests/sim` is a headless liveness test: it runs the real Shifts logic (arrivals, calls, the rival, closing time) on stand-in graphics, for every shift, with an idle player, a player who parks one car and leaves, a slow player and a fast bot, and fails if a shift stops making progress or the bay/car bookkeeping goes wrong. Run it after changing shift logic:
```
cd tests/sim && npm i three
node --import ./register.mjs run.mjs                   # every shift, every player type, once
REPEAT=7:onepark:25 node --import ./register.mjs run.mjs   # shift 7, 25 random runs (level:player:count)
```
It cannot test driving feel, collisions or visuals.

## Known gaps
- The rival duel is unplayed: his speeds, reaction times and the duel star margins are first guesses. Play, then use the playtest log (it now records your score, the rival's, the margin and wins per shift). The old tip-based `stars` in `LEVELS` are unused.
- Fixed in this round: a full lot froze every shift if you had parked fewer than 2 cars yourself (the call timer only counted your own parks, and the rival now parks too).
- The rival walks and drives fixed lane routes and does not avoid you, the cones or the luggage cart; he can pass through them.
- Classic retune is untested.
- No automated gameplay tests (only the data smoke test above).
- UI fonts load from Google Fonts (self-host them before submitting; see below).

## Included game assets
- Five vehicle models from Kenney's Car Kit, CC0 1.0 (`assets/vehicles/Kenney-Car-Kit-License.txt`).
- Three.js r187 and GLTF loader utilities, MIT (`assets/three/LICENSE`).
- Sound effects: CC0 (Kenney, plus Freesound originals via OpenTTD OpenSFX); sources in `assets/sounds/CREDITS.txt`.
- Everything is bundled locally except the UI fonts: Fredoka and Nunito load from Google Fonts at runtime and fall back to system fonts (Trebuchet MS / Segoe UI / system-ui) if blocked. To bundle them, download the two families into `assets/fonts/`, add `@font-face` rules in `index.html` and remove the two `<link>` tags.

## CrazyGames note
This build targets the Basic Launch workflow. `platform.js` already loads the CrazyGames SDK when it is reachable and sends gameplayStart / gameplayStop around every break, a midgame ad on every second results-screen restart, and happytime on three-star shifts. Without the SDK it does nothing. Before submitting: check the initial download (50 MB or less, 20 MB or less for the mobile homepage), self-host the two fonts, and test on a low-end Chromebook and a real phone.