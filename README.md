# CityWatch — citizen incident reporting

Snap a photo, report crime / hazards / city issues, browse verified reports on a map. AI checks every report, ops team reviews in the CRM.

- **App (Flutter)** `apps/mobile` — report with photo + GPS, map/list feed, code verification, alert settings
- **API (FastAPI)** `apps/backend` — custom JWT auth (anonymous device ID + phone/email code), incident CRUD, photo upload, Celery AI worker, nearby push
- **CRM (Next.js)** `apps/crm` — review/override AI, analytics + heatmap, users, assign, notes, audit trail
- **Data (Supabase only)** `supabase` — Postgres + PostGIS + Storage bucket `incident-photos`. No Supabase Auth / Functions / Realtime / RLS.

## Quick start

### 1. Supabase
Repo is linked in the Supabase dashboard (repo connect), so pushing
`supabase/migrations/*.sql` auto-applies to the DB. Manual fallback:
SQL Editor → run `supabase/migrations/*.sql` in order, then `supabase/seed.sql`.
Storage → private bucket `incident-photos` (needs service key for real
uploads; without it photos save to backend `./uploads`).

### 2. Backend
```bash
cd apps/backend
cp .env.example .env   # fill SUPABASE_*, JWT_SECRET, REDIS_URL, GEMINI_API_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload              # API on :8000
celery -A app.worker.celery worker --loglevel=info   # AI worker
```
Env: `SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL_POOLER, SUPABASE_DB_URL_DIRECT, JWT_SECRET, REDIS_URL, GEMINI_API_KEY, GEMINI_MODEL=gemini-3.6-flash, FCM_CRED_JSON, STORAGE_BUCKET`. Without keys it runs on sqlite + local `./uploads` + fake AI stub.

### 3. CRM
```bash
cd apps/crm
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm install && npm run dev    # :3000
```
Login with staff account (seed `admin@example.com` / `admin123` in dev).

### 4. Mobile
```bash
cd apps/mobile
flutter pub get && flutter analyze
```
Point `lib/config.dart` baseUrl at your API. Auth token stored in secure storage.

## AI (direct Google Gemini, free tier)
Get a key at `aistudio.google.com` → Get API key (no card). Set `GEMINI_API_KEY` + `GEMINI_MODEL=gemini-3.6-flash`. Worker sends text + photo, expects `{is_legitimate, category, severity, confidence, reason}` → sets `verified / rejected / needs_review`. No key = keyword stub so nothing breaks.

## API cheatsheet
`POST /auth/anonymous, POST /auth/send-code, POST /auth/verify, POST /incidents (multipart), GET /incidents?lat&lng&radius_km, GET /incidents/{id}, POST /admin/login, GET/PATCH /admin/incidents, POST /admin/incidents/{id}/notes, GET /admin/users, GET /admin/analytics/summary`

## Docs
- `incident_reporting_platform_plan.md` — full product + tech plan
- `EXECUTION_PLAN.md` — worktree contract + merge notes
- `supabase/BUCKET.md` — bucket setup

## Notes
- App/CRM never touch Supabase directly — only the backend uses the service key.
- `.env` files are gitignored. Photo helper is S3-style so a future R2 move is config-only.
