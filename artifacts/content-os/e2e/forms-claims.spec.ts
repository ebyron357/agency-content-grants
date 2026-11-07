import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Real server and session. A section with an unbacked claim shows the flag
// inline with its reason; approval stays blocked until a person dismisses it
// with a reason; the Federal forms step shows SF-424 prefilled from the
// organization and the opportunity, takes a person's entries and marks what is
// left. axe runs on both at desktop and 390 px.
//
// CI runs the API with the Grants.gov sync off, so the spec adds one synthetic
// federal opportunity directly to the disposable test database (DATABASE_URL)
// and removes it at the end. The routes, the server-side refusal and workspace
// isolation are covered in api-server/src/routes/grant-forms-claims.integration.test.ts.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: no horizontal scroll`).toBeLessThanOrEqual(0);
}

test("flag an unbacked claim, resolve it, and fill the federal forms", async ({ page }) => {
  test.setTimeout(120_000);
  const url = process.env.DATABASE_URL;
  test.skip(!url || !new URL(url).pathname.endsWith("_test"), "Needs the disposable test DATABASE_URL to seed a synthetic opportunity");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const oppId = randomUUID();
  await client.query(
    `insert into grant_opportunities (id, source, source_ref, number, title, agency, status, close_date, official_url, fetched_at, detail_fetched_at, checksum, connector_version, publishable, gate_missing, eligibility_codes, categories, assistance_listings, cost_sharing)
     values ($1, 'grants_gov', $2, 'E2E-FORMS-0001', 'Synthetic Reading Forms Pilot (e2e)', 'Example Agency for Testing', 'posted', $3, $4, now(), now(), 'seed', 'e2e', true, '[]', '["12"]', '[]', '["84.000"]', false)`,
    [oppId, `e2e-${oppId}`, new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), `https://www.grants.gov/search-results-detail/${oppId}`],
  );
  let orgId = "";
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByLabel("Password").fill(ADMIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main")).toBeVisible();

    const orgName = `E2E forms nonprofit ${Date.now()} (synthetic)`;
    const org = await (await page.request.post("/api/grants/applicants", { data: { name: orgName, applicantType: "nonprofit_501c3", state: "NC", ein: "12-3456789", uei: "ABCDEFGHJKL1" } })).json();
    orgId = org.id;
    const app = await (await page.request.post("/api/grants/applications", { data: { applicantId: org.id, opportunityId: oppId, eligibilityConfirmed: true } })).json();
    const ws = await (await page.request.get(`/api/grants/applications/${app.id}`)).json();
    const section = ws.sections[0];
    await page.request.patch(`/api/grants/sections/${section.id}`, { data: { content: "<p>Our tutors are certified reading specialists (synthetic).</p>" } });

    // The claim flag shows inline with its reason; approval waits for it.
    await page.goto(`/grant-studio/applications/${app.id}`);
    await page.getByRole("tab", { name: /Write/ }).click();
    await expect(page.getByRole("heading", { name: "1 claim to back up" })).toBeVisible();
    const flags = page.getByRole("list", { name: "Open claim flags" });
    await expect(flags.locator("mark")).toHaveText("certified");
    await expect(flags.getByText(/Why it is flagged:/)).toBeVisible();
    await expect(flags.getByText("Rule check (no AI)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expectNoSeriousViolations(page, "write step with a claim flag");

    await flags.getByRole("button", { name: "Dismiss with a reason" }).click();
    await flags.getByLabel(/Why this claim needs no fact or source/).fill("Each tutor holds a state reading certification (synthetic).");
    await flags.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByText("Every flagged claim is resolved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSeriousViolations(page, "write step at 390 px");
    await expectNoOverflow(page, "write step at 390 px");
    await page.setViewportSize({ width: 1280, height: 900 });

    // Federal forms: prefilled from the organization and the opportunity; the rest is for a person.
    await page.getByRole("tab", { name: /Federal forms/ }).click();
    await expect(page.getByRole("heading", { name: /SF-424: Application for Federal Assistance/ })).toBeVisible();
    await expect(page.getByLabel(/Legal Name/)).toHaveValue(orgName);
    await expect(page.getByText("Prefilled from Organization profile. Change it here if it is wrong.").first()).toBeVisible();
    await expect(page.getByText("E2E-FORMS-0001", { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, "federal forms step");

    await page.getByLabel(/^City/).fill("Durham");
    await page.getByRole("button", { name: /Save 1 change/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.getByLabel(/^City/)).toHaveValue("Durham");
    await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();

    await page.getByRole("navigation", { name: "Federal forms" }).getByRole("button", { name: /SF-LLL/ }).click();
    await page.getByLabel("Why it does not apply").fill("No one is paid to lobby for this award (synthetic).");
    await page.getByRole("button", { name: "Mark not applicable" }).click();
    await expect(page.getByText(/^Not applicable: No one is paid to lobby/)).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("navigation", { name: "Federal forms" }).getByRole("button", { name: /SF-424A/ }).click();
    await expectNoSeriousViolations(page, "federal forms at 390 px");
    await expectNoOverflow(page, "federal forms at 390 px");
  } finally {
    if (orgId) await page.request.delete(`/api/grants/applicants/${orgId}`);
    await client.query("delete from grant_opportunities where id = $1", [oppId]).catch(() => {});
    await client.end();
  }
});
