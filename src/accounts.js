// Teacher accounts. The superadmin (the teacher_user / teacher_password secrets) creates teacher accounts; a teacher signs in with
// their own username and password and can only see and manage the classes they own. Classes with no owner belong to the superadmin.
//
// Schema (also in schema.sql / migrate-v1.9.sql): a `teachers` table and `classes.teacher_id`. ensure() creates whatever is missing
// the first time it runs, so an existing database needs no manual migration.

import { HttpError, json, readJson, clip, int } from './util.js';
import { hashPassword, checkPassword, validPassword, randomPassword } from './auth.js';

let ready = false;
export async function ensure(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS teachers (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL,
       pw_hash TEXT NOT NULL,
       active INTEGER NOT NULL DEFAULT 1,
       sess_ver INTEGER NOT NULL DEFAULT 1,
       created_at INTEGER NOT NULL,
       last_login INTEGER)`,
  ).run();
  let hasCol = true;
  try { await env.DB.prepare('SELECT teacher_id FROM classes LIMIT 0').all(); } catch { hasCol = false; }
  if (!hasCol) {
    try {
      await env.DB.prepare('ALTER TABLE classes ADD COLUMN teacher_id INTEGER').run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message))) throw e; // another request added it first
    }
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacher_id)').run();
  ready = true;
}

// ---------- who is asking ----------
// actor = { admin: true } for the superadmin, or { admin: false, id, name } for a teacher account.
export const isAdmin = (actor) => !!actor && actor.admin === true;

export async function actorFor(env, payload) {
  await ensure(env);
  if (payload.role !== 'teacher') return { admin: true, name: 'Admin' }; // includes tokens issued before accounts existed
  const t = await env.DB.prepare('SELECT id, name, username, active, sess_ver FROM teachers WHERE id = ?1').bind(int(payload.tid, 0)).first();
  if (!t || !t.active || t.sess_ver !== payload.sv) return null;
  return { admin: false, id: t.id, name: t.name, username: t.username };
}

export function adminOnly(actor) {
  if (!isAdmin(actor)) throw new HttpError(403, 'Only the admin can do that.');
}

// Throws unless the actor may manage this class. Returns the class row.
export async function ownClass(env, actor, classId) {
  const c = await env.DB.prepare('SELECT id, name, teacher_id FROM classes WHERE id = ?1').bind(classId).first();
  if (!c || (!isAdmin(actor) && c.teacher_id !== actor.id)) throw new HttpError(404, 'Class not found.');
  return c;
}

// The pupil's class must be the actor's. Guests (no class) are the admin's.
export async function ownPupil(env, actor, pupilId) {
  const p = await env.DB.prepare('SELECT p.id, p.class_id, p.is_guest, c.teacher_id FROM pupils p LEFT JOIN classes c ON c.id = p.class_id WHERE p.id = ?1').bind(pupilId).first();
  if (!p) throw new HttpError(404, 'Pupil not found.');
  if (!isAdmin(actor) && (p.is_guest || p.teacher_id !== actor.id)) throw new HttpError(404, 'Pupil not found.');
  return p;
}

// SQL fragment limiting something to the actor's classes. col is the class id column. Admin: no limit.
export const classFilter = (actor, col, n) => (isAdmin(actor) ? { sql: '1 = 1', binds: [] } : { sql: `${col} IN (SELECT id FROM classes WHERE teacher_id = ?${n})`, binds: [actor.id] });

// 'guests' (the guest pool) is for the admin only.
export function guestsOnlyAdmin(actor) {
  if (!isAdmin(actor)) throw new HttpError(403, 'Guest results are only for the admin.');
}

// ---------- teacher accounts (admin only) ----------
export const cleanLogin = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '').slice(0, 40);
export const validLogin = (u) => /^[a-z0-9][a-z0-9._@-]{2,39}$/.test(u);

async function list(env) {
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.username, t.name, t.active, t.created_at, t.last_login,
            (SELECT COUNT(*) FROM classes c WHERE c.teacher_id = t.id) AS classes,
            (SELECT COUNT(*) FROM pupils p JOIN classes c ON c.id = p.class_id WHERE c.teacher_id = t.id) AS pupils
       FROM teachers t ORDER BY t.active DESC, t.name COLLATE NOCASE`,
  ).all()).results || [];
  const unowned = (await env.DB.prepare('SELECT COUNT(*) AS n FROM classes WHERE teacher_id IS NULL').first()).n;
  return json({ teachers: rows.map((r) => ({ ...r, active: !!r.active })), unowned });
}

async function create(request, env) {
  const b = await readJson(request);
  const name = clip(b.name, 60).trim();
  const username = cleanLogin(b.username);
  if (!name) throw new HttpError(400, 'Enter the teacher’s name.');
  if (!validLogin(username)) throw new HttpError(400, 'Usernames use 3–40 letters, numbers, dots, dashes, underscores or @.');
  if (username === String(env.teacher_user || '').trim().toLowerCase()) throw new HttpError(409, 'That username is reserved for the admin.');
  const password = b.password ? String(b.password) : randomPassword();
  if (!validPassword(password)) throw new HttpError(400, 'Passwords need at least 8 characters.');
  try {
    const row = await env.DB.prepare('INSERT INTO teachers (username, name, pw_hash, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id').bind(username, name, await hashPassword(password), Date.now()).first();
    return json({ id: row.id, username, password }); // the password is shown to the admin once, here
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, 'Another teacher already has that username.');
    throw e;
  }
}

async function update(request, env, id) {
  const b = await readJson(request);
  const t = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?1').bind(id).first();
  if (!t) throw new HttpError(404, 'Teacher not found.');
  if (b.name !== undefined) {
    const name = clip(b.name, 60).trim();
    if (!name) throw new HttpError(400, 'The name can’t be blank.');
    await env.DB.prepare('UPDATE teachers SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (b.active !== undefined) await env.DB.prepare('UPDATE teachers SET active = ?1, sess_ver = sess_ver + 1 WHERE id = ?2').bind(b.active ? 1 : 0, id).run(); // switching off signs them out
  return json({ ok: true });
}

async function resetPassword(request, env, id) {
  const b = await readJson(request);
  const password = b.password ? String(b.password) : randomPassword();
  if (!validPassword(password)) throw new HttpError(400, 'Passwords need at least 8 characters.');
  const r = await env.DB.prepare('UPDATE teachers SET pw_hash = ?1, sess_ver = sess_ver + 1 WHERE id = ?2 RETURNING id').bind(await hashPassword(password), id).first();
  if (!r) throw new HttpError(404, 'Teacher not found.');
  return json({ password });
}

// Deleting an account keeps its classes: they go back to the admin, who can hand them to someone else.
async function remove(env, id) {
  await env.DB.batch([env.DB.prepare('UPDATE classes SET teacher_id = NULL WHERE teacher_id = ?1').bind(id), env.DB.prepare('DELETE FROM teachers WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}

// A teacher changing their own password (must know the current one).
export async function changeOwnPassword(request, env, actor) {
  if (isAdmin(actor)) throw new HttpError(400, 'The admin password is set in Cloudflare (the teacher_password secret).');
  const b = await readJson(request);
  const t = await env.DB.prepare('SELECT pw_hash FROM teachers WHERE id = ?1').bind(actor.id).first();
  if (!t || !(await checkPassword(String(b.current ?? ''), t.pw_hash))) throw new HttpError(403, 'The current password isn’t right.');
  if (!validPassword(b.next)) throw new HttpError(400, 'The new password needs at least 8 characters.');
  const r = await env.DB.prepare('UPDATE teachers SET pw_hash = ?1, sess_ver = sess_ver + 1 WHERE id = ?2 RETURNING sess_ver').bind(await hashPassword(b.next), actor.id).first();
  return json({ ok: true, sv: r.sess_ver }); // the client signs in again with the new password
}

export async function route(request, env, actor, path, m) {
  let x;
  if (path === '/teachers') {
    adminOnly(actor);
    return m === 'GET' ? list(env) : m === 'POST' ? create(request, env) : null;
  }
  if ((x = path.match(/^\/teachers\/(\d+)$/))) {
    adminOnly(actor);
    if (m === 'PATCH') return update(request, env, +x[1]);
    if (m === 'DELETE') return remove(env, +x[1]);
  }
  if ((x = path.match(/^\/teachers\/(\d+)\/password$/)) && m === 'POST') {
    adminOnly(actor);
    return resetPassword(request, env, +x[1]);
  }
  if (path === '/me' && m === 'GET') return json({ role: isAdmin(actor) ? 'admin' : 'teacher', name: actor.name, username: actor.username || null });
  if (path === '/me/password' && m === 'POST') return changeOwnPassword(request, env, actor);
  return null;
}
