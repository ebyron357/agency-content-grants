/**
 * Foundation matching and the "accepts applications" flag, without a
 * database. Every funder and filing here is synthetic.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankFunders, scoreFunder, policyView, WEIGHTS, type MatchFunder, type MatchOrganization } from "./matching";
import { readApplicationPolicy } from "./applicationPolicy";

const XML = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/irs-xml");

function funder(over: Partial<MatchFunder> = {}): MatchFunder {
  return {
    ein: "000000101", name: "ALDER SYNTHETIC FAMILY FOUNDATION", state: "NC", formType: "990PF", totalPaidUsd: 200_000, grantCount: 10,
    firstTaxYear: 2020, lastTaxYear: 2024,
    givingByYear: { "2020": 40_000, "2021": 40_000, "2022": 40_000, "2023": 40_000, "2024": 40_000 },
    givingByState: { NC: 150_000, VA: 50_000 }, givingByCategory: { B: 120_000, K: 80_000 }, categorySources: { ntee: 8, purpose: 2 },
    sizeStats: { count: 10, min: 5_000, p25: 10_000, median: 20_000, p75: 30_000, max: 60_000 },
    latestObjectId: "OBJ-A-2024", latestTaxPeriodEnd: "2024-12-31", filings: { "2024-12-31": "OBJ-A-2024", "2023-12-31": "OBJ-A-2023" },
    applicationPolicy: null, applicationPolicyTaxYear: null, applicationPolicyObjectId: null,
    ...over,
  };
}

const org: MatchOrganization = { state: "NC", causes: [{ key: "B", label: "Education", from: "focus area “literacy”" }], annualBudget: 400_000, requestUsd: null };

describe("scoreFunder", () => {
  it("explains every component and links the filing", () => {
    const m = scoreFunder(funder(), org, 2024);
    expect(m.components.map((c) => c.key)).toEqual(["state", "cause", "size", "recency", "consistency"]);
    expect(m.components.reduce((s, c) => s + c.max, 0)).toBe(100);
    expect(m.reasons[0]).toBe("Paid $150,000 to recipients in NC, 75% of its giving.");
    expect(m.reasons[1]).toBe("Paid $120,000 to education recipients (NTEE major groups, all states), 60% of its giving.");
    expect(m.reasons[2]).toMatch(/median grant of \$20,000 is 5% of your annual budget of \$400,000: a typical size/);
    expect(m.reasons[3]).toMatch(/tax year 2024, the latest year/);
    expect(m.reasons[4]).toBe("Paid grants in 5 of 5 tax years 2020–2024.");
    expect(m.score).toBe(100);
    expect(m.filing).toMatchObject({ objectId: "OBJ-A-2024", propublica: "https://projects.propublica.org/nonprofits/organizations/000000101" });
    expect(m.filings.map((f) => f.objectId)).toEqual(["OBJ-A-2024", "OBJ-A-2023"]);
    expect(m.cautions.some((c) => /counted separately/.test(c))).toBe(true);
  });

  it("fits a request against the funder's grant sizes", () => {
    const at = (requestUsd: number) => scoreFunder(funder(), { ...org, requestUsd }, 2024).components.find((c) => c.key === "size")!;
    expect(at(25_000).points).toBe(WEIGHTS.size);
    expect(at(50_000)).toMatchObject({ points: WEIGHTS.size / 2 });
    expect(at(50_000).reason).toMatch(/outside its usual \$10,000 to \$30,000/);
    expect(at(500_000)).toMatchObject({ points: 0 });
    expect(at(500_000).reason).toMatch(/above its largest grant on record \(\$60,000\)/);
  });

  it("marks a funder that gave long ago and rarely lower", () => {
    const old = funder({ firstTaxYear: 2019, lastTaxYear: 2021, givingByYear: { "2019": 10_000, "2021": 10_000 } });
    const m = scoreFunder(old, org, 2024);
    expect(m.components.find((c) => c.key === "recency")).toMatchObject({ points: 0 });
    expect(m.components.find((c) => c.key === "consistency")!.reason).toBe("Paid grants in 2 of 3 tax years 2019–2021; fewer than five years of its giving are imported.");
    expect(m.score).toBeLessThan(scoreFunder(funder(), org, 2024).score);
  });

  it("warns when causes come mostly from purpose text", () => {
    expect(scoreFunder(funder({ categorySources: { ntee: 1, purpose: 9 } }), org, 2024).cautions[0]).toMatch(/approximate/);
  });
});

describe("rankFunders", () => {
  it("ranks by score, then in-state giving, and can hide invitation-only funders", () => {
    const strong = funder({ ein: "000000001" });
    const distant = funder({ ein: "000000002", givingByState: { NC: 5_000, CA: 195_000 } });
    const closed = funder({ ein: "000000003", applicationPolicy: "invitation_only", applicationPolicyTaxYear: 2023, applicationPolicyObjectId: "OBJ-C" });
    const ranked = rankFunders([distant, closed, strong], org, 2024);
    expect(ranked.map((m) => m.ein)).toEqual(["000000001", "000000003", "000000002"]);
    // The flag never changes the score.
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked[1].cautions.some((c) => /preselected/.test(c))).toBe(true);
    expect(rankFunders([distant, closed, strong], org, 2024, { hideInvitationOnly: true }).map((m) => m.ein)).toEqual(["000000001", "000000002"]);
  });
});

describe("policyView", () => {
  it("shows the year the flag came from and never guesses", () => {
    expect(policyView(funder({ applicationPolicy: "invitation_only", applicationPolicyTaxYear: 2023, applicationPolicyObjectId: "X1" }))).toMatchObject({ status: "invitation_only", label: "Invitation only", taxYear: 2023, objectId: "X1" });
    expect(policyView(funder({ applicationPolicy: "accepts_applications", applicationPolicyTaxYear: 2024 }))).toMatchObject({ status: "accepts_applications", label: "Accepts applications", taxYear: 2024 });
    expect(policyView(funder())).toMatchObject({ status: "unknown", label: "Unknown", taxYear: null });
    expect(policyView(funder({ formType: "990" })).detail).toMatch(/Form 990, which has no such question/);
    expect(policyView(funder({ applicationPolicy: "something else" })).status).toBe("unknown");
  });
});

describe("readApplicationPolicy", () => {
  it("reads an unchecked Part XIV line 2 with how to apply, and no contact details", () => {
    const r = readApplicationPolicy(readFileSync(join(XML, "OBJ-A-2024_public.xml"), "utf8"));
    expect(r).toMatchObject({ ein: "000000101", returnType: "990PF", taxYear: 2024, taxPeriodEnd: "2024-12-31", policy: "accepts_applications" });
    expect(r.info).toEqual({
      formAndMaterials: "A TWO-PAGE LETTER OF INQUIRY DESCRIBING THE PROGRAM, BUDGET AND IRS DETERMINATION LETTER",
      deadlines: "MARCH 1 AND SEPTEMBER 1",
      restrictions: "501(C)(3) ORGANIZATIONS IN NORTH CAROLINA; NO GRANTS TO INDIVIDUALS",
    });
    expect(JSON.stringify(r)).not.toMatch(/SYNTHETIC CONTACT PERSON|5555550100/);
    expect(r.basis).toMatch(/does not check Part XIV line 2/);
  });

  it("reads a checked box as invitation only, with the filer's EIN, not the preparer's", () => {
    const r = readApplicationPolicy(readFileSync(join(XML, "OBJ-B-2023_public.xml"), "utf8"));
    expect(r).toMatchObject({ ein: "000000202", taxYear: 2022, policy: "invitation_only", info: {} });
  });

  it("reads the 2009–2012 element names", () => {
    const xml = `<Return xmlns="http://www.irs.gov/efile"><ReturnHeader><TaxPeriodEndDate>2011-12-31</TaxPeriodEndDate><ReturnType>990PF</ReturnType><Filer><EIN>000000909</EIN></Filer><TaxYear>2011</TaxYear></ReturnHeader>
      <ReturnData><IRS990PF><SupplementaryInformation><OnlyContributesToPreselected>X</OnlyContributesToPreselected></SupplementaryInformation></IRS990PF></ReturnData></Return>`;
    expect(readApplicationPolicy(xml)).toMatchObject({ ein: "000000909", taxYear: 2011, policy: "invitation_only" });
    const misspelt = xml.replace(/SupplementaryInformation/g, "SupplementaryInfomation").replace("<OnlyContributesToPreselected>X</OnlyContributesToPreselected>", "<AppicationSubmissionInfo><SubmissionDeadlines>NONE &amp; ROLLING</SubmissionDeadlines></AppicationSubmissionInfo>");
    expect(readApplicationPolicy(misspelt)).toMatchObject({ policy: "accepts_applications", info: { deadlines: "NONE & ROLLING" } });
  });

  it("says unknown, not yes, when the filing does not say", () => {
    const header = `<ReturnHeader><ReturnTypeCd>990PF</ReturnTypeCd><Filer><EIN>000000909</EIN></Filer><TaxYr>2024</TaxYr></ReturnHeader>`;
    expect(readApplicationPolicy(`<Return>${header}<ReturnData><IRS990PF><AnalysisOfRevenueAndExpenses/></IRS990PF></ReturnData></Return>`).policy).toBe("unknown");
    expect(readApplicationPolicy(`<Return>${header.replace("990PF", "990")}<ReturnData><IRS990/></ReturnData></Return>`).policy).toBe("unknown");
    expect(readApplicationPolicy("not xml at all").policy).toBe("unknown");
  });

  it("caps long text at 300 characters", () => {
    const long = "A".repeat(500);
    const xml = `<Return><ReturnHeader><ReturnTypeCd>990PF</ReturnTypeCd><TaxYr>2024</TaxYr></ReturnHeader><ReturnData><IRS990PF><SupplementaryInformationGrp><ApplicationSubmissionInfoGrp><RestrictionsOnAwardsTxt>${long}</RestrictionsOnAwardsTxt></ApplicationSubmissionInfoGrp></SupplementaryInformationGrp></IRS990PF></ReturnData></Return>`;
    expect(readApplicationPolicy(xml).info.restrictions).toHaveLength(300);
  });
});
