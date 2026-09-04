# Database

Supabase Postgres + PostGIS in `supabase/` — the only cloud data store. Holds tables and photos; nothing else (see [[Decisions-Log]] for why).

## Tables and purpose

- **users** — citizens: `device_id` (unique), `phone/email`, `verified`, `trust_score`, `fcm_token`, `alert_radius_km`, `min_severity`, `banned` (migration 003; [[Backend]] returns 403 for banned).
- **staff** — CRM operators: `email` (unique), `password_hash`, `role` (dispatcher/analyst/admin).
- **categories** — `crime/fire/accident/hazard/other` + icon; seeded by `supabase/seed.sql`.
- **incidents** — the core row: `reporter_id→users`, `assigned_to→staff`, `title/description/photo_url`, `location GEOGRAPHY(Point,4326)` + plain `lat/lng` (portable columns; PostGIS is an accelerator with a GIST index), `status/severity`, `ai_confidence`, `ai_analysis JSONB`.
- **incident_notes** — staff thread per incident (`incident_id→incidents`, `staff_id→staff`).
- **status_history** — audit of every AI + CRM status change; `changed_by` is a nullable plain UUID (citizen/system/AI allowed), not a staff FK.

## Migrations

- **001** (`001_init.sql`) — base schema + `postgis` (+`pgcrypto`), all tables/indexes, no RLS. Safe to re-run (`IF NOT EXISTS` guards).
- **002** (`002_history_actor_nullable.sql`) — drops the staff-only `changed_by` FK so citizen-created and AI rows insert cleanly.
- **003** (`003_users_banned.sql`) — adds `users.banned` + index for spammer moderation.
- Apply via SQL Editor in numeric order, then `seed.sql` — unless repo-link auto-apply already did it (below).

## Connections, seeds, and what we don't use

- **Runtime** uses the pooler session-mode URL (port 5432); **migrations** use the direct URL. Both live in `apps/backend/.env` — copy from the Supabase dashboard and **URL-encode the password** (`@`→`%40` etc.) or the driver fails to parse.
- Seed categories come from `supabase/seed.sql`; the dev admin (`admin@example.com`) is seeded by the [[Backend]] on boot.
- **NO** Supabase Auth / Functions / Realtime / RLS / Vault — all logic stays in the [[Backend]] for portability. RLS is OFF; the service key never leaves the server.
- The repo is **linked in the Supabase dashboard (repo connect)**, so pushing `supabase/migrations/*.sql` auto-applies to the DB — this replaced the deleted custom migration workflow.

Related: [[Backend]], [[Rules-and-Conventions]], [[Architecture]].
