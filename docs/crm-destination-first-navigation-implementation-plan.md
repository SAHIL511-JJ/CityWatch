# CRM destination-first navigation — implementation plan

## 1. Objective

Change CityWatch CRM navigation so an internal-page click leads to the destination route's existing loading UI, then its data, without the custom fixed-top **“Opening …”** message, top progress bar, or link spinner. This is a plan-only handoff for an implementer; do not implement it as part of this document.

## 2. Current state

The CRM is a Next.js 14 App Router application in `apps/crm`. `app/layout.tsx` keeps the client-side `Shell` mounted around route `children`; `app/providers.tsx` provides TanStack Query and currently wraps the app in `NavigationFeedbackProvider`.

The custom route-feedback path is:

1. A user clicks `NavigationLink`.
2. `components/ui/navigation-link.tsx::NavigationLink` calls `beginNavigation()` for an ordinary same-tab internal click, then delegates navigation to `next/link`.
3. `components/ui/navigation-feedback.tsx::NavigationFeedbackProvider` immediately renders a fixed top `role="status"` pill (“Opening {route}…”) and a progress bar. It clears only when `usePathname()` reaches the requested path or when its 10-second timeout fires.
4. The destination component subsequently mounts and starts its TanStack Query request.

The desired loading surfaces already exist and must be preserved:

- `apps/crm/app/loading.tsx` is the App Router route-segment fallback rendered inside the persistent shell.
- `apps/crm/app/incidents/[id]/page.tsx::IncidentDetailSkeleton` is returned while the incident detail query is initially loading.
- `apps/crm/app/incidents/page.tsx::QueuePageSkeleton` / `SkeletonRows`, `app/users/page.tsx`, `app/staff/page.tsx`, `app/analytics/page.tsx`, `app/analytics/[signalId]/page.tsx`, and `app/page.tsx` already own initial-data skeletons or labelled loading states.
- Existing React Query behaviour deliberately retains previous rows for incident and Insights scope changes using `placeholderData: keepPreviousData`; those are in-page refreshes, not full-page navigation, and correctly show “Updating …”.

`NavigationLink` is used by the sidebar and CRM page links. `components/sidebar.tsx::Shell` and `app/login/page.tsx` also call `useNavigationFeedback()` before imperative `router.push("/login")` and `router.push("/")` respectively. The focused test file is `apps/crm/tests/navigation-feedback.spec.ts`.

## 3. Scope

In scope:

- Remove the custom global navigation overlay, top progress bar, and per-link pending spinner from normal internal CRM navigation.
- Preserve native Next.js link navigation and the existing destination-specific/app-level skeletons.
- Preserve current local refresh feedback for incident and Insights filters/pagination (`Updating queue…` / `Updating evidence…`).
- Replace the obsolete navigation-feedback test with a real click-to-destination-skeleton regression test.

Out of scope:

- Changing FastAPI endpoints, authentication, database schema, Supabase, storage, or migrations.
- Adding caching, route prefetch hacks, artificial delays, a new loading library, or a redesign of any CRM screen.
- Changing mutation loading states, login form feedback, or the dynamic map component's own loading placeholder.
- Reworking every `NavigationLink` import into direct `next/link` imports in this ticket; keep the thin compatibility component to avoid a broad, unrelated edit.

## 4. Facts, assumptions, and blockers

### Confirmed facts

- The top feedback is custom application code, not Next.js router UI: `navigation-feedback.tsx` renders the fixed top element itself.
- `NavigationLink` does not block navigation; it invokes `beginNavigation()` before rendering the underlying `next/link` behaviour.
- `app/loading.tsx` and the incident-detail structural skeleton already exist in the current source.
- `navigation-feedback.tsx` currently has four direct source imports: `app/providers.tsx` supplies its provider; `components/sidebar.tsx`, `app/login/page.tsx`, and `components/ui/navigation-link.tsx` consume its public helpers.
- Current source has an existing focused Playwright test that delays `GET /admin/incidents/incident-1` and asserts `Loading incident details` during a direct navigation.

### Working assumptions

- Sahil's requested interaction means no custom page-opening message or full-width top progress treatment. The page-level skeleton is the sole primary loading feedback for a route click.
- A thin no-op `NavigationLink` compatibility component is acceptable for this narrowly scoped change. It keeps all existing links, props, accessibility labels, hash navigation, modifier clicks, and Next.js prefetch behaviour intact without editing every calling page.
- Existing `app/loading.tsx` plus the individual query skeletons are sufficient; route-specific new `loading.tsx` files are not necessary unless the acceptance test proves a route reaches a blank content state.

### Blockers/questions

None. The requested outcome supports the minimal design above.

## 5. Acceptance criteria

1. A normal left-click on a CRM internal navigation link never shows “Opening …”, a fixed top route-status pill, a top route progress bar, or an added spinner inside the clicked link.
2. From the Incidents list, clicking an incident with its detail request deliberately delayed commits to `/incidents/:id` and displays the labelled `Loading incident details` structural skeleton before the response is released.
3. Once the delayed detail response succeeds, the skeleton is replaced by the real incident content; it does not remain visible, flash a blank content region, or duplicate the sidebar/header.
4. Initial route loading still has a generic content fallback through `app/loading.tsx` if a destination route module is not ready; page-specific query skeletons continue to own data-loading presentation after the page mounts.
5. Existing same-page scope refresh behaviour remains unchanged: Incident and Insights filters/pagination retain their current in-page “Updating …” indicators and previous-result continuity.
6. Sign-in and sign-out still navigate to their existing destinations, with their current form/button feedback but no custom global route overlay.
7. No API request URL, authentication mechanism, database change, migration, cache/persistence setting, or direct Supabase client call is added or changed.

## 6. Change map

| Path | Existing symbol/region or `new file` | Purpose | Required change |
|---|---|---|---|
| `apps/crm/app/providers.tsx` | `Providers` | Remove global route-feedback ownership | Remove the `NavigationFeedbackProvider` import and wrapper; retain the existing `QueryClientProvider` and its query defaults exactly as they are. |
| `apps/crm/components/ui/navigation-feedback.tsx` | whole file | Obsolete custom top overlay | Delete the file after all imports/callers have been removed. |
| `apps/crm/components/ui/navigation-link.tsx` | `NavigationLink` | Preserve caller compatibility without pending UI | Simplify to a transparent, typed wrapper around `next/link`; remove feedback imports, click interception, `aria-busy`, and spinner markup. |
| `apps/crm/components/sidebar.tsx` | `Shell`, `signOut` | Remove imperative feedback dependency | Remove `useNavigationFeedback`/`beginNavigation`; keep `router.push("/login")` and all existing `NavigationLink` uses. |
| `apps/crm/app/login/page.tsx` | login submit success path | Remove imperative feedback dependency | Remove `useNavigationFeedback`/`beginNavigation`; after successful token storage retain the existing `router.push("/")` flow. |
| `apps/crm/tests/navigation-feedback.spec.ts` | route-feedback cases | Regression proof for requested UX | Replace tests that assert top feedback or its modifier-click suppression with a click-driven delayed-detail skeleton test. Retain/reuse realistic mocked shared reads. |
| `apps/crm/app/loading.tsx` | `Loading` | Existing fallback, inspected | No code change planned. Do not duplicate the shell or turn it into a global overlay. |
| `apps/crm/app/incidents/[id]/page.tsx` | `IncidentDetailSkeleton` | Existing target skeleton, inspected | No code change planned unless the regression test exposes a real blank-state defect. |
| `apps/crm/app/incidents/page.tsx`, `app/analytics/page.tsx` | `keepPreviousData` / updating UI | Existing in-page refresh semantics, inspected | No code change planned; these must remain untouched by the route-feedback removal. |

## 7. Ordered implementation steps

1. **Remove the provider from the application tree.**
   - **Location:** `apps/crm/app/providers.tsx::Providers`.
   - **Change:** Delete the `NavigationFeedbackProvider` import and render `{children}` directly inside the existing `QueryClientProvider`.
   - **Contract:** The current `QueryClient` instance, its `retry: 1` and `retryDelay` defaults, and all query behaviour must remain unchanged. This step must not alter data fetching or introduce a provider replacement.
   - **Edge cases:** Confirm `/login` still renders normally: `Shell` already special-cases it based on pathname and does not require the feedback context.
   - **Verification:** TypeScript/build check must show no remaining provider/context dependency from `Providers`.

2. **Make internal links transparent again.**
   - **Location:** `apps/crm/components/ui/navigation-link.tsx::NavigationLink`.
   - **Change:** Replace the current stateful implementation with a typed pass-through to `next/link`. Preserve the current public props shape (`LinkProps` plus anchor attributes), `href`, `target`, `onClick`, children, `prefetch`, `scroll`, CSS classes, and all other caller props. Do not call `preventDefault`, inspect modifiers, set `aria-busy`, or append spinner markup.
   - **Contract:** `NavigationLink` must behave like `next/link` for regular, Ctrl/Cmd-click, middle-click, target-blank, hash, and external-link use cases. It owns no pending state and renders no loading UI.
   - **Edge cases:** Keep a caller-provided `onClick` attached exactly once. Hash links such as `/incidents/:id#duplicates` must retain native scrolling and must not show any route-specific feedback.
   - **Verification:** Search `apps/crm` for `aria-busy`, `Opening `, and `navigation-progress`; none should remain as route-navigation UI after this step.

3. **Remove the two imperative feedback calls and delete its implementation.**
   - **Location:** `apps/crm/components/sidebar.tsx::Shell`/`signOut`; `apps/crm/app/login/page.tsx` login submit handler; `apps/crm/components/ui/navigation-feedback.tsx`.
   - **Change:** Delete each `useNavigationFeedback` import and `beginNavigation(...)` call. Leave the existing `router.push` calls in their current order relative to token clearing/storage. Once no imports remain, delete `navigation-feedback.tsx`.
   - **Contract:** Sign-out still clears the token before routing to `/login`. Successful sign-in still stores the token before routing to `/`. A failed sign-in must retain its existing local error/button feedback and must not navigate.
   - **Edge cases:** Do not replace `router.push` with a full browser reload; Next.js client navigation is required for the existing shell and destination loading behaviour.
   - **Verification:** `rg -n "useNavigationFeedback|beginNavigation|NavigationFeedbackProvider|navigation-feedback" apps/crm` returns no source imports or usages (apart from deliberately removed-file references in generated artefacts, which must not be committed).

4. **Prove destination-first loading through an interaction test.**
   - **Location:** `apps/crm/tests/navigation-feedback.spec.ts`.
   - **Change:** Keep the realistic staff session/shared API mocks. Create an incidents-list response containing `incident-1`, delay `GET /admin/incidents/incident-1` with a promise gate, then:
     1. visit `/incidents` and wait for the `Blocked drain` link;
     2. click that link (do not use `page.goto` for the destination);
     3. assert the URL reaches `/incidents/incident-1` and `getByLabel("Loading incident details")` is visible before releasing the response;
     4. assert no element contains the prior “Opening Incident detail…” route status or top progress UI;
     5. release the request and assert `Blocked drain` is visible as detail content.
   - **Contract:** The test must validate user-visible accessibility output, not implementation class names or React context internals. It must not rely on a fixed sleep.
   - **Edge cases:** Ensure the delayed detail route is registered before clicking. Preserve any test that covers meaningful data-loading behaviour; remove only the obsolete assertion that modified clicks avoid the global indicator.
   - **Verification:** The focused Playwright command in section 8 passes reliably with the request held and released.

5. **Run the regression guard and visually confirm no blank route state.**
   - **Location:** no source change.
   - **Change:** Use the existing CRM loading surfaces as-is. If the click-driven test or manual browser run finds a blank content region between the click and `IncidentDetailSkeleton`, stop and add a narrowly scoped follow-up plan for the affected Next.js segment; do not add speculative route files pre-emptively.
   - **Contract:** `app/loading.tsx` remains a fallback, while page components remain the owner of data-specific skeletons. Do not remove the existing `keepPreviousData` flow for filter changes.
   - **Edge cases:** On an already-prefetched route, the destination may appear so quickly that a skeleton is not perceptible; that is valid. The important condition is no global “Opening…” overlay and no blank/half-rendered destination during a genuinely slow request.
   - **Verification:** Follow the real UI procedure in section 8 with a delayed request.

## 8. Verification plan

All checks below are **to run** during implementation; none have been run while writing this plan.

### Static checks and focused automated tests

| Priority | Command/procedure | Expected result |
|---|---|---|
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npm.cmd run lint` | No new lint errors. |
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npm.cmd run build` | Next.js builds after provider and component deletion. |
| **Must run** | `Set-Location C:\incident_reporter\apps\crm; npx playwright test tests/navigation-feedback.spec.ts` | The delayed click displays the detail skeleton and never displays “Opening …”. |
| **Recommended** | `rg -n "Opening |navigation-progress|useNavigationFeedback|beginNavigation|NavigationFeedbackProvider" apps/crm/app apps/crm/components` | No custom global route-feedback implementation remains. |
| **Recommended** | `Set-Location C:\incident_reporter\apps\crm; npx playwright test` | Existing CRM UI tests remain compatible with transparent `NavigationLink` behaviour. |

### Integration and database checks

| Priority | Procedure | Expected result |
|---|---|---|
| **Not applicable** | Migration, table, bucket, or index verification. | This plan does not change the data plane. Do not create a migration. |
| **Not applicable** | API contract changes. | CRM calls continue using existing `apiFetch` routes and tokens without source changes in `lib/api.ts`. |

### Real user-flow/UI checks

| Priority | Procedure | Expected result |
|---|---|---|
| **Must run** | With exactly one CRM process on port 3000 and the configured backend available, sign in and navigate Dashboard → Incidents → incident detail → Insights → evidence detail → back. | Each destination either appears immediately or displays its own page skeleton; no “Opening …” pill/progress line/link spinner appears. |
| **Must run** | In a local headed Playwright run, intercept only the incident-detail API response after clicking a real Incidents-list link; release it after the skeleton is visibly present. | The persistent shell remains visible, the incident-detail structural skeleton occupies the content area, and the data replaces it after release. |
| **Recommended** | Change Incident filters/page and Insights filters after initial data is visible. | Existing “Updating queue…” / “Updating evidence…” local feedback remains; this is not replaced by a route-level skeleton. |
| **Recommended** | Ctrl/Cmd-click an internal link and open a hash duplicate link. | Native new-tab/hash behaviour still works; no custom loading UI exists to interfere. |

## 9. Risks and rollback

| Risk | Guardrail | Rollback/recovery |
|---|---|---|
| A destination exposes a genuine blank gap once the overlay is gone | The interaction test delays real destination data and the manual headed test inspects the transition. Do not assume the generic fallback is enough without that proof. | Restore the four deleted/simplified feedback files from the last known commit only if a separately-approved replacement cannot be completed. Prefer a targeted route `loading.tsx` fix instead of restoring the overlay. |
| Simplifying `NavigationLink` accidentally drops a `next/link` prop or caller click handler | Preserve the current prop intersection and pass through all props. Test normal links, a hash link, and modified click behaviour. | Revert only `navigation-link.tsx`; it has no data or migration impact. |
| Existing filter-refresh messaging gets removed during cleanup | The scope explicitly leaves `app/incidents/page.tsx` and `app/analytics/page.tsx` untouched. | Revert the unrelated page edit; no provider change is needed to restore it. |
| Login/sign-out stops navigating after context removal | Retain the current `router.push` and token-order logic, removing only `beginNavigation`. | Restore the two removed imports/calls or fix the direct router call; no server-side recovery is needed. |

No destructive data operation, deployment, API migration, or rollback migration is involved.

## 10. Implementer handoff checklist

- [ ] Removed only the custom global route-feedback mechanism; did not redesign or rewrite existing page skeletons.
- [ ] `NavigationLink` still behaves as a normal `next/link` for all existing callers and preserves their props/callbacks.
- [ ] Sign-in, sign-out, hash links, and current incident/Insights in-page refresh feedback still work.
- [ ] The click-driven delayed-detail test proves skeleton-before-data and absence of “Opening …”.
- [ ] Lint, build, focused Playwright, and the real headed CRM flow were run or explicitly reported as not run.
- [ ] No backend/API/database/Supabase/cache changes, secrets, generated artefacts, or unrelated refactors were introduced.
- [ ] Final report lists changed files, commands run, the UI-flow result, and any remaining blank-state observation.
