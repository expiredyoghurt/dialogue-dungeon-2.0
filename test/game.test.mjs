import test from 'node:test';
import assert from 'node:assert/strict';
import { resetFloors, gentle } from '../src/game.js';
import { cfgFrom, DEFAULT_CFG } from '../src/gamedata.js';

const pl = (fk, level = 12) => ({ level, floor_kills: JSON.stringify(fk) });
const fk = (p) => JSON.parse(p.floor_kills);

test('respawn is off by default and survives a saved config that predates it', () => {
  assert.equal(DEFAULT_CFG.respawn, false);
  assert.equal(cfgFrom(null).respawn, false);
  assert.equal(cfgFrom({ hp: DEFAULT_CFG.hp }).respawn, false);
  assert.equal(cfgFrom({ respawn: true }).respawn, true);
});

test('resetFloors wipes the kills of an unfinished floor but keeps its monster count', () => {
  const p = pl({ 1: 5, n1: 5, 2: 5, n2: 5, 3: 3, n3: 6, m3: 2, sl: 2 });
  assert.equal(resetFloors(p), 1);
  const f = fk(p);
  assert.equal(f[3], 0);
  assert.equal(f.n3, 6); // same 6 monsters next time, no re-rolling
  assert.equal(f.m3, undefined);
  assert.equal(f[1], 5); assert.equal(f[2], 5); // cleared floors stay cleared
  assert.equal(f.sl, 2); // shop level untouched
});

test('resetFloors leaves cleared, farmed and untouched floors alone', () => {
  const p = pl({ 1: 7, n1: 5, 2: 0, n2: 5, n3: 6 });
  const before = p.floor_kills;
  assert.equal(resetFloors(p), 0);
  assert.equal(p.floor_kills, before);
});

test('resetFloors handles an empty record', () => {
  assert.equal(resetFloors({ level: 1, floor_kills: '{}' }), 0);
  assert.equal(resetFloors({ level: 1 }), 0);
});

test('gentle start only applies below the set level and can be switched off', () => {
  const c = cfgFrom(null);
  assert.equal(gentle({ level: 1 }, c), true);
  assert.equal(gentle({ level: 9 }, c), true);
  assert.equal(gentle({ level: 10 }, c), false);
  c.start.levels = 0;
  assert.equal(gentle({ level: 1 }, c), false);
});

test('a saved config without a start block still gets the gentle-start defaults', () => {
  const c = cfgFrom({ hp: DEFAULT_CFG.hp });
  assert.deepEqual(c.start, DEFAULT_CFG.start);
  assert.equal(cfgFrom({ start: { gold: 4 } }).start.gold, 4);
  assert.equal(cfgFrom({ start: { gold: 4 } }).start.xp, DEFAULT_CFG.start.xp);
});

import { sim, mustFor } from '../src/game.js';

test('answer strike N and the kill requirements have defaults a saved config still gets', () => {
  const c = cfgFrom({ hp: DEFAULT_CFG.hp });
  assert.equal(c.strike, 3);
  assert.deepEqual(c.must, { mob: 1, mid: 3, boss: 5 });
  assert.equal(cfgFrom({ strike: 4 }).strike, 4);
  assert.equal(cfgFrom({ must: { boss: 8 } }).must.boss, 8);
  assert.equal(cfgFrom({ must: { boss: 8 } }).must.mid, 3);
  assert.equal(mustFor('slime', c), 1); assert.equal(mustFor('dragon', c), 3); assert.equal(mustFor('emperor', c), 5);
});

const basicHit = (ca, mob) => {
  const c = cfgFrom({ mdodge: { mob: 0, mid: 0, boss: 0 } }), now = 1e7; // no monster dodge: this test is about the answers rule, not luck
  const p = { level: 20, hp: 30, job: 'villager', floor_kills: JSON.stringify({ ca }), weapon: null, armor: null, acc: null, potion: null, auto: 0 };
  const f = { mob, level: 1, mob_hp: 1, mob_max: 5, p_next: now - 1000, m_next: now + 1e9 };
  return { r: sim(p, f, c, { qty: 0, heal: 0, used: 0 }, now), f };
};

test('basic attacks cannot finish a monster until enough answers are correct', () => {
  assert.equal(basicHit(0, 'slime').r.res, null);
  assert.equal(basicHit(0, 'slime').f.mob_hp, 1);
  assert.equal(basicHit(1, 'slime').r.res, 'win');
  assert.equal(basicHit(2, 'dragon').r.res, null);
  assert.equal(basicHit(3, 'dragon').r.res, 'win');
  assert.equal(basicHit(4, 'emperor').r.res, null);
  assert.equal(basicHit(5, 'emperor').r.res, 'win');
});

test('the job tree is revealed one step at a time', async () => {
  const { visibleJobs } = await import('../src/game.js');
  const { JOBS } = await import('../src/gamedata.js');
  const cfg = cfgFrom(null);
  const ids = (owned) => Object.keys(visibleJobs(owned, cfg).jobTree).sort();
  assert.deepEqual(ids(['villager']), ['novice', 'villager']);
  assert.deepEqual(ids(['villager', 'novice']), ['adventurer', 'novice', 'villager']);
  assert.deepEqual(ids(['villager', 'novice', 'adventurer']), ['adventurer', 'initiate', 'novice', 'scout', 'squire', 'villager']);
  const sw = visibleJobs(['villager', 'novice', 'adventurer', 'squire', 'fighter', 'soldier', 'swordsman'], cfg);
  assert.ok(sw.jobTree.knight && sw.jobTree.swordmaster && sw.jobTree.brawler);
  assert.ok(!sw.jobTree.paladin && !sw.jobTree.assassin && !sw.jobTree.berserker && !sw.jobTree.marksman && !sw.jobTree.adept);
  assert.ok(Object.keys(sw.jobPerks).every((k) => sw.jobTree[k]));
  assert.equal(visibleJobs(['villager'], cfg).moreJobs, true);
  assert.equal(visibleJobs(Object.keys(JOBS), cfg).moreJobs, false);
});
