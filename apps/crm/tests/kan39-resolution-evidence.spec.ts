import { expect, test } from "@playwright/test";

const detail = {
  id: "incident-1",
  title: "Blocked drain",
  description: "Water is pooling on the road.",
  photo_url: null,
  lat: 18.52,
  lng: 73.85,
  address: "Ward 4",
  status: "awaiting_verification",
  severity: "high",
  ai_confidence: 0.9,
  ai_analysis: { category: "blocked_drain", reason: "Drain visible" },
  reporter_id: "citizen-1",
  assigned_to: null,
  created_at: "2026-09-09T08:00:00Z",
  notes: [],
  history: [
    {
      id: "history-1",
      incident_id: "incident-1",
      old_status: "verified",
      new_status: "awaiting_verification",
      changed_by: "staff-1",
      changed_at: "2026-09-09T09:00:00Z",
    },
  ],
  resolution_evidence: [
    {
      id: "authority-1",
      incident_id: "incident-1",
      parent_evidence_id: null,
      hotspot_snapshot_id: "snapshot-1",
      evidence_type: "authority_resolution",
      submitted_by: "staff-1",
      note: "Cleared the drain and replaced the grate.",
      photo_url: "incident-photos/resolution-evidence/authority-1.jpg",
      has_photo: true,
      review_outcome: "not_applicable",
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-09-09T09:00:00Z",
    },
    {
      id: "follow-up-1",
      incident_id: "incident-1",
      parent_evidence_id: "authority-1",
      hotspot_snapshot_id: null,
      evidence_type: "community_follow_up",
      submitted_by: "citizen-2",
      note: "The road is still flooded after rain.",
      photo_url: "incident-photos/resolution-evidence/follow-up-1.jpg",
      has_photo: true,
      review_outcome: "pending",
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-09-09T10:00:00Z",
    },
  ],
};

test("staff can review a pending community follow-up", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crm_staff_token", "staff-token"));
  await page.route(/\/admin\/incidents(?:\?.*)?$/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/admin/incidents/incident-1", async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) })
  );
  await page.route("**/admin/staff", async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "staff-1", email: "ops@example.com", role: "admin", open_count: 1 }]) })
  );
  await page.route("**/admin/incidents/duplicates", async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/admin/resolution-evidence/follow-up-1/photo**", async (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("fake") })
  );
  let reviewPayload: unknown;
  await page.route("**/admin/resolution-evidence/follow-up-1", async (route) => {
    reviewPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/incidents/incident-1");
  await expect(page.getByText("Resolution workflow")).toBeVisible();
  await expect(page.getByText("Before — citizen report")).toBeVisible();
  await expect(page.getByText("After — authority evidence")).toBeVisible();
  await expect(page.getByText("Resolution timeline")).toBeVisible();
  await expect(page.getByText("The road is still flooded after rain.").first()).toBeVisible();
  await page.getByRole("button", { name: "Open Community follow-up evidence photo fullscreen" }).click();
  await expect(page.getByRole("dialog", { name: /Community follow-up evidence photo fullscreen/ })).toBeVisible();
  await page.getByRole("button", { name: "Close fullscreen photo" }).click();
  await page.getByPlaceholder("Review note (required when requesting more work)").fill("Crew needs to inspect the outlet.");
  await page.getByRole("button", { name: "Request more work" }).click();
  await page.getByRole("button", { name: "Confirm review" }).click();
  await expect.poll(() => reviewPayload).toEqual({ outcome: "needs_follow_up", review_note: "Crew needs to inspect the outlet." });
});
