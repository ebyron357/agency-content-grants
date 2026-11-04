import { runMigrations } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { adoptOrphanedData } from "./lib/adoptData";
import { startPublishingScheduler } from "./lib/publishing/scheduler";
import { startPerformanceScheduler } from "./lib/performance/scheduler";
import { startWebhookScheduler } from "./lib/webhooks/scheduler";
import "./lib/jobs/definitions";
import { startJobWorker, stopJobWorker } from "./lib/jobs/worker";
import { startSchedules, stopSchedules } from "./lib/jobs/schedules";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run database migrations before starting the server.
// This makes fresh deployments self-bootstrapping and repeated starts safe.
runMigrations()
  .then(() => adoptOrphanedData()) // adopt brands/projects that pre-date user accounts
  .then(() => {
    app.listen(port, (err: Error | undefined) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startPublishingScheduler();
      startPerformanceScheduler();
      startWebhookScheduler();
      // Durable background jobs (docs/BACKGROUND_JOBS.md): the worker and the recurring schedules.
      const worker = startJobWorker();
      if (worker) {
        startSchedules();
        logger.info({ worker: worker.id }, "Background job worker started");
      }
    });
  })
  .catch((err: unknown) => {
    logger.error({ err }, "Startup failed — refusing to start");
    process.exit(1);
  });

// On deploy, Render sends SIGTERM: let running jobs finish briefly, then exit.
// Anything still running is put back in the queue by the next worker.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopSchedules();
    void stopJobWorker().finally(() => process.exit(0));
  });
}
