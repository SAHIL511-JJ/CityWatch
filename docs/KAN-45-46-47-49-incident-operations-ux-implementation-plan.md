# KAN-45, KAN-46, KAN-47, KAN-49 — Incident Operations UX Implementation Plan

This is an implementation contract for an agent working on the first CityWatch incident-operations UX batch:

1. **KAN-49** — Make filters and queue state understandable.
2. **KAN-45** — Redesign the incident list for triage scanning.
3. **KAN-46** — Add pagination and clear bulk-selection actions.
4. **KAN-47** — Turn resolution evidence into a guided task flow.

Implement in that order. KAN-49 defines the scope model, KAN-45 presents that scope, KAN-46 acts on it safely, and KAN-47 completes the operator journey in the detail page.

## 1. Guardrails

- Read `AGENTS.md` and the CityWatch vault notes before editing. In particular, follow `Frontend-CRM`, `Backend`, `Rules-and-Conventions`, `Real-World-Verification`, and `Playwright-CLI`.
- Do **not** create a branch or worktree unless Sahil explicitly authorizes one. Preserve existing unrelated changes; the workspace was already dirty when this plan was written.
- No database migration is expected for this batch. Application reads and writes remain CRM -> FastAPI -> Supabase; do not add a browser Supabase client.
- Do not start a second backend or CRM process. Never run Uvicorn with `--reload`. Backend edits require the one existing backend process to be restarted manually before live verification.
- Match the current CRM language: Verdana, cream surfaces, dark-green primary actions, clear loading/error/empty states, visible keyboard focus, and inline pages/panels instead of full-screen modal workflows.
- Do not make unrelated visual cleanup or refactors. Every changed line must support one of these four tickets.

## 2. Verified starting point

The baseline inspected for this plan has these relevant facts:

| Area | Current behavior | Consequence for this batch |
| --- | --- | --- |
| `apps/crm/app/incidents/page.tsx` | Keeps filter, queue, search, sort, and selection state locally. Only `sort=action` is initially read from the URL. | Move all list scope state to URL-backed state. |
| `GET /admin/incidents` in `apps/backend/app/main.py` | Returns an array, applies only `status` and `severity`, caps rows at 200, then the CRM does additional filtering and sorting. | Replace the array contract with a paginated envelope and apply all list filters before pagination. |
| Dashboard and sidebar | Also call `GET /admin/incidents`; dashboard expects an array and sidebar counts `needs_review` from an array. | Update these two callers when the endpoint returns the envelope. |
| Bulk API | `POST /admin/incidents/bulk` accepts only explicit IDs. The list offers an unconfirmed bulk bar and a best-effort client-side Undo. | Add explicit selection scope and confirmation; server-side filtered selection is required for “all matching.” |
| Incident detail | Already has KAN-39 authority evidence, citizen follow-ups, review actions, evidence cards, and a timeline. The same facts are repeated in several panels. | Recompose existing data into one state-led resolution flow; do not rebuild KAN-39 storage or workflow APIs. |
| Resolution statuses | The backend already reserves `awaiting_verification`, `community_confirmed`, and `needs_follow_up` for the resolution-evidence workflow. | Remove any CRM path that tries to set `resolved` through generic status actions. |

The existing admin endpoint is used only by the CRM in these locations:

- `apps/crm/app/incidents/page.tsx`
- `apps/crm/app/page.tsx`
- `apps/crm/components/sidebar.tsx`

## 3. Shared list-scope contract (KAN-49 + KAN-46)

Use one URL contract for an incident queue. It must be shareable, survive refresh/back/forward navigation, and be the single source of truth for the list request.

| URL parameter | Allowed values | Default | Meaning |
| --- | --- | --- | --- |
| `q` | trimmed text, max 100 chars | omitted | Matches title or description. |
| `status` | current incident status values | omitted | Exact status filter. |
| `severity` | `low`, `medium`, `high`, `critical` | omitted | Exact severity filter. |
| `queue` | `mine`, `unassigned` | omitted | `mine` means open incidents assigned to the signed-in staff member. `unassigned` means open incidents with no owner. Omitted means all incidents. |
| `sort` | `newest`, `oldest`, `severity`, `action` | `newest` | Stable server-side ordering. |
| `page` | positive integer | `1` | One-based page number. |

Use a fixed page size of **25**. Do not expose a page-size picker in this batch.

### Backend response contract

Change `GET /admin/incidents` to always return:

```json
{
  "items": ["...incident objects using the existing incident_out shape..."],
  "total": 45,
  "page": 1,
  "page_size": 25,
  "total_pages": 2
}
```

Rules:

- Validate malformed `status`, `severity`, `queue`, `sort`, `page`, and `q` with FastAPI validation or a clear 422 response. Do not silently reinterpret invalid input.
- Apply `q`, status, severity, and queue filters in the database query **before** counting and paginating.
- `queue=mine` is `assigned_to == current staff id` and excludes terminal statuses `resolved`, `community_confirmed`, and `closed`.
- `queue=unassigned` is `assigned_to IS NULL` and excludes those same terminal statuses.
- A separately selected `status` still applies. Its active filter chip makes an empty result understandable if it conflicts with an open-only queue.
- Add deterministic ordering for every sort by appending `created_at` and `id` as tie breakers.
- `newest` and `oldest` sort by creation time. `severity` uses `critical`, `high`, `medium`, `low`, then oldest first within each severity.
- `action` must sort across the entire filtered result set, not only the visible page: overdue first, then breaching, then other open incidents, then terminal incidents. Within a group, oldest first. Implement its SLA rank in PostgreSQL using the same one-hour/four-hour/24-hour/48-hour budgets defined in `apps/crm/lib/sla.ts`; do not fetch all rows into Python merely to sort and then paginate.
- Return the actual last valid page when a mutation makes the requested page out of range. The CRM must replace the URL with that returned page number.

Add an `AdminIncidentPage` TypeScript interface in `apps/crm/lib/types.ts`. Update the dashboard and sidebar callers to consume `.items`; the sidebar should use `.total` for the `needs_review` badge.

## 4. KAN-49 — Filters and queue state

### Files

- `apps/backend/app/main.py`
- `apps/crm/app/incidents/page.tsx`
- `apps/crm/lib/types.ts`
- `apps/crm/app/page.tsx`
- `apps/crm/components/sidebar.tsx`

### UI behavior

1. Replace local-only list scope with state initialized from `useSearchParams`. Use `useRouter` and `usePathname` to replace the URL when a control changes; do not use full-page navigation.
2. Reset `page` to `1` whenever `q`, status, severity, queue, or sort changes. Debounce only the search text (about 250 ms); selects and queue choices update immediately.
3. Group controls visibly as:
   - **Search**
   - **Filter**: Status and severity
   - **Queue**: All incidents, My queue, Unassigned
   - **Sort**
4. Replace the ambiguous checkbox label with an explicit queue control. The UI text must define My queue as “Open incidents assigned to you.” Show the signed-in count only when it is known from the response, not by counting a stale client-side array.
5. Beneath the controls, show removable active-filter chips. Examples:
   - `Search: blocked drain`
   - `Status: Needs review`
   - `Severity: Critical`
   - `Queue: My queue — open and assigned to you`
   - `Sort: Needs action`
6. Provide one visible **Clear all** control whenever any non-default scope is active. It removes `q`, status, severity, queue, sort, and page from the URL, clears any selection, and returns to page 1.
7. Replace the current count with `Showing 1–25 of 45 incidents`. For zero results, show `0 of 45` only when appropriate; the empty panel must name the active scope and offer Clear all.
8. While a new scope request is in flight, retain the previous rows with a small “Refreshing…” status instead of blanking the list. First load still uses skeleton rows.

### KAN-49 acceptance checks

- A copied URL restores search, filters, queue, sort, and page after a refresh.
- Every active control has a matching chip or obvious selected state.
- My queue and Unassigned are explicitly open-only in the UI.
- Clear all returns to an unfiltered first page and removes selection.
- A no-results state gives the operator a direct next action.

## 5. KAN-45 — Triage-scannable incident list

### Files

- `apps/crm/app/incidents/page.tsx`
- Optional: a new narrowly scoped `apps/crm/components/incident-list-row.tsx` only if extracting the row makes the page materially clearer. Do not create a general-purpose design system.

### Layout contract

Keep the existing data and links, but change each record from a dense equal-weight card into a stable triage row.

Desktop row order:

1. Selection checkbox.
2. Incident identity: title, location, and a maximum two-line description preview.
3. Action state: overdue/breaching chip when applicable.
4. Status and severity badges.
5. Owner.
6. Age.
7. One clear `Open incident` link.

Details:

- Keep the image thumbnail only as secondary context. It must retain the existing 1px-placeholder fallback behavior.
- Render the description with `line-clamp-2`; do not repeat the full text in every list row. `Open incident` is the explicit details affordance.
- Keep critical, overdue, and needs-review states distinct, but limit emphasis to one action-state chip plus existing status/severity markers. Do not make every metadata value a bright badge.
- Keep duplicate information available as a compact linked indicator, not as a competing primary label.
- Use CSS grid/flex wrapping so narrow widths stack identity, action state, owner, and age vertically without horizontal scrolling. Do not use a desktop table that forces sideways scrolling on mobile.
- Preserve keyboard order: selection checkbox, incident link, then any duplicate/details link. Each interactive target needs a visible focus ring.
- Test with at least 45 seeded records, a long title, a long address, no photo, no owner, and multiple status/severity combinations.

## 6. KAN-46 — Pagination and safe bulk actions

### Backend API changes

Extend `POST /admin/incidents/bulk` to support exactly two target scopes:

```json
{
  "ids": ["id-1", "id-2"],
  "status": "verified"
}
```

for explicit page selections, or:

```json
{
  "scope": "filtered",
  "filters": {
    "q": "blocked drain",
    "status": "needs_review",
    "severity": "high",
    "queue": "mine"
  },
  "assigned_to": "staff-id"
}
```

for all matching records.

Rules:

- Require exactly one target mechanism: non-empty `ids` **or** `scope="filtered"` with the same validated filter model used by `GET /admin/incidents`.
- Resolve a filtered target server-side using the current authenticated staff member. Never trust a client-supplied staff ID for `queue=mine`.
- Return `matched`, `updated`, and per-record errors for explicit IDs. For filtered actions, also return the authoritative `matched` count that was acted on.
- Reuse existing status/severity/assignee validation and keep resolution-only statuses excluded from bulk changes.
- Preserve the existing per-incident status history behavior for real changes.

### List UI behavior

1. Render Previous/Next controls and a compact page indicator below the rows. Disable Previous on page 1 and Next on the last page. Preserve URL scope while changing only `page`.
2. The header checkbox is labeled **Select page (25)** and only selects visible rows.
3. After every row on a page is selected, show a secondary text action: **Select all 45 matching incidents**. This switches the selection mode to `filtered`; it does not silently build a client-side ID list.
4. The selection toolbar appears only when there is a selection and remains visible while the user scans the page. It must state either:
   - `25 incidents selected on this page`, or
   - `All 45 matching incidents selected`.
5. Before every bulk mutation, show an inline confirmation panel in the toolbar with the action name, affected count, scope, and Cancel/Confirm buttons. Cancel changes nothing and preserves selection.
6. Keep the supported bulk actions narrowly aligned with the existing endpoint: approve, reject, assign. Do not add new workflow statuses or new bulk action types.
7. Remove the current best-effort Undo from bulk toasts. It is unreliable for a server-side filtered selection and can create misleading extra status history. Replace it with a non-actionable success/error message containing the returned affected count.
8. On successful confirmation, invalidate incidents, duplicates, staff counts, dashboard data, and sidebar data. Keep URL filters, sort, and page; clear the completed selection. If the current page is now invalid, use the corrected page returned by the list response.
9. On error, retain the selection and show the server error in the toolbar so the operator can retry or cancel.

## 7. KAN-47 — Guided resolution evidence flow

### Files

- `apps/crm/app/incidents/[id]/page.tsx`
- `apps/crm/tests/kan39-resolution-evidence.spec.ts`
- Optional focused new CRM spec for state coverage; do not alter resolution-evidence backend behavior unless a concrete API defect is discovered.

### State model

Put one resolution state banner immediately after the incident header and before the detailed evidence panels. It must identify the current stage, the next responsible actor, and one primary action.

| Incident state | Banner and next owner | Primary action |
| --- | --- | --- |
| `verified`, legacy `resolved`, `needs_follow_up` | `Authority action required` / assigned staff or `Unassigned` | `Record authority evidence` |
| `awaiting_verification`, no pending follow-up | `Waiting for community follow-up` / community | No staff action; explain the waiting state. |
| `awaiting_verification`, pending follow-up exists | `Community follow-up ready for review` / staff | `Review follow-up` scrolls/focuses the review card. |
| `community_confirmed` | `Resolution confirmed by community` / complete | No action. |
| all other triage states | `Complete triage before resolution` / staff | Use the existing triage controls; do not show an evidence submission form. |

Below the banner, show a three-stage stepper:

1. Authority action and after-photo.
2. Community follow-up.
3. Staff confirmation or request for further work.

Use completed/current/upcoming visual states and short plain-language labels. It is a guide, not a new state machine; preserve the KAN-39 backend rules.

### Recompose existing UI

1. Keep authority evidence submission inside stage 1. On submit, retain the current optimistic/pending feedback, then refresh the incident detail.
2. Keep a pending community follow-up’s photo, note, review note input, and Confirm/Request-more-work controls adjacent inside stage 3. Before either final review action, show an inline confirmation that names the outcome. A request for more work still requires a note.
3. Remove the generic `Resolved` status button from the Moderate card. The backend intentionally rejects it; resolution must proceed through authority evidence.
4. Avoid repeating the same resolution status in the banner, workflow card, evidence cards, and timeline. Use the stepper as the summary; keep the evidence ledger as an explicitly expandable secondary section with a chevron and an `Expand evidence history` label.
5. Retain the before/after comparison when authority evidence exists, but show it once in the relevant step rather than duplicating it in multiple cards.
6. Keep the chronological resolution timeline, but it should be a compact audit view. It must not compete with the stepper for the next action.
7. Preserve existing lightbox behavior: evidence photos can be opened, closed by X/Escape/backdrop, and inspected without cropping.

### KAN-47 acceptance checks

- Each state in the table tells the operator who acts next and presents at most one primary next action.
- A pending citizen follow-up can be reviewed with its photo and note immediately visible.
- Direct `resolved` controls are absent from the CRM.
- The page does not repeat large blocks of evidence prose or duplicate status instructions.
- Verified, awaiting verification, pending review, needs follow-up, community-confirmed, and closed/triage states are all rendered deliberately.

## 8. Implementation sequence

1. **Create the paged query model first.** Add backend filter parsing/query helpers near `admin_list`; add envelope types; update list/dashboard/sidebar callers. Verify no current caller still assumes an array.
2. **Make URL scope authoritative.** Convert incident-list state to URL-backed state and render active scope, count, empty state, and clear behavior. Verify refresh and copied URLs before changing row markup.
3. **Build the scannable row.** Apply the KAN-45 hierarchy and responsive layout to data from the paginated response.
4. **Add selection modes and confirmation.** Extend bulk API, then implement page versus filtered selection, the confirmation panel, result handling, and pagination controls.
5. **Recompose incident detail.** Add the state banner and stepper around the already-existing KAN-39 data; remove only duplicated or invalid direct-resolution controls.
6. **Run tests after each layer**, then complete the live API and live CRM verification in section 10.

## 9. Automated coverage

### Backend

Add focused tests, preferably in a new `apps/backend/tests/test_admin_incident_list.py` plus any small additions to existing endpoint tests:

- Filters are applied before `total` and page slicing.
- `queue=mine` and `queue=unassigned` exclude terminal incidents and use the authenticated staff identity.
- Invalid query values return 422.
- Page boundaries return the last valid page consistently.
- Ordering is stable for equal timestamps and action priority works across more than one page.
- Explicit-ID bulk and filtered-scope bulk cannot be combined.
- Filtered bulk uses server-side filters and returns the affected count.
- Resolution statuses remain rejected by generic/bulk updates.

### CRM Playwright tests

Create `apps/crm/tests/kan45-46-47-49-incident-operations.spec.ts` with a paginated endpoint fixture. Update `kan39-resolution-evidence.spec.ts` only where existing expected labels change.

Cover:

- Loading an incident URL with every scope parameter restores controls and active chips.
- Changing a filter resets page to 1 and Clear all removes scope parameters.
- A result summary renders `Showing X–Y of Z` and no-results shows a useful reset action.
- Next page changes the URL and requests the expected page.
- Select page versus Select all matching have different accessible text.
- Cancel retains selection; Confirm sends the expected explicit-ID or filtered bulk request.
- The resolution banner/stepper exposes the next action for awaiting-verification and pending-review fixtures.
- The direct Resolved status control is absent.
- At a narrow viewport, the list has no horizontal overflow and the primary incident link remains visible.

Mocked tests are supporting evidence only. Do not call the feature complete based on them.

## 10. Real acceptance verification (required)

Before live feature testing, confirm no migration is needed and that the configured backend is pointing at the intended Supabase environment. Use a dedicated test incident and test staff account; do not bulk-action real citizen reports.

### Real API

1. Authenticate as a test staff member and call `GET /admin/incidents` with each queue/filter/page combination. Confirm returned `total`, page bounds, IDs, and order against the real configured data plane.
2. Create a safe test scope with enough records for two pages. Verify explicit-page bulk action changes only selected IDs.
3. Use a restrictive filtered selection and confirm filtered bulk changes exactly the response’s `matched` records, preserving status history.
4. Fetch a test incident in each resolution stage. Use the existing KAN-39 endpoints to submit authority evidence and a citizen follow-up only against a dedicated test incident. Confirm review transitions and history remain correct.

### Live CRM, headed Playwright CLI

Run the real CRM against the manually restarted backend using the documented headed Playwright CLI loop:

1. Log in as test staff and open `/incidents` at desktop width.
2. Apply search, status, severity, My queue, and Unassigned; inspect snapshots, URL, requests, and screenshots after each interaction.
3. Navigate between pages, select page, select all matching, cancel one bulk confirmation, then complete one safe test bulk action. Verify the success count and that filters/page remain intact.
4. Open a long-title incident and capture desktop plus narrow-width screenshots. Confirm no horizontal scrolling, clipped primary title, or inaccessible action.
5. Open incidents covering each KAN-47 resolution state. Confirm the state banner, stepper, evidence photo lightbox, and review action all match persisted API state.
6. Inspect browser console and failed network requests. A clean visual result with console errors is not accepted.
7. Re-read the real API after UI actions to confirm persisted status/history matches the screen.

In the handoff, report exact API calls and the live Playwright journey that passed. If a real API or live UI pass was not possible, state that plainly rather than claiming full verification.

## 11. Definition of done

- KAN-49, KAN-45, KAN-46, and KAN-47 acceptance criteria are demonstrably met.
- All CRM callers of `GET /admin/incidents` use the paginated envelope correctly.
- The URL, visible scope summary, backend query, pagination, and bulk target all describe the same set of incidents.
- The list is usable at desktop and narrow widths with long data.
- Resolution detail has one coherent next-step flow built on the existing KAN-39 workflow.
- Relevant backend tests, CRM Playwright specs, CRM type check/build, and required real API + headed CRM verification have passed.
- Only files attributable to these tickets are staged; unrelated local changes remain untouched.
