import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, grantTemplatesTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { APPLICANT_KINDS, JURISDICTIONS, LIMITS, LIMIT_TYPES, REQUIREMENT_KINDS, builtInTemplates, customId, fromRow, toInput, validateTemplate, type RegistryTemplate } from "../lib/grants/templateRegistry";

/**
 * Application templates (docs/GRANT_STUDIO.md): the built-in ones, read only,
 * and the workspace's own, which people with grants.write create, edit,
 * duplicate and archive. Mounted behind requireAuth and requirePermission.
 */
const router: IRouter = Router();

function fail(res: Response, status: number, error: string, errors?: string[]): void {
  res.status(status).json(errors ? { error, errors } : { error });
}

/** Every template the workspace can use, built-in first, then its own by name. */
export async function workspaceTemplates(userId: string): Promise<RegistryTemplate[]> {
  const rows = await db.select().from(grantTemplatesTable).where(eq(grantTemplatesTable.userId, userId)).orderBy(asc(grantTemplatesTable.label));
  return [...builtInTemplates(), ...rows.map(fromRow)];
}

/** One template by key, for this workspace only. */
export async function findTemplate(userId: string, key: string): Promise<RegistryTemplate | null> {
  const id = customId(key);
  if (!id) return builtInTemplates().find((t) => t.key === key) ?? null;
  const [row] = await db.select().from(grantTemplatesTable).where(and(eq(grantTemplatesTable.id, id), eq(grantTemplatesTable.userId, userId))).limit(1);
  return row ? fromRow(row) : null;
}

const summary = (t: RegistryTemplate) => ({
  key: t.key,
  label: t.label,
  description: t.description,
  builtIn: t.builtIn,
  basedOn: t.basedOn,
  appliesTo: t.appliesTo,
  status: t.status,
  version: t.version,
  updatedAt: t.updatedAt,
  sectionCount: t.sections.length,
  requirementCount: t.requirements.length,
});

router.get("/grants/templates", async (req, res): Promise<void> => {
  const all = await workspaceTemplates(req.session.userId!);
  res.json({
    templates: all.map(summary),
    options: { applicantKinds: APPLICANT_KINDS, jurisdictions: JURISDICTIONS, limitTypes: LIMIT_TYPES, requirementKinds: REQUIREMENT_KINDS, limits: LIMITS },
  });
});

router.get("/grants/templates/:key", async (req, res): Promise<void> => {
  const t = await findTemplate(req.session.userId!, String(req.params.key));
  if (!t) return fail(res, 404, "Template not found");
  res.json({ ...summary(t), sections: t.sections, requirements: t.requirements });
});

async function saveNew(req: Request, res: Response, input: unknown, basedOn: string | null): Promise<void> {
  const checked = validateTemplate(input);
  if (!checked.ok) return fail(res, 400, "The template has problems to fix.", checked.errors);
  const v = checked.value;
  const [row] = await db
    .insert(grantTemplatesTable)
    .values({ id: randomUUID(), userId: req.session.userId!, label: v.label, description: v.description, basedOn, appliesTo: v.appliesTo, sections: v.sections, requirements: v.requirements, updatedBy: req.session.actorName ?? "operator" })
    .returning();
  await logActivity("grant_template_created", `Template "${v.label}" created${basedOn ? ` from ${basedOn}` : ""}`, { userId: req.session.userId }).catch(() => {});
  const t = fromRow(row);
  res.status(201).json({ ...summary(t), sections: t.sections, requirements: t.requirements });
}

/** POST /grants/templates { label, description?, appliesTo, sections, requirements }: a new workspace template. */
router.post("/grants/templates", async (req, res): Promise<void> => {
  await saveNew(req, res, req.body, null);
});

/** POST /grants/templates/:key/duplicate { label? }: copies a built-in or workspace template, to customize. */
router.post("/grants/templates/:key/duplicate", async (req, res): Promise<void> => {
  const source = await findTemplate(req.session.userId!, String(req.params.key));
  if (!source) return fail(res, 404, "Template not found");
  const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label : `${source.label} (copy)`.slice(0, LIMITS.label);
  await saveNew(req, res, toInput(source, label), source.builtIn ? source.key : source.basedOn);
});

/** PUT /grants/templates/:key: replaces a workspace template's content. Built-in templates cannot be changed. */
router.put("/grants/templates/:key", async (req, res): Promise<void> => {
  const id = customId(String(req.params.key));
  if (!id) return fail(res, 409, "Built-in templates cannot be changed. Duplicate it to customize.");
  const existing = await findTemplate(req.session.userId!, String(req.params.key));
  if (!existing) return fail(res, 404, "Template not found");
  if (typeof req.body?.version === "number" && req.body.version !== existing.version) {
    return fail(res, 409, "Someone saved this template since you opened it. Reload to see their changes.");
  }
  const checked = validateTemplate(req.body);
  if (!checked.ok) return fail(res, 400, "The template has problems to fix.", checked.errors);
  const v = checked.value;
  const [row] = await db
    .update(grantTemplatesTable)
    .set({ label: v.label, description: v.description, appliesTo: v.appliesTo, sections: v.sections, requirements: v.requirements, version: existing.version + 1, updatedBy: req.session.actorName ?? "operator" })
    .where(and(eq(grantTemplatesTable.id, id), eq(grantTemplatesTable.userId, req.session.userId!), eq(grantTemplatesTable.version, existing.version)))
    .returning();
  if (!row) return fail(res, 409, "Someone saved this template since you opened it. Reload to see their changes.");
  await logActivity("grant_template_updated", `Template "${v.label}" updated to version ${row.version}`, { userId: req.session.userId }).catch(() => {});
  const t = fromRow(row);
  res.json({ ...summary(t), sections: t.sections, requirements: t.requirements });
});

/** POST /grants/templates/:key/archive and /restore: archived templates are not offered for new applications. */
for (const action of ["archive", "restore"] as const) {
  router.post(`/grants/templates/:key/${action}`, async (req, res): Promise<void> => {
    const id = customId(String(req.params.key));
    if (!id) return fail(res, 409, "Built-in templates cannot be archived.");
    const [row] = await db
      .update(grantTemplatesTable)
      .set({ status: action === "archive" ? "archived" : "active", updatedBy: req.session.actorName ?? "operator" })
      .where(and(eq(grantTemplatesTable.id, id), eq(grantTemplatesTable.userId, req.session.userId!)))
      .returning();
    if (!row) return fail(res, 404, "Template not found");
    await logActivity(`grant_template_${action}d`, `Template "${row.label}" ${action}d`, { userId: req.session.userId }).catch(() => {});
    res.json(summary(fromRow(row)));
  });
}

export default router;
