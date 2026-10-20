// Pupil stats editor: listing, validation and edits, on a real SQLite database (node:sqlite) loaded from the schema files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as sa from '../src/players.js';
import { cfgFrom } from '../src/gamedata.js';

function d1(db) {
  const wrap = (sql) => {
    const st = db.prepare(sql);
    let args = [];
    const o = { bind: (...a) => ((args = a), o), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => (st.run(...args), { success: true }) };
    return o;
  };
  return { prepare: wrap, batch: async (l) => { for (const s of l) await s.run(); } };
}
function freshEnv(extra = {}) {
  const db = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'game-schema.sql']) db.exec(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
  db.exec("INSERT INTO classes (id, name, code, created_at) VALUES (1, '5A', 'ABC234', 0), (2, '5B', 'DEF567', 0)");
  db.exec("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at) VALUES (1, 1, 'Mei Lin', 'mei', 0, 0), (2, 2, 'Sam', 'sam', 0, 0), (3, NULL, 'guest_0001', 'guest_0001', 1, 0)");
  return { db, env: { DB: d1(db), ...extra } };
}
const req = (method, body) => new Request('https://x/api/t/players', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const call = (env, method, path, body) => { const u = new URL('https://x/api/t/players' + path); return sa.route(req(method, body), env, u, u.pathname.replace('/api/t', ''), method, { admin: true }).then((r) => r.json()); };
const fails = async (p, re) => assert.rejects(p, (e) => e.status && re.test(e.message));

test('lists every pupil, with defaults for pupils who have not played, and filters by class and name', async () => {
  const { env, db } = freshEnv();
  db.exec("INSERT INTO g_player (pupil_id, level, xp, gold, job, jobs, floor_kills) VALUES (1, 12, 4, 250, 'adventurer', '[\"villager\",\"adventurer\"]', '{\"1\":5,\"n1\":5,\"2\":5,\"n2\":5,\"3\":1,\"n3\":5}')");
  const all = await call(env, 'GET', '');
  assert.equal(all.pupils.length, 3);
  const mei = all.pupils.find((p) => p.id === 1);
  assert.deepEqual([mei.level, mei.gold, mei.jobName, mei.floors, mei.jobs, mei.started], [12, 250, 'Adventurer', 2, 2, true]);
  const sam = all.pupils.find((p) => p.id === 2);
  assert.deepEqual([sam.level, sam.job, sam.started, sam.maxHp], [1, 'villager', false, 10]);
  assert.equal((await call(env, 'GET', '?class=2')).pupils.length, 1);
  assert.equal((await call(env, 'GET', '?class=guests')).pupils[0].name, 'guest_0001');
  assert.equal((await call(env, 'GET', '?q=MEI')).pupils.length, 1);
  assert.equal((await call(env, 'GET', "?q=%25")).pupils.length, 3); // wildcards are stripped, not obeyed
});

test('editing changes the stats, creates the game row if needed, and ends any fight in progress', async () => {
  const { env, db } = freshEnv();
  db.exec("INSERT INTO g_fight (pupil_id, mob, level, mob_hp, mob_max, floor, last_tick, qid) VALUES (2, 'slime', 1, 5, 5, 1, 0, 1)");
  const d = await call(env, 'PUT', '/2', { level: 40, xp: 7, gold: 9999, job: 'adventurer', jobs: ['novice', 'adventurer'], floors: 30, shop: 3, hp: 999, weapon: 'sword', potion: 'potion', inv: { potion: 5 } });
  assert.equal(d.player.level, 40);
  assert.equal(d.player.gold, 9999);
  assert.equal(d.player.job, 'adventurer');
  assert.deepEqual(d.player.jobs.sort(), ['adventurer', 'novice', 'villager']);
  assert.equal(d.player.floors, 30);
  assert.equal(d.player.shop, 3);
  assert.equal(d.player.hp, d.player.maxHp); // clamped to max HP
  assert.equal(d.player.weapon, 'sword');
  assert.equal(d.inv.sword, 1); // equipping something not owned grants it
  assert.equal(d.inv.potion, 5);
  assert.equal(d.inFight, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM g_fight WHERE pupil_id = 2').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM g_player WHERE pupil_id = 1').get().n, 0); // other pupils untouched
});

test('bad edits are refused and change nothing', async () => {
  const { env, db } = freshEnv();
  await call(env, 'PUT', '/1', { level: 5, gold: 50 });
  const before = JSON.stringify(db.prepare('SELECT * FROM g_player WHERE pupil_id = 1').get());
  await fails(call(env, 'PUT', '/1', { level: 0 }), /Level must be/);
  await fails(call(env, 'PUT', '/1', { level: 'ten' }), /Level must be/);
  await fails(call(env, 'PUT', '/1', { gold: -5 }), /Gold must be/);
  await fails(call(env, 'PUT', '/1', { gold: 1.5 }), /Gold must be/);
  await fails(call(env, 'PUT', '/1', { xp: 50 }), /XP must be below/);
  await fails(call(env, 'PUT', '/1', { job: 'wizard', jobs: ['villager', 'wizard'] }), /Unknown job/);
  await fails(call(env, 'PUT', '/1', { job: 'swordsman', jobs: ['swordsman'] }), /needs Soldier/);
  await fails(call(env, 'PUT', '/1', { job: 'fighter', jobs: ['villager'] }), /Unknown|active job/);
  await fails(call(env, 'PUT', '/1', { weapon: 'potion' }), /does not fit/);
  await fails(call(env, 'PUT', '/1', { weapon: 'axe' }), /can't be used/);
  await fails(call(env, 'PUT', '/1', { inv: { nothing: 1 } }), /Unknown item/);
  await fails(call(env, 'PUT', '/1', { inv: { potion: 500 } }), /quantity must be/);
  await fails(call(env, 'PUT', '/1', { floors: 101 }), /Floors cleared/);
  await fails(call(env, 'PUT', '/99', { level: 2 }), /(No such|not found)/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM g_player WHERE pupil_id = 1').get()), before);
});

test('floors: set cleared through N keeps other keys and the story record; floorsCleared reads it back', () => {
  const cfg = cfgFrom(null);
  const fk = { 1: 2, n1: 5, 9: 3, n9: 6, m9: 1, sl: 2, sty: ['p0'], ca: 1 };
  sa.applyFloorsCleared(fk, 3, cfg);
  assert.equal(sa.floorsCleared(fk), 3);
  assert.equal(fk[1], 5); assert.equal(fk.n2, 5);
  assert.equal(fk[9], undefined); assert.equal(fk.n9, undefined); assert.equal(fk.m9, undefined);
  assert.deepEqual([fk.sl, fk.sty, fk.ca], [2, ['p0'], 1]);
  sa.applyFloorsCleared(fk, 0, cfg);
  assert.equal(sa.floorsCleared(fk), 0);
  sa.applyFloorsCleared(fk, 100, cfg);
  assert.equal(sa.floorsCleared(fk), 100);
});

test('story progress can be reset, and a pupil can be reset to a fresh start', async () => {
  const { env, db } = freshEnv();
  await call(env, 'PUT', '/1', { level: 30, floors: 10 });
  db.exec("UPDATE g_player SET floor_kills = json_set(floor_kills, '$.sty', json('[\"p0\",\"c1\"]')) WHERE pupil_id = 1");
  assert.equal((await call(env, 'GET', '/1')).player.storySeen, 2);
  const d = await call(env, 'PUT', '/1', { resetStory: true });
  assert.equal(d.player.storySeen, 0);
  assert.equal(d.player.floors, 10);
  await call(env, 'PUT', '/1', { inv: { potion: 2 } });
  assert.deepEqual(await call(env, 'POST', '/1/reset'), { ok: true });
  const after = await call(env, 'GET', '/1');
  assert.deepEqual([after.player.level, after.player.gold, after.player.floors, Object.keys(after.inv).length], [1, 0, 0, 0]);
});

test('unknown paths and methods are 404', async () => {
  const { env } = freshEnv();
  await fails(call(env, 'DELETE', '/1'), /Not found/);
  await fails(call(env, 'GET', '/nope'), /Not found/);
});
