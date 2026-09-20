# KAN-52 + KAN-53 — Staff workspace and coherent queues

## Summary

Turn Staff into a real operations workspace: show team coverage, manual availability, workload, last operational activity, and admin invitations. Make queue scope explicit and link every staffing signal to the exact incident queue it represents.

## Key changes

- Add staff fields for `availability` (`available`, `busy`, `away`), `availability_updated_at`, and nullable `last_active_at`.
  - “Active staff” means staff marked Available or Busy.
  - Last activity updates only after a real staff action: incident assignment/update, note, resolution/review action, bulk action, or availability change. Never infer online presence.
  - Existing staff with no recorded activity display “No recorded activity.”

- Add a migration-backed `staff_invitations` table with a hashed one-time token, invited email/role, inviter, creation, expiry, acceptance, and revocation timestamps.
  - Admins alone can invite staff and set their initial role: `admin`, `dispatcher`, or `analyst`.
  - Re-inviting an email revokes its previous pending invitation.
  - The invitation link expires after 72 hours and lets the recipient choose a password; raw invitation tokens are never stored.
  - Send through Resend using `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CRM_PUBLIC_URL`. If Resend cannot send, do not leave a usable invitation behind.

- Add backend authorization that checks the current database role, rather than relying only on the JWT role claim.
  - Admin-only: send invitations and override another person’s availability.
  - Any staff member: change only their own availability.
  - Keep Busy and Away staff selectable for assignment, but show their role, status, and current open workload beside their name.

- Add staff workspace APIs without breaking the existing staff-directory response used by assignment controls:
  - `GET /admin/staff/workspace`: summary of active staff, open workload, unassigned open incidents, and enriched staff members.
  - `PATCH /admin/staff/{id}/availability`: self-service availability updates; admin override for another staff member.
  - `POST /admin/staff/invitations`: admin invitation creation and Resend delivery.
  - `POST /admin/staff/invitations/accept`: public token-and-password activation endpoint.
  - Add `queue=open` and `assignee_id` support to `GET /admin/incidents`.
    - `queue=open`: all non-terminal incidents.
    - `queue=mine`: current staff member’s non-terminal incidents.
    - `queue=unassigned`: non-terminal incidents without an assignee.
    - `queue=open&assignee_id=<staff-id>`: that named staff member’s non-terminal queue.
    - Reject incompatible combinations rather than silently applying surprising filters.

- Make `/incidents?queue=open` the default operational queue and expose clear quick navigation for All open, My queue, Unassigned, and a named teammate’s queue.

- Update the Staff page:
  - Add a concise coverage summary with active staff, total open workload, and unassigned incidents.
  - Add visible queue links whose labels and counts match their destination.
  - Show each staff member’s role, manual availability, open assignments, last activity, and a scoped “View queue” link.
  - Provide an intentional single-person/empty-team state with a clear admin-only Invite staff action.
  - Let a staff member update their own status; let admins override another member inline.
  - Add a dedicated invite page and a public password-setup page rather than using a large modal flow.

- Update incident navigation and assignment feedback:
  - Show the active scope as the incidents-page heading and preserve the full scope in the URL.
  - Carry a validated relative `return_to` URL when opening incident detail from a queue, so “Back to queue” returns to the exact filters and page.
  - After individual or bulk assignment, invalidate incident, staff-directory, and staff-workspace data; show feedback naming the new assignee and refreshed workload counts.
  - Update assignee controls to surface availability and open-count context before confirmation.

## Test plan

- Apply the new migration to the configured Supabase database before testing; confirm new staff fields, invitation table, constraints, and indexes exist.
- Use real FastAPI requests to verify:
  - Admin invitation succeeds and sends through configured Resend.
  - Non-admin invitation and non-admin override attempts are rejected.
  - Expired, revoked, reused, and malformed invitation tokens cannot activate accounts.
  - Activation creates a staff account that can log in.
  - Availability permissions, activity timestamps, open counts, all queue scopes, and invalid scope combinations behave as specified.
- Use the headed Playwright CLI against the live CRM for the real journey:
  - Admin views coverage, invites a staff member, and sees intentional empty/team states.
  - Staff updates their own status; admin overrides another person.
  - Staff links open My queue, Unassigned, All open, and a teammate queue with the expected URL and heading.
  - Assign, reassign, and unassign an incident; receive feedback, return to the original exact queue, and see counts update.
- Do not add Playwright test specs, test configuration, npm test scripts, or mocked browser tests; verification remains direct CLI interaction and real API checks.

## Assumptions locked

- Resend is the email provider.
- Invitations are admin-only, email-based, single-use, and expire after 72 hours.
- Availability is manual: Available, Busy, or Away.
- Staff set their own availability; admins may override it.
- Busy and Away people remain assignable with visible context, never a hard block.
- “All open” excludes `resolved`, `community_confirmed`, and `closed`.
