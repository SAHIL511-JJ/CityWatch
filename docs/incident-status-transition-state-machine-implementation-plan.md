# Incident Status Transition State Machine — Implementation Plan

> **Superseded on 2026-09-13:** `escalated` was removed from the active MVP workflow after review. Existing escalated records were converted to `verified` through the FastAPI admin endpoint. This document preserves the original handoff for context; the current workflow uses `verified` plus severity and assignment for urgency.

## 1. Objective

Implement one predictable incident-status state machine across FastAPI and the desktop CRM so staff only see and can execute valid next actions. Keep `escalated` as a first-class status for this version, and keep `closed` available as a deliberately separated emergency admin action from every non-closed state.

This is a plan-only handoff for a later implementer. Do not implement from this document until Sahil explicitly requests implementation.

## 2. Current state

CityWatch stores one status string on `Incident.status` and records changes in `status_history`. Flutter and the Next.js CRM talk only to FastAPI; neither client may write directly to Supabase.

The current status writers are distributed across several paths:

- `apps/backend/app/main.py`
  - `POST /incidents` creates an incident in `processing`.
  - `PATCH /admin/incidents/{incident_id}` accepts any destination in `TRIAGE_STATUSES` without validating whether that destination is legal from the current status.
  - `POST /admin/incidents/bulk` writes a requested bulk status directly to every matched incident.
  - `POST /admin/incidents/{incident_id}/analyze` runs AI synchronously and can replace a triage status.
  - `POST /admin/incidents/merge` closes duplicate records as a domain-specific operation.
  - `POST /admin/incidents/split` restores the most recent pre-close status for a previously merged record.
  - Resolution-evidence routes move incidents to `awaiting_verification`, `community_confirmed`, or `needs_follow_up`.
- `apps/backend/app/worker.py::apply_ai_result` writes `verified`, `rejected`, or `needs_review`. A queued result can currently arrive after a staff action and overwrite it.
- `apps/backend/app/resolution_evidence.py` defines `AUTHORITY_START_STATUSES`, `RESOLUTION_STATUSES`, and `add_status_history` for the evidence loop.
- `apps/crm/app/incidents/[id]/page.tsx` renders the same Approve, Reject, Escalate, and Close controls for most records, regardless of the current lifecycle stage. `doStatus` also offers an undo that sends the previous status through the generic PATCH route.
- `apps/crm/app/incidents/page.tsx` offers bulk Approve, Reject, and Escalate without considering the selected records' current statuses.
- `apps/crm/lib/types.ts::IncidentStatus` already includes all ten stored values.

The intended resolution flow already exists:

`verified | escalated | resolved | needs_follow_up`
→ authority evidence
→ `awaiting_verification`
→ community evidence
→ staff review
→ `community_confirmed | needs_follow_up`

The generic moderation route must not bypass that evidence flow.

### Existing partial, uncommitted work to reconcile

The working tree currently contains two incomplete edits from an interrupted fix:

- `apps/backend/app/main.py::admin_patch` rejects every generic triage transition when the current status belongs to the resolution workflow. This blocks the newly approved emergency `closed` action and therefore must be replaced by the complete transition helper described below.
- `apps/crm/app/incidents/[id]/page.tsx` defines `resolutionStatus` and hides all moderation buttons during the resolution workflow. This also hides emergency Close and must be refined rather than layered with another conditional.

Preserve unrelated dirty-worktree changes. Do not reset, reformat, stage, or modify unrelated files.

## 3. Scope

### In scope

- Define one explicit matrix for manual staff transitions.
- Keep `escalated` as a status, including its existing ability to enter the authority-evidence workflow.
- Permit emergency Close from every non-closed status.
- Require an emergency-close reason and save it atomically with the status/history update.
- Make FastAPI the source of truth for allowed transitions.
- Prevent generic PATCH, bulk moderation, and delayed/manual AI analysis from bypassing the state machine.
- Preserve the existing evidence-only transitions into `awaiting_verification`, `community_confirmed`, and `needs_follow_up`.
- Render only valid next actions in the CRM incident detail page.
- Keep emergency Close visually separate from normal lifecycle actions.
- Prevent mixed-status bulk actions from partially and silently changing records.
- Preserve severity and assignment editing regardless of incident status.
- Preserve audit history and stop creating no-change status-history rows for severity-only or assignment-only updates.
- Add focused backend and CRM regression coverage plus real Supabase/API/CRM verification.
- Update authoritative CityWatch documentation after implementation and acceptance.

### Non-goals

- Do not convert `escalated` into a separate priority flag in this version.
- Do not rename stored statuses or migrate existing rows.
- Do not add a generic dropdown containing every status.
- Do not add a direct button for `resolved`, `awaiting_verification`, `community_confirmed`, or `needs_follow_up`.
- Do not change the Flutter community-verification UI except for a read-only smoke check that awaiting-verification incidents remain visible.
- Do not redesign severity, assignment, duplicate detection, analytics, or Insights.
- Do not create a general reopen flow for emergency-closed incidents in this change. Duplicate `split` remains the only existing domain-specific reopen operation.
- Do not mutate retained `[CW-DEMO:KAN-38]` or `[API-E2E 20260908]` fixtures during acceptance.

## 4. Facts, assumptions, and blockers

### Confirmed facts

- `Incident.status` is a text column; there is no database enum or transition constraint.
- Every application status write goes through FastAPI, so backend validation can protect Flutter, CRM, and direct API callers without a schema change.
- Generic PATCH currently validates the destination but not the current-to-next pair.
- Bulk moderation currently assigns statuses directly and can bypass detail-page behavior.
- AI analysis currently writes a new status without checking whether a staff decision happened while analysis was running.
- Authority evidence is accepted only from `verified`, `escalated`, `resolved`, or `needs_follow_up` and moves the incident to `awaiting_verification`.
- Community-evidence review is the only intended path from `awaiting_verification` to `community_confirmed` or `needs_follow_up`.
- Merge and split are domain-specific status writers and must remain functional.
- The current detail-page status undo calls generic PATCH and may become illegal under a strict transition matrix.
- No migration is required for the requested state-machine enforcement.

### Approved product decisions

- Keep `escalated` as a status for now.
- Keep `closed` as an emergency administrative action available from every non-closed status.
- Status changes must follow explicit next-state rules instead of behaving like freely interchangeable labels.

### Working assumptions

- Closing is exceptional and requires a non-empty reason of at most 2,000 characters.
- Emergency Close is offered only on the single-incident detail page, not as a bulk status action.
- A rejected incident is final for normal workflow in this version; staff may emergency-close it, but cannot directly jump it to Verified. A future explicit “Reopen review” flow is out of scope.
- A legacy `resolved` record remains eligible to enter the evidence workflow through authority evidence, matching `AUTHORITY_START_STATUSES`.
- Status-changing requests are not undoable through a reverse PATCH. Recovery must be an explicit future workflow, not a generic toast action.
- Severity and assignment changes remain legal in every status because they do not move the case lifecycle.
- Bulk status requests are all-or-nothing: if any selected incident has an illegal transition, no selected incident is changed.

### Blockers/questions

No implementation blocker remains. If Sahil later wants rejected or emergency-closed records to re-enter triage, define that as a separate explicit recovery action rather than weakening this matrix.

## 5. Acceptance criteria

### Canonical transition rules

The backend must enforce the following normal manual transitions:

| Current status | Normal manual status targets | Other legal domain action |
|---|---|---|
| `processing` | `verified`, `rejected`, `escalated` | AI may produce `verified`, `rejected`, or `needs_review` |
| `needs_review` | `verified`, `rejected`, `escalated` | AI re-analysis may produce `verified`, `rejected`, or remain `needs_review` |
| `verified` | `escalated` | Authority evidence moves it to `awaiting_verification` |
| `rejected` | none | none |
| `escalated` | `verified` | Authority evidence moves it to `awaiting_verification` |
| `resolved` | none | Authority evidence may move this legacy status to `awaiting_verification` |
| `awaiting_verification` | none | Evidence review moves it to `community_confirmed` or `needs_follow_up` |
| `needs_follow_up` | none | New authority evidence moves it back to `awaiting_verification` |
| `community_confirmed` | none | none; resolution is complete |
| `closed` | none | Duplicate split may restore the prior status |

In addition, every row except `closed` allows the emergency admin transition to `closed` when a valid reason is supplied.

### Backend behavior

- `PATCH /admin/incidents/{id}` rejects an illegal status pair with HTTP `409` and structured detail containing the current status, requested status, and allowed manual targets.
- `awaiting_verification → verified` returns `409`, changes no database state, and adds no history row.
- Generic PATCH cannot directly create `resolved`, `awaiting_verification`, `community_confirmed`, or `needs_follow_up`.
- `closed` from any non-closed state succeeds only when `status_reason` is non-empty and no longer than 2,000 characters.
- Successful emergency Close writes the incident status, one `StatusHistory` row, and one staff-authored `IncidentNote` in the same database transaction.
- Missing close reason returns `400`; an unexpected `status_reason` on a non-close transition returns `422`.
- A severity-only or assignment-only PATCH does not add a no-change status-history row.
- Admin incident detail responses expose `allowed_statuses` for the current record. `closed` appears for every non-closed record; evidence-only targets never appear.
- Bulk status mutation validates the complete selected set before writing. One illegal row causes HTTP `409` and zero status changes across the set.
- Bulk status targets are limited to `verified`, `rejected`, and `escalated`; Close remains detail-only.
- Async AI results update status only while the incident remains `processing`. A stale result may save safe AI metadata if desired, but it must not overwrite a staff-set status, add a misleading status-history row, or adjust reporter trust based on a discarded transition.
- Manual `POST /admin/incidents/{id}/analyze` is available only for `processing` and `needs_review`; all other statuses return `409` without changing status.
- Merge may still close a duplicate through its own domain route without requiring the emergency-close request field.
- Split may still restore a closed duplicate through its own domain route.
- Resolution-evidence routes continue to produce only their existing evidence-backed transitions.

### CRM behavior

- The incident detail page labels the area **Available actions**, not **Set status**.
- Normal status buttons come from `data.allowed_statuses`; the UI does not infer that every target is universally valid.
- An awaiting-verification record never shows Approve, Reject, or Escalate.
- Awaiting-verification records continue to show the correct resolution guidance and pending-evidence review actions.
- Emergency Close is displayed separately with danger styling and explanatory copy such as “Administrative override — stops this incident’s active workflow.”
- Closing opens a confirmation requiring a reason; the confirm button remains disabled until a non-empty reason is entered.
- The close request sends one atomic PATCH body: `{status: "closed", status_reason: "…"}`. It does not make a second notes request.
- Status-change success toasts do not offer generic Undo.
- Illegal-transition API errors appear inline and leave the current status/actions unchanged.
- Severity and assignment controls remain available for resolution and terminal states where they are currently shown.
- For selected-page bulk actions, the CRM shows only targets present in every selected row’s `allowed_statuses`.
- “Select all matching” does not offer bulk status mutation because unloaded rows may have different legal transitions; assignment remains available.
- If no common bulk status target exists, the CRM explains that the operator must select incidents at the same compatible stage.
- Status filtering continues to include every status; filtering is not the same as changing status.

### Compatibility and operational behavior

- Existing stored statuses and histories remain readable.
- No database migration, backfill, Supabase console write, or direct CRM/Flutter database call is introduced.
- Existing dashboard, queue, analytics, and Insights status filters keep their present semantics.
- Flutter continues to show `verified` and `awaiting_verification` public incidents and never receives admin-only allowed-action metadata.
- Backend must be deployed/restarted before the CRM behavior is accepted.

## 6. Change map

| Path | Existing symbol/region or `new file` | Purpose | Required change |
|---|---|---|---|
| `apps/backend/app/incident_status.py` | new file | Canonical status policy | Define all status groups, the manual transition matrix, AI source/target rules, `allowed_manual_statuses`, and pure validation helpers. Do not import database or FastAPI modules. |
| `apps/backend/app/main.py` | status constants, `AdminPatchIn`, admin serializers, `admin_patch`, `admin_bulk`, `admin_analyze` | Enforce policy at every generic admin write | Import the canonical policy; add `status_reason`; expose `allowed_statuses`; validate before mutation; make Close atomic; prevent no-op histories; prevalidate bulk; restrict manual AI analysis. Replace the current coarse uncommitted guard. |
| `apps/backend/app/resolution_evidence.py` | `AUTHORITY_START_STATUSES`, `RESOLUTION_STATUSES`, `OPERATIONAL_STATUSES` | Keep one status vocabulary | Import shared status groups from `incident_status.py`; preserve evidence validation and `add_status_history`. |
| `apps/backend/app/worker.py` | `apply_ai_result`, `analyze_incident` | Prevent stale AI overwrite | Check the current source state before applying AI status/trust/history effects. Preserve the staff decision if the queued result is stale. |
| `apps/backend/tests/test_incident_status_transitions.py` | new file | Regression coverage for the state machine | Test the pure matrix, admin PATCH, close validation/atomic note, no-op history behavior, bulk all-or-nothing behavior, and stale AI handling. |
| `apps/backend/tests/test_resolution_evidence.py` | existing endpoint tests | Protect evidence-only transitions | Add assertions that generic PATCH cannot escape resolution states and existing authority/community transitions remain valid. |
| `apps/crm/lib/types.ts` | `IncidentStatus`, `IncidentListItem`, `IncidentDetail` | Consume server-provided actions | Add `allowed_statuses: IncidentStatus[]` to admin incident payload types only. |
| `apps/crm/app/incidents/[id]/page.tsx` | moderation card, `doStatus`, confirmation state | Context-aware single-record actions | Replace universal buttons with `allowed_statuses`, preserve resolution controls, add separate reason-required emergency Close, remove status Undo, and show errors. Refine the current uncommitted `resolutionStatus` edit. |
| `apps/crm/app/incidents/page.tsx` | selected-page and filtered bulk action panel | Prevent bulk UI bypass | Compute common actions from selected rows; hide bulk status controls for “all matching”; preserve bulk assignment; explain incompatible selections. |
| `apps/crm/tests/status-transition-guards.spec.ts` | new file | CRM regression coverage | Cover action visibility by current status, emergency Close payload/validation, API errors, and bulk intersection behavior. |
| `apps/crm/tests/kan39-resolution-evidence.spec.ts` | pending community review journey | Protect resolution workflow | Add an assertion that Awaiting Verification has no Approve action while Confirm Resolution/Request More Work remain available. |
| `vault_Citywatch/Frontend-CRM.md` via Obsidian MCP | Incident status workflow | Durable product contract | Replace the loose status description with the approved transition matrix, emergency Close rule, and action-vs-filter distinction after implementation is verified. |
| `vault_Citywatch/Backend.md` via Obsidian MCP | admin and resolution routes | Durable backend contract | Record the source-of-truth transition helper and enforcement points after verification. |
| `vault_Citywatch/Decisions-Log.md` and `Index.md` via Obsidian MCP | locked decision and discoverability | Preserve Sahil’s approved direction | Record and link the decision that Escalated remains a status, Close is an emergency override, and all other movement follows the explicit state machine. |

### Inspected files that should not require implementation changes

- `apps/mobile/lib/api_client.dart` and Flutter screens: no admin mutation controls exist there.
- `apps/backend/app/models.py`: existing `IncidentNote` and `StatusHistory` tables can store the close reason and audit event; no migration is needed.
- Dashboard/Insights code: status counting/filter semantics remain unchanged.

## 7. Ordered implementation steps

### 1. Create the canonical backend status policy

**Location:** `apps/backend/app/incident_status.py` (new file).

**Change:** Define constants for every stored status and separate sets for:

- AI sources and targets;
- normal staff-manual targets;
- resolution lifecycle statuses;
- authority-evidence source statuses;
- terminal/reporting statuses;
- emergency-close behavior.

Implement a pure mapping and helper similar to:

```python
MANUAL_STATUS_TRANSITIONS = {
    "processing": {"verified", "rejected", "escalated"},
    "needs_review": {"verified", "rejected", "escalated"},
    "verified": {"escalated"},
    "rejected": set(),
    "escalated": {"verified"},
    "resolved": set(),
    "awaiting_verification": set(),
    "needs_follow_up": set(),
    "community_confirmed": set(),
    "closed": set(),
}

def allowed_manual_statuses(current: str) -> tuple[str, ...]:
    normal = MANUAL_STATUS_TRANSITIONS.get(current, set())
    emergency = {"closed"} if current != "closed" else set()
    return tuple(sorted(normal | emergency))
```

Provide `can_manual_transition(current, target)` and `can_ai_transition(current, target)` without raising framework-specific exceptions.

**Contract:** Unknown current or target values return false/empty; they must never become implicitly allowed.

**Edge cases:** Same-state requests are no-ops, not transitions. `closed` is never included when the current state is already closed. Resolution targets are absent from the manual map.

**Verification:** Unit-test every row and the emergency Close exception before wiring routes.

### 2. Make admin PATCH enforce the state machine and atomic Close

**Location:** `apps/backend/app/main.py::AdminPatchIn`, `admin_patch`, and the admin incident serializers used by list/detail responses.

**Change:**

1. Add `status_reason: str | None = None` to `AdminPatchIn`.
2. Before mutating, compare `old` and `body.status` with `can_manual_transition`.
3. For an illegal pair, return HTTP `409` with structured detail:

```json
{
  "code": "invalid_status_transition",
  "current_status": "awaiting_verification",
  "requested_status": "verified",
  "allowed_statuses": ["closed"]
}
```

4. When target is `closed`, validate `status_reason`, add an `IncidentNote` such as `Emergency close: <reason>`, add one `StatusHistory` row, and commit once.
5. Reject `status_reason` when target is not `closed` so stale form state cannot create misleading notes.
6. Add history only when status actually changed. Severity and assignment changes must not create status history.
7. Add `allowed_statuses` to admin list/detail output. Do not add it to public `incident_out` responses.

**Contract:** Authentication and staff-role checks remain unchanged. Invalid pairs are `409`; invalid/missing close reason is `400`; misplaced reason is `422`; unknown status remains `422`.

**Edge cases:** A request may update severity/assignment while status is in the resolution workflow; allow it. If a request combines an illegal status with another field, reject the whole request before changing any field.

**Verification:** Endpoint tests must assert response status, unchanged incident state, transaction calls, note/history creation, and `allowed_statuses` response content.

### 3. Preserve evidence transitions as domain actions

**Location:** `apps/backend/app/resolution_evidence.py` and resolution routes in `apps/backend/app/main.py`.

**Change:** Move shared status-set definitions to `incident_status.py` and import them. Do not send evidence transitions through the generic manual matrix. Keep the existing source checks:

- authority evidence: `verified | escalated | resolved | needs_follow_up → awaiting_verification`;
- staff evidence review: `awaiting_verification → community_confirmed | needs_follow_up`.

**Contract:** Evidence creation/review remains the only route that can produce these resolution statuses. Existing response shapes and photo/storage behavior stay unchanged.

**Edge cases:** Duplicate authority submissions while awaiting and duplicate/reviewed community evidence keep their existing `409` behavior.

**Verification:** Existing resolution tests continue passing, plus explicit tests that generic PATCH cannot reproduce the same transitions.

### 4. Stop AI from overwriting a newer human decision

**Location:** `apps/backend/app/worker.py::apply_ai_result`, `analyze_incident`; `apps/backend/app/main.py::admin_analyze`.

**Change:**

- Async analysis may change status only if the incident is still `processing` when the result is applied.
- Manual re-analysis may run only from `processing` or `needs_review`.
- If an async result is stale, preserve the current status, do not add status history, and do not adjust reporter trust from the discarded status decision.
- It is acceptable to retain sanitized AI metadata/confidence/severity if the current product wants analysis visible, but status and trust must remain human-controlled once staff advanced the record.
- Hide or disable CRM **Re-run analysis** outside `processing` and `needs_review`, with short explanatory text.

**Contract:** `POST /admin/incidents/{id}/analyze` returns `409` with the current status when analysis is no longer a legal action.

**Edge cases:** A worker that loaded `processing` before a staff action must re-check the database-backed current status immediately before applying/committing.

**Verification:** Simulate a queued result arriving after the incident became `verified`, `escalated`, or `awaiting_verification`; all three must retain their current status and trust score.

### 5. Make bulk status changes safe and predictable

**Location:** `apps/backend/app/main.py::BULK_STATUS`, `BulkIn`, `admin_bulk`.

**Change:**

- Limit bulk status targets to `verified`, `rejected`, and `escalated`.
- Resolve every target incident first and validate every current-to-target pair before mutating any row.
- If one or more are illegal, return `409` with `invalid_count`, current-status counts, and a bounded sample of invalid IDs; make zero changes.
- If valid, apply mutations and history entries in one commit.
- Count `updated` only for rows whose requested field actually changed.
- Keep bulk severity and assignment behavior available independently of status rules.

**Contract:** A request combining status with severity/assignment is atomic. Illegal status means no part of the request is applied.

**Edge cases:** Mixed `processing` + `needs_review` selections may share valid targets and succeed. Mixed `needs_review` + `awaiting_verification` selections must fail without partial changes. Same-target rows are no-ops and do not receive history entries.

**Verification:** Test explicit-ID and filtered-scope requests, including one illegal row in the middle of a multi-record set.

### 6. Render server-authorized actions on the CRM detail page

**Location:** `apps/crm/lib/types.ts` and `apps/crm/app/incidents/[id]/page.tsx`.

**Change:**

- Type and consume `allowed_statuses` from the admin detail response.
- Replace the hard-coded four-button array with normal buttons derived from allowed targets.
- Change the heading from **Set status** to **Available actions**.
- For resolution states, explain the next evidence action and keep all existing resolution controls visible.
- Render `closed` separately as **Emergency close** with danger styling, confirmation, and required reason.
- Submit Close as one PATCH with `status_reason`; do not call the separate notes endpoint for that action.
- Remove status Undo callbacks because a reverse transition may be illegal. Keep ordinary success feedback.
- Display `patch.error` inline and retain the current server state after failure.
- Keep severity and assignment controls available.

**Contract:** The server is authoritative. If `allowed_statuses` does not contain a target, the CRM does not render that action. Labels remain user-facing actions: Verified → Approve, Rejected → Reject, Escalated → Escalate.

**Edge cases:** When only `closed` is allowed, show resolution guidance plus the separated emergency action. When no actions are allowed (`closed`), show a read-only message.

**Verification:** Mock each representative server payload and assert exact button visibility and Close payload.

### 7. Make CRM bulk actions reflect compatible selections

**Location:** `apps/crm/app/incidents/page.tsx` and its incident-row types.

**Change:**

- For page selections, intersect `allowed_statuses` across selected rows and render only common non-close status actions.
- If no common action exists, show: “These incidents are at different workflow stages. Select incidents with a compatible current status.”
- When the operator chooses **Select all matching**, hide status-mutation controls because unloaded rows cannot be safely inspected; retain assignment actions.
- Keep the backend all-or-nothing validation as the final authority.
- Surface `409` detail in the bulk action panel rather than only a generic failure.

**Contract:** Bulk Close is not introduced. Status filtering remains available for finding records but never implies mutation permission.

**Edge cases:** Selection changes must recompute common actions immediately. A refetch that changes one selected row's status must remove now-invalid actions.

**Verification:** Playwright tests cover homogeneous selection, mixed selection, filtered “all matching,” and a backend rejection.

### 8. Add regression coverage

**Location:** new `apps/backend/tests/test_incident_status_transitions.py`, existing `test_resolution_evidence.py`, new CRM `status-transition-guards.spec.ts`, and existing `kan39-resolution-evidence.spec.ts`.

**Change:** Add focused tests mapped directly to the acceptance criteria. Use pure helper tests for the complete matrix, route tests for persistence/error behavior, and CRM tests for visibility/interaction.

**Contract:** Mocked tests are supplementary. They do not replace the configured-Supabase API and live CRM acceptance pass required by CityWatch.

**Edge cases:** Include no-op transitions, close without reason, stale AI, mixed bulk sets, and severity-only changes on an awaiting-verification record.

**Verification:** Run the commands in Section 8 and preserve exact failures if external configuration blocks real verification.

### 9. Update durable documentation only after verification

**Location:** CityWatch Obsidian vault via the `obsidian-citywatch` MCP.

**Change:** Update `Frontend-CRM.md`, `Backend.md`, and `Decisions-Log.md`; ensure `Index.md` links the decision. Correct the existing statement that the Moderate panel always has four actions. Store the approved state machine and why, not implementation progress.

**Verification:** Re-read patched notes and confirm there is one non-conflicting workflow definition.

## 8. Verification plan

All items below are **to run**. This planning turn did not execute tests or mutate Supabase.

### Static checks and focused automated tests — must run

Prerequisite: use the existing environments; do not install or upgrade dependencies unless a failing command proves it is required.

```powershell
Set-Location C:\incident_reporter\apps\backend
.\.venv\Scripts\python.exe -m unittest tests.test_incident_status_transitions tests.test_resolution_evidence
```

Expected: complete matrix, route guards, close transaction, stale AI, and evidence tests pass.

```powershell
Set-Location C:\incident_reporter\apps\crm
npm run build
npx playwright test tests/status-transition-guards.spec.ts tests/kan39-resolution-evidence.spec.ts
```

Expected: TypeScript/Next.js build succeeds and focused CRM tests pass.

Also run:

```powershell
Set-Location C:\incident_reporter
git diff --check
```

Expected: no whitespace errors. Inspect the diff to confirm unrelated dirty files were not modified.

### Migration and Supabase readiness — must run

- Confirm the configured backend still points to Supabase Postgres/PostGIS and Supabase Storage.
- Confirm existing `incidents`, `incident_notes`, `status_history`, and `resolution_evidence` objects exist.
- No migration should be created or applied. If implementation unexpectedly requires one, stop and revise the plan instead of changing Supabase ad hoc.

### Real API verification — must run

Follow `vault_Citywatch/Real-World-Verification.md`. Run exactly one backend process on port 8000 from `apps/backend`, without `--reload`.

Use newly created test records with a unique marker such as `[STATUS-E2E <UTC timestamp>]`. Do not mutate retained demo fixtures.

Minimum real sequence:

1. Authenticate a fresh anonymous citizen through `POST /auth/anonymous` and create a fresh report through `POST /incidents` with a valid JPEG/PNG.
2. Authenticate staff through the normal local CRM/API staff flow.
3. Move the fresh report through a valid triage transition.
4. Submit authority evidence through `POST /admin/incidents/{id}/resolution-evidence`; assert persisted `awaiting_verification` and history.
5. Attempt generic `PATCH {"status":"verified"}` while awaiting; expect `409` and persisted status/history unchanged.
6. Attempt emergency Close without a reason; expect `400` and unchanged state.
7. Close a separate fresh test record with a reason; expect `closed`, one new history row, and one staff note containing the reason.
8. Exercise a mixed-status bulk request containing one invalid row; expect `409` and verify every selected row stayed unchanged.
9. Trigger or simulate a stale AI result after a staff transition; verify it does not overwrite status or trust.

Record IDs, request status codes, before/after statuses, and history counts. Never print JWTs, service keys, signed photo URLs, or database credentials.

### Live CRM user-flow verification — must run

Use the real CRM at `http://localhost:3000` and real API at `http://localhost:8000` with Playwright CLI, not route mocks.

1. Open a fresh `processing` or `needs_review` record; verify Approve, Reject, Escalate, and separate Emergency Close are shown.
2. Open a `verified` record; verify Escalate and Emergency Close are shown, while Reject and Approve are absent.
3. Open the fresh `awaiting_verification` record; verify Approve, Reject, and Escalate are absent; resolution guidance remains; Emergency Close remains separated.
4. If pending community evidence exists on a fresh record, verify Confirm Resolution and Request More Work remain available in the resolution panel.
5. Open `community_confirmed`; verify no normal status action appears and Emergency Close remains available.
6. Open `closed`; verify the page is read-only for normal status movement.
7. Verify Close requires a reason and sends one successful request.
8. Select compatible same-stage rows on the incidents page; verify common bulk actions.
9. Select mixed-stage rows; verify no incompatible status action appears.
10. Inspect the entire desktop page by scrolling or full-page screenshot, then inspect browser console and network failures.

Expected: operators can always tell what action is legal next, and the CRM never advertises a transition the API will reject.

### Flutter smoke verification — recommended

Run Flutter through the existing supervisor on port 8080 with `API_URL=http://127.0.0.1:8000`.

- Confirm a retained awaiting-verification fixture remains visible and opens the community-verification flow.
- Keep this read-only; do not submit evidence to retained fixtures.
- Confirm terminal/private statuses remain absent from the public feed.

### Full regression — recommended

- Run the broader backend test suite after focused tests.
- Run the complete existing CRM Playwright suite.
- Confirm exactly one listener on backend 8000, CRM 3000, and Flutter 8080 before live acceptance.

## 9. Risks and rollback

- **Previously tolerated shortcuts will return `409`.** Direct API clients that relied on arbitrary status reassignment will stop working. Mitigation: deploy backend first, update CRM immediately, and surface structured allowed targets.
- **Bulk behavior becomes stricter.** Mixed-stage bulk actions that previously partially or incorrectly succeeded will be rejected atomically. Mitigation: explain compatible selection requirements in the CRM.
- **Delayed AI race.** Saving AI metadata while preserving human status must avoid trust/history side effects. Mitigation: test the stale-result path explicitly and keep the decision in one helper.
- **Close can interrupt any workflow.** This is intentional but risky. Mitigation: separate danger styling, require a reason, confirm explicitly, and preserve note/history atomically.
- **No general reopen in this scope.** An accidental emergency closure cannot be reversed by arbitrary status PATCH. Mitigation: require confirmation and reason; define a separate audited reopen feature if operational use proves it is needed. Do not misuse duplicate Split as a general reopen control.
- **Existing data may contain historically invalid jumps.** The implementation must not rewrite historical rows. Audit/reporting cleanup is a separate decision.
- **Partial working-tree edits conflict with the approved Close rule.** The implementer must replace the coarse guard and hidden-card logic rather than stacking new conditions on top.

Rollback is code-only because there is no migration. Revert the status-policy/backend/CRM commit and restart the backend manually. Existing status/history/note rows created while the feature was active remain valid audit data and must not be deleted during rollback.

## 10. Implementer handoff checklist

- [ ] Re-read this plan and current dirty-worktree diff before editing.
- [ ] Preserve unrelated user changes and generated files.
- [ ] Implement one canonical backend transition policy.
- [ ] Keep `escalated` as a status.
- [ ] Keep reason-required emergency Close available from every non-closed state.
- [ ] Ensure generic PATCH, bulk actions, and AI cannot bypass the policy.
- [ ] Keep resolution statuses evidence-only.
- [ ] Keep merge/split domain behavior intact; do not use Split as generic reopen.
- [ ] Expose and consume server-authorized actions in CRM.
- [ ] Remove generic status Undo and no-change status-history noise.
- [ ] Preserve severity/assignment behavior.
- [ ] Add focused backend and CRM tests.
- [ ] Run migration-readiness checks even though no migration is expected.
- [ ] Run real Supabase API and live Playwright CRM acceptance using fresh marked records.
- [ ] Keep retained demo fixtures unchanged.
- [ ] Update and link durable vault documentation after verification.
- [ ] Final report names changed files, commands run, real record IDs, observed status codes, and any verification that was not completed.
