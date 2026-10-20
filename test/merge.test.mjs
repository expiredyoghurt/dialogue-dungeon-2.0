// v1.7: the question-skills branch and the HP / dodge / sure-hit branch (both "v1.6") work together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cfgFrom, DEFAULT_CFG } from '../src/gamedata.js';
import { SKILLS } from '../src/skills.js';
import * as game from '../src/game.js';

const file = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function d1(db) {
  const wrap = (sql) => { const st = db.prepare(sql); let a = []; const o = { bind: (...x) => ((a = x), o), first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => (st.run(...a), { success: true }) }; return o; };
  return { prepare: wrap, batch: async (l) => { for (const s of l) await s.run(); } };
}
function freshEnv() {
  const db = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'game-schema.sql', 'questions-450.sql', 'seed-skills.sql', 'seed-skills-extra.sql']) db.exec(file(f));
  db.exec("INSERT INTO classes (id, name, code, created_at) VALUES (1, '5A', 'ABC234', 0)");
  db.exec("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at) VALUES (1, 1, 'Mei Lin', 'mei', 0, 0)");
  return { db, env: { DB: d1(db) } };
}
const P1 = { id: 1, name: 'Mei Lin', classId: 1, guest: false, className: '5A' };
const call = async (env, action, body = {}) => (await game.route(new Request('https://x/api/game/' + action, { method: action === 'state' ? 'GET' : 'POST', body: action === 'state' ? undefined : JSON.stringify(body) }), env, P1, '/api/game/' + action, action === 'state' ? 'GET' : 'POST')).json();

test('the default config carries both features', () => {
  const c = cfgFrom(null);
  assert.ok(c.php && c.dodge && c.mdodge && c.sure && c.sure.jobs.sniper, 'HP, dodge and sure hit');
  assert.deepEqual(Object.keys(c.skills), Object.keys(SKILLS), 'question skills');
  assert.ok(DEFAULT_CFG.skills && DEFAULT_CFG.sure);
});
test('configs saved by either branch load with the other branch’s defaults', () => {
  // saved by the sure-hit build: no skills
  const a = cfgFrom({ v: 16, perks: { scout: { spd: 0.05, dod: 0.05 } }, sure: { jobs: {}, mobs: {} }, dodge: { tiers: [{ upTo: 100, v: 0.2 }] }, mdodge: { mob: 0.3 } });
  assert.equal(a.dodge.tiers[0].v, 0.2);
  assert.equal(a.mdodge.mob, 0.3);
  assert.deepEqual(a.sure.jobs, {});
  assert.equal(a.skills.reported.share, 35);
  // saved by the skills build: no dodge, no player HP, no `v`
  const b = cfgFrom({ skills: { tense_fix: { share: 60 } }, perks: { scout: { spd: 0.05 } } });
  assert.equal(b.skills.tense_fix.share, 60);
  assert.equal(b.perks.scout.dod, 0.05, 'old configs still receive the dodge perks once');
  assert.equal(b.sure.jobs.sniper, true);
  assert.equal(b.php.base, 10);
});
test('configSave keeps question skills, dodge, sure hit and player HP together', async () => {
  const { env, db } = freshEnv();
  const v0 = await (await game.configView(env)).json();
  assert.ok(v0.skillDefs && v0.playerPreview, 'the view sends both the skill definitions and the player HP preview');
  const body = { ...v0.cfg, skills: { ...v0.cfg.skills, reported: { on: false, share: 50, min: 40, max: 55 } }, sure: { jobs: { sniper: true, scout: true }, mobs: {} }, mdodge: { mob: 0.2, mid: 0.2, boss: 0.2 } };
  await game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify(body) }), env);
  const c = (await (await game.configView(env)).json()).cfg;
  assert.ok(db.prepare('SELECT v FROM g_config').all().some((r) => JSON.parse(r.v).v === 16), 'saved with the v16 marker, so the dodge perks are not added again');
  assert.deepEqual(c.skills.reported, { on: false, share: 50, min: 40, max: 55 });
  assert.deepEqual(c.sure.jobs, { scout: true, sniper: true });
  assert.equal(c.mdodge.mob, 0.2);
  assert.ok(c.php.tiers.length && c.dodge.tiers.length);
  assert.equal(c.skills.verb_choice.on, true);
});
test('a fight on a skill floor has dodge stats and a skill-safe question payload', async () => {
  const { env, db } = freshEnv();
  const fk = {};
  for (let f = 1; f < 15; f++) { fk[f] = 5; fk['n' + f] = 5; }
  db.prepare('INSERT OR REPLACE INTO g_player (pupil_id, floor_kills) VALUES (1, ?)').run(JSON.stringify(fk));
  const v = await call(env, 'start', { floor: 15 });
  assert.equal(typeof v.me.cs.dod, 'number');
  assert.equal(typeof v.me.sure, 'boolean');
  assert.ok(v.fight.q.p);
  for (const k of ['correct', 'accepted', 'wrong', 'fixes', 'explanation', 'traps']) assert.ok(!(k in v.fight.q.p), k);
});
