-- WT1 init migration — Supabase only (DB + Storage). No Auth / Functions / Realtime / RLS.
-- Apply: Supabase Dashboard > SQL Editor > paste + Run. Safe to re-run (IF NOT EXISTS guards).

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users (citizens). Auth is custom JWT in backend, not Supabase Auth.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  phone TEXT,
  email TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  trust_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  fcm_token TEXT,
  alert_radius_km DOUBLE PRECISION NOT NULL DEFAULT 5,
  min_severity TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users (device_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- 2. Staff (CRM operators, backend-checked password + role)
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'dispatcher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users (id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES staff (id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  location GEOGRAPHY(Point, 4326),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  severity TEXT NOT NULL DEFAULT 'medium',
  ai_confidence DOUBLE PRECISION,
  ai_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents (reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned ON incidents (assigned_to);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents (category_id);

-- 5. Incident notes (staff thread per incident)
CREATE TABLE IF NOT EXISTS incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff (id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_incident ON incident_notes (incident_id);

-- 6. Status history (audit every status change / AI + CRM override)
CREATE TABLE IF NOT EXISTS status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES staff (id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_incident ON status_history (incident_id);
