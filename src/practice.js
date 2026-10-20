// Deliberate practice and class diagnosis (v1.8).
//
// Every question exercises one or more of the 13 rules (src/rules.js). `questions.rules` is a bit mask of them, worked out from the
// question's own key (what a pupil has to get right) and stored when the question is created, seeded or scanned.
// A pupil's mastery of a rule comes from their first tries on questions that exercise it: right first time with no mistake of that
// rule, or not. Practice rounds, assignments and the teacher's diagnosis are all built on those two facts.

import { json, readJson, HttpError, int } from './util.js';
import { CODES, RULES } from './rules.js';
import { checkMode1, stripToPrompt, spotCount, buildSlots } from './engine.js';
import { mcCode, isSkillQ } from './skills.js';
import * as pupil from './pupil.js';
import { visibleSql, payloadFor } from './pupil.js';
import { getCfg, trainingReward, trainingLevelFor } from './game.js';
import { MOBS } from './gamedata.js';

export const RULE_NUMBERS = Object.keys(RULES).map(Number).filter((n) => n > 0);
export const bit = (n) => 1 << n;
export const maskOf = (rules) => rules.reduce((m, n) => m | bit(n), 0);
export const hasRule = (mask, n) => mask != null && (mask & bit(n)) !== 0;
export const rulesFromMask = (mask) => RULE_NUMBERS.filter((n) => hasRule(mask, n));

// ---------- which rules does a question exercise? ----------

const ruleOfCode = (c) => (CODES[c] && !CODES[c].hidden ? CODES[c].rule : 0);

export function rulesOf(mode, data, skill) {
  const set = new Set();
  const add = (codes) => codes.forEach((c) => { const n = ruleOfCode(c); if (n > 0) set.add(n); });
  if (mode === 1) {
    let r = checkMode1(data, data.prompt || '');
    if (!r.aligned) r = checkMode1(data, stripToPrompt(data.correct));
    add(r.errors.map((e) => e.code));
    if (data.lines) set.add(8);
    if (data.beat) set.add(9);
  } else if (mode === 2) {
    const b = buildSlots(data.correct, data.faulty);
    if (b.valid) for (const s of b.slots) add(s.errors.map((e) => e.code));
  } else if (mode === 3) set.add(7);
  else if (mode === 4) set.add(ruleOfCode(mcCode(data, skill)) || 13);
  else if (mode === 5) set.add(data.kind === 'direct' || (!data.kind && (data.accepted || []).some((a) => /["“”]/.test(a))) ? 11 : 10);
  else if (mode === 6) set.add(12);
  return [...set].sort((a, b) => a - b);
}
export const maskFor = (mode, data, skill) => maskOf(rulesOf(mode, data, skill));

// Works out the mask for questions that don't have one yet (older questions, or ones added by other tools). Bounded per call.
export async function scanRules(env, limit = 80) {
  const rows = (await env.DB.prepare(`SELECT id, mode, data, skill FROM questions WHERE rules IS NULL LIMIT ${Number(limit) || 80}`).all()).results || [];
  for (const q of rows) {
    let mask = 0;
    try { mask = maskFor(q.mode, JSON.parse(q.data), q.skill); } catch { mask = 0; }
    await env.DB.prepare('UPDATE questions SET rules = ?1 WHERE id = ?2').bind(mask, q.id).run();
  }
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE rules IS NULL').first();
  return { scanned: rows.length, remaining: left ? left.n : 0 };
}

// ---------- mastery ----------

export const MASTERY = { window: 8, secureRate: 0.85, secureMin: 5, developingRate: 0.6, developingMin: 3 };
export const LEVEL_NAME = { new: 'Not started', learning: 'Learning', developing: 'Getting there', secure: 'Secure' };

// results: first-try outcomes for one rule, oldest first (true = right first time, no mistake of this rule).
export function levelOf(results) {
  const w = results.slice(-MASTERY.window), n = w.length;
  if (!n) return { level: 'new', n: 0, ok: 0, rate: 0 };
  const ok = w.filter(Boolean).length, rate = ok / n;
  const level = n >= MASTERY.secureMin && rate >= MASTERY.secureRate ? 'secure' : n >= MASTERY.developingMin && rate >= MASTERY.developingRate ? 'developing' : 'learning';
  return { level, n, ok, rate: Math.round(rate * 100) / 100 };
}

// rows: first-try attempts, oldest first: { rules, codes, correct }. Returns { [rule]: results[] }.
export function resultsByRule(rows) {
  const out = {};
  for (const r of rows) {
    if (r.rules == null) continue;
    const codes = typeof r.codes === 'string' ? JSON.parse(r.codes || '[]') : r.codes || [];
    if (!r.correct && !codes.length) continue; // gave up: nothing to say about any one rule
    const wrong = new Set(codes.map(ruleOfCode));
    for (const n of RULE_NUMBERS) if (hasRule(r.rules, n)) (out[n] ||= []).push(!wrong.has(n));
  }
  return out;
}

async function pupilResults(env, pupilId) {
  const rows = (await env.DB.prepare('SELECT a.correct, a.codes, q.rules FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.pupil_id = ?1 AND a.try_no = 1 ORDER BY a.id DESC LIMIT 600').bind(pupilId).all()).results || [];
  return resultsByRule(rows.reverse());
}

// ---------- which questions are available to practise ----------

async function pool(env, p, n) {
  const cfg = await getCfg(env);
  const v = visibleSql(p);
  const rows = (await env.DB.prepare(`SELECT id, mode, data, skill, rules FROM questions WHERE ${v.where} AND rules IS NOT NULL AND (rules & ${bit(n)}) != 0 ORDER BY id LIMIT 300`).bind(...v.binds).all()).results || [];
  // a skill the teacher has switched off stays out of practice too
  return rows.filter((q) => !isSkillQ(q.skill) || (cfg.skills[q.skill] && cfg.skills[q.skill].on));
}

const hardness = (q, d) => (q.mode === 1 ? spotCount(d) || 2 : q.mode === 2 ? (buildSlots(d.correct, d.faulty).slots || []).length || 2 : q.mode === 3 ? 2 : q.mode === 4 ? ((d.pick || 1) > 1 ? 3 : 2) : q.mode === 5 ? 4 : 3);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The training monsters: warm-up, stretch and challenge ones. Only names and pictures; they pay XP but never gold or drops.
const TRAINERS = { 1: ['slime', 'bat'], 2: ['goblinscout', 'skeleton'], 3: ['golem', 'hydra'] };
export function trainingMonster(step, i, level) {
  const list = TRAINERS[step] || TRAINERS[2], id = list[i % list.length], m = MOBS[id] || MOBS.slime;
  return { name: 'Training ' + m.n, img: m.img || null, e: m.e, level };
}

// ---------- pupil: the practice room ----------

export async function assignedFor(env, p) {
  if (p.guest || !p.classId) return [];
  const rows = (await env.DB.prepare('SELECT id, rule, target, due, created_at FROM focus_assign WHERE class_id = ?1 AND active = 1 AND (pupil_id IS NULL OR pupil_id = ?2) ORDER BY id DESC').bind(p.classId, p.id).all()).results || [];
  const out = [];
  for (const a of rows) {
    const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM attempts x JOIN questions q ON q.id = x.question_id WHERE x.pupil_id = ?1 AND x.practice = 1 AND x.try_no = 1 AND x.correct = 1 AND x.ts >= ?2 AND (q.rules & ${bit(a.rule)}) != 0`).bind(p.id, a.created_at).first();
    out.push({ id: a.id, rule: a.rule, name: (RULES[a.rule] || {}).short || '', target: a.target, done: Math.min(c.n, a.target), complete: c.n >= a.target, due: a.due });
  }
  return out;
}

// ---------- Training Grounds: the day, the weakest skills, the bonus ----------

export const dayOf = (now, tz) => new Date(now + tz * 3600000).toISOString().slice(0, 10);
export const dayStart = (day, tz) => Date.parse(day + 'T00:00:00Z') - tz * 3600000;

// Weakest first. A skill with no attempts yet is "unknown", so it ranks above one the pupil is plainly getting wrong,
// and below one they are getting right: score = (right + 1) / (tries + 2).
export function weakestRules(rules, k) {
  return rules
    .filter((r) => r.available > 0)
    .map((r) => ({ rule: r.rule, score: (Math.round(r.rate * r.n) + 1) / (r.n + 2), n: r.n }))
    .sort((a, b) => a.score - b.score || a.n - b.n || a.rule - b.rule)
    .slice(0, Math.max(0, k))
    .map((x) => x.rule);
}

async function ruleStats(env, p, cfg) {
  const v = visibleSql(p);
  const qs = ((await env.DB.prepare(`SELECT skill, rules FROM questions WHERE ${v.where} AND rules IS NOT NULL`).bind(...v.binds).all()).results || []).filter((q) => !isSkillQ(q.skill) || (cfg.skills[q.skill] && cfg.skills[q.skill].on));
  const res = await pupilResults(env, p.id);
  return RULE_NUMBERS.map((n) => {
    const l = levelOf(res[n] || []);
    return { rule: n, short: RULES[n].short, title: RULES[n].title, tip: RULES[n].tip, level: l.level, levelName: LEVEL_NAME[l.level], n: l.n, rate: l.rate, available: qs.filter((q) => hasRule(q.rules, n)).length };
  });
}

// The day's bonus skills are fixed the first time the pupil opens the Training Grounds that day, so practising them
// does not make a new "weakest" set appear. bonus_left: NULL = bonus not claimed yet, N = N more bonus monsters, 0 = used up.
async function todaysBonus(env, p, cfg, rules, now = Date.now()) {
  const day = dayOf(now, cfg.training.tz);
  let rows = (await env.DB.prepare('SELECT rule, bonus_left FROM training_day WHERE pupil_id = ?1 AND day = ?2').bind(p.id, day).all()).results || [];
  if (!rows.length && cfg.training.weakest > 0) {
    for (const n of weakestRules(rules, cfg.training.weakest)) await env.DB.prepare('INSERT OR IGNORE INTO training_day (pupil_id, day, rule, bonus_left) VALUES (?1, ?2, ?3, NULL)').bind(p.id, day, n).run();
    rows = (await env.DB.prepare('SELECT rule, bonus_left FROM training_day WHERE pupil_id = ?1 AND day = ?2').bind(p.id, day).all()).results || [];
  }
  return { day, rows };
}

async function monstersToday(env, p, cfg, now = Date.now()) {
  const start = dayStart(dayOf(now, cfg.training.tz), cfg.training.tz);
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE pupil_id = ?1 AND practice = 1 AND correct = 1 AND ts >= ?2').bind(p.id, start).first()).n;
}

export async function practiceMap(env, p) {
  await scanRules(env, 80);
  const cfg = await getCfg(env);
  const rules = await ruleStats(env, p, cfg);
  const { rows } = await todaysBonus(env, p, cfg, rules);
  const bonus = new Map(rows.map((r) => [r.rule, r.bonus_left]));
  for (const r of rules) {
    r.bonus = !bonus.has(r.rule) ? null : bonus.get(r.rule) === null ? 'ready' : bonus.get(r.rule) > 0 ? 'active' : 'used';
  }
  // recommended: rules they are still getting wrong, worst first (needs a few attempts to say anything)
  const recommended = rules.filter((r) => r.available && r.level === 'learning' && r.n >= 3).sort((a, b) => a.rate - b.rate).slice(0, 3).map((r) => r.rule);
  const t = cfg.training;
  return json({ rules, recommended, assigned: await assignedFor(env, p), training: { xpMult: t.xpMult, bonusMult: t.bonusMult, levelCap: t.levelCap, today: Math.min(await monstersToday(env, p, cfg), t.dailyMonsters), cap: t.dailyMonsters } });
}

// Starts a round: a worked example (the client shows RULES[rule]) and a short ladder of questions, easy to hard.
export async function practiceStart(request, env, p) {
  const body = await readJson(request);
  const n = int(body.rule, 0);
  if (!RULES[n] || n < 1) throw new HttpError(400, 'Choose a skill to practise.');
  const size = Math.min(8, Math.max(3, int(body.size, 5)));
  await scanRules(env, 80);
  const all = await pool(env, p, n);
  if (!all.length) throw new HttpError(404, 'There are no practice questions for this skill yet.');
  const since = Date.now() - 14 * 86400000;
  const done = new Set(((await env.DB.prepare('SELECT DISTINCT question_id FROM attempts WHERE pupil_id = ?1 AND try_no = 1 AND correct = 1 AND ts > ?2').bind(p.id, since).all()).results || []).map((r) => r.question_id));
  let cand = all.filter((q) => !done.has(q.id));
  if (cand.length < size) cand = [...cand, ...shuffle(all.filter((q) => done.has(q.id)))].slice(0, Math.max(size, cand.length));
  const scored = shuffle(cand).slice(0, size * 3).map((q) => { const d = JSON.parse(q.data); return { q, d, h: hardness(q, d) }; }).sort((a, b) => a.h - b.h);
  // pick evenly through the easy-to-hard list so the round climbs
  const take = Math.min(size, scored.length), picked = [];
  for (let i = 0; i < take; i++) picked.push(scored[Math.round((i * (scored.length - 1)) / Math.max(1, take - 1))]);
  const uniq = [...new Map(picked.map((x) => [x.q.id, x])).values()];
  const level = await trainingLevelFor(env, p); // every training monster is as strong as the pupil (up to the cap)
  const items = uniq.map((x, i) => {
    const step = uniq.length < 3 ? 2 : i < uniq.length / 3 ? 1 : i < (2 * uniq.length) / 3 ? 2 : 3;
    return { id: x.q.id, mode: x.q.mode, p: payloadFor(x.q.mode, x.d), step, monster: trainingMonster(step, i, level) };
  }).filter((x) => x.p);
  // the first round on one of today's weakest skills claims the double-XP bonus for the monsters in it
  const cfg = await getCfg(env);
  const { day, rows } = await todaysBonus(env, p, cfg, await ruleStats(env, p, cfg));
  const row = rows.find((r) => r.rule === n);
  let bonus = false;
  if (row && row.bonus_left === null) {
    await env.DB.prepare('UPDATE training_day SET bonus_left = ?1 WHERE pupil_id = ?2 AND day = ?3 AND rule = ?4').bind(items.length, p.id, day, n).run();
    bonus = true;
  } else if (row && row.bonus_left > 0) bonus = true; // an earlier round today was cut short: the rest of its bonus carries on
  const t = cfg.training;
  return json({ rule: n, name: RULES[n].short, items, level, bonus, bonusMult: t.bonusMult, xpMult: t.xpMult, today: Math.min(await monstersToday(env, p, cfg), t.dailyMonsters), cap: t.dailyMonsters });
}

// ---------- teacher: assignments ----------

export async function assignFocus(env, body) {
  const classId = int(body.class_id, 0);
  const cls = await env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(classId).first();
  if (!cls) throw new HttpError(404, 'Class not found.');
  const rule = int(body.rule, 0);
  if (!RULES[rule] || rule < 1) throw new HttpError(400, 'Choose a skill to assign.');
  const target = Math.min(30, Math.max(1, int(body.target, 8)));
  const due = body.due ? Date.parse(body.due) || null : null;
  const ids = Array.isArray(body.pupil_ids) ? [...new Set(body.pupil_ids.map((x) => int(x, 0)).filter(Boolean))].slice(0, 60) : [];
  const now = Date.now();
  if (ids.length) {
    const ok = ((await env.DB.prepare('SELECT id FROM pupils WHERE class_id = ?1').bind(classId).all()).results || []).map((r) => r.id);
    for (const id of ids) if (ok.includes(id)) await env.DB.prepare('INSERT INTO focus_assign (class_id, pupil_id, rule, target, due, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)').bind(classId, id, rule, target, due, now).run();
  } else await env.DB.prepare('INSERT INTO focus_assign (class_id, pupil_id, rule, target, due, active, created_at) VALUES (?1, NULL, ?2, ?3, ?4, 1, ?5)').bind(classId, rule, target, due, now).run();
  return json({ ok: true });
}

export async function focusList(env, classId) {
  const rows = (await env.DB.prepare('SELECT f.id, f.pupil_id, f.rule, f.target, f.due, f.created_at, p.name AS pupil FROM focus_assign f LEFT JOIN pupils p ON p.id = f.pupil_id WHERE f.class_id = ?1 AND f.active = 1 ORDER BY f.id DESC').bind(classId).all()).results || [];
  const pupils = (await env.DB.prepare('SELECT id, name FROM pupils WHERE class_id = ?1 AND is_guest = 0').bind(classId).all()).results || [];
  const out = [];
  for (const f of rows) {
    const targeted = f.pupil_id ? pupils.filter((x) => x.id === f.pupil_id) : pupils;
    let done = 0;
    for (const x of targeted) {
      const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.pupil_id = ?1 AND a.practice = 1 AND a.try_no = 1 AND a.correct = 1 AND a.ts >= ?2 AND (q.rules & ${bit(f.rule)}) != 0`).bind(x.id, f.created_at).first();
      if (c.n >= f.target) done++;
    }
    out.push({ id: f.id, rule: f.rule, name: RULES[f.rule].short, target: f.target, due: f.due, who: f.pupil_id ? f.pupil : 'Whole class', targeted: targeted.length, done });
  }
  return json({ assignments: out });
}

export async function focusEnd(env, id) {
  await env.DB.prepare('UPDATE focus_assign SET active = 0 WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}

// ---------- teacher: class diagnosis ----------

export const DIAG = { minExposures: 3, struggleRate: 0.4, classShare: 0.4, trend: 0.1 };

// Pure: turns first-try rows into a ranked diagnosis. rows = [{ pupil_id, rules, codes, correct, ts }], oldest first.
// prev = the same for the period before (for the trend). pupils = [{ id, name }].
export function diagnose(rows, prev, pupils) {
  const per = {}; // rule -> pupil -> results[]
  const tally = (list, into) => {
    const byPupil = {};
    for (const r of list) (byPupil[r.pupil_id] ||= []).push(r);
    for (const [pid, rs] of Object.entries(byPupil)) for (const [n, res] of Object.entries(resultsByRule(rs))) ((into[n] ||= {})[pid] = res);
  };
  tally(rows, per);
  const before = {};
  tally(prev || [], before);
  const names = new Map(pupils.map((x) => [x.id, x.name]));
  const rate = (m) => { let e = 0, x = 0; for (const res of Object.values(m || {})) { e += res.length; x += res.filter((v) => !v).length; } return e ? x / e : null; };
  const out = [];
  for (const n of RULE_NUMBERS) {
    const m = per[n] || {};
    const ids = Object.keys(m).map(Number);
    if (!ids.length) continue;
    const exposures = ids.reduce((s, id) => s + m[id].length, 0), errors = ids.reduce((s, id) => s + m[id].filter((v) => !v).length, 0);
    const errRate = errors / exposures;
    const struggling = [], secure = [], levels = {};
    for (const id of ids) {
      const res = m[id], miss = res.filter((v) => !v).length, l = levelOf(res);
      levels[id] = l.level;
      if (res.length >= DIAG.minExposures && miss / res.length >= DIAG.struggleRate) struggling.push({ id, name: names.get(id) || '?', n: res.length, rate: Math.round((100 * miss) / res.length) });
      if (l.level === 'secure') secure.push(id);
    }
    struggling.sort((a, b) => b.rate - a.rate);
    const prevRate = rate(before[n]);
    const trend = prevRate == null ? null : errRate - prevRate >= DIAG.trend ? 'worse' : prevRate - errRate >= DIAG.trend ? 'better' : 'steady';
    const share = struggling.length / ids.length;
    let action;
    if (struggling.length && share >= DIAG.classShare) action = 'Reteach to the whole class: model it, then assign a focus round to everyone.';
    else if (struggling.length) action = `Small-group support: assign a focus round to ${struggling.length} pupil${struggling.length === 1 ? '' : 's'}.`;
    else if (errRate < 0.2 && secure.length / ids.length >= 0.6) action = 'Mostly secure: stretch with harder floors or skills.';
    else action = 'Keep an eye on it: no pupil is struggling yet.';
    out.push({ rule: n, name: RULES[n].short, exposures, errors, errorRate: Math.round(errRate * 100), pupilsExposed: ids.length, struggling, secureCount: secure.length, levels, trend, priority: Math.round(errRate * struggling.length * 100) / 100 + errRate * 0.01, action });
  }
  out.sort((a, b) => b.priority - a.priority);
  return out;
}

// What pupils actually typed when they got a question wrong: the misconceptions behind the numbers.
export function commonWrong(attemptRows, questions) {
  const byQ = {};
  for (const r of attemptRows) (byQ[r.question_id] ||= []).push(r);
  const out = [];
  for (const [qid, list] of Object.entries(byQ)) {
    const q = questions.get(+qid);
    if (!q || ![1, 3, 4, 5, 6].includes(q.mode)) continue;
    const wrong = list.filter((r) => !r.correct && r.answer && r.answer !== '(showed the answer)');
    if (wrong.length < 3) continue;
    const counts = new Map();
    for (const r of wrong) {
      let t = String(r.answer).trim();
      if (q.mode === 4) t = t.split(',').map((id) => ((q.data.options || []).find((o) => o.id === id) || {}).text || id).join(' + ');
      else if (q.mode === 6) { try { const o = JSON.parse(t), words = (q.data.sentence || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []; t = `tapped “${words[o.w] ?? '?'}”, typed “${o.f}”`; } catch { continue; } }
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      const c = counts.get(key) || { text: t.replace(/\s+/g, ' '), n: 0 };
      c.n++;
      counts.set(key, c);
    }
    const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 3);
    const text = q.mode === 4 ? q.data.stem : q.mode === 5 ? q.data.prompt : q.mode === 6 ? q.data.sentence : q.data.prompt || '';
    out.push({ id: +qid, mode: q.mode, text, wrong: wrong.length, tries: list.length, answers: top });
  }
  return out.sort((a, b) => b.wrong - a.wrong).slice(0, 8);
}

export async function diagnosis(env, classId, days) {
  const now = Date.now(), since = now - days * 86400000, since2 = since - days * 86400000;
  const q = `SELECT a.pupil_id, a.question_id, a.correct, a.codes, a.answer, a.ts, q.rules, q.mode, q.data FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2 AND a.ts < ?3 ORDER BY a.id LIMIT 20000`;
  const cur = (await env.DB.prepare(q).bind(classId, since, now + 1).all()).results || [];
  const prev = (await env.DB.prepare(q).bind(classId, since2, since).all()).results || [];
  const pupils = classId == null ? [] : (await env.DB.prepare('SELECT id, name FROM pupils WHERE class_id = ?1 AND is_guest = 0 ORDER BY name').bind(classId).all()).results || [];
  const unscanned = (await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE rules IS NULL').first()).n;
  const questions = new Map();
  for (const r of cur) if (!questions.has(r.question_id)) questions.set(r.question_id, { mode: r.mode, data: JSON.parse(r.data) });
  const active = new Set(cur.map((r) => r.pupil_id));
  return {
    days,
    pupils: pupils.length,
    active: pupils.filter((x) => active.has(x.id)).length,
    unscanned,
    rules: diagnose(cur, prev, pupils),
    wrong: commonWrong(cur, questions),
    roster: pupils,
  };
}

// ---------- Training Grounds: answering a training monster ----------

const TOP_XP = { 3: 8, 4: 8 }; // the most the first try of a question of that mode pays (everything else pays 10)

// Marks the answer exactly like any other (practice: true), then, when it is a correct final answer, pays the training XP.
export async function practiceAnswer(request, env, p) {
  const body = await readJson(request);
  const rule = int(body.rule, 0);
  const res = await (await pupil.answer(new Request(request.url, { method: 'POST', body: JSON.stringify({ ...body, practice: true }) }), env, p)).json();
  const done = res.phase === 2 || (res.phase === undefined && (res.correct || res.final));
  if (!done || !res.correct) return json(res);
  const cfg = await getCfg(env), t = cfg.training, now = Date.now();
  const today = await monstersToday(env, p, cfg, now); // includes this answer
  const out = { ...res, training: { today: Math.min(today, t.dailyMonsters), cap: t.dailyMonsters, capped: today > t.dailyMonsters } };
  if (out.training.capped) return json(out);
  const q = await env.DB.prepare('SELECT mode, rules FROM questions WHERE id = ?1').bind(int(body.qid, 0)).first();
  let mult = 1;
  if (q && rule && hasRule(q.rules, rule)) {
    const day = dayOf(now, t.tz);
    const row = await env.DB.prepare('SELECT bonus_left FROM training_day WHERE pupil_id = ?1 AND day = ?2 AND rule = ?3').bind(p.id, day, rule).first();
    if (row && row.bonus_left > 0 && t.bonusMult > 1) {
      mult = t.bonusMult;
      await env.DB.prepare('UPDATE training_day SET bonus_left = bonus_left - 1 WHERE pupil_id = ?1 AND day = ?2 AND rule = ?3').bind(p.id, day, rule).run();
    }
  }
  const frac = Math.max(0.3, Math.min(1, (res.xp || 0) / ((q && TOP_XP[q.mode]) || 10)));
  const reward = await trainingReward(env, p, { frac, mult });
  out.training = { ...out.training, ...reward, bonus: mult > 1, mult };
  return json(out);
}
