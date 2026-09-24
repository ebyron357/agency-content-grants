import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkReadiness } from "../lib/readiness";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
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
