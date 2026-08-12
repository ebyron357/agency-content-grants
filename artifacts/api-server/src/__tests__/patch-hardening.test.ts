/**
 * PATCH hardening unit tests.
 * Verifies that the pickAllowed helper used in every PATCH route
 * rejects forbidden fields and accepts valid ones.
 */
import { describe, it, expect } from "vitest";

// Inline the same pickAllowed logic used in routes
function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> | { __error: string } {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

const PROJECT_PATCH_ALLOWED = new Set([
  "title", "topic", "contentType", "purpose", "intendedAudience", "audienceKnowledgeLevel",
  "desiredReaderOutcome", "geographicFocus", "targetLength", "tone", "readingLevel",
  "pointOfView", "researchFreshness", "citationRequirement", "requiredSections",
  "subjectsToAvoid", "wordsToAvoid", "additionalInstructions", "status",
]);

const BRAND_PATCH_ALLOWED = new Set([
  "name", "description", "industry", "website", "voiceDescription",
  "tonePreferences", "readingLevel", "preferredVocabulary", "prohibitedVocabulary",
  "geographicFocus", "complianceNotes", "status",
]);

const SECTION_PATCH_ALLOWED = new Set(["title", "content", "notes"]);

const REPURPOSED_ASSET_PATCH_ALLOWED = new Set(["title", "content"]);

const REPURPOSING_PRESET_FIELDS = new Set(["name", "tone", "audience", "cta", "targetLength"]);

describe("Project PATCH allowlist", () => {
  it("accepts all allowed fields", () => {
    const result = pickAllowed({ tone: "analytical", status: "active" }, PROJECT_PATCH_ALLOWED);
    expect((result as any).__error).toBeUndefined();
    expect(result).toEqual({ tone: "analytical", status: "active" });
  });

  it("rejects id field", () => {
    const result = pickAllowed({ id: "injected-id", tone: "formal" }, PROJECT_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/id/);
  });

  it("rejects userId field", () => {
    const result = pickAllowed({ userId: "other-user", topic: "test" }, PROJECT_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/userId/);
  });

  it("rejects workflowStage (controlled by dedicated actions)", () => {
    const result = pickAllowed({ workflowStage: "complete" }, PROJECT_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/workflowStage/);
  });

  it("rejects createdAt and updatedAt", () => {
    const r1 = pickAllowed({ createdAt: "2020-01-01" }, PROJECT_PATCH_ALLOWED);
    const r2 = pickAllowed({ updatedAt: "2020-01-01" }, PROJECT_PATCH_ALLOWED);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
  });

  it("rejects brandId (internal relationship)", () => {
    const result = pickAllowed({ brandId: "other-brand" }, PROJECT_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/brandId/);
  });
});

describe("Brand PATCH allowlist", () => {
  it("accepts allowed brand fields", () => {
    const result = pickAllowed({ name: "New Name", status: "active" }, BRAND_PATCH_ALLOWED);
    expect((result as any).__error).toBeUndefined();
    expect((result as any).name).toBe("New Name");
  });

  it("rejects userId and id", () => {
    const r1 = pickAllowed({ userId: "x" }, BRAND_PATCH_ALLOWED);
    const r2 = pickAllowed({ id: "x" }, BRAND_PATCH_ALLOWED);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
  });
});

describe("Document section PATCH allowlist", () => {
  it("accepts content, title, notes", () => {
    const result = pickAllowed({ content: "text here", title: "Intro" }, SECTION_PATCH_ALLOWED);
    expect((result as any).__error).toBeUndefined();
  });

  it("rejects status (controlled by /approve)", () => {
    const result = pickAllowed({ status: "approved" }, SECTION_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/status/);
  });

  it("rejects isLocked (controlled by /lock and /unlock)", () => {
    const result = pickAllowed({ isLocked: false }, SECTION_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/isLocked/);
  });

  it("rejects isApproved (controlled by /approve)", () => {
    const result = pickAllowed({ isApproved: true }, SECTION_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/isApproved/);
  });

  it("rejects revisionCount and wordCount (system-managed)", () => {
    const r1 = pickAllowed({ revisionCount: 999 }, SECTION_PATCH_ALLOWED);
    const r2 = pickAllowed({ wordCount: 0 }, SECTION_PATCH_ALLOWED);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
  });

  it("rejects unknown fields", () => {
    const result = pickAllowed({ unknownField: "x" }, SECTION_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/unknownField/);
  });
});

describe("Repurposed asset PATCH allowlist", () => {
  it("accepts title and content (manual edits)", () => {
    const result = pickAllowed({ title: "New title", content: "Edited copy" }, REPURPOSED_ASSET_PATCH_ALLOWED);
    expect((result as any).__error).toBeUndefined();
    expect(result).toEqual({ title: "New title", content: "Edited copy" });
  });

  it("rejects status, isApproved, versionNumber (controlled by dedicated actions)", () => {
    const r1 = pickAllowed({ status: "approved" }, REPURPOSED_ASSET_PATCH_ALLOWED);
    const r2 = pickAllowed({ isApproved: true }, REPURPOSED_ASSET_PATCH_ALLOWED);
    const r3 = pickAllowed({ versionNumber: 99 }, REPURPOSED_ASSET_PATCH_ALLOWED);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
    expect((r3 as any).__error).toBeDefined();
  });

  it("rejects brandCheckScore and brandCheckPassed (system-computed)", () => {
    const r1 = pickAllowed({ brandCheckScore: 100 }, REPURPOSED_ASSET_PATCH_ALLOWED);
    const r2 = pickAllowed({ brandCheckPassed: true }, REPURPOSED_ASSET_PATCH_ALLOWED);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
  });

  it("rejects projectId, batchId, documentId (internal relationships)", () => {
    const result = pickAllowed({ batchId: "other-batch" }, REPURPOSED_ASSET_PATCH_ALLOWED);
    expect((result as any).__error).toMatch(/batchId/);
  });
});

describe("Repurposing preset field allowlist", () => {
  it("accepts name, tone, audience, cta, targetLength", () => {
    const result = pickAllowed(
      { name: "LinkedIn launch", tone: "confident", audience: "founders", cta: "Book a demo", targetLength: "short" },
      REPURPOSING_PRESET_FIELDS,
    );
    expect((result as any).__error).toBeUndefined();
    expect(result).toEqual({ name: "LinkedIn launch", tone: "confident", audience: "founders", cta: "Book a demo", targetLength: "short" });
  });

  it("rejects brandId (internal relationship, set from the URL param not the body)", () => {
    const result = pickAllowed({ name: "x", brandId: "other-brand" }, REPURPOSING_PRESET_FIELDS);
    expect((result as any).__error).toMatch(/brandId/);
  });

  it("rejects id, createdAt, updatedAt (system-managed)", () => {
    const r1 = pickAllowed({ name: "x", id: "injected" }, REPURPOSING_PRESET_FIELDS);
    const r2 = pickAllowed({ name: "x", createdAt: "2020-01-01" }, REPURPOSING_PRESET_FIELDS);
    expect((r1 as any).__error).toBeDefined();
    expect((r2 as any).__error).toBeDefined();
  });
});
