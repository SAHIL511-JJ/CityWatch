-- Seed categories. Run after 001_init.sql via SQL Editor.
-- Supabase Dashboard > SQL Editor > paste + Run.

INSERT INTO categories (name, icon) VALUES
  ('flooding', 'water-drop'),
  ('waterlogging', 'waves'),
  ('blocked_drain', 'plumbing'),
  ('waste', 'delete-sweep'),
  ('sewage', 'sanitizer'),
  ('plastic', 'recycling'),
  ('pollution', 'air'),
  ('damaged_infrastructure', 'construction'),
  ('other_environmental_condition', 'eco')
ON CONFLICT (name) DO NOTHING;
