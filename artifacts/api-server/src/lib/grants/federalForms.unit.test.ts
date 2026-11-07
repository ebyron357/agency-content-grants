import { describe, expect, it } from "vitest";
import { inflateRawSync } from "zlib";
import { summarizeBudget } from "./budget";
import { buildApplicationPackage } from "./packageExport";
import { FEDERAL_FORM_DEFINITIONS, SOURCE_COMMIT } from "./federalForms/definitions";
import { buildFormView, buildFormViews, coerceValue, entryFields, formsCheck, prefillFor, validateForm, type FormsContext, type StoredForm } from "./federalForms/engine";
import { formFields } from "./federalForms/fields";
import { TO_COMPLETE, buildFormsPdf, formRows, formsJson } from "./federalForms/render";
import { FEDERAL_FORM_KEYS } from "./federalForms/types";

/**
 * Federal forms (SF-424, SF-424A, SF-424B, SF-LLL) from HHS/simpler-grants-gov's
 * public-domain definitions: prefill, entry, totals, schema validation and the
 * readable renderings. Synthetic organization data only.
 */

const budget = summarizeBudget(
  [
    { category: "personnel", description: "Program director", quantity: 1, unitCost: 90000, matchPercent: 0, justification: "Leads" },
    { category: "supplies", description: "Books", quantity: 300, unitCost: 20, matchPercent: 50, justification: "Books" },
  ],
  10,
  null,
);

const ctx: FormsContext = {
  applicant: { name: "Read & Rise Literacy", applicantType: "nonprofit_501c3", ein: "12-3456789", uei: "ABCDEFGHJKL1", state: "NC" },
  opportunity: { title: "Community Literacy Grants", number: "ED-GRANTS-2026-01", agency: "Department of Education", assistanceListings: ["84.123"] },
  application: { title: "Read & Rise Summer Tutoring" },
  budget,
  hasBudgetLines: true,
};

const stored = (formKey: string, values: Record<string, unknown>, extra: Partial<StoredForm> = {}): StoredForm => ({
  formKey,
  values,
  notApplicable: false,
  notApplicableReason: null,
  notApplicableBy: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewedHash: null,
  updatedBy: null,
  updatedAt: null,
  ...extra,
});

/** Everything a person enters on the SF-424 that GrantCrest cannot prefill (synthetic). */
const SF424_PERSON: Record<string, unknown> = {
  submission_type: "Application",
  application_type: "New",
  "applicant.street1": "101 Main Street",
  "applicant.city": "Durham",
  "applicant.zip_code": "277010001",
  "contact_person.first_name": "Ana",
  "contact_person.last_name": "Diaz",
  phone_number: "919-555-0100",
  email: "ana@example.org",
  congressional_district_applicant: "NC-004",
  congressional_district_program_project: "NC-004",
  project_start_date: "2027-07-01",
  project_end_date: "2028-06-30",
  state_estimated_funding: "0.00",
  local_estimated_funding: "0.00",
  other_estimated_funding: "0.00",
  program_income_estimated_funding: "0.00",
  state_review: "c. Program is not covered by E.O. 12372.",
  delinquent_federal_debt: false,
  certification_agree: true,
  "authorized_representative.first_name": "Sam",
  "authorized_representative.last_name": "Lee",
  authorized_representative_title: "Executive Director",
  authorized_representative_phone_number: "919-555-0101",
  authorized_representative_email: "sam@example.org",
};

function readZipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + extra;
  }
  throw new Error(`${name} not in zip`);
}

describe("form definitions", () => {
  it("carries the four forms from Simpler Grants with their identifiers", () => {
    expect(SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(FEDERAL_FORM_DEFINITIONS).sort()).toEqual(["sf424", "sf424a", "sf424b", "sflll"]);
    expect(FEDERAL_FORM_DEFINITIONS.sf424).toMatchObject({ formVersion: "4.0", ombNumber: "4040-0004", sourcePath: expect.stringContaining("api/src/form_schema/forms/sf424") });
    for (const key of FEDERAL_FORM_KEYS) {
      expect(FEDERAL_FORM_DEFINITIONS[key].jsonSchema.type).toBe("object");
      expect(formFields(key).length).toBeGreaterThan(3);
    }
  });

  it("never lets a person type a field Grants.gov fills on submission", () => {
    const sf424 = formFields("sf424");
    const filledByGrantsGov = sf424.filter((f) => f.entry === "grants_gov").map((f) => f.id);
    expect(filledByGrantsGov.length).toBeGreaterThan(0);
    const entry = entryFields("sf424");
    for (const id of filledByGrantsGov) expect(entry.has(id)).toBe(false);
    expect(entry.has("total_estimated_funding")).toBe(false); // computed
  });
});

describe("prefill", () => {
  it("fills what the profile, opportunity and budget hold, and nothing else", () => {
    const p = prefillFor("sf424", ctx);
    expect(p.organization_name).toEqual({ value: "Read & Rise Literacy", source: "Organization profile" });
    expect(p.employer_taxpayer_identification_number.value).toBe("12-3456789");
    expect(p["applicant.state"].value).toBe("NC: North Carolina");
    expect(p.applicant_type_code.value).toEqual(["M: Nonprofit with 501C3 IRS Status (Other than Institution of Higher Education)"]);
    expect(p.funding_opportunity_number.value).toBe("ED-GRANTS-2026-01");
    expect(p.assistance_listing_number.value).toBe("84.123");
    expect(p.federal_estimated_funding.value).toBe(budget.requested.toFixed(2));
    expect(p.applicant_estimated_funding.value).toBe(budget.match.toFixed(2));
    // Not recorded anywhere, so left for a person.
    for (const id of ["state_estimated_funding", "project_start_date", "contact_person.first_name", "congressional_district_applicant"]) expect(p[id]).toBeUndefined();
    // No budget lines yet: no amounts.
    expect(prefillFor("sf424", { ...ctx, hasBudgetLines: false }).federal_estimated_funding).toBeUndefined();
  });

  it("fills the SF-424A from the budget categories and adds up the totals", () => {
    const view = buildFormView("sf424a", undefined, prefillFor("sf424a", ctx));
    const line = (view.data as any).activity_line_items[0];
    expect(line.budget_categories.personnel_amount).toBe("90000.00");
    expect(line.budget_categories.supplies_amount).toBe("6000.00");
    expect(line.budget_categories.total_direct_charge_amount).toBe("96000.00");
    expect(line.budget_categories.total_indirect_charge_amount).toBe(budget.indirect.toFixed(2));
    expect(line.budget_categories.total_amount).toBe((96000 + budget.indirect).toFixed(2));
    expect(line.budget_summary.total_amount).toBe((budget.requested + budget.match).toFixed(2));
  });
});

describe("entry and validation", () => {
  it("marks every missing field for a person, then validates against the schema", () => {
    const empty = buildFormView("sf424", undefined, prefillFor("sf424", ctx));
    expect(empty.status).toBe("not_started");
    const toDo = empty.sections.flatMap((s) => s.fields).filter((f) => f.errors.length).map((f) => f.id);
    expect(toDo).toEqual(expect.arrayContaining(["submission_type", "applicant.city", "project_start_date", "certification_agree"]));
    expect(toDo).not.toContain("organization_name");

    const filled = buildFormView("sf424", stored("sf424", SF424_PERSON), prefillFor("sf424", ctx));
    expect(filled.errorCount).toBe(0);
    expect(filled.status).toBe("ready_to_review");
    expect((filled.data as any).total_estimated_funding).toBe((budget.requested + budget.match).toFixed(2));
    const origins = Object.fromEntries(filled.sections.flatMap((s) => s.fields).map((f) => [f.id, f.origin]));
    expect(origins).toMatchObject({ organization_name: "prefill", submission_type: "entered", total_estimated_funding: "computed" });

    // A value a person typed wins over the prefill; a bad one is reported on its field.
    const typed = buildFormView("sf424", stored("sf424", { ...SF424_PERSON, organization_name: "Read and Rise Literacy, Inc.", email: "not-an-email", federal_estimated_funding: "12.5" }), prefillFor("sf424", ctx));
    expect((typed.data as any).organization_name).toBe("Read and Rise Literacy, Inc.");
    const errs = Object.fromEntries(typed.sections.flatMap((s) => s.fields).filter((f) => f.errors.length).map((f) => [f.id, f.errors[0]]));
    expect(errs.email).toBe("Enter an email address.");
    expect(errs.federal_estimated_funding).toMatch(/dollars and cents/);
  });

  it("is complete only once a person reviewed exactly the data it now holds", () => {
    const first = buildFormView("sf424", stored("sf424", SF424_PERSON), prefillFor("sf424", ctx));
    const reviewed = buildFormView("sf424", stored("sf424", SF424_PERSON, { reviewedBy: "Sam", reviewedAt: new Date(), reviewedHash: first.dataHash }), prefillFor("sf424", ctx));
    expect(reviewed.status).toBe("complete");
    // A budget change moves the prefilled amount, so the review no longer covers the form.
    const moved = buildFormView("sf424", stored("sf424", SF424_PERSON, { reviewedBy: "Sam", reviewedAt: new Date(), reviewedHash: first.dataHash }), prefillFor("sf424", { ...ctx, budget: { ...budget, requested: budget.requested + 1 } }));
    expect(moved.status).toBe("ready_to_review");
  });

  it("refuses values of the wrong type before they are stored", () => {
    const fields = entryFields("sf424");
    expect(coerceValue(fields.get("delinquent_federal_debt")!, "yes")).toMatchObject({ ok: false });
    expect(coerceValue(fields.get("delinquent_federal_debt")!, false)).toEqual({ ok: true, value: false });
    expect(coerceValue(fields.get("applicant_type_code")!, "M")).toMatchObject({ ok: false });
    expect(coerceValue(fields.get("email")!, { a: 1 })).toMatchObject({ ok: false });
    expect(coerceValue(fields.get("email")!, "  a@example.org ")).toEqual({ ok: true, value: "a@example.org" });
    expect(coerceValue(fields.get("email")!, "")).toEqual({ ok: true, value: null });
  });

  it("validates raw data with the form's own JSON Schema", () => {
    expect(validateForm("sf424b", { title: "Executive Director", applicant_organization: "Read & Rise Literacy" }).byField.size).toBe(0);
    expect(validateForm("sf424b", { title: "x".repeat(500) }).byField.get("title")?.[0]).toMatch(/at most/);
  });
});

describe("the four forms together", () => {
  it("copies the SF-424 into the SF-424B, lets only the SF-LLL be not applicable, and reports what is left", () => {
    let views = buildFormViews(ctx, [stored("sf424", SF424_PERSON)]);
    const b = views.find((v) => v.key === "sf424b")!;
    expect((b.data as any).title).toBe("Executive Director");
    expect(b.errorCount).toBe(0);
    expect(formsCheck(views)).toMatchObject({ ok: false, detail: expect.stringContaining("SF-LLL: complete it, or mark it not applicable") });

    views = buildFormViews(ctx, [stored("sf424", SF424_PERSON), stored("sflll", {}, { notApplicable: true, notApplicableReason: "No one is paid to lobby for this award.", notApplicableBy: "Sam" })]);
    expect(views.find((v) => v.key === "sflll")).toMatchObject({ status: "not_applicable", errorCount: 0 });
    expect(views.find((v) => v.key === "sf424")!.canBeNotApplicable).toBe(false);

    const reviewedAll = buildFormViews(
      ctx,
      [
        stored("sf424", SF424_PERSON),
        stored("sf424a", { "activity_line_items.0.activity_title": "Summer tutoring", confirmation: true }),
        stored("sflll", {}, { notApplicable: true, notApplicableReason: "No one is paid to lobby for this award.", notApplicableBy: "Sam" }),
      ],
    );
    const withReviews = buildFormViews(
      ctx,
      reviewedAll.map((v) => stored(v.key, v.key === "sf424" ? SF424_PERSON : v.key === "sf424a" ? { "activity_line_items.0.activity_title": "Summer tutoring", confirmation: true } : {}, {
        reviewedBy: "Sam",
        reviewedAt: new Date(),
        reviewedHash: v.dataHash,
        ...(v.key === "sflll" ? { notApplicable: true, notApplicableReason: "No one is paid to lobby for this award.", notApplicableBy: "Sam" } : {}),
      })),
    );
    expect(withReviews.map((v) => v.status)).toEqual(["complete", "complete", "complete", "not_applicable"]);
    expect(formsCheck(withReviews).ok).toBe(true);
  });

  it("renders readable rows, JSON and a PDF, and puts the forms in the package DOCX", async () => {
    const views = buildFormViews(ctx, [stored("sf424", SF424_PERSON)]);
    const rows = views.map(formRows);
    const sf424 = rows[0];
    expect(sf424.title).toMatch(/^SF-424: Application for Federal Assistance/);
    const all = sf424.sections.flatMap((s) => s.rows);
    expect(all.find((r) => r.value === "Read & Rise Literacy")).toBeTruthy();
    expect(all.some((r) => r.value === "Filled by Grants.gov on submission")).toBe(true);
    expect(rows[3].sections.flatMap((s) => s.rows).some((r) => r.value === TO_COMPLETE)).toBe(true);

    const meta = { draft: true, applicantName: "Read & Rise Literacy", opportunityTitle: "Community Literacy Grants", opportunityNumber: "ED-GRANTS-2026-01", generatedAt: new Date("2026-11-07T00:00:00Z") };
    const json = formsJson(views, meta);
    expect(json.notice).toMatch(/does not submit/);
    expect(json.definitions.repository).toBe("https://github.com/HHS/simpler-grants-gov");
    expect(json.forms.map((f) => f.form)).toEqual(["SF-424", "SF-424A", "SF-424B", "SF-LLL"]);
    expect((json.forms[0].data as any).organization_name).toBe("Read & Rise Literacy");

    const pdf = await buildFormsPdf(views, meta);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const docx = await buildApplicationPackage({
      draft: true,
      applicantName: "Read & Rise Literacy",
      applicantTypeLabel: "Nonprofit",
      ein: "12-3456789",
      uei: null,
      opportunity: { title: "Community Literacy Grants", number: "ED-GRANTS-2026-01", agency: "Department of Education", closeDate: "2026-12-20", officialUrl: "https://www.grants.gov/search-results-detail/1" },
      requestedAmount: budget.requested,
      sections: [{ title: "Need", content: "<p>Text</p>" }],
      budgetLines: [],
      budget,
      requirements: [],
      approvals: [],
      forms: rows,
      generatedAt: meta.generatedAt,
    });
    const xml = readZipEntry(docx, "word/document.xml");
    expect(xml).toContain("Federal forms");
    expect(xml).toContain("SF-424A: ");
    expect(xml).toContain("SF-LLL: ");
    expect(xml).toContain("GrantCrest does not submit the forms");
    expect(xml).toContain("Read &amp; Rise Literacy");
  });
});
