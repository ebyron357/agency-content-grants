// Local evidence capture (not a CI spec). Copy into artifacts/content-os/e2e/ and run against
// a local production build with a disposable test database, as described in README.md here.
// Everything it creates is synthetic and is deleted at the end.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";

const OUT = process.env.EVIDENCE_DIR ?? ".";
const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

test("capture the notice checklist screens", async ({ page }) => {
  test.setTimeout(120_000);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const oppId = randomUUID();
  await client.query(
    `insert into grant_opportunities (id, source, source_ref, title, agency, status, close_date, official_url, fetched_at, detail_fetched_at, checksum, connector_version, publishable, gate_missing, eligibility_codes, categories, assistance_listings, cost_sharing)
     values ($1, 'grants_gov', $2, '[SYNTHETIC] Community Reading Pilot', 'Example Agency for Testing', 'posted', $3, $4, now(), now(), 'seed', 'evidence', true, '[]', '["12"]', '[]', '[]', false)`,
    [oppId, `evidence-${oppId}`, new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), `https://www.grants.gov/search-results-detail/${oppId}`],
  );
  let orgId = "";
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByLabel("Password").fill(ADMIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main")).toBeVisible();
    const org = await (await page.request.post("/api/grants/applicants", { data: { name: "Read & Rise Literacy (synthetic)", applicantType: "nonprofit_501c3" } })).json();
    orgId = org.id;
    const app = await (await page.request.post("/api/grants/applications", { data: { applicantId: org.id, opportunityId: oppId, eligibilityConfirmed: true } })).json();
    await page.goto(`/grant-studio/applications/${app.id}`);
    await expect(page.getByRole("heading", { name: "Notice PDF" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-attach-notice.png` });

    // The synthetic three-page notice from api-server/src/lib/grants/syntheticNotice.ts, written out beforehand.
    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-notice-EX-TEST-0001.pdf", mimeType: "application/pdf", buffer: readFileSync(process.env.NOTICE_PDF!) });
    await expect(page.getByText(/Read · 3 pages · text by pdf\.js/)).toBeVisible({ timeout: 30_000 });
    const list = page.getByRole("list", { name: "Requirements proposed from the notice" });
    await list.getByRole("listitem").filter({ hasText: "Quality of the project design" }).getByRole("button", { name: /^Confirm / }).click();
    await expect(list.getByText(/Confirmed by admin/)).toBeVisible();
    await list.getByRole("listitem").filter({ hasText: /^Format:/ }).first().getByRole("button", { name: /^Reject / }).click();
    // The app scrolls inside its own container, so a full-page capture stops at it; capture the list in view instead.
    await page.getByRole("heading", { name: "Checklist from the notice" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/02-proposed-checklist.png` });

    await list.getByRole("listitem").filter({ hasText: "Need for the project" }).getByRole("button", { name: /Show notice page 3/ }).click();
    await expect(page.getByRole("dialog").locator("mark")).toBeVisible();
    await page.screenshot({ path: `${OUT}/03-cited-page.png` });
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Notice PDF" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/m-proposed-checklist.png` });
  } finally {
    if (orgId) await page.request.delete(`/api/grants/applicants/${orgId}`);
    await client.query("delete from grant_opportunities where id = $1", [oppId]).catch(() => {});
    await client.end();
  }
});
