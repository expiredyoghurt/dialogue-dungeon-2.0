// Dungeon Dive: co-op party mode. One Durable Object per party (named after its 4-character code) holds the live fight;
// XP is written to D1 as it is earned, gold and loot wait in each member's pack until they retreat. A party wipe loses packs, never XP.
import { HttpError, json, readJson, clip, int } from './util.js';
import { cleanCode } from './auth.js';
import * as pupil from './pupil.js';
import { baseRows, pickSkillQuestion, floorOf } from './select.js';
import { getCfg, gear, dmgMult, modesFor, mustFor } from './game.js';
import { need, mhOf, levelDodge, monsterDodge, sureMob, hpFor, floorInfo, MOBS, ITEMS, MAX_DROP, chain, RANGED, JOBS, MIDS, BOSSES } from './gamedata.js';
import { playerStrike, strikeEffects, monsterHit, capStat, STUN_MS } from './combat.js';

export const MAX_PARTY = 4;
const IDLE_KICK = 90_000; // a member who has not been heard from for this long is treated as retreating
const PARTY_IDLE = 30 * 60_000; // a party nobody has touched for this long is closed (everyone's pack is banked)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export const newCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
};
const pick = (a, rnd = Math.random) => a[Math.floor(rnd() * a.length)];

// ---------- roles ----------
// melee = Fighter line, ranged = Archer line, magic = Acolyte / Mage line, healer = Cleric line. Villagers and Adventurers have no role yet.
export const roleOf = (job) => {
  const c = chain(job);
  return c.includes('cleric') ? 'healer' : c.includes('mage') || c.includes('acolyte') ? 'magic' : c.includes('fighter') ? 'melee' : c.includes('archer') ? 'ranged' : null;
};
export const ROLES = ['melee', 'ranged', 'magic', 'healer'];
export const isBalanced = (members) => members.length === MAX_PARTY && ROLES.every((r) => members.some((m) => roleOf(m.job) === r));

// ---------- pure combat ----------
// Plays out every hit that has come due, in time order, for the whole party against the one shared monster.
// Returns { ev, kill } or { ev, wipe }. Mutates S (monster HP, member HP and timers).
export function simParty(S, cfg, now, rnd = Math.random) {
  const mon = S.mon, ev = [];
  if (!mon) return { ev };
  const turn = cfg.speed.turn * 1000, im = turn / (1 + cfg.speed.monster), floorT = now - 3 * turn; // an idle tab only owes ~3 turns
  mon.mNext = Math.max(mon.mNext, floorT);
  for (const m of S.members) m.pNext = Math.max(m.pNext, floorT);
  const must = mustFor(mon.mob, cfg);
  for (let i = 0; i < 160; i++) {
    let pm = null;
    for (const m of S.members) if (m.alive && (!pm || m.pNext < pm.pNext)) pm = m;
    const isP = pm && pm.pNext <= mon.mNext, t = isP ? pm.pNext : mon.mNext;
    if (t > now) break;
    if (isP) {
      const md = monsterDodge(mon.mob, cfg);
      if (md && !pm.sure && rnd() < md) { // the monster dodges: the attack misses and deals 0
        ev.push({ t, w: 'p', id: pm.id, d: 0, miss: 1, mh: Math.max(0, mon.hp) });
        pm.pNext += pm.ip;
        continue;
      }
      const pmax = Math.max(1, Math.round(pm.atk * dmgMult(pm, { mob: mon.mob }, pm.P, cfg)));
      const { d, x } = playerStrike({ dbl: pm.dbl ?? pm.P.dbl }, pmax, rnd); // critical hits (dbl) do double
      mon.hp -= d;
      if (mon.hp <= 0 && mon.ca < must) mon.hp = 1; // not enough correct answers from the party yet: it survives
      const e = { t, w: 'p', id: pm.id, d, x, mh: Math.max(0, mon.hp) };
      ev.push(e);
      if (mon.hp <= 0) return { ev, kill: true };
      const fx = strikeEffects(pm, d, pm.hp, pm.maxHp, rnd); // stun delays the monster, leech gives HP back
      if (fx.stun) { mon.mNext += STUN_MS; e.st = 1; }
      if (fx.heal) { pm.hp += fx.heal; e.lc = fx.heal; }
      pm.pNext += pm.ip;
    } else {
      const alive = S.members.filter((m) => m.alive);
      if (!alive.length) break;
      const tg = pick(alive, rnd);
      let d = 0, par = 0, rf = 0, dod = 0;
      if (tg.sk > 0) tg.sk--; // archer perk: the monster's first hit(s) on them are skipped
      else {
        const kind = (MOBS[mon.mob] || {}).kind, b = cfg.boss; // mid-bosses and bosses hit harder, as in solo play; a boss rages below half HP
        const mult = kind === 'mid' ? b.midDmg : kind === 'boss' ? (mon.hp < mon.max * 0.5 ? b.rageDmg : b.bossDmg) : 1;
        const mmax = Math.ceil(mon.level * cfg.def.dmg * mult);
        const roll = kind ? Math.round(mmax * (b.lo + rnd() * (b.hi - b.lo))) : 1 + Math.floor(rnd() * Math.max(1, mmax));
        ({ d, dod, par, rf } = monsterHit(sureMob(mon.mob, cfg) ? { ...tg, dod: 0 } : tg, roll, rnd)); // a sure-hit monster ignores dodge // a dodge or a parry negates the hit, reflect sends part of it back
        tg.hp -= d;
      }
      if (rf && tg.hp > 0) {
        mon.hp -= rf;
        if (mon.hp <= 0 && mon.ca < must) mon.hp = 1; // a reflect cannot skip the answers a monster needs either
      } else rf = 0;
      ev.push({ t, w: 'm', id: tg.id, d, hp: Math.max(0, tg.hp), ...(dod ? { dod: 1 } : {}), ...(par ? { par: 1 } : {}), ...(rf ? { rf } : {}) });
      if (tg.hp <= 0) {
        tg.hp = 0; tg.alive = false;
        ev.push({ t, w: 'down', id: tg.id });
        if (!S.members.some((m) => m.alive)) return { ev, wipe: true };
      } else if (tg.auto && tg.potion && tg.potion.qty > 0 && tg.hp * 10 < tg.maxHp * 3) {
        const h = Math.min(tg.maxHp, tg.hp + tg.potion.heal) - tg.hp;
        tg.hp += h; tg.potion.qty--; tg.potUsed = (tg.potUsed || 0) + 1;
        ev.push({ t, w: 'pot', id: tg.id, d: h });
      }
      if (mon.hp <= 0) return { ev, kill: true }; // a reflected hit finished it
      mon.mNext += im;
    }
  }
  return { ev };
}

// A correct answer: the answer strike on the shared monster, plus any heal perk. Healers heal the whole party, everyone else only themselves.
export function applyCorrect(S, m, cfg, rnd = Math.random) {
  const mon = S.mon;
  let b = (cfg.strike + (m.P.mult || 0)) * (m.bat ?? m.atk) * dmgMult(m, { mob: mon.mob }, m.P, cfg); // bat: the answer strike is built on the weapon's balanced value
  if (m.P.first && !m.fs) b *= m.P.first;
  let crit = 0;
  if (rnd() < (m.crit ?? m.P.crit ?? 0)) { b *= 2; crit = 1; }
  const bonus = Math.round(b);
  m.fs = 1; m.ca++; mon.ca++;
  const hp0 = mon.hp;
  mon.hp -= bonus;
  if (mon.hp <= 0 && mon.ca < mustFor(mon.mob, cfg)) mon.hp = 1;
  m.sd = (m.sd || 0) + Math.max(0, hp0 - Math.max(0, mon.hp)); // this pupil's own strike damage (no overkill), for the 'damage' XP mode
  const h = Math.round(m.P.heal || 0);
  if (h) for (const t of roleOf(m.job) === 'healer' ? S.members.filter((x) => x.alive) : [m]) t.hp = Math.min(t.maxHp, t.hp + h);
  return { bonus, crit, kill: mon.hp <= 0 };
}

// Which kind of monster is next: with bosses on, every midEvery-th monster is a mid-boss and every bossEvery-th a boss (a boss wins a clash).
export function leadKind(depth, cfg) {
  const d = cfg.dive, no = depth + 1;
  if (!d.bosses) return null;
  if (d.bossEvery > 0 && no % d.bossEvery === 0) return 'boss';
  if (d.midEvery > 0 && no % d.midEvery === 0) return 'mid';
  return null;
}
// Picks the next monster and its HP. Mid-bosses and bosses are chosen by level like the solo floor leads and use the solo mid-boss / boss HP multipliers.
// With hpScale off, party size does not change HP.
export function planMonster(base, depth, n, cfg, rnd = Math.random) {
  const lv = base + depth, kind = leadKind(depth, cfg);
  const mob = kind === 'boss' ? BOSSES[Math.max(0, Math.round(lv / 10) - 1) % BOSSES.length]
    : kind === 'mid' ? MIDS[Math.min(MIDS.length - 1, Math.max(0, Math.round((lv - 5) / 10)))]
    : pick(floorInfo(Math.min(100, Math.max(1, lv))).mobs, rnd);
  const party = cfg.dive.hpScale === false ? 1 : 1 + cfg.dive.hpPer * (n - 1);
  const lead = kind === 'boss' ? cfg.boss.bossHp : kind === 'mid' ? cfg.boss.midHp : 1;
  return { mob, kind, hp: Math.max(1, Math.round(hpFor(lv, cfg) * party * lead)) };
}

// Rewards for a kill: one pool, split equally. Gold goes into each pack; XP is returned for the caller to bank straight away.
// Drops are rolled per item and awarded only to members who answered at least one question correctly in this fight.
export function splitKill(S, cfg, rnd = Math.random) {
  const mon = S.mon, n = S.members.length, k = 1 + cfg.dive.poolPer * (n - 1);
  const mc = cfg.mobs[mon.mob] || {}, d = { ...cfg.def, ...mc };
  const lo = d.goldMin * mon.level, hi = Math.max(lo, d.goldMax * mon.level);
  const gold = (lo + rnd() * (hi - lo)) * k, xp = d.xp * mon.level * k;
  const balanced = isBalanced(S.members), bonus = balanced ? 1 + cfg.dive.balanced : 1;
  const shares = S.members.map((m) => {
    const sh = { id: m.id, name: m.name, gold: Math.max(1, Math.round((gold / n) * (1 + m.g.gold) * bonus)), xp: Math.max(1, Math.round(((xp / n) + (cfg.xpMode === 'damage' ? 0.5 * (m.sd || 0) : 0)) * (1 + m.g.xp) * bonus)) }; // base XP is shared equally; the strike part is each pupil's own
    m.pack.gold += sh.gold;
    return sh;
  });
  const eligible = S.members.filter((m) => m.ca > 0), drops = [];
  for (const [id, rate] of Object.entries(mc.drops || {})) {
    const it = ITEMS[id];
    if (!it || !eligible.length || rnd() >= Math.min(1, Math.min(rate, MAX_DROP) * (cfg.dive.dropMult ?? 1))) continue;
    const to = pick(eligible, rnd);
    if (it.slot !== 'use' && (to.owned.includes(id) || to.pack.drops[id])) {
      const v = Math.floor(it.price / 2); // already have one: it sells
      to.pack.gold += v;
      drops.push({ id, to: to.id, name: to.name, dup: v });
    } else {
      to.pack.drops[id] = (to.pack.drops[id] || 0) + 1;
      drops.push({ id, to: to.id, name: to.name });
    }
  }
  return { shares, drops, balanced, level: mon.level, mob: mon.mob };
}

// The view one member gets: everything public about the party, plus only their own question and pack.
export function viewOf(S, m, now, cfg) {
  const mon = S.mon, info = mon && (MOBS[mon.mob] || MOBS.slime);
  const strikeN = cfg.strike + (m.P.mult || 0);
  return {
    code: S.code, name: S.name, status: S.status, leader: S.leader, you: m.id, base: S.base, depth: S.depth,
    balanced: isBalanced(S.members), bonus: cfg.dive.balanced,
    members: S.members.map((x) => ({ id: x.id, name: x.name, job: x.job, jobName: JOBS[x.job] ? JOBS[x.job].n : x.job, role: roleOf(x.job), level: x.level, hp: x.hp, maxHp: x.maxHp, alive: x.alive, ca: x.ca, leader: x.id === S.leader })),
    mon: mon ? { name: info.n, kind: info.kind || null, img: info.img || null, e: info.e, level: mon.level, hp: mon.hp, max: mon.max, ca: mon.ca, ansNeed: mustFor(mon.mob, cfg) } : null,
    nextAt: S.nextAt, now, nextKind: leadKind(S.depth, cfg), leads: cfg.dive.bosses ? { mid: cfg.dive.midEvery, boss: cfg.dive.bossEvery } : null,
    me: { alive: m.alive, q: m.q, potion: m.potion, auto: m.auto, pack: m.pack, strikeN, bonus: Math.round(strikeN * (m.bat ?? m.atk)), ca: m.ca },
    log: S.log.slice(-12), last: S.last, wipe: S.wipe,
  };
}

// ---------- D1 helpers ----------
async function loadMember(env, cfg, p) {
  await env.DB.prepare('INSERT OR IGNORE INTO g_player (pupil_id) VALUES (?1)').bind(p.id).run();
  const row = await env.DB.prepare('SELECT * FROM g_player WHERE pupil_id = ?1').bind(p.id).first();
  const rows = (await env.DB.prepare('SELECT item, qty FROM g_inv WHERE pupil_id = ?1 AND qty > 0').bind(p.id).all()).results || [];
  const inv = Object.fromEntries(rows.map((r) => [r.item, r.qty]));
  const g = gear(row, cfg), it = ITEMS[row.potion], maxHp = mhOf(row, cfg);
  return {
    id: p.id, name: p.name, classId: p.classId ?? null, guest: !!p.guest, job: row.job, level: row.level, maxHp, hp: maxHp, alive: true,
    atk: g.atk, bat: g.bat, def: g.def, ip: g.ip, dbl: g.dbl, crit: g.crit, dod: g.dod, sure: g.sure, par: g.par, ref: g.ref, stn: g.stn, lch: g.lch, g: { gold: g.gold, xp: g.xp, heal: g.heal }, P: g.P, ranged: RANGED.has(row.job),
    potion: it && inv[row.potion] ? { id: row.potion, qty: inv[row.potion], heal: Math.round(it.heal * (1 + (g.P.potion || 0))) } : null,
    auto: row.auto ? 1 : 0, owned: Object.keys(inv).filter((id) => ITEMS[id] && ITEMS[id].slot !== 'use'),
    pack: { gold: 0, drops: {} }, pNext: 0, sk: 0, fs: 0, ca: 0, q: null, potUsed: 0,
  };
}
const soloBusy = async (env, id) => !!(await env.DB.prepare('SELECT 1 AS x FROM g_fight WHERE pupil_id = ?1').bind(id).first());
const bankSolo = (env, id) => env.DB.prepare('UPDATE g_player SET gold = gold + run_gold, run_gold = 0 WHERE pupil_id = ?1').bind(id).run();

// The monster's level stands in for the floor. Skill questions follow the same floor ranges and shares as solo play (select.js);
// the member `m` carries the selection memory (m.rq, m.sg). `exclude` = the other members' current questions.
export async function pickQuestion(env, m, level, exclude, cfg) {
  const floor = floorOf(level);
  const allowed = modesFor(floor);
  const v = pupil.visibleSql({ guest: m.guest, classId: m.classId });
  if (cfg) {
    const sk = await pickSkillQuestion(env, v, floor, cfg, m, exclude);
    if (sk) return sk;
  }
  for (const strict of [true, false]) {
    for (const mode of [pick(allowed), ...allowed]) {
      const rows = await baseRows(env, v, mode, floor, 12);
      for (const q of rows) {
        if (strict && exclude.has(q.id)) continue;
        const payload = pupil.payloadFor(q.mode, JSON.parse(q.data));
        if (payload) return { id: q.id, mode: q.mode, p: payload };
      }
    }
  }
  return null;
}

// ---------- the Durable Object ----------
export class DiveParty {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.S = null;
    this.loaded = false;
    this.dirty = false;
    this.seen = {};
    this.chain = Promise.resolve();
    this.cfgAt = 0;
    this.now = () => Date.now();
  }

  // Requests for one party run one at a time, so the combat state never interleaves.
  fetch(request) {
    const run = this.chain.then(() => this.handle(request));
    this.chain = run.catch(() => {});
    return run;
  }

  async load() {
    if (this.loaded) return;
    this.S = (await this.state.storage.get('S')) || null;
    this.loaded = true;
    const now = this.now();
    if (this.S) for (const m of this.S.members) this.seen[m.id] = now;
  }

  async getCfg(now) {
    if (!this.cfg || now - this.cfgAt > 5000) { this.cfg = await getCfg(this.env); this.cfgAt = now; }
    return this.cfg;
  }

  async handle(request) {
    const a = new URL(request.url).pathname.slice(1);
    const { p, body = {}, name, code } = await request.json();
    const now = this.now();
    await this.load();
    try {
      const cfg = await this.getCfg(now);
      if (!cfg.dive.on) throw new HttpError(403, 'Dungeon Dive is switched off.');
      let out;
      if (a === 'create') out = await this.create(p, name, code, cfg, now);
      else if (a === 'join') out = await this.join(p, cfg, now);
      else {
        const S = this.S, m = S && S.members.find((x) => x.id === p.id);
        if (!m) throw new HttpError(404, 'You are not in this party any more.');
        this.seen[m.id] = now;
        await this.kickIdle(now, m);
        if (!this.S.members.find((x) => x.id === p.id)) throw new HttpError(404, 'You are not in this party any more.');
        await this.tick(now);
        if (this.S && this.S.members.find((x) => x.id === p.id)) out = await this.act(a, m, body, cfg, p, now);
        else out = { left: true };
      }
      await this.save(now);
      return json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      throw e;
    }
  }

  async save(now) {
    if (!this.S) return;
    if (now - (this.S.touched || 0) > 5 * 60_000) {
      this.S.touched = now;
      this.dirty = true;
      await this.state.storage.setAlarm(now + PARTY_IDLE);
    }
    if (this.dirty) { await this.state.storage.put('S', this.S); this.dirty = false; }
  }

  view(m, now, extra = {}) { return { ...viewOf(this.S, this.S.members.find((x) => x.id === m.id) || m, now, this.cfg), ...extra }; }

  async create(p, name, code, cfg, now) {
    if (this.S && this.S.members.length) throw new HttpError(409, 'That code is taken.');
    if (await soloBusy(this.env, p.id)) throw new HttpError(409, 'Finish or flee your fight in the dungeon first.');
    await bankSolo(this.env, p.id);
    const m = await loadMember(this.env, cfg, p);
    this.S = { v: 1, code, name: clip(name, 24) || `${p.name}'s party`, leader: p.id, status: 'lobby', base: m.level, depth: 0, mon: null, nextAt: 0, members: [m], log: [], last: null, wipe: null, touched: 0 };
    this.seen[p.id] = now;
    this.dirty = true;
    return this.view(m, now);
  }

  async join(p, cfg, now) {
    const S = this.S;
    if (!S || !S.members.length) throw new HttpError(404, 'There is no party with that code.');
    const have = S.members.find((x) => x.id === p.id);
    if (have) { this.seen[p.id] = now; return this.view(have, now); } // joining again just re-attaches
    if (S.status !== 'lobby') throw new HttpError(409, 'That party is already in the dungeon. Ask them to retreat, or wait for the next lobby.');
    if (S.members.length >= MAX_PARTY) throw new HttpError(409, 'That party is full (4 players).');
    if (await soloBusy(this.env, p.id)) throw new HttpError(409, 'Finish or flee your fight in the dungeon first.');
    await bankSolo(this.env, p.id);
    const m = await loadMember(this.env, cfg, p);
    S.members.push(m);
    this.seen[p.id] = now;
    this.dirty = true;
    return this.view(m, now);
  }

  async act(a, m, body, cfg, p, now) {
    const S = this.S;
    switch (a) {
      case 'state': return this.view(m, now);
      case 'start': return this.start(m, cfg, now);
      case 'answer': return this.answer(m, body, cfg, p, now);
      case 'leave': {
        const banked = { gold: m.pack.gold, items: Object.values(m.pack.drops).reduce((x, y) => x + y, 0) };
        await this.remove(m, now);
        return { left: true, banked };
      }
      case 'auto': m.auto = body.on ? 1 : 0; this.dirty = true; return this.view(m, now);
      case 'drink': {
        if (S.status !== 'dive' || !m.alive) throw new HttpError(409, 'You can’t drink a potion right now.');
        if (!m.potion || m.potion.qty <= 0) throw new HttpError(400, 'You have no potion equipped.');
        m.hp = Math.min(m.maxHp, m.hp + m.potion.heal); m.potion.qty--; m.potUsed++;
        await this.flushPots();
        this.dirty = true;
        return this.view(m, now);
      }
      default: throw new HttpError(404, 'Not found.');
    }
  }

  async start(m, cfg, now) {
    const S = this.S;
    if (S.leader !== m.id) throw new HttpError(403, 'Only the party leader can start the dive.');
    if (S.status !== 'lobby') throw new HttpError(409, 'The party is already in the dungeon.');
    const fresh = [];
    for (const old of S.members) { // everyone's level, job and gear are read again, so the lobby can be used to shop first
      if (await soloBusy(this.env, old.id)) throw new HttpError(409, `${old.name} is still in a fight in the dungeon.`);
      await bankSolo(this.env, old.id);
      fresh.push(await loadMember(this.env, cfg, old));
    }
    S.members = fresh;
    S.base = Math.max(...fresh.map((x) => x.level));
    S.depth = 0; S.status = 'dive'; S.wipe = null; S.last = null; S.log = [];
    await this.spawn(now, cfg);
    this.dirty = true;
    return this.view(S.members.find((x) => x.id === m.id), now);
  }

  async spawn(now, cfg) {
    const S = this.S, n = S.members.length, lv = S.base + S.depth;
    const { mob, kind, hp } = planMonster(S.base, S.depth, n, cfg);
    const used = new Set();
    for (const m of S.members) {
      if (!m.alive) { m.alive = true; m.hp = Math.max(1, Math.round(m.maxHp * cfg.dive.revive)); }
      m.pNext = Math.round(m.ranged ? now + cfg.speed.ranged * 1000 : now + m.ip);
      m.sk = m.P.skip || 0; m.fs = 0; m.ca = 0; m.sd = 0;
      m.q = await pickQuestion(this.env, m, lv, used, cfg);
      if (!m.q) throw new HttpError(503, 'There are no questions yet. Ask your teacher to add some.');
      used.add(m.q.id);
    }
    S.mon = { mob, level: lv, hp, max: hp, ca: 0, mNext: Math.round(now + (cfg.speed.turn * 1000) / (1 + cfg.speed.monster) - cfg.speed.offset * 1000) };
    this.say(`${kind === 'boss' ? '👑 BOSS: ' : kind === 'mid' ? '⭐ Mid-boss: ' : ''}A level ${lv} ${(MOBS[mob] || MOBS.slime).n} appears!`, now);
    this.dirty = true;
  }

  say(text, t) { this.S.log.push({ t, text }); if (this.S.log.length > 30) this.S.log.splice(0, this.S.log.length - 30); }

  async tick(now) {
    const S = this.S, cfg = this.cfg;
    if (!S || S.status !== 'dive') return;
    if (!S.mon) { if (now >= S.nextAt) await this.spawn(now, cfg); return; }
    const r = simParty(S, cfg, now);
    if (r.ev.length) {
      const nm = (id) => (S.members.find((x) => x.id === id) || {}).name || '?', mn = (MOBS[S.mon.mob] || MOBS.slime).n;
      for (const e of r.ev) {
        if (e.w === 'p' && e.miss) this.say(`💨 ${mn} dodged ${nm(e.id)}’s attack!`, e.t);
        else if (e.w === 'p') this.say(`${nm(e.id)} hits for ${e.d}${e.x ? '!' : ''}${e.st ? ' · the monster is stunned' : ''}${e.lc ? ` · +${e.lc} HP` : ''}`, e.t);
        else if (e.w === 'm') this.say(e.dod ? `💨 ${nm(e.id)} dodged ${mn}’s attack!` : e.par ? `🛡️ ${nm(e.id)} parried ${mn}’s attack!` : e.d ? `${mn} hits ${nm(e.id)} for ${e.d}${e.rf ? ` · ${e.rf} reflected back!` : ''}` : `${mn}’s attack on ${nm(e.id)} was delayed`, e.t);
        else if (e.w === 'down') this.say(`💀 ${nm(e.id)} is down!`, e.t);
        else if (e.w === 'pot') this.say(`🧪 ${nm(e.id)} drinks a potion (+${e.d})`, e.t);
      }
      this.dirty = true;
    }
    await this.flushPots();
    if (r.kill) await this.onKill(now);
    else if (r.wipe) await this.wipe(now);
  }

  async onKill(now) {
    const S = this.S, cfg = this.cfg, mon = S.mon, mname = (MOBS[mon.mob] || MOBS.slime).n;
    const plan = splitKill(S, cfg);
    const ups = await Promise.all(plan.shares.map((sh) => this.credit(S.members.find((x) => x.id === sh.id), sh.xp, cfg)));
    plan.shares.forEach((sh, i) => { sh.up = ups[i]; });
    for (const m of S.members) if (m.alive && m.g.heal) m.hp = Math.min(m.maxHp, m.hp + m.g.heal);
    S.last = { level: mon.level, name: mname, shares: plan.shares, drops: plan.drops, balanced: plan.balanced };
    this.say(`🎉 ${mname} (Lv ${mon.level}) defeated!`, now);
    S.depth++; S.mon = null; S.nextAt = now + cfg.dive.gap * 1000;
    for (const m of S.members) m.q = null;
    this.dirty = true;
  }

  // XP is banked straight away: it is never lost, even in a wipe.
  async credit(m, xp, cfg) {
    const row = await this.env.DB.prepare('SELECT level, xp FROM g_player WHERE pupil_id = ?1').bind(m.id).first();
    let level = row ? row.level : m.level, x = (row ? row.xp : 0) + xp, up = 0;
    while (x >= need(level)) { x -= need(level); level++; up++; }
    await this.env.DB.prepare('UPDATE g_player SET level = ?2, xp = ?3, kills = kills + 1 WHERE pupil_id = ?1').bind(m.id, level, x).run();
    if (up) {
      const was = m.maxHp;
      m.level = level; m.maxHp = mhOf(m, cfg); // a level-up heals what it adds to max HP (a pupil's rolled HP gains are in gamedata.js)
      m.dod = capStat('dod', levelDodge(level, cfg) + ((m.P && m.P.dod) || 0)); // dodge grows with level
      if (m.alive) m.hp = Math.min(m.maxHp, m.hp + Math.max(0, m.maxHp - was));
    }
    return up;
  }

  async wipe(now) {
    const S = this.S, lv = S.mon.level, lost = [];
    for (const m of S.members) {
      lost.push({ id: m.id, name: m.name, gold: m.pack.gold, items: Object.values(m.pack.drops).reduce((x, y) => x + y, 0) });
      m.pack = { gold: 0, drops: {} }; m.alive = true; m.hp = m.maxHp; m.q = null;
    }
    S.wipe = { at: now, level: lv, depth: S.depth, lost };
    S.mon = null; S.depth = 0; S.status = 'lobby';
    this.say('The party was wiped out.', now);
    this.dirty = true;
  }

  async answer(m, body, cfg, p, now) {
    const S = this.S;
    if (S.status !== 'dive' || !S.mon) throw new HttpError(409, 'There is no monster to fight right now.');
    if (!m.alive) throw new HttpError(409, 'You are down for the rest of this fight.');
    if (!m.q || int(body.qid, 0) !== m.q.id) throw new HttpError(409, 'That question belongs to a monster that is gone.');
    const r = await (await pupil.answer(new Request('https://dive/answer', { method: 'POST', body: JSON.stringify(body) }), this.env, p)).json();
    const done = r.phase === 2 || (r.phase === undefined && (r.correct || r.final));
    if (!done) return { ...this.view(m, now), answer: r, done: false };
    const extra = { answer: r, done: true };
    if (r.correct) {
      const a = applyCorrect(S, m, cfg);
      extra.bonus = a.bonus; extra.crit = a.crit;
      this.say(`✅ ${m.name}’s answer strikes for ${a.bonus}${a.crit ? '!' : ''}`, now);
      if (a.kill) await this.onKill(now);
    }
    if (S.mon) {
      const used = new Set(S.members.filter((x) => x.id !== m.id && x.q).map((x) => x.q.id));
      m.q = (await pickQuestion(this.env, m, S.mon.level, used, cfg)) || m.q;
    }
    this.dirty = true;
    return { ...this.view(m, now), ...extra };
  }

  async flushPots() {
    for (const m of this.S.members) {
      if (!m.potUsed || !m.potion) continue;
      await this.env.DB.prepare('UPDATE g_inv SET qty = MAX(0, qty - ?3) WHERE pupil_id = ?1 AND item = ?2').bind(m.id, m.potion.id, m.potUsed).run();
      m.potUsed = 0;
    }
  }

  // Members leave by retreating (their pack is banked) or by going quiet for too long.
  async kickIdle(now, except) {
    for (const m of [...this.S.members]) if (m.id !== except.id && now - (this.seen[m.id] ?? now) > IDLE_KICK) await this.remove(m, now);
  }

  async bank(m) {
    const ops = [this.env.DB.prepare('UPDATE g_player SET gold = gold + ?2, hp = ?3 WHERE pupil_id = ?1').bind(m.id, m.pack.gold, m.maxHp)];
    for (const [id, q] of Object.entries(m.pack.drops)) ops.push(this.env.DB.prepare('INSERT INTO g_inv (pupil_id, item, qty) VALUES (?1, ?2, ?3) ON CONFLICT(pupil_id, item) DO UPDATE SET qty = qty + ?3').bind(m.id, id, q));
    await this.env.DB.batch(ops);
    m.pack = { gold: 0, drops: {} };
  }

  async remove(m, now) {
    const S = this.S;
    await this.bank(m);
    await this.flushPots();
    S.members = S.members.filter((x) => x.id !== m.id);
    delete this.seen[m.id];
    this.dirty = true;
    if (!S.members.length) { await this.end(); return; }
    if (S.leader === m.id) S.leader = S.members[0].id;
    this.say(`${m.name} left the party.`, now);
    if (S.status === 'dive' && S.mon && !S.members.some((x) => x.alive)) await this.wipe(now);
  }

  async end() {
    for (const m of this.S ? this.S.members : []) await this.bank(m);
    this.S = null; this.dirty = false;
    await this.state.storage.deleteAll();
  }

  async alarm() {
    await this.load();
    if (!this.S) return;
    const now = this.now();
    if (now - (this.S.touched || 0) >= PARTY_IDLE - 60_000) await this.end();
    else await this.state.storage.setAlarm(this.S.touched + PARTY_IDLE);
  }
}

// ---------- Worker side: /api/dive/* ----------
export async function route(request, env, p, path, m) {
  const a = path.slice('/api/dive/'.length);
  if (m !== 'POST') throw new HttpError(405, 'Wrong method.');
  if (!['create', 'join', 'state', 'start', 'answer', 'drink', 'auto', 'leave'].includes(a)) throw new HttpError(404, 'Not found.');
  if (!env.DIVE) throw new HttpError(503, 'Dungeon Dive is not set up yet: the Durable Object binding is missing.');
  const cfg = await getCfg(env);
  if (!cfg.dive.on) throw new HttpError(403, 'Dungeon Dive is switched off.');
  const body = await readJson(request);
  const call = (code, act, payload) => env.DIVE.get(env.DIVE.idFromName('party:' + code)).fetch('https://dive/' + act, { method: 'POST', body: JSON.stringify({ p, code, ...payload }) });
  if (a === 'create') {
    const name = clip(String(body.name || '').trim().replace(/\s+/g, ' '), 24);
    for (let i = 0; i < 8; i++) {
      const res = await call(newCode(), 'create', { name });
      if (res.status !== 409 || i === 7) return res;
      const err = await res.clone().json().catch(() => ({}));
      if (!/taken/.test(err.error || '')) return res; // a different 409 (e.g. a fight in progress) isn't a code clash
    }
  }
  const code = cleanCode(body.code);
  if (code.length !== 4) throw new HttpError(400, 'Enter the 4-character party code.');
  return call(code, a, { body });
}
