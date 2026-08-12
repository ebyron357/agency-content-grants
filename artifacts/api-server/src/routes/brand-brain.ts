/**
 * Brand Brain routes — structured brand knowledge entries + content validation.
 * All routes require authentication (mounted after requireAuth) and enforce
 * brand ownership via getBrandOwned.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { brandKnowledgeEntriesTable, brandFactsTable, brandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getBrandOwned } from "../middleware/ownershipHelpers";
import { logActivity } from "../lib/activity";
import {
  BRAND_BRAIN_CATEGORIES,
  isValidCategory,
  validateDeterministic,
  overallScore,
} from "../lib/brand-brain";
import { generateForStage } from "../lib/ai/router";

const router: IRouter = Router();

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

/** Verify the entry exists and its brand belongs to the caller. */
async function getEntryOwned(entryId: string, userId: string, res: any) {
  const [entry] = await db
    .select()
    .from(brandKnowledgeEntriesTable)
    .where(eq(brandKnowledgeEntriesTable.id, entryId))
    .limit(1);
  if (!entry) { res.status(404).json({ error: "Not found" }); return null; }
  const brand = await getBrandOwned(entry.brandId, userId, res);
  if (!brand) return null; // 404 already sent
  return entry;
}

/**
 * GET /api/brands/:id/brain — all knowledge entries + category metadata.
 */
router.get("/brands/:id/brain", async (req, res): Promise<void> => {
  const brand = await getBrandOwned(paramId(req.params.id), req.session.userId!, res);
  if (!brand) return;
  const entries = await db
    .select()
    .from(brandKnowledgeEntriesTable)
    .where(eq(brandKnowledgeEntriesTable.brandId, brand.id))
    .orderBy(brandKnowledgeEntriesTable.category, brandKnowledgeEntriesTable.label);
  res.json({ categories: BRAND_BRAIN_CATEGORIES, entries });
});

/**
 * POST /api/brands/:id/brain/entries — create a knowledge entry.
 * When sourceUrl is given, provenance defaults to "imported" and importedAt is stamped.
 */
router.post("/brands/:id/brain/entries", async (req, res): Promise<void> => {
  const brand = await getBrandOwned(paramId(req.params.id), req.session.userId!, res);
  if (!brand) return;
  const { category, label, content, structured, sourceUrl, provenance } = req.body ?? {};
  if (typeof category !== "string" || !isValidCategory(category)) {
    res.status(400).json({ error: `category must be one of: ${Object.keys(BRAND_BRAIN_CATEGORIES).join(", ")}` });
    return;
  }
  if (typeof label !== "string" || !label.trim() || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "label and content are required" });
    return;
  }
  const imported = typeof sourceUrl === "string" && sourceUrl.trim().length > 0;
  const [entry] = await db
    .insert(brandKnowledgeEntriesTable)
    .values({
      id: randomUUID(),
      brandId: brand.id,
      category,
      label: label.trim(),
      content: content.trim(),
      structured: structured ?? null,
      provenance: imported ? "imported" : (typeof provenance === "string" && provenance.trim() ? provenance.trim() : "manual"),
      sourceUrl: imported ? sourceUrl.trim() : null,
      importedAt: imported ? new Date() : null,
    })
    .returning();
  logActivity("brand_brain_entry_added", `Brand knowledge added to "${brand.name}": ${entry.label}`, { userId: req.session.userId, brandName: brand.name })
    .catch((e) => req.log?.warn({ err: e }, "activity log failed"));
  res.status(201).json(entry);
});

const ENTRY_PATCH_ALLOWED = new Set(["category", "label", "content", "structured", "enabled", "provenance", "sourceUrl"]);

/**
 * PATCH /api/brain-entries/:id — update an entry (including enable/disable).
 */
router.patch("/brain-entries/:id", async (req, res): Promise<void> => {
  const entry = await getEntryOwned(paramId(req.params.id), req.session.userId!, res);
  if (!entry) return;
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(req.body ?? {})) {
    if (ENTRY_PATCH_ALLOWED.has(key)) updates[key] = req.body[key];
  }
  if (updates.category !== undefined && (typeof updates.category !== "string" || !isValidCategory(updates.category))) {
    res.status(400).json({ error: "invalid category" });
    return;
  }
  if (updates.label !== undefined && (typeof updates.label !== "string" || !updates.label.trim())) {
    res.status(400).json({ error: "label cannot be empty" });
    return;
  }
  if (updates.content !== undefined && (typeof updates.content !== "string" || !updates.content.trim())) {
    res.status(400).json({ error: "content cannot be empty" });
    return;
  }
  if (updates.enabled !== undefined && typeof updates.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "no updatable fields provided" });
    return;
  }
  const [updated] = await db
    .update(brandKnowledgeEntriesTable)
    .set(updates)
    .where(eq(brandKnowledgeEntriesTable.id, entry.id))
    .returning();
  res.json(updated);
});

/**
 * DELETE /api/brain-entries/:id — remove an entry.
 */
router.delete("/brain-entries/:id", async (req, res): Promise<void> => {
  const entry = await getEntryOwned(paramId(req.params.id), req.session.userId!, res);
  if (!entry) return;
  await db.delete(brandKnowledgeEntriesTable).where(eq(brandKnowledgeEntriesTable.id, entry.id));
  res.json({ ok: true });
});

/**
 * POST /api/brands/:id/validate-content
 * Score content against the Brand Brain: deterministic checks always run;
 * an AI voice/terminology assessment is included unless useAi === false
 * (gracefully omitted when no provider is configured).
 * Body: { content: string, useAi?: boolean }
 */
router.post("/brands/:id/validate-content", async (req, res): Promise<void> => {
  const brand = await getBrandOwned(paramId(req.params.id), req.session.userId!, res);
  if (!brand) return;
  const { content, useAi } = req.body ?? {};
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [entries, facts] = await Promise.all([
    db.select().from(brandKnowledgeEntriesTable).where(eq(brandKnowledgeEntriesTable.brandId, brand.id)),
    db.select().from(brandFactsTable).where(eq(brandFactsTable.brandId, brand.id)),
  ]);

  const checks = validateDeterministic(brand, facts, entries, content);

  let aiVoice: { voiceScore: number; notes: string } | null = null;
  if (useAi !== false) {
    try {
      const result = await generateForStage("evaluation", [
        { role: "system", content: "You are a brand voice evaluator. Respond with JSON only." },
        {
          role: "user",
          content: `Brand: ${brand.name}
Voice: ${brand.voiceDescription ?? "Professional, clear"}
Tone preferences: ${brand.tonePreferences ?? "None specified"}
Reading level: ${brand.readingLevel ?? "General"}

Score how well the content matches this brand voice and reading level.
Return JSON: { "voiceScore": 0-100, "notes": "one or two sentences" }

Content:
${content.slice(0, 3000)}`,
        },
      ]);
      const m = result.content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : result.content);
      if (typeof parsed.voiceScore === "number") {
        aiVoice = { voiceScore: Math.max(0, Math.min(100, Math.round(parsed.voiceScore))), notes: String(parsed.notes ?? "") };
      }
    } catch (e) {
      req.log?.warn({ err: e }, "AI voice scoring unavailable; returning deterministic checks only");
    }
  }

  const [fullBrand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brand.id)).limit(1);
  res.json({
    brandId: brand.id,
    checks,
    aiVoice,
    overallScore: overallScore(checks, aiVoice?.voiceScore),
    evaluatedFields: {
      voice: !!aiVoice,
      terminology: true,
      bannedPhrases: true,
      requiredClaims: true,
      compliance: !!(fullBrand?.complianceNotes || entries.some((e) => e.category === "compliance" && e.enabled)),
    },
  });
});

export default router;
