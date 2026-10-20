-- Dialogue Dungeon game tables (run after schema.sql). Safe to re-run.
CREATE TABLE IF NOT EXISTS g_player (
  pupil_id INTEGER PRIMARY KEY, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 10, gold INTEGER NOT NULL DEFAULT 0, run_gold INTEGER NOT NULL DEFAULT 0,
  weapon TEXT, armor TEXT, acc TEXT, potion TEXT, auto INTEGER NOT NULL DEFAULT 0,
  job TEXT NOT NULL DEFAULT 'villager', jobs TEXT NOT NULL DEFAULT '["villager"]', floor_kills TEXT NOT NULL DEFAULT '{}', kills INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS g_inv (
  pupil_id INTEGER NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pupil_id, item)
);
CREATE TABLE IF NOT EXISTS g_fight (
  pupil_id INTEGER PRIMARY KEY, mob TEXT NOT NULL, level INTEGER NOT NULL, mob_hp INTEGER NOT NULL,
  mob_max INTEGER NOT NULL, floor INTEGER NOT NULL, last_tick INTEGER NOT NULL, qid INTEGER NOT NULL,
  p_next INTEGER NOT NULL DEFAULT 0, m_next INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS g_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
-- Pupil feedback to the developer (v1.3). Also created automatically on first use.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pupil_id INTEGER NOT NULL, class_id INTEGER, name TEXT NOT NULL,
  kind TEXT NOT NULL, rating TEXT, message TEXT NOT NULL DEFAULT '', ctx TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new', ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_status ON feedback(status, ts);
