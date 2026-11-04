import { randomUUID } from "crypto";
import { and, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db, jobsTable, pool, type Job } from "@workspace/db";

/**
 * The durable job queue (docs/BACKGROUND_JOBS.md), in PostgreSQL. Claiming
 * uses FOR UPDATE SKIP LOCKED, so several workers never take the same job,
 * and a job held by a worker that stopped is put back after STALE_AFTER_MS.
 */

export const STALE_AFTER_MS = 2 * 60_000;
export const KEEP_FINISHED_DAYS = 30;

export interface EnqueueOptions {
  userId?: string | null;
  /** While a job with this key is queued or running, enqueue returns that job instead of adding another. */
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  requestedBy?: string | null;
}

export async function enqueueJob(kind: string, payload: Record<string, unknown>, opts: EnqueueOptions & { maxAttempts: number }): Promise<{ job: Job; created: boolean }> {
  const [row] = await db
    .insert(jobsTable)
    .values({
      id: randomUUID(),
      kind,
      payload,
      userId: opts.userId ?? null,
      dedupeKey: opts.dedupeKey ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts,
      requestedBy: opts.requestedBy ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { job: row, created: true };
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.dedupeKey, opts.dedupeKey!), inArray(jobsTable.status, ["queued", "running"])))
    .limit(1);
  if (existing) return { job: existing, created: false };
  // The active job finished between the two statements; try once more.
  return enqueueJob(kind, payload, opts);
}

/** Takes the next due job of one of these kinds, marking it running. */
export async function claimNextJob(workerId: string, kinds: string[]): Promise<Job | null> {
  if (!kinds.length) return null;
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', locked_by = $1, heartbeat_at = now(), started_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
          WHERE status = 'queued' AND run_at <= now() AND kind = ANY($2::text[])
          ORDER BY run_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1)
     RETURNING id`,
    [workerId, kinds],
  );
  if (!rows[0]) return null;
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, rows[0].id)).limit(1);
  return job ?? null;
}

/** Takes one specific job if it is due, for running it in the request (lib/jobs/worker.ts runJobNow). */
export async function claimJobById(id: string, workerId: string): Promise<Job | null> {
  const [job] = await db
    .update(jobsTable)
    .set({ status: "running", lockedBy: workerId, heartbeatAt: new Date(), startedAt: new Date(), attempts: sql`${jobsTable.attempts} + 1` })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.status, "queued"), lte(jobsTable.runAt, new Date())))
    .returning();
  return job ?? null;
}

/** Only the worker holding a job may record its outcome. */
const heldBy = (id: string, workerId: string) => and(eq(jobsTable.id, id), eq(jobsTable.status, "running"), eq(jobsTable.lockedBy, workerId));

export async function heartbeatJob(id: string, workerId: string, progress?: Record<string, unknown>): Promise<void> {
  await db.update(jobsTable).set({ heartbeatAt: new Date(), ...(progress ? { progress } : {}) }).where(heldBy(id, workerId));
}

export async function completeJob(id: string, workerId: string, result: Record<string, unknown> | null): Promise<void> {
  await db.update(jobsTable).set({ status: "succeeded", result, lastError: null, finishedAt: new Date(), lockedBy: null }).where(heldBy(id, workerId));
}

export async function failJobAttempt(id: string, workerId: string, error: string, next: { status: "queued"; runAt: Date } | { status: "failed" }): Promise<void> {
  await db
    .update(jobsTable)
    .set(next.status === "queued" ? { status: "queued", runAt: next.runAt, lastError: error, lockedBy: null, heartbeatAt: null } : { status: "failed", lastError: error, finishedAt: new Date(), lockedBy: null })
    .where(heldBy(id, workerId));
}

/**
 * Jobs whose worker stopped reporting (a crash or a deploy) go back in the
 * queue, or fail if they have used their attempts. Returns how many.
 */
export async function reclaimStaleJobs(staleAfterMs = STALE_AFTER_MS): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
            finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
            last_error = 'The worker stopped while running this job (restart or deploy).',
            locked_by = NULL, heartbeat_at = NULL, run_at = now()
      WHERE status = 'running' AND heartbeat_at < now() - ($1::text || ' milliseconds')::interval`,
    [String(staleAfterMs)],
  );
  return rowCount ?? 0;
}

/** Cancels a job that has not started. Running jobs finish their attempt. */
export async function cancelJob(id: string): Promise<boolean> {
  const rows = await db.update(jobsTable).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(jobsTable.id, id), eq(jobsTable.status, "queued"))).returning({ id: jobsTable.id });
  return rows.length === 1;
}

/** Runs a failed or cancelled job again from its first attempt. */
export async function retryJob(id: string): Promise<Job | null> {
  try {
    const [row] = await db
      .update(jobsTable)
      .set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null, result: null, progress: null, startedAt: null, finishedAt: null })
      .where(and(eq(jobsTable.id, id), inArray(jobsTable.status, ["failed", "cancelled"])))
      .returning();
    return row ?? null;
  } catch (err) {
    // Another job with the same key is already active.
    if ((err as { code?: string }).code === "23505") return null;
    throw err;
  }
}

export async function pruneFinishedJobs(days = KEEP_FINISHED_DAYS): Promise<number> {
  const rows = await db
    .delete(jobsTable)
    .where(and(inArray(jobsTable.status, ["succeeded", "failed", "cancelled"]), lt(jobsTable.finishedAt, new Date(Date.now() - days * 86_400_000))))
    .returning({ id: jobsTable.id });
  return rows.length;
}

export async function activeJob(dedupeKey: string): Promise<Job | null> {
  const [row] = await db.select().from(jobsTable).where(and(eq(jobsTable.dedupeKey, dedupeKey), inArray(jobsTable.status, ["queued", "running"]))).limit(1);
  return row ?? null;
}

export async function latestJob(kind: string): Promise<Job | null> {
  const [row] = await db.select().from(jobsTable).where(eq(jobsTable.kind, kind)).orderBy(desc(jobsTable.createdAt)).limit(1);
  return row ?? null;
}

export async function jobCounts(): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'queued')::int AS queued,
       count(*) FILTER (WHERE status = 'running')::int AS running,
       count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours')::int AS failed_24h,
       count(*) FILTER (WHERE status = 'succeeded' AND finished_at > now() - interval '24 hours')::int AS succeeded_24h
     FROM jobs`,
  );
  return { queued: rows[0].queued, running: rows[0].running, failed24h: rows[0].failed_24h, succeeded24h: rows[0].succeeded_24h };
}

