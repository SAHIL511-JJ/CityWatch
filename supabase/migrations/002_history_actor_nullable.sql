-- 002: history actor can be citizen / staff / system (AI), not staff-only.
-- Drops the staff-only FK so changed_by is a plain audit UUID (nullable).
-- Safe to re-run.
ALTER TABLE IF EXISTS status_history DROP CONSTRAINT IF EXISTS status_history_changed_by_fkey;
