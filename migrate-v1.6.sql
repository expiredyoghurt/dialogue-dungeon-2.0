-- Dialogue Dungeon v1.6: question skills. Run ONCE on a database created before v1.6.
-- (A database created from this version's schema.sql already has the columns; do not run this on it.)
-- Existing questions keep NULL in all three columns: ordinary pool ("dialogue"), any floor. No data is changed or lost.
ALTER TABLE questions ADD COLUMN skill TEXT;
ALTER TABLE questions ADD COLUMN min_floor INTEGER;
ALTER TABLE questions ADD COLUMN max_floor INTEGER;
