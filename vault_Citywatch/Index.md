# CityWatch — Docs Index

> CityWatch citizen incident reporting: Flutter + FastAPI + Next.js CRM + Supabase.
> Repo: `SAHIL511-JJ/CityWatch` · Live ports: API `8000`, CRM `3000`.

## Notes

- [[Architecture]] — system diagram in words, request flows, and hosting map.
- [[Backend]] — FastAPI auth, every endpoint, worker, storage, and live-Postgres bug fixes.
- [[Frontend-CRM]] — Next.js 14 ops console: modules, sidebar shell, detail view, maps.
- [[Mobile]] — Flutter scaffold status, gaps, and the API contract it must follow.
- [[Database]] — Supabase Postgres+PostGIS tables, migrations, and connection rules.
- [[AI-Pipeline]] — direct Google Gemini triage, JSON contract, stub fallback, E2E proof.
- [[Rules-and-Conventions]] — binding repo rules (auth, photos, env, git, dev servers).
- [[Playwright-Workflow]] — how we drive the CRM with the Playwright MCP live loop.
- [[Decisions-Log]] — dated record of every locked decision and why.
- [[Index]] — this hub (you are here).

## Quick orientation for a developer joining tomorrow

1. Read [[Architecture]] first, then [[Rules-and-Conventions]] (it bites if skipped).
2. Pick your surface: [[Backend]] (`apps/backend`, port 8000), [[Frontend-CRM]] (`apps/crm`, port 3000), or [[Mobile]] (`apps/mobile`).
3. Data lives in [[Database]]; triage logic in [[AI-Pipeline]]; past choices in [[Decisions-Log]].
4. Secrets go in `apps/backend/.env` — never in code, never in these notes.
