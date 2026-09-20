-- KAN-52 + KAN-53 — Staff workspace: availability, activity, and admin invitations.
-- Purely additive. Safe to re-run (IF NOT EXISTS guards). Apply via the configured
-- Supabase migration workflow; verify supabase_migrations.schema_migrations before testing.

-- 1. Staff availability + activity
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS availability_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Constrain availability to the three manual states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_availability_check'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_availability_check
      CHECK (availability IN ('available', 'busy', 'away'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_availability ON staff (availability);

-- 2. Staff invitations (admin-only, one-time, hashed token, 72h expiry)
CREATE TABLE IF NOT EXISTS staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'dispatcher',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES staff (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_email ON staff_invitations (email);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_token_hash ON staff_invitations (token_hash);

-- Valid invitation roles only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_invitations_role_check'
  ) THEN
    ALTER TABLE staff_invitations
      ADD CONSTRAINT staff_invitations_role_check
      CHECK (role IN ('admin', 'dispatcher', 'analyst'));
  END IF;
END $$;

-- At most one pending (unaccepted, unrevoked) invitation per email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invitations_pending_email
  ON staff_invitations (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
