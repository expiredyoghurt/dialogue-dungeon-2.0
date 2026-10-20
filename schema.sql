-- Dialogue Dungeon: D1 schema. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  sess_ver INTEGER NOT NULL DEFAULT 1,   -- bump to sign every pupil in the class out
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  teacher_id INTEGER                     -- v1.9: the teacher account that owns the class; NULL = the admin
);
CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacher_id);

-- v1.9: teacher accounts, made by the admin (the teacher_user / teacher_password secrets).
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,         -- lowercase
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,                 -- pbkdf2$rounds$salt$hash
  active INTEGER NOT NULL DEFAULT 1,
  sess_ver INTEGER NOT NULL DEFAULT 1,   -- bumped to sign the teacher out (password reset, switched off)
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS pupils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER,                      -- NULL for guests
  name TEXT NOT NULL,
  username TEXT NOT NULL,                -- lowercase; what the pupil types to sign in
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS pupils_class_user ON pupils(class_id, username) WHERE class_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pupils_guest_user ON pupils(username) WHERE is_guest = 1;

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode INTEGER NOT NULL,                 -- 1 rewrite, 2 spot the error, 3 upgrade the tag, 4 multiple choice, 5 transform, 6 tap the wrong word
  class_id INTEGER,                      -- NULL = every class
  public INTEGER NOT NULL DEFAULT 1,     -- guests only see public questions
  active INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,                    -- JSON, shape depends on mode
  created_at INTEGER NOT NULL,
  skill TEXT,                            -- v1.6: NULL / 'dialogue' = ordinary pool; otherwise a skill id (src/skills.js)
  min_floor INTEGER,                     -- v1.6: NULL = no lower limit (a skill's own floor range still applies)
  max_floor INTEGER,                     -- v1.6: NULL = no upper limit
  rules INTEGER                          -- v1.8: bit mask of the rules (1-13) the question exercises; NULL = not worked out yet
);
CREATE INDEX IF NOT EXISTS questions_mode ON questions(mode, active);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pupil_id INTEGER NOT NULL,
  class_id INTEGER,
  question_id INTEGER NOT NULL,
  mode INTEGER NOT NULL,
  try_no INTEGER NOT NULL DEFAULT 1,
  practice INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  answer TEXT,
  codes TEXT NOT NULL DEFAULT '[]',      -- JSON array of error codes made in this attempt
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_pupil ON attempts(pupil_id, question_id);
CREATE INDEX IF NOT EXISTS attempts_class ON attempts(class_id, ts);

-- Mode 3: the teacher-editable bank of saying verbs.
CREATE TABLE IF NOT EXISTS verbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base TEXT NOT NULL,
  past TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON array, e.g. ["scared","soft"]
  banned INTEGER NOT NULL DEFAULT 0,     -- said / asked: too plain for Mode 3
  source TEXT NOT NULL DEFAULT 'teacher',-- seed | teacher | ai
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verb_forms (
  form TEXT PRIMARY KEY,                 -- lowercase base / past / 3rd person / -ing
  verb_id INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verb_forms_verb ON verb_forms(verb_id);

-- Every word the AI has judged, so each word costs at most one AI call, ever.
CREATE TABLE IF NOT EXISTS verb_ai (
  word TEXT PRIMARY KEY,
  base TEXT,
  past TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  is_speech INTEGER NOT NULL DEFAULT 0,
  conf REAL NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL,                  -- ai_ok | pending | auto_rejected | approved | rejected
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verb_ai_status ON verb_ai(status, ts);

-- v1.8: practice the teacher has assigned. pupil_id NULL = the whole class.
CREATE TABLE IF NOT EXISTS focus_assign (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  pupil_id INTEGER,
  rule INTEGER NOT NULL,                 -- 1-13, see src/rules.js
  target INTEGER NOT NULL DEFAULT 8,     -- first-try correct practice answers needed
  due INTEGER,                           -- optional deadline (ms since epoch)
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS focus_class ON focus_assign(class_id, active);

-- v1.8: the Guild Training Grounds' daily bonus. One row per pupil, day (in the configured time zone) and bonus skill.
-- bonus_left: NULL = not claimed yet, N = N more double-XP monsters, 0 = used up.
CREATE TABLE IF NOT EXISTS training_day (
  pupil_id INTEGER NOT NULL,
  day TEXT NOT NULL,                     -- YYYY-MM-DD
  rule INTEGER NOT NULL,
  bonus_left INTEGER,
  PRIMARY KEY (pupil_id, day, rule)
);
