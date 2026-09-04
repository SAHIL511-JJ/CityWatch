# AI-Pipeline

Fully-automated triage in `apps/backend/app/worker.py`: every submitted report gets a legitimacy/category/severity verdict that gates the public feed. Runs on the Render worker (Celery + Upstash Redis); staff can trigger the same path synchronously from the [[Frontend-CRM]] via `POST /admin/incidents/{id}/analyze`.

## Direct Google Gemini (NOT OpenRouter)

We call Google's `generativelanguage` REST API directly with `GEMINI_API_KEY` (free tier from `aistudio.google.com`, no card) — **~1500 requests/day** vs OpenRouter's ~50/day free tier. No extra SDK package; plain `httpx` POST with `responseMimeType: application/json`.

## Model

`GEMINI_MODEL=gemini-3.6-flash` (vision-capable). `gemini-2.0-flash` is retired — if calls start failing, hit the list-models endpoint to pick the current flash model and update `apps/backend/.env`.

## JSON contract

Prompt (`GEMINI_PROMPT`) demands JSON only: `{is_legitimate: bool, category: crime|fire|accident|hazard|other, severity: low|medium|high|critical, confidence: 0–1, reason: short string}`. Photo is the main proof (base64 `inline_data`), text is a hint; out-of-range categories/severities are clamped, confidence clamped to 0–1. Status mapping: not-legitimate → `rejected`; confidence ≥0.7 → `verified`; else → `needs_review`.

## Fake-stub fallback (incl. 503 case)

No key, or any Gemini failure (including **503** model-overloaded errors) → `fake_ai` keyword stub (fire/crash/crime/hazard keywords, else low-confidence `other` → `needs_review`), so nothing ever breaks the submit path. `run_ai` prints the Gemini error and falls through; the [[Backend]] enqueue is non-blocking regardless.

## Full crash-photo E2E proof

A real crash photo submitted end-to-end returned **accident / critical / 85%**, with the `reason` quoting the visible collision evidence — proving the text+photo path, the JSON contract parse, and the status update all work against the live model. Re-verify any time from the [[Frontend-CRM]] detail view (run analysis) or `POST /admin/incidents/{id}/analyze`.

Related: [[Backend]], testing notes in [[Index]], [[Frontend-CRM]], [[Database]].
