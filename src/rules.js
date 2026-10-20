// Rules and error-code metadata, shared by the Worker (feedback + analytics labels)
// and sent to the browser through /api/meta.

export const RULES = {
  1: {
    n: 1,
    short: 'Speech marks',
    title: 'Use Speech Marks Around Spoken Words',
    tip: 'Only the words someone actually says go inside the speech marks.',
    good: 'Raj said, “I want to be a doctor.”',
  },
  2: {
    n: 2,
    short: 'Capital letters',
    title: 'Start with a Capital Letter Inside the Speech Marks',
    tip: 'The first spoken word begins with a capital. Names and the word “I” always have one too.',
    good: '“Can I have some water?” asked Noor.',
  },
  3: {
    n: 3,
    short: 'End punctuation',
    title: 'End the Spoken Words with Punctuation (. ! ?)',
    tip: 'Use a full stop, exclamation mark or question mark. If the saying words come next, use a comma instead (Rule 5).',
    good: '“That’s so funny!” laughed Mei.',
  },
  4: {
    n: 4,
    short: 'Comma after said',
    title: 'Comma After “Said” (or Any Other “Saying Verb”) When the Sentence Starts with It',
    tip: 'When the saying words come first, put a comma before the opening speech marks.',
    good: 'Raj said, “I want to be a doctor.”',
  },
  5: {
    n: 5,
    short: 'Punctuation inside',
    title: 'Punctuation Goes Inside the Speech Marks. If the Saying Words Follow, Use a Comma and Keep Them Lowercase',
    tip: 'Write “Let’s go,” said Chen — not “Let’s go”, said Chen and not “Let’s go.” Said Chen. After ? or ! the saying words are still lowercase.',
    good: '“Let’s go,” said Chen.',
  },
  6: {
    n: 6,
    short: 'New or same sentence',
    title: 'New Sentence = Capital Letter. Same Sentence Carrying On = Lowercase',
    tip: 'If the saying words only pause the sentence, the speech restarts in lowercase. If a new sentence begins, it starts with a capital.',
    good: '“I think,” said Raj, “that we should go.”   “I’m tired,” said Raj. “Let’s go home.”',
  },
  7: {
    n: 7,
    short: 'Strong verbs',
    title: 'Choose a Saying Verb That Shows How the Speaker Feels',
    tip: 'Replace said and asked with a verb that shows volume, mood or feeling.',
    good: '“I can’t find my homework,” stammered Mei.',
  },
  8: {
    n: 8,
    short: 'New speaker, new line',
    title: 'A New Speaker Starts a New Line',
    tip: 'A new speaker means a new line. It’s how readers keep track of who’s talking.',
    good: '“Did you tell Mei?” asked Raj.\n“No, I never said that,” replied Tally.',
  },
  9: {
    n: 9,
    short: 'Action beat or saying verb?',
    title: 'An Action Beat Ends with a Full Stop. A Saying Verb Takes a Comma',
    tip: 'Looking isn’t a saying verb, so that sentence ends with a full stop. The speech starts fresh, and the saying verb comes after the comma inside the speech marks.',
    good: 'Mei looked at the clock. “We’re going to be late,” groaned Mei.',
  },
  10: {
    n: 10,
    short: 'Direct → reported',
    title: 'Reported Speech: the Tense Steps Back and the Pronouns Change',
    tip: 'In reported speech the tense steps back (am going becomes was going) and I becomes she.',
    good: 'Brisk said that she was going to the Warren.',
  },
  11: {
    n: 11,
    short: 'Reported → direct',
    title: 'Direct Speech: Go Back to the Speaker’s Own Words',
    tip: 'Go back to the speaker’s own words: she would becomes I will, and the next day becomes tomorrow.',
    good: 'Wren said to Quip, “I will ring the bell tomorrow.”',
  },
  12: {
    n: 12,
    short: 'Same time, same tense',
    title: 'Keep the Verbs in the Same Time',
    tip: 'Keep the verbs in the same time. The story is in the past, so sees should be saw.',
    good: 'The knight walked into the hall and saw a crown.',
  },
  13: {
    n: 13,
    short: 'Reading between the lines',
    title: 'Read Between the Lines',
    tip: 'What people do and how they say things can show feelings they don’t put into words. Look for the clues.',
    good: '“I’m fine,” said Ilse, folding her arms. (Folded arms: she may not be fine.)',
  },
  0: {
    n: 0,
    short: 'Other',
    title: 'Other Mistakes',
    tip: 'Apostrophes, copying the words exactly, and other punctuation.',
    good: '',
  },
};

// code -> [rule, label for analytics, exclude-from-heatmap?]
export const CODES = {
  NO_QUOTES: { rule: 1, label: 'Missing speech marks' },
  EXTRA_QUOTES: { rule: 1, label: 'Extra speech marks' },
  NO_CAPITAL: { rule: 2, label: 'No capital at start of speech' },
  NO_CAPITAL_SENT: { rule: 2, label: 'No capital at start of sentence' },
  CAPITAL_PROPER: { rule: 2, label: 'No capital on name / “I”' },
  CAPITAL_EXTRA: { rule: 2, label: 'Capital where not needed' },
  NO_END_PUNCT: { rule: 3, label: 'Missing end punctuation' },
  WRONG_END_PUNCT: { rule: 3, label: 'Wrong end punctuation' },
  NO_FULLSTOP_TAG: { rule: 3, label: 'Missing full stop after saying words' },
  PUNCT_EXTRA: { rule: 3, label: 'Extra punctuation' },
  PUNCT_OTHER: { rule: 3, label: 'Other punctuation' },
  NO_COMMA_BEFORE: { rule: 4, label: 'No comma after said' },
  NO_COMMA_AFTER: { rule: 5, label: 'No comma before closing marks' },
  STOP_BEFORE_TAG: { rule: 5, label: 'Full stop before saying words' },
  PUNCT_OUTSIDE: { rule: 5, label: 'Punctuation outside speech marks' },
  TAG_CAPITAL: { rule: 5, label: 'Capital on the saying words' },
  NO_CAPITAL_RESUME: { rule: 6, label: 'No capital for new sentence of speech' },
  RESUME_CAPITAL: { rule: 6, label: 'Capital when sentence carries on' },
  APOSTROPHE: { rule: 0, label: 'Apostrophe' },
  CHANGED_WORDS: { rule: 0, label: 'Changed or missed words' },
  WEAK_VERB: { rule: 7, label: 'Plain verb (said / asked)' },
  VERB_NOT_SPEECH: { rule: 7, label: 'Not a saying verb' },
  VERB_MISMATCH: { rule: 7, label: 'Verb doesn’t match the feeling' },
  WRONG_TENSE: { rule: 7, label: 'Verb tense' },
  // v1.6 skills
  NO_NEW_LINE: { rule: 8, label: 'New speaker not on a new line' },
  EXTRA_NEW_LINE: { rule: 8, label: 'Line break inside one speaker’s speech' },
  BEAT_COMMA: { rule: 9, label: 'Comma after an action beat (needs a full stop)' },
  RS_PRONOUN: { rule: 10, label: 'Reported speech: pronoun not changed' },
  RS_TENSE: { rule: 10, label: 'Reported speech: tense not stepped back' },
  RS_TIME: { rule: 10, label: 'Reported speech: time word not changed' },
  RS_QUOTES: { rule: 10, label: 'Reported speech: speech marks left in' },
  RS_FORM: { rule: 10, label: 'Reported speech: other' },
  DS_PRONOUN: { rule: 11, label: 'Direct speech: pronoun not changed back' },
  DS_TENSE: { rule: 11, label: 'Direct speech: tense not moved back' },
  DS_TIME: { rule: 11, label: 'Direct speech: time word not changed back' },
  DS_FORM: { rule: 11, label: 'Direct speech: other' },
  TENSE_TAP: { rule: 12, label: 'Tense fix: tapped the wrong word' },
  TENSE_FIX: { rule: 12, label: 'Tense fix: wrong correction' },
  MC_VERB: { rule: 7, label: 'Chose a verb that doesn’t fit (multiple choice)' },
  MC_INFER: { rule: 13, label: 'Missed a clue between the lines' },
  // Not shown in analytics (not the pupil's mistake):
  VERB_PENDING: { rule: 7, label: 'Word awaiting teacher review', hidden: true },
  VERB_INVALID: { rule: 7, label: 'Not a single word', hidden: true },
};

export const HIDDEN_CODES = Object.entries(CODES)
  .filter(([, v]) => v.hidden)
  .map(([k]) => k);

export const TAGS = {
  loud: 'loud',
  soft: 'quiet / soft',
  happy: 'happy',
  excited: 'excited',
  sad: 'sad',
  angry: 'angry',
  scared: 'scared / nervous',
  shocked: 'shocked / surprised',
  proud: 'proud / confident',
  curious: 'curious / puzzled',
  pleading: 'pleading',
  mocking: 'mocking / sarcastic',
  calm: 'calm / matter-of-fact',
  kind: 'kind / comforting',
};

export const RANKS = [
  { xp: 0, name: 'Rookie Writer' },
  { xp: 60, name: 'Quote Keeper' },
  { xp: 160, name: 'Comma Captain' },
  { xp: 320, name: 'Tag Master' },
  { xp: 560, name: 'Dialogue Director' },
  { xp: 900, name: 'Master Storyteller' },
];

export function rankFor(xp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
  const next = RANKS[idx + 1] || null;
  return { index: idx, name: RANKS[idx].name, from: RANKS[idx].xp, next: next ? next.xp : null, nextName: next ? next.name : null };
}
