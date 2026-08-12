import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { contentBlueprintsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middleware/requireAdmin";

const router: IRouter = Router();

// Blueprints are seeded global content templates shared by all users:
// reads stay available to any authenticated user, mutations are admin-only.

router.get("/blueprints", async (_req, res): Promise<void> => {
  const blueprints = await db.select().from(contentBlueprintsTable).orderBy(contentBlueprintsTable.name);
  res.json(blueprints);
});

router.post("/blueprints", requireAdmin, async (req, res): Promise<void> => {
  if (!req.body.name || !req.body.contentType) {
    res.status(400).json({ error: "name and contentType are required" });
    return;
  }
  const [blueprint] = await db.insert(contentBlueprintsTable).values({ id: randomUUID(), ...req.body }).returning();
  res.status(201).json(blueprint);
});

router.get("/blueprints/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [blueprint] = await db.select().from(contentBlueprintsTable).where(eq(contentBlueprintsTable.id, id)).limit(1);
  if (!blueprint) { res.status(404).json({ error: "Not found" }); return; }
  res.json(blueprint);
});

router.patch("/blueprints/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [blueprint] = await db.update(contentBlueprintsTable).set(req.body).where(eq(contentBlueprintsTable.id, id)).returning();
  if (!blueprint) { res.status(404).json({ error: "Not found" }); return; }
  res.json(blueprint);
});

export default router;
