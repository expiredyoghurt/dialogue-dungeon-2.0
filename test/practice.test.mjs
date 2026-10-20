// v1.8: graded wrong-answer feedback, deliberate practice (the Guild Training Grounds) and the teacher's class diagnosis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { checkMode1, spotCount, markPieces, tokenize } from '../src/engine.js';
import { CODES, RULES } from '../src/rules.js';
import { EXAMPLES, gradeErrors, buildFeedback, progress, levelFor } from '../src/hints.js';
import { cfgFrom } from '../src/gamedata.js';
import * as pupil from '../src/pupil.js';
import * as game from '../src/game.js';
import * as P from '../src/practice.js';
import { teacherRoute } from '../src/teacher.js';
import { CORE, EXTRA } from '../scripts/seed-skills.mjs';
import { prepareEntry, tokenIndex } from '../scripts/seed-skills-lib.mjs';

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
const req = (body) => new Request('https://x/api', { method: 'POST', body: JSON.stringify(body) });
const ans = async (env, body, p = P1) => (await pupil.answer(req(body), env, p)).json();
const pans = async (env, body, p = P1) => (await P.practiceAnswer(req(body), env, p)).json();
const start = async (env, rule, p = P1) => (await P.practiceStart(req({ rule }), env, p)).json();
const pmap = async (env, p = P1) => (await P.practiceMap(env, p)).json();
const row = (db, seed) => db.prepare("SELECT id, mode, skill, rules, data FROM questions WHERE json_extract(data, '$.seed') = ?").get(seed);
const dataOf = (r) => JSON.parse(r.data);

// the right answer to any question (as request body)
function solve(q) {
  const d = typeof q.data === 'string' ? JSON.parse(q.data) : q.data;
  if (q.mode === 1) return { answer: d.correct };
  if (q.mode === 4) return { picked: d.correct.slice(0, d.pick || 1) };
  if (q.mode === 5) return { answer: d.accepted[0].replace(/[()]/g, '') };
  if (q.mode === 6) return { tapped: tokenIndex(d), fix: d.fixes[0] };
  throw new Error('no solver for mode ' + q.mode);
}
function wrongBody(q) {
  const d = typeof q.data === 'string' ? JSON.parse(q.data) : q.data;
  if (q.mode === 4) return { picked: d.options.filter((o) => !d.correct.includes(o.id)).map((o) => o.id).slice(0, d.pick || 1) };
  if (q.mode === 6) return { tapped: 0, fix: 'zzz' };
  return { answer: 'nothing like it' };
}
const setPlayer = (db, id, fields) => {
  db.prepare('INSERT OR IGNORE INTO g_player (pupil_id) VALUES (?)').run(id);
  for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE g_player SET ${k} = ? WHERE pupil_id = ?`).run(v, id);
};
const clearedTo = (n) => { const fk = {}; for (let f = 1; f <= n; f++) { fk[f] = 5; fk['n' + f] = 5; } return JSON.stringify(fk); };

// ---------------------------------------------------------------- wrong-answer feedback
const K = { correct: '“I am tired,” said Raj. “Let’s go.”', prompt: 'I am tired said Raj lets go' };
test('engine: the pupil’s answer comes back with the trouble spots marked', () => {
  const r = checkMode1(K, '“I am tired” said Raj. “let’s go.”');
  assert.equal(r.correct, false);
  assert.equal(r.aligned, true);
  const bad = r.pieces.filter((x) => x.bad).map((x) => x.t);
  assert.deepEqual(bad, ['” ', 'let’s'], 'the gap with the missing comma and the word that needs a capital');
  assert.equal(r.pieces.map((x) => x.t).join(''), '“I am tired” said Raj. “let’s go.”', 'nothing is lost: the pieces rebuild the answer as typed');
  const r2 = checkMode1({ correct: 'Raj said, hello.' }, 'Raj said hello.');
  assert.ok(r2.pieces.some((x) => x.ghost), 'a missing mark between two words is shown as a ghost marker');
  const r3 = checkMode1({ correct: 'Raj said, “Hi.”' }, 'Raj said “Hi.”');
  assert.ok(r3.pieces.some((x) => x.bad && x.t.includes('“')), 'when the gap has other marks in it, the whole gap is highlighted');
  assert.equal(checkMode1(K, 'something else').pieces, null, 'changed words: nothing to mark');
  assert.equal(checkMode1(K, K.correct).pieces, undefined);
  assert.equal(spotCount(K) > 3, true);
  assert.equal(markPieces('a b', tokenize('a b'), []).map((x) => x.t).join(''), 'a b');
});
test('engine: single-quote speech marks fall back to the checked text', () => {
  const r = checkMode1({ correct: 'Raj said, “Hi.”' }, "Raj said 'Hi.'");
  assert.ok(r.pieces === null || r.pieces.map((x) => x.t).join('').length > 0);
});
test('hints: the ladder gives away more on each try, and the last try gives everything', () => {
  const errors = checkMode1(K, '“I am tired” said Raj. “let’s go.”').errors;
  const l1 = gradeErrors(errors, 1), l2 = gradeErrors(errors, 2), l3 = gradeErrors(errors, 3);
  assert.ok(l1.every((e) => e.what === undefined && e.fix === undefined && e.rule > 0));
  assert.ok(l2.every((e) => e.what && e.fix === undefined));
  assert.ok(l3.every((e) => e.what && e.fix));
  assert.ok(l1.every((e) => e.expected === undefined && e.got === undefined), 'the expected text is never sent early');
  assert.equal(levelFor(1, false), 1); assert.equal(levelFor(2, false), 2); assert.equal(levelFor(2, true), 3); assert.equal(levelFor(9, false), 3);
  const cw = gradeErrors(checkMode1(K, 'something else').errors, 1);
  assert.ok(cw[0].what, 'changed words are always explained');
});
test('hints: progress, example and next step', () => {
  assert.equal(progress(9, 2).text, 'You fixed 7 of 9 spots. 2 to go.');
  assert.equal(progress(2, 2).text, '2 spots still need fixing.');
  assert.equal(progress(3, 1).fixed, 2);
  assert.equal(progress(3, 0), null);
  assert.equal(progress(0, 2), null);
  const errors = checkMode1(K, '“I am tired” said Raj. “let’s go.”').errors;
  const f1 = buildFeedback({ errors, tryNo: 1, final: false });
  assert.equal(f1.example, undefined, 'no example on the first try');
  const f2 = buildFeedback({ errors, tryNo: 2, final: false });
  assert.ok(f2.example && f2.example.bad && f2.example.good && f2.example.rule > 0);
  assert.equal(f2.next, undefined);
  const f3 = buildFeedback({ errors, tryNo: 3, final: true });
  assert.ok(f3.next && f3.next.rule > 0 && f3.next.name);
  assert.deepEqual(f3.rules.sort(), [...new Set(errors.map((e) => e.rule))].sort());
});
test('hints: every kind of mistake a pupil can make has a right-versus-wrong example', () => {
  const skip = new Set(['CHANGED_WORDS', 'APOSTROPHE_NONE', 'RS_FORM', 'DS_FORM', 'MC_INFER', 'VERB_PENDING', 'VERB_INVALID']);
  for (const [code, c] of Object.entries(CODES)) {
    if (skip.has(code) || c.rule === 0 || c.hidden) continue;
    const ex = EXAMPLES[code];
    assert.ok(ex && ex.bad && ex.good && ex.bad !== ex.good, code);
  }
  assert.ok(!Object.keys(EXAMPLES).some((c) => !CODES[c]), 'no example for an unknown code');
});
test('answering: the first wrong try marks the spots without the fix; the second explains; the last shows everything', async () => {
  const { env, db } = freshEnv({ base: false });
  const q = row(db, 'sk-core-1a');
  const wrong = '“Did you tell Mei the bridge is closed?” asked Raj. “No I never said that,” replied Tally.';
  const r1 = await ans(env, { qid: q.id, answer: wrong, tryNo: 1 });
  assert.equal(r1.correct, false);
  assert.equal(r1.feedback.level, 1);
  assert.ok(r1.feedback.pieces.some((x) => x.bad), 'the spots are marked in the pupil’s own answer');
  assert.ok(r1.feedback.progress && /spots? /.test(r1.feedback.progress.text));
  assert.ok(r1.errors.length >= 2 && r1.errors.every((e) => e.what === undefined && e.fix === undefined));
  assert.equal(r1.feedback.example, undefined);
  assert.equal(r1.reveal, undefined);
  assert.ok(!JSON.stringify(r1).includes('Press Enter'), 'no fix text leaks in the first response');
  const r2 = await ans(env, { qid: q.id, answer: wrong, tryNo: 2 });
  assert.equal(r2.feedback.level, 2);
  assert.ok(r2.errors.every((e) => e.what && e.fix === undefined));
  assert.ok(r2.feedback.example);
  const r3 = await ans(env, { qid: q.id, answer: wrong, tryNo: 3 });
  assert.equal(r3.final, true);
  assert.ok(r3.errors.every((e) => e.what && e.fix));
  assert.ok(r3.reveal && r3.feedback.next);
});
test('answering: Modes 4, 5 and 6 get the same graded feedback', async () => {
  const { env, db } = freshEnv({ base: false });
  const f = row(db, 'sk-core-4b');
  const r = await ans(env, { qid: f.id, answer: 'Wren said to Quip, “She would ring the bell the next day.”', tryNo: 1 });
  assert.equal(r.feedback.level, 1);
  assert.ok(r.errors.every((e) => e.what === undefined));
  assert.ok(r.feedback.rules.includes(11));
  const m4 = row(db, 'sk-core-2a');
  const a = await ans(env, { qid: m4.id, picked: [dataOf(m4).options.find((o) => !dataOf(m4).correct.includes(o.id)).id] });
  assert.ok(a.feedback && a.feedback.rules.includes(7));
  const t = row(db, 'sk-core-4c');
  const w = await ans(env, { qid: t.id, tapped: 0, fix: 'saw' });
  assert.equal(w.feedback.level, 1);
  assert.equal(w.tapOk, false);
});
test('a correct answer carries no feedback block', async () => {
  const { env, db } = freshEnv({ base: false });
  const q = row(db, 'sk-core-1b');
  const r = await ans(env, { qid: q.id, ...solve(q), tryNo: 1 });
  assert.equal(r.correct, true);
  assert.equal(r.feedback, undefined);
  assert.deepEqual(r.errors, []);
});

// ---------------------------------------------------------------- which rules a question exercises
test('rulesOf: what each kind of question practises', () => {
  const rs = (seed) => { const e = [...CORE, ...EXTRA].find((x) => x.seed === seed); const { data } = prepareEntry(e); return P.rulesOf(e.mode, data, e.skill); };
  assert.ok(rs('sk-core-1a').includes(8));
  assert.ok(rs('sk-core-1b').includes(9));
  assert.deepEqual(rs('sk-core-2a'), [7]);
  assert.deepEqual(rs('sk-core-4a'), [10]);
  assert.deepEqual(rs('sk-core-4b'), [11]);
  assert.deepEqual(rs('sk-core-4c'), [12]);
  assert.deepEqual(rs('sk-core-7a'), [13]);
  assert.deepEqual(P.rulesOf(3, { speaker: 'Raj', line: 'x,' }, null), [7]);
  const m1 = P.rulesOf(1, { correct: 'Raj said, “I am tired.” “Let’s go,” he added.', prompt: 'Raj said I am tired lets go he added' }, null);
  assert.ok(m1.includes(1) && m1.includes(4) && m1.every((n) => n >= 1 && n <= 13));
  const m2 = P.rulesOf(2, { correct: 'Raj said, “Hi.”', faulty: 'Raj said Hi' }, null);
  assert.ok(m2.length >= 1);
  assert.deepEqual(P.rulesFromMask(P.maskOf([1, 4, 13])), [1, 4, 13]);
  assert.equal(P.hasRule(null, 3), false);
  assert.equal(P.maskOf([]), 0);
});
test('scanRules works out every question’s rules, a bounded batch at a time', async () => {
  const { env, db } = freshEnv();
  const total = db.prepare('SELECT COUNT(*) n FROM questions').get().n;
  const before = db.prepare('SELECT COUNT(*) n FROM questions WHERE rules IS NULL').get().n;
  assert.ok(before >= 450, 'older questions start unscanned');
  const a = await P.scanRules(env, 100);
  assert.equal(a.scanned, 100);
  assert.equal(a.remaining, before - 100);
  let r;
  do { r = await P.scanRules(env, 200); } while (r.remaining > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE rules IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, total, 'scanning never adds or removes questions');
  assert.deepEqual((await P.scanRules(env, 10)).scanned, 0);
  // the seeds were stored with their rules already
  assert.equal(P.hasRule(row(db, 'sk-core-4c').rules, 12), true);
});
test('teacher: new and edited questions get their rules stored', async () => {
  const { env, db } = freshEnv({ base: false });
  const tcall = async (method, path, body) => { const url = new URL('https://x/api/t' + path); const r = await teacherRoute(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, url, { admin: true }); return r.json(); };
  const c = await tcall('POST', '/questions', { mode: 6, skill: 'tense_fix', data: { sentence: 'Raj opened the gate and walks in.', wrong: ['walks'], fixes: ['walked'] } });
  assert.deepEqual(P.rulesFromMask(db.prepare('SELECT rules FROM questions WHERE id = ?').get(c.id).rules), [12]);
  const m1 = await tcall('POST', '/questions', { mode: 1, data: { correct: 'Raj said, “I am tired.”' } });
  assert.ok(P.hasRule(db.prepare('SELECT rules FROM questions WHERE id = ?').get(m1.id).rules, 1));
  await tcall('PUT', '/questions/' + c.id, { data: { sentence: 'Raj opened the gate and walks in.', wrong: ['walks'], fixes: ['walked'] }, skill: 'tense_fix' });
  assert.deepEqual(P.rulesFromMask(db.prepare('SELECT rules FROM questions WHERE id = ?').get(c.id).rules), [12]);
});

// ---------------------------------------------------------------- mastery
test('levelOf: not started, learning, getting there, secure', () => {
  assert.equal(P.levelOf([]).level, 'new');
  assert.equal(P.levelOf([true, true]).level, 'learning', 'too few tries to say more');
  assert.equal(P.levelOf([true, true, false]).level, 'developing');
  assert.equal(P.levelOf([true, false, false, true]).level, 'learning');
  assert.equal(P.levelOf([true, true, true, true, true]).level, 'secure');
  assert.equal(P.levelOf([true, true, true, true, false]).level, 'developing');
  assert.equal(P.levelOf([false, false, false, false, false, true, true, true, true, true, true, true, true]).level, 'secure', 'only the last 8 count');
  assert.deepEqual(P.levelOf([true, false, true, true]), { level: 'developing', n: 4, ok: 3, rate: 0.75 });
});
test('resultsByRule: right first time means no mistake of that rule; giving up says nothing', () => {
  const rules = P.maskOf([1, 4]);
  const rows = [
    { rules, codes: '[]', correct: 1 },
    { rules, codes: '["NO_COMMA_BEFORE"]', correct: 0 }, // rule 4 wrong, rule 1 fine
    { rules, codes: '[]', correct: 0 }, // gave up: ignored
    { rules: null, codes: '["NO_QUOTES"]', correct: 0 }, // not analysed yet: ignored
  ];
  const r = P.resultsByRule(rows);
  assert.deepEqual(r[1], [true, true]);
  assert.deepEqual(r[4], [true, false]);
  assert.equal(r[7], undefined);
});
test('weakestRules: a skill with no tries ranks between plainly-wrong and plainly-right', () => {
  const rules = [
    { rule: 1, n: 8, rate: 0.9, available: 5 }, // right
    { rule: 2, n: 0, rate: 0, available: 5 }, // unknown
    { rule: 3, n: 6, rate: 0.33, available: 5 }, // wrong
    { rule: 4, n: 5, rate: 0.2, available: 5 }, // wrong, worse
    { rule: 5, n: 0, rate: 0, available: 0 }, // nothing to practise: never chosen
  ];
  assert.deepEqual(P.weakestRules(rules, 3), [4, 3, 2]);
  assert.deepEqual(P.weakestRules(rules, 1), [4]);
  assert.deepEqual(P.weakestRules(rules, 0), []);
});
test('practice map: mastery comes from first tries in the dungeon and in practice', async () => {
  const { env, db } = freshEnv({ base: false });
  await P.scanRules(env, 100);
  const q = row(db, 'sk-core-4c');
  let m = await pmap(env);
  assert.equal(m.rules.find((r) => r.rule === 12).level, 'new');
  assert.equal(m.rules.find((r) => r.rule === 12).available, 6);
  for (let i = 0; i < 5; i++) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 1, 1, 0, '[]', ?)").run(q.id, Date.now() - i);
  m = await pmap(env);
  assert.equal(m.rules.find((r) => r.rule === 12).level, 'secure');
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 1, 0, 0, '[\"TENSE_TAP\"]', ?)").run(q.id, Date.now() + i + 1);
  m = await pmap(env);
  assert.equal(m.rules.find((r) => r.rule === 12).level, 'learning');
  assert.ok(m.recommended.includes(12), 'getting it wrong: recommended');
  const other = await pmap(env, { id: 2, name: 'Sam', classId: 1, guest: false });
  assert.equal(other.rules.find((r) => r.rule === 12).level, 'new', 'mastery is per pupil');
  db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 2, 1, 0, '[]', ?)").run(q.id, Date.now());
  assert.equal((await pmap(env)).rules.find((r) => r.rule === 12).n, 8 /* last 8 of 9 first tries */ - 0, 'a second try is not a first try');
});
test('practice map respects the teacher’s skill toggles', async () => {
  const { env } = freshEnv({ base: false });
  assert.equal((await pmap(env)).rules.find((r) => r.rule === 12).available, 6);
  const v0 = await (await game.configView(env)).json();
  await game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify({ ...v0.cfg, skills: { ...v0.cfg.skills, tense_fix: { ...v0.cfg.skills.tense_fix, on: false } } }) }), env);
  assert.equal((await pmap(env)).rules.find((r) => r.rule === 12).available, 0);
  await assert.rejects(start(env, 12), (e) => e.status === 404);
});

// ---------------------------------------------------------------- practice rounds
test('a practice round: only questions for that rule, climbing in difficulty, with no answers in the payload', async () => {
  const { env, db } = freshEnv();
  const r = await start(env, 4);
  assert.ok(r.items.length >= 3 && r.items.length <= 5);
  for (const it of r.items) {
    const q = db.prepare('SELECT rules FROM questions WHERE id = ?').get(it.id);
    assert.ok(P.hasRule(q.rules, 4), 'every question exercises the rule');
    for (const k of ['correct', 'accepted', 'wrong', 'fixes', 'explanation', 'traps', 'alts']) assert.ok(!(k in it.p), k);
    assert.ok(it.monster && it.monster.name.startsWith('Training '));
  }
  const steps = r.items.map((i) => i.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), 'easy to hard');
  assert.equal(new Set(r.items.map((i) => i.id)).size, r.items.length);
  assert.ok(r.items.every((i) => [1, 2, 3].includes(i.step)));
  await assert.rejects(start(env, 99), (e) => e.status === 400);
  await assert.rejects(start(env, 0), (e) => e.status === 400);
});
test('a practice round prefers questions the pupil has not answered correctly lately', async () => {
  const { env, db } = freshEnv({ base: false });
  await P.scanRules(env, 100);
  const all = db.prepare("SELECT id FROM questions WHERE skill = 'tense_fix'").all().map((r) => r.id); // 6 questions for rule 12
  for (const id of all.slice(0, 3)) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 1, 1, 0, '[]', ?)").run(id, Date.now());
  const r = await start(env, 12);
  const fresh = r.items.filter((i) => !all.slice(0, 3).includes(i.id)).length;
  assert.equal(fresh, 3, 'all three unseen questions come first');
  assert.ok(r.items.length >= 3);
});
test('practice answers are marked like any other answer but flagged as practice, and pay no rank XP', async () => {
  const { env, db } = freshEnv({ base: false });
  const q = row(db, 'sk-core-4c');
  setPlayer(db, 1, { level: 20, floor_kills: clearedTo(9) });
  const r = await pans(env, { qid: q.id, ...solve(q), rule: 12, step: 2 });
  assert.equal(r.correct, true);
  const a = db.prepare('SELECT practice, xp, correct FROM attempts WHERE question_id = ?').get(q.id);
  assert.deepEqual({ ...a }, { practice: 1, xp: 0, correct: 1 });
  const w = await pans(env, { qid: q.id, ...wrongBody(q), rule: 12, step: 2 });
  assert.equal(w.correct, false);
  assert.equal(w.training, undefined, 'a wrong answer earns nothing');
});

// ---------------------------------------------------------------- training grounds: XP, bonus, no gold, no drops
test('day boundaries follow the configured time zone', () => {
  const t = Date.UTC(2026, 9, 17, 16, 30); // 00:30 on the 18th in Singapore
  assert.equal(P.dayOf(t, 8), '2026-10-18');
  assert.equal(P.dayOf(t, 0), '2026-10-17');
  assert.equal(P.dayStart('2026-10-18', 8), Date.UTC(2026, 9, 17, 16, 0));
  assert.equal(P.dayOf(Date.UTC(2026, 9, 17, 15, 59), 8), '2026-10-17');
});
test('config: training defaults and saving', async () => {
  const c = cfgFrom(null);
  assert.deepEqual(c.training, { xpMult: 1.5, bonusMult: 2, weakest: 3, dailyMonsters: 30, tz: 8, levelCap: 20 });
  assert.equal(cfgFrom({ training: { xpMult: 2 } }).training.dailyMonsters, 30);
  const { env } = freshEnv({ base: false });
  const v0 = await (await game.configView(env)).json();
  await game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify({ ...v0.cfg, training: { xpMult: 99, bonusMult: 0, weakest: 50, dailyMonsters: -5, tz: 'x', levelCap: 500 } }) }), env);
  const t = (await (await game.configView(env)).json()).cfg.training;
  assert.deepEqual(t, { xpMult: 10, bonusMult: 1, weakest: 13, dailyMonsters: 0, tz: 8, levelCap: 100 });
});
async function trainer({ level = 60, cleared = 9, training } = {}) {
  const e = freshEnv({ base: false });
  await P.scanRules(e.env, 100);
  setPlayer(e.db, 1, { level, floor_kills: clearedTo(cleared) });
  if (training) {
    const v0 = await (await game.configView(e.env)).json();
    await game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify({ ...v0.cfg, training: { ...v0.cfg.training, ...training } }) }), e.env);
  }
  return e;
}
// the XP a training monster pays: the dungeon formula (monster level × base XP × the pupil's gear and job XP bonus) × the training multiplier.
// The monster is as strong as the pupil, never above the level cap.
const monsterLevel = (db, cap = 20) => Math.max(1, Math.min(cap, db.prepare('SELECT level FROM g_player WHERE pupil_id = 1').get().level));
const xpOf = (db, { frac = 1, mult = 1, gentle = 1, cap = 20, level } = {}) => { const c = cfgFrom(null); const pl = db.prepare('SELECT * FROM g_player WHERE pupil_id = 1').get(); return Math.max(1, Math.round(c.def.xp * (level ?? monsterLevel(db, cap)) * c.training.xpMult * (1 + game.gear(pl, c).xp) * gentle * frac * mult)); };
const player = (db, id = 1) => db.prepare('SELECT * FROM g_player WHERE pupil_id = ?').get(id);
test('training monsters pay 1.5× a dungeon monster of the same level, and never gold or drops', async () => {
  const { env, db } = await trainer();
  // keep rule 12 out of the weakest three so there is no bonus in this test
  db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const before = player(db);
  const qs = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").all();
  const cfg = cfgFrom(null);
  // a training monster is as strong as the pupil (level 60 here), but never above level 20, whatever the step
  const expect = () => xpOf(db);
  assert.equal(monsterLevel(db), 20);
  const r = await pans(env, { qid: qs[0].id, ...solve(qs[0]), rule: 12, step: 3 });
  assert.equal(r.training.xp, expect(3));
  assert.equal(r.training.level, 20);
  assert.equal(r.training.bonus, false);
  const r1 = await pans(env, { qid: qs[1].id, ...solve(qs[1]), rule: 12, step: 1 });
  assert.equal(r1.training.xp, expect(1));
  const r2 = await pans(env, { qid: qs[2].id, ...solve(qs[2]), rule: 12, step: 2 });
  assert.equal(r2.training.xp, expect(2));
  const after = player(db);
  assert.equal(after.gold, before.gold);
  assert.equal(after.run_gold, before.run_gold);
  assert.equal(after.kills, before.kills, 'training kills do not count as dungeon kills');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM g_inv WHERE pupil_id = 1').get().n, 0, 'no drops');
  assert.equal(after.floor_kills, before.floor_kills, 'the dungeon is untouched');
  assert.equal((after.level - before.level) >= 0, true);
  // XP landed in the pupil's total
  const gained = (after.level - before.level) ? null : after.xp - before.xp;
  if (gained !== null) assert.equal(gained, expect() * 3);
});
test('XP is the dungeon formula times the multiplier: gear and gentle start apply, later tries earn less', async () => {
  const { env, db } = await trainer({ level: 60 });
  db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const q = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'reading_between' ORDER BY id").all()[0]; // Mode 4 (pays 8 then 4)
  const d = JSON.parse(q.data);
  const wrongId = d.options.find((o) => !d.correct.includes(o.id)).id;
  await pans(env, { qid: q.id, picked: [wrongId], rule: 13, step: 2 });
  const r = await pans(env, { qid: q.id, picked: d.correct.slice(0, d.pick), rule: 13, step: 2 });
  assert.equal(r.correct, true);
  assert.equal(r.tryNo, 2);
  assert.equal(r.training.xp, xpOf(db, { frac: 0.5 }), 'second try on a Mode 4 question pays half');
  assert.ok(xpOf(db, { frac: 0.5 }) < xpOf(db));
  // a pupil under the gentle-start level earns the boosted XP
  const g = await trainer({ level: 1, cleared: 0 });
  g.db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const tq = g.db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").get();
  const res = await pans(g.env, { qid: tq.id, ...solve(tq), rule: 12, step: 3 });
  const c = cfgFrom(null);
  assert.equal(res.training.xp, xpOf(g.db, { gentle: c.start.xp }));
  assert.equal(res.training.level, 1, 'a level 1 pupil meets level 1 monsters');
});
test('the first round on each of the day’s weakest skills pays double, once', async () => {
  const { env, db } = await trainer();
  const day = P.dayOf(Date.now(), 8);
  // fix rule 12 as one of today's three weakest by giving it a poor record, and rule 13 a good one
  const q12 = db.prepare("SELECT id FROM questions WHERE skill = 'tense_fix'").get();
  for (let i = 0; i < 6; i++) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 1, 0, 0, '[\"TENSE_TAP\"]', ?)").run(q12.id, Date.now() - 1000 * (i + 1));
  const m = await pmap(env);
  const weak = m.rules.filter((r) => r.bonus).map((r) => r.rule);
  assert.equal(weak.length, 3, 'three weakest skills');
  assert.ok(weak.includes(12));
  assert.ok(m.rules.filter((r) => r.bonus).every((r) => r.bonus === 'ready'));
  // the set is fixed for the day: fixing the weakness does not make a new one appear
  for (let i = 0; i < 6; i++) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, 6, 1, 1, 0, '[]', ?)").run(q12.id, Date.now() + i);
  assert.deepEqual((await pmap(env)).rules.filter((r) => r.bonus).map((r) => r.rule).sort(), weak.sort());
  const round = await start(env, 12);
  assert.equal(round.bonus, true);
  assert.equal(round.bonusMult, 2);
  assert.equal(db.prepare('SELECT bonus_left FROM training_day WHERE pupil_id = 1 AND day = ? AND rule = 12').get(day).bonus_left, round.items.length);
  const first = round.items[0], qrow = db.prepare('SELECT id, mode, data FROM questions WHERE id = ?').get(first.id);
  const plain = xpOf(db);
  const r = await pans(env, { qid: first.id, ...solve(qrow), rule: 12, step: first.step });
  assert.equal(r.training.bonus, true);
  assert.equal(r.training.xp, xpOf(db, { mult: 2 }));
  assert.equal(db.prepare('SELECT bonus_left FROM training_day WHERE pupil_id = 1 AND day = ? AND rule = 12').get(day).bonus_left, round.items.length - 1);
  assert.equal((await pmap(env)).rules.find((x) => x.rule === 12).bonus, 'active');
  // use the rest of the bonus
  for (const it of round.items.slice(1)) { const qq = db.prepare('SELECT id, mode, data FROM questions WHERE id = ?').get(it.id); const x = await pans(env, { qid: it.id, ...solve(qq), rule: 12, step: it.step }); assert.equal(x.training.bonus, true); }
  assert.equal(db.prepare('SELECT bonus_left FROM training_day WHERE pupil_id = 1 AND day = ? AND rule = 12').get(day).bonus_left, 0);
  assert.equal((await pmap(env)).rules.find((x) => x.rule === 12).bonus, 'used');
  // a second round the same day: no bonus
  const again = await start(env, 12);
  assert.equal(again.bonus, false);
  const it = again.items[0], aq = db.prepare('SELECT id, mode, data FROM questions WHERE id = ?').get(it.id);
  const x = await pans(env, { qid: it.id, ...solve(aq), rule: 12, step: it.step });
  assert.equal(x.training.bonus, false);
  assert.equal(x.training.xp, xpOf(db));
});
test('the bonus only counts on questions for that skill, and not for a skill outside today’s weakest', async () => {
  const { env, db } = await trainer();
  const day = P.dayOf(Date.now(), 8);
  db.exec(`INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '${day}', 12, 5)`);
  const q13 = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'reading_between' ORDER BY id").get();
  const r = await pans(env, { qid: q13.id, ...solve(q13), rule: 12, step: 2 }); // claims rule 12 on a rule-13 question
  assert.equal(r.training.bonus, false);
  assert.equal(db.prepare('SELECT bonus_left FROM training_day WHERE pupil_id = 1 AND rule = 12').get().bonus_left, 5, 'nothing was used up');
  const q12 = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").get();
  const r2 = await pans(env, { qid: q12.id, ...solve(q12), rule: 9, step: 2 }); // rule 9 is not a bonus rule today
  assert.equal(r2.training.bonus, false);
});
test('the daily cap stops XP but not practice', async () => {
  const { env, db } = await trainer({ training: { dailyMonsters: 2 } });
  db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const qs = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").all();
  const out = [];
  for (const q of qs.slice(0, 4)) out.push(await pans(env, { qid: q.id, ...solve(q), rule: 12, step: 2 }));
  assert.ok(out[0].training.xp > 0 && out[1].training.xp > 0);
  assert.equal(out[1].training.capped, false);
  assert.equal(out[2].training.capped, true);
  assert.equal(out[2].training.xp, undefined);
  assert.equal(out[3].correct, true, 'still marked and recorded');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attempts WHERE practice = 1 AND correct = 1').get().n, 4);
  const m = await pmap(env);
  assert.deepEqual([m.training.today, m.training.cap], [2, 2]);
  const off = await trainer({ training: { dailyMonsters: 0 } });
  const q = off.db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix'").get();
  assert.equal((await pans(off.env, { qid: q.id, ...solve(q), rule: 12, step: 2 })).training.capped, true, '0 turns XP off');
});
test('training XP can level the pupil up', async () => {
  const { env, db } = await trainer({ level: 60, cleared: 9 });
  db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const need = (await import('../src/gamedata.js')).need(60);
  setPlayer(db, 1, { xp: need - 1, hp: 5 });
  const q = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix'").get();
  const r = await pans(env, { qid: q.id, ...solve(q), rule: 12, step: 3 });
  assert.equal(r.training.levelUps >= 1, true);
  assert.equal(r.training.newLevel, 61);
  const after = player(db);
  assert.equal(after.level, 61);
  assert.ok(after.hp > 5, 'the level’s HP is added');
});
test('the practice map shows the training settings and today’s count', async () => {
  const { env } = await trainer();
  const m = await pmap(env);
  assert.deepEqual(m.training, { xpMult: 1.5, bonusMult: 2, levelCap: 20, today: 0, cap: 30 });
});

test('training monsters match the pupil’s level and never exceed level 20', async () => {
  for (const [pupilLevel, expected] of [[1, 1], [7, 7], [19, 19], [20, 20], [21, 20], [60, 20], [99, 20]]) {
    const { env, db } = await trainer({ level: pupilLevel });
    db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
    const round = await start(env, 12);
    assert.equal(round.level, expected, `level ${pupilLevel}`);
    assert.ok(round.items.every((i) => i.monster.level === expected), 'every monster in the round has that level');
    const q = db.prepare('SELECT id, mode, data FROM questions WHERE id = ?').get(round.items[0].id);
    const gentle = pupilLevel <= cfgFrom(null).start.levels ? cfgFrom(null).start.xp : 1;
    const r = await pans(env, { qid: q.id, ...solve(q), rule: 12, step: round.items[0].step });
    assert.equal(r.training.level, expected);
    assert.equal(r.training.xp, xpOf(db, { level: expected, gentle }), `XP for a level ${expected} monster`);
  }
});
test('the level does not depend on the warm-up / stretch / challenge step, or on how far the pupil has got in the dungeon', async () => {
  const a = await trainer({ level: 12, cleared: 0 }), b = await trainer({ level: 12, cleared: 40 });
  for (const { env, db } of [a, b]) {
    db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
    const qs = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").all();
    for (const [i, step] of [3, 1, 2].entries()) {
      const mine = db.prepare('SELECT level FROM g_player WHERE pupil_id = 1').get().level; // the pupil's level just before this monster
      const r = await pans(env, { qid: qs[i].id, ...solve(qs[i]), rule: 12, step });
      assert.equal(r.training.level, Math.min(20, mine), 'as strong as the pupil, whatever the step or the floor');
    }
    assert.equal(db.prepare('SELECT level FROM g_player WHERE pupil_id = 1').get().level >= 12, true);
  }
});
test('the level cap is a teacher setting, and a level-up inside a round does not change the monster', async () => {
  const { env, db } = await trainer({ level: 30, training: { levelCap: 8 } });
  db.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  assert.equal((await start(env, 12)).level, 8);
  const lo = await trainer({ level: 5, training: { levelCap: 8 } });
  assert.equal((await start(lo.env, 12)).level, 5, 'below the cap the monster still matches the pupil');
  const { env: e2, db: d2 } = await trainer({ level: 4 });
  d2.exec("INSERT INTO training_day (pupil_id, day, rule, bonus_left) VALUES (1, '" + P.dayOf(Date.now(), 8) + "', 1, NULL)");
  const need = (await import('../src/gamedata.js')).need(4);
  setPlayer(d2, 1, { xp: need - 1 });
  const q = d2.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").all();
  const r = await pans(e2, { qid: q[0].id, ...solve(q[0]), rule: 12, step: 2 });
  assert.equal(r.training.level, 4, 'the monster was level 4 when it was defeated');
  assert.ok(r.training.newLevel > 4, 'the reward levelled the pupil up');
  const r2 = await pans(e2, { qid: q[1].id, ...solve(q[1]), rule: 12, step: 2 });
  assert.equal(r2.training.level, Math.min(20, r.training.newLevel), 'the next monster matches the new level');
});

// ---------------------------------------------------------------- assignments
test('teacher assigns a focus skill; pupils see progress from first-try correct practice answers since it was set', async () => {
  const { env, db } = await trainer();
  const tcall = async (method, path, body) => { const url = new URL('https://x/api/t' + path); const r = await teacherRoute(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, url, { admin: true }); return r.json(); };
  const q = db.prepare("SELECT id, mode, data FROM questions WHERE skill = 'tense_fix' ORDER BY id").all();
  // practice done before the assignment does not count
  await pans(env, { qid: q[0].id, ...solve(q[0]), rule: 12, step: 2 });
  await new Promise((r) => setTimeout(r, 5));
  await tcall('POST', '/focus', { class_id: 1, rule: 12, target: 2 });
  await tcall('POST', '/focus', { class_id: 1, rule: 13, target: 3, pupil_ids: [2] });
  assert.equal((await P.assignedFor(env, P1)).length, 1, 'Mei only gets the whole-class one');
  assert.equal((await P.assignedFor(env, { id: 2, classId: 1, guest: false })).length, 2);
  assert.deepEqual((await P.assignedFor(env, P1))[0], { ...(await P.assignedFor(env, P1))[0], rule: 12, target: 2, done: 0, complete: false });
  await pans(env, { qid: q[1].id, ...solve(q[1]), rule: 12, step: 2 });
  await pans(env, { qid: q[2].id, ...wrongBody(q[2]), rule: 12, step: 2 }); // wrong: no credit
  let a = (await P.assignedFor(env, P1))[0];
  assert.equal(a.done, 1);
  await ans(env, { qid: q[3].id, ...solve(q[3]) }); // a dungeon answer is not practice
  assert.equal((await P.assignedFor(env, P1))[0].done, 1);
  await pans(env, { qid: q[3].id, ...solve(q[3]), rule: 12, step: 2 });
  a = (await P.assignedFor(env, P1))[0];
  assert.equal(a.done, 2); assert.equal(a.complete, true);
  const m = await pmap(env);
  assert.equal(m.assigned[0].complete, true);
  const list = await tcall('GET', '/focus?class=1');
  const w = list.assignments.find((x) => x.rule === 12);
  assert.equal(w.who, 'Whole class'); assert.equal(w.targeted, 3); assert.equal(w.done, 1);
  const one = list.assignments.find((x) => x.rule === 13);
  assert.equal(one.who, 'Sam'); assert.equal(one.targeted, 1);
  await tcall('DELETE', '/focus/' + w.id);
  assert.equal((await tcall('GET', '/focus?class=1')).assignments.length, 1);
  assert.equal((await P.assignedFor(env, P1)).length, 0);
  await assert.rejects(tcall('POST', '/focus', { class_id: 1, rule: 99 }), (e) => e.status === 400);
  await assert.rejects(tcall('POST', '/focus', { class_id: 77, rule: 12 }), (e) => e.status === 404);
  assert.deepEqual(await P.assignedFor(env, { id: 9, classId: null, guest: true }), []);
});

// ---------------------------------------------------------------- class diagnosis
const T0 = 1_000_000;
const arow = (pupil, rules, codes, correct, ts = T0) => ({ pupil_id: pupil, rules: P.maskOf(rules), codes: JSON.stringify(codes), correct: correct ? 1 : 0, ts });
test('diagnose: ranks what the class needs, who is struggling and what to do', () => {
  const pupils = [{ id: 1, name: 'Mei' }, { id: 2, name: 'Sam' }, { id: 3, name: 'Tay' }, { id: 4, name: 'Zoe' }];
  const rows = [];
  // rule 4 (comma after said): three of four pupils keep missing it
  for (const id of [1, 2, 3]) for (let i = 0; i < 4; i++) rows.push(arow(id, [4], i === 0 ? [] : ['NO_COMMA_BEFORE'], i === 0));
  for (let i = 0; i < 5; i++) rows.push(arow(4, [4], [], true));
  // rule 8: one pupil struggling
  for (let i = 0; i < 4; i++) rows.push(arow(1, [8], ['NO_NEW_LINE'], false));
  for (const id of [2, 3, 4]) for (let i = 0; i < 4; i++) rows.push(arow(id, [8], [], true));
  // rule 2: everyone secure
  for (const id of [1, 2, 3, 4]) for (let i = 0; i < 5; i++) rows.push(arow(id, [2], [], true));
  const prev = [];
  for (const id of [1, 2, 3, 4]) for (let i = 0; i < 4; i++) prev.push(arow(id, [4], [], i < 3)); // 25% mistakes before
  const d = P.diagnose(rows, prev, pupils);
  assert.deepEqual(d.map((r) => r.rule), [4, 8, 2], 'most pressing first');
  const r4 = d[0], r8 = d[1], r2 = d[2];
  assert.equal(r4.exposures, 17); assert.equal(r4.errors, 9); assert.equal(r4.errorRate, 53);
  assert.deepEqual(r4.struggling.map((x) => x.name).sort(), ['Mei', 'Sam', 'Tay']);
  assert.equal(r4.struggling[0].rate, 75);
  assert.equal(r4.trend, 'worse');
  assert.match(r4.action, /Reteach to the whole class/);
  assert.deepEqual(r8.struggling.map((x) => x.name), ['Mei']);
  assert.match(r8.action, /Small-group support: assign a focus round to 1 pupil\./);
  assert.equal(r2.struggling.length, 0); assert.equal(r2.secureCount, 4);
  assert.match(r2.action, /Mostly secure/);
  assert.equal(r4.levels[4], 'secure'); assert.equal(r4.levels[1], 'learning');
  assert.equal(r2.trend, null, 'no earlier data: no trend');
});
test('diagnose: needs a few tries before calling anyone a struggler; ignores unscanned questions and giving up', () => {
  const pupils = [{ id: 1, name: 'Mei' }];
  const d = P.diagnose([arow(1, [4], ['NO_COMMA_BEFORE'], false), arow(1, [4], ['NO_COMMA_BEFORE'], false)], [], pupils);
  assert.equal(d[0].struggling.length, 0, 'two tries is too few');
  assert.match(d[0].action, /Keep an eye on it/);
  const none = P.diagnose([{ pupil_id: 1, rules: null, codes: '["NO_QUOTES"]', correct: 0, ts: T0 }, arow(1, [4], [], false)], [], pupils);
  assert.deepEqual(none, []);
});
test('diagnose: trend compares with the period before', () => {
  const pupils = [{ id: 1, name: 'Mei' }];
  const mk = (n, miss) => Array.from({ length: n }, (_, i) => arow(1, [3], i < miss ? ['NO_END_PUNCT'] : [], i >= miss));
  assert.equal(P.diagnose(mk(10, 2), mk(10, 6), pupils)[0].trend, 'better');
  assert.equal(P.diagnose(mk(10, 6), mk(10, 2), pupils)[0].trend, 'worse');
  assert.equal(P.diagnose(mk(10, 4), mk(10, 4), pupils)[0].trend, 'steady');
});
test('commonWrong: groups what pupils actually wrote', () => {
  const qs = new Map([
    [1, { mode: 1, data: { prompt: 'raj said hi' } }],
    [2, { mode: 4, data: { stem: 'Which verb?', options: [{ id: 'a', text: 'whispered' }, { id: 'b', text: 'bellowed' }, { id: 'c', text: 'giggled' }] } }],
    [3, { mode: 6, data: { sentence: 'The knight walked in and sees a crown.' } }],
    [4, { mode: 2, data: {} }],
  ]);
  const at = (q, answer, correct = 0) => ({ question_id: q, answer, correct });
  const rows = [at(1, 'Raj said hi'), at(1, 'raj said  Hi'), at(1, 'Raj said, hi'), at(1, 'Raj said, “Hi.”', 1), at(1, '(showed the answer)'),
    at(2, 'a'), at(2, 'a'), at(2, 'c'), at(3, JSON.stringify({ w: 5, f: 'see' })), at(3, JSON.stringify({ w: 5, f: 'see' })), at(3, JSON.stringify({ w: 0, f: 'saw' })), at(4, 'x'), at(4, 'x'), at(4, 'x')];
  const w = P.commonWrong(rows, qs);
  const q1 = w.find((x) => x.id === 1);
  assert.deepEqual(q1.answers[0], { text: 'Raj said hi', n: 2 }, 'case and spacing are folded together');
  assert.equal(q1.wrong, 3);
  assert.deepEqual(w.find((x) => x.id === 2).answers[0], { text: 'whispered', n: 2 }, 'option ids become the words');
  assert.match(w.find((x) => x.id === 3).answers[0].text, /tapped “sees”, typed “see”/);
  assert.equal(w.find((x) => x.id === 4), undefined, 'Mode 2 has no readable answers');
  assert.equal(P.commonWrong([at(1, 'x'), at(1, 'y')], qs).length, 0, 'fewer than 3 wrong answers: not shown');
});
test('teacher /diagnosis: end to end', async () => {
  const { env, db } = freshEnv();
  const tcall = async (method, path, body) => { const url = new URL('https://x/api/t' + path); const r = await teacherRoute(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, url, { admin: true }); return r.json(); };
  const q = row(db, 'sk-core-2a'), d = dataOf(q), wrongId = d.options.find((o) => !d.correct.includes(o.id)).id;
  await P.scanRules(env, 600);
  const ins = (pupil, correct, codes, answer) => db.prepare('INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, answer, codes, ts) VALUES (?, 1, ?, 4, 1, ?, 0, ?, ?, ?)').run(pupil, q.id, correct, answer, JSON.stringify(codes), Date.now());
  for (const pid of [1, 2, 3]) for (let i = 0; i < 4; i++) ins(pid, 0, ['MC_VERB'], wrongId);
  ins(1, 1, [], d.correct[0]);
  const r = await tcall('GET', '/diagnosis?class=1&days=30');
  assert.equal(r.pupils, 3); assert.equal(r.active, 3); assert.equal(r.unscanned, 0);
  const r7 = r.rules.find((x) => x.rule === 7);
  assert.equal(r7.struggling.length, 3);
  assert.match(r7.action, /Reteach/);
  assert.equal(r.wrong[0].id, q.id);
  assert.equal(r.wrong[0].answers[0].n, 12);
  assert.equal(r.roster.length, 3);
  assert.equal((await tcall('POST', '/rules/scan', {})).remaining, 0);
  await assert.rejects(tcall('GET', '/diagnosis'), (e) => e.status === 400);
});
test('teacher /diagnosis analyses old questions the first time it is opened', async () => {
  const { env, db } = freshEnv();
  assert.ok(db.prepare('SELECT COUNT(*) n FROM questions WHERE rules IS NULL').get().n >= 450);
  const url = new URL('https://x/api/t/diagnosis?class=1&days=30');
  const r = await (await teacherRoute(new Request(url), env, url, { admin: true })).json();
  assert.ok(r.unscanned > 0 && r.unscanned < 450, 'a bounded batch per visit');
});

// ---------------------------------------------------------------- the rest of the world still works
test('the practice answer endpoint refuses what the normal one refuses', async () => {
  const { env } = await trainer();
  await assert.rejects(pans(env, { qid: 99999, answer: 'x' }), (e) => e.status === 404 || e.status === 400);
  await assert.rejects(pans(env, { answer: 'x' }), (e) => e.status >= 400);
});
test('v1.8 migration upgrades a v1.6/v1.7 database without losing anything', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, mode INTEGER NOT NULL, class_id INTEGER, public INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created_at INTEGER NOT NULL, skill TEXT, min_floor INTEGER, max_floor INTEGER);
    INSERT INTO questions (mode, data, created_at, skill) VALUES (1, '{"correct":"Raj said, “Hi.”","prompt":"Raj said Hi"}', 5, NULL), (6, '{"sentence":"x"}', 6, 'tense_fix');`);
  db.exec(file('migrate-v1.8.sql'));
  const rows = db.prepare('SELECT id, mode, skill, rules FROM questions ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ id: 1, mode: 1, skill: null, rules: null }, { id: 2, mode: 6, skill: 'tense_fix', rules: null }]);
  db.exec("INSERT INTO focus_assign (class_id, rule, created_at) VALUES (1, 4, 0)");
  db.exec("INSERT INTO training_day (pupil_id, day, rule) VALUES (1, '2026-10-18', 4)");
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(file('schema.sql'));
  const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).sort();
  for (const t of ['questions', 'focus_assign', 'training_day']) assert.deepEqual(cols(db, t), cols(fresh, t), t);
  assert.doesNotThrow(() => db.exec(file('schema.sql')), 'schema.sql stays safe to re-run');
});
test('rules 1-13 each have something to practise in the shipped question set', async () => {
  const { env } = freshEnv();
  await P.scanRules(env, 600);
  const m = await pmap(env);
  for (const r of m.rules) assert.ok(r.available > 0, `rule ${r.rule} (${RULES[r.rule].short})`);
});
