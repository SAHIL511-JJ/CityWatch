# KAN-42, KAN-43, KAN-44, KAN-56 — Dashboard UX and Shared CRM Patterns Implementation Plan

## 1. Objective

Implement the next CityWatch CRM UX batch for a cheaper implementation model:

1. **KAN-56** — establish shared information hierarchy and accessible interaction patterns.
2. **KAN-42** — make the command overview action-first.
3. **KAN-43** — clarify KPI definitions and ensure every KPI opens its exact incident set.
4. **KAN-44** — make recurring environmental signals compact and comparable.

This is a **plan-only** artifact. It must be followed without adding a browser-to-Supabase path, a database migration, or unrelated visual refactors.

## 2. Current state

### CRM structure

- `apps/crm/components/sidebar.tsx` owns the authenticated application shell, including the sticky navigation, top breadcrumb/header, and the current `Review` navigation item. The shell currently renders an `h1` in its breadcrumb while some page bodies render another `h1`; this creates inconsistent page-heading ownership.
- `apps/crm/app/page.tsx` is the dashboard. It calls:
  - `GET /admin/analytics/summary` as `AnalyticsSummary`;
  - `GET /admin/incidents` as `AdminIncidentPage` for the latest-activity feed;
  - `GET /admin/analytics/hotspots?limit=6` as `Hotspot[]` for recurring signals.
- The dashboard calculates overdue and breaching counts locally with `slaFor()` in `apps/crm/lib/sla.ts`, but only from the first page of the `/admin/incidents` response. That means the current alert and oldest-item link are not authoritative whenever more than one page exists.
- The dashboard KPI cards are static `Card` elements. `Needs attention` currently sums six statuses in the browser; `Resolved` sums `resolved` and `community_confirmed`; all cards read an all-time summary, while the headline refers to recent reported days. The cards are not clickable.
- The recurring-signal dashboard area is a grid of verbose cards. Each card displays the score, counts, trend, and two lines of explanation. The detailed evidence and action plan already have a dedicated destination at `apps/crm/app/analytics/[signalId]/page.tsx`.
- `apps/crm/app/analytics/page.tsx` already has a URL-backed insights scope, reusable filter-chip behavior, a 7/30/90-day selector, and clear keyboard focus styling. It is the best visual reference for the shared-page patterns, not a source to rewrite wholesale.
- `apps/crm/app/incidents/page.tsx` already has URL-backed filters, active chips, loading/empty/error states, 25-item pagination, and bulk confirmations. Its local scope currently supports `q`, `status`, `severity`, `queue`, `sort`, and `page`.
- `apps/crm/app/users/page.tsx` and `apps/crm/app/staff/page.tsx` still rely on their shell title and use page-local controls/state panels. KAN-56 should align their hierarchy and feedback treatment, but **must not implement KAN-48 through KAN-53 behavior** in this batch.

### Backend structure

- `apps/backend/app/main.py` defines `GET /admin/incidents` through `admin_list`, which already applies validated server-side `q`, `status`, `severity`, `queue`, `sort`, pagination, and a database SLA rank for `sort=action`.
- `_clean_incident_scope`, `_apply_incident_scope`, `_incident_action_rank`, and `_order_incidents` in that file are shared by the list and filtered bulk endpoint. Any new list filter must be added to both paths so a selected filtered scope remains authoritative.
- `GET /admin/analytics/summary` in `main.py` groups all incidents by status, severity, category, and creation day. It currently has no time-window parameter and returns no authoritative action/SLA counts.
- `GET /admin/analytics/hotspots` defaults to a 30-day window. `apps/backend/app/hotspots.py::detect_hotspots` already sorts by descending `persistence_score`, then category and deterministic signal ID.
- No schema change is needed. All information needed by this batch exists in `incidents`; use FastAPI and SQLAlchemy only.

### Existing visual conventions to preserve

- Verdana typography, cream page background (`#faf7f0`), dark-green primary actions (`#14231a`), pale green operational surfaces, modest rounded cards, and visible dark-green focus rings.
- `Card`, `Button`, `Badge`, and `Input` live in `apps/crm/components/ui/`.
- The CRM already uses React Query and `apiFetch()` from `apps/crm/lib/api.ts`; continue to invalidate/query through that layer.

## 3. Scope

### In scope

- A lightweight shared CRM page-header and primary page-feedback pattern, documented in the component layer and adopted by the five top-level modules: Dashboard, Incidents, Users, Staff, and Insights.
- A persistent, accessible Review queue link in the global authenticated shell, with a visible compact label at narrow widths.
- A 30-calendar-day dashboard scope used consistently for dashboard KPIs, action counts, charts, latest activity, recurring signals, labels, and KPI destinations.
- Server-authoritative dashboard action counts: overdue, breaching, needs review, and needs follow-up.
- Optional incident-list query parameters needed to represent an exact dashboard destination: `window_days`, `state`, and `sla`.
- A dominant dashboard Needs action section with direct queue links, followed by clickable, clearly defined KPI cards.
- A compact recurring-signal list on the dashboard, with no default explanation prose and one evidence-detail action per row.
- Focused backend tests, TypeScript/build checks, real FastAPI checks, and headed Playwright **CLI** verification.

### Explicit non-goals

- No database migration, data backfill, storage change, or direct database write from the CRM.
- No redesign of the Insights map, signal evidence detail page, incident detail workflow, users table behavior, staff assignment behavior, or mobile app.
- Do not implement KAN-48, KAN-49, KAN-50, KAN-51, KAN-52, or KAN-53 as side work. Only use their pages for KAN-56 layout/feedback consistency.
- Do not add a page-size picker, a new dashboard date selector, new incident lifecycle statuses, or new bulk actions.
- Do not use `@playwright/test` as the acceptance verifier. The required browser verification is the headed Playwright CLI against the real CRM and configured FastAPI backend.

## 4. Facts, assumptions, and blockers

### Confirmed facts

- `GET /admin/incidents` is paginated and returns `{ items, total, page, page_size, total_pages }`.
- The incident API's default result is sorted newest-first and has no date filter. The dashboard currently receives only the default first page for its feed and local SLA calculation.
- The backend already knows the SLA budgets used by the CRM: critical 1 hour, high 4 hours, medium 24 hours, low 48 hours. The SQL ordering implementation exists in `_incident_action_rank`.
- The hotspot endpoint already uses a 30-day default and returns `persistence_score`, `trend`, `report_count`, `unique_contributors`, `last_observed`, and a stable signal ID that can be opened via `signalHref()` from `apps/crm/lib/insights.ts`.
- The only existing CRM Playwright spec is `apps/crm/tests/kan39-resolution-evidence.spec.ts`; it is mocked supporting coverage and not a substitute for real CLI testing.

### Working assumptions

- **Dashboard scope is fixed at the last 30 calendar days.** It matches the current hotspot default and keeps the first implementation small. The dashboard must visibly say `Last 30 calendar days`; do not suggest the result is all-time or an arbitrary set of reported days.
- **`Needs attention` means exactly these statuses:** `processing`, `needs_review`, `verified`, `awaiting_verification`, and `needs_follow_up`. `rejected`, `closed`, `resolved`, and `community_confirmed` are excluded. This retains the current dashboard calculation but makes it explicit and reusable.
- **`Resolved` means exactly `resolved` plus `community_confirmed`.** It deliberately does not count rejected or closed records.
- Dashboard KPI destinations must represent the same query set as their metric. That requires a small extension to the existing incident query instead of client-side filtering.
- The global Review queue link should target the actionable dashboard scope: `/incidents?state=needs_attention&sort=action&window_days=30`.

### Blockers/questions

None. The existing data and API ownership are sufficient for this implementation.

## 5. Acceptance criteria

### KAN-56 — shared CRM hierarchy and accessible interactions

- Each top-level CRM module has one body-level `h1`, a concise purpose/subtitle, the same maximum content width and spacing rhythm, and a predictable primary-action location where an action exists.
- The shell breadcrumb is no longer a competing `h1`.
- Dashboard, Incidents, Users, Staff, and Insights use the shared page-header pattern and a documented empty/error feedback pattern. Existing page-specific skeletons may remain where they show the real layout more accurately.
- New or changed primary/secondary controls have visible keyboard focus, disabled/pending states where asynchronous, and a clear success/error result.
- At 390px wide there is no horizontal page overflow, no duplicate page title, and the Review queue destination remains visibly reachable.

### KAN-42 — action-first command overview

- The first actionable dashboard region after the page heading is a visually dominant Needs action panel, before the KPIs and analytics.
- It shows authoritative counts for overdue, needs review, and optionally breaching/follow-up work only when nonzero; each card/link has a useful empty/zero state and a direct scoped incident destination.
- A Review queue action remains visible on desktop and narrow mobile through the global shell header; the dashboard panel also contains the relevant direct links.
- Reporting trend, status breakdown, category/severity context, and latest activity are visually secondary below the action-first area. They remain accessible; do not delete analytics.
- Dashboard loading, summary failure, no-action, and no-activity states are deliberate and do not leave blank sections.

### KAN-43 — KPI definitions and exact destinations

- All four KPI cards use the same `Last 30 calendar days` scope and render a short visible definition or accessible tooltip.
- Definitions match the backend query exactly:
  - Total incidents: every incident created in the 30-day scope.
  - Needs attention: the five explicit status values listed in the assumptions.
  - Resolved: `resolved` or `community_confirmed` in the scope.
  - Critical severity: incidents with `severity=critical` in the scope.
- Activating every KPI takes the user to `/incidents` with a shareable URL whose returned `total` equals the displayed KPI count.
- The current ambiguity between the Needs attention card and overdue alert is removed: overdue is a high-priority subset of Needs action, not a competing definition of Needs attention.

### KAN-44 — recurring-signal scanning

- The dashboard's default signal presentation is a compact list, not a prose-heavy card grid.
- Every visible signal shows category, priority/score plus trend, report count, contributor count, last observed time, and one `Open evidence` action.
- The dashboard does not render `Hotspot.explanation` by default. The explanation and full action plan remain on the existing evidence detail route.
- The section states the exact ranking rule: highest signal score first; equal scores follow the existing deterministic category and signal-ID tie break.
- The list is keyboard accessible and reflows into labeled compact rows on narrow screens without a horizontal scroll bar.

## 6. Change map

| Path | Existing symbol/region or `new file` | Purpose | Required change |
| --- | --- | --- | --- |
| `apps/backend/app/main.py` | `_clean_incident_scope`, `_apply_incident_scope`, `_incident_action_rank`, `admin_list`, `BulkFiltersIn`, bulk endpoint, `analytics` | Exact dashboard-to-list query contract and authoritative metrics | Add validated `window_days`, `state`, and `sla` filters to shared list/bulk scope; refactor SLA predicates for reuse; filter summary aggregates to 30 days; return action counts and scope metadata. |
| `apps/backend/tests/test_admin_dashboard.py` | `new file` | Regression coverage for summary and new incident scopes | Test summary window/action counts and list filters against a controlled database/test client fixture. |
| `apps/crm/lib/types.ts` | `AnalyticsSummary`, new incident scope types | Typed API contracts | Add `window_days` and `action_counts` to `AnalyticsSummary`; add `IncidentStateFilter` and `IncidentSlaFilter` if shared scope helpers need exported types. |
| `apps/crm/lib/incident-scope.ts` | `new file` | Single URL/query builder for incidents | Move/replace page-local parsing/query building with typed helpers for existing filters plus `window_days`, `state`, and `sla`. |
| `apps/crm/components/ui/page-header.tsx` | `new file` | Shared page information hierarchy | Render eyebrow (optional), body-level `h1`, description, optional metadata, and an action slot with responsive layout. Keep it small and presentational. |
| `apps/crm/components/ui/feedback-panel.tsx` | `new file` | Shared primary empty/error feedback | Provide a small accessible `empty`/`error` panel with title, description, and optional action. Do not replace layout-specific skeletons. |
| `apps/crm/components/ui/README.md` | `new file` | KAN-56 component-layer documentation | Document header, primary action, control, feedback, card, badge, focus, and responsive-density conventions. |
| `apps/crm/components/ui/button.tsx` | `Button` | Baseline keyboard treatment | Add the standard visible focus ring and focus offset without changing button semantics. |
| `apps/crm/components/sidebar.tsx` | `Shell`, breadcrumb/header | One heading owner and persistent review action | Replace breadcrumb `h1` with non-heading text; add a compact Review queue link to the global header that remains visible at narrow width. |
| `apps/crm/app/page.tsx` | `DashboardPage`, `Kpi`, recurring-signal section | KAN-42/43/44 behavior | Use the new summary contract/scope helpers; build action panel; make KPI cards exact links with definitions; replace signal cards with compact rows; move supporting analytics below/inside a secondary disclosure. |
| `apps/crm/app/incidents/page.tsx` | local `Scope`, `readScope`, `scopeQuery`, active chips, bulk payload | Dashboard-link consumer | Consume `incident-scope.ts`; preserve existing controls; render read-only chips/labels for dashboard-provided state/SLA/window scope; include all scope fields in filtered bulk payload. |
| `apps/crm/app/users/page.tsx` | `UsersPage` header and primary error/empty panels | KAN-56 adoption only | Add shared page header and feedback panel. Preserve current filtering, verification, ban, and undo behavior. |
| `apps/crm/app/staff/page.tsx` | `StaffPage` header and error/empty panels | KAN-56 adoption only | Add shared page header and feedback panel. Preserve current staff API and generic View queue behavior. |
| `apps/crm/app/analytics/page.tsx` | `AnalyticsPageContent` header and primary failure state | KAN-56 adoption only | Replace page-local heading/failure wrapper with shared patterns while retaining the existing map, filters, URL contract, and signal cards. |
| `apps/crm/app/analytics/[signalId]/page.tsx` | inspected intentionally | Existing detail destination | Do not redesign it. Its `signalHref()` destination remains the single place for explanation and action-plan detail. |
| `apps/backend/app/hotspots.py` | `detect_hotspots` | inspected intentionally | No change required if the UI labels its actual current sort rule: descending score, then category, then signal ID. Do not silently introduce a different tie-break rule. |
| `docs/KAN-42-43-44-56-dashboard-ux-implementation-plan.md` | this file | Handoff | Keep this plan current only if implementation reveals a real contract change. |

## 7. Ordered implementation steps

### 1. Establish the exact incident-scope vocabulary

**Location:** `apps/crm/lib/incident-scope.ts` (new), `apps/crm/lib/types.ts`, and `apps/crm/app/incidents/page.tsx`.

**Change:** Create a small shared helper module rather than making dashboard links duplicate the incident page's local URL logic.

Use this URL contract in addition to the existing list parameters:

| Parameter | Allowed values | Default | Meaning |
| --- | --- | --- | --- |
| `window_days` | integer `1..365` | omitted for normal list; `30` from dashboard | Incidents created at or after the rolling UTC cutoff. |
| `state` | `needs_attention`, `resolved` | omitted | A named multi-status scope defined in section 4. |
| `sla` | `overdue`, `breaching` | omitted | Non-terminal incidents whose age is past the existing SLA threshold. |

Retain the existing `q`, `status`, `severity`, `queue`, `sort`, and `page` parameters unchanged.

**Contract:**

- `status` and `state` are mutually exclusive. The backend returns HTTP 422 if both are supplied; the CRM helper never deliberately creates that combination.
- `sla` may be combined with `state=needs_attention`, but it cannot be combined with `state=resolved`; return 422 for that impossible combination.
- `window_days` is optional to preserve current all-time incident-list behavior. It is always present for dashboard links.
- `readIncidentScope()` must safely ignore malformed client URL values and use defaults; the backend remains the authority and returns 422 for malformed API requests.
- The helper must build URLs with the current fixed list page size of 25 and must make it possible to create a dashboard link without needing React hooks.

**Edge cases:** clear all must remove the read-only dashboard scope as well as normal filters; a copied KPI URL must survive refresh; an empty filtered list must show the active `Last 30 days`, state, and SLA chips.

**Verification:** Type-check a small table of URL inputs/outputs manually or in a focused TypeScript unit helper if the repository adds a unit-test runner. At minimum, verify the generated Total, Needs attention, Resolved, Critical, Review, and Overdue URLs are deterministic strings.

### 2. Extend the FastAPI incident query and filtered-bulk scope

**Location:** `apps/backend/app/main.py` at `_clean_incident_scope`, `_apply_incident_scope`, `_incident_action_rank`, `admin_list`, `BulkFiltersIn`, and the filtered branch of `admin_bulk`.

**Change:** Add `window_days`, `state`, and `sla` to the single validated scope model used by both `GET /admin/incidents` and `POST /admin/incidents/bulk` with `scope="filtered"`.

Refactor the existing SLA SQL expressions into small helpers, for example:

```python
def _incident_overdue_clause():
    # existing 1h / 4h / 24h / 48h thresholds

def _incident_breaching_clause():
    # existing 75%-of-budget thresholds
```

Use the helpers both for `sort=action` and `sla` filtering. For an SLA filter, always exclude terminal statuses (`resolved`, `community_confirmed`, `closed`) before applying the age predicate.

**Contract:**

- `state=needs_attention` filters to exactly the six statuses named in section 4.
- `state=resolved` filters to exactly `resolved` and `community_confirmed`.
- `window_days=N` applies `Incident.created_at >= now_utc - timedelta(days=N)` in the database query before `count`, sort, and pagination.
- The same filter model is accepted inside `BulkFiltersIn`; a filtered bulk action from a dashboard-derived list must act on the same set shown in the list, not the all-time set.
- Existing clients without the new parameters retain their previous response shape and all-time filtering behavior.

**Edge cases:** page correction after a mutation still works with the new filters; `sla=overdue&state=needs_attention` returns only overdue matching items; a terminal incident is never returned by an SLA scope; invalid state/SLA values get a clear 422.

**Verification:** Add endpoint tests before dashboard UI work. Confirm list `total` and rows are filtered before pagination, and confirm filtered bulk receives the extended filters unchanged.

### 3. Make the dashboard summary authoritative and windowed

**Location:** `apps/backend/app/main.py::analytics`, `apps/crm/lib/types.ts`.

**Change:** Change the summary endpoint to accept `window_days: int = Query(30, ge=1, le=365)` and execute every status, severity, category, and daily aggregate against one base incident query constrained by that cutoff.

Add these response fields without removing existing fields:

```json
{
  "window_days": 30,
  "action_counts": {
    "overdue": 0,
    "breaching": 0,
    "needs_review": 0,
    "needs_follow_up": 0
  }
}
```

Use the same defined status sets and SLA predicates from step 2. Do not derive action counts from an arbitrary `page_size` result in the CRM.

**Contract:**

- `total`, `by_status`, `by_severity`, `by_category`, `by_day`, and `action_counts` all describe the same rolling `window_days` scope.
- `by_day` remains sorted ascending and sparse only when a day has no report; the dashboard text must say calendar days, not reported days.
- `action_counts.overdue` and `.breaching` are non-terminal only. `needs_review` and `needs_follow_up` are exact status counts in the same time scope.

**Edge cases:** an empty scope returns zeros and empty arrays, not `null`; an invalid window gets 422; a day with zero reports does not cause chart math or sparkline failures.

**Verification:** test the action-count result against controlled critical/high/medium/low timestamps and status combinations; test a record outside the time window is excluded from every aggregate and KPI count.

### 4. Add the KAN-56 shared page and feedback patterns

**Location:** `apps/crm/components/ui/page-header.tsx` (new), `apps/crm/components/ui/feedback-panel.tsx` (new), `apps/crm/components/ui/README.md` (new), `apps/crm/components/ui/button.tsx`, `apps/crm/components/sidebar.tsx`, and the five top-level page components.

**Change:** Keep the abstraction narrow:

- `PageHeader` owns the body-level heading: optional eyebrow, one `h1`, a description, optional small metadata, and an optional action node. It must stack cleanly below `lg` and never hide action text on a 390px screen.
- `FeedbackPanel` owns only primary empty/error states. It accepts a variant, title, description, and optional action. Existing skeleton shapes remain local because they mirror each page layout.
- `README.md` documents the component contract and concrete conventions: page width (`mx-auto max-w-[1500px]`), `space-y-6`, primary action placement, control focus styles, feedback states, card density, and mobile no-overflow rule.
- Add the dark-green focus ring/focus offset to shared `Button`. Preserve its existing disabled semantics and color defaults.
- In `Shell`, change the breadcrumb title element from `h1` to a styled non-heading element. Add a header `Link` to the Review queue URL from section 4. At narrow widths it may show `Review`, but it must remain visible text plus an accessible label.
- Adopt the shared header on Dashboard, Incidents, Users, Staff, and Insights. Use the feedback panel for their primary error/empty state where it fits. Do not force map/signal subpanels into the generic component.

**Contract:** page body owns one `h1`; shell owns navigation/breadcrumb only. A primary action must be a native `button` or `Link`, have a visible focus indicator, and report real request state. Existing mutation flows in Users and Incidents stay intact.

**Edge cases:** the sidebar stays usable at 390px; long user/staff/email content does not push the header action off-screen; the login route still bypasses the authenticated shell.

**Verification:** inspect all five top-level routes at desktop and 390px. Use Tab navigation to confirm focus is visible on the shared Review link, page actions, filter controls, and feedback-panel actions.

### 5. Recompose the dashboard around the action-first flow (KAN-42)

**Location:** `apps/crm/app/page.tsx`.

**Change:**

1. Query `/admin/analytics/summary?window_days=30` and `/admin/incidents?window_days=30&page_size=6` (plus an explicit `sort=newest` if the scope helper emits it) so summary and activity use the same visible date window.
2. Delete the local loop that calculates `sla` from `recent.data.items`. Use `summary.data.action_counts` exclusively for action counts.
3. Immediately after `PageHeader`, render a `Needs action` region with a strong but existing-brand green/cream surface. It must show:
   - Overdue count -> `/incidents?window_days=30&state=needs_attention&sla=overdue&sort=action`.
   - Needs review count -> `/incidents?window_days=30&status=needs_review&sort=action`.
   - Show breaching/follow-up as compact supporting counts only when nonzero; their links use the same scope contract.
4. If every count is zero, replace urgency language with a calm `No incident needs immediate action` state and keep the global Review link available.
5. Keep the KPI row below this panel. Move chart/status/category/latest-activity material below the action and signal sections, or place it inside a clearly labeled closed-by-default `Operational context` disclosure. Do not remove data.
6. Ensure dashboard failure shows a retryable `FeedbackPanel`; hotspots failure remains a local non-blocking signal-state message so the action area stays usable.

**Contract:** all action counts and their destination totals are server-authoritative in the same 30-day window. No dashboard action requires a mutation or exposes raw API errors without a retry path.

**Edge cases:** no incidents, action count zero, summary loaded while activity is still loading, hotspot request fails while summary succeeds, and dashboard header wraps on narrow width.

**Verification:** compare each visible action count to the corresponding live incident-list total after following its CTA. Confirm action/signal chart content is below the primary action region and can still be reached with keyboard navigation.

### 6. Make KPI definitions and navigation exact (KAN-43)

**Location:** `apps/crm/app/page.tsx`, `apps/crm/lib/incident-scope.ts`, and `apps/crm/app/incidents/page.tsx`.

**Change:** Extend the local `Kpi` component with `definition` and `href` inputs. Render it as one focusable link/card with an explicit `Open matching incidents` affordance (visible or screen-reader text), not as a non-interactive card with a nested link.

Use these destinations:

| KPI | Definition | Destination |
| --- | --- | --- |
| Total incidents | Every incident created in the last 30 calendar days | `/incidents?window_days=30` |
| Needs attention | The six active workflow statuses from section 4 | `/incidents?window_days=30&state=needs_attention&sort=action` |
| Resolved | `resolved` or `community_confirmed` in the same window | `/incidents?window_days=30&state=resolved` |
| Critical severity | Critical incidents in the same window | `/incidents?window_days=30&severity=critical&sort=action` |

Render `Last 30 calendar days` once in the dashboard header/action area and use concise secondary text on each KPI to define its number. The definition text must be available without hover; a `title` or tooltip may supplement it but cannot be the sole explanation.

In the incident list, show removable/read-only active chips for `Last 30 days`, `State: Needs attention`/`Resolved`, and `SLA: Overdue`/`Breaching`. There is no new top-level control for these three filters in this ticket; they exist to make shared dashboard URLs understandable and clearable.

**Contract:** the rendered number must equal the `total` returned by its target URL under the same authenticated staff account, before any user changes list filters.

**Edge cases:** a zero KPI is still focusable and opens an understandable empty state; malformed manually edited KPI URLs receive backend 422 rather than silently changing their meaning; Clear all returns to the existing all-time incidents default.

**Verification:** use live browser requests or FastAPI responses to record each dashboard metric and its target `total`; they must match one-for-one.

### 7. Replace dashboard signal cards with a compact comparison list (KAN-44)

**Location:** `apps/crm/app/page.tsx`; import `DEFAULT_FILTERS` and `signalHref` from `apps/crm/lib/insights.ts`.

**Change:** Replace the current `sm:grid-cols-2 xl:grid-cols-3` signal-card grid with a semantic list or grid-row layout.

Desktop row fields, in this order:

1. Category.
2. Priority: score plus trend.
3. Reports.
4. Contributors.
5. Last observed.
6. `Open evidence` action, generated with `signalHref(spot.id, { ...DEFAULT_FILTERS, window_days: 30 })`.

Above the rows, state: `Ranked by signal score (highest first); equal scores use category and stable signal ID.` Keep `Open analytics` as a secondary action, but give it the same 30-day scope. Do not render `spot.explanation` or `InsightActionPlan` in the default dashboard list.

On narrow screens, each row must turn into a labeled two-column metadata block below the category/action line. Do not build a native table that forces horizontal scrolling.

**Contract:** preserve the server order from `/admin/analytics/hotspots?limit=6`; do not re-sort in the client and accidentally contradict the stated tie break. The evidence link must preserve the 30-day signal scope.

**Edge cases:** no hotspots, hotspot fetch error, one signal, a long category label, long localized last-observed date, and score ties.

**Verification:** inspect server order and UI order for a live response; open every row's evidence link and confirm it resolves to the existing signal detail. At 390px, confirm all six row fields remain readable without horizontal overflow.

### 8. Add focused regression coverage and perform required real verification

**Location:** `apps/backend/tests/test_admin_dashboard.py` (new) and no new mocked CRM Playwright spec unless explicitly requested later.

**Change:** Add backend coverage following the existing `unittest`/`TestClient` style in `apps/backend/tests/test_insights_filters.py` and `test_resolution_evidence.py`.

Test at minimum:

- summary defaults to/accepts a 30-day window and excludes older records from every aggregate;
- summary action counts distinguish overdue, breaching, needs-review, follow-up, and terminal records;
- each `state` scope returns exactly its documented statuses;
- `window_days`, `state`, and `sla` apply before list count/pagination;
- invalid state/SLA values and incompatible `status + state` / `resolved + sla` combinations return 422;
- a filtered bulk scope receives/uses the new filters rather than widening to all-time results.

Do not report UI acceptance from mocks. The earlier user direction requires Playwright CLI only for UI verification.

**Verification:** run the static/backend checks and the live API/browser matrix in section 8 below before claiming completion.

## 8. Verification plan

### Static checks and focused backend tests — **must run**

Prerequisite: use the repository-configured backend Python environment; do not start another backend process.

1. From `apps/backend`, run:

   ```powershell
   python -m unittest tests.test_admin_dashboard -q
   python -m unittest tests.test_insights_filters tests.test_resolution_evidence -q
   ```

   Expected: every test passes. If the project test discovery needs a different module path, preserve the existing test style rather than adding a second test framework.

2. From `apps/crm`, run:

   ```powershell
   npx tsc --noEmit
   npm run build
   ```

   Expected: type-check and production build pass. Build success is not UI acceptance.

3. Run `git diff --check` from the repository root. Expected: no whitespace errors in files changed for this batch.

### Migration and data-plane checks — **not applicable**

- No migration, new table, storage bucket, RLS change, or backfill is expected.
- Confirm this remains true before declaring the work complete. If implementation discovers a schema need, stop and add a new timestamped migration rather than applying an ad-hoc database change.

### Real FastAPI checks — **must run**

Prerequisite: manually restart the single backend after backend edits. Never use `--reload`; verify exactly one listener on port 8000 and no leftover `spawn_main` workers.

Authenticate as a real test staff account and make authenticated requests against the configured backend. Do not place credentials/tokens in the repository.

1. `GET /admin/analytics/summary?window_days=30`: record `total`, all four KPI inputs, and action counts.
2. For each KPI target URL, call `GET /admin/incidents` and confirm its `total` equals the dashboard card:
   - `?window_days=30`
   - `?window_days=30&state=needs_attention&sort=action`
   - `?window_days=30&state=resolved`
   - `?window_days=30&severity=critical&sort=action`
3. Check action destinations:
   - `?window_days=30&state=needs_attention&sla=overdue&sort=action`
   - `?window_days=30&status=needs_review&sort=action`
4. Confirm invalid values return 422 and missing optional values retain existing list behavior.
5. If filtered bulk is exercised, use a dedicated safe test scope and confirm server `matched` equals the list scope; do not bulk-edit live citizen reports merely to verify this plan.

### Real headed Playwright CLI checks — **must run**

Use the documented `npx -y @playwright/cli@latest` headed workflow against the actual running CRM and real backend. Do not use mocked routes or the Playwright test runner as the final proof.

1. Log in as staff and open the dashboard at 1280px width. Confirm one visible body heading, `Last 30 calendar days`, the Needs action region above KPI cards, and the persistent Review queue control.
2. Record each KPI value, open it, and confirm the URL chips and result summary describe the same scope. Use browser requests or API responses to verify matching totals.
3. Open each Needs action CTA. Confirm overdue, review, and follow-up destinations show the intended filter chips and `sort=action` where specified.
4. Return to dashboard and verify the recurring-signal list has all six fields, no default explanation text, stated sort rule, and working evidence links.
5. Open the supporting context disclosure/section and ensure charts/latest activity are still reachable without competing with the primary action area.
6. Repeat dashboard, incident-list target, and Review queue checks at 768px and 390px. Inspect `document.documentElement.scrollWidth` against `clientWidth`; they must be equal. Confirm no clipped CTA, inaccessible sidebar control, or overlapping header elements.
7. Use keyboard Tab through the persistent Review control, KPI cards, action links, list filters, and one signal evidence link. Each focus target must be visibly indicated.
8. Inspect browser console and failed requests. Resolve new console errors and feature-related request failures before completion.

## 9. Risks and rollback

| Risk | Guardrail | Rollback/recovery |
| --- | --- | --- |
| Dashboard card count differs from its list destination | Keep the status/SLA/date logic server-owned and reuse one named scope contract. Verify all four live totals before release. | Revert the dashboard link/UI commit and the optional scope extension together; no data change is involved. |
| A new incident filter changes filtered bulk behavior unexpectedly | Add fields to `BulkFiltersIn` and use the same backend helper; test a safe filtered selection before any real bulk action. | Stop using filtered bulk for that scope and revert the scope extension; existing explicit-ID bulk remains available. |
| Dashboard summary becomes expensive on larger datasets | Use SQL aggregation/filtering, not a fetch-all Python loop; inspect query behavior with realistic data. | Keep the fixed 30-day cutoff and remove nonessential aggregates before increasing page queries. |
| Shared header introduces duplicate or missing headings | Make the body page the sole `h1` owner and change the shell breadcrumb to non-heading text. Test all five routes. | Revert only the shared-header adoption while leaving API/dashboard work intact. |
| Narrow layout hides the global Review route | Keep a visible short text label (`Review`) at mobile width and test 390px explicitly. | Restore the existing sidebar route and remove the new header link only if necessary. |
| Signal ranking label diverges from backend order | Do not client-sort. State the actual `detect_hotspots` order documented in section 7. | Correct the label or make an explicit backend sort change with tests; never silently change one side. |

No operation in this batch is destructive or irreversible. No migration rollback plan is needed because no schema change is planned.

## 10. Implementer handoff checklist

- [ ] Read `AGENTS.md`, the CityWatch vault notes, and this plan before editing; preserve unrelated dirty files.
- [ ] Do not create a branch/worktree unless Sahil explicitly authorizes it.
- [ ] Implement only KAN-42, KAN-43, KAN-44, and KAN-56 scope; do not pull user/staff feature tickets into the batch.
- [ ] Keep CRM -> FastAPI -> Supabase ownership; add no direct browser data-plane access and no migration unless a verified schema need appears.
- [ ] Ensure the dashboard summary, KPI card, incident-list URL, visible chips, and filtered-bulk scope all describe the same set of records.
- [ ] Preserve existing page interactions and add visible focus/pending/error behavior for changed controls.
- [ ] Run focused backend tests, TypeScript check, production build, real API checks, and headed Playwright CLI desktop/mobile flow; clearly report anything not run.
- [ ] Before reporting completion, list changed files, exact verification commands/journeys, API totals checked, no migration decision, and any remaining risks.
