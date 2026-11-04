import { pgTable, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Durable background jobs (docs/BACKGROUND_JOBS.md). Work that is slow, can
 * fail transiently, or must survive a restart is enqueued here and run by the
 * worker in the API process, which claims rows with FOR UPDATE SKIP LOCKED.
 */
export const jobsTable = pgTable("jobs", {
  id: text("id").primaryKey(),
  /** A kind registered in the API's lib/jobs/registry.ts. */
  kind: text("kind").notNull(),
  /** The data owner the job acts for; null for system jobs such as the grant sync. */
  userId: text("user_id"),
  payload: jsonb("payload").notNull().default({}),
  /** queued → running → succeeded | failed | cancelled. A failed attempt with retries left goes back to queued. */
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  /** Not before this time (scheduling and retry backoff). */
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  /** While running: the worker holding it and when it last reported in. */
  lockedBy: text("locked_by"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  /** At most one queued or running job per key (for example one grant sync at a time). */
  dedupeKey: text("dedupe_key"),
  progress: jsonb("progress"),
  result: jsonb("result"),
  lastError: text("last_error"),
  /** Who asked for it: a person's name, "schedule", or "system". */
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  index("idx_jobs_claim").on(table.status, table.runAt),
  index("idx_jobs_created").on(table.createdAt),
  uniqueIndex("uq_jobs_dedupe_active").on(table.dedupeKey).where(sql`status in ('queued', 'running')`),
]);

export type Job = typeof jobsTable.$inferSelect;
