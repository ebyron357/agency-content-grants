import { runMigrations } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { adoptOrphanedData } from "./lib/adoptData";
import { startPublishingScheduler } from "./lib/publishing/scheduler";
import { startPerformanceScheduler } from "./lib/performance/scheduler";
import { startWebhookScheduler } from "./lib/webhooks/scheduler";

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
    });
  })
  .catch((err: unknown) => {
    logger.error({ err }, "Startup failed — refusing to start");
    process.exit(1);
  });
