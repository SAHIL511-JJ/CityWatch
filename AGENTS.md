# AGENTS.md — CityWatch contributor guide

Read this before changing anything. Citizen incident reporting:
Flutter app + FastAPI backend + Next.js CRM + Supabase Postgres/PostGIS.
Repo: `SAHIL511-JJ/CityWatch`. Live local ports: API `8000`, CRM `3000`.

## Repo map

- `apps/backend/` — FastAPI + Celery worker (port 8000)
- `apps/crm/` — Next.js 14 CRM (port 3000, `NEXT_PUBLIC_API_URL=http://localhost:8000`)
- `apps/mobile/` — Flutter citizen app (scaffold; default API `http://10.0.2.2:8000`)
- `supabase/migrations/` — numbered SQL, applied in order; `supabase/seed.sql` categories
- `scripts/apply_migrations.py` — local migration runner fallback
- `vault_Citywatch/` — Obsidian notes, gitignored, never commit
- No `.cursor/rules`, `.cursorrules`, or copilot instructions exist; this file is canonical.

## Backend (`apps/backend`)

```bash
pip install -r requirements.txt
cp .env.example .env   # fill SUPABASE_*, JWT_SECRET, GEMINI_API_KEY
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
celery -A app.worker.celery worker --loglevel=info   # AI worker (needs REDIS_URL)
```

- Lint/typecheck: no ruff/mypy configured; at minimum run
  `python -m py_compile app/main.py app/worker.py app/auth.py app/config.py app/models.py app/storage.py`
  before pushing. Keep imports sorted stdlib → third-party → local.
- Tests: none exist yet. New tests go in `apps/backend/tests/test_<area>.py`
  (pytest style, plain `def test_*`, no classes). Run one with
  `pytest apps/backend/tests/test_auth.py::test_anonymous -q`.
  Until tests exist, prove backend changes with a live smoke script against
  dev (`:8000/health`, auth → submit → analyze → feed) and paste results.
- Dev server logs to a file; kill stale servers by port-owner PID before
  restarting or the old code keeps serving.

## CRM (`apps/crm`)

```bash
npm install                  # real install, never junctioned node_modules
npm run dev -- --port 3000   # use localhost, NOT 127.0.0.1 (chunk 403s)
npm run build                # must pass before push
npm run lint                 # next lint
npx tsc --noEmit             # strict TS (strict:true); fix all errors
```

- Path alias `@/*` maps to `apps/crm/*`. Shared fetch lives in `lib/api.ts`
  (`apiFetch`, `getToken`); shared shapes in `lib/types.ts` — extend them,
  don't inline response types in pages.
- Server components by default; `"use client"` only for interactivity
  (TanStack Query, leaflet, forms). Query keys: `["admin-incidents"]`,
  `["admin-incident", id]`, `["admin-users"]`; invalidate on mutation success.
- Leaflet maps must be dynamically imported with `ssr:false`
  (see `components/map.tsx`). Never import `leaflet` CSS outside `layout.tsx`.
- `<img>` tags need `// eslint-disable-next-line @next/next/no-img-element`.
- Favicons/icons go in `app/` (`icon.svg`); never leave console 404s.

## Mobile (`apps/mobile`)

```bash
flutter pub get
flutter analyze              # must be clean
flutter test                 # all tests
flutter test test/api_client_test.dart   # single file
```

- Dio client in `lib/api_client.dart` mirrors backend routes 1:1; no Supabase
  imports anywhere in the app. Secure storage holds the JWT only.

## Supabase / migrations

- Runtime uses the pooler session-mode URL (port 5432); migrations use the
  direct URL. Both in `apps/backend/.env`. URL-encode the DB password.
- New schema change = new file `supabase/migrations/00N_desc.sql` with
  `IF NOT EXISTS` guards (safe re-runs). Repo is dashboard-linked and
  auto-applies on push; local fallback: `python scripts/apply_migrations.py`.
- Seed is idempotent (`ON CONFLICT DO NOTHING`).

## Python style

- Type everything: `Mapped[...]`, `str | None`, return annotations on routes.
- All outgoing UUIDs coerced with `str()` (live Postgres returns UUID objects;
  JWT/query params need strings). Central rule: `create_token(str(sub))`.
- Pydantic `*In` models for every write body (`IncidentCreate` style not used;
  multipart for uploads). Validate enums (status/severity/category) explicitly.
- Errors: `HTTPException(404/401/403)` with short details, never stack traces
  to clients. Background work is best-effort: never let Redis/Gemini/FCM
  failures 500 a user request — degrade to stub/skip and log.
- Time: UTC ISO strings out (`...isoformat()`), `datetime.utcnow` in models.
- Naming: `admin_*` for staff routes, `fake_*` for stubs, `enqueue_*` for
  fire-and-forget queue calls. Env via `app/config.py` (`settings.X`) only.

## TypeScript/style

- `strict:true`. No `any` in new code; unknown JSON narrowed with guards.
- Components: `SectionTitle` pattern for card headings; `Badge` for every
  status/severity value (extend its color map, never raw colored spans).
- Buttons: disable while `mutation.isPending`; disable no-op actions
  (current status, unchanged select). No emojis in UI; inline SVG icons only.
- Leaflet: custom controls as components inside `MapContainer`
  (see `leaflet-controls.tsx`: `ZoomHandlers`, `FsButton`). Zoom caps are
  mandatory on every map: `maxZoom={18}` + `maxNativeZoom={17}` (past Esri
  coverage serves "Map Data Not Available" tiles). Remount maps by `key`
  when async data defines the view (center/fitBounds freeze at mount).
- Colors: sidebar `#14231a`, active `#2a4a33`, content bg `#faf7f0`,
  accent rust `#c2410c`. Cream/white cards, `rounded-xl`, zinc text scale.

## Git, secrets, architecture rules

- `.env` files never committed (gitignored at every depth). No keys, tokens,
  or passwords in code, docs, screenshots, or vault notes — ever.
- Commits: short imperative subject (`Add/Fix/Feat/Chore scope: ...`),
  one logical change each. Never commit `node_modules/`, `.next/`,
  `__pycache__/`, `*.log`, `.playwright-mcp/`, screenshots, or `wt-*/`.
- Data flows App → Backend → Supabase only. No direct app/CRM-to-Supabase
  traffic; no direct DB writes for data (APIs only; raw SQL for migrations).
- No Supabase Auth/Functions/Realtime/RLS. Custom JWT stays.

## Verifying CRM changes (mandatory)

Drive the real browser via Playwright MCP per change: navigate (localhost) →
snapshot (act on refs, never guessed CSS) → screenshot + Read the PNG →
console + network check. Measure with `evaluate`, don't eyeball.
Log in fresh each run (`admin@example.com` / `admin123`).
Gesture code needs trusted input (real keyboard+mouse), never synthetic
dispatch alone. Delete `.playwright-mcp/` output and stray screenshots after.
