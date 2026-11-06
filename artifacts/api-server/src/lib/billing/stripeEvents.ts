/**
 * Turning verified Stripe webhook events into changes to a workspace's
 * subscription record (docs/BILLING.md). Follows the event set used by
 * Stripe's official samples (stripe-samples/subscription-use-cases and
 * checkout-single-subscription, MIT): checkout.session.completed and the
 * customer.subscription.* lifecycle events.
 *
 * Pure: plain objects in, plain objects out. Signature verification happens
 * before this (lib/billing/service.ts, with the official `stripe` package), and
 * the database write after it. Structural types keep it independent of the
 * Stripe API version's TypeScript types.
 */

export interface PlanLookup {
  key: string;
  kind: string;
  stripeLookupMonthly: string | null;
  stripeLookupAnnual: string | null;
  stripeLookupExtraOrganization: string | null;
  stripeLookupExtraOrganizationAnnual: string | null;
}

interface PriceLike {
  id?: string;
  lookup_key?: string | null;
  recurring?: { interval?: string | null } | null;
}

interface ItemLike {
  price?: PriceLike | null;
  quantity?: number | null;
  current_period_end?: number | null;
}

export interface SubscriptionObjectLike {
  id: string;
  object?: string;
  customer: string | { id: string } | null;
  status: string;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  /** Older API versions carry the period end on the subscription; newer ones on each item. */
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: ItemLike[] | null } | null;
}

export interface CheckoutSessionLike {
  id: string;
  object?: string;
  mode: string;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export interface EventLike {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

export interface SubscriptionChange {
  planKey: string;
  status: string;
  billingInterval: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
  extraOrganizations: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceLookupKey: string | null;
}

/** Recorded when a lookup key matches no plan. The entitlement layer grants nothing for it. */
export const UNKNOWN_PLAN = "unknown";

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : v?.id ?? null);
const date = (s: number | null | undefined): Date | null => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);

/** The workspace an object belongs to, from what our Checkout Session put on it. */
export function workspaceIdOf(obj: { metadata?: Record<string, string> | null; client_reference_id?: string | null }): string | null {
  const id = obj.metadata?.workspaceId || obj.client_reference_id || null;
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/** The subscription record as a Stripe Subscription describes it. */
export function subscriptionChange(sub: SubscriptionObjectLike, plans: readonly PlanLookup[]): SubscriptionChange {
  const items = sub.items?.data ?? [];
  let base: { plan: PlanLookup; item: ItemLike } | null = null;
  let extraOrganizations = 0;
  let firstLookup: string | null = null;
  for (const item of items) {
    const lookup = item.price?.lookup_key ?? null;
    if (lookup && !firstLookup) firstLookup = lookup;
    if (!lookup) continue;
    const extraFor = plans.find((p) => p.stripeLookupExtraOrganization === lookup || p.stripeLookupExtraOrganizationAnnual === lookup);
    if (extraFor) {
      extraOrganizations += Math.max(0, item.quantity ?? 0);
      continue;
    }
    const plan = plans.find((p) => p.kind === "subscription" && (p.stripeLookupMonthly === lookup || p.stripeLookupAnnual === lookup));
    if (plan && !base) base = { plan, item };
  }
  const periodEnd = base?.item.current_period_end ?? sub.current_period_end ?? items.find((i) => i.current_period_end)?.current_period_end ?? null;
  return {
    planKey: base?.plan.key ?? UNKNOWN_PLAN,
    status: sub.status,
    billingInterval: base?.item.price?.recurring?.interval ?? null,
    trialEndsAt: date(sub.trial_end),
    currentPeriodEnd: date(periodEnd),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    seats: Math.max(1, base?.item.quantity ?? 1),
    extraOrganizations: base?.plan && extraOrganizations > 0 ? extraOrganizations : 0,
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    stripePriceLookupKey: base?.item.price?.lookup_key ?? firstLookup,
  };
}

export type BillingAction =
  | { kind: "ignore"; reason: string }
  | { kind: "link"; workspaceId: string | null; customerId: string | null; subscriptionId: string | null }
  | { kind: "purchase"; workspaceId: string | null; sessionId: string; planKey: string; applicationId: string | null; amountCents: number | null; currency: string | null; customerId: string | null }
  | { kind: "subscription"; workspaceId: string | null; change: SubscriptionChange; at: Date };

/** The subscription events we act on. Others are acknowledged and ignored. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
] as const;

/** What a verified event asks us to do. */
export function actionFor(event: EventLike, plans: readonly PlanLookup[]): BillingAction {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { kind: "ignore", reason: `unhandled event type ${event.type}` };
  if (event.type.startsWith("checkout.session.")) {
    const s = event.data.object as CheckoutSessionLike;
    const workspaceId = workspaceIdOf(s);
    if (s.mode === "subscription") return { kind: "link", workspaceId, customerId: idOf(s.customer), subscriptionId: idOf(s.subscription) };
    if (s.mode === "payment") {
      if (s.payment_status !== "paid") return { kind: "ignore", reason: "payment not completed yet" };
      const planKey = s.metadata?.planKey;
      if (!planKey) return { kind: "ignore", reason: "payment without a plan key" };
      return { kind: "purchase", workspaceId, sessionId: s.id, planKey, applicationId: s.metadata?.applicationId || null, amountCents: s.amount_total ?? null, currency: s.currency ?? null, customerId: idOf(s.customer) };
    }
    return { kind: "ignore", reason: `checkout mode ${s.mode}` };
  }
  const sub = event.data.object as SubscriptionObjectLike;
  const change = subscriptionChange(sub, plans);
  if (event.type === "customer.subscription.deleted") change.status = "canceled";
  return { kind: "subscription", workspaceId: workspaceIdOf(sub), change, at: new Date(event.created * 1000) };
}
