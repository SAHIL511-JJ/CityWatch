"""Apply pending supabase/migrations/*.sql to the live DB, in filename order.

Tracks what's applied in public.schema_migrations so re-pushes are safe.
Then runs supabase/seed.sql (idempotent: ON CONFLICT DO NOTHING).

Env: SUPABASE_DB_URL_DIRECT (port 5432 direct link, from GitHub secret or local .env).
Usage: python scripts/apply_migrations.py
"""

import glob
import os
import sys

import psycopg2


def get_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL_DIRECT", "")
    if not url:
        # local fallback: read apps/backend/.env (never committed)
        for candidate in ("apps/backend/.env", "wt-backend/.env"):
            if os.path.exists(candidate):
                with open(candidate, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("SUPABASE_DB_URL_DIRECT="):
                            url = line.split("=", 1)[1].strip()
                            break
            if url:
                break
    if not url:
        print("SUPABASE_DB_URL_DIRECT is not set")
        sys.exit(1)
    return url.replace("postgresql+psycopg2://", "postgresql://", 1)


def main() -> None:
    conn = psycopg2.connect(get_url())
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        """CREATE TABLE IF NOT EXISTS public.schema_migrations
           (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())"""
    )
    cur.execute("SELECT filename FROM public.schema_migrations")
    applied = {r[0] for r in cur.fetchall()}

    files = sorted(glob.glob("supabase/migrations/*.sql"))
    if not files:
        print("no migration files found")
    for path in files:
        name = os.path.basename(path)
        if name in applied:
            print(f"skip {name} (already applied)")
            continue
        print(f"apply {name} ...")
        with open(path, encoding="utf-8") as f:
            cur.execute(f.read())
        cur.execute(
            "INSERT INTO public.schema_migrations (filename) VALUES (%s)", (name,)
        )
        print(f"done {name}")

    seed = "supabase/seed.sql"
    if os.path.exists(seed):
        print(f"apply {seed} (idempotent) ...")
        with open(seed, encoding="utf-8") as f:
            cur.execute(f.read())
        print("done seed")

    cur.close()
    conn.close()
    print("migrations up to date")


if __name__ == "__main__":
    main()
