import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, grantSourceDraftsTable, grantSourcesTable, workspacesTable, type GrantSource } from "@workspace/db";
import { requireAdmin } from "../middleware/requireAdmin";
import { logActivity } from "../lib/activity";
import { enqueue } from "../lib/jobs/registry";
import { sourceCheckJob, sourceCheckKey } from "../lib/jobs/definitions";
import { currentWorker, runJobNow } from "../lib/jobs/worker";
import { CONNECTOR_TYPES, FEED_CONNECTORS, JURISDICTION_KINDS, LIMITS, SOURCE_STATUSES, STATE_CODES, defaultStaleDays, isPageSource, validateSource } from "../lib/grants/sources/registry";
import { validateDraftEdit } from "../lib/grants/sources/promote";
import { approveDraft, currentSettings, draftView, recentChecks, rejectDraft, sourceView } from "../lib/grants/sources/service";

/**
 * The grant source registry and its review queue (docs/SOURCE_REGISTRY.md).
 *
 * Sources and drafts are shared reference data, like opportunities, so the
 * whole screen, reads included, is for owners and admins (`workspace.configure`,
 * in lib/permissions.ts) of the agency workspace, with admin access unlocked
 * (the jobs screen's rule). Mounted behind requireAuth and requirePermission.
 */
const router: IRouter = Router();

function fail(res: Response, status: number, error: string, errors?: string[]): void {
  res.status(status).json(errors ? { error, errors } : { error });
}

const actor = (req: Request) => req.session.actorName ?? "operator";
const param = (req: Request, name: string) => String(req.params[name]);

/**
 * Sources decide what every workspace sees, so they are managed only from the
 * agency (operator) workspace: a client workspace's owner gets 403 even with
 * admin access unlocked. `session.userId` is the workspace principal for both
 * the team password and member sign-ins.
 */
async function requireAgencyWorkspace(req: Request, res: Response, next: () => void): Promise<void> {
  const [ws] = await db.select({ kind: workspacesTable.kind }).from(workspacesTable).where(eq(workspacesTable.principalUserId, req.session.userId!)).limit(1);
  if (ws?.kind !== "agency") return fail(res, 403, "Grant sources are managed from the agency workspace.");
  next();
}

/** Reads need the same role as writes: this screen configures what every workspace sees. */
router.use(["/grant-sources", "/grant-source-drafts"], requireAdmin, (req, res, next) => {
  requireAgencyWorkspace(req, res, next).catch(next);
});

router.get("/grant-sources", async (_req, res): Promise<void> => {
  const rows = await db.select().from(grantSourcesTable).orderBy(asc(grantSourcesTable.jurisdictionKind), asc(grantSourcesTable.name));
  const pending = await db.select({ sourceId: grantSourceDraftsTable.sourceId }).from(grantSourceDraftsTable).where(eq(grantSourceDraftsTable.status, "pending"));
  const pendingBySource = new Map<string, number>();
  for (const p of pending) pendingBySource.set(p.sourceId, (pendingBySource.get(p.sourceId) ?? 0) + 1);
  const settings = currentSettings();
  const now = new Date();
  const sources = rows.map((s) => ({ ...sourceView(s, now), pendingDrafts: pendingBySource.get(s.id) ?? 0 }));
  res.json({
    sources,
    counts: {
      total: sources.length,
      running: sources.filter((s) => s.running).length,
      stale: sources.filter((s) => s.freshness.state === "stale").length,
      pendingDrafts: pending.length,
    },
    watcher: { backend: settings.backend, mode: settings.mode, problem: settings.problem, staleAfterDays: defaultStaleDays() },
    options: { jurisdictionKinds: JURISDICTION_KINDS, connectorTypes: CONNECTOR_TYPES, statuses: SOURCE_STATUSES, feedConnectors: FEED_CONNECTORS, stateCodes: STATE_CODES, limits: LIMITS },
  });
});

router.get("/grant-sources/:id", async (req, res): Promise<void> => {
  const [s] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, param(req, "id"))).limit(1);
  if (!s) return fail(res, 404, "Source not found");
  res.json({ ...sourceView(s), checks: await recentChecks(s.id) });
});

function fromBody(body: Record<string, unknown>, base?: GrantSource): Record<string, unknown> {
  const fields = ["key", "name", "jurisdictionKind", "jurisdictionCode", "connectorType", "connector", "urls", "scheduleHours", "owner", "status", "termsNote", "termsChecked", "termsPermitAutomation", "staleAfterDays"] as const;
  const merged: Record<string, unknown> = {};
  for (const f of fields) merged[f] = body[f] !== undefined ? body[f] : base ? (base as Record<string, unknown>)[f] : undefined;
  return merged;
}

router.post("/grant-sources", async (req, res): Promise<void> => {
  const v = validateSource(fromBody(req.body ?? {}));
  if (!v.ok) return fail(res, 400, "The source has problems.", v.errors);
  if (v.value.connectorType === "feed") return fail(res, 400, "Feeds are added with their connector in code. Add a page source here instead.");
  const [dupe] = await db.select({ id: grantSourcesTable.id }).from(grantSourcesTable).where(eq(grantSourcesTable.key, v.value.key)).limit(1);
  if (dupe) return fail(res, 409, `Another source already uses the key "${v.value.key}".`);
  const now = new Date();
  const [row] = await db
    .insert(grantSourcesTable)
    .values({ id: randomUUID(), ...v.value, termsCheckedAt: v.value.termsChecked ? now : null, termsCheckedBy: v.value.termsChecked ? actor(req) : null, updatedBy: actor(req) })
    .returning();
  await logActivity("grant_source_created", `Grant source "${row.name}" added (${row.status})`, { userId: req.session.userId }).catch(() => {});
  res.status(201).json(sourceView(row));
});

router.patch("/grant-sources/:id", async (req, res): Promise<void> => {
  const [base] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, param(req, "id"))).limit(1);
  if (!base) return fail(res, 404, "Source not found");
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (base.connectorType === "feed") {
    // A feed's connector, key and URLs are in code; only its record-keeping fields change here.
    const locked = ["key", "connectorType", "connector", "urls", "jurisdictionKind", "jurisdictionCode"].filter((k) => body[k] !== undefined && JSON.stringify(body[k]) !== JSON.stringify((base as Record<string, unknown>)[k]));
    if (locked.length) return fail(res, 400, `A feed's ${locked.join(", ")} come from its connector in code and cannot be changed here.`);
  } else if (body.connectorType === "feed") return fail(res, 400, "A page source cannot become a feed.");
  const v = validateSource(fromBody(body, base));
  if (!v.ok) return fail(res, 400, "The source has problems.", v.errors);
  if (v.value.key !== base.key) {
    const [dupe] = await db.select({ id: grantSourcesTable.id }).from(grantSourcesTable).where(eq(grantSourcesTable.key, v.value.key)).limit(1);
    if (dupe) return fail(res, 409, `Another source already uses the key "${v.value.key}".`);
  }
  const termsChanged = v.value.termsChecked !== base.termsChecked || v.value.termsPermitAutomation !== base.termsPermitAutomation || v.value.termsNote !== base.termsNote;
  const urlChanged = JSON.stringify(v.value.urls) !== JSON.stringify(base.urls);
  const [row] = await db
    .update(grantSourcesTable)
    .set({
      ...v.value,
      ...(termsChanged ? { termsCheckedAt: v.value.termsChecked ? new Date() : null, termsCheckedBy: v.value.termsChecked ? actor(req) : null } : {}),
      // A new URL is a new page: its first check is a baseline, not a change of the old page.
      ...(urlChanged ? { lastContentHash: null } : {}),
      updatedBy: actor(req),
    })
    .where(eq(grantSourcesTable.id, base.id))
    .returning();
  await logActivity("grant_source_updated", `Grant source "${row.name}" updated (${row.status})`, { userId: req.session.userId }).catch(() => {});
  res.json(sourceView(row));
});

router.delete("/grant-sources/:id", async (req, res): Promise<void> => {
  const [s] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, param(req, "id"))).limit(1);
  if (!s) return fail(res, 404, "Source not found");
  if (s.connectorType === "feed") return fail(res, 409, "A feed with a connector in code cannot be deleted; set it to disabled to record that it should not run.");
  const [approved] = await db.select({ id: grantSourceDraftsTable.id }).from(grantSourceDraftsTable).where(and(eq(grantSourceDraftsTable.sourceId, s.id), eq(grantSourceDraftsTable.status, "approved"))).limit(1);
  if (approved) return fail(res, 409, "Opportunities were approved from this source. Disable it instead, so their record is kept.");
  if (s.watchId) {
    const settings = currentSettings();
    if (settings.changeDetection) {
      const { ChangeDetectionClient } = await import("../lib/grants/sources/changedetection");
      await new ChangeDetectionClient(settings.changeDetection).deleteWatch(s.watchId).catch((err) => console.warn("[sources] watch not deleted", (err as Error).message));
    }
  }
  await db.delete(grantSourcesTable).where(eq(grantSourcesTable.id, s.id));
  await logActivity("grant_source_deleted", `Grant source "${s.name}" deleted`, { userId: req.session.userId }).catch(() => {});
  res.status(204).end();
});

/** POST /grant-sources/:id/check: check one page source now, as a background job (waits up to 3 s). */
router.post("/grant-sources/:id/check", async (req, res): Promise<void> => {
  const [s] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, param(req, "id"))).limit(1);
  if (!s) return fail(res, 404, "Source not found");
  if (!isPageSource(s)) return fail(res, 409, "Feeds run in the daily grant sync (Grant Studio, Refresh now).");
  if (s.status !== "active" || !s.termsChecked || !s.termsPermitAutomation) return fail(res, 409, "Only an active source whose terms were checked and permit automated reading is checked.");
  const { job } = await enqueue(sourceCheckJob, { sourceId: s.id }, { dedupeKey: sourceCheckKey(s.id), requestedBy: actor(req) });
  const finished = await runJobNow(job.id);
  // Without a worker in this process, run the extraction it queued here too.
  const extractJobId = (finished?.result as { extractJobId?: string } | null)?.extractJobId;
  if (extractJobId && !currentWorker()) await runJobNow(extractJobId);
  res.status(finished?.status === "succeeded" ? 200 : 202).json({ jobId: job.id, status: finished?.status ?? job.status, result: finished?.result ?? null, extractJobId: extractJobId ?? null });
});

// ── Review queue ────────────────────────────────────────────────────────────

const DRAFT_STATUSES = ["pending", "approved", "rejected"] as const;

router.get("/grant-source-drafts", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" && (DRAFT_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : "pending";
  const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : null;
  const where = sourceId ? and(eq(grantSourceDraftsTable.status, status), eq(grantSourceDraftsTable.sourceId, sourceId)) : eq(grantSourceDraftsTable.status, status);
  const rows = await db.select().from(grantSourceDraftsTable).where(where).orderBy(desc(grantSourceDraftsTable.createdAt)).limit(200);
  const ids = [...new Set(rows.map((r) => r.sourceId))];
  const sources = ids.length ? await db.select().from(grantSourcesTable).where(inArray(grantSourcesTable.id, ids)) : [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  res.json({ status, drafts: rows.map((d) => draftView(d, byId.get(d.sourceId))) });
});

async function draftWithSource(id: string) {
  const [d] = await db.select().from(grantSourceDraftsTable).where(eq(grantSourceDraftsTable.id, id)).limit(1);
  if (!d) return null;
  const [s] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, d.sourceId)).limit(1);
  return { d, s };
}

router.patch("/grant-source-drafts/:id", async (req, res): Promise<void> => {
  const found = await draftWithSource(param(req, "id"));
  if (!found) return fail(res, 404, "Draft not found");
  if (found.d.status !== "pending") return fail(res, 409, `This draft was already ${found.d.status}.`);
  if (found.d.demo) return fail(res, 409, "Demo output cannot be edited into a listing. Configure an AI provider and check the page again.");
  const v = validateDraftEdit(req.body ?? {});
  if (!v.ok) return fail(res, 400, "The draft has problems.", v.errors);
  const [row] = await db.update(grantSourceDraftsTable).set(v.value).where(eq(grantSourceDraftsTable.id, found.d.id)).returning();
  res.json(draftView(row, found.s));
});

router.post("/grant-source-drafts/:id/approve", async (req, res): Promise<void> => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
  if (req.body?.confirmChecked !== true) return fail(res, 400, "Confirm that you checked this listing against the source page before approving it.");
  const result = await approveDraft(param(req, "id"), actor(req), note);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.problems ? { errors: result.problems } : {}) });
    return;
  }
  await logActivity("grant_source_draft_approved", `Draft listing approved into opportunity ${result.opportunityId}`, { userId: req.session.userId }).catch(() => {});
  res.json(result);
});

router.post("/grant-source-drafts/:id/reject", async (req, res): Promise<void> => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
  const result = await rejectDraft(param(req, "id"), actor(req), note);
  if (!result.ok) return fail(res, result.status, result.error!);
  await logActivity("grant_source_draft_rejected", "Draft listing rejected", { userId: req.session.userId }).catch(() => {});
  res.json({ ok: true });
});

export default router;
