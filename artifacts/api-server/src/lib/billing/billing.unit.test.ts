/**
 * Billing without a database: the switch, entitlements and limit messages, and
 * turning signed Stripe events into subscription changes. Events are built the
 * way Stripe's test fixtures shape them and signed with a test secret through
 * the official library (stripe.webhooks.generateTestHeaderString), then
 * verified with stripe.webhooks.constructEvent, as the webhook route does.
 */
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { billingConfig } from "./config";
import { checkLimit, nextPeriodStart, resolveEntitlement, usagePeriod, type PlanLike, type SubscriptionLike } from "./entitlements";
import { actionFor, subscriptionChange, UNKNOWN_PLAN, type PlanLookup } from "./stripeEvents";

const NOW = new Date("2026-11-05T12:00:00Z");

const plan = (over: Partial<PlanLike> = {}): PlanLike => ({
  key: "starter", name: "Starter", kind: "subscription", active: true,
  maxUsers: 2, maxOrganizations: 1, aiDraftedApplicationsPerMonth: 2, extraOrganizationPriceCents: null, ...over,
});
const agency = plan({ key: "agency", name: "Agency", maxUsers: 15, maxOrganizations: 10, aiDraftedApplicationsPerMonth: null, extraOrganizationPriceCents: 2500 });
const sub = (over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  planKey: "starter", status: "active", trialEndsAt: null, currentPeriodEnd: null, extraOrganizations: 0, stripeSubscriptionId: "sub_1", ...over,
});

describe("billing switch", () => {
  it("is off with no Stripe settings, and names only what is missing", () => {
    const c = billingConfig({});
    expect(c.enabled).toBe(false);
    expect(c.missing).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APP_BASE_URL"]);
  });
  it("is on with all settings, and BILLING_DISABLED turns it off", () => {
    const env = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", APP_BASE_URL: "https://app.example.org" };
    expect(billingConfig(env)).toMatchObject({ enabled: true, missing: [], mode: "test" });
    expect(billingConfig({ ...env, BILLING_DISABLED: "true" })).toMatchObject({ enabled: false, forcedOff: true });
    expect(billingConfig({ ...env, STRIPE_WEBHOOK_SECRET: " " }).enabled).toBe(false);
  });
});

describe("entitlements", () => {
  const base = { billingEnabled: true, workspaceKind: "client", now: NOW };

  it("changes nothing while billing is off, whatever the record says", () => {
    const e = resolveEntitlement({ ...base, billingEnabled: false, subscription: sub({ status: "canceled" }), plan: plan() });
    expect(e.mode).toBe("unlimited");
    expect(checkLimit(e, "users", 1000).allowed).toBe(true);
  });

  it("never limits the agency workspace or an agency-managed one", () => {
    expect(resolveEntitlement({ ...base, workspaceKind: "agency", subscription: null, plan: null }).mode).toBe("unlimited");
    const managed = plan({ key: "managed", name: "Agency-managed", maxUsers: null, maxOrganizations: null, aiDraftedApplicationsPerMonth: null });
    expect(resolveEntitlement({ ...base, subscription: sub({ planKey: "managed" }), plan: managed })).toMatchObject({ mode: "unlimited", reason: "managed_plan" });
  });

  it("applies the plan's limits while trialing, active or past due", () => {
    const trial = resolveEntitlement({ ...base, subscription: sub({ status: "trialing", trialEndsAt: new Date(NOW.getTime() + 13.5 * 86_400_000) }), plan: plan() });
    expect(trial).toMatchObject({ mode: "plan", reason: "trial", trialDaysLeft: 14, limits: { users: 2, organizations: 1, aiDraftedApplications: 2 } });
    expect(resolveEntitlement({ ...base, subscription: sub({ status: "past_due" }), plan: plan() }).mode).toBe("plan");
  });

  it("adds paid extra client organizations to Agency only", () => {
    expect(resolveEntitlement({ ...base, subscription: sub({ planKey: "agency", extraOrganizations: 3 }), plan: agency }).limits.organizations).toBe(13);
    expect(resolveEntitlement({ ...base, subscription: sub({ extraOrganizations: 3 }), plan: plan() }).limits.organizations).toBe(1);
  });

  it("fails closed for no plan, an unknown or inactive plan, an ended or open-ended trial, and a cancelled subscription", () => {
    const cases: [SubscriptionLike | null, PlanLike | null, string][] = [
      [null, null, "no_plan"],
      [sub({ planKey: "gold" }), null, "unknown_plan"],
      [sub({ planKey: UNKNOWN_PLAN }), null, "unknown_plan"],
      [sub(), plan({ active: false }), "unknown_plan"],
      [sub({ planKey: "expert_review" }), plan({ key: "expert_review", kind: "one_time" }), "unknown_plan"],
      [sub({ status: "trialing", trialEndsAt: new Date(NOW.getTime() - 1000) }), plan(), "trial_ended"],
      [sub({ status: "trialing", trialEndsAt: null }), plan(), "trial_ended"],
      [sub({ status: "canceled" }), plan(), "inactive"],
      [sub({ status: "unpaid" }), plan(), "inactive"],
      [sub({ status: "something_new" }), plan(), "inactive"],
    ];
    for (const [s, p, reason] of cases) {
      const e = resolveEntitlement({ ...base, subscription: s, plan: p });
      expect(e, reason).toMatchObject({ mode: "none", reason });
      const d = checkLimit(e, "organizations", 0, NOW);
      expect(d).toMatchObject({ allowed: false, code: "plan_required" });
      expect(d.message).toContain("Settings, Billing");
    }
  });

  it("allows up to the limit and explains the limit in plain language", () => {
    const e = resolveEntitlement({ ...base, subscription: sub(), plan: plan() });
    expect(checkLimit(e, "users", 1).allowed).toBe(true);
    const users = checkLimit(e, "users", 2);
    expect(users).toMatchObject({ allowed: false, code: "plan_limit_reached", limit: 2, used: 2 });
    expect(users.message).toBe("Your Starter plan includes 2 users, and this workspace already has 2 (members and open invitations). Remove someone or withdraw an invitation, or an owner can upgrade in Settings, Billing.");
    const ai = checkLimit(e, "aiDraftedApplications", 2, NOW);
    expect(ai.message).toContain("2 AI-drafted applications a month");
    expect(ai.message).toContain("resets on December 1");
    expect(ai.message).toContain("You can still write and edit sections yourself.");
    expect(checkLimit(e, "organizations", 1).message).toContain("1 organization,");
  });

  it("counts AI drafting by UTC calendar month", () => {
    expect(usagePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(nextPeriodStart(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

const PLANS: PlanLookup[] = [
  { key: "starter", kind: "subscription", stripeLookupMonthly: "starter_monthly", stripeLookupAnnual: "starter_annual", stripeLookupExtraOrganization: null, stripeLookupExtraOrganizationAnnual: null },
  { key: "agency", kind: "subscription", stripeLookupMonthly: "agency_monthly", stripeLookupAnnual: "agency_annual", stripeLookupExtraOrganization: "agency_extra_organization_monthly", stripeLookupExtraOrganizationAnnual: "agency_extra_organization_annual" },
  { key: "expert_review", kind: "one_time", stripeLookupMonthly: "expert_review", stripeLookupAnnual: null, stripeLookupExtraOrganization: null, stripeLookupExtraOrganizationAnnual: null },
];

/** A customer.subscription.* event shaped like Stripe's fixtures (stripe-mock / API reference examples). */
function subscriptionEvent(type: string, over: Record<string, unknown> = {}, items = [{ lookup: "agency_annual", quantity: 1, interval: "year" }, { lookup: "agency_extra_organization_annual", quantity: 4, interval: "year" }]) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: 1_793_900_000,
    livemode: false,
    type,
    data: {
      object: {
        id: "sub_1Test",
        object: "subscription",
        customer: "cus_Test",
        status: "active",
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { workspaceId: "ws-1", planKey: "agency" },
        items: {
          object: "list",
          data: items.map((i, n) => ({ id: `si_${n}`, object: "subscription_item", quantity: i.quantity, current_period_end: 1_825_436_000, price: { id: `price_${n}`, object: "price", lookup_key: i.lookup, recurring: { interval: i.interval } } })),
        },
        ...over,
      },
    },
  };
}

describe("Stripe events", () => {
  it("maps a subscription to plan, status, period end, trial end, seats and extra organizations", () => {
    const action = actionFor(subscriptionEvent("customer.subscription.updated", { trial_end: 1_794_000_000, status: "trialing" }), PLANS);
    expect(action.kind).toBe("subscription");
    if (action.kind !== "subscription") return;
    expect(action.workspaceId).toBe("ws-1");
    expect(action.change).toMatchObject({
      planKey: "agency", status: "trialing", billingInterval: "year", seats: 1, extraOrganizations: 4,
      stripeCustomerId: "cus_Test", stripeSubscriptionId: "sub_1Test", stripePriceLookupKey: "agency_annual",
    });
    expect(action.change.trialEndsAt?.toISOString()).toBe(new Date(1_794_000_000 * 1000).toISOString());
    expect(action.change.currentPeriodEnd?.toISOString()).toBe(new Date(1_825_436_000 * 1000).toISOString());
    expect(action.at.getTime()).toBe(1_793_900_000 * 1000);
  });

  it("marks a deleted subscription cancelled and an unknown price as an unknown plan", () => {
    const deleted = actionFor(subscriptionEvent("customer.subscription.deleted", { status: "active" }), PLANS);
    expect(deleted.kind === "subscription" && deleted.change.status).toBe("canceled");
    const unknown = subscriptionChange(subscriptionEvent("x", {}, [{ lookup: "gold_monthly", quantity: 1, interval: "month" }]).data.object as any, PLANS);
    expect(unknown).toMatchObject({ planKey: UNKNOWN_PLAN, stripePriceLookupKey: "gold_monthly", extraOrganizations: 0 });
  });

  it("links a completed subscription checkout and records a paid one-time checkout", () => {
    const link = actionFor({ id: "evt_c1", type: "checkout.session.completed", created: 1, data: { object: { id: "cs_1", object: "checkout.session", mode: "subscription", client_reference_id: "ws-1", customer: "cus_Test", subscription: "sub_1Test", payment_status: "no_payment_required" } } }, PLANS);
    expect(link).toEqual({ kind: "link", workspaceId: "ws-1", customerId: "cus_Test", subscriptionId: "sub_1Test" });
    const paid = actionFor({ id: "evt_c2", type: "checkout.session.completed", created: 1, data: { object: { id: "cs_2", mode: "payment", payment_status: "paid", amount_total: 75000, currency: "usd", metadata: { workspaceId: "ws-1", planKey: "expert_review", applicationId: "app-1" } } } }, PLANS);
    expect(paid).toMatchObject({ kind: "purchase", workspaceId: "ws-1", planKey: "expert_review", applicationId: "app-1", amountCents: 75000 });
    const unpaid = actionFor({ id: "evt_c3", type: "checkout.session.completed", created: 1, data: { object: { id: "cs_3", mode: "payment", payment_status: "unpaid", metadata: { planKey: "expert_review" } } } }, PLANS);
    expect(unpaid.kind).toBe("ignore");
  });

  it("ignores events it does not handle and rejects a workspace id that is not an id", () => {
    expect(actionFor({ id: "evt_x", type: "invoice.paid", created: 1, data: { object: {} } }, PLANS).kind).toBe("ignore");
    const bad = actionFor(subscriptionEvent("customer.subscription.updated", { metadata: { workspaceId: "ws-1'; drop table x" } }), PLANS);
    expect(bad.kind === "subscription" && bad.workspaceId).toBeNull();
  });

  it("verifies the signature with the official library and refuses a tampered or unsigned body", () => {
    const secret = "whsec_test_secret_for_unit_tests_only";
    const payload = JSON.stringify(subscriptionEvent("customer.subscription.created"));
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = Stripe.webhooks.constructEvent(Buffer.from(payload), header, secret);
    expect(event.type).toBe("customer.subscription.created");
    expect(() => Stripe.webhooks.constructEvent(Buffer.from(payload.replace("agency_annual", "starter_annual")), header, secret)).toThrow();
    expect(() => Stripe.webhooks.constructEvent(Buffer.from(payload), header, "whsec_other")).toThrow();
    const stale = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => Stripe.webhooks.constructEvent(Buffer.from(payload), stale, secret)).toThrow();
  });
});
