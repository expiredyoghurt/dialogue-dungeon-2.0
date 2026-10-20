// Question selection shared by solo fights (game.js) and Dungeon Dive (dive.js).
//
// 1. Skill questions (skill set, not 'dialogue'): on a floor inside a skill's range, each question has a `share` % chance
//    (default 35) of coming from that skill. Overlapping skills split the floor between them, and together they never take
//    more than SHARE_CAP %. A skill that is switched off, out of range or at 0% is never served.
// 2. A passage's sibling questions (same `group`) are served back to back, in id order, once the first has been served.
// 3. Everything else comes from the ordinary pool (skill NULL or 'dialogue'), which each caller still spirals through its own way
//    (solo: the per-floor mode coverage; Dive: a random allowed mode).
// A question's own min_floor / max_floor (when set) always narrow where it can appear, in both pools.
//
// `st` is the pupil's selection memory: an object with `rq` (the last few skill question ids) and `sg` (the passage in progress).
// It is the floor_kills record in solo play and the party member in Dive, so it survives between questions either way.

import { SHARE_CAP, isSkill } from './skills.js';
import { payloadFor } from './pupil.js';

export const RECENT = 8;
export const floorOf = (level) => Math.max(1, Math.min(100, Math.floor(Number(level)) || 1));

// SQL for the ordinary pool on a floor (floor is always an integer from floorOf, so it is safe to inline).
export const baseWhere = (floor) => `(skill IS NULL OR skill = 'dialogue') AND (min_floor IS NULL OR min_floor <= ${floor}) AND (max_floor IS NULL OR max_floor >= ${floor})`;
const skillWhere = (ids, floor) => `skill IN (${ids.map((i) => `'${i}'`).join(',')}) AND (min_floor IS NULL OR min_floor <= ${floor}) AND (max_floor IS NULL OR max_floor >= ${floor})`;

// Rows of the ordinary pool, in random order.
export async function baseRows(env, vis, mode, floor, limit = 10) {
  return (await env.DB.prepare(`SELECT id, mode, data FROM questions WHERE ${vis.where} AND ${baseWhere(floor)} AND mode = ${Number(mode)} ORDER BY RANDOM() LIMIT ${Number(limit)}`).bind(...vis.binds).all()).results || [];
}

// Skills that may be served on this floor right now.
export function liveSkills(floor, cfg) {
  return Object.entries((cfg && cfg.skills) || {}).filter(([id, s]) => isSkill(id) && s && s.on && s.share > 0 && floor >= s.min && floor <= s.max);
}

// Rolls which skill (if any) this question comes from. rnd() is injectable for tests.
export function skillRoll(floor, cfg, rnd = Math.random) {
  const live = liveSkills(floor, cfg);
  if (!live.length) return null;
  const sum = live.reduce((n, [, s]) => n + s.share, 0);
  const k = live.length > 1 ? Math.min(1, SHARE_CAP / sum) : 1;
  let r = rnd() * 100;
  for (const [id, s] of live) {
    r -= s.share * k;
    if (r < 0) return id;
  }
  return null;
}

const asQ = (row) => {
  const data = JSON.parse(row.data);
  const p = payloadFor(row.mode, data);
  return p ? { id: row.id, mode: row.mode, p, group: data.group || null } : null;
};

// Picks a skill question, or returns null (the caller then uses the ordinary pool).
// exclude: Set of question ids not to serve (the previous question; in a party, the other members' questions).
export async function pickSkillQuestion(env, vis, floor, cfg, st, exclude = new Set(), rnd = Math.random) {
  const live = liveSkills(floor, cfg);
  if (!live.length) {
    st.sg = null; // nothing live here (skill switched off or out of range): a passage in progress is dropped
    return null;
  }
  const remember = (q) => {
    st.rq = [...(st.rq || []), q.id].slice(-RECENT);
    if (q.group) st.sg = { g: q.group, f: floor, d: [...(st.sg && st.sg.g === q.group && st.sg.f === floor ? st.sg.d : []), q.id] };
    else st.sg = null;
    return { id: q.id, mode: q.mode, p: q.p };
  };

  // A passage in progress: its next unserved sibling comes straight away (if its skill is still on and in range).
  if (st.sg && st.sg.f === floor) {
    const rows = (await env.DB.prepare(`SELECT id, mode, data FROM questions WHERE ${vis.where} AND ${skillWhere(live.map(([id]) => id), floor)} ORDER BY id LIMIT 80`).bind(...vis.binds).all()).results || [];
    for (const row of rows) {
      if (exclude.has(row.id) || st.sg.d.includes(row.id)) continue;
      const q = asQ(row);
      if (q && q.group === st.sg.g) return remember(q);
    }
  }
  st.sg = null;

  const id = skillRoll(floor, cfg, rnd);
  if (!id) return null;
  const rows = (await env.DB.prepare(`SELECT id, mode, data FROM questions WHERE ${vis.where} AND ${skillWhere([id], floor)} ORDER BY RANDOM() LIMIT 80`).bind(...vis.binds).all()).results || [];
  const recent = new Set(st.rq || []);
  const qs = rows.filter((r) => !exclude.has(r.id)).map(asQ).filter(Boolean);
  const fresh = qs.filter((q) => !recent.has(q.id));
  const pool = fresh.length ? fresh : qs; // everything seen lately: repeat rather than skip the skill
  if (!pool.length) return null;
  let q = pool[Math.floor(rnd() * pool.length)];
  if (q.group) q = pool.filter((x) => x.group === q.group).sort((a, b) => a.id - b.id)[0]; // start a passage at its first question
  return remember(q);
}
