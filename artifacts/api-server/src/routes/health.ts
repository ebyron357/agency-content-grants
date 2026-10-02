import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkReadiness } from "../lib/readiness";

const router: IRouter = Router();

/** Commit of the running build, used to prove repository/deployment parity. */
export function runningCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  const commit = (env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit.toLowerCase() : null;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    commit: runningCommit(),
  });
  res.json(data);
});

router.get("/readyz", async (req, res) => {
  const result = await checkReadiness();
  if (!result.ready) {
    req.log.warn({ checks: result.checks }, "Readiness check failed");
  }
  res.status(result.ready ? 200 : 503).json({
    status: result.ready ? "ready" : "not_ready",
    checks: result.checks,
  });
});

export default router;
