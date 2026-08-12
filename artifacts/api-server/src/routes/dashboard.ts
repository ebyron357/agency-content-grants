import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  brandsTable,
  projectsTable,
  documentsTable,
  sourcesTable,
  exportsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, desc, and, inArray, or } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const brands = await db.select().from(brandsTable).where(eq(brandsTable.userId, userId));
  const projects = await db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  const projectIds = projects.map((p) => p.id);

  const documents = projectIds.length
    ? await db.select().from(documentsTable).where(inArray(documentsTable.projectId, projectIds))
    : [];
  const sources = projectIds.length
    ? await db.select().from(sourcesTable).where(inArray(sourcesTable.projectId, projectIds))
    : [];
  const exports = projectIds.length
    ? await db.select().from(exportsTable).where(inArray(exportsTable.projectId, projectIds))
    : [];

  const projectsByStatus: Record<string, number> = {};
  for (const p of projects) {
    projectsByStatus[p.status] = (projectsByStatus[p.status] ?? 0) + 1;
  }

  res.json({
    totalBrands: brands.length,
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === "active").length,
    completedProjects: projects.filter((p) => p.status === "completed").length,
    totalDocuments: documents.length,
    totalSources: sources.length,
    totalExports: exports.filter((e) => e.status === "completed").length,
    projectsByStatus,
  });
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const userProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId));
  const projectIds = userProjects.map((p) => p.id);

  // Scope by actor (userId) OR by the user's projects. userId covers
  // non-project events (login, brand changes); projectId covers legacy rows
  // written before the userId column existed.
  const scope = projectIds.length
    ? or(eq(activityLogTable.userId, userId), inArray(activityLogTable.projectId, projectIds))
    : eq(activityLogTable.userId, userId);

  const items = await db
    .select()
    .from(activityLogTable)
    .where(scope)
    .orderBy(desc(activityLogTable.createdAt))
    .limit(20);

  res.json(items.map((item) => ({
    id: item.id,
    type: item.type,
    description: item.description,
    projectId: item.projectId,
    projectTitle: item.projectTitle,
    brandName: item.brandName,
    createdAt: item.createdAt,
  })));
});

export default router;
