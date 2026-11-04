import { describe, expect, it } from "vitest";
import { builtInTemplates, chooseRegistryTemplate, fromRow, slugify, toInput, validateTemplate, type RegistryTemplate } from "./templateRegistry";

const base = {
  label: "Family foundation letter of inquiry",
  description: "Two pages, for private foundations.",
  appliesTo: { applicantKind: "nonprofit", jurisdiction: "any", titleIncludes: null },
  sections: [
    { title: "Organization background", guidance: "Who you are.", limitType: "words", limitValue: 400 },
    { title: "The request", guidance: "", limitType: "pages", limitValue: 1 },
  ],
  requirements: [
    { kind: "section", label: "Background", detail: "", sectionKey: "organization_background" },
    { kind: "attachment", label: "IRS determination letter", detail: "PDF" },
  ],
};

function custom(id: string, appliesTo: RegistryTemplate["appliesTo"], updatedAt: Date, status = "active"): RegistryTemplate {
  return fromRow({ id, label: id, description: null, basedOn: null, appliesTo, sections: [], requirements: [], status, version: 1, updatedAt });
}

describe("template validation", () => {
  it("normalizes a good template and derives section keys", () => {
    const r = validateTemplate(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sections.map((s) => s.key)).toEqual(["organization_background", "the_request"]);
    expect(r.value.sections[1]).toMatchObject({ limitType: "pages", limitValue: 1 });
    expect(r.value.requirements[0].sectionKey).toBe("organization_background");
    expect(slugify("  Budget & Justification! ")).toBe("budget_justification");
  });

  it("lists every problem with where it is", () => {
    const r = validateTemplate({
      label: "",
      appliesTo: { applicantKind: "robots", jurisdiction: "federal" },
      sections: [
        { title: "Need", limitType: "words", limitValue: 0 },
        { title: "Need", limitType: "lines", limitValue: 10 },
      ],
      requirements: [{ kind: "telepathy", label: "", sectionKey: "missing" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        "Enter a template name.",
        expect.stringMatching(/organization type must be one of/),
        "Section 1: the limit must be a whole number from 1 to 100,000.",
        expect.stringMatching(/^Section 2: another section already uses the key "need"/),
        "Section 2: the limit must be words, characters, pages or none.",
        expect.stringMatching(/^Requirement 1: choose a kind/),
        "Requirement 1: enter a label.",
        'Requirement 1: it points to a section ("missing") that is not in this template.',
      ]),
    );
    expect(validateTemplate({ ...base, sections: [], requirements: [] })).toMatchObject({ ok: false, errors: ["Add at least one section."] });
  });

  it("round-trips every built-in template through the editor shape", () => {
    for (const t of builtInTemplates()) {
      const r = validateTemplate(toInput(t));
      expect(r.ok, t.key).toBe(true);
      if (r.ok) expect(r.value.sections.map((s) => s.key)).toEqual(t.sections.map((s) => s.key));
    }
  });
});

describe("automatic template choice", () => {
  const t0 = new Date("2026-11-01T00:00:00Z");
  const t1 = new Date("2026-11-02T00:00:00Z");

  it("uses the built-in choice when no workspace template matches", () => {
    expect(chooseRegistryTemplate([], "nonprofit_501c3", "Community health", null)).toBe("federal_nonprofit");
    expect(chooseRegistryTemplate([], "small_business", "SBIR Phase I", null)).toBe("sbir_sttr");
    expect(chooseRegistryTemplate([custom("biz", { applicantKind: "business", jurisdiction: "any", titleIncludes: null }, t0)], "nonprofit_501c3", "x", "CA")).toBe("state_nonprofit");
  });

  it("prefers the most specific matching workspace template, then the newest", () => {
    const any = custom("any", { applicantKind: "any", jurisdiction: "any", titleIncludes: null }, t1);
    const state = custom("state", { applicantKind: "nonprofit", jurisdiction: "state", titleIncludes: null }, t0);
    const titled = custom("arts", { applicantKind: "any", jurisdiction: "any", titleIncludes: "arts" }, t0);
    const archived = custom("old", { applicantKind: "any", jurisdiction: "any", titleIncludes: "arts" }, t1, "archived");
    const all = [any, state, titled, archived];
    expect(chooseRegistryTemplate(all, "nonprofit_501c3", "Community Arts Grant", "CA")).toBe("custom:arts");
    expect(chooseRegistryTemplate(all, "nonprofit_501c3", "Literacy", "CA")).toBe("custom:state");
    expect(chooseRegistryTemplate(all, "nonprofit_501c3", "Literacy", null)).toBe("custom:any");
    const newer = custom("any2", { applicantKind: "any", jurisdiction: "any", titleIncludes: null }, new Date("2026-11-03T00:00:00Z"));
    expect(chooseRegistryTemplate([any, newer], "small_business", "x", null)).toBe("custom:any2");
  });
});
