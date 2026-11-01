// v2.2.1: reading the game state never banks the pack, heals or resets floors; only an explicit leave does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as game from '../src/game.js';
import { JOBS, mhOf, cfgFrom } from '../src/gamedata.js';

const file = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function d1(db) {
  const wrap = (sql) => { const st = db.prepare(sql); let a = []; const o = { bind: (...x) => ((a = x), o), first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => (st.run(...a), { success: true }) }; return o; };
  return { prepare: wrap, batch: async (l) => { for (const s of l) await s.run(); } };
}
function freshEnv({ base = true } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'game-schema.sql']) db.exec(file(f));
  if (base) db.exec(file('questions-450.sql'));
  db.exec(file('seed-skills.sql'));
  db.exec(file('seed-skills-extra.sql'));
  db.exec("INSERT INTO classes (id, name, code, created_at) VALUES (1, '5A', 'ABC234', 0)");
  db.exec("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at) VALUES (1, 1, 'Mei Lin', 'mei', 0, 0), (2, 1, 'Sam', 'sam', 0, 0), (3, 1, 'Tay', 'tay', 0, 0)");
  return { db, env: { DB: d1(db) } };
}
const P1 = { id: 1, name: 'Mei Lin', classId: 1, guest: false, className: '5A' };
const call = async (env, action, body = {}) => (await game.route(new Request('https://x/api/game/' + action, { method: action === 'state' ? 'GET' : 'POST', body: action === 'state' ? undefined : JSON.stringify(body) }), env, P1, '/api/game/' + action, action === 'state' ? 'GET' : 'POST')).json();
const row = (db) => db.prepare('SELECT * FROM g_player WHERE pupil_id = 1').get();

test('state is read-only: a reload does not bank the pack, heal or reset a floor', async () => {
  const { db, env } = freshEnv();
  await call(env, 'state'); // creates the player
  const fk = JSON.stringify({ 1: 5, n1: 5, 2: 2, n2: 6 });
  db.prepare('UPDATE g_player SET run_gold = 12, gold = 3, hp = 4, floor_kills = ? WHERE pupil_id = 1').run(fk);
  const s = await call(env, 'state');
  assert.equal(s.me.runGold, 12);
  assert.equal(s.me.gold, 3);
  const a = row(db);
  assert.equal(a.run_gold, 12);
  assert.equal(a.gold, 3);
  assert.equal(a.hp, 4);
  assert.equal(a.floor_kills, fk);
});

test('an explicit leave still banks the pack and heals', async () => {
  const { db, env } = freshEnv();
  await call(env, 'state');
  db.prepare('UPDATE g_player SET run_gold = 12, gold = 3, hp = 4 WHERE pupil_id = 1').run();
  const s = await call(env, 'leave');
  assert.equal(s.me.gold, 15);
  assert.equal(s.me.runGold, 0);
  const a = row(db);
  assert.equal(a.run_gold, 0);
  assert.equal(a.hp, mhOf(a, cfgFrom(null)));
});
