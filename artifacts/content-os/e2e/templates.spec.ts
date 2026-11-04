import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server. A workspace duplicates a built-in application template, edits
// its rules, sections and requirements, sees the server's validation, saves a
// new version, and archives it. axe runs on the list and the editor.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test("a workspace customizes an application template", async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Arts council application ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  await page.goto("/grant-studio");
  await page.getByRole("link", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { name: "Application templates", level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "templates list");

  // Built-in templates are read only; duplicating one opens an editable copy.
  await page.getByRole("link", { name: "Federal grant: nonprofit" }).click();
  await expect(page.getByText("Built-in templates are maintained with the product.")).toBeVisible();
  await expect(page.getByLabel("Template name")).toHaveCount(0);
  await page.getByRole("button", { name: "Duplicate to customize" }).click();
  await expect(page.getByLabel("Template name")).toHaveValue("Federal grant: nonprofit (copy)");

  await page.getByLabel("Template name").fill(name);
  await page.getByLabel(/^Title contains/).fill("arts");
  await page.getByRole("button", { name: "Add section" }).click();
  const sections = await page.getByLabel(/^Section \d+ title$/).count();
  await page.getByLabel(`Section ${sections} title`).fill("Artistic merit");
  await page.getByLabel(`Section ${sections} maximum`).fill("600");
  await page.getByRole("button", { name: `Move section ${sections} up` }).click();
  await expect(page.getByLabel(`Section ${sections - 1} title`)).toHaveValue("Artistic merit");
  await page.getByRole("button", { name: "Add requirement" }).click();
  const reqs = await page.getByLabel(/^Requirement \d+$/).count();
  await page.getByLabel(`Requirement ${reqs}`, { exact: true }).fill("Work samples");
  await page.getByLabel(`Requirement ${reqs} section`).selectOption({ label: "Artistic merit" });

  // The server's validation comes back as a list of what to fix.
  await page.getByLabel(`Section ${sections - 1} maximum`).fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(`Section ${sections - 1}: the limit must be a whole number`);
  await expectNoSeriousViolations(page, "template editor with errors");
  await page.getByLabel(`Section ${sections - 1} maximum`).fill("600");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved as version 2.")).toBeVisible();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByText(/when the title contains “arts”/)).toBeVisible();

  // Listed under the workspace's templates, then archived.
  await page.getByRole("link", { name: "All templates" }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("version 2");
  await row.getByRole("button", { name: `Archive ${name}` }).click();
  await expect(row.getByText("Archived", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole("link", { name }).click();
  await expect(page.getByLabel("Template name")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
