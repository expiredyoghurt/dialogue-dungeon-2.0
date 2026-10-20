// v1.6: player HP by level range (with chances), dodge by level range, and the dodge classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERKS, JOBS, cfgFrom, perksOf, mhOf, baseHp, hpGain, hpSeed, hpSpread, levelDodge, DEFAULT_CFG } from '../src/gamedata.js';
import { CAPS, capStat, monsterHit } from '../src/combat.js';
import { sim, gear, configSave } from '../src/game.js';
import { simParty } from '../src/dive.js';

const cfg = cfgFrom(null);
const seeds = Array.from({ length: 4000 }, (_, i) => i + 1);
const share = (xs, v) => xs.filter((x) => x === v).length / xs.length;
const near = (a, b, tol = 0.03) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// ---------- player HP ----------
test('player HP: 10 at level 1, then 1 HP a level to 10, 2 a level to 30 (the same for every pupil)', () => {
  for (const s of [0, 1, 99, 12345]) {
    assert.equal(baseHp(1, cfg, s), 10);
    assert.equal(baseHp(10, cfg, s), 19); // levels 2 to 10: nine levels at 1 HP
    assert.equal(baseHp(11, cfg, s), 21);
    assert.equal(baseHp(30, cfg, s), 59); // levels 11 to 30: twenty levels at 2 HP
  }
});

test('player HP: later tiers only ever roll the HP amounts the tier lists', () => {
  const allowed = [[31, 50, [2, 3]], [51, 70, [2, 3, 4]], [71, 100, [3, 4, 5, 6]]];
  for (const [lo, hi, ok] of allowed) for (let k = lo; k <= hi; k++) for (const s of [1, 2, 3, 77, 500]) assert.ok(ok.includes(hpGain(k, cfg, s)), `level ${k} seed ${s}`);
  // the totals therefore stay between the lowest and highest possible
  for (const s of seeds.slice(0, 200)) {
    const r = hpSpread(100, cfg), h = baseHp(100, cfg, s);
    assert.ok(h >= r.min && h <= r.max);
  }
  assert.deepEqual([hpSpread(50, cfg).min, hpSpread(50, cfg).max], [59 + 20 * 2, 59 + 20 * 3]);
});

test('player HP: the chances are 25/75, 25/50/25 and 15/25/35/25 in the three later tiers', () => {
  const at = (k) => seeds.map((s) => hpGain(k, cfg, s));
  for (const k of [35, 44, 50]) { const g = at(k); near(share(g, 2), 0.25); near(share(g, 3), 0.75); }
  for (const k of [51, 60, 70]) { const g = at(k); near(share(g, 2), 0.25); near(share(g, 3), 0.5); near(share(g, 4), 0.25); }
  for (const k of [71, 85, 100]) { const g = at(k); near(share(g, 3), 0.15); near(share(g, 4), 0.25); near(share(g, 5), 0.35); near(share(g, 6), 0.25); }
  // the average over a whole range follows the chances too: levels 31 to 50 average 2.75 HP
  const avg = seeds.slice(0, 500).reduce((t, s) => t + (baseHp(50, cfg, s) - baseHp(30, cfg, s)) / 20, 0) / 500;
  near(avg, 2.75, 0.05);
});

test('player HP: a pupil’s rolls are fixed, differ between pupils and never lower max HP', () => {
  assert.equal(baseHp(80, cfg, 42), baseHp(80, cfg, 42));
  const totals = new Set(seeds.slice(0, 50).map((s) => baseHp(80, cfg, s)));
  assert.ok(totals.size > 10, 'pupils should not all roll alike');
  for (const s of [5, 6, 7]) for (let lv = 2; lv <= 120; lv++) assert.ok(baseHp(lv, cfg, s) > baseHp(lv - 1, cfg, s));
  // a pupil row has pupil_id, a Dungeon Dive member has id: both give the same pupil the same HP
  assert.equal(hpSeed({ pupil_id: 9 }), 9); assert.equal(hpSeed({ id: 9 }), 9); assert.equal(hpSeed({}), 0);
  assert.equal(mhOf({ pupil_id: 9, level: 70, job: 'villager' }, cfg), mhOf({ id: 9, level: 70, job: 'villager' }, cfg));
});

test('player HP: a level-up adds exactly the HP it rolled, past the last tier keeps the last gain, and the HP perk is a bonus on top', () => {
  const s = 31;
  for (let lv = 2; lv <= 110; lv++) assert.equal(baseHp(lv, cfg, s) - baseHp(lv - 1, cfg, s), hpGain(lv, cfg, s));
  assert.ok([3, 4, 5, 6].includes(hpGain(150, cfg, s)));
  assert.equal(mhOf({ pupil_id: s, level: 30, job: 'villager' }, cfg), 59);
  assert.equal(mhOf({ pupil_id: s, level: 30, job: 'squire' }, cfg), Math.round(59 * 1.05)); // squire: Max HP +5%
});

test('player HP: teachers can reshape it (one tier, any chances, any base)', () => {
  const c = cfgFrom({ php: { base: 20, tiers: [{ upTo: 5, gains: [[5, 100]] }, { upTo: 20, gains: [[1, 1], [9, 3]] }] } });
  assert.equal(baseHp(1, c, 3), 20); assert.equal(baseHp(5, c, 3), 40);
  const g = seeds.map((x) => hpGain(10, c, x)); near(share(g, 1), 0.25); near(share(g, 9), 0.75); // relative chances: 1 and 3
  assert.equal(c.hp.tiers.length, DEFAULT_CFG.hp.tiers.length); // monster HP is untouched
  // a broken saved tier falls back to the defaults instead of breaking the game
  const bad = cfgFrom({ php: { tiers: [{ upTo: 10, gains: [] }] }, dodge: { tiers: [{ upTo: 10 }] } });
  assert.deepEqual(bad.php.tiers, DEFAULT_CFG.php.tiers); assert.deepEqual(bad.dodge.tiers, DEFAULT_CFG.dodge.tiers);
  // an older saved config with no player HP at all gets the new defaults
  assert.deepEqual(cfgFrom({ hp: { base: 5 } }).php, DEFAULT_CFG.php);
});

// ---------- dodge ----------
test('dodge: 1, 2, 3, 4 and 5% by level range', () => {
  assert.deepEqual([1, 10, 11, 30, 31, 50, 51, 70, 71, 100, 150].map((l) => levelDodge(l, cfg)), [0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.05]);
  assert.ok(PERKS.some((p) => p[0] === 'dod'));
});

test('dodge: Scout 5%, Ranger 10%, Horse Archer 5%, Bow Knight 10% and Assassin 15% on top of the level’s dodge', () => {
  const total = (job) => perksOf(job, cfg).dod || 0;
  assert.deepEqual(['scout', 'horsearcher', 'ranger', 'bowknight', 'assassin'].map(total), [0.05, 0.05, 0.1, 0.1, 0.15]);
  for (const j of Object.keys(JOBS)) if (!['scout', 'horsearcher', 'ranger', 'bowknight', 'assassin'].includes(j)) assert.equal(total(j), 0, j);
  const dod = (job, level) => Math.round(gear({ level, job }, cfg).dod * 1e4) / 1e4;
  assert.equal(dod('villager', 5), 0.01);
  assert.equal(dod('scout', 5), 0.06); assert.equal(dod('assassin', 80), 0.2); assert.equal(dod('ranger', 40), 0.13);
  assert.equal(dod('bowknight', 100), 0.15); assert.equal(dod('horsearcher', 20), 0.07);
  // the total is capped so nobody becomes untouchable
  const high = cfgFrom({ dodge: { tiers: [{ upTo: 100, v: 0.9 }] } });
  assert.equal(gear({ level: 5, job: 'assassin' }, high).dod, CAPS.dod); assert.equal(CAPS.dod, 0.5);
  assert.equal(capStat('dod', 0.7), 0.5); assert.equal(capStat('dod', -1), 0);
});

test('dodge: a dodged hit does 0 damage, ends the hit (no parry or reflect), and a build with no dodge draws no random number', () => {
  const never = () => { throw new Error('no random number should be drawn'); };
  assert.deepEqual(monsterHit({ def: 2 }, 6, never), { d: 4, par: 0, rf: 0 });
  assert.deepEqual(monsterHit({ dod: 0, def: 2 }, 6, never), { d: 4, par: 0, rf: 0 });
  assert.deepEqual(monsterHit({ dod: 0.2, def: 0, par: 1, ref: 1 }, 9, () => 0.1), { d: 0, dod: 1, par: 0, rf: 0 });
  const missed = monsterHit({ dod: 0.2, def: 0 }, 9, () => 0.2); // 0.2 is not below 0.2: the hit lands
  assert.equal(missed.d, 9); assert.equal(missed.dod, undefined);
  // with parry too: a failed dodge still gets its parry chance
  const seq = [0.5, 0.05]; let i = 0;
  assert.equal(monsterHit({ dod: 0.2, par: 0.1, def: 0 }, 9, () => seq[i++]).par, 1);
});

test('dodge: over many hits the dodge rate matches the chance', () => {
  let seed = 11; const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (const [job, level, want] of [['villager', 5, 0.01], ['villager', 40, 0.03], ['assassin', 80, 0.2], ['ranger', 20, 0.12]]) {
    const g = gear({ level, job }, cfg); let dodged = 0, took = 0;
    for (let i = 0; i < 40000; i++) { const h = monsterHit(g, 5, rng); if (h.dod) { dodged++; assert.equal(h.d, 0); } else took += h.d > 0; }
    near(dodged / 40000, want, 0.008); assert.equal(dodged + took, 40000);
  }
});

const fight = (job, level, over = {}) => {
  const now = 1e7;
  const pl = { level, hp: 100, job, weapon: null, armor: over.armor || null, acc: null, potion: null, auto: 0, floor_kills: JSON.stringify({ ca: 9 }) };
  const f = { mob: 'goblin', level: 20, mob_hp: 500, mob_max: 500, p_next: now + 1e9, m_next: now - 1000 };
  const run = (stub, c = cfg) => { const real = Math.random; Math.random = stub; try { return sim(pl, f, c, { qty: 0, heal: 0, used: 0 }, now); } finally { Math.random = real; } };
  return { pl, f, run };
};

test('solo: a dodge makes the monster miss, and says so', () => {
  const t = fight('assassin', 80, { armor: 'thornmail' });
  const r = t.run(() => 0); // every chance succeeds: the dodge is rolled first and wins
  const hit = r.ev.find((e) => e.who === 'm');
  assert.equal(hit.d, 0); assert.equal(hit.dod, 1); assert.equal(hit.par, undefined); assert.equal(hit.rf, undefined);
  assert.equal(t.pl.hp, 100); assert.equal(t.f.mob_hp, 500); // nothing was reflected back either
  // a high roll does not dodge
  const t2 = fight('assassin', 80);
  const hit2 = t2.run(() => 0.99).ev.find((e) => e.who === 'm');
  assert.ok(hit2.d > 0); assert.equal(hit2.dod, undefined); assert.ok(t2.pl.hp < 100);
});

test('solo: a pupil whose dodge is 0 uses the same random numbers as before v1.6', () => {
  const none = cfgFrom({ dodge: { tiers: [{ upTo: 100, v: 0 }] } });
  const t = fight('villager', 5);
  const seen = []; const r = t.run(() => { seen.push(1); return 0.99; }, none);
  const hit = r.ev.find((e) => e.who === 'm');
  assert.ok(hit.d > 0);
  const u = fight('villager', 5); let n = 0; u.run(() => { n++; return 0.99; }, cfg);
  assert.equal(n, seen.length + 1); // the level's dodge costs exactly one extra roll per monster hit
});

test('dive: a dodge makes the monster miss one pupil, and says so', () => {
  const m = { id: 1, name: 'P1', job: 'assassin', level: 80, maxHp: 30, hp: 30, alive: true, atk: 5, def: 0, ip: 15000, g: { gold: 0, xp: 0, heal: 0 }, P: {}, ranged: false, dod: 1, par: 1, ref: 1,
    potion: null, auto: 0, owned: [], pack: { gold: 0, drops: {} }, pNext: 1e12, sk: 0, fs: 0, ca: 0, q: null, potUsed: 0 };
  const S = { status: 'dive', members: [m], mon: { mob: 'slime', level: 5, hp: 500, max: 500, ca: 9, mNext: 1000 }, log: [] };
  const r = simParty(S, cfg, 1000, () => 0);
  const hit = r.ev.find((e) => e.w === 'm');
  assert.equal(hit.d, 0); assert.equal(hit.dod, 1); assert.equal(hit.par, undefined); assert.equal(m.hp, 30); assert.equal(S.mon.hp, 500);
});

// ---------- the game balance tab: saving, and configs saved before v1.6 ----------
const saveCfg = async (body) => {
  let saved = null;
  const env = { DB: { prepare: () => ({ bind: (v) => ({ run: async () => { saved = JSON.parse(v); } }) }) } };
  await configSave(new Request('https://x/api/teacher/game-config', { method: 'POST', body: JSON.stringify({ hp: { base: 5, tiers: DEFAULT_CFG.hp.tiers }, floors: DEFAULT_CFG.floors, ...body }) }), env);
  return saved;
};

test('game balance: player HP and dodge tiers are saved, cleaned and sorted', async () => {
  const s = await saveCfg({ php: { base: 12, tiers: [{ upTo: 60, gains: [[3, 10], [2, 30], [2, 10], [4, 0], [5, -3]] }, { upTo: 20, gains: [[1, 100]] }] }, dodge: { tiers: [{ upTo: 50, v: 0.07 }, { upTo: 10, v: 0.015 }, { upTo: 0, v: 0.5 }] } });
  assert.equal(s.v, 16); assert.equal(s.php.base, 12);
  assert.deepEqual(s.php.tiers, [{ upTo: 20, gains: [[1, 100]] }, { upTo: 60, gains: [[2, 40], [3, 10]] }]); // equal HP merged, no-chance entries dropped, tiers sorted
  assert.deepEqual(s.dodge.tiers, [{ upTo: 10, v: 0.015 }, { upTo: 50, v: 0.07 }]);
  const back = cfgFrom(s); assert.equal(back.php.tiers[1].gains[0][0], 2); assert.equal(levelDodge(30, back), 0.07);
  // a tier with no usable HP amount, or none at all, is refused rather than saved
  await assert.rejects(saveCfg({ php: { tiers: [{ upTo: 10, gains: [[1, 0]] }] } }), /HP amount/);
  await assert.rejects(saveCfg({ php: { tiers: [] } }), /player HP tier/);
  await assert.rejects(saveCfg({ dodge: { tiers: [] } }), /dodge tier/);
  // out-of-range numbers are held to sensible bounds
  const wild = await saveCfg({ dodge: { tiers: [{ upTo: 10, v: 7 }] } });
  assert.equal(wild.dodge.tiers[0].v, 1);
});

test('game balance: a request that leaves player HP and dodge out gets the defaults', async () => {
  const s = await saveCfg({});
  assert.deepEqual(s.php, DEFAULT_CFG.php); assert.deepEqual(s.dodge, DEFAULT_CFG.dodge);
});

test('game balance: configs saved before v1.6 receive the dodge perks once, and a config saved from v1.6 is respected', () => {
  // an old save that already holds perk lists for these jobs (the game balance tab stores every job with a perk)
  const old = cfgFrom({ perks: { scout: { spd: 0.05 }, ranger: { gold: 0.1, xp: 0.1, spd: 0.1 }, assassin: { first: 2, dbl: 0.25, spd: 0.15 }, knight: { dr: 2 } } });
  assert.deepEqual(['scout', 'ranger', 'bowknight', 'assassin'].map((j) => perksOf(j, old).dod || 0), [0.05, 0.1, 0.1, 0.15]);
  assert.equal(old.perks.scout.spd, 0.05); assert.equal(old.perks.knight.dod, undefined);
  // saved by v1.6 (v: 16): a teacher who cleared Assassin's dodge keeps it cleared
  const fresh = cfgFrom({ v: 16, perks: { assassin: { first: 2, dbl: 0.25, spd: 0.15 }, scout: { spd: 0.05, dod: 0.08 } } });
  assert.equal(perksOf('assassin', fresh).dod || 0, 0); assert.equal(perksOf('scout', fresh).dod, 0.08);
  // a pupil's perk list from the table is saved with the dodge column
  assert.ok(Object.keys(DEFAULT_CFG.perks.assassin).includes('dod'));
});

// ---------- monster dodge ----------
import { monsterDodge } from '../src/gamedata.js';

test('monster dodge: 5% for monsters, 10% for mid-bosses and bosses, editable and saved', async () => {
  assert.deepEqual(['slime', 'dragon', 'emperor'].map((m) => monsterDodge(m, cfg)), [0.05, 0.1, 0.1]);
  const c = cfgFrom({ mdodge: { mob: 0.2, boss: '' } });
  assert.deepEqual([c.mdodge.mob, c.mdodge.mid, c.mdodge.boss], [0.2, 0.1, 0.1]);
  const s = await saveCfg({ mdodge: { mob: 0.02, mid: 7, boss: 0 } });
  assert.deepEqual(s.mdodge, { mob: 0.02, mid: 1, boss: 0 });
  assert.deepEqual((await saveCfg({})).mdodge, DEFAULT_CFG.mdodge);
});

test('monster dodge: a dodged attack deals 0, skips crit/stun/leech', () => {
  const t = fight('cleric', 30);
  t.f.p_next = 1e7 - 1000; t.f.m_next = 1e7 + 1e8; t.pl.hp = 10;
  const r = t.run(() => 0); // every chance succeeds: the monster dodges first
  const e = r.ev.find((x) => x.who === 'p');
  assert.equal(e.miss, 1); assert.equal(e.d, 0); assert.equal(t.f.mob_hp, 500); assert.equal(e.st, undefined); assert.equal(e.lc, undefined);
  const hit = fight('cleric', 30); hit.f.p_next = 1e7 - 1000; hit.f.m_next = 1e7 + 1e8;
  const e2 = hit.run(() => 0.99).ev.find((x) => x.who === 'p');
  assert.equal(e2.miss, undefined); assert.ok(e2.d > 0);
});

test('dive: a monster can dodge a pupil’s attack', () => {
  const m = { id: 1, name: 'P1', job: 'villager', level: 5, maxHp: 30, hp: 30, alive: true, atk: 5, def: 0, ip: 15000, g: { gold: 0, xp: 0, heal: 0 }, P: {}, ranged: false,
    potion: null, auto: 0, owned: [], pack: { gold: 0, drops: {} }, pNext: 1000, sk: 0, fs: 0, ca: 0, q: null, potUsed: 0 };
  const S = { status: 'dive', members: [m], mon: { mob: 'slime', level: 5, hp: 500, max: 500, ca: 9, mNext: 1e12 }, log: [] };
  const r = simParty(S, cfg, 1000, () => 0);
  assert.equal(r.ev[0].miss, 1); assert.equal(S.mon.hp, 500); assert.equal(m.pNext, 16000);
});

// ---------- sure hit ----------
import { sureJob, sureMob } from '../src/gamedata.js';

test('sure hit: Sniper by default, nothing else; editable; old configs keep the default', async () => {
  assert.deepEqual([sureJob('sniper', cfg), sureJob('assassin', cfg), sureMob('slime', cfg)], [true, false, false]);
  assert.equal(gear({ level: 40, job: 'sniper' }, cfg).sure, true);
  assert.equal(sureJob('knight', cfgFrom({ sure: { jobs: { knight: true }, mobs: { lichking: true } } })), true);
  assert.equal(sureJob('sniper', cfgFrom({ sure: { jobs: {}, mobs: {} } })), false);
  assert.equal(sureJob('sniper', cfgFrom({ hp: DEFAULT_CFG.hp })), true);
  const s = await saveCfg({ sure: { jobs: { assassin: true, ghost: true, sniper: false }, mobs: { dragon: true, nope: true } } });
  assert.deepEqual(s.sure, { jobs: { assassin: true }, mobs: { dragon: true } });
  assert.deepEqual((await saveCfg({})).sure, { jobs: { sniper: true }, mobs: {} });
});

test('sure hit: a sure-hit pupil ignores monster dodge, a sure-hit monster ignores pupil dodge (solo)', () => {
  const sure = cfgFrom({ sure: { jobs: { cleric: true }, mobs: { goblin: true } } });
  const swing = (job, c) => { const t = fight(job, 30); t.f.p_next = 1e7 - 1000; t.f.m_next = 1e7 + 1e8; return t.run(() => 0, c).ev.find((e) => e.who === 'p'); };
  assert.equal(swing('cleric', cfg).miss, 1); // dodged without sure hit
  const e = swing('cleric', sure); assert.equal(e.miss, undefined); assert.ok(e.d > 0);
  const t = fight('assassin', 80); // goblin attacks, every chance succeeds
  assert.equal(t.run(() => 0, cfg).ev.find((x) => x.who === 'm').dod, 1);
  const u = fight('assassin', 80); const h = u.run(() => 0, sure).ev.find((x) => x.who === 'm');
  assert.equal(h.dod, undefined); assert.ok(h.d > 0 || h.par);
});

test('sure hit: in Dungeon Dive too', () => {
  const sure = cfgFrom({ sure: { jobs: {}, mobs: { slime: true } }, mdodge: { mob: 1, mid: 1, boss: 1 } });
  const mk = (o) => ({ id: 1, name: 'P1', job: 'villager', level: 5, maxHp: 30, hp: 30, alive: true, atk: 5, def: 0, ip: 15000, g: { gold: 0, xp: 0, heal: 0 }, P: {}, ranged: false, dod: 1,
    potion: null, auto: 0, owned: [], pack: { gold: 0, drops: {} }, pNext: 1e12, sk: 0, fs: 0, ca: 0, q: null, potUsed: 0, ...o });
  const run = (m, c, mob = 'slime') => simParty({ status: 'dive', members: [m], mon: { mob, level: 5, hp: 500, max: 500, ca: 9, mNext: 1000 }, log: [] }, c, 1000, () => 0).ev.find((e) => e.w === 'm');
  assert.equal(run(mk(), cfg).dod, 1);
  assert.equal(run(mk(), sure).dod, undefined); // slime is sure-hit
  const p = { status: 'dive', members: [mk({ pNext: 1000, sure: true })], mon: { mob: 'slime', level: 5, hp: 500, max: 500, ca: 9, mNext: 1e12 }, log: [] };
  assert.ok(simParty(p, sure, 1000, () => 0).ev[0].miss === undefined);
  p.members[0].sure = false; p.members[0].pNext = 1000;
  assert.equal(simParty(p, sure, 1000, () => 0).ev[0].miss, 1);
});
