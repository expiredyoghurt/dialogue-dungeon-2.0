// Pupil stats: the teacher console can view and edit every pupil's game stats (level, XP, gold, job, gear, floors ...), for beta testing.
// It sits behind the normal teacher sign-in (everything under /api/t/ already needs a teacher token), with no second password.

import { HttpError, json, readJson, clip, int } from './util.js';
import { getCfg } from './game.js';
import { isAdmin, ownClass, ownPupil, guestsOnlyAdmin } from './accounts.js';
import { ITEMS, JOBS, need, mhOf, points, TOP_FLOOR, canEquip, closeJobs, freePoints } from './gamedata.js';

// ---------- pure helpers (tested) ----------

// How many floors in a row, from Floor 1, the pupil has cleared.
export function floorsCleared(fk) {
  let n = 0;
  while (n < TOP_FLOOR && fk['n' + (n + 1)] != null && (fk[n + 1] || 0) >= fk['n' + (n + 1)]) n++;
  return n;
}

// Makes floors 1..n cleared and every floor above n untouched-looking (no kills, no stored monster count), keeping other keys.
export function applyFloorsCleared(fk, n, cfg) {
  for (let f = 1; f <= TOP_FLOOR; f++) {
    if (f <= n) {
      if (fk['n' + f] == null) fk['n' + f] = (cfg.floors.find((x) => f <= x.upTo) || cfg.floors[cfg.floors.length - 1]).min;
      fk[f] = fk['n' + f];
    } else {
      delete fk[f]; delete fk['n' + f]; delete fk['m' + f];
    }
  }
  return fk;
}

const whole = (v, lo, hi, what) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `${what} must be a whole number from ${lo} to ${hi}.`);
  return v;
};

// Checks a job list: known jobs only, villager always present, and every job's parent present too.
export function checkJobs(jobs, active) {
  if (!Array.isArray(jobs) || jobs.some((j) => typeof j !== 'string' || !JOBS[j])) throw new HttpError(400, 'Unknown job in the list.');
  const set = new Set(['villager', ...jobs]);
  for (const j of set) if (JOBS[j].p && !set.has(JOBS[j].p)) throw new HttpError(400, `${JOBS[j].n} needs ${JOBS[JOBS[j].p].n} unlocked first.`);
  if (!set.has(active)) throw new HttpError(400, 'The active job must be one of the unlocked jobs.');
  return [...set];
}

// ---------- data ----------

const DEFAULT = { level: 1, xp: 0, hp: 10, gold: 0, run_gold: 0, job: 'villager', jobs: '["villager"]', floor_kills: '{}', kills: 0, auto: 0, weapon: null, armor: null, acc: null, potion: null };
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

async function inv(env, id) {
  const rows = (await env.DB.prepare('SELECT item, qty FROM g_inv WHERE pupil_id = ?1 AND qty > 0').bind(id).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.item, r.qty]));
}

const catalogue = () => ({
  jobs: Object.fromEntries(Object.entries(JOBS).map(([id, j]) => [id, { n: j.n, e: j.e, p: j.p || null }])),
  items: Object.fromEntries(Object.entries(ITEMS).map(([id, i]) => [id, { n: i.n, e: i.e, slot: i.slot }])),
});

function summary(row, cfg) {
  const g = { ...DEFAULT, ...(row.g || {}) };
  const fk = parse(g.floor_kills, {});
  const pl = { pupil_id: row.id, level: g.level, job: g.job }; // the id seeds the pupil's HP rolls
  return {
    id: row.id, name: row.name, username: row.username, className: row.class_name || 'Guest', guest: !!row.is_guest, lastSeen: row.last_seen,
    started: !!row.g, level: g.level, xp: g.xp, need: need(g.level), hp: g.hp, maxHp: mhOf(pl, cfg), gold: g.gold, runGold: g.run_gold,
    job: g.job, jobName: (JOBS[g.job] || {}).n || g.job, jobs: parse(g.jobs, ['villager']).length, kills: g.kills, floors: floorsCleared(fk),
  };
}

async function list(env, url, actor) {
  const cfg = await getCfg(env);
  const cls = url.searchParams.get('class') || 'all', q = clip(url.searchParams.get('q') || '', 60).trim().toLowerCase();
  const where = [], binds = [];
  if (cls === 'guests') { guestsOnlyAdmin(actor); where.push('p.is_guest = 1'); }
  else if (cls !== 'all') { await ownClass(env, actor, int(cls, 0)); binds.push(int(cls, 0)); where.push(`p.class_id = ?${binds.length}`); }
  else if (!isAdmin(actor)) { binds.push(actor.id); where.push(`p.class_id IN (SELECT id FROM classes WHERE teacher_id = ?${binds.length})`); } // a teacher's 'all' means all their own pupils
  if (q) { binds.push('%' + q.replace(/[%_]/g, '') + '%'); where.push(`(lower(p.name) LIKE ?${binds.length} OR p.username LIKE ?${binds.length})`); }
  const rows = (await env.DB
    .prepare(`SELECT p.id, p.name, p.username, p.is_guest, p.last_seen, c.name AS class_name, g.pupil_id AS gid, g.level, g.xp, g.hp, g.gold, g.run_gold, g.job, g.jobs, g.kills, g.floor_kills
                FROM pupils p LEFT JOIN classes c ON c.id = p.class_id LEFT JOIN g_player g ON g.pupil_id = p.id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name, p.name LIMIT 1500`)
    .bind(...binds)
    .all()).results || [];
  const classes = (await (isAdmin(actor) ? env.DB.prepare('SELECT id, name FROM classes ORDER BY archived, name') : env.DB.prepare('SELECT id, name FROM classes WHERE teacher_id = ?1 ORDER BY archived, name').bind(actor.id)).all()).results || [];
  return json({ pupils: rows.map((r) => summary({ ...r, g: r.gid ? r : null }, cfg)), classes });
}

async function detail(env, id) {
  const cfg = await getCfg(env);
  const p = await env.DB.prepare('SELECT p.id, p.name, p.username, p.is_guest, c.name AS class_name FROM pupils p LEFT JOIN classes c ON c.id = p.class_id WHERE p.id = ?1').bind(id).first();
  if (!p) throw new HttpError(404, 'No such pupil.');
  const g = { ...DEFAULT, ...((await env.DB.prepare('SELECT * FROM g_player WHERE pupil_id = ?1').bind(id).first()) || {}) };
  const fk = parse(g.floor_kills, {});
  const fight = await env.DB.prepare('SELECT 1 AS x FROM g_fight WHERE pupil_id = ?1').bind(id).first();
  return json({
    pupil: { id: p.id, name: p.name, username: p.username, className: p.class_name || 'Guest', guest: !!p.is_guest },
    player: { level: g.level, xp: g.xp, need: need(g.level), hp: g.hp, maxHp: mhOf({ ...g, pupil_id: id }, cfg), gold: g.gold, runGold: g.run_gold, job: g.job, jobs: closeJobs(parse(g.jobs, ['villager'])), weapon: g.weapon, armor: g.armor, acc: g.acc, potion: g.potion, kills: g.kills, shop: fk.sl || 1, floors: floorsCleared(fk), storySeen: (fk.sty || []).length, jobPoints: freePoints(g.level, closeJobs(parse(g.jobs, ['villager'])).length) },
    inv: await inv(env, id),
    inFight: !!fight,
    ...catalogue(),
    topFloor: TOP_FLOOR,
  });
}

const SLOT_OF = { weapon: 'weapon', armor: 'armor', acc: 'acc', potion: 'use' };

async function update(request, env, id) {
  const b = await readJson(request);
  const cfg = await getCfg(env);
  if (!(await env.DB.prepare('SELECT 1 AS x FROM pupils WHERE id = ?1').bind(id).first())) throw new HttpError(404, 'No such pupil.');
  await env.DB.prepare('INSERT OR IGNORE INTO g_player (pupil_id) VALUES (?1)').bind(id).run();
  const pl = await env.DB.prepare('SELECT * FROM g_player WHERE pupil_id = ?1').bind(id).first();
  const fk = parse(pl.floor_kills, {});
  if (b.level !== undefined) pl.level = whole(b.level, 1, 500, 'Level');
  if (b.xp !== undefined) pl.xp = whole(b.xp, 0, 1e9, 'XP');
  if (pl.xp >= need(pl.level)) throw new HttpError(400, `XP must be below ${need(pl.level)} at level ${pl.level} (it is the XP into the current level).`);
  if (b.gold !== undefined) pl.gold = whole(b.gold, 0, 1e9, 'Gold');
  if (b.runGold !== undefined) pl.run_gold = whole(b.runGold, 0, 1e9, 'Gold in pack');
  if (b.kills !== undefined) pl.kills = whole(b.kills, 0, 1e9, 'Kills');
  if (b.jobs !== undefined || b.job !== undefined) {
    const job = b.job !== undefined ? b.job : pl.job;
    pl.jobs = JSON.stringify(checkJobs(b.jobs !== undefined ? b.jobs : parse(pl.jobs, ['villager']), job));
    pl.job = job;
  }
  const owned = b.inv !== undefined ? {} : await inv(env, id);
  if (b.inv !== undefined) {
    if (typeof b.inv !== 'object' || b.inv === null || Array.isArray(b.inv)) throw new HttpError(400, 'Inventory must be an object of item: quantity.');
    for (const [item, q] of Object.entries(b.inv)) {
      if (!ITEMS[item]) throw new HttpError(400, 'Unknown item: ' + clip(item, 30));
      owned[item] = whole(q, 0, 99, ITEMS[item].n + ' quantity');
    }
  }
  const grant = {};
  for (const [slot, kind] of Object.entries(SLOT_OF)) {
    if (b[slot] === undefined) continue;
    const item = b[slot] || null;
    if (item) {
      const it = ITEMS[item];
      if (!it || it.slot !== kind) throw new HttpError(400, `${item} does not fit the ${slot} slot.`);
      if (!canEquip(it, pl.job)) throw new HttpError(400, `${it.n} can't be used by the ${JOBS[pl.job].n} job.`);
      if (!(owned[item] > 0)) grant[item] = 1; // equipping something not owned gives the pupil one
    }
    pl[slot] = item;
  }
  if (b.auto !== undefined) pl.auto = b.auto ? 1 : 0;
  if (b.shop !== undefined) fk.sl = whole(b.shop, 1, 4, 'Shop level');
  if (b.floors !== undefined) applyFloorsCleared(fk, whole(b.floors, 0, TOP_FLOOR, 'Floors cleared'), cfg);
  if (b.resetStory) delete fk.sty;
  pl.hp = Math.min(mhOf(pl, cfg), Math.max(1, b.hp !== undefined ? whole(b.hp, 1, 1e6, 'HP') : pl.hp));
  pl.floor_kills = JSON.stringify(fk);
  const stmts = [
    env.DB.prepare('UPDATE g_player SET level=?2,xp=?3,hp=?4,gold=?5,run_gold=?6,weapon=?7,armor=?8,acc=?9,floor_kills=?10,kills=?11,job=?12,jobs=?13,potion=?14,auto=?15 WHERE pupil_id=?1')
      .bind(id, pl.level, pl.xp, pl.hp, pl.gold, pl.run_gold, pl.weapon, pl.armor, pl.acc, pl.floor_kills, pl.kills, pl.job, pl.jobs, pl.potion, pl.auto),
    env.DB.prepare('DELETE FROM g_fight WHERE pupil_id = ?1').bind(id), // a fight in progress would hold stale numbers
  ];
  const setQty = (item, q) => env.DB.prepare('INSERT INTO g_inv (pupil_id, item, qty) VALUES (?1, ?2, ?3) ON CONFLICT(pupil_id, item) DO UPDATE SET qty = ?3').bind(id, item, q);
  if (b.inv !== undefined) for (const [item, q] of Object.entries(owned)) stmts.push(setQty(item, q));
  for (const [item, q] of Object.entries(grant)) stmts.push(setQty(item, Math.max(q, owned[item] || 0)));
  await env.DB.batch(stmts);
  console.log('teacher edit pupil stats', JSON.stringify({ pupil: id, fields: Object.keys(b) }));
  return detail(env, id);
}

async function reset(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM g_fight WHERE pupil_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM g_inv WHERE pupil_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM g_player WHERE pupil_id = ?1').bind(id),
  ]);
  console.log('teacher reset pupil', JSON.stringify({ pupil: id }));
  return json({ ok: true });
}

export async function route(request, env, url, path, m, actor) {
  if (path === '/players' && m === 'GET') return list(env, url, actor);
  const r = /^\/players\/(\d+)(\/reset)?$/.exec(path);
  if (r) {
    const id = int(r[1], 0);
    await ownPupil(env, actor, id);
    if (r[2] && m === 'POST') return reset(env, id);
    if (!r[2] && m === 'GET') return detail(env, id);
    if (!r[2] && m === 'PUT') return update(request, env, id);
  }
  throw new HttpError(404, 'Not found.');
}
