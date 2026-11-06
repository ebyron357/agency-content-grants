import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server and session. CI's server imports no foundation data (the import
// job is off and its source is external), so the page is first checked in its
// empty state against the real API. The populated search, suggestions and
// profile are then checked with synthetic API responses (every name, EIN and
// amount invented); the routes themselves are covered against a real database
// in api-server/src/routes/foundations.integration.test.ts.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";
const LABEL = "Funding history from tax filings, not an open call";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

const funder = {
  ein: "000000101", einFormatted: "00-0000101", name: "ALDER SYNTHETIC FAMILY FOUNDATION", state: "NC", formType: "990PF", totalPaidUsd: 267500, grantCount: 5,
  firstTaxYear: 2022, lastTaxYear: 2024, medianGrantUsd: 50000, topCauses: [{ key: "B", label: "Education", usd: 265000, share: 99.1 }], label: LABEL,
};

const profile = {
  ...funder,
  givingByYear: [{ year: 2024, usd: 120000 }, { year: 2023, usd: 95000 }, { year: 2022, usd: 52500 }],
  givingByState: [{ key: "NC", label: "NC", usd: 265000, share: 99.1 }, { key: "VA", label: "VA", usd: 2500, share: 0.9 }],
  givingByCause: [{ key: "B", label: "Education", usd: 265000, share: 99.1 }, { key: "K", label: "Food, agriculture and nutrition", usd: 2500, share: 0.9 }],
  causeBasis: { fromNtee: 3, fromPurpose: 2, unclassified: 0, classifiedShare: 100 },
  grantSize: { count: 5, min: 2500, max: 120000, p25: 15000, median: 50000, p75: 80000 },
  recentGrants: [{ recipientName: "PIEDMONT SYNTHETIC LITERACY COUNCIL", recipientCity: "DURHAM", recipientState: "NC", recipientEin: "90-0000001", amountUsd: 120000, taxYear: 2024, purpose: "EARLY CHILDHOOD LITERACY", cause: "Education", objectId: "OBJ-A-2024" }],
  filings: [{ taxPeriodEnd: "2024-12-31", objectId: "OBJ-A-2024" }, { taxPeriodEnd: "2023-12-31", objectId: "OBJ-A-2023-AMEND" }],
  source: {
    name: "funder-graph", repo: "https://github.com/egeria-corporation/funder-graph", license: "Code Apache-2.0. The hosted dataset's terms have not been reviewed; the pipeline can be run independently.",
    irsDownloads: "https://www.irs.gov/charities-non-profits/form-990-series-downloads", derivedFrom: "IRS Form 990-PF Part XV and Form 990 Schedule I e-file XML",
    datasetVersion: "synthetic", latestTaxYear: 2024, latestTaxPeriodEnd: "2024-12-31", latestSubmittedOn: "2025-04-02",
    filing: { objectId: "OBJ-A-2024", irsDownloads: "https://www.irs.gov/charities-non-profits/form-990-series-downloads", propublica: "https://projects.propublica.org/nonprofits/organizations/000000101", note: "The IRS publishes no web page per filing." },
    updatedAt: new Date().toISOString(),
  },
};

test("Foundations: search funders, see suggestions and read a profile", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  // The real, empty state.
  await page.goto("/grant-studio");
  await page.getByRole("link", { name: "Foundations" }).click();
  await expect(page.getByRole("heading", { name: "Foundations", level: 1 })).toBeVisible();
  await expect(page.getByText(LABEL).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousViolations(page, "foundations, real server");

  // Populated, with synthetic responses.
  await page.route("**/api/grants/foundations?**", (route) => route.fulfill({ json: { label: LABEL, total: 1, page: 1, pageSize: 25, funders: [funder] } }));
  await page.route("**/api/grants/foundations/000000101", (route) => route.fulfill({ json: profile }));
  await page.route("**/api/grants/applicants/*/foundation-suggestions", (route) =>
    route.fulfill({ json: { label: LABEL, state: "NC", causes: [{ key: "B", label: "Education", from: "focus area “literacy”" }], note: "Suggestions come from past giving in tax filings. They are not an eligibility decision and not an open call.", suggestions: [{ ...funder, inStateUsd: 265000, reasons: ["Paid $265,000 to recipients in NC (99% of its giving), tax years 2022–2024.", "State and cause totals are counted separately: this does not show that its in-state grants were for your cause."] }] } }),
  );
  await page.getByLabel("Funder name").fill("alder");
  await page.getByLabel("Gave in state").selectOption("NC");
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "ALDER SYNTHETIC FAMILY FOUNDATION" }).last();
  await expect(row).toContainText("$267,500");
  await expectNoSeriousViolations(page, "foundations search results");

  await row.getByRole("link", { name: "ALDER SYNTHETIC FAMILY FOUNDATION" }).click();
  await expect(page.getByRole("heading", { name: "ALDER SYNTHETIC FAMILY FOUNDATION", level: 1 })).toBeVisible();
  await expect(page.getByText(LABEL)).toBeVisible();
  await expect(page.getByText("OBJ-A-2024").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /IRS Form 990 downloads/ })).toHaveAttribute("href", /irs\.gov/);
  await expect(page.getByRole("table", { name: "Giving by recipient state" })).toContainText("$265,000");
  await expectNoSeriousViolations(page, "funder profile");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "ALDER SYNTHETIC FAMILY FOUNDATION", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, "funder profile at 390 px");
  await page.getByRole("link", { name: "Foundations", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Foundations", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
