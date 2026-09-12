# Community Verification from Flutter — Implementation Plan

## 1. Objective

Plan-only handoff for a cheaper implementation model.

Allow a nearby Flutter user to submit a community follow-up without OTP/account verification after staff has added authority evidence. The user discovers the form from the public incident detail, not **My reports**. Only CRM staff can transition the incident to `community_confirmed`.

The intended lifecycle is:

```text
Authority evidence → awaiting_verification → one community photo + note
→ staff CRM review → community_confirmed | needs_follow_up
```

## 2. Current state

- `apps/mobile/lib/screens/incident_detail_screen.dart` is the public **Neighborhood report** screen. It receives a feed snapshot and renders a hard-coded `VERIFIED` chip; it has no resolution lookup or follow-up CTA.
- `apps/mobile/lib/screens/resolution_detail_screen.dart` already implements the community note/photo form but is reachable only from `MyReportsScreen` and loads owner-only `GET /me/incidents/{id}`.
- `apps/backend/app/main.py` already provides safe citizen resolution routes:
  - `GET /incidents/{id}/resolution`
  - `POST /incidents/{id}/resolution-evidence`
  - `GET /resolution-evidence/{evidence_id}/photo`
- The POST currently requires `get_verified_current_user`; the resolution-read response currently sets `can_submit_follow_up` only for verified users.
- `GET /incidents`, `GET /incidents/{id}`, and `GET /incidents/{id}/photo` accept only exact status `verified`. An incident moved to `awaiting_verification` disappears from a fresh public Flutter view.
- The existing `resolution_evidence` table, status history, and Supabase Storage evidence-photo workflow already support this feature. No schema change is needed.

### Worktree warning

The working tree is dirty. `apps/mobile/lib/screens/feed_screen.dart` and `apps/mobile/test/widget_test.dart` have user edits; `incident_detail_screen.dart` and `hotspot_detail_screen.dart` are untracked. Preserve those changes. Never reset, discard, or wholesale-replace them.

## 3. Scope

### In scope

- Surface `awaiting_verification` reports in the existing Flutter feed.
- Add a status-aware resolution card and CTA on public incident detail.
- Reuse the existing resolution form in a public/community mode.
- Let an existing anonymous CityWatch device session submit one follow-up per authority-evidence cycle.
- Keep existing CRM review as the only route to `community_confirmed`.
- Add focused automated tests, update relevant API documentation, and perform real API/UI verification.

### Explicit non-goals

- No database migration, new storage bucket, or direct Supabase access from Flutter.
- No full account system, OTP changes, notification system, or new bottom-navigation item.
- No Flutter action that directly confirms a resolution.
- No CRM implementation changes.
- No multiple pending community follow-ups for one authority-evidence cycle.

## 4. Facts, assumptions, and blockers

### Confirmed facts

- Flutter boot already creates an anonymous `device_id` JWT when no session exists.
- `get_current_user` continues to reject staff tokens and banned citizens.
- Resolution serializers omit reporter IDs, device IDs, staff identities, assignment, internal notes, and storage keys.
- The CRM already reviews a pending community follow-up and writes both status history and the final status.

### Working assumptions

- “Anyone” means any citizen with the app’s existing anonymous JWT, not an unauthenticated API caller. Missing tokens remain `401`.
- The first valid community follow-up wins for a resolution cycle. This avoids conflicting evidence and the existing problem of unreviewable extra pending records after one staff confirmation.
- Public incident visibility expands to `verified` and `awaiting_verification` only. `community_confirmed`, `needs_follow_up`, and private resolution metadata stay out of the general public feed.

### Blockers

None.

## 5. Acceptance criteria

- A nearby `awaiting_verification` incident appears in Flutter with **Needs community verification**, while a normal verified incident remains labelled **Verified**.
- Public incident detail shows its current status. For `awaiting_verification`, it shows an authority-update card and **Verify this resolution** CTA.
- A non-verified anonymous CityWatch session can submit a required current observation and JPEG/PNG photo.
- The submission creates one `community_follow_up` evidence row with `pending` outcome and leaves the incident at `awaiting_verification`.
- A second citizen session cannot submit another follow-up for that authority-evidence cycle; it receives HTTP `409` and Flutter shows a neutral “A community follow-up is awaiting staff review” state.
- Flutter never offers a direct **Community confirmed** action.
- Existing staff CRM confirmation still changes status to `community_confirmed`, writes one status-history row, and removes the incident from the active public feed.
- Public responses continue to omit identity, assignment, internal notes, and permanent storage URLs.
- Loading, retry, empty/no-resolution, submission failure, and narrow mobile layouts remain usable.

## 6. Change map

| Path | Region | Required change |
|---|---|---|
| `apps/backend/app/main.py` | public incident/photo routes; citizen resolution routes | Define public-visible statuses; allow anonymous citizen submission while preserving staff/banned checks. |
| `apps/backend/app/resolution_evidence.py` | `current_pending_follow_up` | Make pending lookup authority-cycle-wide instead of per submitting user. |
| `apps/backend/tests/test_resolution_evidence.py` | new/expanded endpoint tests | Cover anonymous submission, global duplicate prevention, public visibility, and safe serialization. |
| `apps/mobile/lib/api_client.dart` | `fetchFeed`, resolution methods | Keep awaiting records in feed; add a nullable public-resolution loader. |
| `apps/mobile/lib/screens/feed_screen.dart` | `_card` | Replace hard-coded verified chip with status-aware labels. |
| `apps/mobile/lib/screens/incident_detail_screen.dart` | `IncidentDetailScreen` | Fetch safe resolution state, display CTA/state cards, refresh after form submission. |
| `apps/mobile/lib/screens/resolution_detail_screen.dart` | loader, app bar, form gate | Add owner/community source mode; remove verified-account form gate for the community source. |
| `apps/mobile/test/community_verification_flow_test.dart` | new file | Focused widget coverage without overwriting user-modified general tests. |
| `README.md` | citizen endpoint summary | Correct public-visibility wording. |
| `apps/mobile/README.md` | feed API documentation | Document verified plus awaiting-verification public visibility. |
| `supabase/migrations/` | none | Do not create or edit a migration. |
| `apps/backend/app/auth.py` | none | Reuse `get_current_user`; do not weaken staff/banned checks. |
| `apps/mobile/lib/screens/my_reports_screen.dart` | none expected | Keep existing owner-report entry point; it is not the public community entry point. |

## 7. Ordered implementation steps

### Step 1 — Define safe public-visible statuses

**Location:** `apps/backend/app/main.py`, near the existing status constants; `list_incidents`, `get_incident`, and `public_photo`.

**Change:** Add one named set, for example:

```python
PUBLIC_CITIZEN_INCIDENT_STATUSES = {"verified", "awaiting_verification"}
```

Use it in all three public incident routes. `GET /incidents` must query both values, and detail/photo routes must accept either value.

**Contract:** Retain `public_incident_out()` exactly as the safe response shape. The original report photo may remain public for awaiting cases because the report was already public when verified. Do not add authority evidence, reporter identity, staff assignment, or internal notes to these routes.

**Edge cases:** `community_confirmed`, `needs_follow_up`, `closed`, `rejected`, and `processing` still return 404/not listed. `GET /hotspots` remains unchanged because it intentionally derives only from verified observations.

**Verification:** Focused backend tests prove verified + awaiting are returned, while terminal/non-public statuses are not.

### Step 2 — Remove only the verified-account gate and make follow-up pending state global

**Location:** `apps/backend/app/resolution_evidence.py::current_pending_follow_up`; `apps/backend/app/main.py::{get_incident_resolution, submit_citizen_resolution_evidence, get_my_incident}`.

**Change:** Remove `user_id` from `current_pending_follow_up` so it checks for any `pending` community follow-up for the latest authority evidence cycle. Update all callers.

Change `submit_citizen_resolution_evidence` to depend on `get_current_user` rather than `get_verified_current_user`. Remove `user.verified` from both `can_submit_follow_up` calculations.

**Contract:**

- Valid anonymous citizen + awaiting incident + authority evidence + no pending follow-up → HTTP `201`.
- Missing/invalid token → `401`; staff token or banned citizen → `403`.
- Missing evidence/incident → `404`.
- Any existing pending community follow-up in the current cycle → `409`.
- Input and storage validation remain unchanged: note 1–2000 characters, non-empty JPEG/PNG, configured size limit, photo upload through FastAPI only.

**Edge cases:** Keep the existing incident row lock before checking/creating the follow-up. It serializes simultaneous submissions so only one can win.

**Verification:** Two distinct anonymous test users submit against the same authority cycle; first returns `201`, second returns `409`.

### Step 3 — Adapt Flutter API helpers

**Location:** `apps/mobile/lib/api_client.dart`.

**Change:**

- Change the `fetchFeed()` client-side status guard to retain `verified` and `awaiting_verification`.
- Add `fetchResolutionIfAvailable(id)` that returns `null` for a `404` response and rethrows every other error.
- Keep the existing authenticated `fetchResolution`, `submitResolutionFollowUp`, and resolution-photo methods.

**Contract:** The app can distinguish “this report has no resolution workflow” from network/auth failure without hiding the regular report.

**Verification:** Unit-test the nullable 404 behavior if the project’s Dio fakes support it; otherwise cover it through widget tests using a fake API client.

### Step 4 — Make public incident detail status-aware

**Location:** `apps/mobile/lib/screens/incident_detail_screen.dart::IncidentDetailScreen`.

**Change:** Convert it to a stateful consumer widget. Load `fetchResolutionIfAvailable(incident.id)` once on entry and refresh after returning from the resolution route.

Keep the current report content visible while resolution data loads. Replace the fixed `VERIFIED` chip with the current resolution status when available.

Render these additional states:

- `awaiting_verification`: amber **Needs community verification** chip; authority-update card; **Verify this resolution** CTA.
- `community_confirmed`: green completion card and read-only **View resolution** action.
- `needs_follow_up`: clear “More authority work is needed” state, without a submission CTA.
- no resolution (`404`): existing public report UI.
- transient resolution-request failure: preserve the report and show a small retry affordance.

**Interaction:** The CTA pushes `ResolutionDetailScreen` in community mode. When the child route returns successful submission, refresh resolution data and show the pending-review state.

**Verification:** Widget test CTA visibility, route navigation, loading fallback, and retry/error copy at phone width.

### Step 5 — Reuse the existing form as a community screen

**Location:** `apps/mobile/lib/screens/resolution_detail_screen.dart::ResolutionDetailScreen`.

**Change:** Add an explicit source/mode parameter:

- `owner` (default): existing `fetchMyIncident` behavior for My reports.
- `community`: use `fetchResolution` and title the route **Verify resolution** while action is available.

Normalize the two existing response shapes: owner responses may nest `resolution`; public resolution responses carry `incident`, `evidence`, `history`, and `can_submit_follow_up` at top level.

Remove only the verified-account UI gate in the follow-up form. Remove unused `authProvider`/`VerifyScreen` imports if they become unused. Keep safety copy, required note/photo, camera/gallery selection, image preview, disabled submit, upload progress, error retry, and success refresh.

When submission is no longer allowed because another citizen already submitted, display:

> A community follow-up is awaiting staff review.

Do not claim it belongs to the current device.

**Verification:** Community-mode fixture shows authority evidence, required form fields, and no OTP button. Owner mode remains able to display an ordinary report safely.

### Step 6 — Make feed labels truthful

**Location:** `apps/mobile/lib/screens/feed_screen.dart::_card`.

**Change:** Replace the fixed “✓ Verified” chip:

- `verified` → **Verified**
- `awaiting_verification` → **Needs community verification**

Do not add a navigation destination or a separate My reports path. Tapping the existing card remains the community entry point.

**Verification:** A feed fixture with both statuses renders both labels and opens the same public detail screen.

### Step 7 — Tests and documentation

**Location:** backend/mobile tests and README files named in the change map.

**Change:** Add focused regression coverage and update the public API wording from “verified only” to “verified plus awaiting-verification resolution requests.” Do not edit the historical KAN-39 plan; this document supersedes only the temporary anonymous-submission/UI direction.

**Verification:** Run the complete backend and Flutter test suites before real-world verification.

## 8. Verification plan

### Must run — automated checks

```powershell
cd C:\incident_reporter\apps\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests

cd C:\incident_reporter\apps\mobile
flutter analyze
flutter test
```

### Must run — real API against configured Supabase

Use one dedicated, clearly tagged test incident and two fresh anonymous `device_id` values. Do not write application data through SQL.

1. Create the test incident through `POST /incidents`.
2. Add authority evidence through the existing staff CRM/API flow.
3. Confirm public list/detail/photo routes return the awaiting incident with safe fields only.
4. Confirm anonymous user A reads the resolution with `can_submit_follow_up: true`.
5. Submit real JPEG/PNG evidence via `POST /incidents/{id}/resolution-evidence`; expect `201` and `pending` evidence.
6. Confirm anonymous user B receives `409` for the same cycle.
7. Use the existing CRM review UI to confirm the evidence; re-read API/history and confirm `community_confirmed`.
8. Confirm the case no longer appears in the active public feed while the authenticated safe resolution endpoint remains readable.

### Must run — real UI flow

1. Start exactly one backend on port `8000` without `--reload`.
2. Start the existing Flutter supervisor and open the web app on port `8080`.
3. Set a test location near the dedicated test incident.
4. Walk Feed → public report → Verify this resolution → note/photo → submitted state.
5. Complete the existing CRM staff confirmation flow.
6. Refresh Flutter and verify the completed state and evidence timeline.
7. Inspect the full mobile page, loading/error state, and browser console/network output.

### Not applicable

No migration application or schema verification is needed because this plan changes no database schema or storage structure.

## 9. Risks and rollback

- Anonymous submission increases abuse risk. The temporary controls are device-backed JWTs, banned-user enforcement, mandatory note/photo, one pending follow-up per authority cycle, and mandatory staff review.
- Expanding public visibility to awaiting cases must not expand public fields. Keep the existing safe serializer and original-photo route only.
- Deploy backend first. Older Flutter builds will continue filtering awaiting records, which is safe. Flutter deployed first will show no CTA until backend allows anonymous submission.
- No data migration is involved. Rollback is code-only; never delete resolution evidence or status-history rows.

## 10. Implementer handoff checklist

- [ ] No migration, direct Supabase write, new account system, or Flutter direct-confirm control added.
- [ ] Existing anonymous JWT is required; missing tokens remain rejected.
- [ ] Exactly one pending community follow-up exists per authority-evidence cycle.
- [ ] CRM staff remains the only actor that can set `community_confirmed`.
- [ ] Existing dirty/untracked Flutter work was preserved.
- [ ] Loading, retry, pending, confirmed, and needs-follow-up states are deliberate and accessible.
- [ ] Backend tests, Flutter checks, real API verification, and real CRM/Flutter UI journey were completed or explicitly reported as not run.
- [ ] Final implementation report lists changed files, commands run, test incident ID, and remaining risks.
