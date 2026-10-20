-- Run ONCE on a database created before v0.11 (adds the per-fight attack timers).
ALTER TABLE g_fight ADD COLUMN p_next INTEGER NOT NULL DEFAULT 0;
ALTER TABLE g_fight ADD COLUMN m_next INTEGER NOT NULL DEFAULT 0;
