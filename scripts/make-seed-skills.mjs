// Builds seed-skills.sql (the nine questions from the brief) and seed-skills-extra.sql (original extras to review).
// Both are INSERT-only and safe to run more than once. Run after schema.sql / migrate-v1.6.sql.
import { writeFileSync } from 'node:fs';
import { CORE, EXTRA } from './seed-skills.mjs';
import { sqlFor } from './seed-skills-lib.mjs';

const now = Date.now();
try {
  writeFileSync(new URL('../seed-skills.sql', import.meta.url), sqlFor(CORE, '-- v1.6 skills: the nine questions from the brief. INSERT-only; safe to re-run (a seed id is never inserted twice).', now));
  writeFileSync(new URL('../seed-skills-extra.sql', import.meta.url), sqlFor(EXTRA, '-- v1.6 skills: original extra questions (5 per type) for you to review. INSERT-only; safe to re-run.\n-- To drop one you don\'t want, remove its line before running, or deactivate it afterwards in the Questions tab.', now));
  console.log(`seed-skills.sql: ${CORE.length} questions · seed-skills-extra.sql: ${EXTRA.length} questions`);
} catch (e) {
  console.error('SEED PROBLEM:', e.message);
  process.exit(1);
}
