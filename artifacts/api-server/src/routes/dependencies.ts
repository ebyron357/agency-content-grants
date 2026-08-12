import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dependencyRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middleware/requireAdmin";

const router: IRouter = Router();

// The dependency registry is global app metadata shared by all users:
// reads stay available to any authenticated user, mutations are admin-only.

router.get("/dependencies", async (req, res): Promise<void> => {
  const deps = await db.select().from(dependencyRegistryTable).orderBy(dependencyRegistryTable.componentName);
  const category = req.query.category as string | undefined;
  const status = req.query.status as string | undefined;
  let result = deps;
  if (category) result = result.filter((d) => d.category === category);
  if (status) result = result.filter((d) => d.installStatus === status);
  res.json(result);
});

router.patch("/dependencies/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [dep] = await db.update(dependencyRegistryTable).set(req.body).where(eq(dependencyRegistryTable.id, id)).returning();
  if (!dep) { res.status(404).json({ error: "Not found" }); return; }
  res.json(dep);
});

export default router;
