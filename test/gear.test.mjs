// Job tiers (Novice and the gate jobs), the new job-point schedule, and the new gear stats: crit, parry, reflect, stun, leech.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { JOBS, ITEMS, PERKS, TOPS, RANGED, chain, closeJobs, points, nextPoint, freePoints, stageOf, stageOfJob, perksOf, canEquip, cfgFrom, shopFor } from '../src/gamedata.js';
import { CAPS, REFLECT_SHARE, STUN_MS, capStat, playerStrike, strikeEffects, monsterHit, dpsIndex } from '../src/combat.js';
import { sim, gear, route } from '../src/game.js';
import { roleOf } from '../src/dive.js';

const cfg = cfgFrom(null);

// ---------- job tiers ----------
test('the job tree is one tree: every job leads back to Villager, and every top job is eight steps deep', () => {
  for (const [id, j] of Object.entries(JOBS)) {
    if (id !== 'villager') assert.ok(JOBS[j.p], id + ' has a parent');
    assert.equal(chain(id)[chain(id).length - 1], 'villager');
  }
  assert.equal(Object.keys(JOBS).length, 30);
  assert.equal(TOPS.size, 12);
  for (const t of TOPS) assert.equal(chain(t).length, 8, t);
  assert.deepEqual(['novice', 'squire', 'soldier'].map((x) => chain(x).length), [2, 4, 6]);
  assert.equal(JOBS.fighter.p, 'squire'); assert.equal(JOBS.swordsman.p, 'soldier'); assert.equal(JOBS.mage.p, 'adept'); assert.equal(JOBS.adventurer.p, 'novice');
});

test('job points come at 5, 10, 15, 20, 30, 40, 60 and then every 20 levels, enough for a full path', () => {
  assert.deepEqual([4, 5, 10, 15, 20, 29, 30, 40, 59, 60, 79, 80, 100, 120].map(points), [0, 1, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8, 9, 10]);
  assert.deepEqual([1, 5, 12, 40, 59, 60, 79, 80, 100].map(nextPoint), [5, 10, 15, 60, 60, 80, 80, 100, 120]);
  assert.equal(points(60), chain('knight').length - 1); // seven unlocks reach any top job at level 60
});

test('older saves are completed with the jobs that now sit before theirs, and a single-line pupil never loses a point', () => {
  assert.deepEqual(closeJobs(['villager', 'adventurer', 'fighter', 'swordsman']), ['villager', 'novice', 'adventurer', 'squire', 'fighter', 'soldier', 'swordsman']);
  assert.deepEqual(closeJobs(['villager']), ['villager']);
  assert.deepEqual(closeJobs(['villager', 'ghost']), ['villager']); // unknown ids are dropped
  assert.deepEqual(closeJobs(closeJobs(['knight'])), closeJobs(['knight'])); // idempotent
  // the new schedule pays for the completed path wherever the old schedule allowed it (one line: every old save is a path)
  const old = (lv) => [10, 20, 40, 60].filter((x) => lv >= x).length + (lv >= 80 ? Math.floor((lv - 60) / 20) : 0);
  const line = ['adventurer', 'fighter', 'swordsman', 'knight', 'swordmaster'];
  for (let lv = 1; lv <= 300; lv++) {
    const spent = closeJobs(['villager', ...line.slice(0, Math.min(old(lv), line.length))]).length - 1;
    assert.ok(points(lv) >= spent, `level ${lv}`);
  }
  // spread across three lines the completed save can cost more than the pupil has: free points stop at 0 rather than going negative
  const wide = closeJobs(['villager', 'adventurer', 'fighter', 'archer', 'acolyte', 'swordsman', 'mage']);
  assert.equal(wide.length - 1, 12); assert.equal(freePoints(100, wide.length), 0);
  assert.equal(freePoints(30, 5), 1);
});

test('shop levels, perks, ranged jobs and Dive roles follow the new tree', () => {
  assert.deepEqual(['villager', 'novice', 'adventurer', 'squire', 'scout', 'initiate', 'fighter', 'soldier', 'swordsman', 'knight'].map(stageOfJob), [1, 1, 2, 2, 2, 2, 3, 3, 3, 4]);
  assert.equal(stageOf(['villager', 'novice', 'adventurer', 'squire']), 2);
  assert.equal(stageOf(chain('knight')), 4);
  assert.equal(perksOf('knight', cfg).mult, 0.5); // a top job still keeps its parent's perk
  assert.equal(perksOf('swordsman', cfg).par, undefined);
  assert.ok(perksOf('squire', cfg).hp > 0 && perksOf('soldier', cfg).dr === 1);
  for (const id of ['scout', 'marksman', 'initiate', 'adept']) assert.ok(RANGED.has(id), id);
  assert.deepEqual(['novice', 'adventurer', 'squire', 'scout', 'soldier', 'marksman', 'adept'].map(roleOf), [null, null, null, null, 'melee', 'ranged', 'magic']);
  assert.equal(roleOf('cleric'), 'healer');
  for (const [id, pk] of Object.entries(cfg.perks)) { assert.ok(JOBS[id], id); for (const k of Object.keys(pk)) assert.ok(PERKS.some((p) => p[0] === k), id + ' ' + k); }
});

test('a saved config from before the new jobs still gives them their perks', () => {
  const c = cfgFrom({ perks: { villager: { xp: 0.3 } } });
  assert.equal(c.perks.villager.xp, 0.3);
  assert.ok(c.perks.novice && c.perks.soldier && c.perks.paladin.ref);
});

// ---------- gear data ----------
test('every item is well formed: class lines are real jobs, stats are sane, sold items have a shop level', () => {
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.fam) assert.ok(JOBS[it.fam], id + ' fam ' + it.fam);
    if (it.slot === 'use') continue;
    for (const k of ['dbl', 'crit', 'par', 'ref', 'stn', 'lch']) assert.ok(it[k] >= 0 && it[k] <= 1, id + ' ' + k);
    assert.ok(it.spd >= -0.5 && it.spd <= 1, id + ' spd');
    if (it.pw != null) assert.ok(it.pw > 0 && it.slot === 'weapon', id + ' pw');
  }
  for (const id of ['mirror', 'fang', 'die']) assert.equal(ITEMS[id].st, undefined, id + ' is boss-only');
  assert.ok(cfg.mobs.emperor.drops.fang > 0 && cfg.mobs.emperor.drops.die > 0 && cfg.mobs.emperor.drops.mirror > 0);
});

test('gear styles stay within a fair budget of the balanced weapon (swift, heavy and the rest are trades, not upgrades)', () => {
  const styled = [['maul', 'warhammer', 'colossus'], ['rapier', 'sabre', 'foil'], ['knuckles', 'gauntlets', 'thunderfists'], ['shortbow', 'compbow', 'galebow'], ['xbow', 'siegebow', 'ballista'], ['wand', 'stormwand', 'tempestwand'], ['mace', 'holymace', 'judgemace'], ['siphon', 'wraithstaff', 'vampstaff']];
  for (const d of [3, 4, 5, 6]) for (const line of styled) line.forEach((id) => {
    const it = ITEMS[id], balanced = dpsIndex(d + it.pw);
    // parry, stun and leech are worth something on top, so they may give up up to about a tenth of raw damage
    const ratio = dpsIndex(d + it.atk, it.spd, it.dbl) / balanced;
    assert.ok(ratio > 0.8 && ratio < 1.15, `${id} at job damage ${d}: ${ratio.toFixed(2)}`);
  });
  // the answer strike is built on the balanced value, whatever the style
  const pl = { job: 'fighter', weapon: 'maul', armor: null, acc: null };
  assert.equal(gear({ ...pl, weapon: 'maul' }, cfg).bat, 4 + 8);
  assert.ok(gear({ ...pl, weapon: 'maul' }, cfg).atk > gear({ ...pl, weapon: 'maul' }, cfg).bat); // heavy: big swings, same answer strike
  assert.equal(gear({ job: 'brawler', weapon: 'knuckles' }, cfg).bat, 6 + 8);
  assert.equal(gear({ job: 'fighter', weapon: null }, cfg).bat, 4); // plain gear: unchanged
});

test('class sub-lines: gear is only usable by its own branch', () => {
  assert.ok(canEquip(ITEMS.rapier, 'knight') && canEquip(ITEMS.rapier, 'swordsman'));
  assert.ok(!canEquip(ITEMS.rapier, 'brawler') && !canEquip(ITEMS.rapier, 'fighter'));
  assert.ok(canEquip(ITEMS.maul, 'berserker') && canEquip(ITEMS.maul, 'fighter') && !canEquip(ITEMS.maul, 'archer'));
  assert.ok(canEquip(ITEMS.mirrorrobe, 'priest') && !canEquip(ITEMS.mirrorrobe, 'knight'));
  assert.ok(canEquip(ITEMS.eagle, 'villager')); // accessories are for everyone
  const shop = shopFor(chain('swordsman'), 3).map((i) => i.id ?? i);
  assert.ok(JSON.stringify(shop).includes('rapier') && !JSON.stringify(shop).includes('knuckles'));
});

test('gear totals add up across weapon, armour, accessory and job perk, and are capped', () => {
  const g = gear({ job: 'knight', weapon: 'foil', armor: 'hedgehog', acc: 'badge' }, cfg);
  assert.equal(g.par, 0.12 + 0.08 + 0.1); // foil + badge + the Knight's own parry perk
  assert.equal(g.ref, 0.2);
  const heavy = gear({ job: 'fighter', weapon: 'colossus', armor: 'fortress', acc: null }, cfg);
  assert.ok(heavy.ip > gear({ job: 'fighter', weapon: null, armor: null }, cfg).ip * 1.9); // half speed (and armour slows a little more, floored at -50%)
  const edited = cfgFrom({ perks: { knight: { par: 0.9 } } });
  assert.equal(gear({ job: 'knight', weapon: 'foil', armor: null, acc: 'badge' }, edited).par, CAPS.par);
});

// ---------- the shared combat rules ----------
const never = () => { throw new Error('a random number was drawn for a stat the build does not have'); };

test('combat.js: a build without special stats draws no extra random numbers', () => {
  const r = [0.5]; const one = () => r[0];
  assert.deepEqual(playerStrike({}, 10, one), { d: 6, x: 0 });
  assert.deepEqual(strikeEffects({}, 5, 10, 20, never), { stun: 0, heal: 0 });
  assert.deepEqual(monsterHit({ def: 2 }, 6, never), { d: 4, par: 0, rf: 0 });
  assert.equal(monsterHit({ def: 9 }, 3, never).d, 1); // armour never takes a hit below 1
});

test('combat.js: crit, parry, reflect, stun and leech', () => {
  assert.deepEqual(playerStrike({ dbl: 0.1 }, 10, () => 0.05), { d: 2, x: 1 }); // roll 1, doubled
  assert.equal(playerStrike({ dbl: 0.1 }, 10, () => 0.5).x, 0);
  assert.deepEqual(monsterHit({ def: 1, par: 0.2 }, 9, () => 0.1), { d: 0, par: 1, rf: 0 });
  assert.deepEqual(monsterHit({ def: 1, par: 0.2 }, 9, () => 0.9), { d: 8, par: 0, rf: 0 });
  assert.equal(monsterHit({ def: 0, ref: 0.5 }, 9, () => 0.1).rf, Math.round(9 * REFLECT_SHARE));
  assert.equal(monsterHit({ def: 0, ref: 0.5 }, 1, () => 0.1).rf, 1); // always at least 1
  assert.equal(monsterHit({ def: 0, ref: 0.5 }, 9, () => 0.9).rf, 0);
  assert.equal(strikeEffects({ stn: 0.3 }, 5, 10, 20, () => 0.1).stun, 1);
  assert.equal(strikeEffects({ stn: 0.3 }, 5, 10, 20, () => 0.9).stun, 0);
  assert.equal(strikeEffects({ lch: 0.5 }, 5, 10, 20, () => 0.9).heal, 2); // 2.5 -> 2 and a 50% chance of a third; 0.9 misses it
  assert.equal(strikeEffects({ lch: 0.5 }, 5, 10, 20, () => 0.1).heal, 3);
  assert.equal(strikeEffects({ lch: 0.5 }, 5, 19, 20, () => 0.1).heal, 1); // never above full HP
  // leech keeps its average: 10% of 5 damage is 0.5 HP a hit
  let seed = 7; const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let tot = 0; for (let i = 0; i < 20000; i++) tot += strikeEffects({ lch: 0.1 }, 5, 0, 99, rng).heal;
  assert.ok(Math.abs(tot / 20000 - 0.5) < 0.02);
  assert.equal(capStat('par', 5), CAPS.par); assert.equal(capStat('par', -1), 0); assert.equal(capStat('dbl', undefined), 0);
});

// ---------- solo combat uses them ----------
// These fights stub every random number ("every chance succeeds"), so the level's base dodge, which is rolled first, is switched off here; dodge has its own tests.
const calm = cfgFrom({ dodge: { tiers: [{ upTo: 100, v: 0 }] }, mdodge: { mob: 0, mid: 0, boss: 0 } }); // (monsters dodge too, so that is off as well)
const fightOf = (job, gearIds, over = {}, fo = {}) => {
  const now = 1e7;
  const pl = { level: 30, hp: 100, job, weapon: null, armor: null, acc: null, potion: null, auto: 0, floor_kills: JSON.stringify({ ca: 9 }), ...gearIds };
  const f = { mob: 'goblin', level: 20, mob_hp: 500, mob_max: 500, p_next: now + 1e9, m_next: now - 1000, ...fo };
  const run = (stub) => { const real = Math.random; Math.random = stub; try { return sim(pl, f, calm, { qty: 0, heal: 0, used: 0 }, now); } finally { Math.random = real; } };
  return { pl, f, run, now };
};

test('solo: a parry takes the hit away, and says so', () => {
  const t = fightOf('knight', { acc: 'badge' }, {}, { m_next: 1e7 - 1000 });
  const r = t.run(() => 0); // every chance succeeds
  const hit = r.ev.find((e) => e.who === 'm');
  assert.equal(hit.d, 0); assert.equal(hit.par, 1); assert.equal(t.pl.hp, 100);
});

test('solo: reflect hurts the monster by half the damage taken, but cannot skip the answers it needs', () => {
  const t = fightOf('swordsman', { armor: 'thornmail' }, {}, {});
  const r = t.run((() => { const seq = [0.99, 0.0]; let i = 0; return () => seq[i++ % 2]; })()); // monster rolls high, then every chance succeeds
  const hit = r.ev.find((e) => e.who === 'm');
  assert.ok(hit.d > 0 && hit.rf >= 1); assert.equal(500 - t.f.mob_hp, hit.rf);
  // a monster that needs an answer first survives a reflect that would kill it
  const g = fightOf('swordsman', { armor: 'thornmail', floor_kills: JSON.stringify({ ca: 0 }) }, {}, { mob_hp: 1, mob_max: 5 });
  const rr = g.run(() => 0.0);
  assert.equal(rr.res, null); assert.equal(g.f.mob_hp, 1);
  // with the answers in, the same reflect finishes it
  const h = fightOf('swordsman', { armor: 'thornmail' }, {}, { mob_hp: 1, mob_max: 5 });
  assert.equal(h.run(() => 0.0).res, 'win');
});

test('solo: a stun delays the monster and leech gives HP back', () => {
  const t = fightOf('cleric', { weapon: 'mace' }, {}, { p_next: 1e7 - 1000, m_next: 1e7 + 1e8 });
  const before = t.f.m_next;
  const r = t.run(() => 0.0);
  const hit = r.ev.find((e) => e.who === 'p');
  assert.equal(hit.st, 1);
  assert.ok(t.f.m_next >= before + STUN_MS);
  const l = fightOf('acolyte', { weapon: 'vampstaff' }, {}, { p_next: 1e7 - 1000, m_next: 1e7 + 1e8 });
  l.pl.hp = 10;
  const r2 = l.run(() => 0.99); // damage roll high; the leech's extra chance misses
  const h2 = r2.ev.find((e) => e.who === 'p');
  assert.ok(h2.lc >= 1 && l.pl.hp === 10 + h2.lc);
});

test('solo: critical hits come from gear now, not just perks', () => {
  const t = fightOf('villager', { acc: 'eagle' }, {}, { p_next: 1e7 - 1000, m_next: 1e7 + 1e8 });
  const hit = t.run(() => 0.0).ev.find((e) => e.who === 'p');
  assert.equal(hit.x, 1); assert.equal(hit.d, 2);
});

// ---------- the migration, through the real routes ----------
function d1(db) {
  const wrap = (sql) => {
    const st = db.prepare(sql); let args = [];
    const o = { bind: (...a) => ((args = a), o), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => (st.run(...args), { success: true }) };
    return o;
  };
  return { prepare: wrap, batch: async (l) => { for (const s of l) await s.run(); } };
}
const api = (env, a, body) => route(new Request('https://x/api/game/' + a, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }), env, { id: 1, name: 'Mei' }, '/api/game/' + a, body ? 'POST' : 'GET').then((r) => r.json());

test('a pupil saved before the gate jobs is completed on load, keeps their job, and can still spend their points', async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'game-schema.sql']) db.exec(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
  db.exec("INSERT INTO g_player (pupil_id, level, job, jobs) VALUES (1, 30, 'fighter', '[\"villager\",\"adventurer\",\"fighter\"]')");
  const env = { DB: d1(db) };
  let s = await api(env, 'state');
  assert.deepEqual(s.me.jobs, ['villager', 'novice', 'adventurer', 'squire', 'fighter']);
  assert.equal(s.me.job, 'fighter');
  assert.equal(s.me.free, 1); // 5 points at level 30, 4 spent on the completed path
  assert.equal(s.me.nextPoint, 40);
  assert.ok(s.jobTree.soldier && !s.jobTree.swordsman); // only the next step is revealed
  assert.ok(!s.jobTree.knight && !s.jobTree.marksman);
  await assert.rejects(api(env, 'unlock', { job: 'swordsman' }), /isn’t available/);
  s = await api(env, 'unlock', { job: 'soldier' });
  assert.equal(s.me.job, 'soldier'); assert.equal(s.me.free, 0);
  assert.ok(s.jobTree.swordsman && s.jobTree.brawler);
  await assert.rejects(api(env, 'unlock', { job: 'swordsman' }), /no job point/);
  assert.equal(JSON.parse(db.prepare('SELECT jobs FROM g_player WHERE pupil_id = 1').get().jobs).join(), 'villager,novice,adventurer,squire,fighter,soldier');
});

test('every job has its own sprite', () => {
  for (const id of Object.keys(JOBS)) assert.ok(existsSync(new URL(`../public/p/${id}.png`, import.meta.url)), id);
});
