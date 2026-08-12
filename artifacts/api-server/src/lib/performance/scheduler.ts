/**
 * Content Performance Engine — background ingestion scheduler.
 * Mirrors lib/publishing/scheduler.ts's guarded setInterval pattern rather
 * than introducing a separate job queue/worker process.
 */
import { ingestDueMetrics } from "./ingestion";

const TICK_INTERVAL_MS = 5 * 60_000; // per-destination throttling (MIN_INGEST_INTERVAL_MS) is the real rate limiter

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // guard against overlapping ticks if one run is still in flight
  running = true;
  try {
    const result = await ingestDueMetrics();
    if (result.snapshotsInserted > 0) {
      console.log(`[performance-scheduler] destinationsChecked=${result.destinationsChecked} snapshotsInserted=${result.snapshotsInserted}`);
    }
  } catch (err) {
    console.error("[performance-scheduler] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startPerformanceScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  // Kick off a first pass shortly after boot rather than waiting a full
  // TICK_INTERVAL_MS for the first ingestion.
  setTimeout(() => { void tick(); }, 10_000);
}

export function stopPerformanceScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
