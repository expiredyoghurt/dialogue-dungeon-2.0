// Feedback after a wrong answer (v1.8).
//
// The aim is that a wrong answer teaches: it shows where to look, then what is wrong, and only on the last try what to write.
//   level 1 (first try)   the trouble spots in the pupil's own answer, the rule tips, and how many spots they already fixed
//   level 2 (second try)  + what is wrong at each spot, and a right-versus-wrong example of that kind of mistake
//   level 3 (last try / "Show answer")  + exactly what to change, and the model answer
// Nothing is withheld that the pupil could not see on the last try, so the answer is never hidden for good.

import { RULES } from './rules.js';

// A minimal pair for each kind of mistake: the same sentence wrong, then right.  \n = a line break.
export const EXAMPLES = {
  NO_QUOTES: { bad: 'Raj said I am tired.', good: 'Raj said, “I am tired.”' },
  EXTRA_QUOTES: { bad: '“Raj” said, “I am tired.”', good: 'Raj said, “I am tired.”' },
  NO_CAPITAL: { bad: 'Raj said, “i am tired.”', good: 'Raj said, “I am tired.”' },
  NO_CAPITAL_SENT: { bad: 'the gate creaked open.', good: 'The gate creaked open.' },
  CAPITAL_PROPER: { bad: '“Where is mei?” asked raj.', good: '“Where is Mei?” asked Raj.' },
  CAPITAL_EXTRA: { bad: 'Raj said, “We Are late.”', good: 'Raj said, “We are late.”' },
  NO_END_PUNCT: { bad: 'Raj said, “I am tired”', good: 'Raj said, “I am tired.”' },
  WRONG_END_PUNCT: { bad: 'Mei asked, “Where is the key.”', good: 'Mei asked, “Where is the key?”' },
  NO_FULLSTOP_TAG: { bad: '“I am tired,” said Raj “Let’s go.”', good: '“I am tired,” said Raj. “Let’s go.”' },
  PUNCT_EXTRA: { bad: 'Raj said; “I am tired.”', good: 'Raj said, “I am tired.”' },
  PUNCT_OTHER: { bad: '“No I never said that,” replied Tally.', good: '“No, I never said that,” replied Tally.' },
  NO_COMMA_BEFORE: { bad: 'Raj said “I am tired.”', good: 'Raj said, “I am tired.”' },
  NO_COMMA_AFTER: { bad: '“I am tired” said Raj.', good: '“I am tired,” said Raj.' },
  STOP_BEFORE_TAG: { bad: '“I am tired.” said Raj.', good: '“I am tired,” said Raj.' },
  PUNCT_OUTSIDE: { bad: '“I am tired”, said Raj.', good: '“I am tired,” said Raj.' },
  TAG_CAPITAL: { bad: '“I am tired,” Said Raj.', good: '“I am tired,” said Raj.' },
  NO_CAPITAL_RESUME: { bad: '“I am tired,” said Raj. “let’s go.”', good: '“I am tired,” said Raj. “Let’s go.”' },
  RESUME_CAPITAL: { bad: '“We can go,” said Raj, “If we hurry.”', good: '“We can go,” said Raj, “if we hurry.”' },
  APOSTROPHE: { bad: '“I dont know,” said Raj.', good: '“I don’t know,” said Raj.' },
  WEAK_VERB: { bad: '“Help!” said Mei.', good: '“Help!” screamed Mei.' },
  VERB_NOT_SPEECH: { bad: '“Help!” ran Mei.', good: '“Help!” screamed Mei.' },
  VERB_MISMATCH: { bad: '“I won!” whispered Mei.', good: '“I won!” cheered Mei.' },
  WRONG_TENSE: { bad: '“Help!” screams Mei.', good: '“Help!” screamed Mei.' },
  NO_NEW_LINE: { bad: '“Hi,” said Raj. “Hello,” said Mei.', good: '“Hi,” said Raj.\n“Hello,” said Mei.' },
  EXTRA_NEW_LINE: { bad: '“I am tired,”\nsaid Raj.', good: '“I am tired,” said Raj.' },
  BEAT_COMMA: { bad: 'Mei looked up, “We’re late,” groaned Mei.', good: 'Mei looked up. “We’re late,” groaned Mei.' },
  RS_PRONOUN: { bad: 'Tom said that I was hungry.', good: 'Tom said that he was hungry.' },
  RS_TENSE: { bad: 'Tom said that he is hungry.', good: 'Tom said that he was hungry.' },
  RS_TIME: { bad: 'Tom said he would come tomorrow.', good: 'Tom said he would come the next day.' },
  RS_QUOTES: { bad: 'Tom said that “he was hungry.”', good: 'Tom said that he was hungry.' },
  DS_PRONOUN: { bad: 'Tom said, “He is hungry.”', good: 'Tom said, “I am hungry.”' },
  DS_TENSE: { bad: 'Tom said, “I would come.”', good: 'Tom said, “I will come.”' },
  DS_TIME: { bad: 'Tom said, “I will come the next day.”', good: 'Tom said, “I will come tomorrow.”' },
  TENSE_TAP: { bad: 'The knight walked in and sees a crown.', good: 'The knight walked in and saw a crown.' },
  TENSE_FIX: { bad: 'The knight walked in and sees a crown.', good: 'The knight walked in and saw a crown.' },
  MC_VERB: { bad: '“Open up!” whispered the guard.', good: '“Open up!” bellowed the guard.' },
};

export const exampleFor = (code) => EXAMPLES[code] || null;

export const levelFor = (tryNo, final) => (final ? 3 : Math.min(Math.max(tryNo || 1, 1), 3));

// Hides detail the pupil has not earned yet. errors come from the checkers (code, rule, kind, index, what, fix, ...).
export function gradeErrors(errors, level) {
  return (errors || []).map((e) => {
    const out = { code: e.code, rule: e.rule, kind: e.kind, index: e.index };
    if ((level >= 2 || e.kind === 'x') && e.what) out.what = e.what; // changed words are always explained: it is not a skill the hint ladder is for
    if (level >= 3 && e.fix) out.fix = e.fix;
    return out;
  });
}

// "You fixed 7 of 9 spots." (Mode 1: total = the mistakes in the prompt, remaining = those left in this answer.)
export function progress(total, remaining) {
  if (!total || remaining == null || remaining <= 0) return null;
  const fixed = Math.max(0, total - remaining);
  const text = fixed > 0 ? `You fixed ${fixed} of ${total} spots. ${remaining} to go.` : `${remaining} spot${remaining === 1 ? ' still needs' : 's still need'} fixing.`;
  return { total, fixed, remaining, text };
}

// What the browser shows under a wrong answer. `errors` are the full errors (graded here); extra = { total, remaining, pieces }.
export function buildFeedback({ errors, tryNo, final, extra = {} }) {
  const level = levelFor(tryNo, final);
  const list = errors || [];
  const rules = [...new Set(list.map((e) => e.rule).filter((n) => n > 0))];
  const fb = { level, rules, errors: gradeErrors(list, level) };
  const pr = progress(extra.total, extra.remaining);
  if (pr) fb.progress = pr;
  if (extra.pieces) fb.pieces = extra.pieces;
  const first = list.find((e) => exampleFor(e.code));
  if (level >= 2 && first) fb.example = { code: first.code, rule: first.rule, ...exampleFor(first.code) };
  // Once the question is over: suggest practising the rule that cost the most.
  if (final && rules.length) {
    const counts = {};
    for (const e of list) if (e.rule > 0) counts[e.rule] = (counts[e.rule] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    fb.next = { rule: +top[0], name: RULES[+top[0]].short };
  }
  return fb;
}
