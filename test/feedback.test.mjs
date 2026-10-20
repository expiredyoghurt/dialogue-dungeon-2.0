import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFeedback, MAX_LEN } from '../src/feedback.js';

const fails = (b, re) => assert.throws(() => cleanFeedback(b), (e) => e.status === 400 && re.test(e.message));

test('a difficulty rating alone is enough; the rating is dropped for other kinds', () => {
  assert.deepEqual(cleanFeedback({ kind: 'difficulty', rating: 'too_hard', message: '' }), { kind: 'difficulty', rating: 'too_hard', message: '' });
  assert.equal(cleanFeedback({ kind: 'suggestion', rating: 'too_hard', message: 'Add a pet' }).rating, null);
});

test('unknown kinds and ratings are rejected or ignored', () => {
  fails({ kind: 'spam', message: 'hello there' }, /about/);
  fails({}, /about/);
  assert.equal(cleanFeedback({ kind: 'difficulty', rating: 'nonsense', message: 'floor 3 is hard' }).rating, null);
});

test('messages need a few words unless a difficulty rating is given', () => {
  fails({ kind: 'bug', message: ' a ' }, /few words/);
  fails({ kind: 'difficulty', rating: '', message: '' }, /difficulty/);
  fails({ kind: 'other' }, /few words/);
});

test('messages are tidied and capped', () => {
  assert.equal(cleanFeedback({ kind: 'bug', message: '  too   many \t spaces\r\n\n\n\nhere ' }).message, 'too many spaces\n\nhere');
  assert.equal(cleanFeedback({ kind: 'other', message: 'x'.repeat(5000) }).message.length, MAX_LEN);
});
