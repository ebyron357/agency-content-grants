import { Router, type IRouter } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, grantSourcesTable } from "@workspace/db";
import { PgRateLimitStore } from "../lib/pgRateLimitStore";
import { enqueue } from "../lib/jobs/registry";
import { sourceCheckJob, sourceCheckKey } from "../lib/jobs/definitions";
import { currentWorker } from "../lib/jobs/worker";
import { SECRET_HEADER, parseChangeNotification, verifyWebhookSecret, webhookSecret } from "../lib/grants/sources/webhookAuth";
import { mayRun } from "../lib/grants/sources/registry";

/**
 * POST /api/watch-events/changedetection: change notifications from a
 * self-hosted changedetection.io (docs/SOURCE_REGISTRY.md).
 *
 * Not behind a session: changedetection.io calls it. It is protected by its
 * own check instead: the shared secret in the `x-watcher-secret` header
 * (CHANGEDETECTION_WEBHOOK_SECRET, compared in constant time), a rate limit,
 * and a body that only names a watch. Nothing from the body is stored: the
 * check job reads the page from changedetection.io's API with its API key.
 * Without a configured secret the endpoint answers 503 and does nothing.
 */
const router: IRouter = Router();

export const WATCH_EVENTS_PATH = "/watch-events/changedetection";

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many notifications." },
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  store: new PgRateLimitStore("watch-events"),
});

router.post(WATCH_EVENTS_PATH, limiter, async (req, res): Promise<void> => {
  const secret = webhookSecret();
  if (!secret) {
    res.status(503).json({ error: "Change notifications are not configured on this server." });
    return;
  }
  if (!verifyWebhookSecret(req.header(SECRET_HEADER), secret)) {
    res.status(401).json({ error: "Invalid or missing watcher secret." });
    return;
  }
  const note = parseChangeNotification(req.body);
  if (!note) {
    res.status(400).json({ error: "The notification must name a watch (watch_uuid)." });
    return;
  }
  const [source] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.watchId, note.watchId)).limit(1);
  if (!source) {
    res.status(404).json({ error: "No source uses this watch." });
    return;
  }
  if (!mayRun(source)) {
    res.status(202).json({ accepted: false, reason: "The source is not running." });
    return;
  }
  const { job, created } = await enqueue(sourceCheckJob, { sourceId: source.id }, { dedupeKey: sourceCheckKey(source.id), requestedBy: "changedetection.io" });
  currentWorker()?.nudge();
  res.status(202).json({ accepted: true, jobId: job.id, created });
});

export default router;
