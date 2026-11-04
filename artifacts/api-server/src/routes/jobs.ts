import { Router, type IRouter } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, jobsTable, type Job } from "@workspace/db";
import { requireAdmin } from "../middleware/requireAdmin";
import { logActivity } from "../lib/activity";
import { cancelJob, jobCounts, retryJob } from "../lib/jobs/queue";
import { jobDefinition, jobKinds } from "../lib/jobs/registry";
import { SCHEDULES, slotOf } from "../lib/jobs/schedules";
import { currentWorker, workerEnabled } from "../lib/jobs/worker";

/**
 * Background jobs (docs/BACKGROUND_JOBS.md). The list, retry and cancel are
 * for an admin-unlocked operator. One job's status is readable by the
 * workspace it acts for, and system jobs (no workspace) by anyone signed in.
 * Mounted behind requireAuth.
 */
const router: IRouter = Router();

const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

function view(job: Job) {
  const def = jobDefinition(job.kind);
  return {
    id: job.id,
    kind: job.kind,
    label: def?.label ?? job.kind,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    progress: job.progress,
    result: job.result,
    lastError: job.lastError,
    requestedBy: job.requestedBy,
    system: job.userId === null,
  };
}

/** GET /jobs?status&kind: recent jobs, counts, the worker and the schedules. */
router.get("/jobs", requireAdmin, async (req, res): Promise<void> => {
  const conditions: SQL[] = [];
  const status = typeof req.query.status === "string" && (STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : null;
  if (status) conditions.push(eq(jobsTable.status, status));
  const kind = typeof req.query.kind === "string" && jobDefinition(req.query.kind) ? req.query.kind : null;
  if (kind) conditions.push(eq(jobsTable.kind, kind));
  const rows = await db.select().from(jobsTable).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(jobsTable.createdAt)).limit(100);
  res.json({
    counts: await jobCounts(),
    worker: workerEnabled() ? currentWorker()?.status() ?? null : null,
    workerEnabled: workerEnabled(),
    kinds: jobKinds().map((d) => ({ kind: d.kind, label: d.label, maxAttempts: d.maxAttempts, timeoutMs: d.timeoutMs, concurrency: d.concurrency })),
    schedules: SCHEDULES.map((s) => ({ name: s.name, kind: s.job.kind, label: s.job.label, everyHours: s.everyMs / 3_600_000, enabled: s.enabled(), currentSlot: slotOf(s) })),
    jobs: rows.map(view),
  });
});

/** GET /jobs/:id: one job's status, for its workspace or, for system jobs, anyone signed in. */
router.get("/jobs/:id", async (req, res): Promise<void> => {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, String(req.params.id))).limit(1);
  if (!job || (job.userId !== null && job.userId !== req.session.userId && req.session.isAdmin !== true)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(view(job));
});

router.post("/jobs/:id/retry", requireAdmin, async (req, res): Promise<void> => {
  const job = await retryJob(String(req.params.id));
  if (!job) {
    res.status(409).json({ error: "Only a failed or cancelled job can be retried, and not while another run of it is queued or running." });
    return;
  }
  currentWorker()?.nudge();
  await logActivity("job_retried", `${jobDefinition(job.kind)?.label ?? job.kind} retried`, { userId: req.session.userId }).catch(() => {});
  res.json(view(job));
});

router.post("/jobs/:id/cancel", requireAdmin, async (req, res): Promise<void> => {
  if (!(await cancelJob(String(req.params.id)))) {
    res.status(409).json({ error: "Only a queued job can be cancelled. A running job finishes its current attempt." });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, String(req.params.id))).limit(1);
  await logActivity("job_cancelled", `${jobDefinition(job.kind)?.label ?? job.kind} cancelled`, { userId: req.session.userId }).catch(() => {});
  res.json(view(job));
});

export default router;
