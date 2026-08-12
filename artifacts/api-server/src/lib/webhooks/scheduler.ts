/**
 * Background loop that drives due webhook deliveries. Registered once at
 * server startup (see src/index.ts) — same guarded-setInterval pattern as
 * lib/publishing/scheduler.ts and lib/performance/scheduler.ts; there is no
 * separate worker process in this codebase.
 */
import { processDueDeliveries } from "./delivery";

const TICK_INTERVAL_MS = 15_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await processDueDeliveries();
    if (result.attempted > 0) {
      console.log(`[webhook-scheduler] attempted=${result.attempted}`);
    }
  } catch (err) {
    console.error("[webhook-scheduler] tick failed", err);
  } finally {
    running = false;
  }
}

export function startWebhookScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  setTimeout(() => { void tick(); }, 2000);
}

export function stopWebhookScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
