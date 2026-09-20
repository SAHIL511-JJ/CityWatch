# CitiWatch demo fixture and verification (KAN-38)

This is a deliberately **shared-Supabase** demo path. CityWatch has one database, so it never creates a local, preview, or second demo database. The API writes only clearly marked records whose titles begin with `[CW-DEMO:KAN-38]`; it does not delete or alter other records.

## What the fixture proves

| Scenario | Location | Evidence |
| --- | --- | --- |
| Rising flooding signal | Riverside crossing (`18.6204, 73.9052`) | 3 verified reports across 14, 7, and 1 days ago from 3 contributors |
| Stable waste signal | Green Park (`18.5900, 73.8175`) | 4 verified reports across 12, 9, 5, and 2 days ago from 4 contributors |
| Isolated report | Library junction (`18.5633, 73.9622`) | 1 verified pothole report |
| Resolution loop | Market Lane (`18.5762, 73.9319`) | blocked-drain report with `processing → verified → resolved` history and staff resolution note |

Each report has a real environmental image fetched at seed time from Pexels through the API and stored by the normal backend storage layer. The evidence source pages are recorded in each demo report description; no image asset or secret is committed.

## Seed and API proof

1. Stop the old API and confirm port 8000 has no listener. Start exactly one API process with the fixture route explicitly enabled:

   ```powershell
   $env:ENABLE_DEMO_FIXTURES='true'
   Set-Location apps/backend
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

2. In a second terminal at the repository root, run:

   ```powershell
   apps\backend\.venv\Scripts\python.exe scripts\run_citiwatch_demo.py
   ```

The command logs in as local dev staff (or uses `CITYWATCH_ADMIN_EMAIL` and `CITYWATCH_ADMIN_PASSWORD`), requests the admin-only fixture API, then asserts the public awareness API contains the rising and stable signals and that the CRM API sees the isolated and resolved cases. A rerun returns the existing 9 marked reports without modifying them.

## Flutter web proof (Playwright CLI)

Start one Flutter web-server process on port 8080 against the local API:

```powershell
Set-Location apps/mobile
flutter run -d web-server --web-port 8080 --dart-define=API_URL=http://127.0.0.1:8000
```

Use `npx -y @playwright/cli@latest open http://localhost:8080`, enable Flutter semantics, then use manual location `18.6204, 73.9052` if browser location is denied. In Feed, verify the rising Flooding card (3 observations), open it, and open a related report. Change manual location to `18.5900, 73.8175` to verify the stable Waste card (4 observations). Confirm the console is clean with `npx -y @playwright/cli@latest console`.

## CRM proof (Playwright CLI)

Start one CRM process on port 3000 with `NEXT_PUBLIC_API_URL=http://localhost:8000`. Open `http://localhost:3000` with Playwright CLI, sign in using the configured local staff account, then:

1. In **Incidents**, search `[CW-DEMO:KAN-38]`; verify the Library junction report is verified and the Market Lane drain case is resolved.
2. Open the resolved drain case; verify its photo, resolution note, and `processing → verified → resolved` audit history.
3. In **Insights**, use the demo area; verify Flooding is rising and Waste is stable.
4. Finish with `playwright-cli console` and `playwright-cli requests`. Remove generated `.playwright-cli/` output after the demonstration.

## Known limitations and demo hygiene

- The fixture endpoint is unavailable unless `ENABLE_DEMO_FIXTURES=true` is set on the **local** API process; it is also protected by staff authentication.
- Source images are fetched from the network at first seed. If a source is unavailable, no database rows are committed; retry after connectivity recovers.
- Do not delete the fixture as part of routine checks. It is intentionally reusable, alongside the separately retained `[API-E2E 20260908]` records.
- Before presenting, confirm exactly one listener each for API `8000`, CRM `3000`, and Flutter `8080`, and remove generated Playwright output/screenshots.
