import test from 'node:test';
import assert from 'node:assert/strict';
import { DiveParty, simParty, applyCorrect, splitKill, roleOf, isBalanced, newCode, viewOf, leadKind, planMonster } from '../src/dive.js';
import { cfgFrom, applyItems, need, hpFor, MOBS } from '../src/gamedata.js';

const cfg = cfgFrom({ dive: { on: true }, mdodge: { mob: 0, mid: 0, boss: 0 } }); // monster dodge has its own tests (hpdodge.test.mjs)
applyItems(cfg);

const member = (id, job = 'villager', o = {}) => ({
  id, name: 'P' + id, job, level: 10, maxHp: 30, hp: 30, alive: true, atk: 5, def: 0, ip: 15000, g: { gold: 0, xp: 0, heal: 0 }, P: {}, ranged: false,
  potion: null, auto: 0, owned: [], pack: { gold: 0, drops: {} }, pNext: 0, sk: 0, fs: 0, ca: 0, q: null, potUsed: 0, ...o,
});
const party = (members, mon) => ({ status: 'dive', members, mon: { mob: 'slime', level: 15, hp: 10, max: 10, ca: 0, mNext: 1e12, ...mon }, log: [] });

test('party codes are 4 characters, letters and digits', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^[A-HJKMNP-Z2-9]{4}$/);
});

test('roles: melee / ranged / magic / healer, and balance needs all four in a party of four', () => {
  assert.equal(roleOf('swordsman'), 'melee'); assert.equal(roleOf('berserker'), 'melee');
  assert.equal(roleOf('longbowman'), 'ranged'); assert.equal(roleOf('assassin'), 'ranged');
  assert.equal(roleOf('acolyte'), 'magic'); assert.equal(roleOf('elementalmage'), 'magic');
  assert.equal(roleOf('cleric'), 'healer'); assert.equal(roleOf('paladin'), 'healer');
  assert.equal(roleOf('adventurer'), null); assert.equal(roleOf('villager'), null);
  const four = ['fighter', 'archer', 'mage', 'priest'].map((j, i) => member(i + 1, j));
  assert.equal(isBalanced(four), true);
  assert.equal(isBalanced(four.slice(0, 3)), false);
  assert.equal(isBalanced(['fighter', 'fighter', 'mage', 'priest'].map((j, i) => member(i + 1, j))), false);
});

test('basic attacks cannot slay the monster before a correct answer, but can afterwards', () => {
  const a = member(1, 'villager', { pNext: 1000 });
  let S = party([a], { hp: 1 });
  assert.equal(simParty(S, cfg, 2000).kill, undefined);
  assert.equal(S.mon.hp, 1);
  S = party([member(1, 'villager', { pNext: 1000 })], { hp: 1, ca: 1 });
  assert.equal(simParty(S, cfg, 2000).kill, true);
});

test('every player hits the same monster', () => {
  const S = party([member(1, 'villager', { pNext: 1000 }), member(2, 'villager', { pNext: 1000 })], { hp: 500, ca: 5 });
  const r = simParty(S, cfg, 2000);
  assert.deepEqual(r.ev.filter((e) => e.w === 'p').map((e) => e.id).sort(), [1, 2]);
  assert.ok(S.mon.hp < 500);
});

test('a party is wiped only when every member is down', () => {
  const S = party([member(1, 'villager', { hp: 1, pNext: 1e12 }), member(2, 'villager', { hp: 1, pNext: 1e12 })], { level: 80, mNext: 1000, hp: 99999, ca: 9 });
  const r = simParty(S, cfg, 1000 + 15000 * 2.9, () => 0.99);
  assert.equal(r.wipe, true);
  assert.ok(S.members.every((m) => !m.alive));
  const S2 = party([member(1, 'villager', { hp: 1, pNext: 1e12 }), member(2, 'villager', { hp: 99, pNext: 1e12 })], { level: 80, mNext: 1000, hp: 99999, ca: 9 });
  assert.equal(simParty(S2, cfg, 1000, () => 0).wipe, undefined);
});

test('a correct answer strikes for (N + perk) x attack and a healer heals the whole party', () => {
  const healer = member(1, 'cleric', { atk: 4, P: { heal: 2 }, hp: 10 }), other = member(2, 'villager', { hp: 10 });
  const S = party([healer, other], { hp: 100 });
  const r = applyCorrect(S, healer, cfg, () => 0.99);
  assert.equal(r.bonus, 12); // (3 + 0) x 4
  assert.equal(S.mon.hp, 88);
  assert.equal(healer.hp, 12); assert.equal(other.hp, 12);
  const sword = member(3, 'swordsman', { atk: 6, P: { mult: 0.5, heal: 2 } }), meek = member(4, 'villager', { hp: 10 });
  applyCorrect(party([sword, meek], { hp: 500 }), sword, cfg, () => 0.99);
  assert.equal(meek.hp, 10); // a non-healer's heal perk is just for themselves
  const big = party([member(5, 'villager', { atk: 100 })], { hp: 5, ca: 0 });
  assert.equal(applyCorrect(big, big.members[0], cfg, () => 0.99).kill, true); // one correct answer is enough for a regular monster
  const boss = party([member(6, 'villager', { atk: 100 })], { mob: 'dragon', hp: 5, ca: 0 });
  const ab = applyCorrect(boss, boss.members[0], cfg, () => 0.99);
  assert.equal(ab.kill, false); assert.equal(boss.mon.hp, 1); // a mid-boss needs 3 correct answers
});

test('gold and XP are split equally; a balanced party gets +25%', () => {
  const mk = (jobs) => party(jobs.map((j, i) => member(i + 1, j, { ca: 1 })), { level: 20 });
  const solo = splitKill(mk(['villager']), cfg, () => 0.5);
  const duo = splitKill(mk(['villager', 'villager']), cfg, () => 0.5);
  assert.equal(duo.shares[0].gold, solo.shares[0].gold); // poolPer 1: each member's share equals one solo monster
  assert.equal(duo.shares[0].gold, duo.shares[1].gold);
  const four = splitKill(mk(['fighter', 'archer', 'mage', 'priest']), cfg, () => 0.5);
  const plain = splitKill(mk(['fighter', 'fighter', 'fighter', 'fighter']), cfg, () => 0.5);
  assert.equal(four.balanced, true); assert.equal(plain.balanced, false);
  assert.equal(four.shares[0].xp, Math.round(plain.shares[0].xp * 1.25));
  assert.equal(four.shares[0].gold, Math.round(plain.shares[0].gold * 1.25));
  const c2 = cfgFrom({ dive: { on: true, poolPer: 0 } });
  const split = splitKill(mk(['villager', 'villager', 'villager', 'villager']), c2, () => 0.5);
  assert.equal(split.shares[0].xp, Math.round((2 * 20) / 4));
});

test('drops go only to members who answered correctly', () => {
  const answered = member(1, 'villager', { ca: 2 }), idle = member(2, 'villager', { ca: 0 });
  const c = cfgFrom({ dive: { on: true }, mobs: { slime: { drops: { potion: 0.1, stick: 0.1 } } } });
  applyItems(c);
  const S = party([answered, idle], { level: 5 });
  const r = splitKill(S, c, () => 0); // every roll succeeds
  assert.equal(r.drops.length, 2);
  assert.ok(r.drops.every((d) => d.to === 1));
  assert.deepEqual(idle.pack.drops, {});
  const none = party([member(1, 'villager', { ca: 0 })], { level: 5 });
  assert.equal(splitKill(none, c, () => 0).drops.length, 0);
  const dupe = member(3, 'villager', { ca: 1, owned: ['stick'] });
  const d = splitKill(party([dupe], { level: 5 }), c, () => 0);
  assert.ok(d.drops.find((x) => x.id === 'stick').dup > 0);
  assert.equal(dupe.pack.drops.stick, undefined);
});

// ---------- the Durable Object itself, on a small fake D1 ----------
function fakeEnv() {
  const players = {}, inv = {}, fights = new Set(), qs = [
    { id: 1, mode: 1, data: JSON.stringify({ prompt: 'a', correct: 'A.' }) },
    { id: 2, mode: 1, data: JSON.stringify({ prompt: 'b', correct: 'B.' }) },
    { id: 3, mode: 1, data: JSON.stringify({ prompt: 'c', correct: 'C.' }) },
  ];
  const base = (id, level) => ({ pupil_id: id, level, xp: 0, hp: 10, gold: 0, run_gold: 7, weapon: null, armor: null, acc: null, potion: null, auto: 0, job: 'villager', jobs: '["villager"]', floor_kills: '{}', kills: 0 });
  const run = (sql, a) => {
    if (sql.startsWith('INSERT OR IGNORE INTO g_player')) players[a[0]] = players[a[0]] || base(a[0], env.levels[a[0]] || 1);
    else if (sql.includes('gold = gold + run_gold')) { if (!players[a[0]]) return; players[a[0]].gold += players[a[0]].run_gold; players[a[0]].run_gold = 0; }
    else if (sql.startsWith('UPDATE g_player SET level')) Object.assign(players[a[0]], { level: a[1], xp: a[2], kills: players[a[0]].kills + 1 });
    else if (sql.startsWith('UPDATE g_player SET gold = gold + ?2')) { players[a[0]].gold += a[1]; players[a[0]].hp = a[2]; }
    else if (sql.startsWith('INSERT INTO g_inv')) { inv[a[0]] = inv[a[0]] || {}; inv[a[0]][a[1]] = (inv[a[0]][a[1]] || 0) + a[2]; }
  };
  const q = (sql, a = []) => ({
    async run() { run(sql, a); return {}; },
    async first() {
      if (sql.includes('g_config')) return { v: JSON.stringify({ dive: { on: true } }) };
      if (sql.includes('FROM g_fight')) return fights.has(a[0]) ? { x: 1 } : null;
      if (sql.includes('SELECT * FROM g_player') || sql.includes('SELECT level, xp')) return players[a[0]];
      return null;
    },
    async all() {
      if (sql.includes('FROM g_inv')) return { results: Object.entries(inv[a[0]] || {}).map(([item, qty]) => ({ item, qty })) };
      if (sql.includes('FROM questions')) return { results: qs };
      return { results: [] };
    },
    _sql: sql, _a: a,
  });
  const env = { levels: { 1: 15, 2: 8, 3: 9, 4: 5, 5: 3 }, players, inv, fights, DB: { prepare: (sql) => ({ ...q(sql), bind: (...a) => q(sql, a) }), batch: async (ops) => { for (const o of ops) await o.run(); } } };
  return env;
}
function makeDO(env) {
  const store = new Map(), alarms = [];
  const state = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), deleteAll: async () => store.clear(), setAlarm: async (t) => alarms.push(t) } };
  const d = new DiveParty(state, env);
  let t = 1_000_000;
  d.now = () => t;
  d.advance = (ms) => { t += ms; };
  const call = async (act, p, body = {}, extra = {}) => { const r = await d.fetch(new Request('https://dive/' + act, { method: 'POST', body: JSON.stringify({ p, body, ...extra }) })); return { status: r.status, j: await r.json() }; };
  return { d, call, store };
}
const P = (id) => ({ id, name: 'P' + id, classId: 1, guest: false });

test('Dungeon Dive: create, join, start; monsters start at the highest level and every player gets a different question', async () => {
  const env = fakeEnv(), { call } = makeDO(env);
  const make = await call('create', P(1), {}, { name: 'The Dungeoneers', code: 'AB2D' });
  assert.equal(make.status, 200); assert.equal(make.j.status, 'lobby'); assert.equal(make.j.name, 'The Dungeoneers'); assert.equal(make.j.code, 'AB2D');
  for (const id of [2, 3, 4]) assert.equal((await call('join', P(id), {}, { code: 'AB2D' })).status, 200);
  assert.equal((await call('join', P(5), {}, { code: 'AB2D' })).status, 409); // full
  assert.equal((await call('join', P(2), {}, { code: 'AB2D' })).status, 200); // re-attaching is fine
  assert.equal((await call('start', P(2))).status, 403); // only the leader
  const st = await call('start', P(1));
  assert.equal(env.players[1].run_gold, 0); // solo packs are banked when the dive starts
  assert.equal(st.status, 200); assert.equal(st.j.status, 'dive');
  assert.equal(st.j.mon.level, 15); // highest level in the party
  const qids = [];
  for (const id of [1, 2, 3]) qids.push((await call('state', P(id))).j.me.q.id);
  assert.equal(new Set(qids).size, 3);
  assert.equal((await call('join', P(5), {}, { code: 'AB2D' })).status, 409); // already diving
});

test('Dungeon Dive: kill banks XP at once, gold waits in the pack, next monster is one level higher', async () => {
  const env = fakeEnv(), { d, call } = makeDO(env);
  await call('create', P(1), {}, { name: 'T', code: 'ZZ22' });
  await call('join', P(2), {}, { code: 'ZZ22' });
  await call('start', P(1));
  const S = d.S;
  S.mon.hp = 1; S.mon.ca = 1; S.members[0].ca = 1;
  S.members.forEach((m) => { m.pNext = d.now() + 100; });
  d.advance(1000);
  const r = await call('state', P(1));
  assert.equal(r.j.mon, null);
  assert.equal(r.j.depth, 1);
  assert.ok(env.players[1].xp > 0 || env.players[1].level > 15);
  assert.ok(env.players[2].xp > 0 || env.players[2].level > 8);
  assert.ok(d.S.members[0].pack.gold > 0 && env.players[1].gold === 7); // pack not banked yet
  d.advance(7000);
  const n = await call('state', P(1));
  assert.equal(n.j.mon.level, 16);
});

test('Dungeon Dive: a wipe keeps XP but loses the pack; retreating banks it', async () => {
  const env = fakeEnv(), { d, call } = makeDO(env);
  await call('create', P(1), {}, { name: 'T', code: 'QQ33' });
  await call('join', P(2), {}, { code: 'QQ33' });
  await call('start', P(1));
  const S = d.S;
  S.members[0].pack = { gold: 50, drops: { stick: 1 } }; S.members[1].pack = { gold: 20, drops: {} };
  env.players[1].xp = 5;
  S.mon.level = 90; S.mon.mNext = d.now(); S.members.forEach((m) => { m.hp = 1; m.pNext = 1e15; });
  d.advance(15000 * 2.9);
  d.S.members.forEach((m) => { d.seen[m.id] = d.now(); });
  const w = await call('state', P(1));
  assert.equal(w.j.status, 'lobby'); assert.ok(w.j.wipe); assert.equal(w.j.wipe.lost.find((x) => x.id === 1).gold, 50);
  assert.equal(env.players[1].gold, 7); assert.equal(env.inv[1], undefined);
  assert.equal(env.players[1].xp, 5); // XP untouched by the wipe
  await call('start', P(1));
  d.S.members[0].pack = { gold: 30, drops: { stick: 1 } };
  const left = await call('leave', P(1));
  assert.equal(left.j.left, true);
  assert.equal(env.players[1].gold, 37); assert.equal(env.inv[1].stick, 1);
  assert.equal(d.S.leader, 2); // leadership passes on
  await call('leave', P(2));
  assert.equal(d.S, null); // last one out closes the party
});

test('Dungeon Dive: members who go quiet are treated as retreating; it can be switched off', async () => {
  const env = fakeEnv(), { d, call } = makeDO(env);
  await call('create', P(1), {}, { name: 'T', code: 'KK44' });
  await call('join', P(2), {}, { code: 'KK44' });
  await call('start', P(1));
  d.S.members[1].pack.gold = 12;
  d.advance(100_000);
  d.seen[1] = d.now();
  const r = await call('state', P(1));
  assert.equal(r.j.members.length, 1);
  assert.equal(env.players[2].gold, 19); // 7 from the solo pack + 12 banked
  d.cfg = null;
  env.DB.prepare = ((orig) => (sql) => (sql.includes('g_config') ? { first: async () => ({ v: JSON.stringify({ dive: { on: false } }) }) } : orig(sql)))(env.DB.prepare);
  assert.equal((await call('state', P(1))).status, 403);
});

test('view only shows a member their own question', () => {
  const a = member(1, 'villager', { q: { id: 1, mode: 1, p: { prompt: 'x' } } }), b = member(2, 'villager', { q: { id: 2, mode: 1, p: { prompt: 'y' } } });
  const S = { code: 'AAAA', name: 'n', status: 'dive', leader: 1, base: 5, depth: 0, mon: { mob: 'slime', level: 5, hp: 3, max: 5, ca: 0 }, members: [a, b], log: [], last: null, wipe: null };
  const v = viewOf(S, a, 0, cfg);
  assert.equal(v.me.q.id, 1);
  assert.ok(!JSON.stringify(v.members).includes('prompt'));
});

test('mid-boss every 20 monsters and boss every 40 when switched on; a boss wins a clash; off by default', () => {
  const on = cfgFrom({ dive: { on: true, bosses: true } });
  const kinds = (c, n) => Array.from({ length: n }, (_, d) => leadKind(d, c));
  const k = kinds(on, 80);
  assert.equal(k[18], null); assert.equal(k[19], 'mid'); assert.equal(k[39], 'boss'); assert.equal(k[59], 'mid'); assert.equal(k[79], 'boss');
  assert.equal(k.filter(Boolean).length, 4);
  assert.ok(kinds(cfgFrom({ dive: { on: true } }), 80).every((x) => x === null)); // default: off
  const odd = cfgFrom({ dive: { on: true, bosses: true, midEvery: 10, bossEvery: 0 } });
  assert.equal(leadKind(9, odd), 'mid'); assert.equal(leadKind(39, odd), 'mid'); // boss kind off
  const m = planMonster(30, 19, 1, on, () => 0), b = planMonster(30, 39, 1, on, () => 0);
  assert.equal(MOBS[m.mob].kind, 'mid'); assert.equal(MOBS[b.mob].kind, 'boss');
  assert.equal(m.kind, 'mid'); assert.equal(b.kind, 'boss');
});

test('lead monsters have the solo mid-boss / boss HP multipliers', () => {
  const on = cfgFrom({ dive: { on: true, bosses: true, hpScale: false } });
  const reg = planMonster(10, 0, 1, on, () => 0), mid = planMonster(10, 19, 1, on, () => 0), boss = planMonster(10, 39, 1, on, () => 0);
  assert.equal(mid.hp, Math.round(hpFor(29, on) * on.boss.midHp));
  assert.equal(boss.hp, Math.round(hpFor(49, on) * on.boss.bossHp));
  assert.equal(reg.hp, hpFor(10, on));
});

test('HP scaling with party size can be switched off', () => {
  const scaled = cfgFrom({ dive: { on: true, hpPer: 1 } }), flat = cfgFrom({ dive: { on: true, hpPer: 1, hpScale: false } });
  assert.equal(planMonster(20, 0, 4, scaled, () => 0).hp, hpFor(20, scaled) * 4);
  assert.equal(planMonster(20, 0, 4, flat, () => 0).hp, hpFor(20, flat));
  assert.equal(planMonster(20, 0, 1, scaled, () => 0).hp, planMonster(20, 0, 1, flat, () => 0).hp);
});

test('mid-bosses and bosses hit harder than regular monsters in a dive', () => {
  const hit = (mob, level) => {
    const a = member(1, 'villager', { hp: 1e6, maxHp: 1e6, pNext: 1e12 });
    const S = party([a], { mob, level, hp: 1e6, max: 1e6, mNext: 1000 });
    return simParty(S, cfg, 1000, () => 0.999).ev.find((e) => e.w === 'm').d;
  };
  assert.ok(hit('wyvern', 40) > hit('slime', 40));
  assert.ok(hit('lichking', 40) > hit('slime', 40));
});

test('Dungeon Dive drop multiplier scales every drop chance (capped at 100%)', () => {
  const mk = (dropMult) => { const c = cfgFrom({ dive: { on: true, dropMult }, mobs: { slime: { drops: { potion: 0.1 } } } }); applyItems(c); return c; };
  const drops = (c, roll) => splitKill(party([member(1, 'villager', { ca: 1 })], { level: 5 }), c, () => roll).drops.length;
  assert.equal(drops(mk(1), 0.15), 0); // 10% chance: a 0.15 roll misses
  assert.equal(drops(mk(2), 0.15), 1); // x2 = 20%: it lands
  assert.equal(drops(mk(0), 0), 0); // x0 = no drops at all
  assert.equal(drops(mk(20), 0.99), 1); // 10% x 20 is capped at 100%
});

test('teacher settings for the new Dive options are saved, bounded and default sensibly', async () => {
  const { configSave } = await import('../src/game.js');
  const { DEFAULT_CFG } = await import('../src/gamedata.js');
  const save = async (dive) => {
    let saved = null;
    const env = { DB: { prepare: () => ({ bind: (v) => ({ run: async () => { saved = JSON.parse(v); } }) }) } };
    const body = { hp: { base: 5, tiers: DEFAULT_CFG.hp.tiers }, floors: DEFAULT_CFG.floors, dive };
    await configSave(new Request('https://x/api/teacher/game-config', { method: 'POST', body: JSON.stringify(body) }), env);
    return saved.dive;
  };
  const d = await save({ on: true, bosses: true, midEvery: 15, bossEvery: 30, dropMult: 3, hpScale: false });
  assert.deepEqual([d.bosses, d.midEvery, d.bossEvery, d.dropMult, d.hpScale], [true, 15, 30, 3, false]);
  const e = await save({ on: true }); // omitted: HP scaling stays on, bosses stay off
  assert.deepEqual([e.hpScale, e.bosses, e.midEvery, e.bossEvery, e.dropMult], [true, false, 20, 40, 1]);
  const f = await save({ midEvery: -5, bossEvery: 99999, dropMult: 500 });
  assert.deepEqual([f.midEvery, f.bossEvery, f.dropMult], [0, 1000, 20]);
});

test('XP mode: damage mode shares base XP equally and adds 50% of each pupil\'s own strike damage', () => {
  const mk = () => party([member(1, 'villager', { ca: 1, sd: 40 }), member(2, 'villager', { ca: 1, sd: 0 })], { level: 20 });
  const lvl = splitKill(mk(), cfgFrom({ dive: { on: true } }), () => 0.5);
  const dmg = splitKill(mk(), cfgFrom({ dive: { on: true }, xpMode: 'damage' }), () => 0.5);
  assert.equal(lvl.shares[0].xp, 40); assert.equal(lvl.shares[1].xp, 40);
  assert.equal(dmg.shares[0].xp, 60); // 40 base + 50% of own 40 damage
  assert.equal(dmg.shares[1].xp, 40); // base only
});

test('applyCorrect records the damage actually dealt (no overkill, and not the 1-HP save)', () => {
  const S = party([member(1, 'villager', { atk: 5 })], { hp: 10, max: 10 });
  S.members[0].P = {};
  applyCorrect(S, S.members[0], cfg, () => 0.99); // strike 3 x atk 5 = 15 on a 10 HP monster
  assert.equal(S.members[0].sd, 10);
});

// ---- gear stats in a dive: crit, parry, reflect, stun, leech, and the answer strike's basis ----
const diveHit = (mem, mon = {}, rnd = () => 0) => {
  const S = party([mem], { mob: 'slime', level: 5, hp: 500, max: 500, ca: 9, mNext: 1000, ...mon });
  return { S, r: simParty(S, cfg, 1000, rnd), mem };
};

test('dive: a parry takes the monster’s hit away', () => {
  const { r, mem } = diveHit(member(1, 'knight', { hp: 30, par: 0.4, pNext: 1e12 }));
  const hit = r.ev.find((e) => e.w === 'm');
  assert.equal(hit.d, 0); assert.equal(hit.par, 1); assert.equal(mem.hp, 30);
});

test('dive: reflect sends half the damage back, can finish a monster that has its answers, and not one that has not', () => {
  const { r, S } = diveHit(member(1, 'swordsman', { hp: 30, ref: 0.4, def: 0, pNext: 1e12 }), { level: 40 }, (() => { const q = [0, 0.999, 0]; let i = 0; return () => q[i++ % 3]; })()); // pick the target, roll high, reflect succeeds
  const hit = r.ev.find((e) => e.w === 'm');
  assert.ok(hit.d > 1 && hit.rf >= 1); assert.equal(500 - S.mon.hp, hit.rf);
  const done = diveHit(member(1, 'swordsman', { hp: 30, ref: 0.4, pNext: 1e12 }), { hp: 1, max: 5 });
  assert.equal(done.r.kill, true);
  const needs = diveHit(member(1, 'swordsman', { hp: 30, ref: 0.4, pNext: 1e12 }), { hp: 1, max: 5, ca: 0 });
  assert.ok(!needs.r.kill); assert.equal(needs.S.mon.hp, 1);
});

test('dive: stun delays the monster and leech gives HP back', () => {
  const S = party([member(1, 'cleric', { hp: 10, maxHp: 30, stn: 1, lch: 1, atk: 10, pNext: 1000 })], { hp: 500, max: 500, ca: 9, mNext: 1e9 });
  const r = simParty(S, cfg, 1000, () => 0.9);
  const e = r.ev.find((x) => x.w === 'p');
  assert.equal(e.st, 1); assert.ok(e.lc >= 1);
  assert.ok(S.mon.mNext >= 1e9 + 3000);
  assert.equal(S.members[0].hp, 10 + e.lc);
});

test('dive: critical hits can come from gear, and the answer strike uses the weapon’s balanced value', () => {
  const crit = diveHit(member(1, 'villager', { dbl: 0.1, atk: 6, pNext: 1000, hp: 30 }), { mNext: 1e9 }, () => 0.01);
  assert.equal(crit.r.ev.find((e) => e.w === 'p').x, 1);
  const heavy = member(1, 'fighter', { atk: 24, bat: 12 }), plain = member(2, 'fighter', { atk: 12 });
  const a = applyCorrect(party([heavy], { hp: 9999, max: 9999 }), heavy, cfg, () => 0.99).bonus;
  const b = applyCorrect(party([plain], { hp: 9999, max: 9999 }), plain, cfg, () => 0.99).bonus;
  assert.equal(a, b);
  const luck = member(3, 'villager', { crit: 0.1, atk: 5 });
  assert.equal(applyCorrect(party([luck], { hp: 9999, max: 9999 }), luck, cfg, () => 0.05).crit, 1);
});
