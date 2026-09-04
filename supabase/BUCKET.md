# Storage bucket — `incident-photos`

Private bucket. Backend-only write with service key. Signed URLs via backend.

## Create (Supabase Dashboard)

1. Storage > New bucket > Name: `incident-photos` > Private: ON (Public: OFF) > Create.
2. No Storage policies / RLS needed — access is gated by FastAPI using the service key.
3. Do NOT make the bucket public. Do NOT add client-side upload policies.

## Backend use (only place that touches the bucket)

- Upload: `POST /incidents` validates jpg/png < 8 MB, then uploads bytes to `incident-photos/{incident_id}.jpg` with `SUPABASE_SERVICE_KEY`.
- Store resulting path (or `incident-photos/{id}.jpg`) in `incidents.photo_url`.
- Read: backend generates a short-lived signed URL (`create_signed_url`, ~60s–15min) for `GET /incidents` detail / worker AI fetch. App + CRM never use Supabase keys.
- Env needed on backend (Render): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

## Future R2 move

Keep object key format `incident-photos/{id}.jpg`. Swap only the upload helper (Supabase Storage call -> R2 S3 call). No app/CRM change.
