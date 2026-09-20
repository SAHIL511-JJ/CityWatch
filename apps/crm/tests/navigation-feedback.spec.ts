import { expect, test, type Page } from "@playwright/test";

const incident = {
  id: "incident-1",
  title: "Blocked drain",
  description: "Water is pooling on the road.",
  photo_url: null,
  lat: 18.52,
  lng: 73.85,
  address: "Ward 4",
  status: "verified",
  severity: "high",
  ai_confidence: 0.9,
  ai_analysis: { category: "blocked_drain", reason: "Drain visible" },
  reporter_id: "citizen-1",
  assigned_to: null,
  created_at: "2026-09-09T08:00:00Z",
  notes: [],
  history: [],
  resolution_evidence: [],
};

async function seedStaffSession(page: Page) {
  await page.addInitScript(() => localStorage.setItem("crm_staff_token", "staff-token"));
}

async function mockSharedAdminReads(page: Page) {
  await page.route(/\/admin\/staff(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "staff-1", email: "ops@example.com", role: "admin", open_count: 1 }]) }));
  await page.route(/\/admin\/incidents\/duplicates(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(/\/admin\/incidents\?status=needs_review$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 1, total_pages: 0 }) }));
}

test("clicking an incident leads to the destination skeleton before its data", async ({ page }) => {
  await seedStaffSession(page);
  await mockSharedAdminReads(page);
  await page.route(/\/admin\/incidents(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [incident], total: 1, page: 1, page_size: 25, total_pages: 1 }) }));
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/admin/incidents/incident-1", async (route) => {
    await delayed;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(incident) });
  });

  await page.goto("/incidents");
  const incidentLink = page.getByRole("link", { name: "Blocked drain" });
  await expect(incidentLink).toBeVisible();
  await incidentLink.click();

  // The URL commits to the destination, which owns its own loading UI.
  await expect(page).toHaveURL(/\/incidents\/incident-1$/);
  await expect(page.getByLabel("Loading incident details")).toBeVisible();

  // No custom global route feedback: the fixed top "Opening …" status pill and
  // progress bar are gone. Assert on the user-visible "Opening …" text, not on
  // role="status" (which the app legitimately reuses for toast notifications).
  await expect(page.getByText(/Opening /)).toHaveCount(0);
  await expect(page.locator(".fixed.top-0[role='status']")).toHaveCount(0);

  release();
  await expect(page.getByLabel("Loading incident details")).toBeHidden();
  await expect(page.getByText("Blocked drain").first()).toBeVisible();
});

test("incident scope refresh keeps rows visible and announces the update", async ({ page }) => {
  await seedStaffSession(page);
  await mockSharedAdminReads(page);
  await page.route(/\/admin\/incidents(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [incident], total: 1, page: 1, page_size: 25, total_pages: 1 }) }));
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/admin\/incidents\?status=verified(?:&.*)?$/, async (route) => {
    await delayed;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 25, total_pages: 0 }) });
  });

  await page.goto("/incidents");
  await expect(page.getByText("Blocked drain").first()).toBeVisible();
  const filteredResponse = page.waitForResponse((response) => response.url().includes("/admin/incidents?status=verified"));
  await page.getByLabel("Status").selectOption("verified");
  await expect(page.getByText("Updating queue…")).toBeVisible();
  await expect(page.getByText("Blocked drain").first()).toBeVisible();
  release();
  await filteredResponse;
  await expect(page.getByText("No incidents match this scope")).toBeVisible();
});
