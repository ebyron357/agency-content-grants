import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Real server and session. A synthetic notice PDF (built below, not a real
// notice) is attached to an application; the page shows it being read, then
// the proposed checklist with page citations; a row is confirmed and another
// rejected; axe runs on the Requirements step at desktop and 390 px.
//
// CI runs the API with the Grants.gov sync off, so the store has no
// opportunity to apply to. The spec adds one synthetic opportunity directly to
// the disposable test database (DATABASE_URL, the same one CI's API uses) and
// removes it at the end. The routes, isolation and roles are covered against
// a real database in api-server/src/routes/grant-notice.integration.test.ts.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

/** A minimal two-page PDF with a text layer, written by hand. Synthetic content only. */
function syntheticPdf(): Buffer {
  const pages = [
    ["SYNTHETIC TEST NOTICE - NOT A REAL FUNDING OPPORTUNITY", "Eligible applicants are nonprofit organizations with 501(c)(3) status.", "The project narrative must not exceed 10 pages."],
    ["Section V. Review Criteria (synthetic)", "Need for the project (20 points).", "Quality of the project design (35 points)."],
  ];
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const stream = `BT /F1 11 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET`;
    objects[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("attach a notice PDF and review its proposed checklist with page citations", async ({ page }) => {
  test.setTimeout(120_000);
  const url = process.env.DATABASE_URL;
  // Seed only a disposable database (its name ends in _test, the same guard as the API test reset).
  test.skip(!url || !new URL(url).pathname.endsWith("_test"), "Needs the disposable test DATABASE_URL to seed a synthetic opportunity");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const oppId = randomUUID();
  await client.query(
    `insert into grant_opportunities (id, source, source_ref, title, agency, status, close_date, official_url, fetched_at, detail_fetched_at, checksum, connector_version, publishable, gate_missing, eligibility_codes, categories, assistance_listings, cost_sharing)
     values ($1, 'grants_gov', $2, 'Synthetic Community Reading Pilot (e2e)', 'Example Agency for Testing', 'posted', $3, $4, now(), now(), 'seed', 'e2e', true, '[]', '["12"]', '[]', '[]', false)`,
    [oppId, `e2e-${oppId}`, new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), `https://www.grants.gov/search-results-detail/${oppId}`],
  );
  let orgId = "";
  try {
    await page.goto("/");
    await page.getByLabel("Password").fill(ADMIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main")).toBeVisible();

    const org = await (await page.request.post("/api/grants/applicants", { data: { name: `E2E notice nonprofit ${Date.now()} (synthetic)`, applicantType: "nonprofit_501c3" } })).json();
    orgId = org.id;
    const app = await (await page.request.post("/api/grants/applications", { data: { applicantId: org.id, opportunityId: oppId, eligibilityConfirmed: true } })).json();

    await page.goto(`/grant-studio/applications/${app.id}`);
    await expect(page.getByRole("heading", { name: "Notice PDF" })).toBeVisible();
    await expectNoSeriousViolations(page, "requirements step before a notice");

    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-notice.pdf", mimeType: "application/pdf", buffer: syntheticPdf() });
    await expect(page.getByText("synthetic-notice.pdf")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Read · 2 pages · text by pdf\.js/)).toBeVisible();
    // No AI key in CI: the proposals are labelled demo pattern matching.
    await expect(page.getByText("Demo: no AI provider is configured", { exact: true })).toBeVisible();
    await expect(page.getByText(/found by pattern matching on the notice's own words, not by AI/)).toBeVisible();

    const list = page.getByRole("list", { name: "Requirements proposed from the notice" });
    const criterion = list.getByRole("listitem").filter({ hasText: "Quality of the project design" });
    await expect(criterion.getByText("Proposed by pattern matching (demo, no AI)")).toBeVisible();
    await expect(criterion.getByRole("button", { name: /Show notice page 2/ })).toBeVisible();
    await expect(criterion.getByText("Proposed: needs a person to confirm it")).toBeVisible();
    await expectNoSeriousViolations(page, "proposed checklist");

    // Check the citation against the page's own text.
    await criterion.getByRole("button", { name: /Show notice page 2/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notice page 2" });
    await expect(dialog.locator("mark")).toContainText("Quality of the project design (35 points).");
    await expectNoSeriousViolations(page, "notice page dialog");
    await page.keyboard.press("Escape");

    await criterion.getByRole("button", { name: /^Confirm / }).click();
    await expect(criterion.getByText(/Confirmed by admin/)).toBeVisible();

    const limit = list.getByRole("listitem").filter({ hasText: "Limit: 10 pages" });
    await limit.getByRole("button", { name: /^Reject / }).click();
    await expect(list.getByRole("listitem").filter({ hasText: "Limit: 10 pages" })).toHaveCount(0);
    await page.getByRole("button", { name: /Show rejected rows \(1\)/ }).click();
    await expect(page.getByRole("list", { name: "Rejected rows" }).getByText(/Rejected by admin/)).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSeriousViolations(page, "proposed checklist at 390 px");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    if (orgId) await page.request.delete(`/api/grants/applicants/${orgId}`);
    await client.query("delete from grant_opportunities where id = $1", [oppId]).catch(() => {});
    await client.end();
  }
});
