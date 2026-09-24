import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact ?? ""),
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual(
    [],
  );
}

test("login and authenticated core screens pass the accessibility gate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Content OS" }),
  ).toBeVisible();
  await expectNoSeriousViolations(page, "login");

  await page
    .getByLabel("Password")
    .fill(
      process.env.TEST_ADMIN_PASSWORD ??
        "test-admin-password-not-for-production",
    );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await expectNoSeriousViolations(page, "create");

  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toBeVisible();
  await expectNoSeriousViolations(page, "dashboard");

  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.getByRole("main")).toBeVisible();
});
