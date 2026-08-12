import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  brandsTable,
  audienceProfilesTable,
  brandFactsTable,
  projectsTable,
} from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getBrandOwned } from "../middleware/ownershipHelpers";
import { logActivity } from "../lib/activity";
import { emitEvent } from "../lib/webhooks/events";

const router: IRouter = Router();

// ── Allowed PATCH fields (explicit allowlist — no mass-assignment) ─────────────
const BRAND_PATCH_ALLOWED = new Set([
  "name", "description", "industry", "website", "voiceDescription",
  "tonePreferences", "readingLevel", "preferredVocabulary", "prohibitedVocabulary",
  "geographicFocus", "complianceNotes", "status",
]);

const AUDIENCE_PATCH_ALLOWED = new Set(["name", "demographics", "knowledgeLevel", "painPoints", "goals"]);
const FACT_PATCH_ALLOWED = new Set(["claim", "source", "status"]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  }
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

router.get("/brands", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brands = await db
    .select()
    .from(brandsTable)
    .where(eq(brandsTable.userId, userId))
    .orderBy(brandsTable.name);
  const projectCounts = await db
    .select({ brandId: projectsTable.brandId, count: count() })
    .from(projectsTable)
    .groupBy(projectsTable.brandId);
  const countMap = Object.fromEntries(projectCounts.map((r) => [r.brandId, Number(r.count)]));
  res.json(brands.map((b) => ({ ...b, projectCount: countMap[b.id] ?? 0 })));
});

router.post("/brands", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const body = req.body;
  if (!body.name || typeof body.name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [brand] = await db
    .insert(brandsTable)
    .values({ id: randomUUID(), userId, ...body })
    .returning();
  await logActivity("brand_created", `Brand "${brand.name}" created`, { userId, brandName: brand.name })
    .catch(() => {});
  await emitEvent({ type: "brand.created", userId, brandId: brand.id, data: { brandId: brand.id, name: brand.name } });
  res.status(201).json({ ...brand, projectCount: 0 });
});

router.get("/brands/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const [{ count: pc }] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.brandId, id));
  res.json({ ...brand, projectCount: Number(pc) });
});

router.patch("/brands/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;

  const update = pickAllowed(req.body, BRAND_PATCH_ALLOWED);
  if (update.__error) { res.status(400).json({ error: update.__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(brandsTable).set(update).where(eq(brandsTable.id, id)).returning();
  await logActivity("brand_updated", `Brand "${updated.name}" updated`, { userId: req.session.userId!, brandName: updated.name })
    .catch(() => {});
  res.json(updated);
});

router.delete("/brands/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  await db.delete(brandsTable).where(eq(brandsTable.id, id));
  res.sendStatus(204);
});

// ── Audience Profiles ──────────────────────────────────────────────────────────

router.get("/brands/:id/audience-profiles", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const profiles = await db.select().from(audienceProfilesTable).where(eq(audienceProfilesTable.brandId, id));
  res.json(profiles);
});

router.post("/brands/:id/audience-profiles", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  if (!req.body.name) { res.status(400).json({ error: "name is required" }); return; }
  const [profile] = await db.insert(audienceProfilesTable).values({ id: randomUUID(), brandId: id, ...req.body }).returning();
  res.status(201).json(profile);
});

router.patch("/audience-profiles/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [profile] = await db.select().from(audienceProfilesTable).where(eq(audienceProfilesTable.id, id)).limit(1);
  if (!profile) { res.status(404).json({ error: "Not found" }); return; }
  // Verify brand ownership
  const brand = await getBrandOwned(profile.brandId, req.session.userId!, res);
  if (!brand) return;

  const update = pickAllowed(req.body, AUDIENCE_PATCH_ALLOWED);
  if (update.__error) { res.status(400).json({ error: update.__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(audienceProfilesTable).set(update).where(eq(audienceProfilesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/audience-profiles/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [profile] = await db.select().from(audienceProfilesTable).where(eq(audienceProfilesTable.id, id)).limit(1);
  if (!profile) { res.sendStatus(204); return; }
  const brand = await getBrandOwned(profile.brandId, req.session.userId!, res);
  if (!brand) return;
  await db.delete(audienceProfilesTable).where(eq(audienceProfilesTable.id, id));
  res.sendStatus(204);
});

// ── Brand Facts ────────────────────────────────────────────────────────────────

router.get("/brands/:id/brand-facts", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const facts = await db.select().from(brandFactsTable).where(eq(brandFactsTable.brandId, id));
  res.json(facts);
});

router.post("/brands/:id/brand-facts", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  if (!req.body.claim) { res.status(400).json({ error: "claim is required" }); return; }
  const [fact] = await db.insert(brandFactsTable).values({ id: randomUUID(), brandId: id, ...req.body }).returning();
  res.status(201).json(fact);
});

router.patch("/brand-facts/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [fact] = await db.select().from(brandFactsTable).where(eq(brandFactsTable.id, id)).limit(1);
  if (!fact) { res.status(404).json({ error: "Not found" }); return; }
  const brand = await getBrandOwned(fact.brandId, req.session.userId!, res);
  if (!brand) return;

  const update = pickAllowed(req.body, FACT_PATCH_ALLOWED);
  if (update.__error) { res.status(400).json({ error: update.__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(brandFactsTable).set(update).where(eq(brandFactsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/brand-facts/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [fact] = await db.select().from(brandFactsTable).where(eq(brandFactsTable.id, id)).limit(1);
  if (!fact) { res.sendStatus(204); return; }
  const brand = await getBrandOwned(fact.brandId, req.session.userId!, res);
  if (!brand) return;
  await db.delete(brandFactsTable).where(eq(brandFactsTable.id, id));
  res.sendStatus(204);
});

export default router;
