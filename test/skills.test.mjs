// v1.6 question skills: marking for every new mode, seed integrity, answer leakage, floor-aware selection (solo and Dive),
// config, migration and the teacher API. Uses a real SQLite database (node:sqlite) loaded from the project's SQL files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { checkMode1 } from '../src/engine.js';
import { CODES, RULES } from '../src/rules.js';
import { SKILLS, DEFAULT_SKILLS, checkMC, checkTransform, checkTense, correctedSentence, normT, expandOptional, skillPayload } from '../src/skills.js';
import { cfgFrom } from '../src/gamedata.js';
import { skillRoll, liveSkills, pickSkillQuestion } from '../src/select.js';
import { pickQuestion } from '../src/dive.js';
import * as pupil from '../src/pupil.js';
import * as game from '../src/game.js';
import { teacherRoute } from '../src/teacher.js';
import { CORE, EXTRA } from '../scripts/seed-skills.mjs';
import { prepareEntry, tokenIndex } from '../scripts/seed-skills-lib.mjs';

const file = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const codes = (r) => r.errors.map((e) => e.code);

function d1(db) {
  const wrap = (sql) => {
    const st = db.prepare(sql);
    let args = [];
    const o = { bind: (...a) => ((args = a), o), first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => (st.run(...args), { success: true }) };
    return o;
  };
  return { prepare: wrap, batch: async (l) => { for (const s of l) await s.run(); } };
}
function freshEnv({ base = true, extra = true } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'game-schema.sql']) db.exec(file(f));
  if (base) db.exec(file('questions-450.sql'));
  db.exec(file('seed-skills.sql'));
  if (extra) db.exec(file('seed-skills-extra.sql'));
  db.exec("INSERT INTO classes (id, name, code, created_at) VALUES (1, '5A', 'ABC234', 0)");
  db.exec("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at) VALUES (1, 1, 'Mei Lin', 'mei', 0, 0), (2, 1, 'Sam', 'sam', 0, 0)");
  return { db, env: { DB: d1(db) } };
}
const P1 = { id: 1, name: 'Mei Lin', classId: 1, guest: false, className: '5A' };
const post = (body) => new Request('https://x/api/answer', { method: 'POST', body: JSON.stringify(body) });
const ans = async (env, body, p = P1) => (await pupil.answer(post(body), env, p)).json();
const qBySeed = (db, seed) => db.prepare("SELECT id, mode, skill, data FROM questions WHERE json_extract(data, '$.seed') = ?").get(seed);
const data = (row) => JSON.parse(row.data);
const seedData = (seed) => prepareEntry([...CORE, ...EXTRA].find((e) => e.seed === seed)).data;

// ---------------------------------------------------------------- Mode 1: new speaker, new line (1a)
const K1A = { correct: '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I never said that,” replied Tally.', lines: true };
const ONE_LINE = '“Did you tell Mei the bridge is closed?” asked Raj. “No, I never said that,” replied Tally.';

test('1a: the two-line answer is accepted, with curly or straight quotes, spacing and CRLF', () => {
  assert.equal(checkMode1(K1A, K1A.correct).correct, true);
  assert.equal(checkMode1(K1A, '"Did you tell Mei the bridge is closed?" asked Raj.\n"No, I never said that," replied Tally.').correct, true);
  assert.equal(checkMode1(K1A, ONE_LINE.replace('Raj. ', 'Raj.\r\n')).correct, true);
  assert.equal(checkMode1(K1A, '  ' + ONE_LINE.replace('Raj. ', 'Raj.  \n  ') + '\n').correct, true, 'extra spaces and a trailing newline are fine');
  assert.equal(checkMode1(K1A, ONE_LINE.replace('Raj. ', 'Raj.\n\n')).correct, true, 'a blank line still separates the speakers');
});
test('1a: a missing line break has its own code; extra breaks too', () => {
  const r = checkMode1(K1A, ONE_LINE);
  assert.equal(r.correct, false);
  assert.deepEqual(codes(r), ['NO_NEW_LINE']);
  assert.equal(r.errors[0].rule, 8);
  const r2 = checkMode1(K1A, '“Did you tell Mei the bridge is closed?”\nasked Raj.\n“No, I never said that,” replied Tally.');
  assert.deepEqual(codes(r2), ['EXTRA_NEW_LINE']);
  assert.deepEqual(codes(checkMode1(K1A, ONE_LINE.replace(/ /g, '\n'))).includes('NO_NEW_LINE'), false); // a break everywhere: only extras
});
test('1a: punctuation mistakes inside a line still use the existing codes', () => {
  const r = checkMode1(K1A, '“Did you tell Mei the bridge is closed?” asked Raj.\n“No I never said that,” replied Tally.');
  assert.equal(r.correct, false);
  assert.ok(!codes(r).includes('NO_NEW_LINE'));
  assert.deepEqual(codes(r), ['PUNCT_OTHER']);
  const r2 = checkMode1(K1A, '“Did you tell Mei the bridge is closed?” asked Raj\n“no, I never said that,” replied Tally.');
  assert.deepEqual(codes(r2).sort(), ['NO_CAPITAL', 'NO_FULLSTOP_TAG'].sort());
  assert.equal(checkMode1(K1A, '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I always said that,” replied Tally.').codes[0], 'CHANGED_WORDS');
});
test('line breaks only matter when the question asks for them', () => {
  const plain = { correct: K1A.correct };
  assert.equal(checkMode1(plain, ONE_LINE).correct, true);
  assert.equal(checkMode1(plain, K1A.correct).correct, true);
});

// ---------------------------------------------------------------- Mode 1: action beat (1b)
const K1B = { correct: 'Mei looked at the clock. “We’re going to be late,” groaned Mei.', beat: true };
test('1b: the key is accepted in any quote style and case of spacing', () => {
  assert.equal(checkMode1(K1B, K1B.correct).correct, true);
  assert.equal(checkMode1(K1B, 'Mei looked at the clock.  "We\'re going to be late," groaned Mei.').correct, true);
});
test('1b: a comma instead of the full stop gets BEAT_COMMA, and the saying-verb comma rule does not fire', () => {
  const r = checkMode1(K1B, 'Mei looked at the clock, “We’re going to be late,” groaned Mei.');
  assert.deepEqual(codes(r), ['BEAT_COMMA']);
  assert.equal(r.errors[0].rule, 9);
  for (const c of ['NO_COMMA_BEFORE', 'NO_FULLSTOP_TAG']) assert.ok(!codes(r).includes(c));
  // without the flag the same key would call it a saying-words problem: the flag is what makes the feedback right
  assert.deepEqual(codes(checkMode1({ correct: K1B.correct }, 'Mei looked at the clock, “We’re going to be late,” groaned Mei.')), ['NO_FULLSTOP_TAG']);
});
test('1b: no punctuation after the action asks for a full stop, not a comma', () => {
  const r = checkMode1(K1B, 'Mei looked at the clock “We’re going to be late,” groaned Mei.');
  assert.deepEqual(codes(r), ['NO_END_PUNCT']);
  assert.match(r.errors[0].what, /full stop/);
  const all = checkMode1(K1B, 'mei looked at the clock we’re going to be late groaned mei');
  assert.ok(!codes(all).includes('NO_COMMA_BEFORE'));
  assert.ok(codes(all).includes('NO_END_PUNCT') && codes(all).includes('NO_CAPITAL_SENT'));
});
test('1b: saying-verb sentences keep the comma rule (the existing behaviour is untouched)', () => {
  const k = { correct: 'Mei said, “We’re going to be late.”' };
  assert.deepEqual(codes(checkMode1(k, 'Mei said “We’re going to be late.”')), ['NO_COMMA_BEFORE']);
});

// ---------------------------------------------------------------- Mode 4: multiple choice
test('2a: bellowed is the key; every distractor is rejected; one choice only', () => {
  const d = seedData('sk-core-2a');
  assert.equal(d.options.find((o) => o.text === 'bellowed').id, d.correct[0]);
  assert.equal(checkMC(d, [d.correct[0]]).correct, true);
  for (const o of d.options.filter((x) => !d.correct.includes(x.id))) {
    const r = checkMC(d, [o.id]);
    assert.equal(r.valid, true);
    assert.equal(r.correct, false, o.text);
    assert.deepEqual(r.wrongIds, [o.id]);
  }
  assert.equal(checkMC(d, []).valid, false);
  assert.equal(checkMC(d, ['a', 'b']).valid, false);
  assert.equal(checkMC(d, ['zz']).valid, false);
});
test('7a: key B; 7c: its key; the passage is embedded in all three with a shared group', () => {
  const a = seedData('sk-core-7a'), b = seedData('sk-core-7b'), c = seedData('sk-core-7c');
  assert.equal(a.options[a.correct[0].charCodeAt(0) - 97].text, 'worried but hiding it');
  assert.equal(c.options[c.correct[0].charCodeAt(0) - 97].text, 'to show she understands and isn’t scolding');
  assert.equal(new Set([a.group, b.group, c.group]).size, 1);
  assert.ok(a.group);
  for (const x of [a, b, c]) assert.match(x.passage, /“I’m fine,” said Ilse, folding her arms\./);
  assert.equal(b.options.length, 6);
  assert.equal(c.options.length, 4);
});
test('7b: any two valid details are correct; a distractor or the wrong count is not', () => {
  const b = seedData('sk-core-7b');
  const text = (id) => b.options.find((o) => o.id === id).text;
  const valid = ['folding her arms', 'staring at the door for an hour', 'muttered', 'did not turn around'];
  const validIds = b.options.filter((o) => valid.includes(o.text)).map((o) => o.id);
  const bad = b.options.filter((o) => !valid.includes(o.text)).map((o) => o.id);
  assert.equal(validIds.length, 4);
  assert.deepEqual(bad.map(text).sort(), ['Wren smiled', 'the door is mentioned']);
  assert.equal(b.pick, 2);
  let combos = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { combos++; assert.equal(checkMC(b, [validIds[i], validIds[j]]).correct, true); }
  assert.equal(combos, 6);
  for (const x of bad) for (const v of validIds) {
    const r = checkMC(b, [v, x]);
    assert.equal(r.correct, false);
    assert.deepEqual(r.wrongIds, [x], 'only the distractor is reported wrong');
  }
  assert.equal(checkMC(b, bad).correct, false);
  assert.equal(checkMC(b, [validIds[0]]).valid, false, 'one pick is not enough');
  assert.equal(checkMC(b, validIds.slice(0, 3)).valid, false, 'three picks are too many');
  assert.equal(checkMC(b, [validIds[0], validIds[0]]).valid, false, 'the same option twice is one pick');
});

// ---------------------------------------------------------------- Mode 5: free-text transform
const T4A = () => seedData('sk-core-4a');
const T4B = () => seedData('sk-core-4b');
test('4a: that is optional; case, spacing and trailing punctuation are ignored', () => {
  const d = T4A();
  for (const a of ['Brisk said she was going to the Warren.', 'Brisk said that she was going to the Warren.', 'brisk   SAID that she was going to the warren', 'Brisk said she was going to the Warren!', 'Brisk said, that she was going to the Warren']) {
    assert.equal(checkTransform(d, a).correct, true, a);
  }
});
test('4a: wrong answers are rejected with a specific code', () => {
  const d = T4A();
  const c = (a) => checkTransform(d, a).codes;
  assert.deepEqual(c('Brisk said she am going to the Warren'), ['RS_TENSE'], 'kept the present tense');
  assert.deepEqual(c('Brisk said that I was going to the Warren'), ['RS_PRONOUN']);
  assert.deepEqual(c('Brisk said I am going to the Warren').sort(), ['RS_PRONOUN', 'RS_TENSE']);
  assert.deepEqual(c('Brisk said, “She was going to the Warren.”'), ['RS_QUOTES']);
  assert.deepEqual(c('Brisk said she was going to the Pit'), ['RS_FORM']);
  assert.equal(checkTransform(d, '“I am going to the Warren,” said Brisk.').correct, false, 'the prompt itself is not an answer');
});
test('4b: told or said to; will or I’ll; straight or curly quotes; spacing and case', () => {
  const d = T4B();
  for (const a of ['Wren said to Quip, “I will ring the bell tomorrow.”', 'Wren told Quip, “I will ring the bell tomorrow.”', 'Wren said to Quip, “I’ll ring the bell tomorrow.”', 'Wren told Quip, "I\'ll ring the bell tomorrow."', 'wren  told quip, "i will ring the bell tomorrow"', 'Wren told Quip, ‘I will ring the bell tomorrow.’']) {
    assert.equal(checkTransform(d, a).correct, true, a);
  }
});
test('4b: wrong answers get specific codes; missing speech marks use the existing quotes code', () => {
  const d = T4B();
  const c = (a) => checkTransform(d, a).codes;
  assert.deepEqual(c('Wren said to Quip, “She would ring the bell the next day.”').sort(), ['DS_PRONOUN', 'DS_TENSE', 'DS_TIME']);
  assert.deepEqual(c('Wren said to Quip, “I would ring the bell tomorrow.”'), ['DS_TENSE']);
  assert.deepEqual(c('Wren said to Quip I will ring the bell tomorrow'), ['NO_QUOTES']);
  assert.equal(CODES.NO_QUOTES.rule, 1);
  assert.deepEqual(c('Wren said to Quip, “I will ring the bell soon.”'), ['DS_FORM']);
});
test('4b: a missing comma is accepted but the pupil is told', () => {
  const r = checkTransform(T4B(), 'Wren told Quip “I will ring the bell tomorrow.”');
  assert.equal(r.correct, true);
  assert.match(r.note, /comma/);
  assert.equal(checkTransform(T4B(), 'Wren told Quip, “I will ring the bell tomorrow.”').note, undefined);
});
test('transform helpers: optional words and contractions', () => {
  assert.deepEqual(expandOptional('a (b) c').map((x) => x.replace(/\s+/g, ' ').trim()).sort(), ['a b c', 'a c']);
  assert.equal(normT('I’ll don’t can’t'), 'i will do not can not');
  assert.equal(normT('“Hi,”  said   Raj.'), '" hi " said raj');
});

// ---------------------------------------------------------------- Mode 6: tap + fix
test('4c: tap sees, type saw: case and spacing of the fix do not matter', () => {
  const d = seedData('sk-core-4c');
  const i = tokenIndex(d);
  assert.equal(d.wrong.join(), 'sees');
  assert.equal(d.fixes.join(), 'saw');
  for (const f of ['saw', 'Saw', '  saw  ', 'SAW.']) assert.equal(checkTense(d, i, f).correct, true, f);
  assert.equal(correctedSentence(d), 'The knight walked into the hall and saw a crown.');
});
test('4c: a wrong tap, a wrong fix and bad input', () => {
  const d = seedData('sk-core-4c'), i = tokenIndex(d);
  assert.deepEqual(checkTense(d, 2, 'saw').codes, ['TENSE_TAP']);
  assert.equal(checkTense(d, 2, 'saw').tapOk, false);
  assert.deepEqual(checkTense(d, i, 'see').codes, ['TENSE_FIX']);
  assert.equal(checkTense(d, i, 'see').tapOk, true);
  assert.equal(checkTense(d, i, 'seen').correct, false);
  assert.equal(checkTense(d, -1, 'saw').valid, false);
  assert.equal(checkTense(d, 99, 'saw').valid, false);
  assert.equal(checkTense(d, i, '').valid, false);
  assert.equal(checkTense(d, i, '1 2 3 4 5').valid, false);
});
test('4c: wrong words and fixes are lists, so variants can be added', () => {
  const d = { sentence: 'The knight walked in and sees or sees a crown.', wrong: ['sees', 'see'], fixes: ['saw', 'had seen'] };
  assert.equal(checkTense(d, 5, 'had seen').correct, true);
  assert.equal(checkTense(d, 7, 'saw').correct, true);
});

// ---------------------------------------------------------------- seeds
test('seed: nine questions in the brief file, five extras per type in the extra file', () => {
  assert.equal(CORE.length, 9);
  const per = (p) => EXTRA.filter((e) => e.seed.startsWith('sk-x-' + p)).length;
  for (const t of ['1a', '1b', '2a', '4a', '4b', '4c']) assert.equal(per(t + '-'), 5, t);
  assert.equal(per('7-'), 15, 'five passages of three questions');
  assert.equal(new Set([...CORE, ...EXTRA].map((e) => e.seed)).size, CORE.length + EXTRA.length, 'seed ids are unique');
});
test('seed: every key passes its own checker and nothing else does', () => {
  for (const e of [...CORE, ...EXTRA]) {
    const { data: d } = prepareEntry(e); // throws if a key is rejected
    if (e.mode === 1) {
      assert.equal(checkMode1(d, d.correct).correct, true, e.seed);
      assert.equal(checkMode1(d, d.prompt).correct, false, e.seed + ' prompt');
      if (d.lines) assert.ok(d.correct.includes('\n'), e.seed);
      assert.ok(!/["']/.test(d.correct), e.seed + ' keys use typographic quotes');
    } else if (e.mode === 4) {
      const ok = new Set(d.correct);
      const ids = d.options.map((o) => o.id);
      assert.ok(d.correct.length >= d.pick && d.correct.length < d.options.length, e.seed);
      // every pick of the right size: correct iff all picks are valid
      const subsets = (n, from = 0, cur = []) => (cur.length === n ? [cur] : ids.slice(from).flatMap((id, k) => subsets(n, from + k + 1, [...cur, id])));
      for (const pick of subsets(d.pick)) assert.equal(checkMC(d, pick).correct, pick.every((x) => ok.has(x)), `${e.seed} ${pick}`);
      for (const x of ids.filter((i) => !ok.has(i))) assert.equal(checkMC(d, [x, ...d.correct.slice(0, d.pick - 1)]).correct, false, `${e.seed} distractor ${x}`);
      assert.ok(d.explanation.length > 10);
      assert.ok(!/["']/.test(d.stem + (d.passage || '') + d.options.map((o) => o.text).join('')), e.seed + ' typographic quotes');
    } else if (e.mode === 5) {
      for (const a of d.accepted) assert.equal(checkTransform(d, a.replace(/[()]/g, '')).correct, true, `${e.seed} ${a}`);
      assert.equal(checkTransform(d, d.prompt).correct, false, e.seed + ' prompt');
      assert.equal(checkTransform(d, 'nothing like it').correct, false);
      for (const t of d.traps || []) assert.ok(CODES[t.code], `${e.seed} trap code ${t.code}`);
    } else {
      const i = tokenIndex(d);
      assert.ok(i >= 0, e.seed);
      for (const f of d.fixes) assert.equal(checkTense(d, i, f).correct, true, e.seed);
      const nWords = d.sentence.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu).length;
      for (let k = 0; k < nWords; k++) if (k !== i) assert.equal(checkTense(d, k, d.fixes[0]).correct, false, `${e.seed} tap ${k}`);
    }
  }
});
test('seed: reading questions share a group and a passage; 7a-c style', () => {
  const byGroup = {};
  for (const e of [...CORE, ...EXTRA].filter((x) => x.skill === 'reading_between')) (byGroup[e.data.group] ||= []).push(e);
  assert.equal(Object.keys(byGroup).length, 6);
  for (const [g, list] of Object.entries(byGroup)) {
    assert.equal(list.length, 3, g);
    assert.equal(new Set(list.map((x) => x.data.passage)).size, 1, g);
    assert.deepEqual(list.map((x) => x.data.pick), [1, 2, 1], g);
    assert.equal(list[1].data.options.length, 6);
    assert.equal(list[1].data.correct.length, 4);
  }
});
test('seed SQL is INSERT-only, additive and idempotent; existing questions are untouched', () => {
  for (const f of ['seed-skills.sql', 'seed-skills-extra.sql']) assert.ok(!/\b(UPDATE|DELETE|DROP|REPLACE|ALTER)\b/i.test(file(f).replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")), f);
  const { db } = freshEnv({ base: true, extra: false });
  const before = db.prepare("SELECT COUNT(*) n FROM questions WHERE skill IS NULL").get().n;
  assert.ok(before >= 450);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE skill IS NOT NULL').get().n, 9);
  db.exec(file('seed-skills.sql'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE skill IS NOT NULL').get().n, 9, 'running it again adds nothing');
  db.exec(file('seed-skills-extra.sql'));
  db.exec(file('seed-skills-extra.sql'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE skill IS NOT NULL').get().n, 54);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE skill IS NULL').get().n, before);
  // a question a teacher removed is not brought back by re-running the seed
  db.exec("UPDATE questions SET active = 0 WHERE json_extract(data, '$.seed') = 'sk-core-1a'");
  db.exec(file('seed-skills.sql'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM questions WHERE json_extract(data, '$.seed') = 'sk-core-1a'").get().n, 1);
  // new rows carry skill, NULL floors, and the right mode
  const r = db.prepare("SELECT mode, skill, min_floor, max_floor FROM questions WHERE json_extract(data, '$.seed') = 'sk-core-4c'").get();
  assert.deepEqual({ ...r }, { mode: 6, skill: 'tense_fix', min_floor: null, max_floor: null });
});

// ---------------------------------------------------------------- no answer leakage
const SECRET_KEYS = ['correct', 'accepted', 'wrong', 'fixes', 'traps', 'explanation', 'alts', 'seed', 'group', 'code', 'tip'];
test('payloads never contain answers', () => {
  for (const e of [...CORE, ...EXTRA]) {
    const { data: d } = prepareEntry(e);
    const p = skillPayload(e.mode, d);
    assert.ok(p, e.seed);
    const json = JSON.stringify(p);
    for (const k of SECRET_KEYS) assert.ok(!(k in p), `${e.seed} sends ${k}`);
    if (e.mode === 1) assert.ok(!json.includes('"correct"'));
    if (e.mode === 4) {
      assert.deepEqual(Object.keys(p).sort().filter((k) => !['context', 'passage'].includes(k)), ['options', 'pick', 'stem', 'tries']);
      for (const o of p.options) assert.deepEqual(Object.keys(o).sort(), ['id', 'text']);
      assert.ok(!json.includes(d.explanation.slice(0, 30)));
    }
    if (e.mode === 5) for (const a of d.accepted) assert.ok(!json.includes(a.replace(/[()]/g, '').slice(0, 25)) || a.slice(0, 25) === d.prompt.slice(0, 25), `${e.seed} leaks ${a}`);
    if (e.mode === 6) for (const f of d.fixes) assert.ok(!new RegExp(`"${f}"`).test(JSON.stringify(p.words)), `${e.seed} leaks the fix`);
  }
  assert.ok(pupil.payloadFor(2, { correct: 'Raj said, “Hi.”', faulty: 'Raj said Hi' }));
  assert.deepEqual(pupil.payloadFor(1, { correct: 'x', prompt: 'p', alts: ['a'] }), { prompt: 'p' }, 'plain Mode 1 payloads are unchanged');
});
test('answer responses reveal the key only when the question is over', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const q = qBySeed(db, 'sk-core-2a'), d = data(q);
  const wrong = d.options.find((o) => !d.correct.includes(o.id)).id;
  const r1 = await ans(env, { qid: q.id, picked: [wrong] });
  assert.equal(r1.correct, false);
  assert.equal(r1.final, false);
  assert.equal(r1.reveal, undefined);
  assert.deepEqual(r1.wrongIds, [wrong]);
  assert.ok(!JSON.stringify(r1).includes(d.explanation.slice(0, 20)));
  const r2 = await ans(env, { qid: q.id, picked: [d.options.find((o) => !d.correct.includes(o.id) && o.id !== wrong).id] });
  assert.equal(r2.final, true);
  assert.deepEqual(r2.reveal.correct, d.correct);
  assert.equal(r2.xp, 0);
  const t = qBySeed(db, 'sk-core-4c');
  const r3 = await ans(env, { qid: t.id, tapped: 0, fix: 'saw', tryNo: 1 });
  assert.equal(r3.correct, false);
  assert.equal(r3.reveal, undefined);
  assert.ok(!JSON.stringify(r3).includes('sees'), 'the wrong word is not sent back');
  const f = qBySeed(db, 'sk-core-4a');
  const r4 = await ans(env, { qid: f.id, answer: 'nope', tryNo: 1 });
  assert.equal(r4.reveal, undefined);
});

// ---------------------------------------------------------------- answering: tries, XP, contract
test('Mode 4: first try pays most, second less, a second miss reveals and pays nothing; tries are counted by the server', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const q = qBySeed(db, 'sk-core-2a'), d = data(q);
  const right = d.correct, wrongs = d.options.filter((o) => !d.correct.includes(o.id)).map((o) => o.id);
  let r = await ans(env, { qid: q.id, picked: right, tryNo: 3 }); // the client's tryNo is ignored
  assert.equal(r.correct, true); assert.equal(r.xp, 8); assert.equal(r.final, false);
  assert.equal(r.reveal.explanation, d.explanation);
  const q2 = qBySeed(db, 'sk-core-7a');
  const d2 = data(q2), w2 = d2.options.filter((o) => !d2.correct.includes(o.id)).map((o) => o.id);
  r = await ans(env, { qid: q2.id, picked: [w2[0]], tryNo: 1 });
  assert.equal(r.final, false); assert.equal(r.triesLeft, 1);
  r = await ans(env, { qid: q2.id, picked: d2.correct, tryNo: 1 }); // the browser claims try 1 again; the server knows it is try 2
  assert.equal(r.correct, true); assert.equal(r.xp, 4); assert.equal(r.tryNo, 2);
  // an invalid pick does not use a try
  const q3 = qBySeed(db, 'sk-core-7b');
  await assert.rejects(ans(env, { qid: q3.id, picked: ['a'] }), (e) => e.status === 400);
  const rows = db.prepare('SELECT try_no, correct, xp, codes FROM attempts WHERE question_id = ? ORDER BY id').all(q2.id);
  assert.deepEqual(rows.map((x) => [x.try_no, x.correct, x.xp]), [[1, 0, 0], [2, 1, 4]]);
  assert.deepEqual(JSON.parse(rows[0].codes), ['MC_INFER']);
  assert.deepEqual(JSON.parse(db.prepare('SELECT codes FROM attempts WHERE question_id = ?').get(q.id).codes), []);
  assert.ok(wrongs.length === 3);
});
test('Mode 4: a wrong answer from the skill is recorded under its own code', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const q = qBySeed(db, 'sk-core-2a');
  await ans(env, { qid: q.id, picked: ['a'] });
  assert.deepEqual(JSON.parse(db.prepare('SELECT codes FROM attempts WHERE question_id = ?').get(q.id).codes), ['MC_VERB']);
});
test('Modes 5 and 6 follow the three-try pattern and reveal the model answer on the last', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const f = qBySeed(db, 'sk-core-4b');
  let r = await ans(env, { qid: f.id, answer: 'Wren said to Quip, “She would ring the bell the next day.”', tryNo: 1 });
  assert.equal(r.correct, false); assert.equal(r.final, false); assert.ok(r.errors.length >= 3);
  assert.ok(r.errors.every((e) => e.rule >= 11 && e.what === undefined), 'the first try names the rule but does not explain the spot yet');
  r = await ans(env, { qid: f.id, answer: 'Wren said to Quip, “She would ring the bell the next day.”', tryNo: 2 });
  assert.ok(r.errors.every((e) => e.what && e.fix === undefined), 'the second try explains');
  r = await ans(env, { qid: f.id, answer: 'still wrong', tryNo: 3 });
  assert.equal(r.final, true); assert.match(r.reveal, /I will ring the bell tomorrow/);
  const g = qBySeed(db, 'sk-core-4a');
  r = await ans(env, { qid: g.id, answer: 'Brisk said she was going to the Warren', tryNo: 2 });
  assert.equal(r.correct, true); assert.equal(r.xp, 6); assert.match(r.reveal, /Brisk said \(that\)/);
  const t = qBySeed(db, 'sk-core-4c');
  const i = tokenIndex(data(t));
  r = await ans(env, { qid: t.id, tapped: i, fix: 'see' });
  assert.equal(r.correct, false); assert.equal(r.tapOk, true);
  r = await ans(env, { qid: t.id, tapped: i, fix: 'saw' });
  assert.equal(r.correct, true); assert.equal(r.xp, 6); assert.equal(r.reveal, 'The knight walked into the hall and saw a crown.');
  r = await ans(env, { qid: t.id, tapped: i, fix: 'x', giveUp: true });
  assert.equal(r.final, true);
  await assert.rejects(ans(env, { qid: t.id, fix: 'saw' }), (e) => e.status === 400);
});
test('the answer contract is the same as before: no phase, and done = correct or final', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  for (const [seed, body] of [['sk-core-2a', { picked: ['a'] }], ['sk-core-4a', { answer: 'x' }], ['sk-core-4c', { tapped: 0, fix: 'x' }]]) {
    const r = await ans(env, { qid: qBySeed(db, seed).id, ...body });
    assert.equal(r.phase, undefined, seed);
    assert.equal(typeof r.correct, 'boolean');
    assert.equal(r.correct || r.final, false);
    assert.ok('xpTotal' in r && 'rank' in r);
  }
  const r1a = await ans(env, { qid: qBySeed(db, 'sk-core-1a').id, answer: ONE_LINE, tryNo: 3 });
  assert.equal(r1a.final, true); assert.equal(r1a.errors[0].code, 'NO_NEW_LINE');
  assert.equal(r1a.reveal, K1A.correct);
});

// ---------------------------------------------------------------- selection
const ranges = (cfg) => Object.fromEntries(Object.entries(cfg.skills).map(([k, s]) => [k, [s.min, s.max]]));
test('defaults: every skill is on at 35% on the floors from the brief', () => {
  const c = cfgFrom(null);
  assert.deepEqual(ranges(c), { speaker_lines: [11, 20], action_beat: [11, 20], verb_choice: [21, 30], reported: [41, 60], tense_fix: [41, 60], reading_between: [81, 90] });
  for (const s of Object.values(c.skills)) { assert.equal(s.on, true); assert.equal(s.share, 35); }
  assert.deepEqual(DEFAULT_SKILLS, c.skills);
  assert.equal(cfgFrom({ skills: { reported: { share: 50 } } }).skills.reported.min, 41, 'a partial saved skill keeps its other defaults');
  assert.equal(cfgFrom({ hp: c.hp }).skills.tense_fix.share, 35, 'a config saved before v1.6 gets the defaults');
});
test('skillRoll: only live skills, about the share, never above the cap', () => {
  const c = cfgFrom(null);
  const tally = (floor, cfg, n = 20000) => { const t = {}; let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); for (let i = 0; i < n; i++) { const k = skillRoll(floor, cfg, rnd) || 'none'; t[k] = (t[k] || 0) + 1; } return t; };
  const t30 = tally(25, c);
  assert.deepEqual(Object.keys(t30).sort(), ['none', 'verb_choice']);
  assert.ok(Math.abs(t30.verb_choice / 20000 - 0.35) < 0.02);
  assert.deepEqual(Object.keys(tally(5, c)), ['none']);
  assert.deepEqual(Object.keys(tally(100, c)), ['none']);
  const t15 = tally(15, c);
  assert.ok(Math.abs(t15.speaker_lines / 20000 - 0.35) < 0.02 && Math.abs(t15.action_beat / 20000 - 0.35) < 0.02, 'two skills each get their share');
  const hi = cfgFrom({ skills: { speaker_lines: { share: 100 }, action_beat: { share: 100 } } });
  assert.ok(tally(15, hi).none === undefined || tally(15, hi).none / 20000 > 0.27, 'overlapping skills leave the ordinary pool at least 30%');
  const solo = cfgFrom({ skills: { verb_choice: { share: 100 } } });
  assert.equal(tally(25, solo).none, undefined, 'a single skill at 100% is always served');
  const off = cfgFrom({ skills: { verb_choice: { on: false } } });
  assert.deepEqual(Object.keys(tally(25, off)), ['none']);
  assert.deepEqual(liveSkills(25, cfgFrom({ skills: { verb_choice: { share: 0 } } })), []);
  const wide = cfgFrom({ skills: { verb_choice: { min: 5, max: 8 } } });
  assert.deepEqual(Object.keys(tally(6, wide)).sort(), ['none', 'verb_choice']);
  assert.deepEqual(Object.keys(tally(25, wide)), ['none']);
});

async function sample(env, cfg, floor, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    const m = { guest: false, classId: 1 };
    const q = await pickQuestion(env, m, floor, new Set(), cfg);
    const row = await env.DB.prepare('SELECT id, mode, skill, min_floor, max_floor FROM questions WHERE id = ?1').bind(q.id).first();
    seen.push(row);
  }
  return seen;
}
test('selection (Dive and shared): skill questions appear only inside their floor ranges', async () => {
  const { env } = freshEnv();
  const cfg = cfgFrom(null);
  const r = ranges(cfg);
  const hits = {};
  for (const floor of [1, 5, 10, 11, 15, 20, 21, 25, 30, 31, 40, 41, 50, 60, 61, 70, 80, 81, 85, 90, 91, 100, 150]) {
    const rows = await sample(env, cfg, floor, 60);
    for (const row of rows) {
      if (row.skill) {
        const [lo, hi] = r[row.skill];
        assert.ok(floor >= lo && floor <= hi, `${row.skill} served on floor ${floor}`);
        hits[row.skill] = (hits[row.skill] || 0) + 1;
      } else assert.ok([1, 2, 3].includes(row.mode), 'the ordinary pool is still modes 1 to 3');
    }
  }
  assert.deepEqual(Object.keys(hits).sort(), Object.keys(r).sort(), 'every skill is reachable');
});
test('selection: the ordinary pool never serves skill questions, and its mode rules are unchanged', async () => {
  const { env } = freshEnv();
  const cfg = cfgFrom({ skills: Object.fromEntries(Object.keys(SKILLS).map((k) => [k, { on: false }])) });
  for (const floor of [5, 15, 25, 45, 85]) {
    const rows = await sample(env, cfg, floor, 40);
    assert.ok(rows.every((r) => r.skill === null), `floor ${floor}`);
    const maxMode = floor <= 10 ? 1 : floor <= 50 ? 2 : 3;
    assert.ok(rows.every((r) => r.mode <= maxMode), `floor ${floor}`);
  }
});
test('selection: the toggle, the share and a question’s own floors', async () => {
  const { env, db } = freshEnv();
  const on = cfgFrom({ skills: { verb_choice: { share: 100 } } });
  assert.ok((await sample(env, on, 25, 30)).every((r) => r.skill === 'verb_choice'));
  const off = cfgFrom({ skills: { verb_choice: { on: false, share: 100 } } });
  assert.ok((await sample(env, off, 25, 60)).every((r) => r.skill === null), 'switched off: never served');
  const zero = cfgFrom({ skills: { verb_choice: { share: 0 } } });
  assert.ok((await sample(env, zero, 25, 60)).every((r) => r.skill === null));
  // a question that limits itself to floors 28-30 is skipped on floor 25 and used on floor 29
  db.exec("UPDATE questions SET min_floor = 28, max_floor = 30 WHERE skill = 'verb_choice'");
  assert.ok((await sample(env, on, 25, 30)).every((r) => r.skill === null), 'all verb questions are restricted away from floor 25');
  assert.ok((await sample(env, on, 29, 30)).every((r) => r.skill === 'verb_choice'));
  // the same limits work on the ordinary pool: with every Mode 1 question limited to floor 99+, floor 3 has nothing to serve
  db.exec("UPDATE questions SET min_floor = 99 WHERE skill IS NULL AND mode = 1");
  assert.equal(await pickQuestion(env, { guest: false, classId: 1 }, 3, new Set(), cfgFrom({})), null);
  assert.ok(await pickQuestion(env, { guest: false, classId: 1 }, 99, new Set(), cfgFrom({})));
});
test('selection: a passage’s questions are served back to back, in order, and do not repeat straight away', async () => {
  const { env } = freshEnv();
  const cfg = cfgFrom({ skills: { reading_between: { share: 100 } } });
  const m = { guest: false, classId: 1 };
  const v = pupil.visibleSql({ guest: false, classId: 1 });
  for (let round = 0; round < 6; round++) {
    const seq = [];
    for (let i = 0; i < 3; i++) {
      const q = await pickSkillQuestion(env, v, 85, cfg, m, new Set());
      seq.push(q);
    }
    const rows = await Promise.all(seq.map((q) => env.DB.prepare('SELECT data FROM questions WHERE id = ?1').bind(q.id).first()));
    const ds = rows.map((r) => JSON.parse(r.data));
    assert.equal(new Set(ds.map((d) => d.group)).size, 1, 'one passage');
    assert.deepEqual(ds.map((d) => d.pick), [1, 2, 1], 'a, b, c in order');
    assert.equal(new Set(seq.map((q) => q.id)).size, 3);
    assert.ok(m.sg && m.sg.d.length === 3);
  }
  // recent skill questions are not repeated while others are available
  const firsts = new Set();
  const m2 = { guest: false, classId: 1 };
  for (let i = 0; i < 12; i++) { const q = await pickSkillQuestion(env, v, 85, cfg, m2, new Set()); const d = JSON.parse((await env.DB.prepare('SELECT data FROM questions WHERE id = ?1').bind(q.id).first()).data); if (d.pick === 1 && d.stem.startsWith('How')) firsts.add(d.group); }
  assert.ok(firsts.size >= 3, 'different passages come up');
});
test('selection: an excluded question is not served, and a passage in progress stops when its skill is switched off', async () => {
  const { env } = freshEnv({ extra: false });
  const cfg = cfgFrom({ skills: { reading_between: { share: 100 } } });
  const v = pupil.visibleSql({ guest: false, classId: 1 });
  const m = {};
  const a = await pickSkillQuestion(env, v, 85, cfg, m, new Set());
  const b = await pickSkillQuestion(env, v, 85, cfg, m, new Set([a.id + 1])); // sibling b excluded: c is next
  assert.notEqual(b.id, a.id + 1);
  const off = cfgFrom({ skills: { reading_between: { on: false } } });
  assert.equal(await pickSkillQuestion(env, v, 85, off, m, new Set()), null);
  assert.equal(m.sg, null);
});
test('selection works for guests too (public questions only)', async () => {
  const { env, db } = freshEnv();
  const cfg = cfgFrom({ skills: { verb_choice: { share: 100 } } });
  const m = { guest: true, classId: null };
  const q = await pickQuestion(env, m, 25, new Set(), cfg);
  assert.equal(db.prepare('SELECT skill FROM questions WHERE id = ?').get(q.id).skill, 'verb_choice');
  db.exec("UPDATE questions SET public = 0 WHERE skill = 'verb_choice'");
  const q2 = await pickQuestion(env, { guest: true, classId: null }, 25, new Set(), cfg);
  assert.equal(db.prepare('SELECT skill FROM questions WHERE id = ?').get(q2.id).skill, null);
});

// solo play: the same selection through the real game routes
async function gameCall(env, action, body = {}) {
  const r = await game.route(new Request('https://x/api/game/' + action, { method: action === 'state' ? 'GET' : 'POST', body: action === 'state' ? undefined : JSON.stringify(body) }), env, P1, '/api/game/' + action, action === 'state' ? 'GET' : 'POST');
  return r.json();
}
test('solo play: skill questions follow the floor ranges and the teacher toggle', async () => {
  const { env, db } = freshEnv();
  const fk = {};
  for (let f = 1; f < 15; f++) { fk[f] = 5; fk['n' + f] = 5; }
  db.prepare('INSERT OR REPLACE INTO g_player (pupil_id, floor_kills) VALUES (1, ?)').run(JSON.stringify(fk));
  const run = async (floor, n) => {
    const skills = [];
    for (let i = 0; i < n; i++) {
      const v = await gameCall(env, 'start', { floor });
      const row = db.prepare('SELECT skill FROM questions WHERE id = ?').get(v.fight.q.id);
      skills.push(row.skill);
      for (const k of Object.keys(v.fight.q.p)) assert.ok(!SECRET_KEYS.includes(k), 'solo payload leaks ' + k);
      await gameCall(env, 'leave');
    }
    return skills;
  };
  const f15 = await run(15, 60);
  assert.ok(f15.some((s) => s === 'speaker_lines' || s === 'action_beat'), 'skills are served on floor 15');
  assert.ok(f15.every((s) => s === null || s === 'speaker_lines' || s === 'action_beat'), 'and only the skills for that floor');
  assert.ok((await run(10, 40)).every((s) => s === null), 'floor 10 is outside every skill');
  await game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify({ ...(await (await game.configView(env)).json()).cfg, skills: { speaker_lines: { on: false, share: 35, min: 11, max: 20 }, action_beat: { on: false, share: 35, min: 11, max: 20 } } }) }), env);
  assert.ok((await run(15, 40)).every((s) => s === null), 'switched off in the teacher console: none');
});

// ---------------------------------------------------------------- game config
test('configSave keeps skills tidy and configView sends the definitions', async () => {
  const { env } = freshEnv({ base: false, extra: false });
  const cfg0 = (await (await game.configView(env)).json());
  assert.deepEqual(Object.keys(cfg0.skillDefs), Object.keys(SKILLS));
  const save = (skills) => game.configSave(new Request('https://x', { method: 'PUT', body: JSON.stringify({ ...cfg0.cfg, skills }) }), env);
  await save({ reported: { on: false, share: 250, min: 70, max: 3 }, tense_fix: { share: 'abc' }, bogus: { on: true } });
  const c = (await (await game.configView(env)).json()).cfg.skills;
  assert.deepEqual(c.reported, { on: false, share: 100, min: 70, max: 70 });
  assert.equal(c.tense_fix.share, 35);
  assert.equal(c.tense_fix.on, true);
  assert.equal(c.bogus, undefined);
  assert.deepEqual(Object.keys(c), Object.keys(SKILLS));
});

// ---------------------------------------------------------------- migration
test('migrate-v1.6.sql upgrades an old database without losing anything', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, mode INTEGER NOT NULL, class_id INTEGER, public INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX questions_mode ON questions(mode, active);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, pupil_id INTEGER NOT NULL, class_id INTEGER, question_id INTEGER NOT NULL, mode INTEGER NOT NULL, try_no INTEGER NOT NULL DEFAULT 1, practice INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, answer TEXT, codes TEXT NOT NULL DEFAULT '[]', ts INTEGER NOT NULL);
    INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (1, NULL, 1, 1, '{"correct":"Raj said, “Hi.”","prompt":"Raj said Hi"}', 5), (2, 3, 0, 0, '{"x":1}', 6);
    INSERT INTO attempts (pupil_id, question_id, mode, correct, xp, ts) VALUES (1, 1, 1, 1, 10, 7);`);
  const before = db.prepare('SELECT * FROM questions ORDER BY id').all().map((r) => ({ ...r }));
  db.exec(file('migrate-v1.6.sql'));
  db.exec(file('migrate-v1.8.sql')); // the seed files fill the v1.8 `rules` column too
  const after = db.prepare('SELECT * FROM questions ORDER BY id').all().map((r) => ({ ...r }));
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) assert.deepEqual({ ...after[i], skill: undefined, min_floor: undefined, max_floor: undefined, rules: undefined }, { ...before[i], skill: undefined, min_floor: undefined, max_floor: undefined, rules: undefined });
  for (const r of after) { assert.equal(r.skill, null); assert.equal(r.min_floor, null); assert.equal(r.max_floor, null); assert.equal(r.rules, null); }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attempts').get().n, 1);
  // and the new seed files then load into it
  db.exec(file('seed-skills.sql'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 11);
  // the fresh schema has the same columns
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(file('schema.sql'));
  const cols = (d) => d.prepare('PRAGMA table_info(questions)').all().map((c) => c.name).sort();
  assert.deepEqual(cols(fresh), cols(db));
  // schema.sql stays safe to re-run on an upgraded database
  assert.doesNotThrow(() => db.exec(file('schema.sql')));
});
test('questions from before v1.6 (no skill) keep working in play', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, mode INTEGER NOT NULL, class_id INTEGER, public INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO questions (mode, data, created_at) VALUES (1, '{"correct":"Raj said, “Hi.”","prompt":"Raj said Hi"}', 1);`);
  db.exec(file('migrate-v1.6.sql'));
  const env = { DB: d1(db) };
  for (const floor of [1, 15, 85]) assert.equal((await pickQuestion(env, { guest: false, classId: 1 }, floor, new Set(), cfgFrom(null))).mode, 1);
});

// ---------------------------------------------------------------- rules and codes
test('every new code has a rule with a tip, and the tips are the ones from the brief', () => {
  for (const c of ['NO_NEW_LINE', 'EXTRA_NEW_LINE', 'BEAT_COMMA', 'RS_PRONOUN', 'RS_TENSE', 'RS_TIME', 'RS_QUOTES', 'RS_FORM', 'DS_PRONOUN', 'DS_TENSE', 'DS_TIME', 'DS_FORM', 'TENSE_TAP', 'TENSE_FIX', 'MC_VERB', 'MC_INFER']) {
    assert.ok(CODES[c] && CODES[c].label && RULES[CODES[c].rule] && RULES[CODES[c].rule].tip, c);
  }
  assert.equal(RULES[8].tip, 'A new speaker means a new line. It’s how readers keep track of who’s talking.');
  assert.equal(RULES[9].tip, 'Looking isn’t a saying verb, so that sentence ends with a full stop. The speech starts fresh, and the saying verb comes after the comma inside the speech marks.');
  assert.equal(RULES[10].tip, 'In reported speech the tense steps back (am going becomes was going) and I becomes she.');
  assert.equal(RULES[11].tip, 'Go back to the speaker’s own words: she would becomes I will, and the next day becomes tomorrow.');
  assert.equal(RULES[12].tip, 'Keep the verbs in the same time. The story is in the past, so sees should be saw.');
  for (const s of Object.values(SKILLS)) assert.ok(s.n && s.modes.length);
  // the new codes are not hidden, so they show in the pupil's rule summary and the analytics
  assert.ok(Object.values(CODES).filter((c) => c.rule >= 8).every((c) => !c.hidden));
});

// ---------------------------------------------------------------- teacher API
const tcall = async (env, method, path, body) => {
  const url = new URL('https://x/api/t' + path);
  try {
    const r = await teacherRoute(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, url, { admin: true });
    return { status: r.status, body: await r.json() };
  } catch (e) {
    if (e.status) return { status: e.status, body: { error: e.message } };
    throw e;
  }
};
test('teacher: new modes are validated, previewed, created, edited and removed', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const bad = async (mode, data, extra, re) => { const r = await tcall(env, 'POST', '/questions/preview', { mode, data, ...extra }); assert.equal(r.body.ok, false); assert.match(r.body.problem, re); };
  await bad(4, { stem: 'Q?', options: 'a\nb', correct: '', explanation: 'e' }, { skill: 'verb_choice' }, /correct/i);
  await bad(4, { stem: 'Q?', options: 'a\nb\nc', correct: '1,2', pick: 3, explanation: 'e' }, { skill: 'verb_choice' }, /more than/);
  await bad(4, { stem: 'Q?', options: 'a\na', correct: '1', explanation: 'e' }, { skill: 'verb_choice' }, /different/);
  await bad(4, { stem: 'Q?', options: 'a\nb', correct: '1', explanation: 'e' }, {}, /skill/i);
  await bad(4, { stem: 'Q?', options: 'a\nb', correct: '1', explanation: 'e' }, { skill: 'tense_fix' }, /Mode/);
  await bad(5, { prompt: 'Brisk said she was going.', accepted: ['Brisk said she was going.'] }, { skill: 'reported' }, /already/);
  await bad(6, { sentence: 'The knight walked into the hall and sees a crown.', wrong: ['sleeps'], fixes: ['saw'] }, { skill: 'tense_fix' }, /isn’t in the sentence/);
  const ok = await tcall(env, 'POST', '/questions', { mode: 4, skill: 'verb_choice', data: { stem: '"Go!" said the guard. Which verb is best?', options: ['murmured', 'barked', 'sang'], correct: '2', explanation: 'Orders are barked.' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.preview.options.map((o) => o.correct), [false, true, false]);
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(ok.body.id);
  assert.equal(row.skill, 'verb_choice');
  assert.match(JSON.parse(row.data).stem, /^“Go!” said/, 'stored with typographic quotes');
  const put = await tcall(env, 'PUT', '/questions/' + ok.body.id, { data: { stem: 'Q2?', options: ['x', 'y'], correct: '1', explanation: 'z' }, skill: 'reading_between', min_floor: 82, max_floor: 88 });
  assert.equal(put.status, 200);
  const r2 = db.prepare('SELECT skill, min_floor, max_floor FROM questions WHERE id = ?').get(ok.body.id);
  assert.deepEqual({ ...r2 }, { skill: 'reading_between', min_floor: 82, max_floor: 88 });
  const list = await tcall(env, 'GET', '/questions?mode=4');
  assert.equal(list.body.questions.length, 5, 'the four seeded Mode 4 questions plus this one');
  assert.equal(list.body.questions.find((q) => q.id === ok.body.id).skill, 'reading_between');
  assert.equal((await tcall(env, 'DELETE', '/questions/' + ok.body.id)).status, 200);
  assert.equal((await tcall(env, 'GET', '/questions?mode=4')).body.questions.length, 4);
  const m5 = await tcall(env, 'POST', '/questions', { mode: 5, skill: 'reported', data: { prompt: '“I am late,” said Tally.', accepted: ['Tally said (that) she was late.'], traps: [{ words: ['i'], code: 'RS_PRONOUN' }, { words: ['x'], code: 'NOT_A_CODE' }] } });
  assert.deepEqual(m5.body.preview.accepted.sort(), ['Tally said she was late.', 'Tally said that she was late.']);
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM questions WHERE id = ?').get(m5.body.id).data).traps, [{ words: ['i'], code: 'RS_PRONOUN' }]);
  const m6 = await tcall(env, 'POST', '/questions', { mode: 6, skill: 'tense_fix', data: { sentence: 'Raj opened the gate and walks in.', wrong: ['walks'], fixes: ['walked'] } });
  assert.equal(m6.body.preview.corrected, 'Raj opened the gate and walked in.');
});
test('teacher: a lines question gets its skill and a joined prompt; an old-style Mode 1 question is unchanged', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const r = await tcall(env, 'POST', '/questions', { mode: 1, data: { correct: '"Is it open?" asked Noor.\n"Yes," said Chen.', lines: true, instruction: 'Give each speaker their own line.' } });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT skill, data FROM questions WHERE id = ?').get(r.body.id);
  assert.equal(row.skill, 'speaker_lines');
  const d = JSON.parse(row.data);
  assert.equal(d.lines, true);
  assert.equal(d.prompt, '“Is it open?” asked Noor. “Yes,” said Chen.');
  assert.equal(d.correct, '“Is it open?” asked Noor.\n“Yes,” said Chen.');
  const one = await tcall(env, 'POST', '/questions', { mode: 1, data: { correct: '“Is it open?” asked Noor. “Yes,” said Chen.', lines: true } });
  assert.equal(one.status, 400);
  const old = await tcall(env, 'POST', '/questions', { mode: 1, data: { correct: 'Raj said, “I want to be a doctor.”' } });
  assert.equal(db.prepare('SELECT skill FROM questions WHERE id = ?').get(old.body.id).skill, null);
  assert.deepEqual(Object.keys(JSON.parse(db.prepare('SELECT data FROM questions WHERE id = ?').get(old.body.id).data)).sort(), ['alts', 'correct', 'prompt']);
});
test('teacher: editing a seeded question keeps its seed id', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  const q = qBySeed(db, 'sk-core-4c');
  await tcall(env, 'PUT', '/questions/' + q.id, { data: { sentence: 'The knight walked into the hall and sees a gold crown.', wrong: ['sees'], fixes: ['saw'] }, skill: 'tense_fix' });
  assert.equal(JSON.parse(db.prepare('SELECT data FROM questions WHERE id = ?').get(q.id).data).seed, 'sk-core-4c');
});
test('teacher analytics: accuracy by skill, and the new rules appear as columns', async () => {
  const { env, db } = freshEnv({ base: true, extra: false });
  const ins = (q, correct, codes = []) => db.prepare('INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, correct, xp, codes, ts) VALUES (1, 1, ?, ?, 1, ?, 0, ?, ?)').run(q.id, q.mode, correct, JSON.stringify(codes), Date.now());
  const mc = qBySeed(db, 'sk-core-2a'), tf = qBySeed(db, 'sk-core-4c'), base = db.prepare('SELECT id, mode FROM questions WHERE skill IS NULL LIMIT 1').get();
  ins(mc, 1); ins(mc, 0, ['MC_VERB']); ins(tf, 0, ['TENSE_TAP']); ins(base, 1);
  const r = await tcall(env, 'GET', '/analytics?class=1&days=30');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.bySkill.map((s) => [s.skill, s]));
  assert.deepEqual([by.verb_choice.tries, by.verb_choice.right], [2, 1]);
  assert.deepEqual([by.tense_fix.tries, by.tense_fix.right], [1, 0]);
  assert.deepEqual([by.dialogue.tries, by.dialogue.right], [1, 1]);
  assert.equal(by.verb_choice.name, SKILLS.verb_choice.n);
  const pu = r.body.pupils.find((p) => p.id === 1);
  assert.deepEqual(pu.bySkill.verb_choice, { n: 2, c: 1 });
  assert.equal(pu.counts.MC_VERB, 1);
  assert.equal(pu.counts.TENSE_TAP, 1);
  const labels = r.body.codes.map((c) => c.code);
  for (const c of ['NO_NEW_LINE', 'BEAT_COMMA', 'RS_TENSE', 'DS_TIME', 'TENSE_FIX', 'MC_INFER']) assert.ok(labels.includes(c), c);
});

test('pupil progress counts the new rules in the rule-error summary', async () => {
  const { env, db } = freshEnv({ base: false, extra: false });
  await ans(env, { qid: qBySeed(db, 'sk-core-1a').id, answer: ONE_LINE, tryNo: 1 });
  await ans(env, { qid: qBySeed(db, 'sk-core-2a').id, picked: ['a'] });
  const me = await (await pupil.me(env, P1)).json();
  assert.equal(me.ruleErrors[8], 1);
  assert.equal(me.ruleErrors[7], 1);
  const meta = await (await pupil.meta()).json();
  assert.ok(meta.rules[8] && meta.rules[13] && meta.skills.reported);
});
