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
  applicationPolicy: { status: "accepts_applications", label: "Accepts applications", taxYear: 2024, objectId: "OBJ-A-2024", detail: "Its tax year 2024 Form 990-PF does not check Part XIV line 2 (contributions only to preselected organizations). Confirm how to apply on the funder's own site or filing." },
};

const closed = {
  ...funder, ein: "000000202", einFormatted: "00-0000202", name: "BIRCH SYNTHETIC TRUST", state: "CA",
  applicationPolicy: { status: "invitation_only", label: "Invitation only", taxYear: 2022, objectId: "OBJ-B-2023", detail: "Its tax year 2022 Form 990-PF says it only contributes to preselected organizations and does not accept unsolicited requests (Part XIV line 2)." },
};

const filing = { objectId: "OBJ-A-2024", irsDownloads: "https://www.irs.gov/charities-non-profits/form-990-series-downloads", propublica: "https://projects.propublica.org/nonprofits/organizations/000000101", note: "The IRS publishes no web page per filing." };

const components = [
  { key: "state", label: "Gives in your state", points: 30, max: 30, reason: "Paid $265,000 to recipients in NC, 99% of its giving." },
  { key: "cause", label: "Funds your cause", points: 30, max: 30, reason: "Paid $265,000 to education recipients (NTEE major groups, all states), 99% of its giving." },
  { key: "size", label: "Grant size fits", points: 20, max: 20, reason: "Its median grant of $50,000 is 8% of your annual budget of $600,000: a typical size for one grant." },
  { key: "recency", label: "Gave recently", points: 10, max: 10, reason: "Its latest grants counted are from tax year 2024, the latest year in the imported filings." },
  { key: "consistency", label: "Gives year after year", points: 6, max: 10, reason: "Paid grants in 3 of 3 tax years 2022–2024; fewer than five years of its giving are imported." },
];

const suggestion = (f: typeof funder, score: number, extra: string[] = []) => ({
  ...f, inStateUsd: 265000, score, components, reasons: components.map((c) => c.reason), causeUsd: 265000, filing, filings: [{ taxPeriodEnd: "2024-12-31", objectId: "OBJ-A-2024" }],
  cautions: ["State and cause are counted separately: this does not show that its in-state grants were for your cause.", ...extra],
});

const profile = {
  ...funder,
  givingByYear: [{ year: 2024, usd: 120000 }, { year: 2023, usd: 95000 }, { year: 2022, usd: 52500 }],
  givingByState: [{ key: "NC", label: "NC", usd: 265000, share: 99.1 }, { key: "VA", label: "VA", usd: 2500, share: 0.9 }],
  givingByCause: [{ key: "B", label: "Education", usd: 265000, share: 99.1 }, { key: "K", label: "Food, agriculture and nutrition", usd: 2500, share: 0.9 }],
  causeBasis: { fromNtee: 3, fromPurpose: 2, unclassified: 0, classifiedShare: 100 },
  grantSize: { count: 5, min: 2500, max: 120000, p25: 15000, median: 50000, p75: 80000 },
  recentGrants: [{ recipientName: "PIEDMONT SYNTHETIC LITERACY COUNCIL", recipientCity: "DURHAM", recipientState: "NC", recipientEin: "90-0000001", amountUsd: 120000, taxYear: 2024, purpose: "EARLY CHILDHOOD LITERACY", cause: "Education", objectId: "OBJ-A-2024" }],
  filings: [{ taxPeriodEnd: "2024-12-31", objectId: "OBJ-A-2024" }, { taxPeriodEnd: "2023-12-31", objectId: "OBJ-A-2023-AMEND" }],
  applicationInfo: { formAndMaterials: "A TWO-PAGE LETTER OF INQUIRY", deadlines: "MARCH 1 AND SEPTEMBER 1", restrictions: "501(C)(3) ORGANIZATIONS IN NORTH CAROLINA" },
  applicationPolicyFiling: { ...{ objectId: "OBJ-A-2024", irsDownloads: "https://www.irs.gov/charities-non-profits/form-990-series-downloads", propublica: "https://projects.propublica.org/nonprofits/organizations/000000101", note: "" }, taxYear: 2024, taxPeriodEnd: "2024-12-31" },
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
  // Suggestions need an organization; the real server may have none, so the list is synthetic too.
  await page.route("**/api/grants/applicants", (route) => route.fulfill({ json: [{ id: "syn-org-1", name: "Synthetic Readers (test)", applicantType: "nonprofit_501c3", state: "NC", focusAreas: ["literacy"] }] }));
  const suggestionUrls: string[] = [];
  await page.route("**/api/grants/applicants/*/foundation-suggestions**", (route) => {
    const url = route.request().url();
    suggestionUrls.push(url);
    const hide = url.includes("hideInvitationOnly=true");
    return route.fulfill({
      json: {
        label: LABEL, state: "NC", causes: [{ key: "B", label: "Education", from: "focus area “literacy”" }], annualBudget: 600000, requestUsd: url.includes("request=25000") ? 25000 : null, latestDataYear: 2024,
        note: "Suggestions come from past giving in tax filings. They are a starting point for research, not an eligibility decision and not an open call.",
        suggestions: hide ? [suggestion(funder, 96)] : [suggestion(funder, 96), suggestion(closed, 96, [closed.applicationPolicy.detail])],
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Funders matched to your organization" })).toBeVisible();
  const matched = page.getByRole("list", { name: "Matched funders, best first" });
  await expect(matched.getByRole("listitem").filter({ hasText: "ALDER SYNTHETIC FAMILY FOUNDATION" }).first()).toContainText("Accepts applications · tax year 2024");
  await expect(matched).toContainText("Invitation only · tax year 2022");
  await expect(matched).toContainText("Gives in your state");
  await expect(matched).toContainText("30 of 30");
  await expect(matched.getByText("OBJ-A-2024").first()).toBeVisible();
  await expectNoSeriousViolations(page, "foundation suggestions");
  await page.getByLabel("Request amount (optional)").fill("25,000");
  await page.getByRole("button", { name: "Update" }).click();
  await expect.poll(() => suggestionUrls.some((u) => u.includes("request=25000"))).toBe(true);
  await page.getByLabel(/Hide funders whose latest filing/).check();
  await expect(matched).not.toContainText("BIRCH SYNTHETIC TRUST");
  await page.getByLabel("Request amount (optional)").fill("lots");
  await expect(page.getByRole("button", { name: "Update" })).toBeDisabled();
  await expect(page.getByText("Enter a whole dollar amount, for example 25000.")).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Does it accept applications?" })).toBeVisible();
  await expect(page.getByText("Accepts applications · tax year 2024")).toBeVisible();
  await expect(page.getByText("MARCH 1 AND SEPTEMBER 1")).toBeVisible();
  await expectNoSeriousViolations(page, "funder profile");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "ALDER SYNTHETIC FAMILY FOUNDATION", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, "funder profile at 390 px");
  await page.getByRole("link", { name: "Foundations", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Foundations", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
