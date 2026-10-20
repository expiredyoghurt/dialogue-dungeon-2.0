-- Dialogue Dungeon v1.9: teacher accounts. OPTIONAL: the app adds all of this by itself the first time a teacher signs in.
-- Run it only if you would rather do the change by hand, and only ONCE on a database created before v1.9
-- (a database made from this version's schema.sql already has it).
-- Existing classes get teacher_id = NULL, which means they belong to the admin. Nothing is changed or lost.
ALTER TABLE classes ADD COLUMN teacher_id INTEGER;
CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacher_id);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sess_ver INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
