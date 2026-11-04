import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server and session. An organization records its location and a place
// designation it checked on the agency's tool; the result, the official tool
// link and validation errors are shown; axe runs on the tab at desktop and
// phone widths. Matching and drafting with designations are covered against a
// real database in api-server/src/routes/grant-toolkit.integration.test.ts.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test("an organization records its location and a place designation", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  const name = `E2E main street bakery ${Date.now()} (synthetic)`;
  const created = await page.request.post("/api/grants/applicants", { data: { name, applicantType: "small_business", state: "NC" } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();

  try {
    await page.goto(`/grant-studio/organizations/${id}`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await page.getByRole("tab", { name: "Place designations" }).click();
    await expect(page.getByText("0 of 6 recorded as in a designated area.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Find the tract \(Census Geocoder\)/ })).toHaveAttribute("href", "https://geocoding.geo.census.gov/geocoder/");
    await expectNoSeriousViolations(page, "place designations tab");

    // Location, with the server's validation shown.
    await page.getByLabel("Street address").fill("101 Main St, Durham, NC 27701");
    await page.getByLabel("Census tract GEOID").fill("37063");
    await page.getByRole("button", { name: "Save location" }).click();
    await expect(page.getByRole("alert")).toContainText("11-digit census tract GEOID");
    await page.getByLabel("Census tract GEOID").fill("37063001503");
    await page.getByLabel("County FIPS").fill("37063");
    await page.getByRole("button", { name: "Save location" }).click();
    await expect(page.getByText("Location saved.")).toBeVisible();

    // A designation: the official tool, then the recorded result.
    const oz = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Qualified Opportunity Zone" }) });
    await expect(oz.getByRole("link", { name: /Check on the official tool/ })).toHaveAttribute("href", "https://www.cdfifund.gov/opportunity-zones");
    await oz.getByLabel("Qualified Opportunity Zone result").selectOption("in");
    await expect(oz.getByLabel("Qualified Opportunity Zone checked on")).not.toHaveValue("");
    await oz.getByLabel("Qualified Opportunity Zone census tract").fill("37063001503");
    await oz.getByLabel("Qualified Opportunity Zone note").fill("CDFI Fund list, 2018 designations (synthetic test)");
    await oz.getByRole("button", { name: "Save" }).click();
    await expect(oz.getByText("In a designated area")).toBeVisible();
    await expect(oz.getByText(/^Recorded by /)).toBeVisible();
    await expect(page.getByText("1 of 6 recorded as in a designated area.")).toBeVisible();

    // A wrong geography for the designation is refused with a reason.
    const qct = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "HUD Qualified Census Tract" }) });
    await qct.getByLabel("HUD Qualified Census Tract result").selectOption("not_in");
    await qct.getByLabel("HUD Qualified Census Tract census tract").fill("123");
    await qct.getByRole("button", { name: "Save" }).click();
    await expect(qct.getByRole("alert")).toContainText("11-digit census tract GEOID");
    await expectNoSeriousViolations(page, "place designations after saving");

    // Phone width: no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(oz.getByText("In a designated area")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoSeriousViolations(page, "place designations at 390px");
  } finally {
    expect((await page.request.delete(`/api/grants/applicants/${id}`)).ok()).toBe(true);
  }
});
