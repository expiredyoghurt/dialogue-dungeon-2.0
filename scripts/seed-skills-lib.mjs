// Shared by make-seed-skills.mjs and the tests: turns seed entries into validated question rows and SQL.
import { checkMode1, displayText } from '../src/engine.js';
import { maskFor } from '../src/practice.js';
import { validateMC, validateTransform, validateTense, checkMC, checkTransform, checkTense, SKILLS } from '../src/skills.js';

const esc = (s) => String(s).replace(/'/g, "''");

// Returns { seed, mode, skill, data } with data exactly as it will be stored (typographic quotes, ids, seed id). Throws on a bad entry.
export function prepareEntry(e) {
  const d = e.data;
  let data;
  if (e.mode === 1) {
    data = { correct: displayText(d.correct, true), prompt: d.prompt, alts: [], ...(d.instruction ? { instruction: d.instruction } : {}), ...(d.lines ? { lines: true } : {}), ...(d.beat ? { beat: true } : {}) };
    if (!checkMode1(data, data.correct).correct) throw new Error(`${e.seed}: the key does not mark itself correct`);
    if (checkMode1(data, data.prompt).correct) throw new Error(`${e.seed}: the prompt is already correct`);
  } else if (e.mode === 4) data = validateMC(d);
  else if (e.mode === 5) data = validateTransform(d);
  else if (e.mode === 6) data = validateTense(d);
  else throw new Error(`${e.seed}: unknown mode`);
  if (!SKILLS[e.skill] || !SKILLS[e.skill].modes.includes(e.mode)) throw new Error(`${e.seed}: skill ${e.skill} does not fit mode ${e.mode}`);
  data.seed = e.seed;
  // every key must pass its own checker
  if (e.mode === 4 && !checkMC(data, data.correct.slice(0, data.pick)).correct) throw new Error(`${e.seed}: key rejected`);
  if (e.mode === 5) for (const a of data.accepted) if (!checkTransform(data, a.replace(/[()]/g, '')).correct) throw new Error(`${e.seed}: accepted answer rejected: ${a}`);
  if (e.mode === 6 && !checkTense(data, tokenIndex(data), data.fixes[0]).correct) throw new Error(`${e.seed}: fix rejected`);
  return { seed: e.seed, mode: e.mode, skill: e.skill, data };
}

// index of the first wrong word in the sentence (words only)
export function tokenIndex(data) {
  const words = data.sentence.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  return words.findIndex((w) => data.wrong.includes(w.toLowerCase()));
}

// INSERT-only and idempotent: a row is added only if no question with the same seed id exists (so edits and removals are never undone).
export function sqlFor(entries, header, now = Date.now()) {
  const out = [header];
  for (const e of entries.map(prepareEntry)) {
    out.push(`INSERT INTO questions (mode, class_id, public, active, data, created_at, skill, min_floor, max_floor, rules) SELECT ${e.mode}, NULL, 1, 1, '${esc(JSON.stringify(e.data))}', ${now}, '${e.skill}', NULL, NULL, ${maskFor(e.mode, e.data, e.skill)} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE json_extract(data, '$.seed') = '${esc(e.seed)}');`);
  }
  return out.join('\n') + '\n';
}
