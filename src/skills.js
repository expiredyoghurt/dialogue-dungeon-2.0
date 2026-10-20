// Question skills (v1.6) and the marking for the new question modes.
//   Mode 4  multiple choice, pick 1 or pick N          (2a verb upgrade, 7a-c reading between the lines)
//   Mode 5  free-text transform                        (4a direct -> reported, 4b reported -> direct)
//   Mode 6  tap the wrong word, then type the fix      (4c tense fix)
//   Mode 1  gains two optional flags: lines (one speaker per line, 1a) and beat (action beat + speech tag, 1b); see engine.js.
// Everything here is pure (no database), so the Worker, the Durable Object and the tests all share it.

import { CODES } from './rules.js';
import { normalizeText, tokenize, displayText, clientTokens, keyOf, checkMode1 } from './engine.js';
import { HttpError, clip } from './util.js';

// ---------- skills ----------

// A skill is a family of questions served only on certain floors. Defaults come from the story zones; a teacher can change
// the share and the floor range of each skill (Game balance tab). Questions with no skill (or 'dialogue') are the ordinary pool.
export const SKILLS = {
  speaker_lines: { n: 'New speaker, new line', modes: [1], min: 11, max: 20 },
  action_beat: { n: 'Action beat + speech tag', modes: [1], min: 11, max: 20 },
  verb_choice: { n: 'Upgrade the verb (multiple choice)', modes: [4], min: 21, max: 30 },
  reported: { n: 'Direct and reported speech', modes: [5], min: 41, max: 60 },
  tense_fix: { n: 'Tense fix', modes: [6], min: 41, max: 60 },
  reading_between: { n: 'Reading between the lines', modes: [4], min: 81, max: 90 },
};
export const DEFAULT_SHARE = 35; // % of questions on a floor inside the skill's range
export const SHARE_CAP = 70; // when skills overlap, together they never take more than this % (the ordinary pool keeps the rest)
export const DEFAULT_SKILLS = Object.fromEntries(Object.entries(SKILLS).map(([id, s]) => [id, { on: true, share: DEFAULT_SHARE, min: s.min, max: s.max }]));
export const isSkill = (id) => Object.prototype.hasOwnProperty.call(SKILLS, id);
export const isSkillQ = (skill) => !!skill && skill !== 'dialogue';

// Tries per mode. Mode 4 is guessable, so it gets two; everything else keeps the three-try pattern.
export const MC_TRIES = 2;
export const XP1 = [10, 6, 3];
export const XP4 = [8, 4];

// ---------- text helpers ----------

// Typographic quotes and apostrophes for stored text.
export const curl = (s) => displayText(String(s ?? '').trim());

// Normal form used to compare free-text answers: lowercase, straight quotes, contractions opened up (I’ll = I will),
// every other punctuation mark ignored, speech marks kept as their own tokens, spacing collapsed.
export function normT(s) {
  let t = normalizeText(s).text.toLowerCase();
  t = t
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bcannot\b/g, 'can not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/'ll\b/g, ' will')
    .replace(/'m\b/g, ' am')
    .replace(/'re\b/g, ' are')
    .replace(/'ve\b/g, ' have')
    .replace(/'/g, '')
    .replace(/"/g, ' " ')
    .replace(/[^\p{L}\p{N}" ]+/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// "Brisk said (that) she was going" -> both versions. Words in brackets are optional.
export function expandOptional(s, depth = 0) {
  const m = /\(([^()]+)\)/.exec(s);
  if (!m) return [s];
  if (depth >= 4) return [s.replace(/[()]/g, '')];
  return [...expandOptional(s.replace(m[0], m[1]), depth + 1), ...expandOptional(s.replace(m[0], ' '), depth + 1)];
}

const cleanList = (v, n, max) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => clip(x, max).trim()).filter(Boolean).slice(0, n);
const cleanGroup = (g) => clip(g, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');

// ---------- Mode 4: multiple choice ----------

export function validateMC(d) {
  const stem = curl(clip(d.stem, 400));
  if (!stem) throw new HttpError(400, 'Type the question.');
  const texts = (Array.isArray(d.options) ? d.options : String(d.options ?? '').split('\n')).map((o) => curl(clip(typeof o === 'object' && o ? o.text : o, 160))).filter(Boolean);
  if (texts.length < 2 || texts.length > 6) throw new HttpError(400, 'Give 2 to 6 answer options.');
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) throw new HttpError(400, 'Every option must be different.');
  const options = texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));
  const ids = new Set(options.map((o) => o.id));
  // `correct` may list option ids ('b') or 1-based numbers (2), as the teacher form sends.
  const correct = [...new Set((Array.isArray(d.correct) ? d.correct : String(d.correct ?? '').split(/[,\s]+/)).map((c) => (/^\d+$/.test(String(c)) ? String.fromCharCode(96 + Number(c)) : String(c).toLowerCase())).filter((c) => ids.has(c)))];
  if (!correct.length) throw new HttpError(400, 'Mark at least one option as correct.');
  if (correct.length === options.length) throw new HttpError(400, 'At least one option must be wrong.');
  const pick = Math.round(Number(d.pick) || 1);
  if (pick < 1 || pick > correct.length) throw new HttpError(400, 'The number of answers pupils choose can’t be more than the number of correct options.');
  const explanation = curl(clip(d.explanation, 500));
  if (!explanation) throw new HttpError(400, 'Write the explanation pupils see after answering.');
  const out = { stem, options, correct, pick, explanation };
  const context = curl(clip(d.context, 300));
  const passage = curl(clip(d.passage, 900));
  if (context) out.context = context;
  if (passage) out.passage = passage;
  const group = cleanGroup(d.group);
  if (group) out.group = group;
  if (d.code === 'MC_VERB' || d.code === 'MC_INFER') out.code = d.code;
  return out;
}

// Marks a pick. picked = array of option ids. Returns { valid, message?, correct, wrongIds }.
export function checkMC(data, picked) {
  const ids = new Set(data.options.map((o) => o.id));
  const pick = data.pick || 1;
  const got = [...new Set((Array.isArray(picked) ? picked : []).map((x) => String(x)).filter((x) => ids.has(x)))];
  if (got.length !== pick) return { valid: false, message: pick === 1 ? 'Choose one answer.' : `Choose ${pick} answers.`, correct: false, wrongIds: [] };
  const ok = new Set(data.correct);
  const wrongIds = got.filter((x) => !ok.has(x));
  return { valid: true, correct: wrongIds.length === 0, wrongIds, picked: got };
}
export const mcCode = (data, skill) => data.code || (skill === 'verb_choice' ? 'MC_VERB' : 'MC_INFER');

// ---------- Mode 5: free-text transform ----------

const MSG = {
  RS_PRONOUN: ['The words are now being reported by someone else, so “I” (or “my”, “we”) has to change to he, she or they.', 'Swap the pronoun for the person who spoke.'],
  RS_TENSE: ['The tense hasn’t stepped back. Reported speech moves one step into the past (am → was, will → would).', 'Change the verb to its past form.'],
  RS_TIME: ['The time word needs to change too (for example tomorrow → the next day).', 'Check the time words against the tip.'],
  RS_QUOTES: ['Reported speech doesn’t use speech marks.', 'Take the speech marks out and join the words to the saying verb.'],
  RS_FORM: ['Not quite. Check who is speaking, which tense you need and whether speech marks belong.', 'Read the tip, then try again.'],
  DS_PRONOUN: ['In direct speech the speaker uses their own words, so “she” or “he” becomes “I”.', 'Put the speaker’s own pronoun back.'],
  DS_TENSE: ['Go back to the speaker’s own tense (would → will).', 'Change the verb back to what the speaker said.'],
  DS_TIME: ['Go back to the speaker’s own time words (the next day → tomorrow).', 'Change the time words back.'],
  DS_FORM: ['Not quite. Think about what the speaker actually said, in their own words.', 'Read the tip, then try again.'],
  NO_QUOTES: ['Direct speech needs speech marks around the spoken words.', 'Put “ before the first spoken word and ” after the last one.'],
  TENSE_TAP: ['That word is not the mistake.', 'Look for the verb that is in the wrong time.'],
  TENSE_FIX: ['You found the wrong word, but the correction isn’t right yet.', 'Keep the verbs in the same time.'],
};
const err = (code) => ({ code, rule: (CODES[code] || {}).rule ?? 0, what: MSG[code][0], fix: MSG[code][1] });

const kindOf = (d) => (d.kind === 'direct' || d.kind === 'reported' ? d.kind : (d.accepted || []).some((a) => /["“”]/.test(a)) ? 'direct' : 'reported');
const trapWord = (w) => normT(w);

export function validateTransform(d) {
  const prompt = curl(clip(d.prompt, 400));
  if (!prompt) throw new HttpError(400, 'Type the sentence pupils will rewrite.');
  const accepted = cleanList(d.accepted, 12, 400).map(curl);
  if (!accepted.length) throw new HttpError(400, 'Give at least one accepted answer.');
  for (const a of accepted) if ((a.match(/\(/g) || []).length > 4 || (a.match(/\(/g) || []).length !== (a.match(/\)/g) || []).length) throw new HttpError(400, `Check the brackets in “${a}”. Use (word) for an optional word, up to 4 per answer.`);
  const kind = d.kind === 'direct' || d.kind === 'reported' ? d.kind : kindOf({ accepted });
  const out = { prompt, instruction: curl(clip(d.instruction, 200)) || (kind === 'direct' ? 'Rewrite as direct speech.' : 'Rewrite as reported speech.'), kind, accepted };
  const traps = (Array.isArray(d.traps) ? d.traps : [])
    .map((t) => ({ words: cleanList(t && t.words, 8, 30).map((w) => w.toLowerCase()), code: String((t && t.code) || '') }))
    .filter((t) => t.words.length && CODES[t.code] && !CODES[t.code].hidden)
    .slice(0, 8);
  if (traps.length) out.traps = traps;
  const group = cleanGroup(d.group);
  if (group) out.group = group;
  if (checkTransform(out, prompt).correct) throw new HttpError(400, 'The sentence pupils start from is already an accepted answer.');
  return out;
}

// Marks a free-text answer. Returns { correct, codes, errors, note? }.
export function checkTransform(data, answer) {
  const variants = (data.accepted || []).flatMap((a) => expandOptional(a).map((v) => ({ raw: v.replace(/\s+/g, ' ').trim(), norm: normT(v) })));
  const a = normT(answer);
  const hit = variants.find((v) => v.norm === a);
  const kind = kindOf(data);
  if (hit) {
    let note;
    // Direct speech: the punctuation is not what is being marked, but a pupil who got the words right still hears about it.
    if (/["“”]/.test(hit.raw)) {
      const strict = checkMode1({ correct: hit.raw, alts: [] }, answer);
      if (!strict.correct && !strict.errors.some((e) => e.code === 'CHANGED_WORDS')) note = strict.errors[0].what;
    }
    return { correct: true, codes: [], errors: [], note };
  }
  const toks = a.split(' ');
  const codes = [];
  const add = (c) => { if (!codes.includes(c)) codes.push(c); };
  for (const t of data.traps || []) if ((t.words || []).some((w) => toks.includes(trapWord(w)))) add(t.code);
  const quoted = toks.includes('"');
  if (kind === 'reported' && quoted) add('RS_QUOTES');
  if (kind === 'direct' && !quoted) add('NO_QUOTES');
  if (!codes.length) add(kind === 'direct' ? 'DS_FORM' : 'RS_FORM');
  return { correct: false, codes, errors: codes.map(err) };
}

export const modelTransform = (data) => displayText((data.accepted || [])[0] || '', true);

// ---------- Mode 6: tap the wrong word, then type the fix ----------

const wordKeys = (list) => new Set((list || []).map((w) => keyOf(normalizeText(String(w)).text.trim())).filter(Boolean));

export function validateTense(d) {
  const sentence = curl(clip(d.sentence, 240));
  if (!sentence) throw new HttpError(400, 'Type the sentence with the mistake in it.');
  const ct = clientTokens(sentence);
  if (ct.words.length < 4) throw new HttpError(400, 'The sentence is too short.');
  const wrong = cleanList(d.wrong, 4, 30).map((w) => w.toLowerCase());
  const fixes = cleanList(d.fixes, 8, 30).map((w) => w.toLowerCase());
  if (!wrong.length) throw new HttpError(400, 'Give the word that is wrong.');
  if (!fixes.length) throw new HttpError(400, 'Give at least one accepted correction.');
  const have = new Set(ct.words.map((w) => keyOf(w)));
  for (const w of wrong) if (!have.has(keyOf(w))) throw new HttpError(400, `“${w}” isn’t in the sentence.`);
  const wk = wordKeys(wrong);
  for (const f of fixes) {
    if (normT(f).split(' ').length > 3 || !/\p{L}/u.test(f)) throw new HttpError(400, `“${f}” should be a word or short phrase.`);
    if (wk.has(keyOf(f))) throw new HttpError(400, `“${f}” is the same as the wrong word.`);
  }
  const out = { sentence, wrong, fixes };
  const instruction = curl(clip(d.instruction, 200));
  if (instruction) out.instruction = instruction;
  const group = cleanGroup(d.group);
  if (group) out.group = group;
  return out;
}

// tapped = index of the word the pupil tapped; fix = what they typed. Returns { valid, message?, correct, tapOk, fixOk, codes, errors }.
export function checkTense(data, tapped, fix) {
  const ct = clientTokens(data.sentence);
  const i = Number(tapped);
  if (!Number.isInteger(i) || i < 0 || i >= ct.words.length) return { valid: false, message: 'Tap the word that is wrong first.' };
  const f = normT(fix);
  if (!f || !/\p{L}/u.test(f) || f.split(' ').length > 3) return { valid: false, message: 'Type the corrected word (or a short phrase).' };
  const tapOk = wordKeys(data.wrong).has(keyOf(ct.words[i]));
  const fixOk = (data.fixes || []).some((x) => normT(x) === f);
  const correct = tapOk && fixOk;
  const codes = correct ? [] : [tapOk ? 'TENSE_FIX' : 'TENSE_TAP'];
  return { valid: true, correct, tapOk, fixOk, codes, errors: codes.map(err) };
}

// The sentence with the first wrong word replaced by the first accepted fix (shown once the question is over).
export function correctedSentence(data) {
  const text = displayText(data.sentence);
  const tk = tokenize(text);
  const wk = wordKeys(data.wrong);
  const w = tk.words.find((x) => wk.has(x.key));
  if (!w || !(data.fixes || [])[0]) return text;
  let fix = data.fixes[0];
  if (/^\p{Lu}/u.test(w.raw)) fix = fix[0].toUpperCase() + fix.slice(1);
  return text.slice(0, w.start) + fix + text.slice(w.end);
}

// ---------- Mode 1 flags ----------

// Extra Mode 1 data a teacher can set: lines (one speaker per line), beat (action beat + speech tag), instruction.
export function mode1Extras(d, correct) {
  const out = {};
  if (d.lines) {
    if (!/\S\s*\n\s*\S/.test(correct)) throw new HttpError(400, 'A “one speaker per line” question needs at least two lines in the correct answer.');
    out.lines = true;
  }
  if (d.beat) out.beat = true;
  const instruction = curl(clip(d.instruction, 200));
  if (instruction) out.instruction = instruction;
  const group = cleanGroup(d.group);
  if (group) out.group = group;
  return out;
}
// The prompt for a lines question: the key on one line, punctuation kept (the pupil only has to find the break).
export const linesPrompt = (correct) => displayText(correct.replace(/\s*\n\s*/g, ' ').trim(), true);

// ---------- what the browser is sent (never the answers) ----------

const R1 = [1, 2, 3, 4, 5, 6];
export function skillPayload(mode, data) {
  if (mode === 1) {
    const p = { prompt: data.prompt };
    if (data.lines) { p.lines = true; p.rules = [...R1, 8]; }
    else if (data.beat) { p.beat = true; p.rules = [...R1, 9]; }
    if (data.instruction) p.instruction = data.instruction;
    return p;
  }
  if (mode === 4) {
    const p = { stem: data.stem, options: (data.options || []).map((o) => ({ id: o.id, text: o.text })), pick: data.pick || 1, tries: MC_TRIES };
    if (data.context) p.context = data.context;
    if (data.passage) p.passage = data.passage;
    return p;
  }
  if (mode === 5) return { prompt: data.prompt, instruction: data.instruction || (kindOf(data) === 'direct' ? 'Rewrite as direct speech.' : 'Rewrite as reported speech.'), rules: kindOf(data) === 'direct' ? [11, 1, 4] : [10] };
  if (mode === 6) {
    if (!data.sentence) return null;
    return { ...clientTokens(data.sentence), instruction: data.instruction || 'One word is in the wrong tense. Tap it, then type the fix.', rules: [12] };
  }
  return null;
}

// A short line for the teacher's question list.
export function skillText(mode, d) {
  if (mode === 4) return (d.passage ? d.passage.split('\n')[0] + ' … ' : '') + d.stem;
  if (mode === 5) return d.prompt;
  if (mode === 6) return d.sentence;
  return d.prompt;
}
