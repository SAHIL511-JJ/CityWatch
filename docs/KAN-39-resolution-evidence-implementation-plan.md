# KAN-39 — Resolution Evidence and Community Verification

This document is the implementation contract for Jira ticket KAN-39. It is intentionally explicit so an implementer can complete the feature without inventing architecture, API behavior, workflow rules, or UI states.

The repository baseline inspected while writing this plan was `main` at commit `2c2d129` (`Add trend and status filters to Insights`). Re-inspect the named files before implementation because unrelated local changes already exist and the branch may advance.

## 1. Objective

CityWatch currently lets staff set an incident to `resolved`, but that status does not prove the reported condition improved. KAN-39 must introduce an auditable resolution cycle:

1. Staff records the action taken and uploads an after-photo.
2. The incident moves to `awaiting_verification`.
3. A verified citizen submits a current follow-up observation and photo.
4. Staff reviews that follow-up.
5. The incident moves to either `community_confirmed` or `needs_follow_up`.
6. CRM and Flutter show the original report, authority evidence, community evidence, and status changes in chronological order.

The feature spans Supabase Postgres, Supabase Storage, FastAPI, the Next.js CRM, and Flutter. Supabase remains the only data plane. Both clients must use FastAPI for all reads and writes.

## 2. Required repository workflow

Before changing implementation files, read `AGENTS.md` and the CityWatch vault notes `Index`, `Architecture`, `Rules-and-Conventions`, `Database`, `Backend`, `Frontend-CRM`, `Mobile`, and `Insights-Module`.

Do not create a branch or worktree until Sahil explicitly authorizes one. Once authorized, create exactly one worktree for the session and perform every KAN-39 change there. Do not merge until Sahil explicitly instructs it.

KAN-39 changes the database. The schema change must be a new file in `supabase/migrations/`. Immediately before creating it, run `Get-Date -AsUTC -Format yyyyMMddHHmmss` and name it `<returned timestamp>_kan_39_resolution_evidence.sql`. Do not edit `001_init.sql`, `002_history_actor_nullable.sql`, or `003_users_banned.sql`.

Do not apply schema changes only through an MCP or dashboard. The migration file is the source of truth. Do not push the migration directly to `main`; use the branch and PR flow unless Sahil explicitly overrides that instruction.

The current workspace contains unrelated local changes. Preserve them. Stage and commit only files that can be traced to KAN-39.

## 3. Current system facts the implementation must preserve

- `incidents` is the durable record. Hotspots are calculated dynamically and hotspot IDs can change as their contributing reports or centroid changes.
- Store `incident_id` as the required relational owner of resolution evidence. Store a hotspot ID only as optional snapshot context; never use it as the only relationship.
- `status_history` is the audit trail for every incident status transition. Its `changed_by` value is a nullable plain UUID because an actor can be a citizen, staff member, or system process.
- The `incident-photos` Supabase Storage bucket is private. Only FastAPI may upload or create signed URLs.
- Image uploads accept JPEG and PNG only and are limited by `settings.MAX_PHOTO_MB`, currently 8 MB.
- Citizen authentication uses the custom JWT and `get_current_user`. A citizen is eligible to submit community verification only when the database row has `verified = true`.
- Staff authentication uses the custom staff JWT and `get_current_staff`.
- `GET /incidents` and the existing public incident/photo endpoints expose verified reports only. KAN-39 must not weaken that feed rule.
- The CRM uses TanStack Query and `apiFetch` from `apps/crm/lib/api.ts`.
- Flutter uses Dio through `ApiClient`; its interceptor adds the citizen bearer token from secure storage.
- CRM UI uses Verdana, cream surfaces, dark green primary actions, pages rather than full-screen modal workflows, and in-app validation/toasts.
- The mobile app uses Riverpod, `CwColors`, constrained responsive pages, and `image_picker`.

## 4. Scope boundaries

### Build in KAN-39

- A durable evidence table and ORM model.
- Authority resolution evidence with an after-photo and action description.
- A citizen follow-up with a current photo and observation.
- Staff review of citizen follow-ups.
- Three new incident workflow states.
- Safe citizen-facing resolution data.
- Staff-facing evidence, review controls, and a combined timeline.
- Citizen-facing resolution status and follow-up submission.
- Private evidence-photo serving through FastAPI.
- Authorization, validation, concurrency handling, and failure states.
- Automated backend, CRM, and Flutter coverage plus live verification.

### Do not build in KAN-39

- A permanent hotspot table.
- Automatic AI approval or rejection of resolution evidence.
- Direct Flutter/CRM access to Supabase.
- Public Supabase Storage URLs or new client-side storage policies.
- Push notifications; that belongs to KAN-40.
- Offline queuing for community follow-ups. Preserve entered text and selected image after an online request failure and offer retry in the current screen.
- Comments, voting, likes, or social reputation features.
- Evidence deletion or editing. Evidence is an audit record and is immutable except for the review fields on a pending community follow-up.
- Bulk resolution evidence. A case cannot enter verification without case-specific action text and a photo.

## 5. Locked workflow decisions

Use these exact database/API values:

| Concept | Value |
|---|---|
| Authority evidence | `authority_resolution` |
| Citizen evidence | `community_follow_up` |
| Authority evidence review outcome | `not_applicable` |
| New citizen evidence outcome | `pending` |
| Accepted citizen evidence outcome | `confirmed` |
| Rejected/inconclusive citizen evidence outcome | `needs_follow_up` |
| Waiting for citizen evidence | `awaiting_verification` |
| Verified resolution | `community_confirmed` |
| More authority work required | `needs_follow_up` |

`resolved` remains a supported legacy incident status for existing records. New work must not use the generic status controls to create a new `resolved` state. The evidence workflow replaces that shortcut.

Community evidence never closes a case automatically. A verified citizen supplies evidence; a staff member makes the final decision.

Any authenticated citizen may read the safe resolution view when they know the incident ID. Only a verified citizen may submit a follow-up. This matches the existing community model while preventing anonymous/unverified accounts from deciding outcomes.

One citizen may have only one pending follow-up for the same incident and authority-resolution cycle. After staff reviews it, that citizen may participate in a later cycle.

## 6. State machine

Implement these transitions and reject every invalid transition with HTTP 409:

| Actor/action | Allowed current incident statuses | New incident status |
|---|---|---|
| Staff submits authority evidence | `verified`, legacy `resolved`, `needs_follow_up` | `awaiting_verification` |
| Verified citizen submits follow-up | `awaiting_verification` | unchanged (`awaiting_verification`) |
| Staff confirms pending follow-up | `awaiting_verification` | `community_confirmed` |
| Staff requests more work from pending follow-up | `awaiting_verification` | `needs_follow_up` |

Additional rules:

- An incident already in `awaiting_verification` cannot receive another authority-resolution record.
- A citizen follow-up must reference the most recent `authority_resolution` evidence for that incident.
- A citizen follow-up cannot reference authority evidence from a different incident.
- Only a `pending` `community_follow_up` can be reviewed.
- A reviewed follow-up cannot be reviewed again. Return 409 rather than silently succeeding.
- Review and incident transition must happen in one database transaction.
- Authority evidence creation and transition to `awaiting_verification` must happen in one database transaction after the photo upload succeeds.
- Citizen evidence creation must not change the incident status.
- Every actual incident status change creates exactly one `status_history` row with the actor UUID and timestamp.
- No status-history row is created for a citizen follow-up because that submission does not change status.

## 7. Database migration

Create `resolution_evidence` with these columns:

| Column | SQL type | Nullability/default | Purpose |
|---|---|---|---|
| `id` | UUID | primary key, `gen_random_uuid()` | Stable evidence ID |
| `incident_id` | UUID | required, FK to `incidents(id)` with `ON DELETE CASCADE` | Durable case relationship |
| `parent_evidence_id` | UUID | nullable, self-FK with `ON DELETE CASCADE` | Community follow-up’s authority-resolution cycle |
| `hotspot_snapshot_id` | TEXT | nullable | Optional derived hotspot ID at submission time |
| `evidence_type` | TEXT | required | `authority_resolution` or `community_follow_up` |
| `submitted_by` | UUID | required | Plain UUID of staff or citizen actor |
| `note` | TEXT | required | Authority action or citizen observation |
| `photo_url` | TEXT | required | Private bucket path returned by storage helper |
| `review_outcome` | TEXT | required | One of the four evidence outcomes above |
| `review_note` | TEXT | nullable | Staff explanation of review decision |
| `reviewed_by` | UUID | nullable | Plain UUID of reviewing staff member |
| `reviewed_at` | TIMESTAMPTZ | nullable | Review timestamp |
| `created_at` | TIMESTAMPTZ | required, default `now()` | Submission timestamp |

Use plain UUIDs for `submitted_by` and `reviewed_by`; do not add a polymorphic foreign key. This matches `status_history.changed_by` and preserves the actor identifier even though the actor can come from either `users` or `staff`.

Add database checks:

- `evidence_type` is one of `authority_resolution`, `community_follow_up`.
- `review_outcome` is one of `not_applicable`, `pending`, `confirmed`, `needs_follow_up`.
- `char_length(trim(note))` is between 1 and 2000.
- `review_note` is null or its trimmed length is between 1 and 2000.
- `authority_resolution` rows have `parent_evidence_id IS NULL` and `review_outcome = 'not_applicable'`.
- `community_follow_up` rows have a non-null `parent_evidence_id` and cannot use `not_applicable`.
- Pending rows have null `review_note`, `reviewed_by`, and `reviewed_at`.
- Reviewed community rows have non-null `reviewed_by` and `reviewed_at`.

Add indexes:

- `(incident_id, created_at)` for timelines.
- `(parent_evidence_id, created_at)` for one resolution cycle.
- `(review_outcome, created_at)` for staff pending-review queries.
- A partial unique index on `(incident_id, parent_evidence_id, submitted_by)` where `evidence_type = 'community_follow_up' AND review_outcome = 'pending'`.

Do not add RLS. The backend service key and FastAPI authorization are the security boundary in this repository.

## 8. ORM and shared backend constants

In `apps/backend/app/models.py`:

- Add a `ResolutionEvidence` SQLAlchemy model matching every migration column.
- Use `String(36)` for UUID-shaped identifiers to match the current ORM style.
- Use `DateTime` for timestamps, `Text` for notes/paths/types, and `ForeignKey` only for `incident_id` and `parent_evidence_id`.
- Do not add relationships unless they eliminate repeated query code; direct explicit queries match the current project style.

In a focused new module `apps/backend/app/resolution_evidence.py`:

- Define the evidence type, review outcome, and incident workflow value sets.
- Implement photo validation shared by both submission endpoints.
- Implement evidence serialization for staff and citizen responses.
- Implement a helper that adds one `StatusHistory` entry only when the status changes.
- Implement lookup of the latest authority evidence ordered by `created_at DESC, id DESC`.
- Implement ordering of evidence by `created_at ASC, id ASC` for deterministic timelines.
- Keep route declarations in `main.py` to match the current codebase; keep workflow/data helpers in this module so `main.py` does not grow another large block of inline logic.

In `apps/backend/app/auth.py`, add a narrowly scoped `get_verified_current_user` dependency for the citizen submission route. It must use the existing bearer token/database lookup, reject a token carrying a staff `role` claim as 403, retain the existing banned-user check, and return 403 when `user.verified` is false. Read-only citizen resolution routes continue to use `get_current_user` so anonymous citizens can view safe evidence.

Update all existing status lists and terminal-status logic:

- `apps/backend/app/main.py`: generic patch validation, `BULK_STATUS`, staff open-count query, analytics resolved counts, Insights status validation, and any status-based filters.
- Generic `PATCH /admin/incidents/{id}` must reject direct attempts to set `resolved`, `awaiting_verification`, `community_confirmed`, or `needs_follow_up` with HTTP 409 and the message `use the resolution evidence workflow`.
- Remove `resolved` from bulk status actions. Bulk actions cannot provide evidence.
- Treat `community_confirmed` as resolved/terminal in dashboard clearance metrics and staff open-count calculations.
- Treat `awaiting_verification` and `needs_follow_up` as open/actionable.
- Preserve legacy `resolved` in reads, filters, metrics, and as an allowed starting point for the new workflow.

## 9. Storage behavior

Use the existing private `incident-photos` bucket through `get_storage()`.

For both authority and citizen submissions:

1. Validate filename/content type before reading the file.
2. Read bytes once.
3. Reject an empty file with 400.
4. Reject unsupported content types with 400 using the existing `only jpg/png allowed` wording.
5. Reject files over `settings.MAX_PHOTO_MB` with 400 using the existing size wording.
6. Generate the evidence UUID before upload.
7. Upload to `resolution-evidence/{incident_id}/{evidence_id}{extension}`.
8. Save the returned bucket path in `resolution_evidence.photo_url`.
9. If upload fails, return 502 and do not create evidence, status history, or an incident transition.
10. If the database commit fails after upload, log the orphaned object key without exposing credentials. Do not claim the workflow succeeded.

Do not overwrite evidence objects. Each evidence row has a unique object key.

## 10. API contracts

All JSON timestamps are ISO 8601 strings. All IDs are strings. Error bodies use FastAPI’s existing `{ "detail": "message" }` shape.

### 10.1 Staff submits authority evidence

`POST /admin/incidents/{incident_id}/resolution-evidence`

Authentication: staff bearer token.

Content type: `multipart/form-data`.

Fields:

- `action_taken`: required trimmed string, 1–2000 characters.
- `photo`: required JPEG or PNG, non-empty, at most configured maximum.
- `hotspot_snapshot_id`: optional trimmed string, maximum 255 characters.

Success: HTTP 201 with the updated incident status and complete staff evidence object.

Failure cases:

- 400 invalid/empty/oversized photo or invalid text.
- 401 missing/invalid token.
- 403 non-staff token.
- 404 incident not found.
- 409 invalid current incident state or authority cycle already waiting.
- 502 storage failure.

On success, create the evidence row with `evidence_type = authority_resolution`, `review_outcome = not_applicable`, `submitted_by = staff.id`, then transition the incident to `awaiting_verification` and add one history row.

### 10.2 Staff reads evidence

`GET /admin/incidents/{incident_id}/resolution-evidence`

Authentication: staff bearer token.

Success: HTTP 200 with all evidence ordered oldest first. Staff objects may include `submitted_by`, `reviewed_by`, `review_note`, and `hotspot_snapshot_id`. Do not invent display names in the backend; the CRM may resolve staff UUIDs through its existing staff directory. Label citizen actors as `Community member` unless an approved safe identity field already exists.

Also add this same ordered list as `resolution_evidence` in the existing `GET /admin/incidents/{incident_id}` response so the CRM incident page needs only one initial detail request.

### 10.3 Staff serves an evidence photo

`GET /admin/resolution-evidence/{evidence_id}/photo`

Authentication: accept the existing CRM photo pattern: `?token=` or bearer header, validate that the token belongs to a current staff row, then return a 302 redirect to a short-lived signed Supabase URL.

Return 404 for a missing evidence row, missing photo path, invalid bucket path, or unavailable storage configuration. Never return the raw service key or permanent public URL.

### 10.4 Citizen reads safe resolution data

`GET /incidents/{incident_id}/resolution`

Authentication: any valid citizen bearer token, including anonymous users.

Success response contains:

- Safe incident fields: `id`, `title`, `description`, `lat`, `lng`, `address`, `status`, `severity`, `created_at`.
- `can_submit_follow_up`: true only when the incident is `awaiting_verification`, the current user is verified, and that user has no pending follow-up for the current authority cycle.
- Safe evidence objects ordered oldest first.
- Safe status-history objects ordered oldest first, with `changed_by` omitted.

Safe evidence objects contain `id`, `evidence_type`, `note`, `review_outcome`, `review_note` only when outcome is no longer pending, `created_at`, `reviewed_at`, and `has_photo`. They must omit `submitted_by`, `reviewed_by`, `hotspot_snapshot_id`, staff email, phone, device ID, assignment, and internal notes.

Return 404 when the incident has no authority-resolution evidence. This prevents the endpoint from becoming a second general incident-detail API.

### 10.5 Citizen serves an evidence photo

`GET /resolution-evidence/{evidence_id}/photo`

Authentication: citizen bearer token.

Only serve evidence belonging to an incident that has authority-resolution evidence. Apply the same private signed-URL behavior as the staff endpoint. The response reveals no actor identity.

### 10.6 Citizen submits a follow-up

`POST /incidents/{incident_id}/resolution-evidence`

Authentication: citizen bearer token plus `user.verified == true`.

Content type: `multipart/form-data`.

Fields:

- `observation`: required trimmed string, 1–2000 characters.
- `photo`: required JPEG or PNG, non-empty, at most configured maximum.

Success: HTTP 201 with the safe evidence object. Set `parent_evidence_id` to the latest authority-resolution evidence, `evidence_type = community_follow_up`, `review_outcome = pending`, and `submitted_by = user.id`.

Failure cases:

- 400 invalid observation/photo.
- 401 missing/invalid citizen token.
- 403 staff token, banned user, or unverified citizen.
- 404 incident or authority evidence not found.
- 409 incident not awaiting verification, or the same citizen already has a pending follow-up for the current cycle.
- 502 storage failure.

### 10.7 Staff reviews a citizen follow-up

`PATCH /admin/resolution-evidence/{evidence_id}`

Authentication: staff bearer token.

JSON body:

- `outcome`: exactly `confirmed` or `needs_follow_up`.
- `review_note`: optional for `confirmed`; required and 1–2000 trimmed characters for `needs_follow_up`.

Success: HTTP 200 with the reviewed staff evidence object and the updated incident status.

Use a row lock or an atomic conditional update so two operators cannot review the same pending evidence twice. In the same transaction:

- Set `review_outcome`, `review_note`, `reviewed_by`, and `reviewed_at`.
- Set incident status to `community_confirmed` for confirmed evidence or `needs_follow_up` otherwise.
- Add one `status_history` record with `changed_by = staff.id`.

Return 409 when the evidence is not a pending community follow-up or the incident is no longer awaiting verification.

### 10.8 Owner-safe incident lookup

`GET /me/incidents/{incident_id}`

Authentication: citizen bearer token.

Return the safe incident fields for any status only when `incident.reporter_id == user.id`. Include the same safe resolution evidence and safe history shape used by the resolution endpoint. Return 404 for a different user’s incident so ownership is not disclosed.

Switch Flutter My Reports status refresh to this endpoint. This fixes the current behavior where a report stops being readable as soon as it leaves `verified`.

## 11. Backend implementation sequence

### Step 1 — Migration and model

Create the timestamped KAN-39 migration and `ResolutionEvidence` ORM model. Verify column names, nullability, checks, foreign keys, and indexes match exactly. Import the model wherever metadata discovery requires it.

Success check: the SQL migration is reviewable by itself and no existing migration changed.

### Step 2 — Workflow helpers

Create `resolution_evidence.py` with validation, serialization, latest-cycle lookup, deterministic ordering, safe-response shaping, photo-key extraction, and status-transition helpers.

Success check: helper tests cover all evidence/status values without starting a server.

### Step 3 — Routes

Add all eight contracts above to `main.py`. Keep route functions thin and call the helper module. Use `Form`, `File`, and `UploadFile` for submissions. Use Pydantic request/response models for the review body and documented JSON outputs.

Success check: OpenAPI shows correct authentication, multipart fields, response types, and status codes.

### Step 4 — Existing status behavior

Update generic patch/bulk validation, analytics, staff workload counts, incident filtering, and Insights status support. The Insights CRM filter must add Awaiting verification, Community confirmed, and Needs follow-up while keeping legacy Resolved.

Success check: no UI or API can create a new evidence-free resolved state through generic controls.

### Step 5 — Backend tests

Add `apps/backend/tests/test_resolution_evidence.py`. Use the existing `unittest`, `TestClient`, dependency override, and `unittest.mock` conventions. Do not require a local SQLite fallback.

Success check: focused tests and the entire backend test suite pass.

## 12. CRM implementation

### 12.1 Types and API helper

In `apps/crm/lib/types.ts`:

- Add the three new values to `IncidentStatus`.
- Add `ResolutionEvidenceType`, `ResolutionReviewOutcome`, `ResolutionEvidence`, and the staff response types.
- Add `resolution_evidence` to `IncidentDetail`.

In `apps/crm/lib/api.ts`, make `apiFetch` support `FormData` correctly:

- If `body` is a `FormData`, do not set `Content-Type`; the browser must add the multipart boundary.
- Continue adding the bearer token.
- Preserve current JSON behavior for all other requests.

### 12.2 Incident list and shared status presentation

Update `apps/crm/app/incidents/page.tsx`, `apps/crm/components/ui/badge.tsx`, SLA helpers, and dashboard metrics:

- Add readable labels/colors for the three new states.
- Add new states to filters.
- Remove the bulk Resolve action.
- Treat `community_confirmed` as terminal/resolved.
- Treat `awaiting_verification` as waiting on community evidence.
- Treat `needs_follow_up` as staff-actionable and high visibility.

### 12.3 Incident detail resolution section

Add a dedicated `Resolution verification` section to `apps/crm/app/incidents/[id]/page.tsx`. Keep it on the page; do not create a modal-only flow.

For an eligible case without an active authority cycle, show:

- A short explanation that evidence is required before community verification.
- `Action taken` textarea with character count.
- Required JPEG/PNG picker.
- Local image preview, filename, and remove/replace control.
- Optional hotspot snapshot value only when navigation supplied it; do not ask staff to type a hotspot ID.
- Primary button `Submit evidence and request verification`.
- Inline validation, upload progress/pending state, retry after failure, and success toast.

For `awaiting_verification`, show the latest authority evidence prominently and a clear Waiting for community verification state. Disable duplicate authority submission.

For each pending citizen follow-up, show its photo, observation, submission time, and two explicit actions:

- `Confirm resolution` opens an in-page confirmation area with an optional note.
- `Needs follow-up` requires a review note before enabling submission.

After review, replace controls with the outcome, reviewer display name resolved through the staff list, review note, and review time.

### 12.4 Before/after and timeline

Show the original incident photo and latest authority after-photo as a responsive comparison:

- Two columns on wide screens.
- One vertical sequence on narrow screens.
- Clear `Before — citizen report` and `After — authority evidence` labels.
- Fixed aspect ratio, `object-cover`, loading skeletons, broken-image fallback, and click-to-expand behavior matching the existing lightbox.

Build a unified case timeline by combining status-history entries and resolution-evidence entries, sorting by timestamp and stable ID. Each item must state whether it came from the system, authority, or community without displaying raw UUIDs. Keep internal notes in their existing separate staff-only section.

### 12.5 Query invalidation

After authority submission or review, invalidate:

- `admin-incident` detail query for the current ID.
- `admin-incidents` lists.
- `admin-insights` queries.
- dashboard summary and hotspot queries.
- staff directory/open-count query.

Do not optimistically claim a final status before the server transaction succeeds.

## 13. Flutter implementation

### 13.1 Models and API methods

In `apps/mobile/lib/api_client.dart` add typed models for safe resolution cases and evidence. Add methods:

- `fetchMyIncident(id)` using `GET /me/incidents/{id}`.
- `fetchResolution(id)` using `GET /incidents/{id}/resolution`.
- `submitCommunityFollowUpBytes` using multipart bytes, consistent with web support.
- `submitCommunityFollowUpFile` using `XFile` on native targets when the screen receives a native file.
- `fetchResolutionEvidencePhotoBytes(evidenceId)` using the authenticated Dio client.

Map 403 unverified responses to clear user-facing copy instead of exposing raw Dio exceptions.

### 13.2 My Reports

Update `my_reports_screen.dart`:

- Refresh status through `fetchMyIncident`, not the verified-only public endpoint.
- Make sent report rows tappable.
- Open a new `MyReportDetailScreen` that loads the owner-safe record and all resolution information.
- Preserve the last displayed status if refresh temporarily fails, while showing a retry affordance.

### 13.3 Citizen resolution experience

Create `apps/mobile/lib/screens/my_report_detail_screen.dart` or a narrowly shared resolution widget used by both owner and neighborhood detail pages.

Display:

- Current resolution status with human wording.
- Original report details/photo.
- Authority action and after-photo.
- Community follow-ups and review outcomes.
- Combined evidence/status timeline.
- `Add a follow-up observation` only when `can_submit_follow_up` is true.

The follow-up form must include:

- Safety copy instructing the citizen not to approach a dangerous condition.
- Required observation text with a 2000-character limit.
- Camera/gallery selection via the existing `image_picker` dependency.
- Required image preview and replace/remove control.
- Disabled submit until inputs are valid.
- Visible upload state that prevents double taps.
- Inline error with Retry; retain text and photo when the request fails.
- Success state explaining that staff will review the evidence.

If the account is anonymous/unverified, show `Verify your account to submit follow-up evidence` and route to the existing verification experience. Reading safe evidence remains allowed.

Do not add another bottom-navigation destination.

## 14. Automated test matrix

### 14.1 Migration/model

- Migration creates the expected table and indexes.
- Invalid evidence type fails.
- Invalid review outcome fails.
- Blank or overlong note fails.
- Authority evidence with a parent fails.
- Community evidence without a parent fails.
- A second pending row for the same incident/cycle/citizen fails.
- Deleting an incident cascades its evidence.

### 14.2 Backend endpoint tests

- Staff submission requires staff auth.
- Staff submission returns 404 for a missing incident.
- Each invalid starting state returns 409.
- Missing, empty, unsupported, and oversized images return 400.
- Storage failure returns 502 and leaves status/history unchanged.
- Successful staff submission writes correct evidence, status, actor, and one history row.
- Citizen read requires citizen auth and omits every private actor/staff field.
- Owner-safe endpoint returns all statuses only to the owning reporter.
- Unverified citizen cannot submit follow-up.
- Banned citizen cannot submit follow-up.
- Citizen cannot submit when incident is not awaiting verification.
- Citizen follow-up links to the latest authority evidence.
- Duplicate pending submission returns 409.
- Citizen upload failure creates no row.
- Staff review accepts only pending community evidence.
- Confirm review updates evidence, incident, and history atomically.
- Needs-follow-up review requires a note.
- Second/concurrent review returns 409.
- Staff photo endpoint rejects citizen tokens.
- Citizen photo endpoint rejects staff tokens and missing tokens.
- Both photo endpoints sign only valid private-bucket paths.
- Generic patch and bulk APIs cannot bypass evidence requirements.
- Dashboard/staff counts treat `community_confirmed` as terminal.
- Existing incident, hotspot, Insights, and analytics tests remain green.

### 14.3 CRM tests

Add focused browser coverage with `@playwright/test`. At implementation time, install the current release as a CRM dev dependency and commit the resulting `package.json` and lockfile changes. Add `apps/crm/playwright.config.ts` without a `webServer` block, because CityWatch server processes are managed manually under the one-process rule. Use `PLAYWRIGHT_BASE_URL`, defaulting to `http://localhost:3000`. Add the script `test:ui` with value `playwright test`. Put KAN-39 coverage in `apps/crm/tests/kan39-resolution-evidence.spec.ts`; mock backend responses with `page.route`, seed `crm_staff_token` in local storage before navigation, and inspect the multipart request in the submission test. Keep the live Supabase flow in Section 15 separate from deterministic mocked UI tests.

- Eligible incident shows authority form.
- Form blocks missing action/photo and overlong action.
- Multipart request contains the exact fields.
- Upload pending state prevents duplicate submission.
- Failed upload retains entered action and photo preview.
- Awaiting state shows before/after and no duplicate staff form.
- Pending citizen evidence shows both review actions.
- Needs-follow-up cannot submit without a review note.
- Successful review updates badge and timeline.
- Private/raw actor UUIDs do not render.
- Narrow and wide viewport layouts do not overflow.

### 14.4 Flutter widget/API tests

Extend the current fake `ApiClient` pattern.

- My Reports uses the owner endpoint and remains readable in every new state.
- Anonymous citizen can read safe resolution evidence but sees verification CTA.
- Verified citizen sees follow-up CTA only when the API says it is allowed.
- Form requires observation and photo.
- Failed submission keeps both fields and exposes Retry.
- Double tap produces one API call.
- Success replaces the form with pending-review feedback.
- Before/after content and timeline render at phone and 760px constrained widths.
- No private uploader/reviewer IDs render.

## 15. Live verification procedure

Use the shared Supabase-backed environment. Never create test evidence through direct SQL.

1. Confirm the migration has been applied through the repository migration workflow.
2. Kill the existing backend process.
3. Verify zero `spawn_main` Python processes and zero listeners on port 8000.
4. Start exactly one backend from `apps/backend` with the configured `.venv`; never use `--reload`.
5. Start the CRM only if port 3000 has no listener.
6. Launch Flutter using the documented web verification flow only if no conflicting server exists.
7. Create a uniquely marked KAN-39 test incident through the authenticated public multipart API with a real image.
8. Let the normal AI/staff workflow bring it to an eligible state.
9. In CRM, submit authority action and after-photo.
10. Inspect the API request, response, stored evidence path, incident state, and history entry.
11. In Flutter, open the report, verify before/after evidence, and submit a citizen follow-up from a verified account.
12. In CRM, confirm the follow-up; verify `community_confirmed`, review metadata, and one new history entry.
13. Run a second cycle on a separate marked incident and choose Needs follow-up; verify note enforcement and `needs_follow_up`.
14. Exercise missing photo, oversized photo, unverified citizen, repeat submission, and failed-network states.
15. Check CRM console for zero application errors and inspect failed network requests.
16. Check Flutter logs for uncaught exceptions and visually inspect phone and 760px layouts.
17. Confirm public/citizen responses contain no staff email, staff UUID, reporter UUID, device ID, phone, assignment, internal note, token, or Supabase URL.
18. Remove local screenshots, auth-state files, and Playwright output. Do not delete retained shared demo fixtures.

## 16. Acceptance-criteria traceability

| Jira acceptance criterion | Concrete proof |
|---|---|
| Migration supports evidence metadata, uploader, timestamp, and incident/hotspot relationship | Timestamped KAN-39 migration, ORM model, migration review, optional hotspot snapshot plus required incident FK |
| Staff can request verification, upload evidence, and move through outcomes | Authority multipart endpoint, CRM form, review endpoint, state-machine tests |
| Public users see safe status and submit follow-up evidence | Safe resolution API, owner API, authenticated photo API, Flutter detail/form, privacy tests |
| Before/after evidence and status changes appear in timeline | CRM comparison and unified timeline, Flutter comparison and timeline, browser/widget checks |
| API, migration, CRM, and Flutter tests cover authorization and failure paths | Test suites in Section 14 and live checks in Section 15 |

## 17. Definition of done

KAN-39 is complete only when all of the following are true:

- A new timestamped KAN-39 migration exists and no applied migration was edited.
- Schema and ORM match.
- Every API contract in Section 10 is implemented.
- Invalid workflow transitions cannot bypass evidence requirements.
- Storage remains private and backend-only.
- CRM provides polished authority submission, review, before/after, and timeline states.
- Flutter provides safe viewing and verified-citizen follow-up submission.
- Private actor and staff data never appears in citizen responses or UI.
- Backend focused and full suites pass.
- CRM type/build checks and focused UI tests pass.
- Flutter analyze and widget tests pass.
- Live Supabase-backed end-to-end confirmation and needs-follow-up paths pass.
- Browser console and Flutter logs contain no application errors.
- Temporary verification artifacts are removed.
- Durable architecture/API facts learned during implementation are written to the CityWatch vault through MCP and linked from `Index`; progress notes and changelogs are not stored there.
- The diff contains only KAN-39 work and is reviewable.
- Sahil has reviewed the concrete result before merge.
- After merge, KAN-39 is transitioned to Done in Jira and the one authorized worktree/branch is removed.

## 18. Execution order for the implementing model

Follow this order without skipping ahead:

1. Read repository instructions and vault context.
2. Confirm Sahil authorized the one worktree; create it only if authorized.
3. Capture the current UTC migration timestamp.
4. Write migration and ORM model.
5. Write backend workflow helpers and tests.
6. Add routes and status integration; run backend tests.
7. Add CRM types/FormData support, then UI and CRM tests; run type/build checks.
8. Add Flutter models/API, owner detail, resolution UI, and widget tests; run analyze/tests.
9. Review the complete diff for privacy and scope.
10. Apply/deploy through the approved migration and PR flow.
11. Restart exactly one backend and verify the full live flow.
12. Update durable vault contracts through MCP.
13. Present the tested implementation to Sahil for merge approval.
14. Merge only after Sahil explicitly says so.
15. Verify the merge, move KAN-39 to Done, and clean up the authorized worktree/branch.

If code behavior, the Jira description, and this plan conflict, stop before mutating data or broadening scope. Re-read the current repository and ticket, then ask Sahil about the specific conflict. Do not silently choose a different workflow.
