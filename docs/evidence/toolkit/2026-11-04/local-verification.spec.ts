import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Local verification only (not a CI spec): needs the synthetic opportunity seeded into the local test database.
const OUT = "/home/user/agency-content-grants/docs/evidence/toolkit/2026-11-04";
const OPP = "e2e-toolkit-opp-0001";

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = r.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
  console.log(`axe ok: ${label}`);
}
async function noScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
  console.log(`no horizontal scroll at 390px: ${label}`);
}

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

test("toolkit UI end to end (local)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByLabel("Password").fill("test-admin-password-not-for-production");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();

  const org = await (await page.request.post("/api/grants/applicants", { data: { name: "Read & Rise Literacy (synthetic)", applicantType: "nonprofit_501c3", state: "NC", mission: "Youth literacy in Durham, NC", focusAreas: ["literacy"], annualBudget: 400000, principalAddress: "101 Main St, Durham, NC 27701", censusTract: "37063001503", countyFips: "37063" } })).json();
  try {
    // Place designations tab.
    await page.goto(`/grant-studio/organizations/${org.id}`);
    await page.getByRole("tab", { name: "Place designations" }).click();
    const oz = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Qualified Opportunity Zone" }) });
    await oz.getByLabel("Qualified Opportunity Zone result").selectOption("in");
    await oz.getByLabel("Qualified Opportunity Zone census tract").fill("37063001503");
    await oz.getByLabel("Qualified Opportunity Zone note").fill("Synthetic example for screenshots");
    await oz.getByRole("button", { name: "Save" }).click();
    await expect(oz.getByText("In a designated area")).toBeVisible();
    await axe(page, "place designations");
    await page.screenshot({ path: `${OUT}/37-place-designations.png`, fullPage: false });

    // Matches show the designation reasons.
    await page.getByRole("tab", { name: "Matches" }).click();
    const card = page.getByRole("article").filter({ hasText: "[SYNTHETIC] Community Literacy Partnerships" });
    await expect(card.getByText(/Qualified Opportunity Zones, and you recorded that Principal office is in one/)).toBeVisible();
    await expect(card.getByText(/mentions persistent-poverty counties. Record whether/)).toBeVisible();
    await axe(page, "matches with designations");
    await card.screenshot({ path: `${OUT}/38-match-designations.png` });

    // Start an application through the API (the eligibility confirmation is a person's action, recorded as such).
    const app = await (await page.request.post("/api/grants/applications", { data: { applicantId: org.id, opportunityId: OPP, eligibilityConfirmed: true, eligibilityNote: "Synthetic verification" } })).json();
    await page.goto(`/grant-studio/applications/${app.id}`);
    await page.getByRole("tab", { name: /Write/ }).click();

    // Objectives section: SMART checks.
    await page.getByRole("button", { name: /Goals and measurable objectives/ }).click();
    const ws = await (await page.request.get(`/api/grants/applications/${app.id}`)).json();
    const objectives = ws.sections.find((s: any) => s.key === "objectives");
    await page.request.patch(`/api/grants/sections/${objectives.id}`, { data: { content: "<ul><li>Improve literacy in the community.</li><li>By June 2027, increase the share of third graders reading at grade level from 41% to 55%.</li><li>Enroll 120 youth within 6 months.</li></ul><p>Sessions run at [Add: partner school names].</p>" } });
    await page.reload();
    await page.getByRole("tab", { name: /Write/ }).click();
    await page.getByRole("button", { name: /Goals and measurable objectives/ }).click();
    await expect(page.getByRole("heading", { name: "Writing checks" })).toBeVisible();
    await expect(page.getByText("Objectives (SMART check)")).toBeVisible();
    await axe(page, "write step with writing checks");
    await page.getByRole("heading", { name: "Writing checks" }).locator("xpath=ancestor::section[1]").screenshot({ path: `${OUT}/39-writing-checks.png` });

    // Logic model builder.
    await page.getByRole("button", { name: /^Logic model/ }).click();
    await page.getByRole("textbox", { name: /^Inputs/ }).fill("Two certified reading tutors\nDurham Public Schools classrooms");
    await page.getByRole("textbox", { name: /^Activities/ }).fill("Twice-weekly small-group tutoring");
    await page.getByRole("textbox", { name: /^Outputs/ }).fill("120 youth tutored");
    await page.getByRole("textbox", { name: /^Short-term outcomes/ }).fill("80% of participants gain one reading level");
    await page.getByRole("textbox", { name: /^Long-term impact/ }).fill("More third graders reading at grade level");
    await page.getByRole("button", { name: "Put it in this section" }).click();
    await expect(page.getByText("Logic model placed in the section.")).toBeVisible();
    await expect(page.getByLabel("Logic model editor").getByText("120 youth tutored")).toBeVisible();
    await axe(page, "logic model builder");
    await page.getByRole("heading", { name: "Logic model builder" }).locator("xpath=ancestor::section[1]").screenshot({ path: `${OUT}/40-logic-model.png` });

    // Format & letters step.
    await page.getByRole("tab", { name: /Format & letters/ }).click();
    await page.getByLabel("Font").selectOption("Arial");
    await page.getByLabel("Size (pt)").fill("11");
    await page.getByLabel("Line spacing").selectOption("2");
    await page.getByLabel("Narrative page limit").fill("10");
    await page.getByLabel("File name").fill("Read Rise Narrative");
    await page.getByRole("button", { name: "Save format" }).click();
    await expect(page.getByText(/Format saved/)).toBeVisible();
    await expect(page.getByText(/Spaces and symbols are allowed by Grants.gov but refused by some agencies/)).toBeVisible();
    await page.getByLabel("Person").fill("Dr. Lee (synthetic)");
    await page.getByLabel("Organization").fill("Durham Public Schools");
    await page.getByLabel("Email").fill("lee@example.org");
    await page.getByLabel("What the letter should cover").fill("hosting the tutoring sessions two days a week");
    await page.getByRole("button", { name: "Add letter" }).click();
    await expect(page.getByText("0 of 1 received.", { exact: false })).toBeVisible();
    await axe(page, "format and letters");
    await page.screenshot({ path: `${OUT}/41-format-and-letters.png`, fullPage: true });

    // The package step lists the new checks with Fix links.
    await page.getByRole("tab", { name: /Review & package/ }).click();
    await expect(page.getByText("No placeholders left to fill")).toBeVisible();
    await expect(page.getByText("Letters of support received")).toBeVisible();
    await expect(page.getByText("Fits the notice's format and page limit")).toBeVisible();
    await axe(page, "package checks");
    await page.getByRole("heading", { name: "Compliance checks" }).locator("xpath=ancestor::section[1]").screenshot({ path: `${OUT}/42-package-checks.png` });

    // Phone width on the new screens.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: /Format & letters/ }).click();
    await noScroll(page, "format and letters");
    await axe(page, "format and letters at 390px");
    await page.screenshot({ path: `${OUT}/m-format-and-letters.png` });
    await page.goto(`/grant-studio/organizations/${org.id}`);
    await page.getByRole("tab", { name: "Place designations" }).click();
    await noScroll(page, "place designations");
    await page.screenshot({ path: `${OUT}/m-place-designations.png` });
  } finally {
    await page.request.delete(`/api/grants/applicants/${org.id}`);
  }
});
