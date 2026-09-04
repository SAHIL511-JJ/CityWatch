# Migrations note (WT2)

Source of truth for DDL is WT1: `supabase/migrations/001_init.sql`
(PostGIS + tables + `incident-photos` bucket notes). This backend talks to
that schema via SQLAlchemy models in `app/models.py`.

Alembic here is a stub for the DIRECT-URL workflow:

1. Fill `.env` (`SUPABASE_DB_URL_DIRECT` = port 5432 link).
2. Generate first revision once WT1 SQL is final:
   `alembic revision --autogenerate -m "init from models"`
3. Apply: `alembic upgrade head`

Never point Alembic at the pooler URL (port 6543, transaction mode).
Runtime (`app/db.py`) uses the pooler URL; Alembic uses the direct URL.
