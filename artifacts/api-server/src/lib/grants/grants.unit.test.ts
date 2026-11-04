import { describe, expect, it } from "vitest";
import { normalizeDetail, normalizeSearchHit, toAmount, toIsoDate, plainText, publicOpportunityUrl, searchOpportunities, type FetchLike } from "./grantsgov";
import { evaluateGate, daysUntil } from "./gate";
import { matchMissionTerms, matchOpportunity, matchTopics, type MatchApplicant, type MatchOpportunity } from "./matching";
import { summarizeBudget } from "./budget";
import { checkLimit, countText, htmlToText } from "./text";
import { evaluateCompliance } from "./compliance";
import { TEMPLATES, chooseTemplate } from "./templates";
import { readinessKindsFor } from "./eligibility";
import { broadTopics, hasTopics, isNewFor, newSince, scoreMatches, summarizeAlerts } from "./matchSet";
import { MAX_FACTS_PER_DRAFT, factLine, factsForSection, factsMappedToSection, isFactCategory } from "./facts";
import { demoScaffold } from "./draftScaffold";
import { buildDeadlineCalendar, dueReminder, escapeIcsText, fileStem, foldIcsLine } from "./calendar";
import { caAmountRange, caDate, caMatching, normalizeCaRecord } from "./california";
import { htmlToBlocks, buildApplicationPackage } from "./packageExport";

// Shapes recorded from api.grants.gov on 3 November 2026 (public notice data, trimmed).
const SEARCH_HIT = {
  id: "357305",
  number: "PAR-25-274",
  title: "Feasibility Clinical Trials of Mind and Body Interventions for NCCIH High Priority Research Topics (R34 Clinical Trial Required)",
  agencyCode: "HHS-NIH11",
  agency: "National Institutes of Health",
  openDate: "11/21/2024",
  closeDate: "11/17/2026",
  oppStatus: "posted",
  docType: "synopsis",
  cfdaList: ["93.213"],
};

const DETAIL = {
  synopsis: {
    applicantTypes: [
      { id: "20", description: "Private institutions of higher education" },
      { id: "13", description: "Nonprofits that do not have a 501(c)(3) status with the IRS, other than institutions of higher education" },
      { id: "22", description: "For profit organizations other than small businesses" },
    ],
    fundingActivityCategories: [{ id: "HL", description: "Health" }],
    awardCeiling: "none",
    awardFloor: "none",
    costSharing: false,
    responseDate: "Nov 17, 2026 12:00:00 AM EST",
    postingDate: "Nov 21, 2024 12:00:00 AM EST",
    applicantEligibilityDesc: "Other Eligible Applicants include the following: Faith-based or Community-based Organizations",
    synopsisDesc: "<p>The goal of this notice of funding opportunity (NOFO) is to support feasibility trials.</p>",
    fundingDescLinkUrl: "http://grants.nih.gov/grants/guide/pa-files/PAR-25-274.html",
    agencyName: "National Institutes of Health",
  },
  cfdas: [{ cfdaNumber: "93.213" }, {}],
  opportunityPkgs: [{ openingDate: "2025-01-20", closingDate: "2026-11-17" }],
};

const NOW = new Date("2026-11-03T12:00:00Z");

describe("Grants.gov normalization", () => {
  it("parses every date format the API uses, and nothing else", () => {
    expect(toIsoDate("11/17/2026")).toBe("2026-11-17");
    expect(toIsoDate("1/5/2027")).toBe("2027-01-05");
    expect(toIsoDate("Nov 17, 2026 12:00:00 AM EST")).toBe("2026-11-17");
    expect(toIsoDate("2026-11-17")).toBe("2026-11-17");
    expect(toIsoDate("soon")).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it("treats 'none' and non-positive award amounts as unknown", () => {
    expect(toAmount("none")).toBeNull();
    expect(toAmount("0")).toBeNull();
    expect(toAmount("$250,000")).toBe(250000);
    expect(toAmount(75000)).toBe(75000);
  });

  it("normalizes a search hit with the public listing URL", () => {
    const opp = normalizeSearchHit(SEARCH_HIT)!;
    expect(opp).toMatchObject({ sourceRef: "357305", number: "PAR-25-274", status: "posted", openDate: "2024-11-21", closeDate: "2026-11-17", assistanceListings: ["93.213"] });
    expect(opp.officialUrl).toBe("https://www.grants.gov/search-results-detail/357305");
    expect(normalizeSearchHit({ ...SEARCH_HIT, id: "" })).toBeNull();
  });

  it("normalizes a detail record: eligibility codes, plain-text description, cfda numbers", () => {
    const detail = normalizeDetail(DETAIL);
    expect(detail.eligibilityCodes).toEqual(["20", "13", "22"]);
    expect(detail.categories).toEqual(["Health"]);
    expect(detail.awardCeiling).toBeNull();
    expect(detail.costSharing).toBe(false);
    expect(detail.closeDate).toBe("2026-11-17");
    expect(detail.description).toBe("The goal of this notice of funding opportunity (NOFO) is to support feasibility trials.");
    expect(detail.assistanceListings).toEqual(["93.213"]);
  });

  it("strips markup, drops script and style content, and decodes entities", () => {
    expect(plainText("<p>A &amp; B</p><ul><li>one</li></ul><script>alert(1)</script><style>p{}</style>")).toBe("A & B\none");
    expect(plainText("<p>First</p>\n\n\n<p>Second</p>")).toBe("First\n\nSecond");
  });

  it("encodes ids in public URLs", () => {
    expect(publicOpportunityUrl("12 3")).toBe("https://www.grants.gov/search-results-detail/12%203");
  });

  it("sends the search body Grants.gov expects and reads the response", async () => {
    let sent: any = null;
    const fake: FetchLike = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ errorcode: 0, data: { hitCount: 1, startRecord: 0, oppHits: [SEARCH_HIT] } }) };
    };
    const page = await searchOpportunities({ eligibilities: "23" }, fake);
    expect(sent.url).toBe("https://api.grants.gov/v1/api/search2");
    expect(sent.body).toMatchObject({ eligibilities: "23", oppStatuses: "forecasted|posted", rows: 100 });
    expect(page.hits).toHaveLength(1);
  });

  it("reports API errors instead of returning an empty list", async () => {
    const fake: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ errorcode: 5, msg: "bad" }) });
    await expect(searchOpportunities({}, fake)).rejects.toThrow(/error 5/);
    const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(searchOpportunities({}, down)).rejects.toThrow(/HTTP 503/);
  });
});

describe("publication gate", () => {
  const base = { title: "A grant", officialUrl: "https://www.grants.gov/search-results-detail/1", fetchedAt: NOW, status: "posted", closeDate: "2026-12-01" };

  it("publishes a complete, open record", () => {
    expect(evaluateGate(base, NOW)).toEqual({ publishable: true, missing: [] });
  });

  it("blocks closed, expired, unsourced or undated records and says why", () => {
    expect(evaluateGate({ ...base, closeDate: "2026-11-02" }, NOW).missing).toContain("closing date not passed");
    expect(evaluateGate({ ...base, closeDate: null }, NOW).missing).toContain("closing date");
    expect(evaluateGate({ ...base, officialUrl: "http://example.org" }, NOW).missing).toContain("official https source");
    expect(evaluateGate({ ...base, status: "archived" }, NOW).missing).toContain("open status (posted or forecasted)");
    expect(evaluateGate({ ...base, fetchedAt: null }, NOW).publishable).toBe(false);
  });

  it("lets a forecast through without a closing date", () => {
    expect(evaluateGate({ ...base, status: "forecasted", closeDate: null }, NOW).publishable).toBe(true);
  });

  it("counts days in UTC", () => {
    expect(daysUntil("2026-11-03", NOW)).toBe(0);
    expect(daysUntil("2026-12-03", NOW)).toBe(30);
    expect(daysUntil("2026-11-01", NOW)).toBe(-2);
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe("matching", () => {
  const nonprofit: MatchApplicant = { applicantType: "nonprofit_501c3", mission: "Youth literacy", focusAreas: ["literacy", "youth development"], state: "NC", annualBudget: 400000, maxCostSharePercent: 10 };
  const business: MatchApplicant = { applicantType: "small_business", mission: "Water sensors", focusAreas: ["water quality"], state: "NC", annualBudget: 1000000, maxCostSharePercent: 0 };
  const opp: MatchOpportunity = { title: "Community Literacy for Youth Development", description: "Supports literacy programs.", categories: ["Education"], eligibilityCodes: ["12", "13"], eligibilityText: null, status: "posted", closeDate: "2026-12-20", awardFloor: 50000, awardCeiling: 250000, costSharing: false };
  const ready = [{ kind: "sam_registration", status: "ready", expiresOn: "2027-06-01" }, { kind: "grants_gov_aor", status: "ready", expiresOn: null }, { kind: "irs_determination", status: "ready", expiresOn: null }];

  it("matches an eligible nonprofit and explains every reason", () => {
    const result = matchOpportunity(nonprofit, opp, ready, NOW);
    expect(result.eligible).toBe(true);
    expect(result.matchedTopics).toEqual(["literacy", "youth development"]);
    expect(result.missionTerms).toEqual(["youth", "literacy"]);
    expect(result.relevant).toBe(true);
    // eligibility 30, two topics 24, two mission words 8, award fit 15, days 10, readiness 10
    expect(result.score).toBe(30 + 24 + 8 + 15 + 10 + 10);
    expect(result.reasons.join(" ")).toMatch(/501\(c\)\(3\)/);
    expect(result.gaps).toEqual([]);
  });

  it("excludes a business from a nonprofit-only opportunity, with the reason", () => {
    const result = matchOpportunity(business, opp, [], NOW);
    expect(result.eligible).toBe(false);
    expect(result.score).toBe(0);
    expect(result.exclusions[0]).toMatch(/does not list small business/);
  });

  it("matches a small business on code 23 and excludes required cost share it cannot meet", () => {
    const forBusiness = { ...opp, title: "Water quality monitoring innovation", description: null, eligibilityCodes: ["23"] };
    expect(matchOpportunity(business, forBusiness, [], NOW).eligible).toBe(true);
    const withShare = matchOpportunity(business, { ...forBusiness, costSharing: true }, [], NOW);
    expect(withShare.eligible).toBe(false);
    expect(withShare.exclusions.join(" ")).toMatch(/cost sharing/);
  });

  it("treats unrestricted and 'others' eligibility as weaker matches to verify", () => {
    expect(matchOpportunity(business, { ...opp, eligibilityCodes: ["99"] }, [], NOW).reasons[0]).toMatch(/unrestricted/);
    expect(matchOpportunity(business, { ...opp, eligibilityCodes: ["25"] }, [], NOW).reasons[0]).toMatch(/others/);
  });

  it("reports readiness gaps, including a registration that expires before the deadline", () => {
    const expiring = [{ ...ready[0], expiresOn: "2026-12-01" }, ready[1], ready[2]];
    const result = matchOpportunity(nonprofit, opp, expiring, NOW);
    expect(result.gaps.join(" ")).toMatch(/expires on 2026-12-01/);
    expect(matchOpportunity(nonprofit, opp, [], NOW).gaps.length).toBeGreaterThanOrEqual(3);
  });

  it("excludes closed opportunities and passed deadlines", () => {
    expect(matchOpportunity(nonprofit, { ...opp, closeDate: "2026-11-01" }, ready, NOW).eligible).toBe(false);
    expect(matchOpportunity(nonprofit, { ...opp, status: "closed" }, ready, NOW).eligible).toBe(false);
  });

  it("requires every word of a multi-word topic", () => {
    expect(matchTopics(["youth sports"], { title: "Youth literacy", description: null, categories: [] })).toEqual([]);
    expect(matchTopics(["Youth  Sports!"], { title: "Sports for youth", description: null, categories: [] })).toEqual(["Youth  Sports!"]);
  });

  it("uses distinctive mission words and ignores generic ones", () => {
    const text = { title: "Health research for rural communities", description: "Improve access to literacy services.", categories: [] };
    expect(matchMissionTerms("Improve health and literacy services in rural communities.", text)).toEqual(["literacy"]);
    expect(matchMissionTerms(null, text)).toEqual([]);
  });

  it("marks an eligible but off-topic opportunity as not relevant, and ranks it below an on-topic one", () => {
    const offTopic = { ...opp, title: "Cancer biology R01", description: "Tumor microenvironment studies.", categories: ["Health"] };
    const off = matchOpportunity(nonprofit, offTopic, ready, NOW);
    const on = matchOpportunity(nonprofit, opp, ready, NOW);
    expect(off.eligible).toBe(true);
    expect(off.relevant).toBe(false);
    expect(off.score).toBeLessThan(on.score);
  });
});

describe("budget", () => {
  it("totals SF-424A categories, match and indirect, and flags problems", () => {
    const summary = summarizeBudget([
      { category: "personnel", description: "Program manager", quantity: 1, unitCost: 60000, matchPercent: 0, justification: "Leads delivery" },
      { category: "supplies", description: "Books", quantity: 200, unitCost: 15, matchPercent: 50, justification: "" },
    ], 10, 60000);
    const personnel = summary.categories.find((c) => c.category === "personnel")!;
    expect(personnel.total).toBe(60000);
    expect(summary.directTotal).toBe(63000);
    expect(summary.match).toBe(1500);
    expect(summary.indirect).toBe(6150);
    expect(summary.requested).toBe(67650);
    expect(summary.issues.join(" ")).toMatch(/Books" needs a justification/);
    expect(summary.issues.join(" ")).toMatch(/above the award ceiling/);
  });

  it("requires at least one line", () => {
    expect(summarizeBudget([], 0, null).issues).toContain("Add at least one budget line.");
  });
});

describe("limits", () => {
  it("counts words and characters from rich text and checks the limit", () => {
    expect(countText("<p>One two</p><p>three</p>")).toEqual({ words: 3, characters: 13 });
    expect(checkLimit("<p>one two three</p>", "words", 2).over).toBe(true);
    expect(checkLimit("<p>one two three</p>", "characters", 100).over).toBe(false);
    expect(checkLimit("<p>one</p>", null, null).limit).toBeNull();
  });
});

describe("templates", () => {
  it("chooses SBIR/STTR for business SBIR notices, business and nonprofit templates otherwise", () => {
    expect(chooseTemplate("small_business", "Phase I SBIR: sensors")).toBe("sbir_sttr");
    expect(chooseTemplate("small_business", "Rural business grants")).toBe("federal_business");
    expect(chooseTemplate("nonprofit_501c3", "SBIR")).toBe("federal_nonprofit");
  });

  it("maps every section to a matrix row", () => {
    for (const template of Object.values(TEMPLATES)) {
      const keys = template.requirements.filter((r) => r.kind === "section").map((r) => r.sectionKey);
      expect(keys).toEqual(template.sections.map((s) => s.key));
    }
  });

  it("asks nonprofits with 501(c)(3) status for their determination letter, and businesses for a capability statement", () => {
    expect(readinessKindsFor("nonprofit_501c3")).toContain("irs_determination");
    expect(readinessKindsFor("nonprofit_other")).not.toContain("irs_determination");
    expect(readinessKindsFor("small_business")).toContain("capability_statement");
  });
});

describe("compliance", () => {
  const passing = {
    applicantType: "small_business" as const,
    eligibilityConfirmed: true,
    closeDate: "2026-12-20",
    requirements: [{ label: "Abstract", status: "covered", confirmed: true }],
    sections: [{ title: "Abstract", content: "<p>Written.</p>", limitType: "words", limitValue: 10, status: "approved", demoContent: false }],
    budget: summarizeBudget([{ category: "personnel", description: "PI", quantity: 1, unitCost: 1000, matchPercent: 0, justification: "Leads" }], 0, null),
    readiness: [{ kind: "sam_registration", status: "ready", expiresOn: null }, { kind: "grants_gov_aor", status: "ready", expiresOn: null }],
    packageApproved: false,
  };

  it("is ready for approval only when every check passes, and ready to export only after approval", () => {
    const before = evaluateCompliance(passing);
    expect(before.readyForApproval).toBe(true);
    expect(before.readyToExport).toBe(false);
    expect(evaluateCompliance({ ...passing, packageApproved: true }).readyToExport).toBe(true);
  });

  it("names what fails", () => {
    const report = evaluateCompliance({
      ...passing,
      eligibilityConfirmed: false,
      sections: [{ ...passing.sections[0], content: "<p>one two three four five six seven eight nine ten eleven</p>", demoContent: true, status: "drafting" }],
      readiness: [],
    });
    const failing = report.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failing).toEqual(expect.arrayContaining(["eligibility", "limits", "no_demo", "sections_approved", "readiness", "package_approval"]));
    expect(report.readyForApproval).toBe(false);
  });
});

describe("package export", () => {
  it("turns section HTML into headings, paragraphs and bullets", () => {
    expect(htmlToBlocks("<h3>Need</h3><p>A &amp; B</p><ul><li>One</li></ul>")).toEqual([
      { kind: "heading", text: "Need" },
      { kind: "paragraph", text: "A & B" },
      { kind: "bullet", text: "One" },
    ]);
  });

  it("builds a valid DOCX (zip) package", async () => {
    const budget = summarizeBudget([{ category: "personnel", description: "PI", quantity: 1, unitCost: 1000, matchPercent: 0, justification: "Leads" }], 0, null);
    const buffer = await buildApplicationPackage({
      draft: true,
      applicantName: "Test Org",
      applicantTypeLabel: "Small business",
      ein: null,
      uei: null,
      opportunity: { title: "Test opportunity", number: "T-1", agency: "Agency", closeDate: "2026-12-20", officialUrl: "https://www.grants.gov/search-results-detail/1" },
      requestedAmount: 1000,
      sections: [{ title: "Abstract", content: "<p>Hello</p>" }],
      budgetLines: [{ category: "personnel", description: "PI", quantity: 1, unitCost: 1000, matchPercent: 0, justification: "Leads" }],
      budget,
      requirements: [{ kind: "section", label: "Abstract", status: "covered", sourceRef: "p. 4" }],
      approvals: [],
      generatedAt: NOW,
    });
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(2000);
  });
});

describe("match alerts", () => {
  const base = { title: "Community Literacy for Youth Development", description: "Supports literacy programs.", categories: ["Education"], eligibilityCodes: ["12"], eligibilityText: null, status: "posted", awardFloor: 50000, awardCeiling: 250000, costSharing: false };
  const opp = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({ id, closeDate: "2026-12-20", createdAt: new Date(createdAt), ...base, ...extra }) as any;
  const applicant = (extra: Record<string, unknown> = {}) => ({ id: "a1", applicantType: "nonprofit_501c3", mission: "Youth literacy", focusAreas: ["literacy"], state: "NC", annualBudget: 400000, maxCostSharePercent: 0, createdAt: new Date("2026-11-01T00:00:00Z"), matchesSeenAt: null, ...extra }) as any;

  it("counts as new only what was stored after the organization was added or last marked seen", () => {
    expect(newSince(applicant())).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(newSince(applicant({ matchesSeenAt: new Date("2026-11-02T00:00:00Z") }))).toEqual(new Date("2026-11-02T00:00:00Z"));
    expect(isNewFor({ createdAt: new Date("2026-11-03T00:00:00Z") }, new Date("2026-11-02T00:00:00Z"))).toBe(true);
    expect(isNewFor({ createdAt: new Date("2026-11-01T00:00:00Z") }, new Date("2026-11-02T00:00:00Z"))).toBe(false);
  });

  it("orders on-topic matches first and summarizes new and closing-soon on-topic matches", () => {
    const opps = [
      opp("off", "2026-11-03T00:00:00Z", { title: "Cancer biology R01", description: "Tumor studies.", categories: ["Health"] }),
      opp("old", "2026-10-01T00:00:00Z"),
      opp("new", "2026-11-03T00:00:00Z", { closeDate: "2026-11-10" }),
      opp("closed-to-us", "2026-11-03T00:00:00Z", { eligibilityCodes: ["23"] }),
    ];
    const { scored, excluded } = scoreMatches(applicant(), opps, [], NOW);
    expect(excluded).toBe(1);
    expect(scored.map((s) => s.opp.id).slice(-1)).toEqual(["off"]);
    // On-topic only: "new" is new and closes in 7 days; "off" is new but off-topic; "old" predates the organization.
    expect(summarizeAlerts(applicant(), scored)).toEqual({ newMatches: 1, closingSoon: 1 });
    // Without topics every eligible match counts.
    expect(summarizeAlerts(applicant({ focusAreas: [], mission: null }), scored)).toEqual({ newMatches: 2, closingSoon: 1 });
    expect(hasTopics(applicant({ focusAreas: [], mission: "  " }))).toBe(false);
  });

  it("flags a focus area that matches most eligible opportunities as broad", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ opp: { id: `o${i}` }, match: { matchedTopics: i < 40 ? ["health"] : i < 45 ? ["literacy"] : [] } })) as any;
    expect(broadTopics(["health", "literacy"], many)).toEqual(["health"]);
    // Too few matches to judge.
    expect(broadTopics(["health"], many.slice(0, 10))).toEqual([]);
  });
});

describe("fact library", () => {
  const fact = (id: string, category: string, confirmedAt: string | null, extra: Record<string, unknown> = {}) => ({ id, category, label: `Fact ${id}`, body: `Body ${id}`, source: null, asOf: null, confirmedAt, ...extra });

  it("formats a fact with its source and date, or says the source is missing", () => {
    expect(factLine(fact("a", "need", "2026-11-01", { source: "Census ACS 2024", asOf: "2024-12-31" }))).toBe("Fact a: Body a (source: Census ACS 2024, as of 2024-12-31)");
    expect(factLine(fact("b", "need", "2026-11-01"))).toBe("Fact b: Body b (source not recorded)");
    expect(isFactCategory("need")).toBe(true);
    expect(isFactCategory("toString")).toBe(false);
  });

  it("gives drafting only confirmed facts, the section's categories first, within bounds", () => {
    const facts = [
      fact("staff1", "staff", "2026-11-02"),
      fact("need1", "need", "2026-11-01"),
      fact("need2", "need", null),
      fact("need3", "need", "2026-11-03"),
    ];
    expect(factsForSection(facts, "need").map((f) => f.id)).toEqual(["need3", "need1", "staff1"]);
    expect(factsMappedToSection(facts, "need").map((f) => f.id)).toEqual(["need1", "need3"]);
    // An unmapped section uses every confirmed fact.
    expect(factsMappedToSection(facts, "custom_section").map((f) => f.id)).toEqual(["staff1", "need1", "need3"]);
    const many = Array.from({ length: 40 }, (_, i) => fact(`m${i}`, "need", "2026-11-01"));
    expect(factsForSection(many, "need")).toHaveLength(MAX_FACTS_PER_DRAFT);
    const huge = Array.from({ length: 10 }, (_, i) => fact(`h${i}`, "need", "2026-11-01", { body: "x".repeat(1900) }));
    expect(factsForSection(huge, "need").length).toBeLessThan(10);
  });

  it("lists facts on file in the demo scaffold, escaped", () => {
    const html = demoScaffold({
      applicant: { name: "Org", applicantTypeLabel: "Nonprofit", mission: null, serviceArea: null, state: null, focusAreas: [] },
      opportunity: { title: "Opp", agency: null, description: null },
      section: { title: "Statement of need", guidance: null, limitType: null, limitValue: null, content: "" },
      requirements: [],
      facts: ["Child poverty: 31% <b>in</b> Halifax County (source: ACS 2024)"],
    });
    expect(html).toMatch(/Facts on file you can use here/);
    expect(html).toContain("Child poverty: 31% &lt;b&gt;in&lt;/b&gt; Halifax County");
  });
});

describe("deadline calendar", () => {
  it("escapes text and folds long lines at 75 octets without splitting characters", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldIcsLine("SUMMARY:" + "é".repeat(60));
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe("SUMMARY:" + "é".repeat(60));
  });

  it("builds all-day events with three reminders and skips dates it cannot read", () => {
    const ics = buildDeadlineCalendar("Grant deadlines", [
      { uid: "a1", date: "2026-12-16", summary: "Grant due: Reading, writing", description: "Line one\nLine two", url: "https://www.grants.gov/search-results-detail/1" },
      { uid: "bad", date: "12/16/2026", summary: "Skipped", description: "" },
    ], new Date("2026-11-04T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261216");
    expect(ics).toContain("DTEND;VALUE=DATE:20261217");
    expect(ics).toContain("SUMMARY:Grant due: Reading\\, writing");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(ics).toContain("TRIGGER:-P14D");
    expect(ics).not.toContain("Skipped");
    expect(ics).toContain("Confirm the closing time and time zone");
  });

  it("fires each reminder threshold once as the deadline approaches", () => {
    expect(dueReminder(30, null)).toBeNull();
    expect(dueReminder(14, null)).toBe(14);
    expect(dueReminder(10, 14)).toBeNull();
    expect(dueReminder(7, 14)).toBe(7);
    expect(dueReminder(5, null)).toBe(7);
    expect(dueReminder(2, 7)).toBe(2);
    expect(dueReminder(0, 2)).toBeNull();
    expect(dueReminder(-1, null)).toBeNull();
    expect(dueReminder(null, null)).toBeNull();
    expect(fileStem("Readers Rising / HRSA-27-022")).toBe("Readers-Rising-HRSA-27-022");
  });
});

describe("California Grants Portal connector", () => {
  // Shape recorded from data.ca.gov on 4 November 2026 (public listing, trimmed).
  const RECORD = {
    _id: 1, PortalID: "194241", GrantID: "None", Status: "active", LastUpdated: "2026-10-30T17:18:33.000",
    AgencyDept: "CA Department of Food and Agriculture", Title: "2027 CNIP Expansion", Type: "Grant",
    Categories: "Agriculture; Food & Nutrition; Health & Human Services",
    Purpose: "CNIP encourages purchases of California-grown produce.", Description: "CDFA seeks project proposals.",
    ApplicantType: "Nonprofit; Business; Public Agency", ApplicantTypeNotes: "Eligibility is limited to certified farmers\u2019 markets.",
    Geography: "Low-access areas", FundingSource: "State", MatchingFunds: "Not Required", MatchingFundsNotes: "None",
    EstAvailFunds: "$750,000.00", EstAmounts: "Between $10,000.00 and $300,000.00", FundingMethod: "Reimbursement(s)",
    OpenDate: "2026-10-30 15:00:00", ApplicationDeadline: "2026-12-04 17:00:00",
    GrantURL: "https://cafarmtofork.cdfa.ca.gov/farm_to_fork/grants/cnip.html", AgencyURL: "https://www.cdfa.ca.gov",
  };

  it("parses dates, award ranges and matching rules in the portal's formats", () => {
    expect(caDate("2026-12-04 17:00:00")).toBe("2026-12-04");
    expect(caDate("Ongoing")).toBeNull();
    expect(caAmountRange("Between $10,000.00 and $300,000.00")).toEqual([10000, 300000]);
    expect(caAmountRange("$50,000.00")).toEqual([50000, 50000]);
    expect(caAmountRange("Dependant on number of submissions received, application process, etc.")).toEqual([null, null]);
    expect(caMatching("Not Required")).toEqual({ costSharing: false, costSharePercent: null });
    expect(caMatching("25%")).toEqual({ costSharing: true, costSharePercent: 25 });
    expect(caMatching("Varies")).toEqual({ costSharing: true, costSharePercent: null });
  });

  it("normalizes a record into a gated, state-scoped opportunity", () => {
    const n = normalizeCaRecord(RECORD)!;
    expect(n).toMatchObject({
      sourceRef: "194241", number: null, status: "posted", openDate: "2026-10-30", closeDate: "2026-12-04", rollingDeadline: false,
      awardFloor: 10000, awardCeiling: 300000, estimatedFunding: 750000, costSharing: false, jurisdiction: "CA",
      officialUrl: "https://cafarmtofork.cdfa.ca.gov/farm_to_fork/grants/cnip.html",
    });
    expect(n.eligibilityCodes).toEqual(["12", "13", "22", "23"]);
    expect(n.categories).toEqual(["Agriculture", "Food & Nutrition", "Health & Human Services"]);
    expect(n.eligibilityText).toMatch(/California applicant types: Nonprofit; Business; Public Agency/);
    const rolling = normalizeCaRecord({ ...RECORD, ApplicationDeadline: "Ongoing", GrantURL: "http://insecure.example", Status: "forecasted" })!;
    expect(rolling).toMatchObject({ closeDate: null, rollingDeadline: true, status: "forecasted", officialUrl: "https://www.cdfa.ca.gov" });
    expect(normalizeCaRecord({ ...RECORD, Title: "None" })).toBeNull();
  });

  it("publishes a posted record with a stated rolling deadline, but not one with no deadline at all", () => {
    const base = { title: "T", officialUrl: "https://x.ca.gov", fetchedAt: NOW, status: "posted", closeDate: null };
    expect(evaluateGate({ ...base, rollingDeadline: true }, NOW).publishable).toBe(true);
    expect(evaluateGate(base, NOW).missing).toContain("closing date");
  });

  it("matches state programs on residency and stated match percentage, without federal registrations", () => {
    const opp = { title: "Community Literacy for Youth Development", description: "Supports literacy programs.", categories: ["Education"], eligibilityCodes: ["12", "13"], eligibilityText: null, status: "posted", closeDate: null, awardFloor: 10000, awardCeiling: 200000, costSharing: true, costSharePercent: 25, rollingDeadline: true, jurisdiction: "CA" };
    const ca: MatchApplicant = { applicantType: "nonprofit_501c3", mission: "Youth literacy", focusAreas: ["literacy"], state: "ca", annualBudget: 400000, maxCostSharePercent: 30 };
    const irs = [{ kind: "irs_determination", status: "ready", expiresOn: null }];
    const inCa = matchOpportunity(ca, opp, irs, NOW);
    expect(inCa.eligible).toBe(true);
    expect(inCa.gaps.join(" ")).not.toMatch(/SAM|Grants\.gov/);
    expect(inCa.reasons.join(" ")).toMatch(/Rolling deadline/);
    expect(inCa.reasons.join(" ")).toMatch(/Eligibility includes nonprofits/);
    expect(inCa.reasons.join(" ")).not.toMatch(/501\(c\)\(3\)/);
    expect(inCa.reasons.join(" ")).toMatch(/25% match, within the 30%/);
    expect(matchOpportunity({ ...ca, state: "NC" }, opp, irs, NOW).exclusions[0]).toMatch(/CA state program; this organization is recorded in NC/);
    expect(matchOpportunity({ ...ca, state: null }, opp, irs, NOW).gaps.join(" ")).toMatch(/Add the organization's state/);
    expect(matchOpportunity({ ...ca, maxCostSharePercent: 10 }, opp, irs, NOW).exclusions.join(" ")).toMatch(/requires a 25% match; this organization can commit up to 10%/);
    // A federal opportunity still requires the federal registrations.
    expect(matchOpportunity(ca, { ...opp, jurisdiction: null, costSharing: false }, irs, NOW).gaps.join(" ")).toMatch(/SAM\.gov/);
  });

  it("uses a state template without federal forms, and compliance skips federal registrations", () => {
    expect(chooseTemplate("nonprofit_501c3", "CNIP", "CA")).toBe("state_nonprofit");
    expect(chooseTemplate("small_business", "SBIR Phase I", "CA")).toBe("state_business");
    const labels = TEMPLATES.state_nonprofit.requirements.map((r) => r.label).join(" ");
    expect(labels).not.toMatch(/SF-424|SAM\.gov/);
    expect(labels).toMatch(/State application portal/);
  });
});

describe("saved writing", () => {
  it("turns section HTML into plain text with breaks kept", () => {
    expect(htmlToText("<h3>Capacity</h3><p>Founded in 2009 &amp; staffed by 12.</p><ul><li>One</li><li>Two</li></ul>")).toBe("Capacity\nFounded in 2009 & staffed by 12.\nOne\nTwo");
  });

  it("points the demo outline to approved writing on file, escaped", () => {
    const html = demoScaffold({
      applicant: { name: "Org", applicantTypeLabel: "Nonprofit", mission: null, serviceArea: null, state: null, focusAreas: [] },
      opportunity: { title: "Opp", agency: null, description: null },
      section: { title: "Organizational capacity", guidance: null, limitType: null, limitValue: null, content: "" },
      requirements: [],
      facts: [],
      savedWriting: [{ title: "Capacity <2026>", text: "We have run programs since 2009." }],
    });
    expect(html).toMatch(/Approved writing on file for this section/);
    expect(html).toContain("Capacity &lt;2026&gt;");
  });
});
