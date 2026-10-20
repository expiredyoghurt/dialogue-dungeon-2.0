// Dialogue Dungeon: the combat rules in one place. Solo play (sim in game.js) and Dungeon Dive (simParty in dive.js) both call these,
// so a new gear stat only has to be written once. Every function takes an `rnd` (default Math.random) so tests and the balance script can seed it,
// and only draws a random number when the stat is actually present, so adding a stat never changes the rolls of a build that doesn't use it.

// Caps on the sum of gear + job perks, so no build becomes unkillable or unstoppable. Fractions: 0.4 = 40%.
export const CAPS = { dbl: 0.5, crit: 0.5, par: 0.4, ref: 0.4, stn: 0.3, lch: 0.2, dod: 0.5 };
export const REFLECT_SHARE = 0.5; // a reflected hit sends back this share of the damage the pupil took (at least 1)
export const STUN_MS = 4000; // a stun pushes the monster's next strike back by this long
export const STAT_KEYS = ['dbl', 'crit', 'par', 'ref', 'stn', 'lch'];
export const capStat = (k, v) => Math.min(CAPS[k] ?? Infinity, Math.max(0, Number(v) || 0));

// A regular attack. g: { dbl }. pmax: the pupil's maximum hit. Returns { d, x } (x = 1 on a critical, double-damage hit).
export function playerStrike(g, pmax, rnd = Math.random) {
  let d = 1 + Math.floor(rnd() * Math.max(1, pmax)), x = 0;
  if (g.dbl && rnd() < g.dbl) { d *= 2; x = 1; }
  return { d, x };
}

// The side effects of a regular hit that did not kill. g: { stn, lch }, d: damage dealt, hp / maxHp: the pupil's.
// Returns { stun: 1 | 0, heal: HP to give back }. Leech keeps its average exactly: 10% of 5 damage heals 1 HP half the time.
export function strikeEffects(g, d, hp, maxHp, rnd = Math.random) {
  let stun = 0, heal = 0;
  if (g.stn && rnd() < g.stn) stun = 1;
  if (g.lch) {
    const h = d * g.lch, whole = Math.floor(h);
    heal = whole + (rnd() < h - whole ? 1 : 0);
    heal = Math.max(0, Math.min(heal, maxHp - hp));
  }
  return { stun, heal };
}

// One monster hit on a pupil. roll: the monster's raw damage roll (before armour). g: { def, dod, par, ref }.
// Returns { d, par, rf } (plus dod: 1 when dodged): d damage taken (0 if dodged or parried), dod = 1 if the pupil dodged (the monster missed),
// par = 1 if parried, rf = damage sent back at the monster. A dodge is rolled first and ends the hit: no parry or reflect roll follows it.
// A build with no dodge draws no extra random number.
export function monsterHit(g, roll, rnd = Math.random) {
  if (g.dod && rnd() < g.dod) return { d: 0, dod: 1, par: 0, rf: 0 };
  if (g.par && rnd() < g.par) return { d: 0, par: 1, rf: 0 };
  const d = Math.max(1, roll - (g.def || 0));
  let rf = 0;
  if (g.ref && rnd() < g.ref) rf = Math.max(1, Math.round(d * REFLECT_SHARE));
  return { d, par: 0, rf };
}

// Expected damage per swing, relative: used by the balance script and the gear tests. maxHit = the pupil's whole maximum hit (job + weapon).
export const dpsIndex = (maxHit, spd = 0, dbl = 0) => ((1 + maxHit) / 2) * (1 + Math.max(-0.5, spd)) * (1 + dbl);
