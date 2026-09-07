# Execution plan — incident reporter (Supabase-only)

Locked: Supabase for DB + photos (bucket `incident-photos`). No Supabase Auth. No Supabase Functions/Realtime/RLS. Photos via backend. Backend on Render + Upstash Redis. CRM on Vercel.

## Folder map (parallel worktrees)
- `supabase/migrations/` — SQL only. Enables postgis, creates tables, bucket notes.
- `apps/backend/` (+ mirror `wt-backend/`) — FastAPI + Celery + Upstash.
- `apps/crm/` (+ mirror `wt-crm/`) — Next.js CRM, talks to FastAPI only.
- `apps/mobile/` (+ mirror `wt-mobile/`) — Flutter app, talks to FastAPI only.

No direct app/CRM -> Supabase. Only backend uses service key.

## API contract (all WTs must match)
- `POST /auth/anonymous` {device_id} -> {token, user_id, verified:false}
- `POST /auth/send-code` {phone|email} -> {ok} (6-digit code, 10min expiry)
- `POST /auth/verify` {phone|email, code} -> {token, verified:true}
- `POST /incidents` multipart(title, description, lat, lng, address?, photo) + JWT -> {id, status:processing, photo_url}
- `GET /incidents?lat&lng&radius_km&severity&category` -> list verified only
- `GET /incidents/{id}` -> detail
- `GET /admin/incidents?status&severity` + `PATCH /admin/incidents/{id}` {status, severity} -> logs STATUS_HISTORY
- `POST /admin/incidents/{id}/notes` {note}
- `GET /admin/analytics/summary` {by_category, by_status, by_day}
- Staff: `POST /admin/login` {email, password} -> {token, role}

## WT1 — Supabase (first, unblocks rest)
Files: `supabase/migrations/001_init.sql`, `supabase/BUCKET.md`
- `create extension postgis;`
- Tables: users(id uuid, device_id text unique, phone, email, verified bool, trust_score float, fcm_token, alert_radius_km, min_severity, created_at), staff(id, email unique, password_hash, role), categories(id, name, icon), incidents(id, reporter_id->users, assigned_to->staff, title, description, photo_url, location geography(Point,4326), lat double, lng double, address, status, severity, ai_confidence, ai_analysis jsonb, created_at), incident_notes, status_history. GIST index on location. No RLS.
- Bucket `incident-photos` private. Backend-only write. Signed GET via backend.
- Acceptance: SQL runs clean on fresh Supabase project.

## WT2 — Backend (Render)
Files: `apps/backend/requirements.txt`, `app/main.py`, `app/config.py`, `app/db.py`, `app/models.py`, `app/auth.py`, `app/routes/*`, `app/worker.py`, `app/storage.py`, `alembic/`, `render.yaml`, `.env.example`
- Custom JWT (anonymous + verified flag). OTP codes in-memory/Redis for MVP (swap to table later). Trust score 0.5 anon / 0.8 verified.
- Upload: validate jpg/png <8MB -> Supabase Storage `incident-photos/{id}.jpg` via service key -> save photo_url.
- Worker: Celery + Redis. Fake AI stub now (`is_legitimate, category, severity, confidence`) with TODO to plug vision LLM. Update status verified/rejected/needs_review. Nearby query for FCM stub.
- Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL_POOLER, SUPABASE_DB_URL_DIRECT, JWT_SECRET, REDIS_URL, FCM_CRED_JSON, AI_API_KEY.
- Acceptance: `uvicorn` boots, `POST /auth/anonymous` + `POST /incidents` + `GET /incidents` work against Supabase Postgres/PostGIS and Supabase Storage.

## WT3 — CRM (Vercel)
Files: `apps/crm/` Next.js + Tailwind/shadcn, TanStack Query, react-leaflet, Recharts.
- Pages: /login, / (dashboard summary), /incidents, /incidents/[id] (approve/reject, severity edit, notes, assign, history), /users, /analytics (heatmap).
- All fetch via NEXT_PUBLIC_API_URL to FastAPI with staff JWT. No supabase-js.
- Acceptance: `npm run build` passes, review/override flow hits admin APIs.

## WT4 — Mobile (Flutter)
Files: `apps/mobile/` (pubspec: riverpod, flutter_map, geolocator, image_picker, dio, flutter_secure_storage, firebase_messaging).
- Screens: feed map/list, report (photo+text+gps), verify (enter code), settings (radius, severity).
- Dio client with baseUrl + JWT from secure storage. No supabase-flutter.
- Acceptance: `flutter analyze` passes (or scaffold compiles), submit flow matches POST /incidents contract.

## Merge + test (after WTs)
1. Copy wt-* mirrors into apps/* if diverged, resolve API contract mismatches.
2. Backend integration test: anonymous -> send-code -> verify -> submit incident (with test image) -> check Supabase row + Storage object -> admin override -> feed shows verified.
3. CRM `npm run build`, backend `pytest`/`ruff`, mobile `flutter analyze`.
4. Document remaining env + deploy steps in `DEPLOY.md`.
