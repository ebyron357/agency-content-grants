/**
 * Plan entitlements (docs/BILLING.md): what a workspace may use, decided from
 * whether billing is on, the workspace kind, its subscription and its plan.
 *
 * Rules:
 * - Billing OFF: everything is unlimited, exactly as before billing existed.
 * - The agency workspace (the operator's own, used by the team password) is
 *   never limited, and neither is a workspace on the agency-managed plan.
 * - A subscription grants its plan's limits only while it is trialing (and the
 *   trial has not ended), active or past due (Stripe's retry window).
 * - Anything else, including a plan key that is unknown or inactive, grants
 *   nothing: limited actions are refused until an owner chooses a plan (fail closed).
 *   Reading and editing existing work is never blocked here.
 *
 * Pure module: no database import, so it is unit tested directly.
 */

export type Metric = "users" | "organizations" | "aiDraftedApplications";

export interface PlanLike {
  key: string;
  name: string;
  kind: string;
  active: boolean;
  maxUsers: number | null;
  maxOrganizations: number | null;
  aiDraftedApplicationsPerMonth: number | null;
  extraOrganizationPriceCents: number | null;
}

export interface SubscriptionLike {
  planKey: string | null;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  extraOrganizations: number;
  stripeSubscriptionId: string | null;
}

export interface Limits {
  users: number | null;
  organizations: number | null;
  aiDraftedApplications: number | null;
}

export type EntitlementMode = "unlimited" | "plan" | "none";

export interface Entitlement {
  mode: EntitlementMode;
  /** Why: "billing_off", "agency_workspace", "managed_plan", "trial", "active", "past_due", "trial_ended", "no_plan", "unknown_plan", "inactive" (status). */
  reason: string;
  plan: PlanLike | null;
  limits: Limits;
  /** Whole days left in the trial (rounded up), or null when not trialing. */
  trialDaysLeft: number | null;
}

const UNLIMITED: Limits = { users: null, organizations: null, aiDraftedApplications: null };
const NOTHING: Limits = { users: 0, organizations: 0, aiDraftedApplications: 0 };

/** Statuses during which the plan's limits apply. */
export const GRANTING_STATUSES = ["trialing", "active", "past_due"] as const;

export const MANAGED_PLAN = "managed";

const DAY_MS = 86_400_000;

export function resolveEntitlement(input: {
  billingEnabled: boolean;
  workspaceKind: string | null;
  subscription: SubscriptionLike | null;
  plan: PlanLike | null;
  now?: Date;
}): Entitlement {
  const now = input.now ?? new Date();
  if (!input.billingEnabled) return { mode: "unlimited", reason: "billing_off", plan: input.plan, limits: UNLIMITED, trialDaysLeft: null };
  if (input.workspaceKind === "agency") return { mode: "unlimited", reason: "agency_workspace", plan: input.plan, limits: UNLIMITED, trialDaysLeft: null };
  const sub = input.subscription;
  if (!sub || !sub.planKey || sub.status === "none") return { mode: "none", reason: "no_plan", plan: null, limits: NOTHING, trialDaysLeft: null };
  const plan = input.plan && input.plan.key === sub.planKey && input.plan.active && input.plan.kind === "subscription" ? input.plan : null;
  if (!plan) return { mode: "none", reason: "unknown_plan", plan: null, limits: NOTHING, trialDaysLeft: null };
  if (plan.key === MANAGED_PLAN) return { mode: "unlimited", reason: "managed_plan", plan, limits: UNLIMITED, trialDaysLeft: null };
  if (!(GRANTING_STATUSES as readonly string[]).includes(sub.status)) return { mode: "none", reason: "inactive", plan, limits: NOTHING, trialDaysLeft: null };
  let trialDaysLeft: number | null = null;
  if (sub.status === "trialing") {
    // A trial with no end date grants nothing: fail closed rather than an endless trial.
    if (!sub.trialEndsAt || sub.trialEndsAt.getTime() <= now.getTime()) return { mode: "none", reason: "trial_ended", plan, limits: NOTHING, trialDaysLeft: 0 };
    trialDaysLeft = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS);
  }
  const extra = Math.max(0, Math.floor(sub.extraOrganizations || 0));
  return {
    mode: "plan",
    reason: sub.status === "trialing" ? "trial" : sub.status,
    plan,
    limits: {
      users: plan.maxUsers,
      organizations: plan.maxOrganizations === null ? null : plan.maxOrganizations + (plan.extraOrganizationPriceCents !== null ? extra : 0),
      aiDraftedApplications: plan.aiDraftedApplicationsPerMonth,
    },
    trialDaysLeft,
  };
}

export interface LimitDecision {
  allowed: boolean;
  /** "plan_required" when there is no usable plan, "plan_limit_reached" at the limit. */
  code?: "plan_required" | "plan_limit_reached";
  message?: string;
  limit: number | null;
  used: number;
}

const NOUN: Record<Metric, [string, string]> = {
  users: ["user", "users"],
  organizations: ["organization", "organizations"],
  aiDraftedApplications: ["AI-drafted application a month", "AI-drafted applications a month"],
};

function plural(n: number, metric: Metric): string {
  const [one, many] = NOUN[metric];
  return `${n} ${n === 1 ? one : many}`;
}

/** The first day of next month, for the AI-drafting reset date. */
export function nextPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** The usage period for monthly limits: the UTC calendar month, "YYYY-MM". */
export function usagePeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Whether one more of `metric` may be added, given `used` already counted.
 * Messages are plain language and say what to do next.
 */
export function checkLimit(ent: Entitlement, metric: Metric, used: number, now: Date = new Date()): LimitDecision {
  if (ent.mode === "unlimited") return { allowed: true, limit: null, used };
  if (ent.mode === "none") {
    const why =
      ent.reason === "trial_ended" ? "This workspace's free trial has ended." :
      ent.reason === "inactive" ? "This workspace's subscription is not active." :
      ent.reason === "unknown_plan" ? "This workspace's plan is not one we recognize, so nothing new can be added until it is fixed." :
      "This workspace does not have a plan yet.";
    return { allowed: false, code: "plan_required", limit: 0, used, message: `${why} An owner can start a free trial or choose a plan in Settings, Billing. Everything you have already made stays available.` };
  }
  const limit = ent.limits[metric];
  if (limit === null || used < limit) return { allowed: true, limit, used };
  const planName = ent.plan?.name ?? "current";
  const base = `Your ${planName} plan includes ${plural(limit, metric)}`;
  const message =
    metric === "users"
      ? `${base}, and this workspace already has ${used} (members and open invitations). Remove someone or withdraw an invitation, or an owner can upgrade in Settings, Billing.`
      : metric === "organizations"
        ? `${base}, and this workspace already has ${used}. ${ent.plan?.extraOrganizationPriceCents != null ? "An owner can add organizations" : "An owner can upgrade"} in Settings, Billing.`
        : `${base}, and ${used} ${used === 1 ? "has" : "have"} been used this month. You can still write and edit sections yourself. AI drafting for new applications resets on ${nextPeriodStart(now).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}, or an owner can upgrade in Settings, Billing.`;
  return { allowed: false, code: "plan_limit_reached", limit, used, message };
}
