# CRM navigation responsiveness — implementation plan

## 1. Objective

Make CityWatch CRM navigation feel immediate: a click must acknowledge itself at once, the destination must render a deliberate loading layout while its fresh data is requested, and slow/empty/error results must be distinguishable. This document is the implementation specification and handoff for the completed CRM responsiveness layer; the source changes listed below are the behavioral authority.

## 2. Current state

The CRM is a Next.js 14 App Router application in `apps/crm`. `app/layout.tsx` keeps `Providers` and the client-side `Shell` mounted around all pages. The shell owns the sidebar, header, and most primary navigation links in `components/sidebar.tsx`; it currently uses ordinary `next/link` links and has no route-pending state.

Each CRM page fetches fresh data from FastAPI through `lib/api.ts::apiFetch`, with the staff JWT in browser local storage. `app/providers.tsx` creates one default TanStack Query client for the tab. There is no app-level `app/loading.tsx`, no shared navigation-progress component, and no persisted read cache. Thus, a full browser reload remains a fresh API read; this change must not introduce Redis or browser persistence as a way to hide the delay.

Loading coverage is currently uneven:

- `app/page.tsx` has a dashboard-wide skeleton while the summary request loads, plus local loading states for recent incidents and hotspots.
- `app/incidents/page.tsx`, `app/users/page.tsx`, `app/staff/page.tsx`, `app/analytics/page.tsx`, and `app/analytics/[signalId]/page.tsx` have some skeleton or empty/error states.
- `app/incidents/[id]/page.tsx::IncidentDetailPage` returns only plain `Loading…`, raw red error text, and `Not found`; it does not preserve the CRM visual language during navigation.
- The incidents page has a minimal `<Suspense fallback={<p>Loading incidents…</p>}>` before its richer query skeleton can mount.
- Insights filters replace the URL and request new data, but do not retain previous results while the next scope is loading. Map-point selection waits for `GET /admin/incidents/{id}` without a selected-record loading state.

All queried data continues through FastAPI. The relevant read routes are `/admin/analytics/summary`, `/admin/incidents`, `/admin/analytics/hotspots`, `/admin/users`, `/admin/staff`, `/admin/insights`, and `/admin/incidents/{id}`. No database migration, Storage change, or API contract change is needed.

## 3. Scope

In scope:

- Immediate, non-blocking feedback for every internal CRM route navigation: sidebar, header review-queue link, dashboard links, incident links, Insights links, detail back links, login success, and sign-out.
- Route-level and page-level skeletons that keep the fixed shell visible and match the existing cream, dark-green, white-card, Verdana design system.
- Clear loading, refreshing, empty, and error states for all five top-level modules and both detail routes.
- Keeping previous visible results during incident-scope and Insights-filter refreshes, with an explicit “updating” signal.
- Focused Playwright regression coverage plus real API and headed CRM verification.

Out of scope:

- Redis, browser-persistent, CDN, or backend response caching.
- Changes to FastAPI route shapes, authentication, database schema, migrations, or Supabase.
- Redesigning dashboard content, adding new pages, changing the existing incident workflow, or mobile CRM work.
- Claiming lower backend latency without measuring it separately. This plan improves feedback and continuity; it must not disguise a slow API as a successful load.

## 4. Facts, assumptions, and blockers

### Confirmed facts

- `apiFetch` redirects the browser to `/login` on a `401`, throws for other non-2xx responses, and has no cache behavior (`apps/crm/lib/api.ts`).
- The existing `QueryClient` has no defaults configured (`apps/crm/app/providers.tsx`), so TanStack Query uses its library defaults.
- The CRM already has reusable `Card`, `FeedbackPanel`, `Button`, and `PageHeader` components under `apps/crm/components/ui/`.
- Existing dashboard UI tests mock API responses in `apps/crm/tests/kan43-dashboard-kpis.spec.ts`; they do not test delayed navigation or loading feedback.
- The shared `Shell` remains mounted across page changes, so it is the correct place for an app-wide route indicator.

### Working assumptions

- “Anything” means internal CRM navigation and filter/pagination changes, not long-running moderation mutations. Existing button pending states for login and mutations remain in place.
- A short, visible route-progress bar plus `aria-live` announcement is preferable to a blocking fullscreen spinner. It keeps the current page usable until the route fallback or destination skeleton renders.
- Keep fresh reads. For a changed incident/Insights scope, temporarily displaying the previous valid response marked as “Updating…” is acceptable; it is better than showing an empty screen and does not label prior results as the new scope.
- One failed query should report its error promptly. Configure the shared query client to retry once with a short delay, rather than silently holding a skeleton through the default multi-retry sequence. Queries explicitly marked `retry: false` must retain that per-query behavior.

### Blockers/questions

None. The implementation can proceed with the above behavior.

## 5. Acceptance criteria

1. On a normal left-click of any internal CRM navigation target, the clicked control visibly acknowledges the action and a non-blocking global status appears before the destination route is ready. Modified clicks, middle clicks, external URLs, downloads, and `_blank` links retain browser-native behavior and must not start a false loading state.
2. On a deliberately delayed route/data request, the sidebar/header remain visible and the destination shows a page-shaped skeleton or labelled loading state—not a blank cream content area or only unstyled text.
3. Every top-level module has mutually exclusive initial loading, error, empty, and populated states. A failed request uses `FeedbackPanel` with a usable retry action where a retry is valid.
4. The incident detail page uses a structural skeleton, a `FeedbackPanel` error state, and an empty/not-found state that offers a route back to Incidents; it must never return bare text as its whole UI.
5. Changing incident filters/page or Insights scope keeps the prior data visible only while it is clearly labelled “Updating…” and visually busy. It must replace it with the new results, an empty state, or an error once the request resolves. A first load still uses skeletons.
6. Map-point selection shows an in-context evidence-loading state while its detail request is pending; a failed selection shows a local recoverable message without clearing the selected map marker.
7. Freshness and authorization are unchanged: requests still go to the same FastAPI endpoints with the current JWT, a full reload still fetches fresh data, and no direct Supabase/browser or Redis read is introduced.
8. Desktop acceptance covers Dashboard, Incidents, Users, Staff, Insights, incident detail, and signal evidence with delayed, successful, empty, and error responses where applicable. No horizontal overflow or modal-style overlay may prevent normal page interaction.

## 6. Change map

| Path | Existing symbol/region or `new file` | Purpose | Required change |
|---|---|---|---|
| `apps/crm/app/providers.tsx` | `Providers` | Own shared query and navigation state | Add the navigation-feedback provider and safe query defaults (`retry: 1`, short retry delay); do not configure persistent caching. |
| `apps/crm/components/ui/navigation-link.tsx` | `new file` | Central internal-link behavior | Wrap `next/link`; begin route feedback only for an unmodified same-window internal click; preserve Link props and caller `onClick`. |
| `apps/crm/components/ui/navigation-feedback.tsx` | `new file` | Shared state and UI | Provide `beginNavigation`, clear state when the expected pathname/search commits or after a guarded timeout, render an accessible thin progress bar/status, and expose pending destination state to links. |
| `apps/crm/app/loading.tsx` | `new file` | App Router fallback | Render a structured CRM content skeleton inside the existing shell while a route segment is loading. |
| `apps/crm/components/sidebar.tsx` | `Shell` | Primary route feedback | Replace sidebar and header queue `Link`s with `NavigationLink`; begin feedback before imperative sign-out navigation; show pending icon/text without disabling navigation. |
| `apps/crm/app/page.tsx` | `DashboardPage` and dashboard links | Dashboard continuity | Use `NavigationLink`; replace the all-or-nothing summary early return with page-shaped loading/error regions so the title and local panels remain deliberate. |
| `apps/crm/app/incidents/page.tsx` | `IncidentsPage`, `IncidentsInner` | Queue continuity | Replace the plain Suspense fallback; use `keepPreviousData` for scope changes; surface `isFetching` as an updating state and use `NavigationLink` for detail links. |
| `apps/crm/app/incidents/[id]/page.tsx` | `IncidentDetailPage` | Detail loading/error quality | Add `IncidentDetailSkeleton`, `FeedbackPanel` error/not-found states, and navigation-aware back links; preserve non-blocking staff/duplicate side queries. |
| `apps/crm/app/users/page.tsx` | `UsersPage` | Consistent list state | Retain current skeleton/empty/error behavior; only use shared query defaults and, if required, add retry action to the existing error panel. |
| `apps/crm/app/staff/page.tsx` | `StaffPage` | Consistent list state | Add a retry action and replace the queue link with `NavigationLink`; leave staff data contract unchanged. |
| `apps/crm/app/analytics/page.tsx` | `AnalyticsPageContent` | Insights scope feedback | Use `keepPreviousData`; label prior data as updating during scope changes; add selected-point loading/error UI; replace internal links. |
| `apps/crm/app/analytics/[signalId]/page.tsx` | `InsightEvidencePageContent` | Evidence navigation | Replace imperative back navigation with the shared feedback path or call `beginNavigation` before `router.push`; replace internal links. |
| `apps/crm/app/login/page.tsx` | `onSubmit` | Login hand-off | Begin route feedback only after token storage succeeds and immediately before `router.push("/")`; do not show navigation feedback for a failed login. |
| `apps/crm/tests/navigation-feedback.spec.ts` | `new file` | UI regression coverage | Test delayed navigation feedback, structured detail loading, filter updating continuity, empty/error states, and modified-click safety. |
| `apps/crm/tests/kan43-dashboard-kpis.spec.ts` | existing dashboard fixture | Preserve dashboard contract | Update imports/routes only if shared navigation markup changes accessible link names; keep scoped-link assertions intact. |

Inspected and intentionally unchanged: `apps/crm/lib/api.ts`, FastAPI routes in `apps/backend/app/main.py`, all `supabase/migrations/`, and CRM environment configuration. This UI change must not alter them.

## 7. Ordered implementation steps

1. **Build the shared navigation-feedback contract.**
   - **Location:** create `components/ui/navigation-feedback.tsx`; wire it in `app/providers.tsx`.
   - **Change:** create a client context with `beginNavigation(href: string)`, `pendingHref`, and `isPending`. Normalize only same-origin CRM path/query targets. Watch `usePathname()` and `useSearchParams()`; clear the pending state after the expected target commits. Add a timeout cleanup (for example 10 seconds) so a failed/prevented transition cannot leave a permanent indicator.
   - **Contract:** `beginNavigation` is presentation-only; it does not call `router.push`, alter URL history, fetch data, or block input. Render one visually slim progress treatment in the shell plus a `role="status"`/`aria-live="polite"` message such as “Opening Incidents…”. Respect `prefers-reduced-motion` by removing indeterminate animation, not the status itself.
   - **Edge cases:** Do not announce when navigation targets the currently committed URL. Never clear a newer navigation when an older timeout fires; use a navigation id/token. Do not cover the header/sidebar, trap focus, or use a modal backdrop.
   - **Verification:** component test if the repo has a compatible setup; otherwise cover through the Playwright cases in step 9.

2. **Create a safe shared internal link.**
   - **Location:** create `components/ui/navigation-link.tsx`; migrate every internal `Link` listed by `rg -n '<Link' apps/crm/app apps/crm/components`.
   - **Change:** wrap `next/link`. Call the caller's `onClick` first; begin feedback only when the event was not prevented, is button 0, has no Ctrl/Meta/Shift/Alt modifier, has no `target` other than the current tab, and `href` is an internal string route. Keep `prefetch` and all styling/callback props pass-through.
   - **Contract:** this is not a new routing API. Existing `href`, `scroll`, accessibility names, and keyboard behavior must remain compatible. Links can render a small spinner only when their exact href is pending; the global indicator covers all other links.
   - **Edge cases:** hash-only links (such as the incident duplicate anchor) must not trigger route feedback; the normal anchor scroll must remain intact. Do not change external links if any are added later.
   - **Verification:** run the test case for Ctrl-click/middle-click and assert the route-progress status never appears.

3. **Add App Router and page-shaped loading states.**
   - **Location:** create `app/loading.tsx`; update `app/page.tsx`, `app/incidents/page.tsx`, and `app/incidents/[id]/page.tsx`.
   - **Change:** `app/loading.tsx` should render a max-width Verdana content skeleton made of a header block, toolbar/card block, and several row/card blocks. It renders as `children` inside the already-mounted `Shell`; it must not duplicate sidebar/header markup. Replace the incidents Suspense paragraph with the same structured queue skeleton. Add an `IncidentDetailSkeleton` matching the current detail page’s header and evidence/map two-column grid; use it for first load.
   - **Contract:** skeleton blocks use existing neutral card surfaces, `aria-label` values such as “Loading incident details”, and no fabricated data. They must be the only initial-data state; do not show an empty state until a successful response has an empty result.
   - **Edge cases:** retain the desktop-first detail grid behaviour and avoid triggering photo or map requests from a skeleton. The app-level fallback is a safety net; individual pages remain responsible for data-specific states.
   - **Verification:** throttle/delay the incident-detail API request and confirm the shell and grid skeleton appear before the response resolves.

4. **Make dashboard loading independent and non-blocking.**
   - **Location:** `app/page.tsx::DashboardPage`.
   - **Change:** remove the early full-page return based only on `summary.isLoading`. Render the page heading immediately and put summary-derived regions behind their own skeleton/error treatment. Continue rendering the independently queried recent-activity and hotspot panels with their existing local states. Use `NavigationLink` for every internal dashboard link.
   - **Contract:** summary failure must show a retryable `FeedbackPanel` for KPI/summary content while recent incidents or hotspot data can still render. No endpoint, query key, 30-day scope, or KPI calculation changes.
   - **Edge cases:** do not calculate an empty dashboard as zero while `summary` is loading/error; only use zero/empty output after a successful empty response. Retain the dashboard's documented 30-day scopes.
   - **Verification:** delay only summary, then fail only summary; assert the page title is visible immediately and other successful panels are still usable.

5. **Preserve list results while scope data refreshes.**
   - **Location:** `app/incidents/page.tsx::IncidentsInner` and `app/analytics/page.tsx::AnalyticsPageContent`.
   - **Change:** import TanStack Query's v5 `keepPreviousData` and pass it as `placeholderData` to the scope-keyed incident and Insights queries. Render an `aria-live="polite"` “Updating queue…” or “Updating evidence…” marker when `isFetching` with placeholder/previous data. Keep first-load skeletons, success empty states, and error states distinct. Add an understated busy treatment to the affected result region; controls remain usable unless existing mutation logic disables them.
   - **Contract:** URL update semantics stay exactly as they are (`router.replace`, `scroll: false`). Previous results are never presented as matching the newly chosen filters: show the updating label adjacent to the active scope. Once the new request finishes, replace rather than merge results.
   - **Edge cases:** an empty successful replacement must remove stale rows; a failed replacement must show the error and offer retry rather than indefinitely retaining old rows with a false fresh label. Do not apply `keepPreviousData` to mutation responses.
   - **Verification:** mock a 1–2 second filter/scope response, change a dropdown/pagination control, and assert the old list stays visible with “Updating…” until the new response replaces it.

6. **Finish detail and map-selection feedback.**
   - **Location:** `app/incidents/[id]/page.tsx::IncidentDetailPage`; `app/analytics/page.tsx::selectPoint` and `SelectedPoint` rendering; `app/analytics/[signalId]/page.tsx::InsightEvidencePageContent`.
   - **Change:** replace bare detail error/not-found text with `FeedbackPanel` plus a `NavigationLink` back to `/incidents`. In Insights, track point-detail request state separately from `selectedPoint`; when a marker is selected, immediately render a compact selected-evidence skeleton. If it fails, retain the selected marker/category and render a local retry action for that exact incident request. Replace all in-app `Link`s with `NavigationLink`. For the signal-evidence Back button and login/sign-out imperative pushes, call the shared `beginNavigation` immediately before `router.push`.
   - **Contract:** detail permissions and FastAPI error responses remain unchanged. A 401 is still handled only by `apiFetch`; do not display a stale protected record after auth redirect begins.
   - **Edge cases:** a rapid second marker selection must ignore a late first response (use a request id or cancellation-aware query pattern). Preserve map zoom/marker identity and do not remount the map merely to show its side-panel state.
   - **Verification:** use delayed and failed point-detail routes; confirm marker selection remains visible, no blank sidebar appears, and retry retrieves the selected record.

7. **Calibrate retry behavior without caching data.**
   - **Location:** `app/providers.tsx::Providers`.
   - **Change:** construct `QueryClient` with `defaultOptions.queries.retry: 1` and a short capped retry delay (for example 300 ms) so an unreachable API becomes a visible error rather than prolonged unlabelled waiting. Leave `staleTime` at its existing effective zero value, leave browser persistence absent, and do not add a global `refetchOnWindowFocus` policy unless a measured test proves it necessary.
   - **Contract:** explicit per-query settings (`retry: false`, existing Insights `staleTime: 30000`) override global defaults. No query should be made less fresh by this step.
   - **Edge cases:** ensure manual Retry calls `refetch` and has visible pending feedback. Do not retry 401 redirects or mutations through this setting.
   - **Verification:** simulate a 500/connection failure and verify a `FeedbackPanel` appears after at most the single retry; confirm full reload still calls the API endpoints.

8. **Keep visual and accessibility behavior coherent.**
   - **Location:** every file changed above; `app/globals.css` only if a reduced-motion utility is needed.
   - **Change:** use the existing Verdana, dark green `#14231a`, green `#2a4a33`, cream `#faf7f0`, white-card, and focus-ring conventions. Use semantic live regions for changed loading text, avoid repeated announcements from nested skeletons, and give non-text indicators accessible labels.
   - **Contract:** the global indicator supplements, never replaces, the page-level loading/empty/error state. Avoid conflicting Tailwind color utilities because `lib/utils.ts::cn` is a plain join without Tailwind conflict resolution.
   - **Verification:** keyboard-tab through sidebar/link routes, check focus remains on the activated link until route content mounts, and run a reduced-motion browser pass.

9. **Add regression tests.**
   - **Location:** create `apps/crm/tests/navigation-feedback.spec.ts`; update the dashboard test only if needed.
   - **Change:** establish a fake staff token with `addInitScript`; mock the exact existing API URLs. Cover: sidebar navigation with delayed dashboard requests; dashboard-to-detail navigation with delayed incident data; incidents filter update retaining prior rows; Insights scope update and map-point loading; detail empty/error retry state; no feedback on modified click.
   - **Contract:** tests assert accessible output rather than implementation class names: current route, live status, labelled skeleton, “Updating…” text, `FeedbackPanel` title, and eventual replacement data.
   - **Edge cases:** route mocks must preserve query strings such as `window_days=30` and the staff-token authorization path. Do not replace existing KAN-43 scoped-link assertions with generic navigation tests.
   - **Verification:** run the focused test file and the existing dashboard/resolution suites against the local CRM after the backend is started.

## 8. Verification plan

All items below are **to run** during implementation; none have been run while creating this plan.

### Static checks and focused automated tests

| Priority | Command/procedure | Expected result |
|---|---|---|
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npm.cmd run lint` | No new lint errors. |
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npm.cmd run build` | Production build completes; App Router loading files and client components compile. |
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npx playwright test tests/navigation-feedback.spec.ts` | Delayed navigation, structured loading, updating continuity, error/empty state, and modified-click cases pass. |
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npx playwright test tests/kan43-dashboard-kpis.spec.ts tests/kan39-resolution-evidence.spec.ts` | Existing dashboard scopes and resolution-evidence behavior remain intact. |
| **Recommended** | Run `rg -n '<Link|router\\.(push|replace)' app components` and review each remaining result. | Every internal route change either uses `NavigationLink` or deliberately calls `beginNavigation`; same-page filter replacement is labelled locally. |

### Integration and real API checks

| Priority | Procedure | Expected result |
|---|---|---|
| **Must run** | Start exactly one backend on 8000 (no `--reload`) and one CRM on 3000. Confirm `GET http://localhost:8000/health` returns 200. | Correct local services are running; no duplicate listener. |
| **Must run** | Log in through the real CRM as staff, then use browser DevTools network or Playwright request inspection while navigating Dashboard → Incidents → one incident → Insights → one signal. | Existing authenticated FastAPI routes are called; no request goes directly from the CRM to Supabase or Redis. |
| **Must run** | With the real backend temporarily delayed through a local Playwright route interception only (not by modifying production API behavior), exercise each route. | The immediate route indicator and page-shaped loading states display before release of the delayed real response. |
| **Not applicable** | Database migration validation. | No schema, storage, or API change is planned. Do not create a migration. |

### Real user-flow and visual review

| Priority | Procedure | Expected result |
|---|---|---|
| **Must run** | Use headed Playwright CLI against `http://localhost:3000` with the real staff login. Click every sidebar destination, dashboard KPI/activity link, list detail link, signal link, back link, Review queue, and sign out/login path. | Each click receives immediate feedback; the page never appears frozen or blank; final destination and active sidebar state are correct. |
| **Must run** | Test initial loading, successful empty result, 500/network error, retry, and delayed replacement for Dashboard, Incidents, Users, Staff, Insights, incident detail, and signal detail. Capture full-page desktop screenshots or scroll each screen. | Loading/empty/error differences are obvious, consistent, readable, and fit the entire desktop page without horizontal overflow. |
| **Recommended** | Enable reduced motion and keyboard-only navigation. | Indicator does not rely solely on animation; focus ring and link behavior remain correct. |

## 9. Risks and rollback

| Risk | Guardrail | Rollback/recovery |
|---|---|---|
| Global indicator gets stuck after cancelled navigation | Route-match clear plus per-navigation token and timeout cleanup; test cancelled/modified clicks. | Remove the provider/link wrapper and restore ordinary `Link`s; no data migration is involved. |
| Previous results are mistaken for filtered results | Show “Updating…” beside the active scope and replace, never merge, on response. Keep first loads as skeletons. | Remove `placeholderData: keepPreviousData` from the two scope queries. |
| Global retry change makes a sensitive query behave unexpectedly | Limit it to one retry; preserve query-level `retry: false`; do not affect mutations. | Delete the `defaultOptions.queries` override. |
| Large link migration changes a non-route link | Review every remaining `Link`/imperative navigation search result and retain native hash/external behavior. | Revert only the affected caller to `next/link`. |
| UI polish masks an actual slow backend | Verification includes real endpoint requests and delayed-route tests. Report measured backend slowness separately rather than adding cache without approval. | No backend changes are part of this plan, so there is no data-plane rollback. |

## 10. Implementer handoff checklist

- [ ] Implemented only navigation feedback and loading-state continuity; no cache, migration, backend, or unrelated UI refactor was added.
- [ ] All internal navigation paths use the shared feedback mechanism or an intentional imperative equivalent.
- [ ] Initial loading, refreshing, empty, error, retry, and permission/401 behavior are distinct and accessible.
- [ ] Existing API URLs, JWT behavior, dashboard scopes, incident workflow, and map interaction contracts remain unchanged.
- [ ] Focused Playwright tests, existing relevant tests, build/lint, real API checks, and headed full-page CRM flows were completed or explicitly reported as not run.
- [ ] No secrets, direct Supabase/Redis access, generated screenshots, or unrelated worktree changes were introduced.
- [ ] Final report lists changed files, commands run, measured observations, and any remaining backend-latency risk.
