import { defineJob, exponentialBackoff } from "./registry";
import { runGrantSync } from "../grants/ingest";

/**
 * The job kinds this API runs. Add a kind here, with its limits, and the
 * worker, the jobs screen and the schedules pick it up.
 */

/** Refreshes grant opportunities from every source, then sends match alerts and deadline reminders. */
export const grantSyncJob = defineJob<{ scheduleSlot?: string }>({
  kind: "grant_sync",
  label: "Refresh grant opportunities",
  maxAttempts: 3,
  timeoutMs: 20 * 60_000,
  backoffMs: exponentialBackoff(5 * 60_000, 60 * 60_000),
  concurrency: 1,
  run: async ({ progress, signal }) => {
    const result = await runGrantSync({ onProgress: (p) => progress(p), signal });
    return { ...result };
  },
});

/** The dedupe key that keeps one grant sync queued or running at a time. */
export const GRANT_SYNC_KEY = "grant_sync";
