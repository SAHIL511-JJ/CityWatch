import { expect, test } from "@playwright/test";

const summary = {
  total: 12,
  window_days: 30,
  by_status: [
    { status: "processing", count: 1 },
    { status: "needs_review", count: 2 },
    { status: "verified", count: 3 },
    { status: "awaiting_verification", count: 1 },
    { status: "needs_follow_up", count: 2 },
    { status: "resolved", count: 2 },
    { status: "community_confirmed", count: 1 },
  ],
  by_severity: [
    { severity: "critical", count: 4 },
    { severity: "high", count: 3 },
  ],
  by_category: [{ name: "flooding", count: 12 }],
  by_day: [{ date: "2026-09-16", count: 12, open: 9, resolved: 3, critical: 4 }],
  action_counts: { overdue: 0, breaching: 0, needs_review: 2, needs_follow_up: 2 },
};

test("KAN-43 dashboard KPIs show the matching scoped incident destinations", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crm_staff_token", "staff-token"));
  await page.route("**/admin/analytics/summary?window_days=30", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) }),
  );
  await page.route("**/admin/incidents?window_days=30&page_size=6", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 12, page: 1, page_size: 6, total_pages: 2 }) }),
  );
  await page.route("**/admin/analytics/hotspots?limit=6&window_days=30", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/admin/incidents?status=needs_review", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 2, page: 1, page_size: 1, total_pages: 2 }) }),
  );

  await page.goto("/");

  const kpis = [
    { name: /Total incidents: 12/, href: "/incidents?window_days=30" },
    { name: /Needs attention: 9/, href: "/incidents?window_days=30&state=needs_attention&sort=action" },
    { name: /Resolved: 3/, href: "/incidents?window_days=30&state=resolved" },
    { name: /Critical severity: 4/, href: "/incidents?severity=critical&window_days=30&sort=action" },
  ];

  for (const kpi of kpis) {
    const link = page.getByRole("link", { name: kpi.name });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", kpi.href);
  }
});
