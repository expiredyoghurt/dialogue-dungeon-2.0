// Pupil feedback to the developer (difficulty ratings, ideas, problems). Pupils send it; only the teacher console can read it.
// The table is created on first use (CREATE TABLE IF NOT EXISTS), so no manual migration is needed. It is also listed in game-schema.sql.

import { HttpError, json, readJson, clip, int } from './util.js';
import { JOBS, MOBS } from './gamedata.js';
import { isAdmin } from './accounts.js';

export const KINDS = ['difficulty', 'suggestion', 'bug', 'other'];
export const RATINGS = ['too_easy', 'just_right', 'too_hard'];
export const STATUSES = ['new', 'done'];
export const MAX_LEN = 600, PER_HOUR = 5, PER_DAY = 15;

let ready = false;
export async function ensure(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS feedback (
       id INTEGER PRIMARY KEY AUTOINCREMENT, pupil_id INTEGER NOT NULL, class_id INTEGER, name TEXT NOT NULL,
       kind TEXT NOT NULL, rating TEXT, message TEXT NOT NULL DEFAULT '', ctx TEXT NOT NULL DEFAULT '{}',
       status TEXT NOT NULL DEFAULT 'new', ts INTEGER NOT NULL)`,
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS feedback_status ON feedback(status, ts)').run();
  ready = true;
}

// Validates and tidies what a pupil sent. A difficulty note needs a rating or a message; everything else needs a message.
export function cleanFeedback(body) {
  const kind = KINDS.includes(body && body.kind) ? body.kind : null;
  if (!kind) throw new HttpError(400, 'Pick what your feedback is about.');
  const rating = kind === 'difficulty' && RATINGS.includes(body.rating) ? body.rating : null;
  const message = clip(String((body && body.message) ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), MAX_LEN);
  if (kind === 'difficulty' && !rating && message.length < 3) throw new HttpError(400, 'Choose how the difficulty feels, or write a few words.');
  if (kind !== 'difficulty' && message.length < 3) throw new HttpError(400, 'Please write a few words so the developer knows what you mean.');
  return { kind, rating, message };
}

export async function submit(request, env, p) {
  const body = await readJson(request);
  const f = cleanFeedback(body);
  await ensure(env);
  const now = Date.now();
  const n = async (ms) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE pupil_id = ?1 AND ts > ?2').bind(p.id, now - ms).first()).n;
  if ((await n(3_600_000)) >= PER_HOUR || (await n(86_400_000)) >= PER_DAY) throw new HttpError(429, 'You have sent a lot of feedback already. Please try again a little later.');
  // the server works out the game context itself, so it can be trusted: level, job, and the floor / monster of a fight in progress
  const pl = await env.DB.prepare('SELECT level, job FROM g_player WHERE pupil_id = ?1').bind(p.id).first();
  const ft = await env.DB.prepare('SELECT mob, level, floor FROM g_fight WHERE pupil_id = ?1').bind(p.id).first();
  const where = ['village', 'fight', 'dive'].includes(body.where) ? body.where : '';
  const ctx = { where, level: pl ? pl.level : null, job: pl && JOBS[pl.job] ? JOBS[pl.job].n : null, floor: ft ? ft.floor : null, mob: ft && MOBS[ft.mob] ? MOBS[ft.mob].n : null, mlv: ft ? ft.level : null };
  await env.DB.prepare('INSERT INTO feedback (pupil_id, class_id, name, kind, rating, message, ctx, status, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
    .bind(p.id, p.classId ?? null, clip(p.name, 60), f.kind, f.rating, f.message, JSON.stringify(ctx), 'new', now).run();
  return json({ ok: true });
}

// ---------- teacher side ----------

export async function list(env, url, actor) {
  await ensure(env);
  const status = ['new', 'done'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'all';
  const kind = KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'all';
  const where = [], binds = [];
  // a teacher sees feedback from their own classes only (the admin sees everything, including guests)
  const mine = isAdmin(actor) ? '' : 'class_id IN (SELECT id FROM classes WHERE teacher_id = ?1)';
  if (!isAdmin(actor)) { binds.push(actor.id); where.push(mine.replace('class_id', 'f.class_id')); }
  if (status !== 'all') { binds.push(status); where.push(`f.status = ?${binds.length}`); }
  if (kind !== 'all') { binds.push(kind); where.push(`f.kind = ?${binds.length}`); }
  const rows = (await env.DB.prepare(
    `SELECT f.id, f.name, f.kind, f.rating, f.message, f.ctx, f.status, f.ts, COALESCE(c.name, 'Guest') AS class_name
       FROM feedback f LEFT JOIN classes c ON c.id = f.class_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.id DESC LIMIT 300`,
  ).bind(...binds).all()).results || [];
  const counts = { new: 0, done: 0 }, ratings = { too_easy: 0, just_right: 0, too_hard: 0 };
  const sc = isAdmin(actor) ? { and: '', where: '', b: [] } : { and: ' AND ' + mine, where: ' WHERE ' + mine, b: [actor.id] };
  for (const r of (await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM feedback${sc.where} GROUP BY status`).bind(...sc.b).all()).results || []) counts[r.status] = r.n;
  for (const r of (await env.DB.prepare(`SELECT rating, COUNT(*) AS n FROM feedback WHERE kind = 'difficulty' AND rating IS NOT NULL${sc.and} GROUP BY rating`).bind(...sc.b).all()).results || []) ratings[r.rating] = r.n;
  const items = rows.map((r) => { let ctx = {}; try { ctx = JSON.parse(r.ctx); } catch {} return { id: r.id, name: r.name, className: r.class_name, kind: r.kind, rating: r.rating, message: r.message, status: r.status, ts: r.ts, ctx }; });
  return json({ items, counts, ratings });
}

// A teacher may only touch feedback from their own classes.
async function ownItem(env, actor, id) {
  if (isAdmin(actor)) return;
  const f = await env.DB.prepare('SELECT 1 AS x FROM feedback f JOIN classes c ON c.id = f.class_id WHERE f.id = ?1 AND c.teacher_id = ?2').bind(id, actor.id).first();
  if (!f) throw new HttpError(404, 'Not found.');
}

export async function setStatus(request, env, id, actor) {
  await ensure(env);
  await ownItem(env, actor, id);
  const b = await readJson(request);
  if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status.');
  await env.DB.prepare('UPDATE feedback SET status = ?2 WHERE id = ?1').bind(id, b.status).run();
  return json({ ok: true });
}

export async function remove(env, id, actor) {
  await ensure(env);
  await ownItem(env, actor, id);
  await env.DB.prepare('DELETE FROM feedback WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}

export async function clearDone(env, actor) {
  await ensure(env);
  const r = isAdmin(actor) ? await env.DB.prepare("DELETE FROM feedback WHERE status = 'done'").run() : await env.DB.prepare("DELETE FROM feedback WHERE status = 'done' AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?1)").bind(actor.id).run();
  return json({ ok: true, removed: int(r.meta && r.meta.changes, 0) });
}
