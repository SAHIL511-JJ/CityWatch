# Architecture

System diagram in words: [[Mobile]] (Flutter) and [[Frontend-CRM]] (Next.js) are thin clients that only ever talk to the [[Backend]] (FastAPI). The [[Backend]] owns all reads/writes to the [[Database]] (Supabase Postgres+PostGIS) and all photo traffic to Supabase Storage. The [[AI-Pipeline]] runs beside the API as a Celery worker fed by an Upstash Redis queue.

```
Flutter app ──JWT──▶ FastAPI ──service key──▶ Supabase Postgres+PostGIS
     │                  │  ▲                         ▲
     │                  │  │ Celery+Redis            │ photos
     │                  ▼  │ worker                  ▼
     │            Google Gemini ◀──text+photo── Supabase Storage (incident-photos)
     │
Next.js CRM ──staff JWT──▶ FastAPI (same API, /admin/*)
```

## Request flows

- **Citizen submit** — [[Mobile]] sends `multipart/form-data` to `POST /incidents` ([[Backend]] validates jpg/png ≤8MB, row starts as `processing`, photo uploaded App→Backend→Storage, `STATUS_HISTORY` row with `changed_by=NULL`).
- **AI triage** — [[Backend]] best-effort enqueues Celery; the [[AI-Pipeline]] worker calls Gemini, gets `is_legitimate/category/severity/confidence/reason`, and flips status to `verified` / `rejected` / `needs_review`. Staff can force the same path synchronously via `POST /admin/incidents/{id}/analyze`.
- **Feed** — `GET /incidents` returns `verified` rows only, filtered in Python by severity, `ai_analysis.category`, and haversine radius (PostGIS `ST_DWithin` is a TODO).
- **Moderation** — ops use [[Frontend-CRM]] detail view → `PATCH /admin/incidents/{id}` (status/severity/assign) → every change appended to `STATUS_HISTORY`; notes via `POST /admin/incidents/{id}/notes`.

## Hosting map

| Piece | Where | Status |
|---|---|---|
| [[Backend]] + Celery worker | Render | planned (runs locally on :8000 today) |
| Queue | Upstash Redis | planned (no-Redis boot degrades gracefully) |
| [[Database]] + photos | Supabase | live (repo-linked, migrations auto-apply) |
| [[Frontend-CRM]] | Vercel | planned (runs locally on :3000 today) |
| [[Mobile]] | citizen devices | scaffold only |
| Push | Firebase Cloud Messaging | stub (`send_fcm_stub` logs unless `FCM_CRED_JSON` set) |

Related: [[Backend]], [[Frontend-CRM]], [[Mobile]], [[Database]], [[AI-Pipeline]], [[Rules-and-Conventions]], [[Decisions-Log]].
