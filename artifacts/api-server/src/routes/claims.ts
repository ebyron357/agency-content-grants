import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claimsTable, sourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { verifyClaim } from "../lib/workflows/content-workflow";
import { getProjectOwned, getClaimOwned } from "../middleware/ownershipHelpers";

const router: IRouter = Router();

const CLAIM_PATCH_ALLOWED = new Set([
  "claimText", "claimType", "sourceId", "quotedText", "pageNumber", "notes",
  // verificationStatus intentionally excluded — use /verify
]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

router.get("/projects/:id/claims", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const claims = await db.select().from(claimsTable).where(eq(claimsTable.projectId, id));
  const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.projectId, id));
  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.title]));
  res.json(claims.map((c) => ({ ...c, sourceTitle: c.sourceId ? sourceMap[c.sourceId] ?? null : null })));
});

router.post("/projects/:id/claims", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  if (!req.body.claimText || !req.body.claimType) {
    res.status(400).json({ error: "claimText and claimType are required" });
    return;
  }
  const [claim] = await db.insert(claimsTable).values({
    id: randomUUID(),
    projectId: id,
    ...req.body,
  }).returning();
  const sourceTitle = claim.sourceId
    ? (await db.select().from(sourcesTable).where(eq(sourcesTable.id, claim.sourceId)).limit(1))[0]?.title ?? null
    : null;
  res.status(201).json({ ...claim, sourceTitle });
});

router.patch("/claims/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claim = await getClaimOwned(id, req.session.userId!, res);
  if (!claim) return;

  const update = pickAllowed(req.body, CLAIM_PATCH_ALLOWED);
  if ((update as any).__error) { res.status(400).json({ error: (update as any).__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(claimsTable).set(update).where(eq(claimsTable.id, id)).returning();
  const sourceTitle = updated.sourceId
    ? (await db.select().from(sourcesTable).where(eq(sourcesTable.id, updated.sourceId)).limit(1))[0]?.title ?? null
    : null;
  res.json({ ...updated, sourceTitle });
});

router.delete("/claims/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claim = await getClaimOwned(id, req.session.userId!, res);
  if (!claim) return;
  await db.delete(claimsTable).where(eq(claimsTable.id, id));
  res.sendStatus(204);
});

router.post("/claims/:id/verify", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claim = await getClaimOwned(id, req.session.userId!, res);
  if (!claim) return;
  try {
    const updated = await verifyClaim(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
