import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { withRequestContext } from "../lib/requestContext";

// ── Public routers (no auth required) ────────────────────────────────────────
import authRouter from "./auth";
import healthRouter from "./health";
import automationRouter from "./automation"; // action API — API-key-or-session auth handled internally
import watchEventsRouter from "./watch-events"; // changedetection.io change notifications — shared secret checked internally

// ── Protected routers ─────────────────────────────────────────────────────────
import dashboardRouter from "./dashboard";
import brandsRouter from "./brands";
import brandBrainRouter from "./brand-brain";
import projectsRouter from "./projects";
import researchRouter from "./research";
import sourcesRouter from "./sources";
import claimsRouter from "./claims";
import outlinesRouter from "./outlines";
import documentsRouter from "./documents";
import repurposingRouter from "./repurposing";
import qualityRouter from "./quality";
import exportsRouter from "./exports";
import providersRouter from "./providers";
import blueprintsRouter from "./blueprints";
import dependenciesRouter from "./dependencies";
import orchestrationRouter from "./orchestration";
import publishingRouter from "./publishing";
import performanceRouter from "./performance";
import apiKeysRouter from "./api-keys";
import webhooksRouter from "./webhooks";
import mediaRouter from "./media";
import grantsRouter from "./grants";
import grantTemplatesRouter from "./grant-templates";
import grantSourcesRouter from "./grant-sources";
import workspaceRouter from "./workspace";
import accountRouter from "./account";
import jobsRouter from "./jobs";

export const router = Router();

// Every request records who is making it, for the audit log.
router.use(withRequestContext);

// ── Public routes (must be mounted BEFORE requireAuth) ────────────────────────
router.use(authRouter); // /auth/login, /auth/logout, /auth/me
router.use(healthRouter); // /healthz
router.use(watchEventsRouter); // /watch-events/changedetection — shared-secret header, checked inside the router
// Session callers of the automation API get the same membership re-check and role
// permissions as the app; API-key callers are limited by their scopes instead.
router.use("/automation", (req, res, next) => {
  if (req.header("authorization")?.startsWith("Bearer ") || req.session?.authenticated !== true) return next();
  requireAuth(req, res, (err?: unknown) => (err ? next(err) : requirePermission(req, res, next)));
});
router.use(automationRouter); // /automation/* — API-key-or-session auth, checked per-route inside the router

// ── Require authentication for all routes below ───────────────────────────────
router.use(requireAuth);
// ── Per-role permissions (lib/permissions.ts) ─────────────────────────────────
router.use(requirePermission);

// ── Protected application-data routes ─────────────────────────────────────────
router.use(dashboardRouter);
router.use(brandsRouter);
router.use(brandBrainRouter);
router.use(projectsRouter);
router.use(researchRouter);
router.use(sourcesRouter);
router.use(claimsRouter);
router.use(outlinesRouter);
router.use(documentsRouter);
router.use(repurposingRouter);
router.use(qualityRouter);
router.use(exportsRouter);
router.use(providersRouter);
router.use(blueprintsRouter);
router.use(dependenciesRouter);
router.use(orchestrationRouter);
router.use(publishingRouter);
router.use(performanceRouter);
router.use(apiKeysRouter);
router.use(webhooksRouter);
router.use(mediaRouter);
router.use(grantTemplatesRouter);
router.use(grantSourcesRouter);
router.use(grantsRouter);
router.use(workspaceRouter);
router.use(accountRouter);
router.use(jobsRouter);
