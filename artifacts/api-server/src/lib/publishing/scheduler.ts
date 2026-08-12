/**
 * Background loop that drives due scheduled publications. Registered once at
 * server startup (see src/index.ts) — there is no separate worker process in
 * this codebase (see lib/repurposing generation, exports, etc., which all run
 * in-process), so a guarded setInterval is consistent with existing patterns.
 */
import { processDuePublications } from "../workflows/publishing-workflow";

const TICK_INTERVAL_MS = 20_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick() {
  if (running) return; // avoid overlapping runs if a tick takes longer than the interval
  running = true;
  try {
    const result = await processDuePublications();
    if (result.attempted > 0 || result.polled > 0) {
      console.log(`[publishing-scheduler] attempted=${result.attempted} polled=${result.polled}`);
    }
  } catch (err) {
    console.error("[publishing-scheduler] tick failed", err);
  } finally {
    running = false;
  }
}

export function startPublishingScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  // Fire once shortly after startup instead of waiting a full interval.
  setTimeout(() => { void tick(); }, 2000);
}

export function stopPublishingScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
