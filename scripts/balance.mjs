#!/usr/bin/env node
// Balance check for gear and jobs. Runs the REAL solo combat (sim() in src/game.js) thousands of times against one monster and prints, for every piece of
// gear the job can use, how fast it kills, how much damage it takes and how often it wins. Seeded, so the numbers are repeatable.
//
//   node scripts/balance.mjs --job fighter --level 40 --mlevel 40 --slot weapon
//   node scripts/balance.mjs --job cleric --level 60 --mlevel 55 --slot armor --weapon mace
//   node scripts/balance.mjs --job knight --level 60 --mlevel 80 --boss dragon --answer
//
// --slot weapon|armor|acc   which slot to compare (default weapon). The other slots take --weapon / --armor / --acc ids.
// --mob goblin              monster to fight (any id in MOBS; bosses use their boss damage). --mlevel N its level (default = --level).
// --answer                  also land one correct-answer strike at the start (shows the weapon's answer strike is style-neutral).
// --runs N                  fights per loadout (default 300).
import { sim, gear } from '../src/game.js';
import { cfgFrom, ITEMS, MOBS, JOBS, hpFor, mhOf, canEquip, applyItems } from '../src/gamedata.js';
import { dpsIndex } from '../src/combat.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const job = arg('job', 'fighter'), level = +arg('level', 40), mlevel = +arg('mlevel', level), runs = +arg('runs', 300), slot = arg('slot', 'weapon'), mob = arg('mob', 'goblin'), answer = !!arg('answer', false);
if (!JOBS[job]) { console.error('Unknown job. Try: ' + Object.keys(JOBS).join(', ')); process.exit(1); }
if (!MOBS[mob]) { console.error('Unknown monster. Try: ' + Object.keys(MOBS).slice(0, 12).join(', ') + ' ...'); process.exit(1); }
const cfg = cfgFrom(null); applyItems(cfg);
const base = { weapon: arg('weapon', null), armor: arg('armor', null), acc: arg('acc', null) };

// small seeded random generator (mulberry32) so a run is repeatable
let seed = 12345;
const mulberry = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function fightOnce(loadout) {
  const pl = { level, job, ...loadout, floor_kills: JSON.stringify({ ca: 99 }), potion: null, auto: 0 };
  const g = gear(pl, cfg), mh = mhOf(pl, cfg); pl.hp = mh;
  const hp = hpFor(mlevel, cfg) * (MOBS[mob].kind === 'boss' ? cfg.boss.bossHp : MOBS[mob].kind === 'mid' ? cfg.boss.midHp : 1);
  const t0 = 1e7, im = (cfg.speed.turn * 1000) / (1 + cfg.speed.monster);
  const f = { mob, level: mlevel, mob_hp: Math.round(hp), mob_max: Math.round(hp), p_next: t0 + g.ip, m_next: t0 + im };
  if (answer) f.mob_hp = Math.max(1, f.mob_hp - Math.round((cfg.strike + (g.P.mult || 0)) * g.bat));
  const start = f.mob_hp;
  for (let now = t0; now < t0 + 1200 * 1000; now += 500) {
    const r = sim(pl, f, cfg, { qty: 0, heal: 0, used: 0 }, now);
    if (r.res) return { won: r.res === 'win', t: (now - t0) / 1000, taken: mh - Math.max(0, pl.hp), start };
  }
  return { won: false, t: 1200, taken: mh - pl.hp, start };
}
function measure(id) {
  const loadout = { ...base, [slot]: id };
  const real = Math.random; Math.random = mulberry; seed = 12345;
  let wins = 0, tt = 0, dm = 0;
  try { for (let i = 0; i < runs; i++) { const r = fightOnce(loadout); wins += r.won; tt += r.t; dm += r.taken; } } finally { Math.random = real; }
  const g = gear({ level, job, ...loadout }, cfg);
  const spd = (cfg.speed.turn * 1000) / g.ip - 1;
  return { id, name: id ? ITEMS[id].e + ' ' + ITEMS[id].n : '(nothing)', st: id ? ITEMS[id].st ?? '-' : '-', idx: dpsIndex(g.atk, spd, g.dbl), win: wins / runs, ttk: tt / runs, dmg: dm / runs, hit: g.atk, ans: Math.round((cfg.strike + (g.P.mult || 0)) * g.bat), ip: g.ip / 1000 };
}
const ids = [null, ...Object.entries(ITEMS).filter(([, it]) => it.slot === slot && canEquip(it, job)).map(([id]) => id)];
const rows = ids.map(measure).sort((a, b) => (a.st === '-' ? 99 : a.st) - (b.st === '-' ? 99 : b.st) || a.ttk - b.ttk);
const pad = (v, n) => String(v).padEnd(n), num = (v, d = 1) => Number(v).toFixed(d);
console.log(`${JOBS[job].n} level ${level} vs ${MOBS[mob].n} level ${mlevel}${answer ? ' (after one correct answer)' : ''} · ${runs} fights each · ${slot} slot` + (Object.values(base).some(Boolean) ? ' · with ' + Object.entries(base).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ') : ''));
console.log(pad('item', 26) + pad('shop', 5) + pad('max hit', 8) + pad('swing s', 8) + pad('answer', 7) + pad('dps idx', 8) + pad('kill s', 8) + pad('dmg taken', 10) + 'win %');
for (const r of rows) console.log(pad(r.name, 26) + pad(r.st, 5) + pad(r.hit, 8) + pad(num(r.ip), 8) + pad(r.ans, 7) + pad(num(r.idx), 8) + pad(num(r.ttk), 8) + pad(num(r.dmg), 10) + num(r.win * 100, 0));
console.log('\nHow to read it: gear of the same shop level should land close together on kill s and dmg taken. Fast and heavy weapons trade swing speed for hit size, so max hit and swing s differ but dps idx and answer should stay level.');
