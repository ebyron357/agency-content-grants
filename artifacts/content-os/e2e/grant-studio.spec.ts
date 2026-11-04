import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server and session. CI starts the API with the Grants.gov sync off, so
// the store may be empty; the spec covers the organization, readiness and
// profile journey and both states of the Matches tab. The full application
// flow (requirements, sections, budget, approvals, DOCX) is covered against a
// real database in api-server/src/routes/grants.integration.test.ts.

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) =>
    ["critical", "serious"].includes(v.impact ?? ""),
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual(
    [],
  );
}

async function signIn(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Password")
    .fill(
      process.env.TEST_ADMIN_PASSWORD ??
        "test-admin-password-not-for-production",
    );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();
}

test("Grant Studio: add an organization, record readiness and see matches", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.getByRole("link", { name: "Grant Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Grant Studio", level: 1 }),
  ).toBeVisible();
  await expectNoSeriousViolations(page, "grant studio hub");

  const name = `E2E literacy nonprofit ${Date.now()} (synthetic)`;
  await page.getByRole("button", { name: "Add organization" }).first().click();
  await page.getByText("Nonprofit, 501(c)(3)").click();
  await page.getByLabel("Legal name").fill(name);
  await page.getByLabel("State").fill("NC");
  await page.getByLabel(/Annual budget/).fill("350000");
  await page
    .getByLabel("Mission")
    .fill("Improve reading outcomes for children in rural counties.");
  await page.getByLabel("Focus areas").fill("literacy, early childhood");
  await expectNoSeriousViolations(page, "add organization dialog");
  await page.getByRole("button", { name: "Add organization" }).last().click();

  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /eligible of/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Only my topics")).toBeChecked();
  // A new organization starts with nothing marked new.
  await expect(page.getByLabel("Only new")).not.toBeChecked();
  await page.getByLabel("Only new").check();
  await expect(page.getByText("Nothing new since you last looked")).toBeVisible();
  await page.getByLabel("Only new").uncheck();
  await expectNoSeriousViolations(page, "organization matches");

  await page.getByRole("tab", { name: "Readiness" }).click();
  const sam = "Active SAM.gov registration and UEI";
  await page.getByLabel(`${sam} status`).selectOption("ready");
  const row = page.locator("li", { has: page.getByLabel(`${sam} status`) });
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Saved.")).toBeVisible();
  await expectNoSeriousViolations(page, "readiness");

  await page.getByRole("tab", { name: "Profile" }).click();
  await expectNoSeriousViolations(page, "profile");

  // Mobile: no horizontal page scroll on the hub or the organization.
  const orgPath = new URL(page.url()).pathname;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/grant-studio", orgPath]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path}: no horizontal scroll`).toBeLessThanOrEqual(0);
    await expectNoSeriousViolations(page, `${path} mobile`);
  }

  // Clean up the synthetic organization.
  await page.setViewportSize({ width: 1280, height: 900 });
  const list = await (await page.request.get("/api/grants/applicants")).json();
  const created = list.find((a: { name: string }) => a.name === name);
  expect(created).toBeTruthy();
  expect(
    (await page.request.delete(`/api/grants/applicants/${created.id}`)).ok(),
  ).toBe(true);
});
