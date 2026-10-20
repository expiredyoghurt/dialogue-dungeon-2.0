// Teacher console API (everything under /api/t/*), plus teacher sign-in.

import { CODES, TAGS, HIDDEN_CODES } from './rules.js';
import { prepare, buildSlots, stripToPrompt, diffTokens, tokenize, normalizeText, displayText, describeSlot, checkMode1 } from './engine.js';
import { saveVerb, writeForms, cleanTags, cleanWord, validWord, regularPast } from './verbs.js';
import { signToken, safeEqual, teacherConfigured, newClassCode, checkPassword } from './auth.js';
import * as accounts from './accounts.js';
import { isAdmin, adminOnly, ownClass, ownPupil, guestsOnlyAdmin, cleanLogin } from './accounts.js';
import { HttpError, json, readJson, clientIp, rateLimited, clip, int, cleanUser, validUser, suggestUsername } from './util.js';
import { SKILLS, isSkill, validateMC, validateTransform, validateTense, mode1Extras, linesPrompt, expandOptional, modelTransform, correctedSentence, skillText } from './skills.js';

import { configView, configSave } from './game.js';
import * as feedback from './feedback.js';
import * as players from './players.js';
import * as practice from './practice.js';
export async function teacherLogin(request, env) {
  if (!teacherConfigured(env)) throw new HttpError(503, 'Teacher sign-in is not set up yet. Set the teacher_user and teacher_password secrets in Cloudflare.');
  if (await rateLimited(env, 'RL_LOGIN', clientIp(request))) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
  const body = await readJson(request);
  const username = clip(body.username, 100), password = clip(body.password, 200);
  // 1) the admin (superadmin): the teacher_user / teacher_password secrets
  const [u, p] = await Promise.all([safeEqual(username, env.teacher_user), safeEqual(password, env.teacher_password)]);
  if (u && p) return json({ token: await signToken(env, { r: 't', role: 'admin' }, 8 * 3600), role: 'admin', name: 'Admin' });
  // 2) a teacher account made by the admin
  await accounts.ensure(env);
  const t = await env.DB.prepare('SELECT id, name, pw_hash, active, sess_ver FROM teachers WHERE username = ?1').bind(cleanLogin(username)).first();
  const good = await checkPassword(password, t ? t.pw_hash : null); // same work whether or not the account exists
  if (!t || !good) throw new HttpError(401, 'Wrong username or password.');
  if (!t.active) throw new HttpError(403, 'This account has been switched off. Ask the admin.');
  await env.DB.prepare('UPDATE teachers SET last_login = ?1 WHERE id = ?2').bind(Date.now(), t.id).run();
  return json({ token: await signToken(env, { r: 't', role: 'teacher', tid: t.id, sv: t.sess_ver }, 8 * 3600), role: 'teacher', name: t.name });
}

const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

// ---------- classes & pupils ----------

async function listClasses(env, actor) {
  const rows = (
    await env.DB
      .prepare(
        `SELECT c.id, c.name, c.code, c.archived, c.created_at, c.teacher_id, t.name AS teacher_name,
                (SELECT COUNT(*) FROM pupils p WHERE p.class_id = c.id) AS pupils
           FROM classes c LEFT JOIN teachers t ON t.id = c.teacher_id
          ${isAdmin(actor) ? '' : 'WHERE c.teacher_id = ?1'} ORDER BY c.archived, c.name`,
      )
      .bind(...(isAdmin(actor) ? [] : [actor.id]))
      .all()
  ).results;
  const guests = isAdmin(actor) ? (await env.DB.prepare('SELECT COUNT(*) AS n FROM pupils WHERE is_guest = 1').first()).n : 0;
  return json({ classes: rows, guests });
}

// Admin only: who owns a class. null = the admin.
async function ownerId(env, v) {
  if (v === null || v === '' || v === 0 || v === '0') return null;
  const t = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?1').bind(int(v, 0)).first();
  if (!t) throw new HttpError(400, 'That teacher doesn’t exist.');
  return t.id;
}

async function createClass(request, env, actor) {
  const body = await readJson(request);
  const name = clip(body.name, 60).trim();
  if (!name) throw new HttpError(400, 'Give the class a name.');
  const owner = isAdmin(actor) ? (body.teacher_id ? await ownerId(env, body.teacher_id) : null) : actor.id;
  for (let i = 0; i < 12; i++) {
    try {
      const row = await env.DB.prepare('INSERT INTO classes (name, code, created_at, teacher_id) VALUES (?1, ?2, ?3, ?4) RETURNING id, name, code').bind(name, newClassCode(), Date.now(), owner).first();
      return json({ class: row });
    } catch (e) {
      if (!/UNIQUE/i.test(String(e?.message))) throw e;
    }
  }
  throw new HttpError(500, 'Could not create a unique class code. Try again.');
}

async function updateClass(request, env, id, actor) {
  await ownClass(env, actor, id);
  const body = await readJson(request);
  if (body.teacher_id !== undefined) {
    adminOnly(actor);
    await env.DB.prepare('UPDATE classes SET teacher_id = ?1 WHERE id = ?2').bind(await ownerId(env, body.teacher_id), id).run();
  }
  if (body.name !== undefined) {
    const name = clip(body.name, 60).trim();
    if (!name) throw new HttpError(400, 'Give the class a name.');
    await env.DB.prepare('UPDATE classes SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (body.archived !== undefined) {
    await env.DB.prepare('UPDATE classes SET archived = ?1, sess_ver = sess_ver + 1 WHERE id = ?2').bind(body.archived ? 1 : 0, id).run();
  }
  return json({ ok: true });
}

async function regenCode(request, env, id, actor) {
  await ownClass(env, actor, id);
  const body = await readJson(request);
  for (let i = 0; i < 12; i++) {
    try {
      const code = newClassCode();
      const row = await env.DB
        .prepare(`UPDATE classes SET code = ?1${body.signOut ? ', sess_ver = sess_ver + 1' : ''} WHERE id = ?2 RETURNING code`)
        .bind(code, id)
        .first();
      if (!row) throw new HttpError(404, 'Class not found.');
      return json({ code: row.code, signedOut: !!body.signOut });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!/UNIQUE/i.test(String(e?.message))) throw e;
    }
  }
  throw new HttpError(500, 'Could not create a unique class code. Try again.');
}

async function deleteClass(env, id, actor) {
  await ownClass(env, actor, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE class_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM pupils WHERE class_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM classes WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true });
}

async function listPupils(env, classId, actor) {
  await ownClass(env, actor, classId);
  const rows = (
    await env.DB
      .prepare(
        `SELECT p.id, p.name, p.username, COUNT(a.id) AS attempts, COALESCE(SUM(a.xp), 0) AS xp, MAX(a.ts) AS last_active
           FROM pupils p LEFT JOIN attempts a ON a.pupil_id = p.id
          WHERE p.class_id = ?1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
      )
      .bind(classId)
      .all()
  ).results;
  return json({ pupils: rows });
}

// Turns pasted lines ("Raj Tan" or "Raj Tan, rajt") into proposed pupils, checking for clashes.
async function previewPupils(request, env, classId, actor) {
  await ownClass(env, actor, classId);
  const body = await readJson(request);
  const lines = String(body.text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200);
  const existing = new Set((await env.DB.prepare('SELECT username FROM pupils WHERE class_id = ?1').bind(classId).all()).results.map((r) => r.username));
  const taken = new Set(existing);
  const out = [];
  for (const line of lines) {
    if (/^(name|pupil|student)\b.*,\s*(username|user)/i.test(line)) continue; // header row
    const [rawName, rawUser] = line.split(/[,\t;]/).map((s) => s.trim());
    const name = clip(rawName, 60);
    if (!name) continue;
    let username = cleanUser(rawUser || '');
    let status = 'ok';
    if (username) {
      if (!validUser(username)) status = 'invalid';
      else if (taken.has(username)) status = 'duplicate';
    } else username = suggestUsername(name, taken);
    if (status === 'ok') taken.add(username);
    out.push({ name, username, status });
  }
  return json({ rows: out });
}

async function addPupils(request, env, classId, actor) {
  await ownClass(env, actor, classId);
  const body = await readJson(request);
  const list = Array.isArray(body.pupils) ? body.pupils.slice(0, 200) : [];
  const cls = await env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(classId).first();
  if (!cls) throw new HttpError(404, 'Class not found.');
  const existing = new Set((await env.DB.prepare('SELECT username FROM pupils WHERE class_id = ?1').bind(classId).all()).results.map((r) => r.username));
  const stmts = [];
  const skipped = [];
  let added = 0;
  for (const p of list) {
    const name = clip(p.name, 60).trim();
    const username = cleanUser(p.username);
    if (!name || !validUser(username)) {
      skipped.push({ name: name || '(blank)', reason: 'invalid username' });
      continue;
    }
    if (existing.has(username)) {
      skipped.push({ name, reason: 'username already used in this class' });
      continue;
    }
    existing.add(username);
    stmts.push(env.DB.prepare('INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?1, ?2, ?3, 0, ?4)').bind(classId, name, username, Date.now()));
    added++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ added, skipped });
}

async function updatePupil(request, env, id, actor) {
  await ownPupil(env, actor, id);
  const body = await readJson(request);
  const p = await env.DB.prepare('SELECT id, class_id FROM pupils WHERE id = ?1 AND is_guest = 0').bind(id).first();
  if (!p) throw new HttpError(404, 'Pupil not found.');
  if (body.name !== undefined) {
    const name = clip(body.name, 60).trim();
    if (!name) throw new HttpError(400, 'Name can’t be blank.');
    await env.DB.prepare('UPDATE pupils SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (body.username !== undefined) {
    const u = cleanUser(body.username);
    if (!validUser(u)) throw new HttpError(400, 'Usernames use 2–24 letters, numbers, dots, dashes or underscores.');
    try {
      await env.DB.prepare('UPDATE pupils SET username = ?1 WHERE id = ?2').bind(u, id).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, 'Another pupil in this class already has that username.');
      throw e;
    }
  }
  return json({ ok: true });
}

async function deletePupil(env, id, actor) {
  await ownPupil(env, actor, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id), env.DB.prepare('DELETE FROM pupils WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}
async function resetPupil(env, id, actor) {
  await ownPupil(env, actor, id);
  await env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id).run();
  return json({ ok: true });
}

// ---------- questions ----------

function validateQuestion(mode, input, { lowerFirst } = {}) {
  const d = input || {};
  if (mode === 1) {
    const correct = clip(d.correct, 500).trim();
    if (!correct) throw new HttpError(400, 'Type the correct sentence.');
    const tk = prepare(correct);
    if (tk.words.length < 3) throw new HttpError(400, 'The sentence is too short.');
    if (!tk.info.some((i) => i.quotes.length)) throw new HttpError(400, 'The correct sentence needs speech marks around the spoken words.');
    if (tk.info.reduce((n, i) => n + i.quotes.length, 0) % 2) throw new HttpError(400, 'The correct sentence has an unmatched speech mark.');
    const extras = mode1Extras(d, correct); // lines (one speaker per line), beat (action beat + speech tag), instruction, group
    const prompt = clip(d.prompt, 500).trim() || (extras.lines ? linesPrompt(correct) : stripToPrompt(correct, { lowerFirstSpoken: !!lowerFirst }));
    const alts = (Array.isArray(d.alts) ? d.alts : []).map((a) => clip(a, 500).trim()).filter(Boolean).slice(0, 6);
    for (const a of alts) {
      const r = diffTokens(tk, tokenize(normalizeText(a).text));
      if (!r.aligned) throw new HttpError(400, `The alternative “${a}” must use the same words as the correct sentence.`);
    }
    // keys of the new flagged kinds are stored with typographic quotes
    const data = { correct: extras.lines || extras.beat ? displayText(correct, true) : correct, prompt, alts, ...extras };
    if (checkMode1({ correct, alts: [], lines: !!extras.lines, beat: !!extras.beat }, prompt).correct) throw new HttpError(400, 'The prompt is already correct — it should be missing punctuation' + (extras.lines ? ' or its line break.' : '.'));
    return data;
  }
  if (mode === 2) {
    const correct = clip(d.correct, 700).trim();
    const faulty = clip(d.faulty, 700).trim();
    if (!correct || !faulty) throw new HttpError(400, 'Enter both the correct version and the faulty version.');
    const r = buildSlots(correct, faulty);
    if (!r.valid) throw new HttpError(400, r.reason);
    return { correct, faulty };
  }
  if (mode === 3) {
    const speaker = clip(d.speaker, 40).trim();
    const line = clip(d.line, 200).trim();
    if (!speaker || !line) throw new HttpError(400, 'Enter the speaker and the line of speech.');
    if (!/[,.!?]$/.test(line)) throw new HttpError(400, 'End the line with punctuation (usually a comma, or ! or ?).');
    const target = cleanTags(d.target);
    if (!target.length) throw new HttpError(400, 'Choose at least one feeling/volume tag the verb must show.');
    return { speaker, line, context: clip(d.context, 300).trim(), target: target.slice(0, 4) };
  }
  if (mode === 4) return validateMC(d);
  if (mode === 5) return validateTransform(d);
  if (mode === 6) return validateTense(d);
  throw new HttpError(400, 'Unknown question type.');
}

// skill / min_floor / max_floor live in columns, not in the data. Modes 4-6 must have a skill (they are only ever served through one);
// a Mode 1 question flagged lines or beat gets its skill automatically.
function qMeta(body, mode, data) {
  let skill = body.skill == null || body.skill === '' || body.skill === 'dialogue' ? null : String(body.skill);
  if (!skill && mode === 1) skill = data.lines ? 'speaker_lines' : data.beat ? 'action_beat' : null;
  if (skill && !isSkill(skill)) throw new HttpError(400, 'Unknown skill.');
  if (skill && !SKILLS[skill].modes.includes(mode)) throw new HttpError(400, `“${SKILLS[skill].n}” is for Mode ${SKILLS[skill].modes.join(' / ')} questions.`);
  if (mode >= 4 && !skill) throw new HttpError(400, 'Choose a skill: it decides which floors the question appears on.');
  const fl = (v) => (v === '' || v == null ? null : Math.min(100, Math.max(1, Math.round(Number(v)) || 1)));
  const min = fl(body.min_floor), max = fl(body.max_floor);
  if (min != null && max != null && max < min) throw new HttpError(400, 'The last floor can’t be before the first floor.');
  return { skill, min, max };
}

function preview(mode, data) {
  if (mode === 1) return { prompt: data.prompt, answer: displayText(data.correct, true), lines: !!data.lines, beat: !!data.beat };
  if (mode === 4) return { stem: data.stem, context: data.context || '', passage: data.passage || '', pick: data.pick, options: data.options.map((o, i) => ({ label: String.fromCharCode(65 + i), text: o.text, correct: data.correct.includes(o.id) })), explanation: data.explanation };
  if (mode === 5) return { prompt: data.prompt, instruction: data.instruction, accepted: [...new Set(data.accepted.flatMap(expandOptional).map((a) => displayText(a.replace(/\s+/g, ' ').trim(), true)))], model: modelTransform(data) };
  if (mode === 6) return { sentence: displayText(data.sentence), wrong: data.wrong, fixes: data.fixes, corrected: correctedSentence(data) };
  if (mode === 2) {
    const r = buildSlots(data.correct, data.faulty);
    return {
      mistakes: r.slots.map((s) => ({ summary: describeSlot(r.cTk, s), codes: s.errors.map((e) => e.code) })),
      faulty: displayText(data.faulty),
      correct: displayText(data.correct, true),
    };
  }
  return { sentence: displayText(`"${data.line}" ${'____'} ${data.speaker}.`, true) };
}

async function listQuestions(env, url, actor) {
  const mode = int(url.searchParams.get('mode'), 0);
  // a teacher sees the shared questions (read only) and the questions made for their own classes
  const where = [1, 2, 3, 4, 5, 6].includes(mode) ? `WHERE q.mode = ${mode} AND q.active = 1` : 'WHERE q.active = 1';
  const mine = isAdmin(actor) ? '' : ' AND (q.class_id IS NULL OR q.class_id IN (SELECT id FROM classes WHERE teacher_id = ?1))';
  const rows = (
    await env.DB
      .prepare(
        `SELECT q.id, q.mode, q.class_id, q.public, q.data, q.created_at, q.skill, q.min_floor, q.max_floor, c.name AS class_name,
                COALESCE(s.n, 0) AS tries, COALESCE(s.c, 0) AS right
           FROM questions q
           LEFT JOIN classes c ON c.id = q.class_id
           LEFT JOIN (SELECT question_id, COUNT(*) AS n, SUM(correct) AS c FROM attempts WHERE try_no = 1 GROUP BY question_id) s ON s.question_id = q.id
          ${where}${mine} ORDER BY q.mode, q.id`,
      )
      .bind(...(isAdmin(actor) ? [] : [actor.id]))
      .all()
  ).results;
  return json({ questions: rows.map((r) => ({ ...r, data: parse(r.data, {}) })) });
}

async function classScope(env, body, actor) {
  const classId = body.class_id ? int(body.class_id, 0) : null;
  if (classId) {
    const c = await env.DB.prepare('SELECT id, teacher_id FROM classes WHERE id = ?1').bind(classId).first();
    if (!c || (!isAdmin(actor) && c.teacher_id !== actor.id)) throw new HttpError(400, 'That class doesn’t exist.');
  } else if (!isAdmin(actor)) throw new HttpError(403, 'Choose one of your classes. Only the admin can make a question for every class.');
  return { classId, pub: body.public === false ? 0 : 1 };
}

// A teacher may only change a question made for one of their own classes.
async function ownQuestionClass(env, actor, classId) {
  if (isAdmin(actor)) return;
  const c = classId ? await env.DB.prepare('SELECT teacher_id FROM classes WHERE id = ?1').bind(classId).first() : null;
  if (!c || c.teacher_id !== actor.id) throw new HttpError(403, 'That question is shared by every class. Only the admin can change it.');
}

async function createQuestion(request, env, actor) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const data = validateQuestion(mode, body.data, { lowerFirst: body.lowerFirst });
  const meta = qMeta(body, mode, data);
  const { classId, pub } = await classScope(env, body, actor);
  const row = await env.DB
    .prepare('INSERT INTO questions (mode, class_id, public, active, data, created_at, skill, min_floor, max_floor, rules) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id')
    .bind(mode, classId, pub, JSON.stringify(data), Date.now(), meta.skill, meta.min, meta.max, practice.maskFor(mode, data, meta.skill))
    .first();
  return json({ id: row.id, preview: preview(mode, data) });
}

async function updateQuestion(request, env, id, actor) {
  const body = await readJson(request);
  const q = await env.DB.prepare('SELECT id, mode, data, skill, min_floor, max_floor, class_id FROM questions WHERE id = ?1').bind(id).first();
  if (!q) throw new HttpError(404, 'Question not found.');
  await ownQuestionClass(env, actor, q.class_id);
  const old = JSON.parse(q.data);
  const data = body.data ? validateQuestion(q.mode, body.data, { lowerFirst: body.lowerFirst }) : old;
  if (old.seed) data.seed = old.seed; // keeps the seed id, so re-running a seed file never adds a second copy
  const hasMeta = 'skill' in body || 'min_floor' in body || 'max_floor' in body;
  const meta = hasMeta ? qMeta(body, q.mode, data) : { skill: q.skill, min: q.min_floor, max: q.max_floor };
  const { classId, pub } = await classScope(env, body, actor);
  await env.DB.prepare('UPDATE questions SET data = ?1, class_id = ?2, public = ?3, skill = ?4, min_floor = ?5, max_floor = ?6, rules = ?7 WHERE id = ?8').bind(JSON.stringify(data), classId, pub, meta.skill, meta.min, meta.max, practice.maskFor(q.mode, data, meta.skill), id).run();
  return json({ ok: true, preview: preview(q.mode, data) });
}

async function previewQuestion(request) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  try {
    const data = validateQuestion(mode, body.data, { lowerFirst: body.lowerFirst });
    qMeta(body, mode, data);
    return json({ ok: true, data, preview: preview(mode, data) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, problem: e.message });
    throw e;
  }
}

async function importQuestions(request, env, actor) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  const { classId, pub } = await classScope(env, body, actor);
  const stmts = [];
  const problems = [];
  rows.forEach((r, i) => {
    try {
      const data = validateQuestion(mode, r, { lowerFirst: r.lowerFirst || body.lowerFirst });
      const meta = qMeta({ skill: r.skill ?? body.skill, min_floor: r.min_floor ?? body.min_floor, max_floor: r.max_floor ?? body.max_floor }, mode, data);
      stmts.push(env.DB.prepare('INSERT INTO questions (mode, class_id, public, active, data, created_at, skill, min_floor, max_floor, rules) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9)').bind(mode, classId, pub, JSON.stringify(data), Date.now(), meta.skill, meta.min, meta.max, practice.maskFor(mode, data, meta.skill)));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      problems.push({ row: i + 1, problem: e.message });
    }
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ added: stmts.length, problems });
}

// ---------- verb bank ----------

const verbRow = (r) => ({ id: r.id, base: r.base, past: r.past, tags: parse(r.tags, []), banned: !!r.banned, source: r.source });

async function listVerbs(env) {
  const rows = (await env.DB.prepare('SELECT id, base, past, tags, banned, source FROM verbs ORDER BY banned DESC, base').all()).results;
  const pending = (await env.DB.prepare("SELECT COUNT(*) AS n FROM verb_ai WHERE status IN ('pending','ai_ok')").first()).n;
  return json({ verbs: rows.map(verbRow), pending, tags: TAGS });
}

async function createVerb(request, env) {
  const body = await readJson(request);
  const base = cleanWord(body.base);
  const past = cleanWord(body.past) || (validWord(base) ? regularPast(base) : '');
  try {
    const id = await saveVerb(env.DB, { base, past, tags: body.tags, banned: body.banned, source: 'teacher' });
    return json({ id });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

async function updateVerb(request, env, id) {
  const body = await readJson(request);
  const base = cleanWord(body.base);
  const past = cleanWord(body.past);
  if (!validWord(base) || !validWord(past)) throw new HttpError(400, 'Enter the base form and the past tense, e.g. whisper / whispered.');
  const r = await env.DB.prepare('UPDATE verbs SET base = ?1, past = ?2, tags = ?3, banned = ?4 WHERE id = ?5 RETURNING id').bind(base, past, JSON.stringify(cleanTags(body.tags)), body.banned ? 1 : 0, id).first();
  if (!r) throw new HttpError(404, 'Verb not found.');
  await writeForms(env.DB, id, base, past);
  return json({ ok: true });
}

async function deleteVerb(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM verb_forms WHERE verb_id = ?1').bind(id), env.DB.prepare('DELETE FROM verbs WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}

async function importVerbs(request, env) {
  const body = await readJson(request);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
  let added = 0;
  const problems = [];
  for (const [i, r] of rows.entries()) {
    const base = cleanWord(r.base);
    const past = cleanWord(r.past) || (validWord(base) ? regularPast(base) : '');
    const have = await env.DB.prepare('SELECT 1 AS x FROM verb_forms WHERE form = ?1').bind(base).first();
    if (have) {
      problems.push({ row: i + 1, problem: `${base} is already in the bank` });
      continue;
    }
    try {
      await saveVerb(env.DB, { base, past, tags: Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[|;\s]+/), source: 'teacher' });
      added++;
    } catch (e) {
      problems.push({ row: i + 1, problem: e.message });
    }
  }
  return json({ added, problems });
}

async function reviewList(env) {
  const rows = (await env.DB.prepare("SELECT * FROM verb_ai WHERE status IN ('pending','ai_ok') ORDER BY ts DESC LIMIT 100").all()).results;
  const rej = (await env.DB.prepare("SELECT word, reason, ts FROM verb_ai WHERE status IN ('auto_rejected','rejected') ORDER BY ts DESC LIMIT 40").all()).results;
  return json({
    items: rows.map((r) => ({ word: r.word, base: r.base, past: r.past, tags: parse(r.tags, []), conf: r.conf, reason: r.reason, status: r.status, ts: r.ts })),
    rejected: rej,
  });
}

async function reviewAct(request, env, word, action) {
  const w = cleanWord(word);
  const row = await env.DB.prepare('SELECT * FROM verb_ai WHERE word = ?1').bind(w).first();
  if (!row) throw new HttpError(404, 'That word isn’t in the review list.');
  if (action === 'approve') {
    const body = await readJson(request);
    const base = cleanWord(body.base || row.base || w);
    const past = cleanWord(body.past || row.past || (validWord(base) ? regularPast(base) : w));
    const tags = cleanTags(body.tags && body.tags.length ? body.tags : parse(row.tags, []));
    if (!tags.length) throw new HttpError(400, 'Choose at least one tag for this verb.');
    const have = await env.DB.prepare('SELECT verb_id FROM verb_forms WHERE form = ?1').bind(past).first();
    if (!have) await saveVerb(env.DB, { base, past, tags, source: 'ai' });
    await env.DB.prepare("UPDATE verb_ai SET status = 'approved' WHERE word = ?1").bind(w).run();
  } else if (action === 'reject') {
    await env.DB.prepare("UPDATE verb_ai SET status = 'rejected' WHERE word = ?1").bind(w).run();
  } else if (action === 'reset') {
    await env.DB.prepare('DELETE FROM verb_ai WHERE word = ?1').bind(w).run();
  }
  return json({ ok: true });
}

// ---------- analytics ----------

async function analytics(env, url, actor) {
  const cls = url.searchParams.get('class');
  const days = Math.min(Math.max(int(url.searchParams.get('days'), 30), 1), 365);
  const since = Date.now() - days * 86_400_000;
  const classId = cls === 'guests' ? null : int(cls, 0);
  if (cls !== 'guests' && !classId) throw new HttpError(400, 'Choose a class.');
  if (cls === 'guests') guestsOnlyAdmin(actor); else await ownClass(env, actor, classId);

  const [errRows, attRows, pupRows, qRows, skRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT a.pupil_id, j.value AS code, COUNT(*) AS n
           FROM attempts a, json_each(a.codes) j
          WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2
          GROUP BY a.pupil_id, j.value`,
      )
      .bind(classId, since)
      .all(),
    env.DB
      .prepare('SELECT pupil_id, mode, COUNT(*) AS n, SUM(correct) AS c FROM attempts WHERE class_id IS ?1 AND try_no = 1 AND ts >= ?2 GROUP BY pupil_id, mode')
      .bind(classId, since)
      .all(),
    classId
      ? env.DB.prepare('SELECT id, name FROM pupils WHERE class_id = ?1 ORDER BY name COLLATE NOCASE').bind(classId).all()
      : env.DB.prepare('SELECT id, name FROM pupils WHERE is_guest = 1 ORDER BY id').all(),
    env.DB
      .prepare(
        `SELECT a.question_id AS id, q.mode, q.data, COUNT(*) AS n, SUM(a.correct) AS c
           FROM attempts a JOIN questions q ON q.id = a.question_id
          WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2
          GROUP BY a.question_id HAVING n >= 3 ORDER BY (1.0 * SUM(a.correct) / COUNT(*)) ASC, n DESC LIMIT 8`,
      )
      .bind(classId, since)
      .all(),
    env.DB
      .prepare(
        `SELECT a.pupil_id, COALESCE(q.skill, 'dialogue') AS skill, COUNT(*) AS n, SUM(a.correct) AS c
           FROM attempts a JOIN questions q ON q.id = a.question_id
          WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2
          GROUP BY a.pupil_id, COALESCE(q.skill, 'dialogue')`,
      )
      .bind(classId, since)
      .all(),
  ]);

  const pupils = new Map();
  for (const p of pupRows.results) pupils.set(p.id, { id: p.id, name: p.name, attempts: 0, correct: 0, byMode: {}, counts: {} });
  for (const r of attRows.results) {
    const p = pupils.get(r.pupil_id);
    if (!p) continue;
    p.attempts += r.n;
    p.correct += r.c || 0;
    p.byMode[r.mode] = { n: r.n, c: r.c || 0 };
  }
  const skills = new Map();
  for (const r of skRows.results) {
    const p = pupils.get(r.pupil_id);
    if (!p) continue;
    (p.bySkill ||= {})[r.skill] = { n: r.n, c: r.c || 0 };
    const t = skills.get(r.skill) || { skill: r.skill, name: r.skill === 'dialogue' ? 'Dialogue (core questions)' : (SKILLS[r.skill] || {}).n || r.skill, tries: 0, right: 0 };
    t.tries += r.n;
    t.right += r.c || 0;
    skills.set(r.skill, t);
  }
  const totals = {};
  for (const r of errRows.results) {
    const meta = CODES[r.code];
    if (!meta || HIDDEN_CODES.includes(r.code)) continue;
    const p = pupils.get(r.pupil_id);
    if (!p) continue;
    p.counts[r.code] = r.n;
    totals[r.code] = (totals[r.code] || 0) + r.n;
  }
  const codes = Object.entries(CODES)
    .filter(([c, m]) => !m.hidden)
    .map(([code, m]) => ({ code, label: m.label, rule: m.rule, total: totals[code] || 0 }));
  const hardest = qRows.results.map((r) => {
    const d = parse(r.data, {});
    return { id: r.id, mode: r.mode, text: r.mode === 2 ? d.faulty : r.mode === 3 ? `${d.line} ${d.speaker}` : skillText(r.mode, d), tries: r.n, right: r.c || 0 };
  });
  const bySkill = [...skills.values()].sort((a, b) => (a.skill === 'dialogue' ? -1 : b.skill === 'dialogue' ? 1 : a.name.localeCompare(b.name)));
  return json({ days, codes, pupils: [...pupils.values()], hardest, bySkill });
}

// ---------- routing ----------

export async function teacherRoute(request, env, url, actor) {
  const m = request.method;
  const path = url.pathname.replace(/^\/api\/t/, '');
  let x;
  if (path === '/ping') return json({ ok: true });
  const acc = await accounts.route(request, env, actor, path, m); // /teachers, /me, /me/password
  if (acc) return acc;
  if (path === '/game-config') {
    adminOnly(actor); // game balance is shared by every class
    return m === 'GET' ? configView(env) : m === 'PUT' ? configSave(request, env) : null;
  }
  if (path === '/classes') return m === 'GET' ? listClasses(env, actor) : m === 'POST' ? createClass(request, env, actor) : null;
  if ((x = path.match(/^\/classes\/(\d+)$/))) {
    if (m === 'PATCH') return updateClass(request, env, +x[1], actor);
    if (m === 'DELETE') return deleteClass(env, +x[1], actor);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/regen$/)) && m === 'POST') return regenCode(request, env, +x[1], actor);
  if ((x = path.match(/^\/classes\/(\d+)\/pupils$/))) {
    if (m === 'GET') return listPupils(env, +x[1], actor);
    if (m === 'POST') return addPupils(request, env, +x[1], actor);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/pupils\/preview$/)) && m === 'POST') return previewPupils(request, env, +x[1], actor);
  if ((x = path.match(/^\/pupils\/(\d+)$/))) {
    if (m === 'PATCH') return updatePupil(request, env, +x[1], actor);
    if (m === 'DELETE') return deletePupil(env, +x[1], actor);
  }
  if ((x = path.match(/^\/pupils\/(\d+)\/reset$/)) && m === 'POST') return resetPupil(env, +x[1], actor);

  if (path === '/questions') return m === 'GET' ? listQuestions(env, url, actor) : m === 'POST' ? createQuestion(request, env, actor) : null;
  if (path === '/questions/preview' && m === 'POST') return previewQuestion(request);
  if (path === '/questions/import' && m === 'POST') return importQuestions(request, env, actor);
  if ((x = path.match(/^\/questions\/(\d+)$/))) {
    if (m === 'PUT') return updateQuestion(request, env, +x[1], actor);
    if (m === 'DELETE') {
      const q = await env.DB.prepare('SELECT class_id FROM questions WHERE id = ?1').bind(+x[1]).first();
      if (!q) throw new HttpError(404, 'Question not found.');
      await ownQuestionClass(env, actor, q.class_id);
      await env.DB.prepare('UPDATE questions SET active = 0 WHERE id = ?1').bind(+x[1]).run();
      return json({ ok: true });
    }
  }

  if (path === '/verbs' || path.startsWith('/verbs/')) adminOnly(actor); // the verb bank is shared by every class
  if (path === '/verbs') return m === 'GET' ? listVerbs(env) : m === 'POST' ? createVerb(request, env) : null;
  if (path === '/verbs/import' && m === 'POST') return importVerbs(request, env);
  if (path === '/verbs/review' && m === 'GET') return reviewList(env);
  if ((x = path.match(/^\/verbs\/review\/([^/]+)\/(approve|reject|reset)$/)) && m === 'POST') return reviewAct(request, env, decodeURIComponent(x[1]), x[2]);
  if ((x = path.match(/^\/verbs\/(\d+)$/))) {
    if (m === 'PUT') return updateVerb(request, env, +x[1]);
    if (m === 'DELETE') return deleteVerb(env, +x[1]);
  }

  if (path === '/players' || path.startsWith('/players/')) return players.route(request, env, url, path, m, actor);
  if (path === '/feedback' || path.startsWith('/feedback/')) {
    if (path === '/feedback' && m === 'GET') return feedback.list(env, url, actor);
    if (path === '/feedback/clear-done' && m === 'POST') return feedback.clearDone(env, actor);
    if ((x = path.match(/^\/feedback\/(\d+)$/))) {
      if (m === 'PATCH') return feedback.setStatus(request, env, +x[1], actor);
      if (m === 'DELETE') return feedback.remove(env, +x[1], actor);
    }
  }

  if (path === '/analytics' && m === 'GET') return analytics(env, url, actor);
  if (path === '/diagnosis' && m === 'GET') {
    const cls = url.searchParams.get('class');
    const classId = cls === 'guests' ? null : int(cls, 0);
    if (cls !== 'guests' && !classId) throw new HttpError(400, 'Choose a class.');
    if (cls === 'guests') guestsOnlyAdmin(actor); else await ownClass(env, actor, classId);
    await practice.scanRules(env, 150); // older questions get their rules worked out the first time a diagnosis is opened
    return json(await practice.diagnosis(env, classId, Math.min(Math.max(int(url.searchParams.get('days'), 30), 1), 365)));
  }
  if (path === '/rules/scan' && m === 'POST') return json(await practice.scanRules(env, 400));
  if (path === '/focus') {
    if (m === 'GET') {
      const cid = int(url.searchParams.get('class'), 0);
      await ownClass(env, actor, cid);
      return practice.focusList(env, cid);
    }
    if (m === 'POST') {
      const body = await readJson(request);
      await ownClass(env, actor, int(body.class_id, 0));
      return practice.assignFocus(env, body);
    }
  }
  if ((x = path.match(/^\/focus\/(\d+)$/)) && m === 'DELETE') {
    const f = await env.DB.prepare('SELECT class_id FROM focus_assign WHERE id = ?1').bind(+x[1]).first();
    if (!f) throw new HttpError(404, 'Not found.');
    await ownClass(env, actor, f.class_id);
    return practice.focusEnd(env, +x[1]);
  }
  return null;
}
