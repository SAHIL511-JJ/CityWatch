# Decisions-Log

Dated record of locked decisions. Context for each lives in the linked note.

- **2026-09-04 — Supabase-only for data.** Cloudflare D1 is SQLite-type with no PostGIS, so "near me" search is impossible there. Cloudflare only fronts external Postgres; it doesn't host it. → [[Database]], [[Architecture]]
- **2026-09-04 — No Supabase Auth.** Custom JWT (anonymous `device_id` + OTP stub) from day one; avoids lock-in, matches the trust-score model. → [[Backend]]
- **2026-09-04 — Photos via [[Backend]].** App → Backend → Storage so files are validated before they land; no direct app/CRM-to-Supabase writes. → [[Backend]], [[Rules-and-Conventions]]
- **2026-09-04 — Render + Upstash hosting.** [[Backend]] + worker on Render, Celery queue on Upstash Redis; Supabase can't run either. → [[Architecture]]
- **2026-09-04 — Gemini direct over OpenRouter.** ~1500 free req/day vs ~50/day; `gemini-3.6-flash` after `2.0-flash` retired. → [[AI-Pipeline]]
- **2026-09-04 — Esri over OSM/Carto.** Carto watermarks without an API key; Esri `World_Street_Map` is keyless and clean at our zooms (cap z18/native z17). → [[Frontend-CRM]]
- **2026-09-04 — Sidebar over topnav.** Ops console gets a grouped dark-green sidebar with a live `needs_review` badge instead of a top bar. → [[Frontend-CRM]]
- **2026-09-04 — Sync `/analyze` over Redis dependency.** `POST /admin/incidents/{id}/analyze` runs the same worker code inline so triage works with no Redis running. → [[Backend]], [[AI-Pipeline]]
- **2026-09-04 — `wt-*` mirrors dropped.** Worktree copies diverged; `apps/*` is the single source of truth. → [[Rules-and-Conventions]]

Related: [[Index]], [[Architecture]], [[Rules-and-Conventions]].
