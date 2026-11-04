import { describe, expect, it } from "vitest";
import { inflateRawSync } from "zlib";
import {
  PLACE_DESIGNATIONS,
  PLACE_KINDS,
  effectiveStatus,
  matchPlaces,
  mentionedDesignations,
  needsRecheck,
  placeCatalog,
  placeStatements,
  validGeoRef,
  type PlaceRecord,
} from "./places";
import { matchOpportunity, type MatchApplicant, type MatchOpportunity } from "./matching";
import {
  DEFAULT_FORMAT,
  checkFormat,
  checkObjective,
  defaultFileStem,
  extractObjectives,
  fileNameIssues,
  logicModelGaps,
  logicModelHtml,
  parseFormatProfile,
  parseLogicModel,
  placeholders,
  readability,
  sectionWritingChecks,
  splitSentences,
  wordsPerPage,
} from "./writing";
import { checkLimit } from "./text";
import { evaluateCompliance } from "./compliance";
import { buildApplicationPackage } from "./packageExport";

const NOW = new Date("2026-11-04T12:00:00Z");

/** Reads one file from a zip (DOCX) through its central directory; enough for tests, no dependency. */
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

const record = (extra: Partial<PlaceRecord> = {}): PlaceRecord => ({
  status: "in",
  place: "Principal office",
  geoRef: "37063001503",
  checkedOn: "2026-10-20",
  validThrough: null,
  note: null,
  recordedBy: "Ana",
  recordedAt: "2026-10-20T15:00:00Z",
  ...extra,
});

describe("place designations", () => {
  it("cites an https primary source and a lookup tool for every designation", () => {
    for (const kind of PLACE_KINDS) {
      const spec = PLACE_DESIGNATIONS[kind];
      expect(spec.lookupUrl).toMatch(/^https:\/\/[a-z.]+\.gov\//);
      expect(spec.sources.length).toBeGreaterThan(0);
      for (const s of spec.sources) expect(s.url).toMatch(/^https:\/\/[a-z.]+\.gov\//);
    }
    expect(placeCatalog().map((c) => c.key)).toEqual(PLACE_KINDS);
    expect(placeCatalog()[0]).not.toHaveProperty("noticeTerms");
  });

  it("finds the designations a notice mentions, and not look-alikes", () => {
    expect(mentionedDesignations("Priority for projects in a Qualified Opportunity Zone or a HUBZone.")).toEqual(["opportunity_zone", "hubzone"]);
    expect(mentionedDesignations("Located in a Qualified Census Tract (QCT) or Difficult Development Area")).toEqual(["qct", "dda"]);
    expect(mentionedDesignations("Serves persistent poverty counties in rural communities")).toEqual(["persistent_poverty"]);
    expect(mentionedDesignations("Projects must be in an eligible rural area, as defined by USDA Rural Development.")).toEqual(["usda_rural"]);
    expect(mentionedDesignations("Rural areas, as defined in 7 U.S.C. 1991(a)(13), are eligible.")).toEqual(["usda_rural"]);
    expect(mentionedDesignations("Rural and urban applicants are welcome; this opportunity is open to all.")).toEqual([]);
    expect(mentionedDesignations("qct lowercase is not the acronym")).toEqual([]);
    expect(mentionedDesignations("")).toEqual([]);
  });

  it("validates the geography each designation uses", () => {
    expect(validGeoRef("opportunity_zone", "37063001503")).toBe(true);
    expect(validGeoRef("opportunity_zone", "37063")).toBe(false);
    expect(validGeoRef("persistent_poverty", "37063")).toBe(true);
    expect(validGeoRef("dda", "27701")).toBe(true);
    expect(validGeoRef("dda", "2770")).toBe(false);
  });

  it("treats an expired designation as unknown and flags old results", () => {
    expect(effectiveStatus(record(), NOW)).toBe("in");
    expect(effectiveStatus(record({ validThrough: "2026-10-31" }), NOW)).toBe("unknown");
    expect(effectiveStatus(undefined, NOW)).toBe("unknown");
    expect(needsRecheck(record(), NOW)).toBe(false);
    expect(needsRecheck(record({ checkedOn: "2025-10-01" }), NOW)).toBe(true);
    expect(needsRecheck(record({ status: "unknown", checkedOn: null }), NOW)).toBe(false);
  });

  it("explains each mention against what the organization recorded, without deciding eligibility", () => {
    const text = "Priority points for Opportunity Zones, HUBZones and persistent poverty counties; QCT projects welcome.";
    const result = matchPlaces({ opportunity_zone: record(), hubzone: record({ status: "not_in" }), qct: record({ validThrough: "2026-01-01" }) }, text, NOW);
    expect(result.kinds).toEqual(["opportunity_zone", "hubzone", "qct", "persistent_poverty"]);
    expect(result.inMentioned).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("Qualified Opportunity Zones");
    expect(result.reasons[0]).toContain("Check whether");
    expect(result.gaps.join(" ")).toContain("not in one");
    expect(result.gaps.join(" ")).toContain("ended on 2026-01-01");
    expect(result.gaps.join(" ")).toContain("The notice mentions persistent-poverty counties. Record whether");
  });

  it("adds 5 traceable points only when a mentioned designation is recorded as in", () => {
    const applicant: MatchApplicant = { applicantType: "small_business", mission: "Water sensors", focusAreas: [], state: "NC", annualBudget: null, maxCostSharePercent: 0 };
    const opp: MatchOpportunity = { title: "Small business growth in Opportunity Zones", description: null, categories: [], eligibilityCodes: ["23"], eligibilityText: null, status: "posted", closeDate: "2026-12-20", awardFloor: null, awardCeiling: null, costSharing: false };
    const without = matchOpportunity(applicant, opp, [], NOW);
    const withZone = matchOpportunity({ ...applicant, placeDesignations: { opportunity_zone: record() } }, opp, [], NOW);
    expect(withZone.score - without.score).toBe(5);
    expect(withZone.placeKinds).toEqual(["opportunity_zone"]);
    expect(without.gaps.some((g) => g.includes("Record whether"))).toBe(true);
    const unrelated = matchOpportunity({ ...applicant, placeDesignations: { opportunity_zone: record() } }, { ...opp, title: "Small business growth" }, [], NOW);
    expect(unrelated.score).toBe(matchOpportunity(applicant, { ...opp, title: "Small business growth" }, [], NOW).score);
  });

  it("turns only current, confirmed designations into drafting facts", () => {
    const facts = placeStatements({ opportunity_zone: record(), hubzone: record({ status: "not_in" }), qct: record({ validThrough: "2025-12-31" }) }, NOW);
    expect(facts).toEqual(["Principal office (census tract 37063001503) is in a Qualified Opportunity Zone, checked on 2026-10-20 using U.S. Treasury (CDFI Fund and IRS)'s lookup."]);
    expect(placeStatements(null, NOW)).toEqual([]);
  });
});

describe("writing checks", () => {
  it("splits sentences and scores readability", () => {
    expect(splitSentences("We serve 120 youth. Results improved! Is it working? Yes.")).toHaveLength(4);
    const easy = readability("<p>We teach kids to read. They read more each week. Their scores go up.</p>");
    const hard = readability("<p>The organization's comprehensive multidisciplinary intervention methodology systematically operationalizes evidence-based instructional frameworks across heterogeneous institutional environments.</p>");
    expect(easy.grade!).toBeLessThan(6);
    expect(hard.grade!).toBeGreaterThan(14);
    expect(readability("").grade).toBeNull();
  });

  it("flags long sentences", () => {
    const long = `<p>${Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")}.</p>`;
    expect(readability(long).longSentences).toHaveLength(1);
  });

  it("finds placeholders left by drafting and common stand-ins", () => {
    expect(placeholders("<p>Serves [Add: number of youth with source] youth in TBD counties, about XX% of whom</p>")).toEqual(["[Add: number of youth with source]", "TBD", "XX"]);
    expect(placeholders("<p>A finished paragraph with 25% growth.</p>")).toEqual([]);
  });

  it("checks objectives for numbers, timing and a baseline", () => {
    const good = checkObjective("By June 2027, increase the share of third graders reading at grade level from 41% to 55%.");
    expect(good).toMatchObject({ measurable: true, timeBound: true, baseline: true, notes: [] });
    const vague = checkObjective("Improve literacy in the community.");
    expect(vague.measurable).toBe(false);
    expect(vague.timeBound).toBe(false);
    expect(vague.notes.length).toBeGreaterThanOrEqual(3);
    const noBaseline = checkObjective("Increase attendance to 85% within 12 months.");
    expect(noBaseline.notes).toEqual(["Give the starting point (baseline) so the change can be measured."]);
  });

  it("reads objectives from list items first", () => {
    expect(extractObjectives("<ul><li>Enroll 120 youth by March 2027.</li><li>Train 12 tutors.</li></ul>")).toEqual(["Enroll 120 youth by March 2027.", "Train 12 tutors."]);
    const checks = sectionWritingChecks({ key: "objectives", title: "Goals and measurable objectives", content: "<ul><li>Enroll 120 youth by March 2027.</li><li>Train 12 tutors.</li></ul>" });
    expect(checks.objectives).toHaveLength(2);
    expect(checks.notes[0]).toContain("1 of 2 objectives");
    expect(sectionWritingChecks({ key: "need", title: "Statement of need", content: "<p>Text.</p>" }).objectives).toBeNull();
  });
});

describe("format profile and file names", () => {
  it("validates every field and names each problem", () => {
    expect(parseFormatProfile({ font: "Arial", sizePt: 11, lineSpacing: 2, marginsIn: 1, pageLimit: 10, fileName: "Project_Narrative.pdf" })).toEqual({ font: "Arial", sizePt: 11, lineSpacing: 2, marginsIn: 1, pageLimit: 10, fileName: "Project_Narrative.pdf" });
    const bad = parseFormatProfile({ font: "Comic Sans", sizePt: 30, pageLimit: 2.5, fileName: "x".repeat(60) });
    expect(bad).toContain("font must be one of");
    expect(bad).toContain("sizePt must be between 8 and 16");
    expect(bad).toContain("pageLimit must be a whole number");
    expect(bad).toContain("Grants.gov allows 50");
    expect(parseFormatProfile({ colour: "red" })).toContain("Unknown format field");
  });

  it("estimates words per page from font, size, spacing and margins", () => {
    expect(wordsPerPage(DEFAULT_FORMAT)).toBe(500);
    expect(wordsPerPage({ ...DEFAULT_FORMAT, lineSpacing: 2 })).toBe(250);
    expect(wordsPerPage({ ...DEFAULT_FORMAT, font: "Arial" })).toBeLessThan(500);
    expect(wordsPerPage({ ...DEFAULT_FORMAT, sizePt: 11, marginsIn: 0.75 })).toBeGreaterThan(600);
  });

  it("measures the narrative against the page limit", () => {
    const words = (n: number) => `<p>${Array.from({ length: n }, () => "word").join(" ")}</p>`;
    const sections = [{ content: words(1200) }, { content: words(1200) }];
    const single = checkFormat({ ...DEFAULT_FORMAT, pageLimit: 6 }, sections);
    expect(single.over).toBe(false);
    const double = checkFormat({ ...DEFAULT_FORMAT, lineSpacing: 2, pageLimit: 6 }, sections);
    expect(double.over).toBe(true);
    expect(double.estimatedPages).toBeGreaterThan(9);
    // Page limits on a section follow the same profile.
    expect(checkLimit(words(1000), "pages", 3, 250).over).toBe(true);
    expect(checkLimit(words(1000), "pages", 3).over).toBe(false);
  });

  it("applies Grants.gov's default attachment-name rules", () => {
    expect(fileNameIssues("Project_Narrative-v2.pdf")).toEqual([]);
    expect(fileNameIssues("Project Narrative.pdf")).toEqual([expect.objectContaining({ blocking: false })]);
    expect(fileNameIssues("Narrative/2027.pdf")[0].blocking).toBe(true);
    expect(fileNameIssues("é.pdf")[0].blocking).toBe(true);
    expect(fileNameIssues(`${"a".repeat(51)}`)[0].message).toContain("51 characters");
  });

  it("builds a Grants.gov-safe default file name", () => {
    const stem = defaultFileStem("Read & Rise Literacy, Inc.", "ED-GRANTS-110126-001", true);
    expect(stem).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(`${stem}.docx`.length).toBeLessThanOrEqual(50);
    expect(stem.endsWith("_DRAFT")).toBe(true);
    expect(fileNameIssues(`${defaultFileStem("A very long organization name that goes on and on", "HHS-2027-ACF-OCS-EE-0001", false)}.docx`)).toEqual([]);
  });
});

describe("logic model", () => {
  it("validates columns and lists gaps in reading order", () => {
    expect(parseLogicModel({ inputs: ["Two tutors", " "], extra: [] })).toContain("Unknown logic model column");
    expect(parseLogicModel({ inputs: "Two tutors" })).toBe("inputs must be a list of text");
    expect(parseLogicModel({ inputs: ["Two tutors", " "] })).toEqual({ inputs: ["Two tutors"] });
    expect(logicModelGaps({ inputs: ["Two tutors"] })).toEqual([
      "Add at least one item under Activities.",
      "Add at least one item under Outputs.",
      "Add at least one item under Short-term outcomes.",
      "Add at least one item under Long-term impact.",
    ]);
    expect(logicModelGaps({ inputs: ["a"], activities: ["b"], outputs: ["c"], shortTerm: ["Better reading"], longTerm: ["Readers"] })).toEqual(["Make at least one outcome measurable (a number or percentage)."]);
  });

  it("renders headings and lists that survive sanitizing and the DOCX export", async () => {
    const html = logicModelHtml({ inputs: ["Two <b>tutors</b>"], outputs: ["120 youth served"] });
    expect(html).toBe("<h3>Inputs</h3><ul><li>Two &lt;b&gt;tutors&lt;/b&gt;</li></ul><h3>Outputs</h3><ul><li>120 youth served</li></ul>");
    expect(logicModelHtml({})).toBe("");
  });
});

describe("package checks and export with the toolkit", () => {
  const base = {
    applicantType: "nonprofit_501c3" as const,
    eligibilityConfirmed: true,
    closeDate: "2026-12-20",
    requirements: [{ label: "Narrative", status: "covered", confirmed: true }],
    sections: [{ title: "Need", content: "<p>Need text with 41% of children reading below grade level.</p>", limitType: null, limitValue: null, status: "approved", demoContent: false }],
    budget: { issues: [], requested: 1000 } as any,
    readiness: [{ kind: "sam_registration", status: "ready", expiresOn: null }, { kind: "grants_gov_aor", status: "ready", expiresOn: null }, { kind: "irs_determination", status: "ready", expiresOn: null }],
    packageApproved: false,
  };

  it("blocks approval while placeholders remain, but not for demo text (its own check)", () => {
    expect(evaluateCompliance(base).checks.find((c) => c.id === "no_placeholders")?.ok).toBe(true);
    const left = evaluateCompliance({ ...base, sections: [{ ...base.sections[0], content: "<p>Serves [Add: count] youth.</p>" }] });
    expect(left.checks.find((c) => c.id === "no_placeholders")).toMatchObject({ ok: false, detail: "Fill the [Add: …] or TBD markers in: Need." });
    expect(left.readyForApproval).toBe(false);
  });

  it("checks format and letters only when the application uses them", () => {
    expect(evaluateCompliance(base).checks.some((c) => c.id === "format" || c.id === "letters")).toBe(false);
    const over = checkFormat({ ...DEFAULT_FORMAT, pageLimit: 1, lineSpacing: 2 }, [{ content: `<p>${"word ".repeat(600)}</p>` }]);
    const report = evaluateCompliance({ ...base, format: over, letters: [{ name: "Dr. Lee", organization: "County Schools", status: "requested" }, { name: "Mayor", organization: null, status: "declined" }] });
    expect(report.checks.find((c) => c.id === "format")?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "letters")).toMatchObject({ ok: false, detail: expect.stringContaining("Dr. Lee (County Schools)") });
    expect(report.readyForApproval).toBe(false);
  });

  it("exports the DOCX in the recorded font, size, spacing and margins", async () => {
    const buffer = await buildApplicationPackage({
      draft: true,
      applicantName: "Read & Rise",
      applicantTypeLabel: "Nonprofit",
      ein: null,
      uei: null,
      opportunity: { title: "Literacy", number: "ED-1", agency: "ED", closeDate: "2026-12-20", officialUrl: "https://www.grants.gov/x" },
      requestedAmount: 1000,
      sections: [{ title: "Logic model", content: logicModelHtml({ inputs: ["Two tutors"] }) }],
      budgetLines: [],
      budget: { categories: [], directTotal: 0, match: 0, indirect: 0, indirectRatePercent: 0, requested: 0, total: 0, issues: [] } as any,
      requirements: [],
      approvals: [],
      format: { ...DEFAULT_FORMAT, font: "Arial", sizePt: 11, lineSpacing: 2, marginsIn: 0.75 },
      generatedAt: NOW,
    });
    const styles = readZipEntry(buffer, "word/styles.xml");
    const document = readZipEntry(buffer, "word/document.xml");
    expect(styles).toContain('w:ascii="Arial"');
    expect(styles).toContain('w:val="22"');
    expect(styles).toContain('w:line="480"');
    expect(document).toContain('w:top="1080"');
    expect(document).toContain("Two tutors");
  });
});
