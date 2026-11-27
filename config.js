// Tunable constants and static data shared by the game modules.

export const MAX_LIVES = 3;
export const VIP_WINDOW = 16;          // seconds to park a VIP for double tips
export const TAG_TIME = 2;             // seconds a tag stays readable after parking
export const PEEK_TIME = 2.5;          // seconds a peeked tag stays readable
export const PEEK_COST = 5;
export const PEEK_DWELL = 0.35;        // hover / press-and-hold time before a peek triggers (seconds)
export const JAR_SIZE = 100;           // tips per tip-jar fill
export const JAR_BONUS = 10;
export const BOUNDS = { minX: -14.25, maxX: 14.25, minZ: -7.6, maxZ: 8.4 };
export const SPAWN = { x: -9.6, z: 6.5, yaw: Math.PI / 2 };
export const CONE_ALLEY_ROAD = { rightX: 16.35, arrivalStartZ: 8.2, exitJoinZ: 8.8, exitZ: 15.5 };
export const EXIT_LANE_BACK = -1.72;   // gap between the two bay rows
export const EXIT_LANE_FRONT = 7.6;    // clear the planter and front curb before turning out
// Bay centres [x, z]: the back row (z < 0) then the front row.
export const SLOT_POSITIONS = [
  [-9.1, -4.55], [-3.05, -4.55], [3.05, -4.55], [9.1, -4.55],
  [-9.1, 1.12], [-3.05, 1.12], [3.05, 1.12], [9.1, 1.12],
];
// Per-shift stall-centre offsets in the same order as SLOT_POSITIONS. The offsets keep every bay
// inside the lot, but make the physical rows stagger or fan out so each shift has a distinct plan.
export const PARKING_LAYOUTS = {
  1: [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],
  2: [[-0.7,0],[0,0.4],[0,0],[0.7,0.4],[0.7,0], [0,-0.4], [0,-0.4],[-0.7,0]],
  3: [[0,0.4],[0.7,0],[0,0],[-0.7,0.4],[-0.7,-0.4],[0,0],[0.7,0], [0,-0.4]],
  4: [[0,-0.4],[-0.7,0],[0.7,0], [0,0.4], [0.7,-0.4], [0,0],[-0.7,0],[0,0.4]],
  5: [[-0.75,0],[0,0.35],[0,-0.35],[0.75,0],[-0.45,0.4],[0.45,-0.4],[-0.45,-0.4],[0.45,0.4]],
  6: [[0,0],[0.7,0.4],[-0.7,-0.4],[0,0],[0,0],[0.7,-0.4],[-0.7,0.4],[0,0]],
  7: [[0.5,0],[0,0],[-0.5,0],[0,0],[0,0],[0.5,0],[-0.5,0],[0,0]],
  8: [[-0.6,0.4],[0,0],[0,0],[0.6,0.4],[0.6,-0.4],[0,0],[0,-0.4],[-0.6,-0.4]],
  9: [[0,-0.4],[0.7,0],[0,0],[-0.7,0.4],[-0.7,-0.4],[0,0],[0.7,0],[0,0.4]],
  10: [[-0.7,0.35],[0,0],[0.7,-0.35],[0,0.35],[0.7,0],[0,-0.35],[-0.7,0],[0,-0.35]],
};
// Stall/aisle archetypes. `oblique` uses paired 60-degree banks; `island` adds a planted median
// in the centre aisle; the remaining shifts use 90-degree rows with different spacing and bay masks.
export const PARKING_TYPES = {
  1: '90', 2: '90-staggered', 3: '90-roundabout', 4: '90-island', 5: '60-oblique',
  6: '90-island', 7: '90-compact', 8: '90-gala-island', 9: '60-island', 10: '60-finale-island',
};

// Pilot layouts for three venues. Each bay has an exact centre and heading.
// SLOT_POSITIONS and bay masks stay unchanged, so scoring and unlocks need no migration.
export const SLOT_LAYOUTS = {
  3: [
    { x: -10, z: -5, yaw: 0 },
    { x: -5, z: -5, yaw: 0 },
    { x: 5, z: -5, yaw: 0 },
    { x: 10, z: -5, yaw: 0 },
    { x: -6, z: 5, yaw: Math.PI },
    { x: -2, z: 5, yaw: Math.PI },
    { x: 2, z: 5, yaw: Math.PI },
    { x: 6, z: 5, yaw: Math.PI },
  ],
  5: [
    { x: -9.2, z: -4.8, yaw: Math.PI * 0.5 },
    { x: -4.6, z: -4.8, yaw: Math.PI * 0.5 },
    { x: 4.6, z: -4.8, yaw: Math.PI * 1.5 },
    { x: 9.2, z: -4.8, yaw: Math.PI * 1.5 },
    { x: -9.2, z: 2.6, yaw: Math.PI * 0.5 },
    { x: -4.6, z: 2.6, yaw: Math.PI * 0.5 },
    { x: 4.6, z: 2.6, yaw: Math.PI * 1.5 },
    { x: 9.2, z: 2.6, yaw: Math.PI * 1.5 },
  ],
  6: [
    { x: -9.8, z: -5.2, yaw: 0 },
    { x: -3.3, z: -5.2, yaw: 0 },
    { x: 3.3, z: -5.2, yaw: 0 },
    { x: 9.8, z: -5.2, yaw: 0 },
    { x: -9.8, z: 5.8, yaw: Math.PI },
    { x: -3.3, z: 5.8, yaw: Math.PI },
    { x: 3.3, z: 5.8, yaw: Math.PI },
    { x: 9.8, z: 5.8, yaw: Math.PI },
  ],
};
export const PARKED_HALF = { x: 0.95, z: 1.45 }; // collision box of a parked car
export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- lot layout (people and rings) ---------- */
export const DOOR = { x: 10.5, z: -9.08 };                                         // lobby door: z is the front plane of the door. venues.js moves it to each venue's real door
export const BUILDING_MIN_Z = -12.2;                                              // how far behind the lot edge a guest may walk to reach any venue's door (the deepest door is ~-10.8)
export const WALK_Z = -6.85;                                                       // the sidewalk strip between the top bay row and the building
export const GUEST_PATH = [[11.4, -7.7], [11.4, -1.7], [12.2, 0.4], [12.2, 6.2], [12.6, 6.9]]; // door -> pick-up curb
// Walking in: along the left column, then along the sidewalk to the door, and through it (the figure is removed once it is inside).
const toDoor = () => [[DOOR.x, WALK_Z], [DOOR.x, DOOR.z + 0.5], [DOOR.x, DOOR.z - 0.45]];
export const arrivalPath = () => [[-11.4, 6.3], [-11.4, WALK_Z], ...toDoor()];     // arriving guest -> lobby door (Classic)
export const dropPath = () => [[-11.4, 3.2], [-11.4, WALK_Z], ...toDoor()];        // dropped-off guest -> lobby door
export const exitPath = () => [[DOOR.x, DOOR.z + 0.6], ...GUEST_PATH];             // lobby door -> pick-up curb
export const HANDOFF = { x: 10.4, z: 5.4 };                                        // pick-up ring (Rush Hour)
export const DROPOFF = { x: -10.4, z: 5.9 };                                       // drop-off ring (Rush Hour)
export const HANDOFF_YAW = Math.PI / 2;
export const PARK_ANGLE = 0.35;
export const HANDOFF_ANGLE = PARK_ANGLE;

export const angleDifference = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/* ---------- Rush Hour ---------- */
export const TOKEN_SPOTS = [[-6, -1.72], [0, -1.72], [6, -1.72], [-3, 5.4], [3, 5.4], [5, 5.4], [0, 3.2], [6, 3.2]];
export const POWERUPS = {
  time: { emoji: '⏱️', color: 0x5ee6a8, pop: '+5s', toast: '⏱️ +5 seconds!' },
  nitro: { emoji: '⚡', color: 0x6cc8ff, pop: 'NITRO', toast: '⚡ NITRO! Hold W and go' },
  x2: { emoji: '💰', color: 0xffc247, pop: '×2 TIPS', toast: '💰 Double tips for 8s!' },
  coin: { emoji: '🪙', color: 0xffd34a, pop: '+$15', toast: '🪙 Lucky coin! +$15' },
  coffee: { emoji: '☕', color: 0xc98a5a, pop: 'COFFEE', toast: '☕ Coffee! Run faster for 8s' },
};

// Boons: pick 1 of 3 at the start of each shift. They last for that shift only.
export const RUSH_PERKS = [
  { key: 'start', icon: '🚀', name: 'Head Start', desc: 'Begin the shift on a ×3 combo.', max: 1 },
  { key: 'time', icon: '⏱️', name: 'Extra Time', desc: '+8 seconds on the shift clock.', max: 1 },
  { key: 'tips', icon: '💰', name: 'Big Tipper', desc: 'All tips +20%.', max: 1 },
  { key: 'combo', icon: '🔥', name: 'Slow Burn', desc: 'The combo meter drains 20% slower.', max: 1 },
  { key: 'ring', icon: '🎯', name: 'Wide Ring', desc: 'Bigger parking and pick-up rings.', max: 1 },
  { key: 'legs', icon: '👟', name: 'Sneakers', desc: 'Run 12% faster on foot.', max: 1 },
  { key: 'guards', icon: '🛡️', name: 'Bumper Guards', desc: 'Crashes cost half the combo meter.', max: 1 },
  { key: 'calm', icon: '🧘', name: 'Calm Guests', desc: 'Guests wait 15% longer.', max: 1 },
  { key: 'magnet', icon: '🧲', name: 'Power Magnet', desc: 'Power-ups appear sooner and stay longer.', max: 1 },
];

/* ---------- shifts (campaign levels) ----------
   Each shift has a fixed clock and three star goals (tips). Fields:
     guests      cars that arrive; once the last is in, every car is called back and the shift ends when the lot is empty
     secs        time limit in seconds (finishing early adds a bonus)            stars   tips needed for 1 / 2 / 3 stars
     diff        1..10 pacing (patience, drain, key wait)
     calls       guests that may wait at the curb at once, from `callsFrom` seconds in
     bays        indexes (0-3 top row, 4-7 bottom row) of bays available in this shift
     park        'nose' (drive in) or 'reverse' (back in: the nose must face out)
     grip        1 = normal tyres, lower = slippery      ringScale / speedScale  < 1 makes parking harder
     vipRate     chance a car is a VIP    quirks  which quirk cars may appear    gap  seconds between arrivals
   `stars` (tip goals) are no longer used for the star rating: stars come from beating the rival (see duelGoals).
   The rival speeds and the duel goals are first estimates: tune them after playtests. */
export const LEVELS = [
  { id: 1, name: 'Welcome Shift', tagline: 'Eight bays, wide rings, no surprises.', secs: 210, guests: 10, stars: [180, 260, 350], diff: 1, calls: 1, callsFrom: 5,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 1.2, speedScale: 1.1, cones: [], cart: null, vipRate: 0, quirks: [], gap: 0.8 },
  { id: 2, name: 'Lunch Rush', tagline: 'All eight bays open in staggered 90-degree rows.', secs: 240, guests: 11, stars: [210, 310, 420], diff: 2, calls: 1, callsFrom: 10,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 1, speedScale: 1, cones: [], cart: null, vipRate: 0, quirks: [], gap: 0.5 },
  { id: 3, name: 'Casino Roundabout', tagline: 'Reverse into eight clear bays around a central fountain.', secs: 240, guests: 11, stars: [210, 310, 420], diff: 3, calls: 1, callsFrom: 10,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'reverse', grip: 1, ringScale: 1.1, speedScale: 1, cones: [], cart: null, vipRate: 0, quirks: [], gap: 0.5 },
  { id: 4, name: 'Cone Alley', tagline: 'Work around the planted median and traffic cones.', secs: 275, guests: 13, stars: [240, 360, 490], diff: 4, calls: 2, callsFrom: 10,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 1, speedScale: 1, cones: [[-7.2, 5.0], [-2.5, 6.6], [2.2, 5.0], [6.9, 6.6]], cart: null, vipRate: 0.1, quirks: ['brakes'], gap: 0.4 },
  { id: 5, name: 'Opera Red Carpet', tagline: 'Flank the red carpet through two angled bay columns.', secs: 275, guests: 13, stars: [240, 360, 490], diff: 5, calls: 2, callsFrom: 8,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 0.45, ringScale: 1.1, speedScale: 1, cones: [], cart: null, vipRate: 0.1, quirks: ['brakes', 'wide'], gap: 0.4 },
  { id: 6, name: 'Terminal Run', tagline: 'Work curb-side bays along both edges of the terminal.', secs: 305, guests: 15, stars: [280, 420, 560], diff: 6, calls: 2, callsFrom: 8,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 1, speedScale: 1, cones: [], cart: null, vipRate: 0.1, quirks: ['wide'], gap: 0.4 },
  { id: 7, name: 'Tight Squeeze', tagline: 'Tiny rings demand careful parking across all eight bays.', secs: 240, guests: 11, stars: [210, 310, 420], diff: 7, calls: 2, callsFrom: 8,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 0.72, speedScale: 0.8, cones: [], cart: null, vipRate: 0.15, quirks: ['brakes', 'wide'], gap: 0.3 },
  { id: 8, name: 'VIP Gala', tagline: 'Half the guests are VIPs: park them fast for double tips.', secs: 305, guests: 15, stars: [280, 420, 560], diff: 8, calls: 2, callsFrom: 8,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 1, ringScale: 1, speedScale: 1, cones: [], cart: null, vipRate: 0.5, quirks: ['leaky', 'horn'], gap: 0.3 },
  { id: 9, name: 'Valet Storm', tagline: '60-degree stalls, slick lanes and a planted island.', secs: 340, guests: 17, stars: [320, 470, 630], diff: 9, calls: 3, callsFrom: 6,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'nose', grip: 0.6, ringScale: 1, speedScale: 1, cones: [[-5, 5.0], [1, 6.6]], cart: null, vipRate: 0.2, quirks: ['brakes', 'wide', 'leaky', 'horn'], gap: 0.3 },
  { id: 10, name: 'Midnight Finale', tagline: 'Reverse park around the rooftop garden beneath the midnight skyline.', secs: 370, guests: 19, stars: [350, 520, 700], diff: 10, calls: 3, callsFrom: 6,
    bays: [0, 1, 2, 3, 4, 5, 6, 7], park: 'reverse', grip: 1, ringScale: 0.9, speedScale: 0.9, cones: [], cart: null, vipRate: 0.35, quirks: ['brakes', 'wide', 'leaky', 'horn'], gap: 0.25 },
];

// Rival duel: you win a shift by parking and returning MORE cars than the AI rival valet (1 star).
// 2 and 3 stars need a lead of about 15% / 30% of all the car moves in the shift.
export function duelGoals(lv) {
  const total = lv.guests * 2 + Math.min(3, Math.floor(lv.bays.length / 2));   // every guest = a park + a return; the starting cars are returned too
  const two = Math.max(2, Math.ceil(total * 0.15));
  return [1, two, Math.max(two + 1, Math.ceil(total * 0.3))];
}
export const duelStars = (lv, margin) => duelGoals(lv).filter((g) => margin >= g).length;

// Short labels for the rules that make a shift different (shown on the level card and the shift intro).
export function levelMods(lv) {
  const m = [];
  const layout = PARKING_TYPES[lv.id] || '90';
  m.push({ icon: layout.includes('60') ? '↗' : '↕', name: layout.includes('60') ? '60° angled bays' : '90° bays' });
  if (layout.includes('island')) m.push({ icon: '🌿', name: 'Garden median' });
  if (lv.park === 'reverse') m.push({ icon: '🔄', name: 'Reverse parking' });
  if (lv.bays.length < 8) m.push({ icon: '🔒', name: `${lv.bays.length} bays open` });
  if (lv.ringScale < 1) m.push({ icon: '🎯', name: 'Tiny rings' });
  if (lv.grip < 1) m.push({ icon: '🧊', name: 'Slippery' });
  if (lv.cones.length) m.push({ icon: '🚧', name: 'Cones' });
  if (lv.cart) m.push({ icon: '🧳', name: 'Luggage cart' });
  if (lv.vipRate >= 0.3) m.push({ icon: '⭐', name: 'VIP gala' });
  if (lv.calls >= 3) m.push({ icon: '🔔', name: `${lv.calls} guests at once` });
  return m;
}
/* ---------- cars ---------- */
export const MODEL_FILES = ['sedan.glb', 'suv-luxury.glb', 'sedan-sports.glb', 'hatchback-sports.glb', 'taxi.glb'];

// The first eight paints are always in the lot; the rest unlock with player level.
export const PAINTS = [
  { color: 0xd5b66e, name: 'Gold' }, { color: 0x5d8792, name: 'Teal' }, { color: 0x9d4f47, name: 'Red' },
  { color: 0x65745c, name: 'Green' }, { color: 0x858a8d, name: 'Silver' }, { color: 0x312f34, name: 'Charcoal' },
  { color: 0x8e7485, name: 'Plum' }, { color: 0xc7bfa6, name: 'Cream' },
  { color: 0xd98a2b, name: 'Amber', level: 3 }, { color: 0x2f4a86, name: 'Navy', level: 5 },
  { color: 0xc9708f, name: 'Rose', level: 7 }, { color: 0x8fb83a, name: 'Lime', level: 9 },
];
export const CAR_COLORS = PAINTS.map((p) => p.color);
export const COLOR_NAMES = PAINTS.map((p) => p.name);
export const PAINT_LEVEL = PAINTS.map((p) => p.level || 1);

// Quirks are introduced one per shift, in this order.
export const QUIRK_ORDER = ['brakes', 'wide', 'leaky', 'horn'];
export const QUIRKS = {
  brakes: { icon: '🛞', name: 'Bad Brakes', tip: 'It barely slows down. Lift off early.' },
  wide: { icon: '⭕', name: 'Wide Turn', tip: 'Huge turning circle. Swing wide.' },
  leaky: { icon: '💧', name: 'Leaky Roof', tip: 'This guest will not wait long.' },
  horn: { icon: '📯', name: 'Loud Horn', tip: 'It honks and jolts your steering.' },
};

// Perks offered between Classic shifts (pick 1 of 3). Levels stack up to `max`.
export const PERKS = [
  { key: 'memory', icon: '🧠', name: 'Long Memory', desc: 'Tags stay readable 2s longer.', max: 3 },
  { key: 'ring', icon: '🎯', name: 'Wide Ring', desc: 'Bigger parking ring, easier parking.', max: 3 },
  { key: 'guess', icon: '🗝️', name: 'Spare Key', desc: '+1 free wrong guess every shift.', max: 2 },
  { key: 'tips', icon: '💰', name: 'Big Tipper', desc: 'All tips +20%.', max: 3 },
  { key: 'patience', icon: '🧘', name: 'Calm Guests', desc: 'Pickups wait 3s longer.', max: 3 },
  { key: 'time', icon: '⏱️', name: 'Extra Hour', desc: '+10s on the shift clock.', max: 3 },
  { key: 'peek', icon: '🔑', name: 'Master Key', desc: 'Peeking at tags is free.', max: 1 },
];

/* ---------- cosmetics (unlocked by player level, equipped in the Locker) ---------- */
export const OUTFITS = [
  { id: 'burgundy', name: 'Nocturne Burgundy', level: 1, coat: 0x7a1f2e, trim: 0xd6b674 },
  { id: 'midnight', name: 'Midnight Blue', level: 2, coat: 0x1f3a7a, trim: 0xc0d4ff },
  { id: 'emerald', name: 'Emerald', level: 4, coat: 0x1f6a4a, trim: 0xe8d08a },
  { id: 'violet', name: 'Royal Violet', level: 6, coat: 0x55307a, trim: 0xf0c8ff },
  { id: 'tux', name: 'Gold Tux', level: 9, coat: 0x191919, trim: 0xffd34a },
];
export const HATS = [
  { id: 'cap', name: 'Valet Cap', level: 1 },
  { id: 'tophat', name: 'Top Hat', level: 3 },
  { id: 'beret', name: 'Beret', level: 5 },
  { id: 'crown', name: 'Gold Crown', level: 8 },
];
export const HORNS = [
  { id: 'classic', name: 'Classic Horn', level: 1 },
  { id: 'beep', name: 'Beep Beep', level: 4 },
  { id: 'trumpet', name: 'Trumpet', level: 6 },
];
// Special guests: a car with a little extra story (and extra tips). Rush shifts from shift 2 on.
export const SPECIALS = {
  celeb: { icon: '🎬', name: 'Celebrity', tip: 'Paparazzi! Tips ×1.8.', line: 'No photos, please!' },
  vintage: { icon: '🚙', name: 'Vintage car', tip: 'Handle with care: crashes cost $10.', line: 'Mind the paint!' },
  tourist: { icon: '🗺️', name: 'Tourist', tip: '+$12 for helping with directions.', line: 'Which way to the pool?' },
  dog: { icon: '🐕', name: 'Dog guest', tip: '+$8 bonus. The dog comes along.', line: 'Woof woof!' },
};
export const SPECIAL_KEYS = Object.keys(SPECIALS);
export const BAY_THEMES = [
  { id: 'classic', name: 'Classic White', level: 1, color: 0xe8efe4, emissive: 0x6f7a6a, glow: 0.5 },
  { id: 'brass', name: 'Brass', level: 3, color: 0xe0b85a, emissive: 0x6a4a14, glow: 0.45 },
  { id: 'cyan', name: 'Neon Cyan', level: 5, color: 0x5ee6e0, emissive: 0x1a8a86, glow: 0.6 },
  { id: 'pink', name: 'Hot Pink', level: 7, color: 0xff6fb0, emissive: 0x8a2457, glow: 0.6 },
];
export const CONFETTI = [
  { id: 'party', name: 'Party Mix', level: 1, colors: ['#ffc247', '#6cc8ff', '#5ee6a8', '#ff6b5e', '#fff7e6'] },
  { id: 'gold', name: 'Gold Rush', level: 4, colors: ['#ffd34a', '#ffc247', '#fff0b0', '#e0a020', '#fff7e6'] },
  { id: 'ice', name: 'Ice', level: 6, colors: ['#6cc8ff', '#b8e8ff', '#ffffff', '#8fb8ff', '#5ee6e0'] },
  { id: 'sakura', name: 'Sakura', level: 8, colors: ['#ffb3d1', '#ff8fb8', '#ffe0ec', '#ffffff', '#f26aa0'] },
];
