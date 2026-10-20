import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, checkPassword, verifyToken, validPassword } from '../src/auth.js';
import { teacherLogin, teacherRoute } from '../src/teacher.js';
import { actorFor, cleanLogin, validLogin } from '../src/accounts.js';

// A small D1 look-alike over node:sqlite, so the real routes run against the real schema.
function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../game-schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    _run: () => db.prepare(sql).run(...args),
  });
  return { teacher_user: 'boss', teacher_password: 'bosspass', session_secret: 'test-secret', DB: { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) s._run(); return []; } } };
}

const req = (method, path, body) => new Request('https://x.test' + path, { method, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
async function login(env, username, password) {
  const res = await teacherLogin(req('POST', '/api/teacher/login', { username, password }), env);
  const d = await res.json();
  return d;
}
async function call(env, token, method, path, body) {
  const payload = await verifyToken(env, token);
  assert.ok(payload, 'token verifies');
  const actor = await actorFor(env, payload);
  if (!actor) return { status: 401, data: {} };
  try {
    const res = await teacherRoute(req(method, '/api/t' + path, body), env, new URL('https://x.test/api/t' + path), actor);
    if (!res) return { status: 404, data: {} };
    return { status: res.status, data: await res.json() };
  } catch (e) {
    if (!e.status) console.error(e);
    return { status: e.status || 500, data: { error: e.message } };
  }
}

test('passwords are hashed, salted and checked', async () => {
  const a = await hashPassword('correct horse'), b = await hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('pbkdf2$'));
  assert.equal(await checkPassword('correct horse', a), true);
  assert.equal(await checkPassword('wrong horse', a), false);
  assert.equal(await checkPassword('anything', null), false);
  assert.equal(await checkPassword('anything', 'garbage'), false);
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('long enough'), true);
});

test('login names are tidied and checked', () => {
  assert.equal(cleanLogin('  Ms.Tan '), 'ms.tan');
  assert.equal(validLogin('ab'), false);
  assert.equal(validLogin('ms.tan'), true);
});

test('the admin signs in with the secrets; a teacher with their own account', async () => {
  const env = makeEnv();
  const adm = await login(env, 'boss', 'bosspass');
  assert.equal(adm.role, 'admin');
  const made = await call(env, adm.token, 'POST', '/teachers', { name: 'Ms Tan', username: 'MsTan', password: 'password123' });
  assert.equal(made.status, 200);
  assert.equal(made.data.username, 'mstan');
  const t = await login(env, 'MSTAN', 'password123');
  assert.equal(t.role, 'teacher');
  await assert.rejects(login(env, 'mstan', 'nope'), (e) => e.status === 401);
  await assert.rejects(login(env, 'ghost', 'password123'), (e) => e.status === 401);
});

test('a generated password works, and the admin username is reserved', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  const made = await call(env, adm, 'POST', '/teachers', { name: 'Mr Lee', username: 'mrlee' });
  assert.ok(made.data.password.length >= 10);
  assert.equal((await login(env, 'mrlee', made.data.password)).role, 'teacher');
  assert.equal((await call(env, adm, 'POST', '/teachers', { name: 'X', username: 'BOSS' })).status, 409);
  assert.equal((await call(env, adm, 'POST', '/teachers', { name: 'Dup', username: 'mrlee' })).status, 409);
  assert.equal((await call(env, adm, 'POST', '/teachers', { name: 'Weak', username: 'weak1', password: 'abc' })).status, 400);
});

test('teachers only see and manage their own classes and pupils', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' });
  await call(env, adm, 'POST', '/teachers', { name: 'B', username: 'teacher-b', password: 'password-b1' });
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  const B = (await login(env, 'teacher-b', 'password-b1')).token;

  const ca = (await call(env, A, 'POST', '/classes', { name: '5A' })).data.class;
  const cb = (await call(env, B, 'POST', '/classes', { name: '5B' })).data.class;
  const root = (await call(env, adm, 'POST', '/classes', { name: 'Admin class' })).data.class;

  assert.deepEqual((await call(env, A, 'GET', '/classes')).data.classes.map((c) => c.name), ['5A']);
  assert.deepEqual((await call(env, B, 'GET', '/classes')).data.classes.map((c) => c.name), ['5B']);
  assert.equal((await call(env, adm, 'GET', '/classes')).data.classes.length, 3);

  // A cannot touch B's class or the admin's
  for (const id of [cb.id, root.id]) {
    assert.equal((await call(env, A, 'PATCH', `/classes/${id}`, { name: 'hacked' })).status, 404);
    assert.equal((await call(env, A, 'POST', `/classes/${id}/regen`, {})).status, 404);
    assert.equal((await call(env, A, 'GET', `/classes/${id}/pupils`)).status, 404);
    assert.equal((await call(env, A, 'POST', `/classes/${id}/pupils`, { pupils: [{ name: 'Sneaky', username: 'sneaky' }] })).status, 404);
    assert.equal((await call(env, A, 'DELETE', `/classes/${id}`)).status, 404);
    assert.equal((await call(env, A, 'GET', `/analytics?class=${id}`)).status, 404);
    assert.equal((await call(env, A, 'GET', `/focus?class=${id}`)).status, 404);
  }
  // A manages their own pupils
  const add = await call(env, A, 'POST', `/classes/${ca.id}/pupils`, { pupils: [{ name: 'Raj', username: 'raj' }] });
  assert.equal(add.data.added, 1);
  await call(env, B, 'POST', `/classes/${cb.id}/pupils`, { pupils: [{ name: 'Mei', username: 'mei' }] });
  const pa = (await call(env, A, 'GET', `/classes/${ca.id}/pupils`)).data.pupils[0];
  const pb = (await call(env, B, 'GET', `/classes/${cb.id}/pupils`)).data.pupils[0];
  assert.equal((await call(env, A, 'PATCH', `/pupils/${pb.id}`, { name: 'x' })).status, 404);
  assert.equal((await call(env, A, 'DELETE', `/pupils/${pb.id}`)).status, 404);
  assert.equal((await call(env, A, 'POST', `/pupils/${pb.id}/reset`)).status, 404);
  assert.equal((await call(env, A, 'GET', `/players/${pb.id}`)).status, 404);
  assert.equal((await call(env, A, 'PUT', `/players/${pb.id}`, { gold: 999 })).status, 404);
  assert.equal((await call(env, A, 'PATCH', `/pupils/${pa.id}`, { name: 'Raj T' })).status, 200);
  // pupil stats list is limited too
  assert.deepEqual((await call(env, A, 'GET', '/players')).data.pupils.map((p) => p.name), ['Raj T']);
  assert.equal((await call(env, A, 'GET', `/players?class=${cb.id}`)).status, 404);
  assert.equal((await call(env, A, 'GET', '/players?class=guests')).status, 403);
  assert.equal((await call(env, A, 'GET', '/analytics?class=guests')).status, 403);
  // a teacher cannot hand a class to someone else
  assert.equal((await call(env, A, 'PATCH', `/classes/${ca.id}`, { teacher_id: 2 })).status, 403);
});

test('admin-only areas are closed to teachers', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' });
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  for (const [m, p] of [['GET', '/teachers'], ['POST', '/teachers'], ['GET', '/verbs'], ['POST', '/verbs'], ['GET', '/verbs/review'], ['GET', '/game-config'], ['PUT', '/game-config']]) {
    assert.equal((await call(env, A, m, p, {})).status, 403, m + ' ' + p);
    assert.notEqual((await call(env, adm, m, p, {})).status, 403, 'admin ' + m + ' ' + p);
  }
  assert.equal((await call(env, A, 'DELETE', '/teachers/1')).status, 403);
  assert.equal((await call(env, A, 'POST', '/teachers/1/password', {})).status, 403);
});

test('questions: teachers see shared ones but only change their own classes’ questions', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' });
  await call(env, adm, 'POST', '/teachers', { name: 'B', username: 'teacher-b', password: 'password-b1' });
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  const B = (await login(env, 'teacher-b', 'password-b1')).token;
  const ca = (await call(env, A, 'POST', '/classes', { name: '5A' })).data.class;
  const cb = (await call(env, B, 'POST', '/classes', { name: '5B' })).data.class;
  const data = { correct: '"Come here," said Mum.', prompt: 'Come here said Mum' };

  const shared = await call(env, adm, 'POST', '/questions', { mode: 1, data });
  assert.equal(shared.status, 200);
  assert.equal((await call(env, A, 'POST', '/questions', { mode: 1, data })).status, 403); // would be shared by every class
  assert.equal((await call(env, A, 'POST', '/questions', { mode: 1, data, class_id: cb.id })).status, 400); // someone else's class
  const mine = await call(env, A, 'POST', '/questions', { mode: 1, data, class_id: ca.id });
  assert.equal(mine.status, 200);
  const theirs = await call(env, B, 'POST', '/questions', { mode: 1, data, class_id: cb.id });

  const seen = (await call(env, A, 'GET', '/questions')).data.questions.map((q) => q.id).sort();
  assert.deepEqual(seen, [shared.data.id, mine.data.id].sort()); // not B's
  assert.equal((await call(env, A, 'PUT', `/questions/${shared.data.id}`, { data })).status, 403);
  assert.equal((await call(env, A, 'DELETE', `/questions/${shared.data.id}`)).status, 403);
  assert.equal((await call(env, A, 'PUT', `/questions/${theirs.data.id}`, { data, class_id: cb.id })).status, 403);
  assert.equal((await call(env, A, 'DELETE', `/questions/${theirs.data.id}`)).status, 403);
  assert.equal((await call(env, A, 'PUT', `/questions/${mine.data.id}`, { data, class_id: ca.id })).status, 200);
  assert.equal((await call(env, A, 'PUT', `/questions/${mine.data.id}`, { data })).status, 403); // can't turn it into a shared question
  assert.equal((await call(env, A, 'DELETE', `/questions/${mine.data.id}`)).status, 200);
});

test('feedback is limited to the teacher’s own classes', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' });
  await call(env, adm, 'POST', '/teachers', { name: 'B', username: 'teacher-b', password: 'password-b1' });
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  const B = (await login(env, 'teacher-b', 'password-b1')).token;
  const ca = (await call(env, A, 'POST', '/classes', { name: '5A' })).data.class;
  const cb = (await call(env, B, 'POST', '/classes', { name: '5B' })).data.class;
  await call(env, adm, 'GET', '/feedback'); // creates the table
  for (const [c, n] of [[ca.id, 'from A'], [cb.id, 'from B'], [null, 'guest']]) await env.DB.prepare("INSERT INTO feedback (pupil_id, class_id, name, kind, message, status, ts) VALUES (1, ?1, ?2, 'bug', 'a message', 'done', 1)").bind(c, n).run();
  assert.deepEqual((await call(env, A, 'GET', '/feedback')).data.items.map((i) => i.name), ['from A']);
  assert.equal((await call(env, adm, 'GET', '/feedback')).data.items.length, 3);
  assert.equal((await call(env, A, 'DELETE', '/feedback/2')).status, 404);
  assert.equal((await call(env, A, 'PATCH', '/feedback/2', { status: 'new' })).status, 404);
  assert.equal((await call(env, A, 'POST', '/feedback/clear-done', {})).data.removed, 1);
  assert.equal((await call(env, adm, 'GET', '/feedback')).data.items.length, 2);
});

test('admin can hand a class to a teacher; deleting a teacher returns their classes to the admin', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  const t = (await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' })).data;
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  const c = (await call(env, adm, 'POST', '/classes', { name: 'Admin class' })).data.class;
  assert.equal((await call(env, A, 'GET', '/classes')).data.classes.length, 0);
  assert.equal((await call(env, adm, 'PATCH', `/classes/${c.id}`, { teacher_id: t.id })).status, 200);
  assert.equal((await call(env, A, 'GET', '/classes')).data.classes.length, 1);
  assert.equal((await call(env, adm, 'PATCH', `/classes/${c.id}`, { teacher_id: 999 })).status, 400);
  const listed = (await call(env, adm, 'GET', '/teachers')).data;
  assert.equal(listed.teachers[0].classes, 1);
  assert.equal((await call(env, adm, 'DELETE', `/teachers/${t.id}`)).status, 200);
  const after = (await call(env, adm, 'GET', '/classes')).data.classes[0];
  assert.equal(after.teacher_id, null);
  assert.equal((await call(env, A, 'GET', '/classes')).status, 401); // the deleted teacher is signed out
});

test('switching a teacher off or resetting their password signs them out at once', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  const t = (await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' })).data;
  let A = (await login(env, 'teacher-a', 'password-a1')).token;
  assert.equal((await call(env, A, 'GET', '/classes')).status, 200);
  await call(env, adm, 'PATCH', `/teachers/${t.id}`, { active: false });
  assert.equal((await call(env, A, 'GET', '/classes')).status, 401);
  await assert.rejects(login(env, 'teacher-a', 'password-a1'), (e) => e.status === 403);
  await call(env, adm, 'PATCH', `/teachers/${t.id}`, { active: true });
  A = (await login(env, 'teacher-a', 'password-a1')).token;
  assert.equal((await call(env, A, 'GET', '/classes')).status, 200);
  const reset = await call(env, adm, 'POST', `/teachers/${t.id}/password`, {});
  assert.equal((await call(env, A, 'GET', '/classes')).status, 401);
  await assert.rejects(login(env, 'teacher-a', 'password-a1'), (e) => e.status === 401);
  assert.equal((await login(env, 'teacher-a', reset.data.password)).role, 'teacher');
});

test('a teacher can change their own password; the admin cannot use that route', async () => {
  const env = makeEnv();
  const adm = (await login(env, 'boss', 'bosspass')).token;
  await call(env, adm, 'POST', '/teachers', { name: 'A', username: 'teacher-a', password: 'password-a1' });
  const A = (await login(env, 'teacher-a', 'password-a1')).token;
  assert.equal((await call(env, A, 'POST', '/me/password', { current: 'wrong', next: 'new-password1' })).status, 403);
  assert.equal((await call(env, A, 'POST', '/me/password', { current: 'password-a1', next: 'short' })).status, 400);
  assert.equal((await call(env, A, 'POST', '/me/password', { current: 'password-a1', next: 'new-password1' })).status, 200);
  assert.equal((await call(env, A, 'GET', '/me')).status, 401);
  assert.equal((await login(env, 'teacher-a', 'new-password1')).role, 'teacher');
  assert.equal((await call(env, adm, 'POST', '/me/password', { current: 'x', next: 'new-password1' })).status, 400);
  assert.deepEqual((await call(env, adm, 'GET', '/me')).data, { role: 'admin', name: 'Admin', username: null });
});

test('old admin tokens (issued before accounts existed) still work as admin', async () => {
  const env = makeEnv();
  const { signToken } = await import('../src/auth.js');
  const old = await signToken(env, { r: 't' }, 3600);
  assert.equal((await call(env, old, 'GET', '/teachers')).status, 200);
});
