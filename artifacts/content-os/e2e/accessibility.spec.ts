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

const PROJECT_TABS = [
  "Overview",
  "Research Plan",
  "Sources",
  "Claims",
  "Outline",
  "Editor",
  "Quality",
  "Repurpose",
  "Export",
];

test("every primary authenticated route passes the accessibility gate on one design system", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page
    .getByLabel("Password")
    .fill(
      process.env.TEST_ADMIN_PASSWORD ??
        "test-admin-password-not-for-production",
    );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  // Synthetic, clearly labelled fixture so the gate never depends on prior data.
  const brand = await (
    await page.request.post("/api/brands", {
      data: { name: "A11y gate brand", industry: "Accessibility fixture" },
    })
  ).json();
  const project = await (
    await page.request.post("/api/projects", {
      data: {
        brandId: brand.id,
        title: "A11y gate guide",
        contentType: "guide",
        topic: "Accessibility gate fixture",
      },
    })
  ).json();
  expect(project.id, "fixture project created").toBeTruthy();

  // The shell is one dark system: the rail and the page share the same tokens.
  const shell = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const main = document.getElementById("main-content");
    return {
      root: document.documentElement.classList.contains("dark"),
      rail: aside ? getComputedStyle(aside).backgroundColor : "",
      body: getComputedStyle(document.body).backgroundColor,
      main: main ? getComputedStyle(main).color : "",
    };
  });
  expect(shell.root).toBe(true);
  expect(shell.rail).not.toBe("rgb(250, 250, 249)"); // legacy stone-50 rail
  expect(shell.body).toBe("rgb(8, 10, 15)");

  for (const [path, label] of [
    ["/dashboard", "dashboard"],
    ["/projects", "documents"],
    ["/brands", "brands"],
    [`/brands/${brand.id}`, "brand detail"],
    ["/distribution", "distribution"],
    ["/performance", "performance"],
    ["/settings", "settings"],
    ["/route-that-does-not-exist", "not found"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoSeriousViolations(page, label);
  }

  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole("heading", { name: "A11y gate guide" }),
  ).toBeVisible();
  for (const tab of PROJECT_TABS) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      page.getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page, `project ${tab}`);
  }

  // Mobile: the collapsed rail keeps every destination reachable by name.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  for (const name of [
    "New content",
    "Documents",
    "Brands",
    "Distribution",
    "Performance",
    "Dashboard",
    "Settings",
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "no horizontal page scroll on mobile").toBeLessThanOrEqual(
    0,
  );
  await expectNoSeriousViolations(page, "dashboard mobile");
});
