# Backend

FastAPI service in `apps/backend` (`app/main.py`), port 8000. Talks to the [[Database]] via SQLAlchemy and to Storage via a service-key helper. Secrets live in `apps/backend/.env` — never committed (see [[Rules-and-Conventions]]).

## Custom JWT auth (no Supabase Auth)

- `POST /auth/anonymous` `{device_id}` → JWT `{verified:false}`, trust **0.5** (`TRUST_ANON`). Creates the [[Database]] user row on first sight.
- `POST /auth/send-code` `{phone|email}` → 6-digit OTP stub, 10-min expiry (Redis `otp:{key}`, else in-memory); code printed to server log for MVP dev.
- `POST /auth/verify` `{phone|email, code}` → links user, JWT `{verified:true}`, trust **0.8** (`TRUST_VERIFIED`).
- `POST /admin/login` `{email,password}` → staff JWT `{role}` (roles: dispatcher/analyst/admin). Dev seed: `admin@example.com` / `admin123`.
- Banned citizens are rejected at report time with **403** (`get_current_user` checks `users.banned`).
- Tokens live 30 days (`JWT_EXPIRE_MIN`); citizen vs staff tokens distinguished by the `role` claim.

## Endpoints (method + path)

Auth: `POST /auth/anonymous`, `POST /auth/send-code`, `POST /auth/verify`.
Citizen: `POST /incidents` (multipart `title, description, lat, lng, address?, photo`), `GET /incidents?lat&lng&radius_km&severity&category&limit` (verified only), `GET /incidents/{id}`.
Admin: `POST /admin/login`, `GET /admin/incidents?status&severity`, `PATCH /admin/incidents/{id}` (`status/severity/assigned_to`, logs [[Database]] history), `GET /admin/incidents/{id}` (detail + reporter + notes + history), `POST /admin/incidents/{id}/notes`, `POST /admin/incidents/{id}/analyze` (sync AI, no Redis), `GET /admin/incidents/{id}/photo`, `GET /admin/users`, `PATCH /admin/users/{id}` (`verified/trust_score/banned`), `GET /admin/analytics/summary`, plus `GET /health` and static `/uploads`.

## Celery worker + sync fallback

- `app/worker.py`: `analyze_incident` task (Celery + `REDIS_URL`, `max_retries=3`) → `run_ai` → `apply_ai_result` (status + severity + `ai_confidence` + `ai_analysis`, trust ±0.02/−0.05, history row) → FCM stub for high/critical.
- `enqueue_analysis` is **non-blocking**: socket pre-checks Redis (1s timeout); if unreachable the request still returns and the row waits in `processing` until `POST /admin/incidents/{id}/analyze` runs the same code synchronously.

## Photos (Storage via service key, local fallback)

- `app/storage.py`: `SupabaseStorage` (bucket `incident-photos`, key `{incident_id}.jpg`) when service key set, else `LocalStorage` (`./uploads`); `R2Storage` is an unimplemented stub for a future move.
- `GET /admin/incidents/{id}/photo` serves the image: staff JWT accepted as `Authorization` header **or** `?token=` (because `<img>` can't send headers); Supabase keys 302-redirect to a signed URL, local files stream via `FileResponse`.

## CORS, analytics, live-Postgres bugs fixed

- CORS allows `http://localhost:3000` (+ `127.0.0.1:3000`), extendable via `CORS_ORIGINS`.
- `GET /admin/analytics/summary` returns `{total, by_category:[{name,count}], by_status:[{status,count}], by_severity:[{severity,count}], by_day:[{date,count}]}`.
- Bugs fixed against live Postgres: **UUID serialization** (all ids coerced with `str()` in `incident_out`), **`status_history` FK** (citizen-created rows use `changed_by=None`; migration `002` dropped the staff-only FK), **blocking Redis enqueue** (pre-check + swallow, never 500s the submit).

Related: [[Database]], [[AI-Pipeline]], [[Rules-and-Conventions]], [[Frontend-CRM]], [[Mobile]], [[Architecture]].
