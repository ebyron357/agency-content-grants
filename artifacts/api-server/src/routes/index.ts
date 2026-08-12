import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";

// ── Public routers (no auth required) ────────────────────────────────────────
import authRouter from "./auth";
import healthRouter from "./health";
import storageRouter from "./storage"; // public-objects endpoint + upload (internal auth check)
import automationRouter from "./automation"; // action API — API-key-or-session auth handled internally

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

export const router = Router();

// ── Public routes (must be mounted BEFORE requireAuth) ────────────────────────
router.use(authRouter);   // /auth/login, /auth/logout, /auth/me
router.use(healthRouter); // /healthz
router.use(storageRouter); // /storage/public-objects/* (public) + /storage/uploads/request-url (internal check)
router.use(automationRouter); // /automation/* — API-key-or-session auth, checked per-route inside the router

// ── Require authentication for all routes below ───────────────────────────────
router.use(requireAuth);

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
