-- Dialogue Dungeon v1.8: deliberate practice and class diagnosis. Run ONCE on a database created before v1.8.
-- (A database created from this version's schema.sql already has these; do not run this on it.)
-- Existing questions get rules = NULL. The app works out each question's rules by itself (practice room, or the first time the
-- teacher opens Diagnosis; the Questions tab also has a "Scan questions" button). No data is changed or lost.
ALTER TABLE questions ADD COLUMN rules INTEGER;
CREATE TABLE IF NOT EXISTS focus_assign (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  pupil_id INTEGER,
  rule INTEGER NOT NULL,
  target INTEGER NOT NULL DEFAULT 8,
  due INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS focus_class ON focus_assign(class_id, active);
CREATE TABLE IF NOT EXISTS training_day (
  pupil_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  rule INTEGER NOT NULL,
  bonus_left INTEGER,
  PRIMARY KEY (pupil_id, day, rule)
);
