import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Self sign-up and the setup wizard (docs/SELF_SIGNUP.md).
//
// CI's server runs with self sign-up OFF (the default), so the first test checks
// against the real server that nothing changed. The sign-up screens are then
// checked with synthetic API answers; the sign-up routes themselves run against
// a real database in api-server/src/routes/signup.integration.test.ts.
//
// The wizard's happy path runs entirely against the real server: the spec seeds
// the disposable test database (DATABASE_URL, as notice.spec.ts does) with a
// cached ProPublica record and two synthetic opportunities, so the lookup, the
// organization, its facts and the matches are all real and no outside service
// is called. The failure paths answer the lookup with synthetic responses.
// Every name, EIN and opportunity is invented.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: no horizontal page scroll`).toBeLessThanOrEqual(0);
}

/** Checks a screen at 1280 px and 390 px. */
async function bothWidths(page: Page, label: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoSeriousViolations(page, `${label} (1280)`);
  await expectNoSidewaysScroll(page, `${label} (1280)`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSeriousViolations(page, `${label} (390)`);
  await expectNoSidewaysScroll(page, `${label} (390)`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function signInAsOperator(page: Page) {
  await page.goto("/");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();
}

const SOURCE = {
  name: "ProPublica Nonprofit Explorer API v2",
  api: "https://projects.propublica.org/nonprofits/api",
  terms: "Free to use under ProPublica's Data Terms of Use.",
  attribution: "Organization data from ProPublica Nonprofit Explorer (IRS filings).",
};

const STAMP = Date.now();
const ORG_NAME = `Piedmont Synthetic Literacy Council ${STAMP}`;
/** A word no other spec uses, so these opportunities never change another spec's matches. */
const TOPIC = "quillmoor";

/** What lib/onboarding/propublica.ts keeps from a lookup, as the cache stores it. */
const RECORD = {
  ein: "000000201", name: ORG_NAME, address: "100 Example St", city: "Durham", state: "NC", zipcode: "27701", nteeCode: "B92", nteeGroup: "B", nteeLabel: "Education",
  subsectionCode: 3, revenue: 412500, revenueYear: 2023, revenueFrom: "filing", profileUrl: "https://projects.propublica.org/nonprofits/organizations/000000201",
};

async function seed(client: pg.Client): Promise<string[]> {
  await client.query(
    `insert into nonprofit_lookups (ein, status, data, fetched_at) values ($1, 'found', $2, now()) on conflict (ein) do update set status = 'found', data = excluded.data, fetched_at = now()`,
    [RECORD.ein, JSON.stringify(RECORD)],
  );
  const ids = [randomUUID(), randomUUID()];
  const close = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const rows: [string, string, string | null][] = [
    [ids[0], `Synthetic federal ${TOPIC} reading program (e2e)`, null],
    [ids[1], `Synthetic North Carolina ${TOPIC} reading grants (e2e)`, "NC"],
  ];
  for (const [id, title, jurisdiction] of rows) {
    await client.query(
      `insert into grant_opportunities (id, source, source_ref, title, agency, status, close_date, official_url, fetched_at, detail_fetched_at, checksum, connector_version, publishable, gate_missing, eligibility_codes, categories, assistance_listings, cost_sharing, jurisdiction, description, award_ceiling)
       values ($1, $2, $3, $4, 'Example Agency for Testing', 'posted', $5, $6, now(), now(), 'seed', 'e2e', true, '[]', '["12"]', '[]', '[]', false, $7, $8, 150000)`,
      [id, jurisdiction ? "e2e_state" : "grants_gov", `e2e-${id}`, title, close, `https://www.grants.gov/search-results-detail/${id}`, jurisdiction, `Synthetic notice: supports ${TOPIC} reading for youth.`],
    );
  }
  return ids;
}

test("self sign-up is off by default: the sign-in page is unchanged and /signup is the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Content OS" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Create a workspace" })).toHaveCount(0);
  expect(await (await page.request.get("/api/auth/signup/status")).json()).toEqual({ enabled: false });
  expect((await page.request.post("/api/auth/signup", { data: { name: "X", organizationName: "Y", email: "off@example.org", password: "Correct horse battery staple 42" } })).status()).toBe(404);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Sign in to Content OS" })).toBeVisible();
});

test("sign-up, check-your-email and confirmation screens pass the accessibility gate", async ({ page }) => {
  await page.route("**/api/auth/signup/status", (route) => route.fulfill({ json: { enabled: true } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Create a workspace" }).click();
  await expect(page.getByRole("heading", { name: "Create your GrantCrest workspace" })).toBeVisible();
  await bothWidths(page, "sign-up form");

  // A password the server refuses shows its reason.
  let attempts = 0;
  await page.route("**/api/auth/signup", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 400, json: { error: "Use at least 12 characters." } })
      : route.fulfill({ status: 202, json: { status: "check_email", message: "If this email can be used, we sent a link to it. Open it within 24 hours to finish creating your workspace." } });
  });
  await page.getByLabel("Your name").fill("Sam Synthetic");
  await page.getByLabel("Organization name").fill("Synthetic Readers");
  await page.getByLabel("Work email").fill("sam@synthetic.example");
  await page.getByLabel("Choose a password").fill("short");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("alert")).toContainText("12 characters");
  await page.getByLabel("Choose a password").fill("Correct horse battery staple 42");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("sam@synthetic.example")).toBeVisible();
  await bothWidths(page, "check your email");

  // A used or expired link.
  await page.route("**/api/auth/signup/verify", (route) => route.fulfill({ status: 404, json: { error: "This link is not valid. It may have expired or been used. Sign up again to get a new one.", code: "signup_link_invalid" } }));
  await page.goto("/signup/verify#token=synthetic-token-that-is-long-enough-0000");
  await expect(page.getByRole("heading", { name: "Link not valid" })).toBeVisible();
  // The token is removed from the address bar once read.
  expect(new URL(page.url()).hash).toBe("");
  await bothWidths(page, "confirmation link not valid");
});

test("setup wizard: from EIN to first match well under 5 minutes, with every screen accessible", async ({ page }) => {
  test.setTimeout(120_000);
  const url = process.env.DATABASE_URL;
  // Seed only a disposable database (its name ends in _test, the same guard as the API test reset).
  test.skip(!url || !new URL(url).pathname.endsWith("_test"), "Needs the disposable test DATABASE_URL to seed a cached lookup and synthetic opportunities");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const oppIds = await seed(client);
  let orgId = "";
  try {
    await signInAsOperator(page);
    await page.goto("/get-started");
    await expect(page.getByRole("heading", { name: /Welcome to GrantCrest/, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await bothWidths(page, "getting-started checklist");

    const started = Date.now();
    await page.getByRole("link", { name: /Start setup|Run setup again/ }).click();
    await expect(page.getByRole("heading", { name: "Set up your organization", level: 1 })).toBeVisible();
    await bothWidths(page, "wizard step 1");

    // A short EIN is caught before any lookup.
    const einField = page.getByLabel(/EIN \(Employer Identification Number\)/);
    await einField.fill("12-345");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("alert")).toContainText("all 9 digits");

    await einField.fill("000000201");
    await expect(einField).toHaveValue("00-0000201");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("heading", { name: "Confirm details", level: 2 })).toBeFocused();
    await expect(page.getByLabel("Legal name", { exact: true })).toHaveValue(ORG_NAME);
    await expect(page.getByText("B92 (Education)")).toBeVisible();
    await bothWidths(page, "wizard step 2 (from IRS records)");

    // Continuing without confirming the name is refused.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Tick “Correct” next to the legal name");
    // Confirm by keyboard, then the rest at once.
    await page.getByLabel("Legal name is correct").focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Legal name is correct")).toBeChecked();
    await page.getByRole("button", { name: "Mark all correct" }).click();
    await expect(page.getByLabel("State is correct")).toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Choose focus areas", level: 2 })).toBeVisible();
    await expect(page.getByLabel("literacy", { exact: true })).toBeVisible();
    await page.getByLabel("Other focus areas").fill(`${TOPIC} reading`);
    await bothWidths(page, "wizard step 3");
    await page.getByRole("button", { name: "Show my matches" }).click();

    await expect(page.getByRole("heading", { name: "First matches", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: `Synthetic federal ${TOPIC} reading program (e2e)` })).toBeVisible();
    const elapsedMs = Date.now() - started;
    console.log(`[onboarding timing] wizard in the browser, EIN entry to first match (real server, seeded data): ${elapsedMs} ms`);
    expect(elapsedMs).toBeLessThan(60_000);
    await expect(page.getByRole("link", { name: `Synthetic North Carolina ${TOPIC} reading grants (e2e)` })).toBeVisible();
    await expect(page.getByText("NC state program")).toBeVisible();
    await expect(page.getByText("Matches are guidance, not an eligibility decision")).toBeVisible();
    await expect(page.getByText(/6 facts from IRS records saved to your fact library \(6 confirmed, 0 to review\)/)).toBeVisible();
    await expect(page.getByText(/You reached your first matches in/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await bothWidths(page, "wizard step 4 (first matches)");

    // The organization exists for real, with its confirmed, sourced facts.
    const orgs = (await (await page.request.get("/api/grants/applicants")).json()) as { id: string; name: string; state: string | null }[];
    const org = orgs.find((o) => o.name === ORG_NAME);
    expect(org?.state).toBe("NC");
    orgId = org!.id;
    const facts = (await (await page.request.get(`/api/grants/applicants/${orgId}/facts`)).json()).facts as { confirmed: boolean; source: string }[];
    expect(facts).toHaveLength(6);
    expect(facts.every((f) => f.confirmed && f.source.includes("ProPublica"))).toBe(true);

    // The checklist ticks the organization and matches steps (other specs' data can tick more in the shared agency workspace).
    await page.getByRole("link", { name: "Go to your checklist" }).click();
    await expect(page.getByRole("heading", { name: "Set up your organization", level: 2 })).toBeVisible();
    expect(await page.getByText("Done:").count()).toBeGreaterThanOrEqual(2);
    await bothWidths(page, "getting-started checklist after setup");
  } finally {
    if (orgId) await page.request.delete(`/api/grants/applicants/${orgId}`);
    await client.query("delete from grant_opportunities where id = any($1)", [oppIds]);
    await client.query("delete from nonprofit_lookups where ein = $1", [RECORD.ein]);
    await client.end();
  }
});

test("setup wizard: unknown EIN, lookup unavailable, and an organization without an EIN", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsOperator(page);
  let answer: "not_found" | "unavailable" = "not_found";
  await page.route("**/api/onboarding/lookup/**", (route) =>
    route.fulfill({
      json: {
        status: answer,
        ein: "000000202",
        einFormatted: "00-0000202",
        message:
          answer === "not_found"
            ? "No organization with EIN 00-0000202 is in ProPublica's copy of the IRS records. New nonprofits can take a few months to appear. Check the number, or enter your details yourself."
            : "ProPublica Nonprofit Explorer could not be reached. Try again in a minute, or enter your details yourself.",
        source: SOURCE,
      },
    }),
  );
  await page.goto("/onboarding");
  await page.getByLabel(/EIN \(Employer Identification Number\)/).fill("000000202");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("No match for that EIN")).toBeVisible();
  await bothWidths(page, "wizard: unknown EIN");
  answer = "unavailable";
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("The lookup is not available right now")).toBeVisible();
  await expectNoSeriousViolations(page, "wizard: lookup unavailable");

  // A business with no EIN enters its details by hand.
  await page.getByRole("button", { name: "Enter details yourself" }).first().click();
  await expect(page.getByRole("heading", { name: "Confirm details", level: 2 })).toBeVisible();
  const name = `Synthetic Widgets LLC ${STAMP}`;
  await page.getByLabel("Legal name").fill(name);
  await page.getByLabel("EIN (optional)").fill("");
  await page.getByLabel(/^State/).fill("nc");
  await page.getByLabel("Small business").check();
  await bothWidths(page, "wizard step 2 (by hand)");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("small business", { exact: true }).check();
  await page.getByRole("button", { name: "Show my matches" }).click();
  await expect(page.getByRole("heading", { name: "First matches", level: 2 })).toBeVisible();
  await expect(page.getByText(`${name} is set up`)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await bothWidths(page, "wizard step 4 (by hand)");
  const orgs = (await (await page.request.get("/api/grants/applicants")).json()) as { id: string; name: string; state: string | null; ein: string | null }[];
  const org = orgs.find((o) => o.name === name);
  expect(org).toMatchObject({ state: "NC", ein: null });
  await page.request.delete(`/api/grants/applicants/${org!.id}`);
});
