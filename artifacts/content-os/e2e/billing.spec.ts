import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server. CI runs with no Stripe settings, so billing is OFF: the Billing
// tab says so, names the missing settings and limits nothing. The team password
// signs in as the agency workspace's owner, who may see billing.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test("Settings, Billing explains that billing is off and stays accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  await page.goto("/settings?tab=billing");
  await expect(page.getByRole("tab", { name: "Billing" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Billing is off")).toBeVisible();
  await expect(page.getByText(/STRIPE_SECRET_KEY/)).toBeVisible();
  await expectNoSeriousViolations(page, "billing tab");

  // Keyboard: the tab is reachable and selectable from the tab list.
  await page.getByRole("tab", { name: "Team" }).click();
  await page.getByRole("tab", { name: "Billing" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Billing is off")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Billing is off")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
