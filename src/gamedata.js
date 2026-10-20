import { DEFAULT_SKILLS } from './skills.js';
// Dialogue Dungeon: tunable game data. Change numbers here, nowhere else.
export const TURN_MS = 15000;
export const need = (lv) => (lv <= 10 ? 10 : 10 + 5 * (lv - 10)); // XP to leave level lv

// slot: weapon | armor | acc | use.  atk = extra base damage, def = damage blocked per hit (min 1 taken),
// gold / xp = bonus fraction, heal = HP (potions) or HP after each win (charm). tier = first floor it can drop on.
export const ITEMS = {
  stick: { n: 'Sharpened Stick', e: '🪵', slot: 'weapon', atk: 1, price: 10, st: 1 },
  dagger: { n: 'Rusty Dagger', e: '🗡️', slot: 'weapon', atk: 2, price: 30, st: 1 },
  club: { n: 'Wooden Club', e: '🏏', slot: 'weapon', atk: 3, price: 80, st: 2 },
  handaxe: { n: 'Hand Axe', e: '🔨', slot: 'weapon', atk: 4, price: 150, st: 2 },
  sword: { n: 'Iron Sword', e: '⚔️', slot: 'weapon', atk: 5, price: 260, st: 2 },
  blade: { n: 'Steel Blade', e: '🔪', slot: 'weapon', atk: 7, price: 450, st: 3 },
  tunic: { n: 'Padded Tunic', e: '👕', slot: 'armor', def: 1, price: 15, st: 1 },
  vest: { n: 'Leather Vest', e: '🦺', slot: 'armor', def: 2, price: 45, st: 1 },
  studded: { n: 'Studded Leather', e: '🥼', slot: 'armor', def: 3, price: 120, st: 2 },
  mail: { n: 'Chain Mail', e: '⛓️', slot: 'armor', def: 4, price: 240, st: 2 },
  plate: { n: 'Plate Armour', e: '🛡️', slot: 'armor', def: 6, price: 500, st: 3 },
  locket: { n: 'Silver Locket', e: '📿', slot: 'acc', gold: 0.1, price: 40, st: 1 },
  coin: { n: 'Lucky Coin', e: '🪙', slot: 'acc', gold: 0.25, price: 80, st: 2 },
  ring: { n: 'Scholar’s Ring', e: '💍', slot: 'acc', xp: 0.2, price: 100, st: 2 },
  charm: { n: 'Healer’s Charm', e: '🧿', slot: 'acc', heal: 1, price: 90, st: 2 },
  amulet: { n: 'Sage’s Amulet', e: '📜', slot: 'acc', xp: 0.4, price: 600, st: 3 },
  signet: { n: 'Gold Signet', e: '💰', slot: 'acc', gold: 0.5, price: 700, st: 3 },
  band: { n: 'Regen Band', e: '🩹', slot: 'acc', heal: 3, price: 800, st: 3 },
  crown: { n: 'Crown of Fortune', e: '👑', slot: 'acc', gold: 1, price: 4000, st: 4 },
  scrown: { n: 'Scholar’s Crown', e: '🎓', slot: 'acc', xp: 0.8, price: 4000, st: 4 },
  pendant: { n: 'Phoenix Pendant', e: '🔥', slot: 'acc', heal: 8, price: 3500, st: 4 },
  minor: { n: 'Minor Potion', e: '💧', slot: 'use', heal: 2, price: 8, st: 1 },
  potion: { n: 'Health Potion', e: '🧪', slot: 'use', heal: 5, price: 15, st: 1 },
  bigpotion: { n: 'Big Potion', e: '⚗️', slot: 'use', heal: 12, price: 40, st: 2 },
  greater: { n: 'Greater Potion', e: '🍶', slot: 'use', heal: 20, price: 70, st: 3 },
  elixir: { n: 'Elixir', e: '🍷', slot: 'use', heal: 40, price: 150, st: 4 },
  phoenix: { n: 'Phoenix Draught', e: '🌟', slot: 'use', heal: 120, price: 450, st: 4 },
};
// Class-line gear: [id, name, emoji, attack or defence, price, shop level]. Only the Fighter / Archer / Acolyte lines can use their own.
const ladder = (fam, slot, rows) => rows.forEach(([id, n, e, v, price, st]) => (ITEMS[id] = { n, e, slot, [slot === 'weapon' ? 'atk' : 'def']: v, price, st, fam }));
ladder('fighter', 'weapon', [['axe', 'Battle Axe', '🪓', 8, 600, 3], ['greataxe', 'Great Axe', '⚒️', 10, 1000, 3], ['waraxe', 'War Axe', '🪓', 13, 1800, 4], ['ruinaxe', 'Ruinbringer Axe', '⚔️', 17, 4500, 4], ['titanaxe', 'Titan’s Cleaver', '🔱', 22, 10000, 4]]);
ladder('fighter', 'armor', [['brigand', 'Brigandine', '🥋', 7, 550, 3], ['banded', 'Banded Mail', '⛓️', 9, 900, 3], ['fullplate', 'Knight’s Plate', '🏰', 12, 1700, 4], ['dragonplate', 'Dragonscale Plate', '🐉', 18, 4200, 4], ['titanplate', 'Titan Plate', '🛡️', 25, 9500, 4]]);
ladder('archer', 'weapon', [['bow', 'Hunter’s Bow', '🏹', 8, 600, 3], ['recurve', 'Recurve Bow', '🎯', 10, 1000, 3], ['longbow', 'Longbow', '🏹', 13, 1800, 4], ['windbow', 'Windpiercer', '🌬️', 17, 4500, 4], ['starbow', 'Starfall Bow', '🌠', 22, 10000, 4]]);
ladder('archer', 'armor', [['leathers', 'Hunter’s Leathers', '🧥', 6, 450, 3], ['jerkin', 'Scout Jerkin', '🦺', 8, 800, 3], ['cloak', 'Shadow Cloak', '🌑', 11, 1500, 4], ['mantle', 'Phantom Mantle', '👻', 16, 3800, 4], ['nightcloak', 'Nightwind Cloak', '🌌', 22, 9000, 4]]);
ladder('acolyte', 'weapon', [['staff', 'Oak Staff', '🪄', 8, 600, 3], ['crystal', 'Crystal Staff', '💎', 10, 1000, 3], ['arcstaff', 'Arcane Staff', '🔱', 13, 1800, 4], ['elderstaff', 'Elder Staff', '🌳', 17, 4500, 4], ['agestaff', 'Staff of Ages', '⏳', 22, 10000, 4]]);
ladder('acolyte', 'armor', [['robe', 'Scholar’s Robe', '👘', 6, 450, 3], ['warded', 'Warded Robe', '🧿', 8, 800, 3], ['archrobe', 'Archmage Robe', '🥻', 11, 1500, 4], ['runed', 'Runed Vestments', '📜', 16, 3800, 4], ['agerobe', 'Robe of Ages', '✨', 22, 9000, 4]]);
// ---- Gear styles. One power budget, spent differently. R is the balanced weapon's attack at that tier (axe 8 / war axe 13 / ruinbringer 17); `pw` keeps the
// answer strike on that balanced value, so a fast or slow weapon never changes what a correct answer is worth. Defence ladders follow the class armour (7 / 12 / 18).
const TIER = [{ st: 3, wp: 600, ap: 550, wr: 8, ar: 7 }, { st: 4, wp: 1800, ap: 1700, wr: 13, ar: 12 }, { st: 4, wp: 4500, ap: 4200, wr: 17, ar: 18 }];
const wstyle = (fam, ids, names, emoji, mod) => ids.forEach((id, i) => { const t = TIER[i]; ITEMS[id] = { n: names[i], e: emoji[i], slot: 'weapon', ...mod(t.wr, i), pw: t.wr, price: t.wp, st: t.st, fam }; });
const astyle = (fam, ids, names, emoji, mod) => ids.forEach((id, i) => { const t = TIER[i]; ITEMS[id] = { n: names[i], e: emoji[i], slot: 'armor', ...mod(t.ar, i), price: t.ap, st: t.st, fam }; });
// Both are tuned with scripts/balance.mjs to land within a few percent of the balanced weapon for a job with 4 to 6 base damage.
const swift = (R, i) => ({ atk: [4, 7, 9][i], spd: 0.3, dbl: 0.12 }); // about half the damage, 30% faster, 12% critical hits (job speed perks stack on top, so the top tier is trimmed)
const heavy = (R) => ({ atk: 2 * R + 6, spd: -0.5 }); // double the maximum hit (job damage included) at half speed, plus a little for the slow first swing
wstyle('fighter', ['maul', 'warhammer', 'colossus'], ['Iron Maul', 'Warhammer', 'Colossus Hammer'], ['🔨', '⚒️', '🏔️'], heavy);
wstyle('swordsman', ['rapier', 'sabre', 'foil'], ['Rapier', 'Duelist’s Sabre', 'Phantom Foil'], ['🤺', '🗡️', '👻'], (R, i) => ({ atk: R - 1, par: [0.08, 0.1, 0.12][i] }));
wstyle('brawler', ['knuckles', 'gauntlets', 'thunderfists'], ['Spiked Knuckles', 'Steel Gauntlets', 'Thunderfists'], ['🥊', '🧤', '⚡'], swift);
wstyle('horsearcher', ['shortbow', 'compbow', 'galebow'], ['Short Bow', 'Composite Bow', 'Gale Bow'], ['🏹', '🏹', '🌬️'], swift);
wstyle('longbowman', ['xbow', 'siegebow', 'ballista'], ['Heavy Crossbow', 'Siege Bow', 'Ballista Bow'], ['🎯', '🏹', '🏰'], heavy);
wstyle('mage', ['wand', 'stormwand', 'tempestwand'], ['Spark Wand', 'Storm Wand', 'Tempest Wand'], ['✨', '🌩️', '🌪️'], swift);
wstyle('cleric', ['mace', 'holymace', 'judgemace'], ['Flanged Mace', 'Holy Mace', 'Judgement Mace'], ['🔨', '✝️', '⚖️'], (R, i) => ({ atk: R - 1, stn: [0.15, 0.25, 0.25][i] }));
wstyle('acolyte', ['siphon', 'wraithstaff', 'vampstaff'], ['Siphon Staff', 'Wraith Staff', 'Vampiric Staff'], ['🪄', '🦇', '🩸'], (R, i) => ({ atk: R - 1, lch: [0.08, 0.1, 0.1][i] }));
astyle('fighter', ['bulwark', 'rampart', 'fortress'], ['Bulwark Plate', 'Rampart Plate', 'Fortress Plate'], ['🛡️', '🏰', '🗿'], (R) => ({ def: Math.round(R * 1.3), spd: -0.15 }));
astyle('swordsman', ['thornmail', 'spikedcuirass', 'hedgehog'], ['Thornmail', 'Spiked Cuirass', 'Hedgehog Plate'], ['🌵', '🦔', '🦔'], (R, i) => ({ def: Math.round(R * [0.85, 0.95, 0.95][i]), ref: [0.1, 0.15, 0.2][i] }));
astyle('archer', ['skirmish', 'windrunner', 'shadowstep'], ['Skirmisher Leathers', 'Windrunner Jerkin', 'Shadowstep Cloak'], ['🥾', '🧥', '🌑'], (R, i) => ({ def: Math.round(R * 0.75), par: [0.06, 0.09, 0.12][i], spd: 0.1 }));
astyle('acolyte', ['mirrorrobe', 'silvered', 'reflection'], ['Mirror Robe', 'Silvered Vestments', 'Robe of Reflection'], ['🪞', '🔮', '💠'], (R, i) => ({ def: Math.round(R * 0.7), ref: [0.08, 0.12, 0.16][i] }));
Object.assign(ITEMS, {
  eagle: { n: 'Eagle Ring', e: '🦅', slot: 'acc', dbl: 0.08, price: 700, st: 3 },
  badge: { n: 'Duelist Badge', e: '🎖️', slot: 'acc', par: 0.08, price: 700, st: 3 },
  thunder: { n: 'Thunder Charm', e: '🌩️', slot: 'acc', stn: 0.12, price: 800, st: 3 },
  // boss-only: no shop level, so they can only be found
  mirror: { n: 'Mirror Pendant', e: '🪞', slot: 'acc', ref: 0.12, price: 3000 },
  fang: { n: 'Vampire Fang', e: '🦷', slot: 'acc', lch: 0.08, price: 3000 },
  die: { n: 'Lucky Die', e: '🎲', slot: 'acc', crit: 0.1, price: 3000 },
});
Object.assign(ITEMS.dagger, { spd: 0.1 });
ITEMS.greataxe.spd = -0.1; ITEMS.ruinaxe.spd = -0.1; ITEMS.titanaxe.spd = -0.15;
ITEMS.swiftring = { n: 'Swift Ring', e: '💨', slot: 'acc', spd: 0.15, price: 350, st: 2 };
ITEMS.zephyr = { n: 'Zephyr Band', e: '🌪️', slot: 'acc', spd: 0.3, price: 3000, st: 4 };
for (const it of Object.values(ITEMS)) {
  if (it.slot === 'use') continue;
  if (it.spd == null) it.spd = 0; // attack speed bonus (negative = slower); armour can carry it too
  for (const k of ['dbl', 'crit', 'par', 'ref', 'stn', 'lch']) if (it[k] == null) it[k] = 0; // any piece of gear can carry any combat stat (the teacher can edit them)
}
// Classes that fight from range: they strike first, a few seconds into the fight.
export const RANGED = new Set(['scout', 'marksman', 'initiate', 'adept', 'archer', 'horsearcher', 'longbowman', 'ranger', 'bowknight', 'sniper', 'assassin', 'acolyte', 'mage', 'battlemage', 'elementalmage']);
// Defaults of every item. The game balance tab stores only the values a teacher changed (cfg.items) and applyItems lays them over these.
export const BASE = JSON.parse(JSON.stringify(ITEMS));
export function applyItems(cfg) {
  for (const id of Object.keys(BASE)) ITEMS[id] = { ...BASE[id], ...((cfg.items && cfg.items[id]) || {}) };
}
// Monster art: public/m/<img>.png (16-bit pixel sprites). Regular monsters are drawn from the floor bands below; dragon is the mid-boss, knight the boss.
export const MOBS = {
  slime: { n: 'Green Slime', img: 'slime', e: '👾' },
  bat: { n: 'Cave Bat', img: 'bat', e: '👾' },
  skeleton: { n: 'Skeleton Guard', img: 'skeleton', e: '👾' },
  spider: { n: 'Giant Spider', img: 'spider', e: '👾' },
  goblin: { n: 'Goblin Raider', img: 'goblin', e: '👾' },
  goblinscout: { n: 'Goblin Scout', img: 'goblinscout', e: '👾' },
  eye: { n: 'Floating Eye', img: 'eye', e: '👾' },
  golem: { n: 'Stone Golem', img: 'golem', e: '👾' },
  hydra: { n: 'Baby Hydra', img: 'hydra', e: '👾' },
  mimic: { n: 'Mimic Chest', img: 'mimic', e: '👾' },
  ghost: { n: 'Ghost', img: 'ghost', e: '👾' },
  wraith: { n: 'Hooded Wraith', img: 'wraith', e: '👾' },
  imp: { n: 'Fire Imp', img: 'imp', e: '👾' },
  snail: { n: 'Giant Snail', img: 'snail', e: '👾' },
  darkelf: { n: 'Dark Elf Archer', img: 'darkelf', e: '👾' },
  minotaur: { n: 'Minotaur', img: 'minotaur', e: '👾' },
  cerberus: { n: 'Three-headed Hound', img: 'cerberus', e: '👾' },
  orc: { n: 'Orc Brute', img: 'orc', e: '👾' },
  lizard: { n: 'Lizardman Spearman', img: 'lizard', e: '👾' },
  shade: { n: 'Shade', img: 'shade', e: '👾' },
  ooze: { n: 'Flesh Ooze', img: 'ooze', e: '👾' },
  hippo: { n: 'Pink Hippo', img: 'hippo', e: '👾' },
  troll: { n: 'Rock Troll', img: 'troll', e: '👾' },
  manticore: { n: 'Manticore', img: 'manticore', e: '👾' },
  darkmage: { n: 'Dark Mage', img: 'darkmage', e: '👾' },
  wisp: { n: 'Blue Wisp', img: 'wisp', e: '👾' },
  centipede: { n: 'Giant Centipede', img: 'centipede', e: '👾' },
  mushroom: { n: 'Mushroom Folk', img: 'mushroom', e: '👾' },
  skull: { n: 'Floating Skull', img: 'skull', e: '👾' },
  squid: { n: 'Cave Squid', img: 'squid', e: '👾' },
  armor: { n: 'Animated Armour', img: 'armor', e: '👾' },
  mole: { n: 'Cave Mole', img: 'mole', e: '👾' },
  dragon: { n: 'Green Dragon (Mid-boss)', img: 'dragon', e: '🐉', kind: 'mid' },
  knight: { n: 'Dread Knight (Mid-boss)', img: 'knight', e: '🧛', kind: 'mid' },
  monarch: { n: 'Mimic Monarch (Mid-boss)', img: 'monarch', e: '📦', kind: 'mid' },
  cyclops: { n: 'Cyclops Brawler (Mid-boss)', img: 'cyclops', e: '👁️', kind: 'mid' },
  shadowbeast: { n: 'Shadowbeast Stalker (Mid-boss)', img: 'shadowbeast', e: '🐈‍⬛', kind: 'mid' },
  warlord: { n: 'Draconic Warlord (Mid-boss)', img: 'warlord', e: '🐲', kind: 'mid' },
  matriarch: { n: 'Hydra Matriarch (Mid-boss)', img: 'matriarch', e: '🐍', kind: 'mid' },
  wyvern: { n: 'Skeletal Wyvern Trainer (Mid-boss)', img: 'wyvern', e: '💀', kind: 'mid' },
  lichacolyte: { n: 'Lich Acolyte (Mid-boss)', img: 'lichacolyte', e: '🧙', kind: 'mid' },
  paladin: { n: 'Corrupt Paladin (Mid-boss)', img: 'paladin', e: '🛡️', kind: 'mid' },
  emperor: { n: 'Mimic Emperor (Boss)', img: 'emperor', e: '📦', kind: 'boss' },
  hydraqueen: { n: 'Hydra Queen (Boss)', img: 'hydraqueen', e: '🐍', kind: 'boss' },
  overlord: { n: 'Dread Overlord (Boss)', img: 'overlord', e: '😈', kind: 'boss' },
  voidboss: { n: 'Void Elemental (Boss)', img: 'voidboss', e: '🌀', kind: 'boss' },
  lichking: { n: 'Lich King (Boss)', img: 'lichking', e: '👑', kind: 'boss' },
};

// Jobs: d = base damage, p = parent job. (Acolyte is the "apprentice mage" step.) Numbers are first-pass; tune freely.
export const JOBS = {
  villager: { n: 'Villager', e: '🧑‍🌾', d: 1 },
  novice: { n: 'Novice', e: '🌱', d: 1, p: 'villager' },
  adventurer: { n: 'Adventurer', e: '🧭', d: 2, p: 'novice' },
  squire: { n: 'Squire', e: '🪖', d: 3, p: 'adventurer' },
  scout: { n: 'Scout', e: '👣', d: 2, p: 'adventurer' },
  initiate: { n: 'Initiate', e: '🕯️', d: 2, p: 'adventurer' },
  fighter: { n: 'Fighter', e: '🥊', d: 4, p: 'squire' },
  archer: { n: 'Archer', e: '🏹', d: 3, p: 'scout' },
  acolyte: { n: 'Acolyte', e: '📖', d: 2, p: 'initiate' },
  soldier: { n: 'Soldier', e: '💂', d: 5, p: 'fighter' },
  marksman: { n: 'Marksman', e: '🔰', d: 4, p: 'archer' },
  adept: { n: 'Adept', e: '📚', d: 3, p: 'acolyte' },
  swordsman: { n: 'Swordsman', e: '⚔️', d: 6, p: 'soldier' },
  brawler: { n: 'Brawler', e: '👊', d: 6, p: 'soldier' },
  horsearcher: { n: 'Horse Archer', e: '🏇', d: 5, p: 'marksman' },
  longbowman: { n: 'Longbowman', e: '🎯', d: 5, p: 'marksman' },
  mage: { n: 'Mage', e: '🔮', d: 4, p: 'adept' },
  cleric: { n: 'Cleric', e: '✨', d: 3, p: 'adept' },
  knight: { n: 'Knight', e: '🛡️', d: 9, p: 'swordsman' },
  swordmaster: { n: 'Sword Master', e: '🗡️', d: 10, p: 'swordsman' },
  berserker: { n: 'Berserker', e: '😡', d: 11, p: 'brawler' },
  monk: { n: 'Monk', e: '🧘', d: 9, p: 'brawler' },
  ranger: { n: 'Ranger', e: '🌲', d: 8, p: 'horsearcher' },
  bowknight: { n: 'Bow Knight', e: '🐎', d: 9, p: 'horsearcher' },
  sniper: { n: 'Sniper', e: '🔭', d: 9, p: 'longbowman' },
  assassin: { n: 'Assassin', e: '🥷', d: 10, p: 'longbowman' },
  battlemage: { n: 'Battle Mage', e: '⚡', d: 8, p: 'mage' },
  elementalmage: { n: 'Elemental Mage', e: '🔥', d: 9, p: 'mage' },
  priest: { n: 'Priest', e: '🙏', d: 6, p: 'cleric' },
  paladin: { n: 'Paladin', e: '⚜️', d: 8, p: 'cleric' },
};
// The twelve top-tier jobs: they keep the perk of the job they came from and open the top shop level.
export const TOPS = new Set(['knight', 'swordmaster', 'berserker', 'monk', 'ranger', 'bowknight', 'sniper', 'assassin', 'battlemage', 'elementalmage', 'priest', 'paladin']);
for (const id of TOPS) JOBS[id].top = true;
// Job points: levels 5, 10, 15, 20, 30, 40, 60, then every 20 levels. Each point unlocks one job whose parent you already have.
// (A full path now takes seven unlocks: Novice, Adventurer, Squire-type, line, Soldier-type, mid-tier, top-tier.)
export const POINT_LEVELS = [5, 10, 15, 20, 30, 40, 60];
export const points = (lv) => POINT_LEVELS.filter((x) => lv >= x).length + (lv >= 80 ? Math.floor((lv - 60) / 20) : 0);
// Unspent job points: one point per job owned beyond Villager. Never negative: a pupil whose older save was completed with gate jobs they had not paid for
// (only possible if they had spread across several lines) simply waits for their next point.
export const freePoints = (lv, jobsOwned) => Math.max(0, points(lv) - (jobsOwned - 1));
export const nextPoint = (lv) => POINT_LEVELS.find((x) => x > lv) ?? 60 + 20 * (Math.floor((lv - 60) / 20) + 1);
// Every job a pupil owns must come with the jobs before it. Older saves (before Novice, Squire and the other gate jobs) are completed on load.
export const closeJobs = (jobs) => {
  const out = [], add = (j) => { if (!JOBS[j] || out.includes(j)) return; if (JOBS[j].p) add(JOBS[j].p); out.push(j); };
  ['villager', ...(jobs || [])].forEach(add);
  return out;
};

export const TOP_FLOOR = 100;
export const MAX_DROP = 0.1; // no drop rate may exceed 10%
// Teacher-adjustable balance (game balance tab). hp: monster HP = base + the HP gain of each level from 2 up, by tier.
// def: gold = goldMin..goldMax x monster level, xp = xp x level, dmg = monster damage per hit = level x dmg. mobs[id] can override gold/xp and sets drops {item: rate}.
export const DEFAULT_CFG = {
  hp: { base: 5, tiers: [{ upTo: 20, per: 1 }, { upTo: 50, per: 2 }, { upTo: 100, per: 3 }] },
  def: { goldMin: 1, goldMax: 3, xp: 2, dmg: 0.5 },
  // Player HP (v1.6): a pupil starts with `base` HP and every level from 2 up adds HP by tier. A tier lists the possible gains as [hp, chance] pairs;
  // chances are relative weights (25 and 75 = 25% and 75%). The roll for a given pupil and level is fixed (see hpGain), so max HP is stable.
  php: { base: 10, tiers: [
    { upTo: 10, gains: [[1, 100]] },
    { upTo: 30, gains: [[2, 100]] },
    { upTo: 50, gains: [[2, 25], [3, 75]] },
    { upTo: 70, gains: [[2, 25], [3, 50], [4, 25]] },
    { upTo: 100, gains: [[3, 15], [4, 25], [5, 35], [6, 25]] },
  ] },
  // Dodge (v1.6): chance (0.01 = 1%) that a monster's attack misses and deals 0 damage. First tier with level <= upTo; the last tier covers deeper levels.
  // A job's own `dod` perk (Scout, Horse Archer, Ranger, Bow Knight, Assassin) is added on top; the total is capped in combat.js.
  // Monster dodge (v1.6): chance a pupil's regular attack misses and deals 0 (correct-answer strikes never miss). By monster kind.
  mdodge: { mob: 0.05, mid: 0.1, boss: 0.1 },
  // Sure hit (v1.6): jobs whose regular attacks ignore a monster's dodge, and monsters whose attacks ignore a pupil's dodge. { id: true }; teachers switch them on and off.
  sure: { jobs: { sniper: true }, mobs: {} },
  dodge: { tiers: [{ upTo: 10, v: 0.01 }, { upTo: 30, v: 0.02 }, { upTo: 50, v: 0.03 }, { upTo: 70, v: 0.04 }, { upTo: 100, v: 0.05 }] },
  // monsters per floor: first range with floor <= upTo; rolled once per pupil per floor
  floors: [{ upTo: 10, min: 5, max: 5 }, { upTo: 20, min: 5, max: 7 }, { upTo: 30, min: 6, max: 8 }, { upTo: 40, min: 6, max: 9 }, { upTo: 50, min: 7, max: 10 }, { upTo: 60, min: 7, max: 12 }, { upTo: 70, min: 8, max: 12 }, { upTo: 80, min: 9, max: 13 }, { upTo: 90, min: 10, max: 14 }, { upTo: 100, min: 10, max: 15 }],
  // bosses: HP and damage multipliers on a regular monster of the same level; the boss hits rageDmg x once below 50% HP
  boss: { midHp: 3, midDmg: 1.5, bossHp: 5, bossDmg: 1.5, rageDmg: 2, lo: 0.5, hi: 1.25 }, // lo/hi: each mid-boss or boss hit is a random lo-hi share of its maximum damage
  // job perks (all adjustable): xp/gold/hp/potion/boss/crit/rage are fractions, dr/heal/skip/mult/first are plain numbers.
  // Stage 3 jobs use only their own entry; top-tier jobs add their parent's entry on top of their own.
  // gold price to upgrade the village shop to level 2, 3 and 4 (a pupil also needs the matching job)
  shopCost: [100, 400, 2500],
  // combat timing: seconds between normal attacks; the monster's first attack comes `offset` s earlier; ranged classes strike first after `ranged` s;
  // cap = largest attack-speed bonus (1 = +100%); monster = the monsters' own attack-speed bonus
  speed: { turn: 15, offset: 1, ranged: 5, cap: 1, monster: 0 },
  // Monsters respawn: when on, fleeing to the village, returning to it between fights, or being defeated wipes the kill count of any floor
  // that is not cleared yet, so the pupil must fight all of its monsters again. Off (default): kills on a floor are kept.
  respawn: false,
  // The Hush story (src/story.js): narrative scenes at Level 10, 20 ... 100 and on boss floors. A teacher can switch it off.
  story: true,
  // XP mode: 'level' (default) = fixed XP by monster level; 'damage' = that, plus 50% of the damage dealt to the monster by answer strikes
  // (basic attacks don't count; damage is what the strike actually took off, so overkill is not counted).
  xpMode: 'level',
  // Dungeon Dive (co-op party mode, off until a teacher turns it on). hpPer / poolPer: each extra party member adds this many monsters' worth
  // of HP / of gold+XP to the pool (pool is then split equally); balanced: bonus gold+XP for a melee+ranged+magic+healer party;
  // gap: seconds between monsters; revive: fraction of max HP a downed member comes back with when the next monster appears.
  // hpScale: off = monster HP ignores party size (hpPer unused). bosses: on = every midEvery-th monster is a mid-boss and every bossEvery-th a boss (0 = that kind off;
  // a boss wins a clash). dropMult: multiplies every drop chance in a dive (each item's rate is capped at MAX_DROP first).
  dive: { on: false, hpPer: 1, poolPer: 1, balanced: 0.25, gap: 6, revive: 0.3, hpScale: true, bosses: false, midEvery: 20, bossEvery: 40, dropMult: 1 },
  // Answer strike: a correct answer deals (strike + the job's bonus-strike perk) x the pupil's attack. strike = N, default 3.
  strike: 3,
  // Correct answers needed in a fight before the monster can die (0 = basic attacks alone may finish it). Until then it is left on 1 HP.
  must: { mob: 1, mid: 3, boss: 5 },
  // Gentle start: while a pupil's level is below `levels` (0 = off) they earn gold x `gold` and XP x `xp`, monsters hit x `dmg` as hard,
  // and mid-bosses / bosses have x `bossHp` of their usual HP. Aim: enough gold for starter gear and the Adventurer job (level 10).
  start: { levels: 10, gold: 2.5, xp: 1.25, dmg: 0.6, bossHp: 0.7 },
  // Question skills (src/skills.js): families of questions served only on a floor range. on = switched on, share = % of the questions on a floor
  // inside [min, max] that come from the skill (overlapping skills share the floor; together they never take more than 70%).
  skills: JSON.parse(JSON.stringify(DEFAULT_SKILLS)),
  // Adventurers' Guild Training Grounds (the Practice room): a training monster is as tall as the pupil (their level, never above levelCap)
  // and pays xpMult times what a dungeon monster of that level pays,
  // and never any gold or drops. The first round on each of a pupil's `weakest` weakest skills each day pays bonusMult times as much
  // (for as many monsters as the round has). dailyMonsters caps the training monsters that pay XP per day; tz = hours ahead of UTC for "a day".
  training: { xpMult: 1.5, bonusMult: 2, weakest: 3, dailyMonsters: 30, tz: 8, levelCap: 20 },
  items: {}, // teacher overrides of item price / shop level / attack / defence / gold / xp / heal
  perks: {
    villager: { xp: 0.2 }, novice: { hp: 0.05 }, squire: { hp: 0.05 }, scout: { spd: 0.05, dod: 0.05 }, initiate: { potion: 0.1 },
    soldier: { dr: 1, hp: 0.05 }, marksman: { spd: 0.1, dbl: 0.05 }, adept: { heal: 1, potion: 0.1 },
    fighter: { dr: 1 }, swordsman: { mult: 0.5 }, knight: { dr: 2, hp: 0.1, par: 0.1 }, swordmaster: { mult: 0.5 },
    brawler: { hp: 0.1, spd: 0.15, stn: 0.1 }, berserker: { rage: 0.5, spd: 0.1, lch: 0.1 }, monk: { heal: 2, spd: 0.1, par: 0.1 },
    archer: { skip: 1, spd: 0.1 }, horsearcher: { gold: 0.15, spd: 0.1, dod: 0.05 }, ranger: { gold: 0.1, xp: 0.1, spd: 0.1, dod: 0.05 }, bowknight: { boss: 0.25, spd: 0.1, dod: 0.05 },
    longbowman: { crit: 0.15 }, sniper: { crit: 0.1 }, assassin: { first: 2, dbl: 0.25, spd: 0.15, dod: 0.15 },
    acolyte: { potion: 0.25 }, mage: { mult: 0.5 }, battlemage: { mult: 0.5, ref: 0.1 }, elementalmage: { crit: 0.2 },
    cleric: { heal: 1 }, priest: { heal: 2, potion: 0.5 }, paladin: { dr: 2, ref: 0.15 },
  },
  mobs: {}, // filled in below from the floor bands
};
// Default dodge of the five dodge classes (the number each class's own perk holds). Ranger and Bow Knight are top jobs, so they also keep the Horse Archer's 5%,
// which makes their total 10% as designed. See cfgFrom for how older saved configs receive these.
const DODGE_PERKS = { scout: 0.05, horsearcher: 0.05, ranger: 0.05, bowknight: 0.05, assassin: 0.15 };
const okTiers = (t, ok) => Array.isArray(t) && t.length > 0 && t.every((x) => x && Number.isFinite(Number(x.upTo)) && x.upTo >= 1 && ok(x)) && t.every((x, i) => !i || x.upTo > t[i - 1].upTo);
export const cfgFrom = (raw) => {
  const c = JSON.parse(JSON.stringify(DEFAULT_CFG));
  if (raw) {
    Object.assign(c.hp, raw.hp || {});
    Object.assign(c.def, raw.def || {});
    Object.assign(c.boss, raw.boss || {});
    if (raw.perks) {
      c.perks = { ...c.perks, ...raw.perks }; // jobs missing from a saved config keep their default perks
      // Configs saved before v1.6 (no `v`) have no dodge perks: give the five dodge classes theirs once. A config saved from v1.6 on is taken as it is.
      if (!(raw.v >= 16)) for (const [id, dod] of Object.entries(DODGE_PERKS)) if (raw.perks[id] && raw.perks[id].dod == null) c.perks[id] = { ...raw.perks[id], dod };
    }
    if (raw.php) {
      if (Number.isFinite(Number(raw.php.base)) && raw.php.base !== '' && raw.php.base !== null) c.php.base = Number(raw.php.base);
      if (okTiers(raw.php.tiers, (t) => Array.isArray(t.gains) && t.gains.length && t.gains.every((x) => Array.isArray(x) && x[0] >= 0 && x[1] >= 0) && t.gains.some((x) => x[1] > 0))) c.php.tiers = raw.php.tiers;
    }
    if (raw.sure) c.sure = { jobs: { ...(raw.sure.jobs || {}) }, mobs: { ...(raw.sure.mobs || {}) } }; // (configs saved before v1.6 keep the default: Sniper)
    if (raw.mdodge) for (const k of ['mob', 'mid', 'boss']) if (raw.mdodge[k] != null && raw.mdodge[k] !== '' && Number.isFinite(Number(raw.mdodge[k]))) c.mdodge[k] = Math.min(1, Math.max(0, Number(raw.mdodge[k])));
    if (raw.dodge && okTiers(raw.dodge.tiers, (t) => t.v >= 0)) c.dodge.tiers = raw.dodge.tiers;
    if (raw.shopCost) c.shopCost = raw.shopCost;
    if (raw.items) c.items = raw.items;
    Object.assign(c.speed, raw.speed || {});
    if (raw.mobs) c.mobs = raw.mobs;
    if (raw.floors && raw.floors.length) c.floors = raw.floors;
    if (raw.respawn != null) c.respawn = !!raw.respawn;
    if (raw.story != null) c.story = !!raw.story;
    if (raw.xpMode === 'damage') c.xpMode = 'damage';
    if (raw.dive) Object.assign(c.dive, raw.dive);
    if (Number.isFinite(Number(raw.strike)) && raw.strike !== null && raw.strike !== '') c.strike = Number(raw.strike);
    if (raw.must) Object.assign(c.must, raw.must);
    if (raw.start) Object.assign(c.start, raw.start);
    if (raw.training) Object.assign(c.training, raw.training);
    if (raw.skills) for (const id of Object.keys(c.skills)) if (raw.skills[id]) Object.assign(c.skills[id], raw.skills[id]); // a skill missing from a saved config keeps its defaults
  }
  for (const k of Object.keys(MOBS)) c.mobs[k] = c.mobs[k] || { drops: {} };
  return c;
};
export function hpFor(lv, cfg) {
  const t = cfg.hp.tiers;
  let h = cfg.hp.base;
  for (let k = 2; k <= lv; k++) h += (t.find((x) => k <= x.upTo) || t[t.length - 1]).per;
  return h;
}
// 100 floors; monsters on floor N are level 1..N; every 5th floor ends with a mid-boss and every 10th with a boss (both level N).
// Which mid-boss / boss waits at the end of each 5th / 10th floor (floors 5, 15, ... 95 and 10, 20, ... 100); the bosses repeat, tougher each time as floor level rises.
export const MIDS = ['monarch', 'cyclops', 'dragon', 'shadowbeast', 'warlord', 'matriarch', 'wyvern', 'lichacolyte', 'paladin', 'knight'];
export const BOSSES = ['emperor', 'hydraqueen', 'overlord', 'voidboss', 'lichking'];
const BANDS = [
  [10, 'Cellar', ['slime', 'mole', 'snail', 'mushroom', 'bat', 'hippo']],
  [25, 'Tunnels', ['spider', 'centipede', 'ooze', 'squid', 'goblinscout', 'wisp', 'bat', 'slime']],
  [45, 'Goblin Warren', ['goblin', 'goblinscout', 'imp', 'lizard', 'orc', 'darkelf', 'mimic', 'eye']],
  [70, 'Bone Halls', ['skeleton', 'ghost', 'wraith', 'skull', 'shade', 'darkmage', 'wisp', 'cerberus']],
  [100, 'Dread Keep', ['minotaur', 'troll', 'golem', 'armor', 'hydra', 'manticore', 'cerberus', 'eye']],
];
// starting drop rates per floor band (teachers change them per monster on the Game balance tab)
const BAND_DROPS = [
  { minor: 0.1, potion: 0.05, stick: 0.05, tunic: 0.05 },
  { potion: 0.1, dagger: 0.05, vest: 0.05, locket: 0.04, club: 0.03 },
  { potion: 0.08, bigpotion: 0.06, club: 0.05, studded: 0.04, coin: 0.03, handaxe: 0.03, swiftring: 0.03 },
  { bigpotion: 0.08, greater: 0.05, sword: 0.04, mail: 0.04, ring: 0.03, charm: 0.03 },
  { greater: 0.08, blade: 0.04, plate: 0.04, band: 0.03, amulet: 0.03, signet: 0.03 },
];
BANDS.forEach(([, , ids], i) => ids.forEach((id) => { if (!DEFAULT_CFG.mobs[id]) DEFAULT_CFG.mobs[id] = { drops: BAND_DROPS[i] }; }));
const MID_DROPS = [
  { bigpotion: 0.1, sword: 0.08, mail: 0.08, coin: 0.06 },
  { greater: 0.1, blade: 0.08, plate: 0.08, ring: 0.06, swiftring: 0.06 },
  { greater: 0.1, elixir: 0.08, plate: 0.08, signet: 0.08, amulet: 0.08, band: 0.06 },
];
MIDS.forEach((id, i) => { DEFAULT_CFG.mobs[id] = { drops: MID_DROPS[i < 2 ? 0 : i < 5 ? 1 : 2] }; });
BOSSES.forEach((id) => { DEFAULT_CFG.mobs[id] = { drops: { elixir: 0.1, phoenix: 0.08, pendant: 0.05, crown: 0.04, scrown: 0.04, zephyr: 0.05, waraxe: 0.05, longbow: 0.05, arcstaff: 0.05, fullplate: 0.05, mirror: 0.04, fang: 0.04, die: 0.04 } }; });
export function floorInfo(n) {
  const b = BANDS.find((x) => n <= x[0]);
  const boss = n % 10 === 0, mid = n % 5 === 0 && !boss;
  return { n: `${b[1]} · Floor ${n}`, mobs: b[2], lv: [1, n], boss, mid, lead: boss ? BOSSES[(n / 10 - 1) % BOSSES.length] : mid ? MIDS[(n - 5) / 10] : null };
}

// Shop level follows the deepest job the pupil has unlocked: villager 1, adventurer 2, branch / middle classes 3, top-tier classes 4.
// Items with fam can only be bought and used by the Fighter, Archer or Acolyte line.
export const chain = (job) => { const c = []; for (let j = job; j; j = JOBS[j] && JOBS[j].p) c.push(j); return c; };
// Shop level of a job: villager and novice 1, adventurer and its first step 2, lines and middle classes 3, top-tier 4.
const STAGE = { villager: 1, novice: 1, adventurer: 2, squire: 2, scout: 2, initiate: 2 };
export const stageOfJob = (j) => STAGE[j] ?? (TOPS.has(j) ? 4 : 3);
export const stageOf = (jobs) => Math.max(...jobs.map(stageOfJob));
export const canUse = (it, jobs) => !it.fam || jobs.some((j) => chain(j).includes(it.fam));
export const shopFor = (jobs, lv) => Object.entries(ITEMS).filter(([, i]) => i.st && i.st <= lv && canUse(i, jobs)).map(([id]) => id);

// [key, label, isPercent]
export const PERKS = [['xp', 'XP bonus %', 1], ['gold', 'Gold bonus %', 1], ['dr', 'Damage absorbed per hit', 0], ['hp', 'Max HP bonus %', 1], ['mult', 'Bonus strike extra ×', 0], ['heal', 'HP healed per correct answer', 0], ['potion', 'Potion healing bonus %', 1], ['skip', 'Monster hits skipped per fight', 0], ['boss', 'Damage vs mid-bosses and bosses %', 1], ['crit', 'Double-strike chance %', 1], ['first', 'First correct answer of a fight ×', 0], ['rage', 'Damage below 50% HP %', 1], ['spd', 'Attack speed %', 1], ['dbl', 'Regular-attack double-damage chance %', 1], ['par', 'Parry chance % (a monster hit does nothing)', 1], ['ref', 'Reflect chance % (half the damage you take bounces back)', 1], ['stn', 'Stun chance % (a hit delays the monster)', 1], ['lch', 'Leech % (HP back from damage you deal)', 1], ['dod', 'Dodge chance % (the monster misses and deals 0)', 1]];
// A top-tier job keeps the perk of the class it came from; everything else has only its own perk.
export const perksOf = (job, cfg) => {
  const out = {};
  const add = (id) => { for (const [k, v] of Object.entries(cfg.perks[id] || {})) out[k] = (out[k] || 0) + v; };
  add(job);
  if (TOPS.has(job)) add(JOBS[job].p);
  return out;
};
// ---- Player HP and dodge (v1.6) ----
const tierOf = (tiers, k) => tiers.find((t) => k <= t.upTo) || tiers[tiers.length - 1]; // levels past the last tier use the last tier
// A fixed pseudo-random number in [0, 1) for (pupil, level). The same pupil always gets the same roll for the same level, so max HP never drifts
// between visits, a Dungeon Dive teammate sees the same number, and no new database column is needed.
const unit = (a, b) => {
  let x = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};
export const hpSeed = (pl) => Number(pl.pupil_id ?? pl.id) || 0; // a g_player row has pupil_id, a Dungeon Dive member has id (the same number)
// HP gained on reaching level k (k >= 2).
export function hpGain(k, cfg, seed = 0) {
  const gains = tierOf(cfg.php.tiers, k).gains;
  if (gains.length === 1) return gains[0][0];
  const total = gains.reduce((s, x) => s + x[1], 0);
  let r = unit(seed, k) * total;
  for (const [hp, w] of gains) { if (r < w) return hp; r -= w; }
  return gains[gains.length - 1][0];
}
// Max HP before job perks: the level 1 HP plus every gain from level 2 up to lv.
export function baseHp(lv, cfg, seed = 0) {
  let h = cfg.php.base;
  for (let k = 2; k <= lv; k++) h += hpGain(k, cfg, seed);
  return h;
}
// The expected, lowest and highest base HP at level lv over all possible rolls (the teacher console preview).
export function hpSpread(lv, cfg) {
  let avg = cfg.php.base, min = avg, max = avg;
  for (let k = 2; k <= lv; k++) {
    const g = tierOf(cfg.php.tiers, k).gains.filter((x) => x[1] > 0), tot = g.reduce((s, x) => s + x[1], 0);
    avg += g.reduce((s, x) => s + (x[0] * x[1]) / tot, 0); min += Math.min(...g.map((x) => x[0])); max += Math.max(...g.map((x) => x[0]));
  }
  return { avg: Math.round(avg * 10) / 10, min, max };
}
export const mhOf = (pl, cfg) => Math.round(baseHp(pl.level, cfg, hpSeed(pl)) * (1 + (perksOf(pl.job, cfg).hp || 0)));
// Dodge chance from the pupil's level alone (the job's `dod` perk and the cap are added in gear()).
// A monster's chance to dodge a regular attack, by kind (regular / mid-boss / boss).
export const monsterDodge = (mob, cfg) => { const k = MOBS[mob] && MOBS[mob].kind; return cfg.mdodge[k === 'boss' ? 'boss' : k === 'mid' ? 'mid' : 'mob'] || 0; };
export const sureJob = (job, cfg) => !!(cfg.sure && cfg.sure.jobs[job]);
export const sureMob = (mob, cfg) => !!(cfg.sure && cfg.sure.mobs[mob]);
export const levelDodge = (lv, cfg) => tierOf(cfg.dodge.tiers, lv).v;
// The Adventurer can use any stage 3 weapon, whatever the line.
export const canEquip = (it, job) => canUse(it, [job]) || (job === 'adventurer' && it.slot === 'weapon' && it.st === 3);
