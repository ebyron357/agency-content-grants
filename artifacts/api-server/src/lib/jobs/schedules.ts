import { and, eq, gte } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import { enqueue } from "./registry";
import { GRANT_SYNC_KEY, SOURCE_SWEEP_KEY, grantSyncJob, sourceSweepJob } from "./definitions";
import type { JobDefinition } from "./types";

/**
 * Recurring jobs, as data (docs/BACKGROUND_JOBS.md). Time is divided into
 * slots of `everyMs` (UTC). A slot is covered once any job of that kind was
 * created in it, by the schedule or by hand, so restarts and deploys never add
 * a second run, and a manual refresh counts for the day.
 */
export interface Schedule {
  name: string;
  job: JobDefinition<any>;
  everyMs: number;
  /** Wait this long after the API starts before the slot's job may run. */
  startDelayMs: number;
  dedupeKey?: string;
  enabled: () => boolean;
}

export const SCHEDULES: Schedule[] = [
  {
    name: "grant-sync-daily",
    job: grantSyncJob,
    everyMs: 24 * 60 * 60_000,
    startDelayMs: 60_000,
    dedupeKey: GRANT_SYNC_KEY,
    enabled: () => process.env.GRANTS_SYNC_DISABLED !== "true" && (process.env.NODE_ENV !== "test" || process.env.GRANTS_SYNC_ENABLED === "true"),
  },
  {
    // Checks watched pages whose own schedule has come round (docs/SOURCE_REGISTRY.md). No page source is active until a person adds one.
    name: "source-sweep-hourly",
    job: sourceSweepJob,
    everyMs: 60 * 60_000,
    startDelayMs: 120_000,
    dedupeKey: SOURCE_SWEEP_KEY,
    enabled: () => process.env.SOURCE_WATCH_DISABLED !== "true" && (process.env.NODE_ENV !== "test" || process.env.SOURCE_WATCH_ENABLED === "true"),
  },
];

export function slotOf(schedule: Pick<Schedule, "name" | "everyMs">, now = Date.now()): string {
  return `${schedule.name}:${Math.floor(now / schedule.everyMs)}`;
}

/** Enqueues each enabled schedule's job for the current slot, once. Returns the names enqueued. */
export async function runSchedules(startedAt: number, now = Date.now()): Promise<string[]> {
  const enqueued: string[] = [];
  for (const schedule of SCHEDULES) {
    if (!schedule.enabled()) continue;
    const slot = slotOf(schedule, now);
    const slotStart = new Date(Math.floor(now / schedule.everyMs) * schedule.everyMs);
    // Any job of this kind created in this slot covers it, including a manual run.
    const [seen] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.kind, schedule.job.kind), gte(jobsTable.createdAt, slotStart)))
      .limit(1);
    if (seen) continue;
    const runAt = new Date(Math.max(now, startedAt + schedule.startDelayMs));
    const { created } = await enqueue(schedule.job, { scheduleSlot: slot }, { dedupeKey: schedule.dedupeKey, runAt, requestedBy: "schedule" });
    if (created) enqueued.push(schedule.name);
  }
  return enqueued;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSchedules(): void {
  if (timer) return;
  const startedAt = Date.now();
  const tick = () => void runSchedules(startedAt).catch((err) => console.warn("[jobs] schedules failed", (err as Error).message));
  tick();
  timer = setInterval(tick, 60_000);
  timer.unref?.();
}

export function stopSchedules(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
