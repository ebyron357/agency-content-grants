import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// UI fixtures only. The existing authenticated accessibility gate also visits
// /grants with a real server/session; these tests do not establish auth security.
for (const width of [1440, 390]) {
  test(`grant discovery works at ${width}px with an authenticated UI fixture`, async ({
    page,
  }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/grants");
    await expect(
      page.getByRole("heading", { name: "Grants", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Grants", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("status")).toHaveText("21 of 21 resources");
    await page.getByLabel("Funding types").selectOption("Cash grant");
    await page.getByLabel("Locations").selectOption("Haiti");
    await expect(
      page.getByRole("heading", {
        name: "Peace Development Fund — Community Organizing",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Walmart Spark Good Local Grants" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search grants").fill("Google Ad Grants");
    await expect(page.getByRole("article")).toContainText("Advertising credit");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Search grants").fill("no-such-grant-xyz");
    await page.getByRole("button", { name: "Show all resources" }).click();
    await expect(page.getByRole("status")).toHaveText("21 of 21 resources");
    await page.getByRole("main").evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/grants-${width}.png`,
      fullPage: false,
    });
  });
}

test("grant route stays behind the existing sign-in UI", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/grants");
  await expect(
    page.getByRole("heading", { name: "Sign in to Content OS" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Grants", exact: true }),
  ).toHaveCount(0);
});
