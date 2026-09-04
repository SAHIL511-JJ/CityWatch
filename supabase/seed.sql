-- Seed categories. Run after 001_init.sql via SQL Editor.
-- Supabase Dashboard > SQL Editor > paste + Run.

INSERT INTO categories (name, icon) VALUES
  ('crime', 'shield-alert'),
  ('fire', 'flame'),
  ('accident', 'car-crash'),
  ('hazard', 'alert-triangle'),
  ('other', 'dots')
ON CONFLICT (name) DO NOTHING;
