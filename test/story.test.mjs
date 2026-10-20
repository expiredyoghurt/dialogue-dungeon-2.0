import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, NOTES, ACTS, storyState, markSeen, bossLabel } from '../src/story.js';
import { cfgFrom, DEFAULT_CFG, MOBS, floorInfo, TOP_FLOOR } from '../src/gamedata.js';

const words = (s) => [...s.text, ...(s.after || [])].join(' ').split(/\s+/).filter(Boolean).length;
// a pupil who has cleared floors 1..n
const cleared = (n) => { const fk = {}; for (let f = 1; f <= n; f++) { fk[f] = 5; fk['n' + f] = 5; } return fk; };

test('there are 10 acts of two scenes, a prologue and an epilogue, and every scene is 80 words or fewer', () => {
  assert.equal(ACTS.length, 10);
  assert.equal(SCENES.length, 1 + 20 + 1);
  assert.equal(new Set(SCENES.map((s) => s.id)).size, SCENES.length);
  for (const s of SCENES) assert.ok(words(s) <= 80, s.id + ' has ' + words(s) + ' words');
  for (const n of NOTES) assert.ok(n.text.split(/\s+/).length <= 80);
});

test('mid-boss notes sit on the real mid-boss floors and name the right monster', () => {
  assert.deepEqual(NOTES.map((n) => n.floor), [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
  for (const n of NOTES) {
    const lead = floorInfo(n.floor).lead;
    assert.ok(MOBS[lead].n.startsWith(n.boss), n.floor + ': ' + MOBS[lead].n + ' vs ' + n.boss);
  }
});

test('story is on by default, survives an older saved config and can be switched off', () => {
  assert.equal(DEFAULT_CFG.story, true);
  assert.equal(cfgFrom(null).story, true);
  assert.equal(cfgFrom({ hp: DEFAULT_CFG.hp }).story, true);
  assert.equal(cfgFrom({ story: false }).story, false);
  assert.deepEqual(storyState(50, {}, false), { on: false });
});

test('a new pupil gets only the prologue, with the Level 10 goal as the next step', () => {
  const s = storyState(1, {}, true);
  assert.deepEqual(s.pending.map((p) => p.id), ['p0']);
  assert.equal(s.next, 'Reach Level 10 to hear the next part of the story.');
  assert.equal(s.wren.pct, 0);
  assert.equal(s.scenes, undefined); // the brief carries no text
});

test('the Calling unlocks at the milestone level, the Reckoning only once the boss floor is cleared', () => {
  assert.deepEqual(storyState(9, {}, true).pending.map((p) => p.id), ['p0']);
  let s = storyState(10, {}, true);
  assert.deepEqual(s.pending.map((p) => p.id), ['p0', 'c1']);
  assert.equal(s.next, 'Defeat the boss on Floor 10 to see what happens next.');
  s = storyState(10, cleared(9), true);
  assert.equal(s.pending.length, 2); // floor 9 is not the boss floor
  s = storyState(10, cleared(10), true);
  assert.deepEqual(s.pending.map((p) => p.id), ['p0', 'c1', 'r1']);
  assert.equal(s.wren.pct, 15);
  assert.equal(s.next, 'Reach Level 20 to hear the next part of the story.');
});

test('a boss beaten before the level is reached is held back, so a Reckoning never plays before its Calling', () => {
  const s = storyState(5, cleared(10), true);
  assert.deepEqual(s.pending.map((p) => p.id), ['p0']);
  assert.equal(s.next, 'Reach Level 10 to hear the next part of the story.');
  const later = storyState(10, cleared(10), true);
  assert.deepEqual(later.pending.map((p) => p.id), ['p0', 'c1', 'r1']); // Calling first, then the Reckoning
});

test('a pupil who levels up without descending only sees Callings, with the floor objective', () => {
  const s = storyState(35, {}, true, true);
  assert.deepEqual(s.scenes.map((x) => x.id), ['p0', 'c1', 'c2', 'c3']);
  assert.equal(s.scenes[3].objective.floor, 30);
  assert.equal(s.scenes[3].objective.done, false);
  assert.equal(s.parley.pct, 0);
});

test('locked scenes never leave the server', () => {
  const s = storyState(20, cleared(10), true, true);
  const text = JSON.stringify(s);
  assert.ok(!text.includes('Hushbinder'));
  assert.ok(!text.includes('Ilse'));
  assert.equal(s.notes.length, 1); // floor 5 only
});

test('markSeen keeps only unlocked ids, in story order, and reports a change only when there is one', () => {
  const fk = {};
  assert.equal(markSeen(10, fk, ['c1', 'p0', 'r5', 'nope', 7]), true);
  assert.deepEqual(fk.sty, ['p0', 'c1']);
  assert.equal(markSeen(10, fk, ['c1']), false);
  const s = storyState(10, fk, true);
  assert.equal(s.pending.length, 0);
  assert.equal(storyState(10, fk, true, true).seen.length, 2);
});

test('playing the whole story: Voices restored reaches 100% and the story stays open for more', () => {
  const s = storyState(100, cleared(100), true, true);
  assert.equal(s.done, true);
  assert.equal(s.next, null);
  assert.equal(s.parley.pct, 100);
  assert.equal(s.wren.pct, 100);
  assert.equal(s.scenes.length, SCENES.length);
  assert.equal(s.notes.length, 10);
  const fin = s.scenes.find((x) => x.id === 'r10');
  assert.ok(fin.choice && fin.after.length);
  assert.ok(s.scenes.at(-1).text.join(' ').includes('FLOOR 101')); // the hook for the Deep Verse
  assert.ok(TOP_FLOOR === 100);
});

test('Wren’s voice only ever grows', () => {
  let last = -1;
  for (let lv = 1; lv <= 100; lv += 1) {
    const p = storyState(lv, cleared(Math.min(100, lv)), true).wren.pct;
    assert.ok(p >= last, 'level ' + lv);
    last = p;
  }
});

test('Echo and Hushbinder boss names apply from floor 60, only to bosses, and only with the story on', () => {
  assert.equal(bossLabel(60, 'boss', 'Mimic Emperor (Boss)', true), 'Echo of the Mimic Emperor (Boss)');
  assert.equal(bossLabel(100, 'boss', 'Lich King (Boss)', true), 'The Hushbinder (Boss)');
  assert.equal(bossLabel(50, 'boss', 'Lich King (Boss)', true), 'Lich King (Boss)');
  assert.equal(bossLabel(60, 'boss', 'Mimic Emperor (Boss)', false), 'Mimic Emperor (Boss)');
  assert.equal(bossLabel(85, 'mid', 'Corrupt Paladin (Mid-boss)', true), 'Corrupt Paladin (Mid-boss)');
});
