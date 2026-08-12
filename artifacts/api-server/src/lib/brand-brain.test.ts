/**
 * Brand Brain unit tests (deterministic, no DB) — relevance selection and
 * validation scoring are pure functions over plain data.
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreEntry,
  selectRelevantEntries,
  formatBrainBlock,
  validateDeterministic,
  overallScore,
  isValidCategory,
  splitVocab,
  claimAppearsIn,
  type BrainSelection,
} from "./brand-brain";
import type { BrandKnowledgeEntry, Brand, BrandFact } from "@workspace/db";

function entry(overrides: Partial<BrandKnowledgeEntry>): BrandKnowledgeEntry {
  return {
    id: overrides.id ?? "e1",
    brandId: "b1",
    category: "positioning",
    label: "Label",
    content: "Content",
    structured: null,
    enabled: true,
    provenance: "manual",
    sourceUrl: null,
    importedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BrandKnowledgeEntry;
}

describe("tokenize", () => {
  it("lowercases, splits, and drops stopwords/short tokens", () => {
    expect(tokenize("The Quick Brown Fox and the Lazy Dog")).toEqual(["quick", "brown", "fox", "lazy", "dog"]);
  });
});

describe("scoreEntry", () => {
  it("weights label matches double vs content matches", () => {
    const topic = new Set(["onboarding"]);
    const labelHit = scoreEntry({ label: "Onboarding flow", content: "irrelevant" }, topic);
    const contentHit = scoreEntry({ label: "irrelevant", content: "about onboarding" }, topic);
    expect(labelHit).toBeGreaterThan(contentHit);
  });

  it("returns 0 for no overlap", () => {
    expect(scoreEntry({ label: "Foo", content: "Bar" }, new Set(["baz"]))).toBe(0);
  });
});

describe("isValidCategory", () => {
  it("accepts known categories and rejects unknown ones", () => {
    expect(isValidCategory("positioning")).toBe(true);
    expect(isValidCategory("compliance")).toBe(true);
    expect(isValidCategory("made_up_category")).toBe(false);
  });
});

describe("selectRelevantEntries", () => {
  it("always includes rule categories regardless of topic relevance", () => {
    const entries = [
      entry({ id: "rule1", category: "compliance", label: "Disclosure", content: "Must include disclaimer" }),
      entry({ id: "irrelevant", category: "positioning", label: "Something else entirely", content: "unrelated content" }),
    ];
    const sel = selectRelevantEntries(entries, "email marketing tips");
    expect(sel.rules.map((e) => e.id)).toContain("rule1");
    expect(sel.reference.map((e) => e.id)).not.toContain("irrelevant");
  });

  it("ranks reference entries by topic keyword overlap", () => {
    const entries = [
      entry({ id: "relevant", category: "product_service", label: "Onboarding software", content: "helps teams onboard employees" }),
      entry({ id: "unrelated", category: "product_service", label: "Payroll tool", content: "handles payroll runs" }),
    ];
    const sel = selectRelevantEntries(entries, "employee onboarding best practices");
    expect(sel.reference[0]?.id).toBe("relevant");
    expect(sel.reference.map((e) => e.id)).not.toContain("unrelated");
  });

  it("excludes disabled entries entirely", () => {
    const entries = [entry({ id: "off", category: "compliance", label: "Old rule", content: "outdated", enabled: false })];
    const sel = selectRelevantEntries(entries, "anything");
    expect(sel.rules).toHaveLength(0);
  });
});

describe("formatBrainBlock", () => {
  it("returns empty string when nothing selected", () => {
    const sel: BrainSelection = { rules: [], reference: [] };
    expect(formatBrainBlock(sel)).toBe("");
  });

  it("renders rules and reference sections when present", () => {
    const sel: BrainSelection = {
      rules: [entry({ category: "compliance", label: "Disclaimer", content: "Always disclose sponsorship" })],
      reference: [entry({ category: "positioning", label: "Market position", content: "Category leader" })],
    };
    const block = formatBrainBlock(sel);
    expect(block).toContain("Brand rules");
    expect(block).toContain("Disclaimer");
    expect(block).toContain("Relevant brand knowledge");
    expect(block).toContain("Market position");
  });
});

const baseBrand: Pick<Brand, "prohibitedVocabulary" | "preferredVocabulary" | "complianceNotes"> = {
  prohibitedVocabulary: "guaranteed, cure",
  preferredVocabulary: "empower, partner",
  complianceNotes: null,
};

describe("splitVocab", () => {
  it("splits on commas, semicolons, and newlines and trims", () => {
    expect(splitVocab("a, b; c\nd")).toEqual(["a", "b", "c", "d"]);
  });
  it("handles null/empty", () => {
    expect(splitVocab(null)).toEqual([]);
    expect(splitVocab("")).toEqual([]);
  });
});

describe("claimAppearsIn", () => {
  it("matches when most significant tokens are present", () => {
    const tokens = new Set(tokenize("Our platform was founded in 2015 in Austin Texas"));
    expect(claimAppearsIn("Founded in 2015 in Austin", tokens)).toBe(true);
  });
  it("does not match unrelated claims", () => {
    const tokens = new Set(tokenize("A completely different sentence about weather"));
    expect(claimAppearsIn("Founded in 2015 in Austin", tokens)).toBe(false);
  });
});

describe("validateDeterministic", () => {
  it("flags banned phrases from prohibitedVocabulary", () => {
    const checks = validateDeterministic(baseBrand, [], [], "This is a guaranteed result.");
    const banned = checks.find((c) => c.type === "banned_phrases")!;
    expect(banned.passed).toBe(false);
    expect(banned.violations).toContain("guaranteed");
  });

  it("passes banned-phrase check when content is clean", () => {
    const checks = validateDeterministic(baseBrand, [], [], "This is a great result for our partners.");
    const banned = checks.find((c) => c.type === "banned_phrases")!;
    expect(banned.passed).toBe(true);
    expect(banned.score).toBe(100);
  });

  it("also flags terminology entries marked forbidden", () => {
    const entries = [entry({ category: "terminology", content: "revolutionary", structured: { forbidden: true } })];
    const checks = validateDeterministic(baseBrand, [], entries, "Our revolutionary new approach.");
    const banned = checks.find((c) => c.type === "banned_phrases")!;
    expect(banned.passed).toBe(false);
  });

  it("scores preferred terminology coverage", () => {
    const checks = validateDeterministic(baseBrand, [], [], "We empower our customers every day.");
    const term = checks.find((c) => c.type === "terminology")!;
    expect(term.score).toBe(50); // 1 of 2 preferred terms used
  });

  it("flags missing required brand claims", () => {
    const facts: Pick<BrandFact, "claim" | "status">[] = [{ claim: "Founded in 2015 in Austin", status: "active" }];
    const checks = validateDeterministic(baseBrand, facts, [], "We are a great company with no history mentioned.");
    const claims = checks.find((c) => c.type === "required_claims")!;
    expect(claims.passed).toBe(false);
    expect(claims.violations).toHaveLength(1);
  });

  it("passes required claims when reflected in content", () => {
    const facts: Pick<BrandFact, "claim" | "status">[] = [{ claim: "Founded in 2015 in Austin", status: "active" }];
    const checks = validateDeterministic(baseBrand, facts, [], "Founded in 2015 in Austin, our team has grown steadily.");
    const claims = checks.find((c) => c.type === "required_claims")!;
    expect(claims.passed).toBe(true);
  });

  it("enforces structured compliance requires/never rules", () => {
    const entries = [
      entry({
        category: "compliance",
        label: "Disclosure rule",
        content: "Sponsored content disclosure",
        structured: { requires: ["#sponsored"], never: ["guaranteed returns"] },
      }),
    ];
    const failing = validateDeterministic(baseBrand, [], entries, "Check out this guaranteed returns offer!");
    const compliance = failing.find((c) => c.type === "compliance")!;
    expect(compliance.passed).toBe(false);
    expect(compliance.violations.length).toBeGreaterThan(0);

    const passing = validateDeterministic(baseBrand, [], entries, "Check out this offer. #sponsored");
    expect(passing.find((c) => c.type === "compliance")!.passed).toBe(true);
  });
});

describe("overallScore", () => {
  it("averages check scores", () => {
    expect(overallScore([{ score: 100 }, { score: 50 }])).toBe(75);
  });
  it("folds in AI voice score when provided", () => {
    expect(overallScore([{ score: 100 }, { score: 100 }], 40)).toBe(80);
  });
  it("returns 100 when there is nothing to score", () => {
    expect(overallScore([])).toBe(100);
  });
});
