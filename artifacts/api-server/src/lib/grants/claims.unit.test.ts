import { describe, expect, it } from "vitest";
import { acceptAiClaims, checkClaims, citationIn, claimFingerprint, datesIn, isPlanSentence, numbersIn, type SupportSource } from "./claims";
import { evaluateCompliance, type ComplianceInput } from "./compliance";
import { summarizeBudget } from "./budget";

/**
 * The unsupported-claim check's deterministic rules (no AI). Synthetic text
 * and records only.
 */

const fact = (label: string, body: string, id = "f1"): SupportSource => ({ kind: "fact", label: `Confirmed fact: ${label}`, factId: id, text: `${label} ${body}` });
const check = (html: string, sources: SupportSource[] = [], ownNames: string[] = ["Read & Rise Literacy", "Department of Education"]) => checkClaims({ html, sources, ownNames });
const kinds = (r: ReturnType<typeof check>) => r.findings.map((f) => `${f.kind}:${f.claim}`);

describe("claim rules", () => {
  it("finds numbers, dates and money, but not years as numbers or labels", () => {
    expect(numbersIn("We served 1,240 students and raised $25,000 (12%) in 2024.").map((n) => n.value)).toEqual([1240, 25000, 12]);
    expect(numbersIn("about 2.5 million readers").map((n) => [n.value, n.rounded])).toEqual([[2500000, true]]);
    expect(datesIn("Since March 2019, and again on 10/01/2025 and FY24.").map((d) => [d.year, d.month])).toEqual([[2019, 3], [2025, 10], [2024, null]]);
  });

  it("flags each kind of unbacked claim with a reason", () => {
    const result = check(
      "<p>Founded in 2009, we served 1,240 students last year. Our tutoring increased reading scores by 30%. We partner with the Durham County Library. Our staff are certified reading specialists.</p>",
    );
    expect(kinds(result)).toEqual(expect.arrayContaining(["date:2009", "number:1,240", "number:30%", "partner:Durham County Library", "credential:certified"]));
    expect(result.findings.find((f) => f.kind === "outcome")?.claim).toMatch(/^increased reading scores/);
    for (const f of result.findings) {
      expect(f.reason.length).toBeGreaterThan(20);
      expect(f.sentence.length).toBeGreaterThan(5);
      expect(f.fingerprint).toBe(claimFingerprint(f.kind, f.claim, f.sentence));
    }
  });

  it("accepts a claim a confirmed fact, the application's records or an in-text citation backs", () => {
    const sources: SupportSource[] = [
      fact("Founding", "Founded in 2009 in Durham, NC."),
      fact("Reach", "Served 1,240 students in the 2024-25 school year.", "f2"),
      { kind: "budget", label: "This application's budget", text: "Program director", numbers: [90000, 102300] },
      { kind: "letter", label: "Received letter of support: Durham County Library", text: "Ana Diaz Durham County Library Space for tutoring" },
    ];
    const result = check(
      "<p>Founded in 2009, we served 1,240 students last year. We request $102,300 for the program. We partner with the Durham County Library. Statewide, 38% of fourth graders read at grade level (Source: NC DPI, https://www.dpi.nc.gov/).</p>",
      sources,
    );
    expect(result.findings).toEqual([]);
    expect(result.supported.map((s) => s.by)).toEqual(expect.arrayContaining(["Confirmed fact: Founding", "Confirmed fact: Reach", "This application's budget", "Received letter of support: Durham County Library"]));
    expect(result.supported.some((s) => s.claim === "38%" && s.by.startsWith("Cited in the text"))).toBe(true);
  });

  it("does not flag plans, labels, citations to rules, addresses, or the applicant and funder's own names", () => {
    expect(isPlanSentence("We will serve 300 students by June 2028.")).toBe(true);
    expect(isPlanSentence("We served 300 students and will serve more.")).toBe(false);
    const result = check(
      "<p>We will serve 300 students by June 2028. Goal 2 covers Year 1. Costs follow 2 CFR 200. Our office is at 101 Main Street. Read & Rise Literacy applies to the Department of Education.</p>",
    );
    expect(result.findings).toEqual([]);
  });

  it("reads a citation the sentence carries", () => {
    expect(citationIn("Rates rose (Source: Census Bureau ACS 2023).")).toMatch(/Source/);
    expect(citationIn("According to the CDC, rates rose.")).toMatch(/According to the CDC/);
    expect(citationIn("Rates rose a lot.")).toBeNull();
  });

  it("keeps a fingerprint stable across spacing and case, so a dismissal survives a re-check", () => {
    expect(claimFingerprint("number", "1,240", "We served  1,240 students.")).toBe(claimFingerprint("number", "1,240", "we served 1,240 STUDENTS."));
    const a = check("<p>We served 1,240 students.</p>").findings[0];
    const b = check("<p>We  served 1,240 students.</p>").findings[0];
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("ignores [Add: …] placeholders (they are blocked by their own check)", () => {
    expect(check("<p>We served [Add: number of students in 2025] students.</p>").findings).toEqual([]);
  });
});

describe("AI claim output", () => {
  const html = "<p>We cut absenteeism by 18% across 4 schools.</p>";
  it("keeps only quotes found word for word in the section, with a known kind", () => {
    const { accepted, dropped } = acceptAiClaims(html, [
      { quote: "cut absenteeism by 18%", kind: "outcome", reason: "No fact states this." },
      { quote: "invented sentence that is not there", kind: "number", reason: "x" },
      { quote: "4 schools", kind: "made_up_kind" },
      "not an object",
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ kind: "outcome", claim: "cut absenteeism by 18%", reason: "AI check: No fact states this." });
    expect(dropped).toBe(3);
  });

  it("accepts { claims: [...] } and anything else as nothing", () => {
    expect(acceptAiClaims(html, { claims: [{ quote: "4 schools", kind: "number" }] }).accepted).toHaveLength(1);
    expect(acceptAiClaims(html, "nonsense").accepted).toEqual([]);
    expect(acceptAiClaims(html, null).accepted).toEqual([]);
  });
});

describe("compliance with claims and forms", () => {
  const budget = summarizeBudget([{ category: "personnel", description: "Director", quantity: 1, unitCost: 1000, matchPercent: 0, justification: "Leads" }], 0, null);
  const base = {
    applicantType: "nonprofit_501c3" as const,
    eligibilityConfirmed: true,
    closeDate: "2099-01-01",
    federal: true,
    requirements: [],
    sections: [{ title: "Need", content: "<p>Text</p>", status: "approved", limitType: null, limitValue: null, demoContent: false }],
    budget,
    readiness: [],
    packageApproved: false,
  } satisfies ComplianceInput;
  it("adds a failing check while a claim flag is open, and one for the federal forms", () => {
    const report = evaluateCompliance({ ...base, claims: { open: 2, sections: ["Need"] }, forms: { ok: false, detail: "SF-424: 3 fields to complete." } });
    expect(report.checks.find((c) => c.id === "claims_supported")).toMatchObject({ ok: false, detail: expect.stringContaining("2 unsupported claims open in: Need") });
    expect(report.checks.find((c) => c.id === "federal_forms")).toMatchObject({ ok: false });
    expect(report.readyForApproval).toBe(false);
    const clear = evaluateCompliance({ ...base, claims: { open: 0, sections: [] } });
    expect(clear.checks.find((c) => c.id === "claims_supported")?.ok).toBe(true);
  });
});
