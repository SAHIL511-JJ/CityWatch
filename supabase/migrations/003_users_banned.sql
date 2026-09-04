-- 003: citizen moderation flag. Banned users are blocked at report time.
-- Safe to re-run.
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_banned ON users (banned);
