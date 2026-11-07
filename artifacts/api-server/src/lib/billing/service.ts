/**
 * Billing service (docs/BILLING.md): the Stripe client, a workspace's
 * entitlement and usage, limit enforcement, trials, and applying verified
 * webhook events to the subscription record.
 *
 * Billing OFF (lib/billing/config.ts): every check returns "allowed" before
 * touching the database, so the product behaves exactly as it did before.
 */
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { and, asc, count, countDistinct, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import {
  billingEventsTable,
  billingPlansTable,
  billingPurchasesTable,
  billingUsageTable,
  db,
  grantApplicantsTable,
  invitesTable,
  membershipsTable,
  workspaceSubscriptionsTable,
  workspacesTable,
  type BillingPlan,
  type Workspace,
  type WorkspaceSubscription,
} from "@workspace/db";
import { billingEnabled } from "./config";
import { checkLimit, resolveEntitlement, usagePeriod, type Entitlement, type LimitDecision, type Metric } from "./entitlements";
import { actionFor, UNKNOWN_PLAN, type EventLike } from "./stripeEvents";
import { logger } from "../logger";

// ── Stripe client ──────────────────────────────────────────────────────────────

/** The part of the Stripe API this module calls. Tests replace it with a fake; nothing else does. */
export interface StripeApi {
  prices: { list(params: { lookup_keys: string[]; active?: boolean; limit?: number }): Promise<{ data: { id: string; lookup_key: string | null }[] }> };
  customers: { create(params: { name?: string; email?: string; metadata?: Record<string, string> }): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: { customer: string; return_url: string }): Promise<{ url: string }> } };
}

let override: StripeApi | null = null;
let client: Stripe | null = null;

/** Tests only: route Stripe API calls to a fake. */
export function setStripeApiForTests(api: StripeApi | null): void {
  override = api;
}

function stripeApi(): StripeApi {
  if (override) return override;
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY as string, { appInfo: { name: "GrantCrest" } });
  return client as unknown as StripeApi;
}

/**
 * Verifies a webhook with the official library and the signing secret
 * (stripe.webhooks.constructEvent), against the raw request bytes. Throws when
 * the signature, secret or timestamp tolerance does not match.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): EventLike {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET as string) as unknown as EventLike;
}

// ── Plans, subscription, entitlement ──────────────────────────────────────────

export async function listPlans(): Promise<BillingPlan[]> {
  return db.select().from(billingPlansTable).orderBy(asc(billingPlansTable.position));
}

export async function planByKey(key: string | null | undefined): Promise<BillingPlan | null> {
  if (!key) return null;
  const [row] = await db.select().from(billingPlansTable).where(eq(billingPlansTable.key, key)).limit(1);
  return row ?? null;
}

export async function subscriptionOf(workspaceId: string): Promise<WorkspaceSubscription | null> {
  const [row] = await db.select().from(workspaceSubscriptionsTable).where(eq(workspaceSubscriptionsTable.workspaceId, workspaceId)).limit(1);
  return row ?? null;
}

/** The workspace a session acts in: its workspaceId, or the workspace whose principal is the data owner. */
export async function workspaceOfSession(session: { workspaceId?: string; userId?: string }): Promise<Workspace | null> {
  if (session.workspaceId) {
    const [w] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, session.workspaceId)).limit(1);
    if (w) return w;
  }
  if (!session.userId) return null;
  const [w] = await db.select().from(workspacesTable).where(eq(workspacesTable.principalUserId, session.userId)).limit(1);
  return w ?? null;
}

export async function entitlementOf(workspace: Workspace | null): Promise<Entitlement> {
  const enabled = billingEnabled();
  if (!enabled) return resolveEntitlement({ billingEnabled: false, workspaceKind: workspace?.kind ?? null, subscription: null, plan: null });
  if (!workspace) return resolveEntitlement({ billingEnabled: true, workspaceKind: null, subscription: null, plan: null });
  const sub = await subscriptionOf(workspace.id);
  const plan = await planByKey(sub?.planKey);
  return resolveEntitlement({ billingEnabled: true, workspaceKind: workspace.kind, subscription: sub, plan });
}

/**
 * With billing on, the client workspaces that have no usable plan: their owners
 * can read and edit but cannot invite, add organizations or draft with AI until
 * they start a trial, subscribe, or the operator marks them agency-managed
 * (docs/BILLING.md §5 step 8). Empty while billing is off.
 */
export async function workspacesWithoutPlan(): Promise<{ id: string; reason: string }[]> {
  if (!billingEnabled()) return [];
  const rows = await db.select().from(workspacesTable).where(ne(workspacesTable.kind, "agency"));
  const out: { id: string; reason: string }[] = [];
  for (const w of rows) {
    const ent = await entitlementOf(w);
    if (ent.mode === "none") out.push({ id: w.id, reason: ent.reason });
  }
  return out;
}

// ── Usage ──────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countUsers(workspaceId: string, opts: { includeInvites: boolean; excludeInviteEmail?: string } = { includeInvites: true }, q: Tx | typeof db = db): Promise<number> {
  const [{ n }] = await q.select({ n: count() }).from(membershipsTable).where(eq(membershipsTable.workspaceId, workspaceId));
  if (!opts.includeInvites) return Number(n);
  const conditions = [eq(invitesTable.workspaceId, workspaceId), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt), gt(invitesTable.expiresAt, new Date())];
  if (opts.excludeInviteEmail) conditions.push(ne(invitesTable.email, opts.excludeInviteEmail));
  const [{ i }] = await q.select({ i: count() }).from(invitesTable).where(and(...conditions));
  return Number(n) + Number(i);
}

async function countOrganizations(principalUserId: string, q: Tx | typeof db = db): Promise<number> {
  const [{ n }] = await q.select({ n: count() }).from(grantApplicantsTable).where(eq(grantApplicantsTable.userId, principalUserId));
  return Number(n);
}

export const AI_DRAFTED_APPLICATION = "ai_drafted_application";

async function countAiDrafted(workspaceId: string, period: string, q: Tx | typeof db = db): Promise<number> {
  const [{ n }] = await q
    .select({ n: countDistinct(billingUsageTable.ref) })
    .from(billingUsageTable)
    .where(and(eq(billingUsageTable.workspaceId, workspaceId), eq(billingUsageTable.period, period), eq(billingUsageTable.metric, AI_DRAFTED_APPLICATION)));
  return Number(n);
}

export async function usageOf(workspace: Workspace, now: Date = new Date()): Promise<Record<Metric, number>> {
  const [users, organizations, aiDraftedApplications] = await Promise.all([
    countUsers(workspace.id),
    countOrganizations(workspace.principalUserId),
    countAiDrafted(workspace.id, usagePeriod(now)),
  ]);
  return { users, organizations, aiDraftedApplications };
}

// ── Enforcement ────────────────────────────────────────────────────────────────

const ALLOWED: LimitDecision = { allowed: true, limit: null, used: 0 };

/** Inviting one more person. Open invitations count as users, except one for the same email (it is replaced). */
export async function checkInvite(session: { workspaceId?: string; userId?: string }, email: string): Promise<LimitDecision> {
  if (!billingEnabled()) return ALLOWED;
  const workspace = await workspaceOfSession(session);
  const ent = await entitlementOf(workspace);
  if (ent.mode === "unlimited") return ALLOWED;
  const used = workspace ? await countUsers(workspace.id, { includeInvites: true, excludeInviteEmail: email }) : 0;
  return checkLimit(ent, "users", used);
}

/**
 * Accepting an invitation: it was counted when sent, so only members count here
 * (catches a downgrade since). The first person to join an empty workspace is
 * always admitted: a workspace needs an owner before anyone can choose its plan.
 */
export async function checkInviteAcceptance(workspace: Workspace): Promise<LimitDecision> {
  if (!billingEnabled()) return ALLOWED;
  const ent = await entitlementOf(workspace);
  if (ent.mode === "unlimited") return ALLOWED;
  const members = await countUsers(workspace.id, { includeInvites: false });
  if (members === 0) return ALLOWED;
  return checkLimit(ent, "users", members);
}

/** Adding one more Grant Studio organization. */
export async function checkNewOrganization(session: { workspaceId?: string; userId?: string }): Promise<LimitDecision> {
  if (!billingEnabled()) return ALLOWED;
  const workspace = await workspaceOfSession(session);
  const ent = await entitlementOf(workspace);
  if (ent.mode === "unlimited") return ALLOWED;
  return checkLimit(ent, "organizations", workspace ? await countOrganizations(workspace.principalUserId) : 0);
}

/** Where an AI draft's usage is recorded, carried in the draft job's payload (strings only). */
export interface AiDraftUsage {
  usageWorkspaceId: string;
  usagePeriod: string;
  usageApplicationId: string;
  /** Set only when this request created the reservation, so only its job may release it. */
  usageClaimId?: string;
}

/**
 * Drafting a section with AI. The first AI draft in an application each month
 * counts that application once; more drafts in it that month are free. Counted
 * and checked under a per-workspace lock, so two requests cannot both take the
 * last one. The first draft only reserves the slot: the draft job confirms it
 * on success and releases it if the draft finally fails
 * (confirmAiDraftedApplication, releaseAiDraftClaim), so a failed draft does
 * not count. `usage` is returned whenever billing is on, for the job payload.
 */
export async function claimAiDraftedApplication(session: { workspaceId?: string; userId?: string }, applicationId: string, now: Date = new Date()): Promise<LimitDecision & { usage?: AiDraftUsage }> {
  if (!billingEnabled()) return ALLOWED;
  const workspace = await workspaceOfSession(session);
  const ent = await entitlementOf(workspace);
  if (!workspace) return checkLimit(ent, "aiDraftedApplications", 0, now);
  const period = usagePeriod(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`billing:${workspace.id}`}))`);
    const [already] = await tx
      .select({ id: billingUsageTable.id })
      .from(billingUsageTable)
      .where(and(eq(billingUsageTable.workspaceId, workspace.id), eq(billingUsageTable.period, period), eq(billingUsageTable.metric, AI_DRAFTED_APPLICATION), eq(billingUsageTable.ref, applicationId)))
      .limit(1);
    const used = await countAiDrafted(workspace.id, period, tx);
    const usage: AiDraftUsage = { usageWorkspaceId: workspace.id, usagePeriod: period, usageApplicationId: applicationId };
    if (already) return { allowed: true, limit: ent.limits.aiDraftedApplications, used, usage };
    const decision = checkLimit(ent, "aiDraftedApplications", used, now);
    if (!decision.allowed) return decision;
    const claimId = randomUUID();
    const inserted = await tx
      .insert(billingUsageTable)
      .values({ id: claimId, workspaceId: workspace.id, period, metric: AI_DRAFTED_APPLICATION, ref: applicationId })
      .onConflictDoNothing()
      .returning({ id: billingUsageTable.id });
    return { ...decision, used: used + 1, usage: inserted.length ? { ...usage, usageClaimId: claimId } : usage };
  });
}

/**
 * A draft in the application succeeded: the application counts this month.
 * Inserts the row if a failed draft's release removed it in the meantime.
 */
export async function confirmAiDraftedApplication(usage: Pick<AiDraftUsage, "usageWorkspaceId" | "usagePeriod" | "usageApplicationId">): Promise<void> {
  const now = new Date();
  await db
    .insert(billingUsageTable)
    .values({ id: randomUUID(), workspaceId: usage.usageWorkspaceId, period: usage.usagePeriod, metric: AI_DRAFTED_APPLICATION, ref: usage.usageApplicationId, confirmedAt: now })
    .onConflictDoUpdate({
      target: [billingUsageTable.workspaceId, billingUsageTable.period, billingUsageTable.metric, billingUsageTable.ref],
      set: { confirmedAt: sql`coalesce(${billingUsageTable.confirmedAt}, ${now})` },
    });
}

/**
 * The draft that made this reservation finally failed. Removes the reservation
 * unless another draft in the same application succeeded and confirmed it.
 */
export async function releaseAiDraftClaim(claimId: string): Promise<void> {
  await db.delete(billingUsageTable).where(and(eq(billingUsageTable.id, claimId), isNull(billingUsageTable.confirmedAt)));
}

/** The HTTP answer for a refused limit: 402 with a plain-language message the UI shows as is. */
export function limitResponse(decision: LimitDecision) {
  return { error: decision.message ?? "Your plan does not include this.", code: decision.code ?? "plan_limit_reached", limit: decision.limit, used: decision.used };
}

// ── Trials and agency-managed workspaces ──────────────────────────────────────

export class BillingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Starts a free trial of a plan with no card and no Stripe call. A workspace
 * gets one trial. The week-2 sign-up flow calls this for a new workspace.
 */
export async function startTrial(workspaceId: string, planKey: string, now: Date = new Date()): Promise<WorkspaceSubscription> {
  const plan = await planByKey(planKey);
  if (!plan || !plan.active || plan.kind !== "subscription" || !plan.purchasable || plan.trialDays <= 0) throw new BillingError(400, "That plan does not offer a free trial.");
  const existing = await subscriptionOf(workspaceId);
  if (existing && (existing.trialEndsAt || existing.stripeSubscriptionId || existing.status !== "none")) throw new BillingError(409, "This workspace has already had a free trial or a plan. Choose a plan to continue.");
  const values = { planKey: plan.key, status: "trialing", trialEndsAt: new Date(now.getTime() + plan.trialDays * 86_400_000), currentPeriodEnd: null, billingInterval: null, cancelAtPeriodEnd: false };
  const [row] = await db
    .insert(workspaceSubscriptionsTable)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: workspaceSubscriptionsTable.workspaceId, set: values })
    .returning();
  return row;
}

/** The operator marks a client workspace as run by the agency: no limits, no charge. */
export async function setManaged(workspaceId: string, managed: boolean): Promise<void> {
  const existing = await subscriptionOf(workspaceId);
  if (existing?.stripeSubscriptionId && existing.status !== "canceled") throw new BillingError(409, "This workspace pays through Stripe. Cancel its subscription in the customer portal first.");
  const values = managed ? { planKey: "managed", status: "active" } : { planKey: null, status: "none" };
  await db.insert(workspaceSubscriptionsTable).values({ workspaceId, ...values }).onConflictDoUpdate({ target: workspaceSubscriptionsTable.workspaceId, set: values });
}

// ── Checkout and the customer portal (Stripe-hosted) ──────────────────────────

async function priceIds(lookupKeys: string[]): Promise<Map<string, string>> {
  const prices = await stripeApi().prices.list({ lookup_keys: lookupKeys, active: true, limit: 10 });
  return new Map(prices.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key as string, p.id]));
}

async function ensureCustomer(workspace: Workspace, email: string | null): Promise<string> {
  const sub = await subscriptionOf(workspace.id);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const customer = await stripeApi().customers.create({ name: workspace.name, ...(email ? { email } : {}), metadata: { workspaceId: workspace.id } });
  await db
    .insert(workspaceSubscriptionsTable)
    .values({ workspaceId: workspace.id, stripeCustomerId: customer.id })
    .onConflictDoUpdate({ target: workspaceSubscriptionsTable.workspaceId, set: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** A Checkout Session for a subscription plan. Returns Stripe's hosted page URL. */
export async function createSubscriptionCheckout(opts: { workspace: Workspace; planKey: string; interval: "month" | "year"; extraOrganizations: number; email: string | null; successUrl: string; cancelUrl: string; now?: Date }): Promise<string> {
  const plan = await planByKey(opts.planKey);
  if (!plan || !plan.active || plan.kind !== "subscription" || !plan.purchasable) throw new BillingError(400, "Choose one of the plans shown.");
  const sub = await subscriptionOf(opts.workspace.id);
  if (sub?.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(sub.status)) throw new BillingError(409, "This workspace already has a subscription. Use Manage billing to change or cancel it.");
  const lookup = opts.interval === "year" ? plan.stripeLookupAnnual : plan.stripeLookupMonthly;
  const extraLookup = opts.interval === "year" ? plan.stripeLookupExtraOrganizationAnnual : plan.stripeLookupExtraOrganization;
  const extra = plan.extraOrganizationPriceCents !== null ? Math.max(0, Math.min(500, Math.floor(opts.extraOrganizations || 0))) : 0;
  if (!lookup) throw new BillingError(400, "This plan has no price for that billing period.");
  const wanted = [lookup, ...(extra > 0 && extraLookup ? [extraLookup] : [])];
  const ids = await priceIds(wanted);
  const missing = wanted.filter((k) => !ids.has(k));
  if (missing.length) throw new BillingError(503, `Stripe has no active price with the lookup key ${missing.join(", ")}. The owner sets it on the price in Stripe (docs/BILLING.md).`);
  const customer = await ensureCustomer(opts.workspace, opts.email);
  const now = opts.now ?? new Date();
  // Subscribing during a free trial keeps the days left: Stripe needs a trial end at least 48 hours away.
  const trialEnd = sub?.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt.getTime() - now.getTime() > 49 * 3_600_000 ? Math.floor(sub.trialEndsAt.getTime() / 1000) : undefined;
  const metadata = { workspaceId: opts.workspace.id, planKey: plan.key };
  const session = await stripeApi().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: opts.workspace.id,
    line_items: [{ price: ids.get(lookup), quantity: 1 }, ...(extra > 0 && extraLookup ? [{ price: ids.get(extraLookup), quantity: extra }] : [])],
    metadata,
    subscription_data: { metadata, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    allow_promotion_codes: true,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new BillingError(502, "Stripe did not return a checkout page.");
  return session.url;
}

/** A Checkout Session for a one-time purchase (expert review of one application). */
export async function createOneTimeCheckout(opts: { workspace: Workspace; planKey: string; applicationId: string; email: string | null; successUrl: string; cancelUrl: string }): Promise<string> {
  const plan = await planByKey(opts.planKey);
  if (!plan || !plan.active || plan.kind !== "one_time" || !plan.purchasable || !plan.stripeLookupMonthly) throw new BillingError(400, "That purchase is not available.");
  const ids = await priceIds([plan.stripeLookupMonthly]);
  const price = ids.get(plan.stripeLookupMonthly);
  if (!price) throw new BillingError(503, `Stripe has no active price with the lookup key ${plan.stripeLookupMonthly}. The owner sets it on the price in Stripe (docs/BILLING.md).`);
  const customer = await ensureCustomer(opts.workspace, opts.email);
  const metadata = { workspaceId: opts.workspace.id, planKey: plan.key, applicationId: opts.applicationId };
  const session = await stripeApi().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: opts.workspace.id,
    line_items: [{ price, quantity: 1 }],
    metadata,
    payment_intent_data: { metadata },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new BillingError(502, "Stripe did not return a checkout page.");
  return session.url;
}

/** The Stripe customer portal, where the owner changes plan, updates the card, sees invoices or cancels. */
export async function createPortalSession(workspace: Workspace, returnTo: string): Promise<string> {
  const sub = await subscriptionOf(workspace.id);
  if (!sub?.stripeCustomerId) throw new BillingError(409, "This workspace has no billing account yet. Choose a plan first.");
  const session = await stripeApi().billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: returnTo });
  return session.url;
}

export async function purchasesOf(workspaceId: string) {
  return db.select().from(billingPurchasesTable).where(eq(billingPurchasesTable.workspaceId, workspaceId)).orderBy(asc(billingPurchasesTable.createdAt));
}

// ── Webhook events ─────────────────────────────────────────────────────────────

export interface ApplyResult {
  applied: boolean;
  reason: string;
  workspaceId?: string | null;
}

async function workspaceFor(tx: Tx, hint: string | null, subscriptionId: string | null, customerId: string | null): Promise<string | null> {
  if (hint) {
    const [w] = await tx.select({ id: workspacesTable.id }).from(workspacesTable).where(eq(workspacesTable.id, hint)).limit(1);
    if (w) return w.id;
  }
  const conditions = [
    ...(subscriptionId ? [eq(workspaceSubscriptionsTable.stripeSubscriptionId, subscriptionId)] : []),
    ...(customerId ? [eq(workspaceSubscriptionsTable.stripeCustomerId, customerId)] : []),
  ];
  if (!conditions.length) return null;
  const [row] = await tx.select({ id: workspaceSubscriptionsTable.workspaceId }).from(workspaceSubscriptionsTable).where(or(...conditions)).limit(1);
  return row?.id ?? null;
}

/** True when another workspace already holds this customer or subscription: never move billing between workspaces. */
async function heldElsewhere(tx: Tx, workspaceId: string, customerId: string | null, subscriptionId: string | null): Promise<boolean> {
  const conditions = [
    ...(customerId ? [eq(workspaceSubscriptionsTable.stripeCustomerId, customerId)] : []),
    ...(subscriptionId ? [eq(workspaceSubscriptionsTable.stripeSubscriptionId, subscriptionId)] : []),
  ];
  if (!conditions.length) return false;
  const [row] = await tx.select({ id: workspaceSubscriptionsTable.workspaceId }).from(workspaceSubscriptionsTable).where(and(or(...conditions), ne(workspaceSubscriptionsTable.workspaceId, workspaceId))).limit(1);
  return !!row;
}

/**
 * Applies one verified event. Each event id is applied once (billing_events),
 * in the same transaction as its change, so a failure leaves it for Stripe to
 * redeliver. An event older than the last one applied to a workspace does not
 * overwrite newer state.
 */
export async function applyEvent(event: EventLike): Promise<ApplyResult> {
  const plans = await listPlans();
  const action = actionFor(event, plans);
  return db.transaction(async (tx) => {
    const fresh = await tx.insert(billingEventsTable).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: billingEventsTable.id });
    if (fresh.length === 0) return { applied: false, reason: "duplicate" };
    if (action.kind === "ignore") return { applied: false, reason: action.reason };

    if (action.kind === "link") {
      const workspaceId = await workspaceFor(tx, action.workspaceId, action.subscriptionId, action.customerId);
      if (!workspaceId) return { applied: false, reason: "no matching workspace" };
      if (await heldElsewhere(tx, workspaceId, action.customerId, action.subscriptionId)) return { applied: false, reason: "customer belongs to another workspace", workspaceId };
      const set = { ...(action.customerId ? { stripeCustomerId: action.customerId } : {}), ...(action.subscriptionId ? { stripeSubscriptionId: action.subscriptionId } : {}) };
      await tx.insert(workspaceSubscriptionsTable).values({ workspaceId, ...set }).onConflictDoUpdate({ target: workspaceSubscriptionsTable.workspaceId, set });
      await tx.update(billingEventsTable).set({ workspaceId }).where(eq(billingEventsTable.id, event.id));
      return { applied: true, reason: "linked", workspaceId };
    }

    if (action.kind === "purchase") {
      const workspaceId = await workspaceFor(tx, action.workspaceId, null, action.customerId);
      if (!workspaceId) return { applied: false, reason: "no matching workspace" };
      const plan = plans.find((p) => p.key === action.planKey && p.kind === "one_time");
      if (!plan) return { applied: false, reason: "not a one-time plan", workspaceId };
      await tx
        .insert(billingPurchasesTable)
        .values({ id: randomUUID(), workspaceId, planKey: plan.key, applicationId: action.applicationId, stripeSessionId: action.sessionId, amountCents: action.amountCents, currency: action.currency })
        .onConflictDoNothing();
      await tx.update(billingEventsTable).set({ workspaceId }).where(eq(billingEventsTable.id, event.id));
      return { applied: true, reason: "purchase recorded", workspaceId };
    }

    const { change } = action;
    const workspaceId = await workspaceFor(tx, action.workspaceId, change.stripeSubscriptionId, change.stripeCustomerId);
    if (!workspaceId) return { applied: false, reason: "no matching workspace" };
    if (await heldElsewhere(tx, workspaceId, change.stripeCustomerId, change.stripeSubscriptionId)) return { applied: false, reason: "customer belongs to another workspace", workspaceId };
    const [current] = await tx.select().from(workspaceSubscriptionsTable).where(eq(workspaceSubscriptionsTable.workspaceId, workspaceId)).limit(1);
    if (current?.lastEventAt && current.lastEventAt.getTime() > action.at.getTime()) return { applied: false, reason: "older than the state already recorded", workspaceId };
    // A different, older subscription ending must not cancel the one the workspace has now.
    if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== change.stripeSubscriptionId && change.status === "canceled") return { applied: false, reason: "a replaced subscription ended", workspaceId };
    if (change.planKey === UNKNOWN_PLAN) logger.warn({ workspaceId, lookupKey: change.stripePriceLookupKey }, "Stripe subscription price matches no billing plan; the workspace gets no plan limits until it does");
    const values = { ...change, lastEventAt: action.at };
    await tx.insert(workspaceSubscriptionsTable).values({ workspaceId, ...values }).onConflictDoUpdate({ target: workspaceSubscriptionsTable.workspaceId, set: values });
    await tx.update(billingEventsTable).set({ workspaceId }).where(eq(billingEventsTable.id, event.id));
    return { applied: true, reason: `subscription ${change.status}`, workspaceId };
  });
}
