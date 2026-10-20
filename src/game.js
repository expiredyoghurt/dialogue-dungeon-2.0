// Dialogue Dungeon game API. The server owns all combat state; the browser only displays it.
import { HttpError, json, readJson, int } from './util.js';
import * as pupil from './pupil.js';
import { SKILLS } from './skills.js';
import { baseRows, pickSkillQuestion, floorOf } from './select.js';
import { storyState, markSeen, bossLabel } from './story.js';
import { TURN_MS, TOP_FLOOR, MAX_DROP, DEFAULT_CFG, cfgFrom, hpFor, floorInfo, need, hpGain, hpSeed, hpSpread, levelDodge, monsterDodge, sureJob, sureMob, ITEMS, MOBS, JOBS, points, canUse, shopFor, stageOf, perksOf, mhOf, canEquip, PERKS, BASE, applyItems, RANGED, closeJobs, nextPoint, freePoints } from './gamedata.js';
import { capStat, playerStrike, strikeEffects, monsterHit, STUN_MS } from './combat.js';

const rnd = (n) => Math.floor(Math.random() * n);
const shopLv = (pl) => Math.min(stageOf(JSON.parse(pl.jobs)), JSON.parse(pl.floor_kills || '{}').sl || 1);
const pick = (a) => a[rnd(a.length)];
// A floor is cleared when its monster count (rolled on first entry, stored as fk['n'+floor]) has been defeated.
const cleared = (fk, n) => fk['n' + n] != null && (fk[n] || 0) >= fk['n' + n];
const needFor = (n, cfg) => {
  const b = cfg.floors.find((x) => n <= x.upTo) || cfg.floors[cfg.floors.length - 1];
  return b.min + rnd(b.max - b.min + 1);
};
const db = (env) => env.DB;
// Respawn: wipes the kill count of every floor that is not cleared yet (the floor's monster count n<floor> is kept, so it can't be re-rolled).
// Returns how many floors were reset.
export function resetFloors(pl) {
  const fk = JSON.parse(pl.floor_kills || '{}');
  let n = 0;
  for (const k of Object.keys(fk)) {
    const m = /^n(\d+)$/.exec(k);
    if (!m) continue;
    const fl = m[1];
    if ((fk[fl] || 0) > 0 && fk[fl] < fk[k]) { fk[fl] = 0; delete fk['m' + fl]; n++; }
  }
  if (n) pl.floor_kills = JSON.stringify(fk);
  return n;
}
// Correct answers a fight needs before the monster may die: regular / mid-boss / boss (cfg.must, 0 = none).
export const mustFor = (mob, cfg) => { const k = MOBS[mob] && MOBS[mob].kind; return (k === 'boss' ? cfg.must.boss : k === 'mid' ? cfg.must.mid : cfg.must.mob) || 0; };
// Gentle start applies while the pupil is below the configured level.
export const gentle = (pl, cfg) => !!(cfg.start && cfg.start.levels > 0 && pl.level < cfg.start.levels);

async function getPlayer(env, p) {
  await db(env).prepare('INSERT OR IGNORE INTO g_player (pupil_id) VALUES (?1)').bind(p.id).run();
  const pl = await db(env).prepare('SELECT * FROM g_player WHERE pupil_id = ?1').bind(p.id).first();
  const have = JSON.parse(pl.jobs), all = closeJobs(have); // saves from before the gate jobs existed are completed here; the next save stores it
  if (all.length !== have.length) pl.jobs = JSON.stringify(all);
  return pl;
}
const save = (env, pl) =>
  db(env)
    .prepare('UPDATE g_player SET level=?2,xp=?3,hp=?4,gold=?5,run_gold=?6,weapon=?7,armor=?8,acc=?9,floor_kills=?10,kills=?11,job=?12,jobs=?13,potion=?14,auto=?15 WHERE pupil_id=?1')
    .bind(pl.pupil_id, pl.level, pl.xp, pl.hp, pl.gold, pl.run_gold, pl.weapon, pl.armor, pl.acc, pl.floor_kills, pl.kills, pl.job, pl.jobs, pl.potion, pl.auto)
    .run();
async function inv(env, id) {
  const rows = (await db(env).prepare('SELECT item, qty FROM g_inv WHERE pupil_id = ?1 AND qty > 0').bind(id).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.item, r.qty]));
}
export const addItem = (env, id, item, d = 1) =>
  db(env).prepare('INSERT INTO g_inv (pupil_id, item, qty) VALUES (?1, ?2, ?3) ON CONFLICT(pupil_id, item) DO UPDATE SET qty = qty + ?3').bind(id, item, d).run();
export const gear = (pl, cfg) => {
  const own = (id) => (ITEMS[id] && canEquip(ITEMS[id], pl.job) ? ITEMS[id] : {});
  const w = own(pl.weapon), a = own(pl.armor), c = own(pl.acc), P = perksOf(pl.job, cfg), d = (JOBS[pl.job]?.d || 1);
  const sum = (k) => capStat(k, (w[k] || 0) + (a[k] || 0) + (c[k] || 0) + (P[k] || 0)); // gear and job perk, capped (see combat.js)
  const spd = (w.spd || 0) + (a.spd || 0) + (c.spd || 0) + (P.spd || 0);
  // atk = the biggest regular hit; bat = what the answer strike is built on (a weapon's `pw`, so fast or slow styles don't change what a correct answer is worth)
  return { atk: d + (w.atk || 0), bat: d + (w.pw ?? w.atk ?? 0), def: (a.def || 0) + (P.dr || 0), gold: (c.gold || 0) + (P.gold || 0), xp: (c.xp || 0) + (P.xp || 0), heal: c.heal || 0, ip: Math.round((cfg.speed.turn * 1000) / (1 + Math.min(cfg.speed.cap, Math.max(-0.5, spd)))), P, dbl: sum('dbl'), crit: sum('crit'), par: sum('par'), ref: sum('ref'), stn: sum('stn'), lch: sum('lch'), dod: capStat('dod', levelDodge(pl.level, cfg) + (P.dod || 0)), sure: sureJob(pl.job, cfg) }; // dodge: the level's base chance plus the job perk, capped
};
// perk damage multiplier: rage below half HP, extra damage against mid-bosses and bosses
export const dmgMult = (pl, f, P, cfg) => 1 + (pl.hp < mhOf(pl, cfg) / 2 ? P.rage || 0 : 0) + (MOBS[f.mob] && MOBS[f.mob].kind ? P.boss || 0 : 0);

export async function getCfg(env) {
  const r = await db(env).prepare("SELECT v FROM g_config WHERE k = 'cfg'").first();
  const cfg = cfgFrom(r ? JSON.parse(r.v) : null);
  applyItems(cfg); // item prices and stats come from the game balance tab
  return cfg;
}

export async function configView(env) {
  const cfg = await getCfg(env);
  return json({ cfg, skillDefs: SKILLS, items: ITEMS, mobs: MOBS, perkDefs: PERKS, jobs: JOBS, preview: [1, 5, 10, 20, 50, 100].map((l) => [l, hpFor(l, cfg)]), playerPreview: [1, 10, 20, 30, 50, 70, 100].map((l) => ({ l, ...hpSpread(l, cfg), dodge: levelDodge(l, cfg) })) });
}

export async function configSave(request, env) {
  const b = await readJson(request);
  const n = (v, lo, hi, d) => ((v = Number(v)), Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const tiers = (Array.isArray(b.hp?.tiers) ? b.hp.tiers : []).map((t) => ({ upTo: Math.round(n(t.upTo, 0, 1000, 0)), per: Math.round(n(t.per, 0, 1000, 0)) })).filter((t) => t.upTo >= 1).sort((a, c) => a.upTo - c.upTo);
  if (!tiers.length) throw new HttpError(400, 'Add at least one HP tier.');
  // Player HP: tiers of { upTo, gains: [[hp, chance], ...] }. Chances are relative, entries with no chance are dropped, equal HP amounts are merged.
  const ptiers = (Array.isArray(b.php?.tiers) ? b.php.tiers : []).map((t) => {
    const m = new Map();
    for (const x of Array.isArray(t.gains) ? t.gains : []) { const hp = Math.round(n(x && x[0], 0, 1000, -1)), w = n(x && x[1], 0, 100000, 0); if (hp >= 0 && w > 0) m.set(hp, (m.get(hp) || 0) + w); }
    return { upTo: Math.round(n(t.upTo, 0, 1000, 0)), gains: [...m.entries()].sort((p, q) => p[0] - q[0]) };
  }).filter((t) => t.upTo >= 1).sort((p, q) => p.upTo - q.upTo);
  if (b.php?.tiers != null && !ptiers.length) throw new HttpError(400, 'Add at least one player HP tier.'); // (a request that leaves player HP out gets the defaults)
  if (ptiers.some((t) => !t.gains.length)) throw new HttpError(400, 'Every player HP tier needs at least one HP amount with a chance above 0.');
  const dtiers = (Array.isArray(b.dodge?.tiers) ? b.dodge.tiers : []).map((t) => ({ upTo: Math.round(n(t.upTo, 0, 1000, 0)), v: Math.round(n(t.v, 0, 1, 0) * 10000) / 10000 })).filter((t) => t.upTo >= 1).sort((p, q) => p.upTo - q.upTo);
  if (b.dodge?.tiers != null && !dtiers.length) throw new HttpError(400, 'Add at least one dodge tier.');
  const floors = (Array.isArray(b.floors) ? b.floors : []).map((x) => { const mn = Math.round(n(x.min, 1, 200, 1)); return { upTo: Math.round(n(x.upTo, 0, 1000, 0)), min: mn, max: Math.max(mn, Math.round(n(x.max, 1, 200, mn))) }; }).filter((x) => x.upTo >= 1).sort((a, c) => a.upTo - c.upTo);
  if (!floors.length) throw new HttpError(400, 'Add at least one floor range.');
  const D = DEFAULT_CFG.def;
  const out = { v: 16, sure: { jobs: Object.fromEntries(Object.keys(JOBS).filter((id) => (b.sure ? b.sure.jobs?.[id] : DEFAULT_CFG.sure.jobs[id])).map((id) => [id, true])), mobs: Object.fromEntries(Object.keys(MOBS).filter((id) => b.sure?.mobs?.[id]).map((id) => [id, true])) }, mdodge: { mob: n(b.mdodge?.mob, 0, 1, DEFAULT_CFG.mdodge.mob), mid: n(b.mdodge?.mid, 0, 1, DEFAULT_CFG.mdodge.mid), boss: n(b.mdodge?.boss, 0, 1, DEFAULT_CFG.mdodge.boss) }, hp: { base: Math.round(n(b.hp?.base, 1, 100000, 5)), tiers }, php: { base: Math.round(n(b.php?.base, 1, 100000, DEFAULT_CFG.php.base)), tiers: ptiers.length ? ptiers : DEFAULT_CFG.php.tiers }, dodge: { tiers: dtiers.length ? dtiers : DEFAULT_CFG.dodge.tiers }, floors, def: { goldMin: n(b.def?.goldMin, 0, 1000, D.goldMin), goldMax: n(b.def?.goldMax, 0, 1000, D.goldMax), xp: n(b.def?.xp, 0, 1000, D.xp), dmg: n(b.def?.dmg, 0, 10, D.dmg) }, mobs: {} };
  out.def.goldMax = Math.max(out.def.goldMax, out.def.goldMin);
  const B = DEFAULT_CFG.boss;
  out.boss = { midHp: n(b.boss?.midHp, 1, 100, B.midHp), midDmg: n(b.boss?.midDmg, 0, 20, B.midDmg), bossHp: n(b.boss?.bossHp, 1, 100, B.bossHp), bossDmg: n(b.boss?.bossDmg, 0, 20, B.bossDmg), rageDmg: n(b.boss?.rageDmg, 0, 20, B.rageDmg), lo: n(b.boss?.lo, 0, 10, B.lo), hi: n(b.boss?.hi, 0, 10, B.hi) };
  out.boss.hi = Math.max(out.boss.hi, out.boss.lo);
  out.respawn = !!b.respawn;
  out.story = b.story == null ? true : !!b.story;
  out.xpMode = b.xpMode === 'damage' ? 'damage' : 'level';
  const DV = DEFAULT_CFG.dive;
  out.dive = { on: !!b.dive?.on, hpPer: n(b.dive?.hpPer, 0, 10, DV.hpPer), poolPer: n(b.dive?.poolPer, 0, 10, DV.poolPer), balanced: n(b.dive?.balanced, 0, 5, DV.balanced), gap: n(b.dive?.gap, 2, 60, DV.gap), revive: n(b.dive?.revive, 0, 1, DV.revive), hpScale: b.dive?.hpScale == null ? DV.hpScale : !!b.dive.hpScale, bosses: !!b.dive?.bosses, midEvery: Math.round(n(b.dive?.midEvery, 0, 1000, DV.midEvery)), bossEvery: Math.round(n(b.dive?.bossEvery, 0, 1000, DV.bossEvery)), dropMult: n(b.dive?.dropMult, 0, 20, DV.dropMult) };
  out.strike = n(b.strike, 0, 50, DEFAULT_CFG.strike);
  out.must = { mob: Math.round(n(b.must?.mob, 0, 50, DEFAULT_CFG.must.mob)), mid: Math.round(n(b.must?.mid, 0, 50, DEFAULT_CFG.must.mid)), boss: Math.round(n(b.must?.boss, 0, 50, DEFAULT_CFG.must.boss)) };
  const S1 = DEFAULT_CFG.start;
  out.start = { levels: Math.round(n(b.start?.levels, 0, 100, S1.levels)), gold: n(b.start?.gold, 0, 100, S1.gold), xp: n(b.start?.xp, 0, 100, S1.xp), dmg: n(b.start?.dmg, 0, 10, S1.dmg), bossHp: n(b.start?.bossHp, 0.05, 10, S1.bossHp) };
  out.shopCost = [0, 1, 2].map((i) => Math.round(n(b.shopCost && b.shopCost[i], 0, 1e7, DEFAULT_CFG.shopCost[i])));
  const S0 = DEFAULT_CFG.speed, turn = n(b.speed?.turn, 2, 120, S0.turn);
  out.speed = { turn, offset: n(b.speed?.offset, 0, turn - 1, S0.offset), ranged: n(b.speed?.ranged, 0, 60, S0.ranged), cap: n(b.speed?.cap, 0, 5, S0.cap), monster: n(b.speed?.monster, -0.5, 5, S0.monster) };
  out.perks = {};
  for (const id of Object.keys(JOBS)) {
    const o = {};
    for (const [k] of PERKS) { const v = Number((b.perks && b.perks[id] || {})[k]); if (v > 0) o[k] = Math.min(v, 100); }
    if (Object.keys(o).length) out.perks[id] = o;
  }
  for (const id of Object.keys(MOBS)) {
    const m = (b.mobs && b.mobs[id]) || {}, o = { drops: {} };
    for (const k of ['goldMin', 'goldMax', 'xp']) if (m[k] != null) o[k] = n(m[k], 0, 1000, 0);
    for (const [item, r] of Object.entries(m.drops || {})) if (ITEMS[item] && Number(r) > 0) o.drops[item] = Math.min(MAX_DROP, n(r, 0, 1, 0));
    out.mobs[id] = o;
  }
  const T = DEFAULT_CFG.training;
  out.training = { xpMult: n(b.training?.xpMult, 0, 10, T.xpMult), bonusMult: n(b.training?.bonusMult, 1, 10, T.bonusMult), weakest: Math.round(n(b.training?.weakest, 0, 13, T.weakest)), dailyMonsters: Math.round(n(b.training?.dailyMonsters, 0, 500, T.dailyMonsters)), tz: Math.round(n(b.training?.tz, -12, 14, T.tz)), levelCap: Math.round(n(b.training?.levelCap, 1, 100, T.levelCap)) };
  out.skills = {};
  for (const [id, d] of Object.entries(SKILLS)) {
    const r = (b.skills && b.skills[id]) || {}, lo = Math.round(n(r.min, 1, 100, d.min));
    out.skills[id] = { on: r.on == null ? true : !!r.on, share: Math.round(n(r.share, 0, 100, 35)), min: lo, max: Math.max(lo, Math.round(n(r.max, 1, 100, d.max))) };
  }
  out.items = {};
  const LIM = { st: [1, 4], price: [0, 1e7], atk: [0, 1000], def: [0, 1000], gold: [0, 100], xp: [0, 100], heal: [0, 1000], spd: [-1, 5], pw: [0, 1000], dbl: [0, 1], crit: [0, 1], par: [0, 1], ref: [0, 1], stn: [0, 1], lch: [0, 1] };
  const FRAC = ['gold', 'xp', 'spd', 'dbl', 'crit', 'par', 'ref', 'stn', 'lch']; // stored as fractions, not rounded to whole numbers
  for (const [id, base] of Object.entries(BASE)) {
    const o = {}, v0 = (b.items && b.items[id]) || {};
    for (const [k, [lo, hi]] of Object.entries(LIM)) {
      if (base[k] == null || v0[k] == null || !Number.isFinite(Number(v0[k]))) continue;
      const x = FRAC.includes(k) ? n(v0[k], lo, hi, base[k]) : Math.round(n(v0[k], lo, hi, base[k]));
      if (x !== base[k]) o[k] = x;
    }
    if (Object.keys(o).length) out.items[id] = o;
  }
  await db(env).prepare("INSERT INTO g_config (k, v) VALUES ('cfg', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(JSON.stringify(out)).run();
  return json({ ok: true });
}

// Which of the ordinary question modes a floor may use: floors 1-10 mode 1; 11-50 modes 1-2; 51-100 modes 1-3.
// (Skill questions, including the new modes 4-6, are chosen first by select.js and follow their own floor ranges.)
// Each floor tracks (fk['m'+floor], a bitmask) which modes it has served, and leans harder toward the missing ones
// as the floor runs out of monsters, so every allowed mode shows up at least once per floor.
export const modesFor = (floor) => (floor <= 10 ? [1] : floor <= 50 ? [1, 2] : [1, 2, 3]);
async function nextQuestion(env, p, exclude, floor, pl, cfg) {
  cfg = cfg || (await getCfg(env));
  const allowed = modesFor(floor);
  const fk = JSON.parse(pl.floor_kills || '{}');
  const v = pupil.visibleSql(p);
  // Skill questions first: on a floor inside a skill's range the skill is served about `share`% of the time (see select.js).
  const sk = await pickSkillQuestion(env, v, floorOf(floor), cfg, fk, new Set([exclude]));
  if (sk) {
    pl.floor_kills = JSON.stringify(fk);
    await save(env, pl);
    return sk;
  }
  const seen = fk['m' + floor] || 0, need = fk['n' + floor], done = fk[floor] || 0;
  const missing = allowed.filter((m) => !(seen & (1 << m)));
  const farming = need != null && done >= need;
  let modes = allowed;
  if (missing.length && !farming && (done >= (need || 1) - 1 || Math.random() < Math.max(0.35, (done + 1) / (need || 1)))) modes = missing;
  for (const mode of [pick(modes), ...allowed]) {
    const rows = await baseRows(env, v, mode, floorOf(floor));
    for (const q of rows) {
      if (q.id === exclude && rows.length > 1) continue;
      const payload = pupil.payloadFor(q.mode, JSON.parse(q.data));
      if (!payload) continue;
      fk['m' + floor] = seen | (1 << mode);
      pl.floor_kills = JSON.stringify(fk);
      await save(env, pl);
      return { id: q.id, mode: q.mode, p: payload };
    }
  }
  return null;
}

// Plays out, in time order, every hit that has come due since the last visit. Pupil and monster each have their own
// attack timer (p_next / m_next), so attack speed, ranged first strikes and the monster's earlier first attack all fall out of it.
// The hits are returned too, so the browser can animate them one by one.
export function sim(pl, f, cfg, pot, now) {
  const g = gear(pl, cfg), kind = MOBS[f.mob] && MOBS[f.mob].kind, b = cfg.boss, ev = [], mh = mhOf(pl, cfg);
  const im = (cfg.speed.turn * 1000) / (1 + cfg.speed.monster), floorT = now - 3 * cfg.speed.turn * 1000; // an idle tab only owes ~3 turns
  f.p_next = Math.max(f.p_next, floorT);
  f.m_next = Math.max(f.m_next, floorT);
  for (let i = 0; i < 60; i++) {
    const who = f.p_next <= f.m_next ? 'p' : 'm', t = who === 'p' ? f.p_next : f.m_next;
    if (t > now) break;
    if (who === 'p') {
      const pmax = Math.max(1, Math.round(g.atk * dmgMult(pl, f, g.P, cfg)));
      const md = monsterDodge(f.mob, cfg);
      if (md && !g.sure && Math.random() < md) { // the monster dodges: the attack misses and deals 0 (no crit, stun or leech)
        ev.push({ t, who, d: 0, miss: 1, mh: Math.max(0, f.mob_hp), ph: pl.hp });
        f.p_next += g.ip;
        continue;
      }
      const { d, x } = playerStrike(g, pmax); // a random 1 to the pupil's maximum; critical hits (dbl) do double
      f.mob_hp -= d;
      if (f.mob_hp <= 0 && (JSON.parse(pl.floor_kills || '{}').ca || 0) < mustFor(f.mob, cfg)) f.mob_hp = 1; // not enough correct answers yet: it survives
      const e = { t, who, d, x, mh: Math.max(0, f.mob_hp), ph: pl.hp };
      ev.push(e);
      if (f.mob_hp <= 0) return { res: 'win', ev };
      const fx = strikeEffects(g, d, pl.hp, mh); // stun delays the monster's next strike, leech gives HP back
      if (fx.stun) { f.m_next += STUN_MS; e.st = 1; }
      if (fx.heal) { pl.hp += fx.heal; e.lc = fx.heal; e.ph = pl.hp; }
      f.p_next += g.ip;
    } else {
      const mult = kind === 'mid' ? b.midDmg : kind === 'boss' ? (f.mob_hp < f.mob_max * 0.5 ? b.rageDmg : b.bossDmg) : 1;
      const fk = JSON.parse(pl.floor_kills || '{}');
      let d = 0, par = 0, rf = 0, dod = 0;
      if (fk.sk > 0) {
        fk.sk--; // archer perk: the monster's first hit(s) in a fight are skipped
        pl.floor_kills = JSON.stringify(fk);
      } else {
        const mmax = Math.ceil(f.level * cfg.def.dmg * mult * (gentle(pl, cfg) ? cfg.start.dmg : 1));
        const roll = kind ? Math.round(mmax * (b.lo + Math.random() * (b.hi - b.lo))) : 1 + rnd(Math.max(1, mmax));
        ({ d, dod, par, rf } = monsterHit(sureMob(f.mob, cfg) ? { ...g, dod: 0 } : g, roll)); // a sure-hit monster ignores the pupil's dodge
        // a dodge or a parry negates the hit, reflect sends part of it back
        pl.hp -= d;
      }
      if (rf && pl.hp > 0) {
        f.mob_hp -= rf;
        if (f.mob_hp <= 0 && (fk.ca || 0) < mustFor(f.mob, cfg)) f.mob_hp = 1; // a reflect cannot skip the answers a monster needs either
      } else rf = 0;
      ev.push({ t, who, d, mh: Math.max(0, f.mob_hp), ph: Math.max(0, pl.hp), ...(dod ? { dod: 1 } : {}), ...(par ? { par: 1 } : {}), ...(rf ? { rf } : {}) });
      if (pl.hp <= 0) return { res: 'lose', ev };
      if (f.mob_hp <= 0) return { res: 'win', ev };
      if (pl.auto && pot.qty > 0 && pl.hp * 10 < mh * 3) {
        const h = Math.min(mh, pl.hp + pot.heal) - pl.hp;
        pl.hp += h; pot.qty--; pot.used++;
        ev.push({ t, who: 'pot', d: h, mh: f.mob_hp, ph: pl.hp });
      }
      f.m_next += im;
    }
  }
  return { res: null, ev };
}

// Adds XP and takes the pupil up any levels it earns (the HP each level adds: see Player HP in the game balance tab).
function addXp(pl, xp, cfg, out) {
  pl.xp += xp;
  while (pl.xp >= need(pl.level)) {
    pl.xp -= need(pl.level);
    pl.level++;
    const gain = hpGain(pl.level, cfg, hpSeed(pl));
    pl.hp += gain;
    out.hpGain = (out.hpGain || 0) + gain;
    out.levelUps = (out.levelUps || 0) + 1;
  }
}

// Training Grounds (v1.8): a training monster is as strong as the pupil: their level, but never above training.levelCap (default 20).
export const trainingLevel = (pl, cfg) => Math.max(1, Math.min(cfg.training.levelCap, pl.level));
export async function trainingLevelFor(env, p) {
  return trainingLevel(await getPlayer(env, p), await getCfg(env));
}

// The XP for one defeated training monster. No gold, no drops, no HP lost.
// frac = how much of the full reward the answer earned (1 first try, less on later tries); mult = the daily bonus (1 or bonusMult).
// Same formula as a dungeon monster of that level (gear and job XP bonuses, gentle start), times training.xpMult.
export async function trainingReward(env, p, { frac, mult }) {
  const cfg = await getCfg(env), pl = await getPlayer(env, p), g = gear(pl, cfg);
  const level = trainingLevel(pl, cfg); // taken before the XP is added, so a level-up doesn't change this monster
  const xp = Math.max(1, Math.round(cfg.def.xp * level * cfg.training.xpMult * (1 + g.xp) * (gentle(pl, cfg) ? cfg.start.xp : 1) * frac * mult));
  const out = { xp, level, levelUps: 0 };
  addXp(pl, xp, cfg, out);
  pl.hp = Math.min(mhOf(pl, cfg), pl.hp);
  await save(env, pl);
  return { ...out, newLevel: pl.level, xpNow: pl.xp, need: need(pl.level) };
}

async function finish(env, p, pl, f, res) {
  const cfg = await getCfg(env);
  await db(env).prepare('DELETE FROM g_fight WHERE pupil_id = ?1').bind(p.id).run();
  if (res === 'lose') {
    const lost = pl.run_gold;
    pl.run_gold = 0;
    pl.hp = mhOf(pl, cfg);
    const reset = cfg.respawn ? resetFloors(pl) : 0;
    await save(env, pl);
    return { result: 'lose', lost, floor: f.floor, reset: reset > 0 };
  }
  const g = gear(pl, cfg);
  const out = { result: 'win', floor: f.floor, levelUps: 0 };
  const mc = cfg.mobs[f.mob] || {}, d = { ...cfg.def, ...mc };
  const lo = d.goldMin * f.level, hi = Math.max(lo, d.goldMax * f.level);
  const gs = gentle(pl, cfg); // gentle start: bigger rewards while the pupil is still below the set level
  out.gold = Math.max(1, Math.round((lo + Math.random() * (hi - lo)) * (1 + g.gold) * (gs ? cfg.start.gold : 1)));
  const sd = cfg.xpMode === 'damage' ? Math.round(JSON.parse(pl.floor_kills || '{}').sd || 0) : 0;
  out.xpBonus = Math.round(sd * 0.5); // 'damage' XP mode: 50% of the damage dealt by answer strikes, on top of the fixed XP
  out.xp = Math.round((d.xp * f.level + sd * 0.5) * (1 + g.xp) * (gs ? cfg.start.xp : 1));
  pl.run_gold += out.gold;
  pl.kills++;
  addXp(pl, out.xp, cfg, out);
  pl.hp = Math.min(mhOf(pl, cfg), pl.hp + g.heal);
  const fk = JSON.parse(pl.floor_kills || '{}');
  fk[f.floor] = (fk[f.floor] || 0) + 1;
  if (fk['n' + f.floor] != null && fk[f.floor] === fk['n' + f.floor]) out.stairs = f.floor;
  pl.floor_kills = JSON.stringify(fk);
  out.drops = [];
  const have = await inv(env, p.id);
  for (const [id, rate] of Object.entries(mc.drops || {})) {
    const it = ITEMS[id];
    if (!it || Math.random() >= Math.min(rate, MAX_DROP)) continue;
    if (it.slot !== 'use' && have[id]) {
      const v = Math.floor(it.price / 2);
      pl.run_gold += v;
      out.drops.push({ id, dup: v });
    } else {
      await addItem(env, p.id, id);
      have[id] = 1;
      out.drops.push({ id });
    }
  }
  await save(env, pl);
  return out;
}

async function load(env, p) {
  const pl = await getPlayer(env, p);
  let f = await db(env).prepare('SELECT * FROM g_fight WHERE pupil_id = ?1').bind(p.id).first();
  let ended = null, events = [];
  if (f) {
    const cfg = await getCfg(env), now = Date.now();
    if (!f.p_next) { // fight created before the attack timers existed
      f.p_next = now + gear(pl, cfg).ip;
      f.m_next = now + cfg.speed.turn * 1000 - cfg.speed.offset * 1000;
      await db(env).prepare('UPDATE g_fight SET p_next = ?2, m_next = ?3 WHERE pupil_id = ?1').bind(p.id, f.p_next, f.m_next).run();
    }
    if (Math.min(f.p_next, f.m_next) <= now) {
      const it = ITEMS[pl.potion];
      const pot = { qty: it ? (await inv(env, p.id))[pl.potion] || 0 : 0, heal: it ? Math.round(it.heal * (1 + (perksOf(pl.job, cfg).potion || 0))) : 0, used: 0 };
      const r = sim(pl, f, cfg, pot, now);
      events = r.ev;
      if (pot.used) await addItem(env, p.id, pl.potion, -pot.used);
      if (r.res) {
        ended = await finish(env, p, pl, f, r.res);
        ended.potions = pot.used;
        f = null;
      } else {
        await save(env, pl);
        await db(env).prepare('UPDATE g_fight SET mob_hp = ?2, p_next = ?3, m_next = ?4 WHERE pupil_id = ?1').bind(p.id, f.mob_hp, Math.round(f.p_next), Math.round(f.m_next)).run();
      }
    }
  }
  return { pl, f, ended, events };
}

async function view(env, p, extra = {}) {
  const pl = await getPlayer(env, p);
  const f = await db(env).prepare('SELECT * FROM g_fight WHERE pupil_id = ?1').bind(p.id).first();
  const cfg = await getCfg(env);
  const g = gear(pl, cfg);
  const fk = JSON.parse(pl.floor_kills || '{}');
  let top = 1;
  while (top < TOP_FLOOR && cleared(fk, top)) top++;
  let fight = null;
  if (f) {
    let q = null;
    const row = await db(env).prepare('SELECT id, mode, data FROM questions WHERE id = ?1 AND active = 1').bind(f.qid).first();
    if (row) {
      const payload = pupil.payloadFor(row.mode, JSON.parse(row.data));
      if (payload) q = { id: row.id, mode: row.mode, p: payload };
    }
    if (!q) {
      q = await nextQuestion(env, p, f.qid, f.floor, pl, cfg);
      if (q) await db(env).prepare('UPDATE g_fight SET qid = ?2 WHERE pupil_id = ?1').bind(p.id, q.id).run();
    }
    const m = MOBS[f.mob] || MOBS.slime; // (fights saved before the monster change fall back to a slime)
    fight = { name: bossLabel(f.floor, m.kind, m.n, cfg.story), e: m.e, img: m.img || null, level: f.level, mobHp: f.mob_hp, mobMax: f.mob_max, floor: f.floor, kind: m.kind || null, rage: m.kind === 'boss' && f.mob_hp < f.mob_max * 0.5, kills: fk[f.floor] || 0, need: fk['n' + f.floor], ca: fk.ca || 0, ansNeed: mustFor(f.mob, cfg), pNext: f.p_next, mNext: f.m_next, ip: g.ip, im: Math.round((cfg.speed.turn * 1000) / (1 + cfg.speed.monster)), ranged: RANGED.has(pl.job), now: Date.now(), q };
  }
  return json({
    me: { name: p.name, level: pl.level, xp: pl.xp, need: need(pl.level), hp: pl.hp, maxHp: mhOf(pl, cfg), gold: pl.gold, runGold: pl.run_gold, weapon: pl.weapon, armor: pl.armor, acc: pl.acc, kills: pl.kills, atk: g.atk, strikeN: cfg.strike + (g.P.mult || 0), bonus: Math.round((cfg.strike + (g.P.mult || 0)) * g.bat), def: g.def, sure: g.sure, cs: { dod: g.dod, dbl: g.dbl, crit: g.crit, par: g.par, ref: g.ref, stn: g.stn, lch: g.lch }, nextPoint: nextPoint(pl.level), job: pl.job, jobs: JSON.parse(pl.jobs), free: freePoints(pl.level, JSON.parse(pl.jobs).length), potion: pl.potion, auto: pl.auto, base: JOBS[pl.job].d, perks: g.P, gentle: gentle(pl, cfg) ? { gold: cfg.start.gold, xp: cfg.start.xp, until: cfg.start.levels } : null, stage: shopLv(pl), stageMax: stageOf(JSON.parse(pl.jobs)) },
    inv: await inv(env, p.id),
    floors: { max: top, kills: fk, total: TOP_FLOOR, respawn: !!cfg.respawn },
    dive: !!cfg.dive.on,
    story: storyState(pl.level, fk, cfg.story),
    items: ITEMS,
    ...visibleJobs(JSON.parse(pl.jobs), cfg),
    perkDefs: PERKS,
    shop: shopFor(JSON.parse(pl.jobs), shopLv(pl)),
    shopCost: cfg.shopCost,
    fight,
    ...extra,
  });
}

// The job tree is revealed one step at a time: the pupil is only sent the jobs they already have plus the jobs they could unlock next
// (children of a job they own). Everything else - names, descriptions, perks - stays on the server until it becomes available.
export function visibleJobs(owned, cfg) {
  const jobTree = {}, jobPerks = {};
  for (const [id, j] of Object.entries(JOBS)) {
    if (owned.includes(id) || owned.includes(j.p)) {
      jobTree[id] = j;
      if (cfg.perks[id]) jobPerks[id] = cfg.perks[id];
    }
  }
  return { jobTree, jobPerks, moreJobs: Object.keys(jobTree).length < Object.keys(JOBS).length };
}

async function start(env, p, pl, f, body) {
  if (f) return;
  const n = int(body.floor, 1);
  const fl = n >= 1 && n <= TOP_FLOOR ? floorInfo(n) : null;
  const fk = JSON.parse(pl.floor_kills || '{}');
  if (!fl || (n > 1 && !cleared(fk, n - 1))) throw new HttpError(403, 'That floor is still locked.');
  const cfg = await getCfg(env);
  if (fk['n' + n] == null) {
    fk['n' + n] = needFor(n, cfg);
    pl.floor_kills = JSON.stringify(fk);
    await save(env, pl);
  }
  const last = (fl.boss || fl.mid) && (fk[n] || 0) === fk['n' + n] - 1; // the last monster of every 5th (mid-boss) and 10th (boss) floor
  const mob = last ? fl.lead : pick(fl.mobs);
  const lv = last ? n : 1 + rnd(n);
  const kind = MOBS[mob].kind;
  const hp = Math.max(1, Math.round(hpFor(lv, cfg) * ({ mid: cfg.boss.midHp, boss: cfg.boss.bossHp }[kind] || 1) * (kind && gentle(pl, cfg) ? cfg.start.bossHp : 1)));
  fk.ca = 0; // correct answers so far this fight
  fk.sd = 0; // damage dealt by answer strikes so far this fight (used by the 'damage' XP mode)
  fk.fs = 0; // per-fight perk counters: first-strike used, monster hits left to skip
  fk.sk = perksOf(pl.job, cfg).skip || 0;
  pl.floor_kills = JSON.stringify(fk);
  const now = Date.now(); // ranged classes strike first, a few seconds in; the monster's first attack comes a little before a normal one
  const pn = Math.round(RANGED.has(pl.job) ? now + cfg.speed.ranged * 1000 : now + gear(pl, cfg).ip);
  const mn = Math.round(now + (cfg.speed.turn * 1000) / (1 + cfg.speed.monster) - cfg.speed.offset * 1000);
  const q = await nextQuestion(env, p, 0, n, pl, cfg);
  if (!q) throw new HttpError(503, 'There are no questions yet. Ask your teacher to add some.');
  await db(env)
    .prepare('INSERT INTO g_fight (pupil_id, mob, level, mob_hp, mob_max, floor, last_tick, qid, p_next, m_next) VALUES (?1,?2,?3,?4,?4,?5,?6,?7,?8,?9)')
    .bind(p.id, mob, lv, hp, n, now, q.id, pn, mn)
    .run();
}

// The Hush story: records the scenes the pupil has just been shown and returns the full text of everything unlocked so far.
async function story(env, pl, body) {
  const cfg = await getCfg(env), fk = JSON.parse(pl.floor_kills || '{}');
  if (cfg.story && markSeen(pl.level, fk, body.seen)) {
    pl.floor_kills = JSON.stringify(fk);
    await save(env, pl);
  }
  return json({ story: storyState(pl.level, fk, cfg.story, true) });
}

// Back to the village: the pack's gold is banked and HP is restored.
async function leave(env, p, pl, f) {
  const cfg = await getCfg(env);
  if (f) await db(env).prepare('DELETE FROM g_fight WHERE pupil_id = ?1').bind(p.id).run();
  pl.gold += pl.run_gold;
  pl.run_gold = 0;
  pl.hp = mhOf(pl, cfg);
  if (cfg.respawn) resetFloors(pl); // monsters come back on any floor that wasn't cleared
  await save(env, pl);
}

async function buy(env, p, pl, f, body) {
  if (f) throw new HttpError(409, 'Return to the village first.');
  const it = ITEMS[body.item];
  if (!it || !shopFor(JSON.parse(pl.jobs), shopLv(pl)).includes(body.item)) throw new HttpError(400, 'The shop doesn’t sell that yet.');
  if (pl.gold < it.price) throw new HttpError(400, 'Not enough gold.');
  const have = await inv(env, p.id);
  if (it.slot !== 'use' && have[body.item]) throw new HttpError(400, 'You already own that.');
  if (it.slot === 'use' && (have[body.item] || 0) >= 9) throw new HttpError(400, 'You can’t carry any more of those.');
  pl.gold -= it.price;
  await save(env, pl);
  await addItem(env, p.id, body.item);
}

async function upgrade(env, pl, f) {
  if (f) throw new HttpError(409, 'Return to the village first.');
  const fk = JSON.parse(pl.floor_kills || '{}'), lv = shopLv(pl), cfg = await getCfg(env);
  if (lv >= 4) throw new HttpError(400, 'The shop is fully upgraded.');
  if (lv >= stageOf(JSON.parse(pl.jobs))) throw new HttpError(400, 'Unlock a higher job first.');
  const cost = cfg.shopCost[lv - 1];
  if (pl.gold < cost) throw new HttpError(400, 'Not enough gold.');
  pl.gold -= cost;
  fk.sl = lv + 1;
  pl.floor_kills = JSON.stringify(fk);
  await save(env, pl);
}

async function slot(env, p, pl, f, body) {
  if (f) throw new HttpError(409, 'Return to the village first.');
  const s = body.slot;
  if (!['weapon', 'armor', 'acc', 'potion'].includes(s)) throw new HttpError(400, 'Unknown slot.');
  if (body.item) {
    const it = ITEMS[body.item];
    if (!it || it.slot !== (s === 'potion' ? 'use' : s) || !(await inv(env, p.id))[body.item]) throw new HttpError(400, 'You don’t have that.');
    if (!canEquip(it, pl.job)) throw new HttpError(400, 'Your current job can’t use that.');
  }
  pl[s] = body.item || null;
  await save(env, pl);
}

async function jobAct(env, pl, f, a, body) {
  if (f) throw new HttpError(409, 'Return to the village first.');
  const js = JSON.parse(pl.jobs);
  const j = JOBS[body.job];
  if (!j) throw new HttpError(400, 'Unknown job.');
  if (a === 'job') {
    if (!js.includes(body.job)) throw new HttpError(400, 'You haven’t unlocked that job.');
  } else {
    if (js.includes(body.job) || !js.includes(j.p)) throw new HttpError(400, 'That job isn’t available yet.');
    if (freePoints(pl.level, js.length) < 1) throw new HttpError(400, 'You have no job point to spend yet.');
    js.push(body.job);
    pl.jobs = JSON.stringify(js);
  }
  pl.job = body.job;
  await save(env, pl);
}

async function use(env, p, pl, body) {
  const cfg = await getCfg(env);
  const it = ITEMS[body.item];
  if (!it || it.slot !== 'use' || !(await inv(env, p.id))[body.item]) throw new HttpError(400, 'You don’t have that.');
  pl.hp = Math.min(mhOf(pl, cfg), pl.hp + Math.round(it.heal * (1 + (perksOf(pl.job, cfg).potion || 0))));
  await save(env, pl);
  await addItem(env, p.id, body.item, -1);
}

async function answer(request, env, p, pl, f, body, events) {
  if (!f || int(body.qid, 0) !== f.qid) throw new HttpError(409, 'That question belongs to a monster that is gone.');
  const r = await (await pupil.answer(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }), env, p)).json();
  const done = r.phase === 2 || (r.phase === undefined && (r.correct || r.final));
  if (!done) return view(env, p, { answer: r, done: false, events });
  const extra = { answer: r, done: true, events };
  let res = null;
  const cfg = await getCfg(env);
  if (r.correct) {
    const g = gear(pl, cfg), P = g.P, fk = JSON.parse(pl.floor_kills || '{}');
    let bonus = (cfg.strike + (P.mult || 0)) * g.bat * dmgMult(pl, f, P, cfg);
    if (P.first && !fk.fs) bonus *= P.first; // first correct answer of the fight
    if (Math.random() < g.crit) { bonus *= 2; extra.crit = 1; } // double strike
    fk.fs = 1;
    fk.ca = (fk.ca || 0) + 1; // correct answers this fight
    extra.bonus = Math.round(bonus);
    const hp0 = f.mob_hp;
    f.mob_hp -= extra.bonus;
    if (f.mob_hp <= 0 && fk.ca < mustFor(f.mob, cfg)) f.mob_hp = 1; // needs more correct answers before it can fall
    fk.sd = (fk.sd || 0) + Math.max(0, hp0 - Math.max(0, f.mob_hp)); // damage actually dealt by this strike (no overkill)
    pl.floor_kills = JSON.stringify(fk);
    pl.hp = Math.min(mhOf(pl, cfg), pl.hp + Math.round(P.heal || 0));
    if (f.mob_hp <= 0) res = 'win';
  }
  if (res) extra.ended = await finish(env, p, pl, f, res);
  else {
    await save(env, pl);
    const q = await nextQuestion(env, p, f.qid, f.floor, pl, cfg);
    await db(env).prepare('UPDATE g_fight SET mob_hp = ?2, qid = ?3 WHERE pupil_id = ?1').bind(p.id, f.mob_hp, q ? q.id : f.qid).run();
  }
  return view(env, p, extra);
}

export async function route(request, env, p, path, m) {
  const a = path.slice('/api/game/'.length);
  if (!['state', 'sync', 'start', 'answer', 'buy', 'slot', 'job', 'unlock', 'auto', 'use', 'upgrade', 'leave', 'story'].includes(a)) throw new HttpError(404, 'Not found.');
  if ((a === 'state') !== (m === 'GET')) throw new HttpError(405, 'Wrong method.');
  const body = m === 'POST' ? await readJson(request) : {};
  await getCfg(env);
  const { pl, f, ended, events } = await load(env, p);
  if (ended && a !== 'leave') return view(env, p, { ended, events });
  switch (a) {
    case 'state': if (!f && pl.run_gold > 0) await leave(env, p, pl, null); break;
    case 'start': await start(env, p, pl, f, body); break;
    case 'leave': await leave(env, p, pl, f); break;
    case 'buy': await buy(env, p, pl, f, body); break;
    case 'slot': await slot(env, p, pl, f, body); break;
    case 'job': case 'unlock': await jobAct(env, pl, f, a, body); break;
    case 'upgrade': await upgrade(env, pl, f); break;
    case 'auto': pl.auto = body.on ? 1 : 0; await save(env, pl); break;
    case 'use': await use(env, p, pl, body); break;
    case 'story': return story(env, pl, body);
    case 'answer': return answer(request, env, p, pl, f, body, events);
  }
  return view(env, p, { events });
}
