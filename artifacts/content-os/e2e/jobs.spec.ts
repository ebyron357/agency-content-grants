import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server. A refresh requested in Grant Studio becomes a background job
// that the Jobs screen shows, cancels and runs again. CI's server runs in test
// mode with the worker off, so the job stays queued and no external source is
// called.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test("a grant refresh is queued as a job and managed from the Jobs screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  // Start clean: cancel any refresh an earlier run left queued, then lock admin again.
  const api = page.request;
  expect((await api.post("/api/auth/admin-unlock", { data: { password: ADMIN } })).ok()).toBe(true);
  const queued = await (await api.get("/api/jobs?kind=grant_sync&status=queued")).json();
  for (const job of queued.jobs) await api.post(`/api/jobs/${job.id}/cancel`);
  await api.post("/api/auth/admin-lock");

  await page.goto("/grant-studio");
  const refresh = page.getByRole("button", { name: /Refresh now|Refreshing/ });
  await refresh.click();
  await expect(page.getByRole("status").filter({ hasText: "Refresh queued" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refreshing…" })).toBeDisabled();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Jobs" }).click();
  await expect(page.getByText("Admin access needed")).toBeVisible();
  await page.getByLabel("Admin password").fill(ADMIN);
  await page.getByRole("button", { name: "Unlock admin access" }).click();
  await expect(page.getByRole("heading", { name: "Recent jobs" })).toBeVisible();
  await expect(page.getByText("The worker is off on this server")).toBeVisible();
  // Schedules are off in test mode, and the screen says so.
  // One row per schedule (grant refresh, source sweep, ...); every one must be off.
  await expect(page.getByText("Off on this server", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Every (day|\d+ hours)$/)).toHaveCount(0);
  const recent = page.locator("section", { has: page.getByRole("heading", { name: "Recent jobs" }) });
  const row = recent.getByRole("listitem").filter({ hasText: "Refresh grant opportunities" }).first();
  await expect(row.getByText("Queued", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page, "jobs screen");

  await row.getByRole("button", { name: "Cancel Refresh grant opportunities" }).click();
  await expect(row.getByText("Cancelled", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Run Refresh grant opportunities again" }).click();
  await expect(row.getByText("Queued", { exact: true })).toBeVisible();

  // Leave nothing queued for later tests.
  await row.getByRole("button", { name: "Cancel Refresh grant opportunities" }).click();
  await expect(row.getByText("Cancelled", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Recent jobs" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
