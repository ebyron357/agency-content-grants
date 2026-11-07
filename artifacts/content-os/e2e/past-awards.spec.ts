import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server and session. CI's server stores no grant opportunities and
// cannot reach USAspending, so the opportunity record and its past-award
// panel come from synthetic API responses (every recipient, award id and
// amount invented). The route itself, its cache and its failure handling are
// covered against a real database in
// api-server/src/routes/past-awards.integration.test.ts.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";
const LABEL = "Past federal awards from USAspending.gov: what this program funded before, not a promise of future awards";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

const opportunity = {
  id: "syn-opp-1", source: "grants_gov", sourceLabel: "Grants.gov", jurisdiction: null, federal: true, rollingDeadline: false, costSharePercent: null, sourceRef: "syn-1",
  number: "SYN-26-001", title: "Synthetic Community Literacy Program", agency: "Synthetic Agency", agencyCode: "SYN", status: "posted", openDate: "2026-10-01", closeDate: "2099-01-15",
  daysLeft: 400, awardFloor: 50000, awardCeiling: 500000, estimatedFunding: 5000000, costSharing: false, eligibilityCodes: ["12"], eligibilityLabels: ["Nonprofits with 501(c)(3) status"],
  eligibilityText: null, categories: ["Education"], assistanceListings: ["99.901"], description: "A synthetic opportunity for the accessibility gate.",
  officialUrl: "https://www.grants.gov/search-results-detail/syn-opp-1", fetchedAt: new Date().toISOString(), detailFetchedAt: new Date().toISOString(), publishable: true, gateMissing: [],
};

const award = (recipient: string, amountUsd: number, state: string | null, fiscalYear: number, n: number) => ({
  awardId: `SYN-${n}`, generatedId: `ASST_NON_SYN${n}`, recipient, amountUsd, startDate: `${fiscalYear - 1}-11-01`, fiscalYear, state, url: `https://www.usaspending.gov/award/ASST_NON_SYN${n}`,
});

const recent = [
  award("PIEDMONT SYNTHETIC LITERACY COUNCIL", 250000, "NC", 2026, 1),
  award("SYNTHETIC RIVER VALLEY SCHOOLS WITH A VERY LONG LEGAL NAME FOR WRAPPING CHECKS", 480000, "VA", 2026, 2),
  award("SYNTHETIC COASTAL READING PROJECT", 125000, "NC", 2026, 3),
  award("SYNTHETIC INTERNATIONAL LITERACY FUND", 60000, null, 2025, 4),
];

const ready = {
  label: LABEL,
  source: { name: "USAspending.gov", url: "https://www.usaspending.gov", api: "https://api.usaspending.gov", terms: "Public federal spending data.", note: "Grants only (award types 02–05), by the award's start date." },
  applicable: true, reason: null, state: null,
  listings: [
    {
      programNumber: "99.901", label: LABEL, status: "ready", message: null, fetchedAt: new Date().toISOString(),
      summary: {
        totalAwards: 42, period: { start: "2023-10-01", end: "2026-11-06" }, sampleSize: 4,
        amounts: { min: 60000, p25: 108750, median: 187500, p75: 307500, max: 480000, total: 915000 },
        byFiscalYear: [{ fiscalYear: 2026, count: 3, usd: 855000 }, { fiscalYear: 2025, count: 1, usd: 60000 }],
        topStates: [{ state: "NC", count: 2, usd: 375000 }], inState: null, recent,
      },
    },
  ],
};

const withState = {
  ...ready,
  state: "NC",
  listings: [{ ...ready.listings[0], summary: { ...ready.listings[0].summary, inState: { state: "NC", count: 2, usd: 375000, awards: [recent[0], recent[2]] } } }],
};

const unavailable = {
  ...ready,
  listings: [{ programNumber: "99.901", label: LABEL, status: "unavailable", message: "USAspending could not be reached when we last tried (2026-11-06). We will try again later.", fetchedAt: null, summary: null }],
};

test("Past federal awards on a federal opportunity: ready, unavailable and mobile", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  let body: unknown = ready;
  await page.route(/\/api\/grants\/opportunities\/syn-opp-1(\?.*)?$/, (route) => route.fulfill({ json: { opportunity, match: null, existingApplicationId: null, detailError: null } }));
  await page.route(/\/api\/grants\/opportunities\/syn-opp-1\/past-awards/, (route) => route.fulfill({ json: body }));

  await page.goto("/grant-studio/opportunities/syn-opp-1");
  await expect(page.getByRole("heading", { name: "Synthetic Community Literacy Program", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past federal awards" })).toBeVisible();
  await expect(page.getByText("Assistance Listing 99.901").first()).toBeVisible();
  const table = page.getByRole("table", { name: "Most recent awards under Assistance Listing 99.901" });
  await expect(table).toContainText("PIEDMONT SYNTHETIC LITERACY COUNCIL");
  await expect(table).toContainText("$250,000");
  await expect(table).toContainText("FY2026");
  await expect(page.getByRole("link", { name: /PIEDMONT SYNTHETIC LITERACY COUNCIL/ })).toHaveAttribute("href", "https://www.usaspending.gov/award/ASST_NON_SYN1");
  await expect(page.getByText("$187,500")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousViolations(page, "past awards, ready");

  // In-state winners for the chosen organization.
  body = withState;
  await page.reload();
  await expect(page.getByRole("table", { name: "Recent awards to recipients in NC" })).toContainText("SYNTHETIC COASTAL READING PROJECT");
  await expect(page.getByText("2 of 4")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Past federal awards" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, "past awards at 390 px");

  // USAspending unreachable and never read: said plainly, nothing invented.
  body = unavailable;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByText(/USAspending could not be reached/)).toBeVisible();
  await expect(page.getByRole("table", { name: /Most recent awards/ })).toHaveCount(0);
  await expectNoSeriousViolations(page, "past awards, unavailable");

  // A failed request offers a retry.
  await page.unroute(/\/api\/grants\/opportunities\/syn-opp-1\/past-awards/);
  await page.route(/\/api\/grants\/opportunities\/syn-opp-1\/past-awards/, (route) => route.fulfill({ status: 500, json: { error: "Synthetic failure" } }));
  await page.reload();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 15_000 });
  await expectNoSeriousViolations(page, "past awards, error");
});
