import express, { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, grantApplicantsTable, grantApplicationsTable, membersTable, workspacesTable } from "@workspace/db";
import { billingConfig, billingEnabled, returnUrl } from "../lib/billing/config";
import { nextPeriodStart } from "../lib/billing/entitlements";
import {
  BillingError,
  applyEvent,
  createOneTimeCheckout,
  createPortalSession,
  createSubscriptionCheckout,
  entitlementOf,
  listPlans,
  purchasesOf,
  setManaged,
  startTrial,
  subscriptionOf,
  usageOf,
  verifyWebhook,
  workspaceOfSession,
} from "../lib/billing/service";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { upgradeLegacySession } from "../lib/workspaces";

/**
 * Billing (docs/BILLING.md). Mounted behind requireAuth and requirePermission:
 * every /billing route needs `billing.manage`, which only owners hold.
 *
 * With billing OFF, GET /billing says so and the actions refuse with 409; no
 * Stripe call is made and no limit applies anywhere.
 */
const router: IRouter = Router();

router.use(["/billing", "/workspaces/:id/billing"], (req, _res, next) => {
  upgradeLegacySession(req.session).then(() => next(), next);
});

function fail(res: Response, status: number, error: string, code?: string): void {
  res.status(status).json({ error, ...(code ? { code } : {}) });
}

function handle(res: Response, err: unknown): void {
  if (err instanceof BillingError) return fail(res, err.status, err.message);
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Billing request failed");
  fail(res, 502, "Stripe could not be reached. Try again in a minute.");
}

function requireBillingOn(res: Response): boolean {
  if (billingEnabled()) return true;
  fail(res, 409, "Billing is not switched on for this server. The owner adds the Stripe settings first (docs/BILLING.md).", "billing_off");
  return false;
}

async function currentWorkspace(req: Request, res: Response) {
  const workspace = await workspaceOfSession(req.session);
  if (!workspace) fail(res, 400, "No workspace is selected.");
  return workspace;
}

async function signedInEmail(req: Request): Promise<string | null> {
  if (!req.session.memberId) return null;
  const [m] = await db.select({ email: membersTable.email }).from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
  return m?.email ?? null;
}

const planView = (p: Awaited<ReturnType<typeof listPlans>>[number]) => ({
  key: p.key,
  name: p.name,
  description: p.description,
  kind: p.kind,
  monthlyPriceCents: p.monthlyPriceCents,
  annualPriceCents: p.annualPriceCents,
  oneTimePriceCents: p.oneTimePriceCents,
  limits: { users: p.maxUsers, organizations: p.maxOrganizations, aiDraftedApplications: p.aiDraftedApplicationsPerMonth },
  extraOrganizationPriceCents: p.extraOrganizationPriceCents,
  features: p.features,
  trialDays: p.trialDays,
  purchasable: p.purchasable,
  pricesPublished: p.pricesPublished,
});

/** GET /billing: plan, status, trial days left, usage against limits, and the plans on offer. */
router.get("/billing", async (req, res): Promise<void> => {
  const workspace = await currentWorkspace(req, res);
  if (!workspace) return;
  const config = billingConfig();
  const [plans, sub, ent, usage, purchases] = await Promise.all([listPlans(), subscriptionOf(workspace.id), entitlementOf(workspace), usageOf(workspace), purchasesOf(workspace.id)]);
  res.json({
    enabled: config.enabled,
    mode: config.enabled ? config.mode : null,
    // Names only, never values, so the owner knows what to set.
    missingSettings: config.missing,
    forcedOff: config.forcedOff,
    workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind },
    subscription: sub
      ? {
          planKey: sub.planKey,
          status: sub.status,
          billingInterval: sub.billingInterval,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          extraOrganizations: sub.extraOrganizations,
          hasBillingAccount: !!sub.stripeCustomerId,
          hasStripeSubscription: !!sub.stripeSubscriptionId,
        }
      : null,
    entitlement: { mode: ent.mode, reason: ent.reason, planKey: ent.plan?.key ?? null, planName: ent.plan?.name ?? null, limits: ent.limits, trialDaysLeft: ent.trialDaysLeft },
    usage,
    usageResetsOn: nextPeriodStart(),
    trialAvailable: !sub || (!sub.trialEndsAt && !sub.stripeSubscriptionId && sub.status === "none"),
    plans: plans.filter((p) => p.active).map(planView),
    pricesPublished: plans.filter((p) => p.active && p.purchasable).every((p) => p.pricesPublished),
    purchases: purchases.map((p) => ({ id: p.id, planKey: p.planKey, applicationId: p.applicationId, amountCents: p.amountCents, currency: p.currency, status: p.status, createdAt: p.createdAt })),
  });
});

/** POST /billing/trial { planKey }: a 14-day trial with no card. One per workspace. */
router.post("/billing/trial", async (req, res): Promise<void> => {
  if (!requireBillingOn(res)) return;
  const workspace = await currentWorkspace(req, res);
  if (!workspace) return;
  if (workspace.kind === "agency") return fail(res, 409, "The agency workspace is never limited and needs no plan.");
  try {
    const sub = await startTrial(workspace.id, String(req.body?.planKey ?? ""));
    await logActivity("billing_trial_started", `Free trial of ${sub.planKey} started`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
    res.status(201).json({ planKey: sub.planKey, status: sub.status, trialEndsAt: sub.trialEndsAt });
  } catch (err) {
    handle(res, err);
  }
});

/** POST /billing/checkout { planKey, interval: "month" | "year", extraOrganizations? }: Stripe Checkout for a plan. */
router.post("/billing/checkout", async (req, res): Promise<void> => {
  if (!requireBillingOn(res)) return;
  const workspace = await currentWorkspace(req, res);
  if (!workspace) return;
  if (workspace.kind === "agency") return fail(res, 409, "The agency workspace is never limited and needs no plan.");
  const interval = req.body?.interval === "year" ? "year" : req.body?.interval === "month" || req.body?.interval === undefined ? "month" : null;
  if (!interval) return fail(res, 400, 'interval must be "month" or "year"');
  const extra = req.body?.extraOrganizations === undefined ? 0 : Number(req.body.extraOrganizations);
  if (!Number.isInteger(extra) || extra < 0 || extra > 500) return fail(res, 400, "extraOrganizations must be a whole number from 0 to 500");
  try {
    const url = await createSubscriptionCheckout({
      workspace,
      planKey: String(req.body?.planKey ?? ""),
      interval,
      extraOrganizations: extra,
      email: await signedInEmail(req),
      successUrl: returnUrl("/settings?tab=billing&checkout=success"),
      cancelUrl: returnUrl("/settings?tab=billing&checkout=cancelled"),
    });
    res.json({ url });
  } catch (err) {
    handle(res, err);
  }
});

/** POST /billing/expert-review { applicationId }: one-time Checkout for an expert review of one application. */
router.post("/billing/expert-review", async (req, res): Promise<void> => {
  if (!requireBillingOn(res)) return;
  const workspace = await currentWorkspace(req, res);
  if (!workspace) return;
  const applicationId = typeof req.body?.applicationId === "string" ? req.body.applicationId : "";
  // The application must belong to this workspace.
  const [owned] = await db
    .select({ id: grantApplicationsTable.id })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantApplicationsTable.id, applicationId), eq(grantApplicantsTable.userId, req.session.userId!)))
    .limit(1);
  if (!owned) return fail(res, 404, "Application not found");
  try {
    const url = await createOneTimeCheckout({
      workspace,
      planKey: "expert_review",
      applicationId: owned.id,
      email: await signedInEmail(req),
      successUrl: returnUrl(`/grant-studio/applications/${owned.id}?expert_review=success`),
      cancelUrl: returnUrl(`/grant-studio/applications/${owned.id}?expert_review=cancelled`),
    });
    res.json({ url });
  } catch (err) {
    handle(res, err);
  }
});

/** POST /billing/portal: the Stripe customer portal (change plan, card, invoices, cancel). */
router.post("/billing/portal", async (req, res): Promise<void> => {
  if (!requireBillingOn(res)) return;
  const workspace = await currentWorkspace(req, res);
  if (!workspace) return;
  try {
    res.json({ url: await createPortalSession(workspace, returnUrl("/settings?tab=billing")) });
  } catch (err) {
    handle(res, err);
  }
});

/**
 * PUT /workspaces/:id/billing { managed }: the operator (admin-unlocked) marks a
 * client workspace as run by the agency (no limits, no charge), or clears it.
 */
router.put("/workspaces/:id/billing", async (req, res): Promise<void> => {
  if (req.session.isAdmin !== true) return fail(res, 403, "Unlock admin access to change a workspace's billing.");
  if (typeof req.body?.managed !== "boolean") return fail(res, 400, "managed must be true or false");
  const [target] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, String(req.params.id))).limit(1);
  if (!target) return fail(res, 404, "Workspace not found");
  if (target.kind === "agency") return fail(res, 409, "The agency workspace is never limited.");
  try {
    await setManaged(target.id, req.body.managed);
    await logActivity("billing_managed_changed", `${target.name} ${req.body.managed ? "is now agency-managed" : "is no longer agency-managed"}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
    res.json({ id: target.id, managed: req.body.managed });
  } catch (err) {
    handle(res, err);
  }
});

export default router;

/**
 * POST /api/billing/webhook: Stripe's webhook endpoint. Mounted in app.ts BEFORE
 * express.json(), because the signature covers the exact bytes Stripe sent
 * (express.raw keeps them as a Buffer). Public by design: the signing secret
 * is the authentication. Off (404) while billing is off.
 */
export const billingWebhook = [
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response): Promise<void> => {
    if (!billingEnabled()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Expected the raw JSON body Stripe sent." });
      return;
    }
    let event;
    try {
      event = verifyWebhook(req.body, req.header("stripe-signature"));
    } catch {
      res.status(400).json({ error: "Webhook signature verification failed." });
      return;
    }
    try {
      const result = await applyEvent(event);
      logger.info({ eventId: event.id, type: event.type, applied: result.applied, reason: result.reason }, "Stripe webhook processed");
      res.json({ received: true, ...result });
    } catch (err) {
      // 500 makes Stripe retry; nothing was recorded, so the retry is applied in full.
      logger.error({ eventId: event.id, type: event.type, err: err instanceof Error ? err.message : String(err) }, "Stripe webhook failed");
      res.status(500).json({ error: "Could not process the event." });
    }
  },
];
