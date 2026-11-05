import { pgTable, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

/**
 * Billing: plans, each workspace's subscription, monthly usage and processed
 * Stripe events (docs/BILLING.md).
 *
 * Plans are configuration data, not code: prices, limits and the Stripe price
 * lookup keys live in `billing_plans`, so they can change without a release.
 * Billing is off unless the owner configures Stripe (see the API's
 * lib/billing/config.ts); while it is off none of these limits apply.
 */
export const billingPlansTable = pgTable("billing_plans", {
  /** "starter", "pro", "agency", "expert_review", "managed". */
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** "subscription" (a plan a workspace is on) or "one_time" (a single charge, such as expert review). */
  kind: text("kind").notNull().default("subscription"),
  /** Shown prices in US cents. Null when the plan is not sold (the agency-managed plan). */
  monthlyPriceCents: integer("monthly_price_cents"),
  annualPriceCents: integer("annual_price_cents"),
  /** Price of a one-time purchase (expert review). */
  oneTimePriceCents: integer("one_time_price_cents"),
  /** Stripe Price lookup keys the owner sets on the prices in Stripe. Checkout finds the price by them. */
  stripeLookupMonthly: text("stripe_lookup_monthly"),
  stripeLookupAnnual: text("stripe_lookup_annual"),
  /** Limits. Null means no limit. */
  maxUsers: integer("max_users"),
  maxOrganizations: integer("max_organizations"),
  aiDraftedApplicationsPerMonth: integer("ai_drafted_applications_per_month"),
  /** Price of one organization above `maxOrganizations` (Agency), and the lookup key of that add-on price. */
  extraOrganizationPriceCents: integer("extra_organization_price_cents"),
  stripeLookupExtraOrganization: text("stripe_lookup_extra_organization"),
  stripeLookupExtraOrganizationAnnual: text("stripe_lookup_extra_organization_annual"),
  /** Plain-language feature list for the Billing page. */
  features: jsonb("features").$type<string[]>().notNull().default([]),
  trialDays: integer("trial_days").notNull().default(0),
  /** Can be bought through Checkout. False for the agency-managed plan. */
  purchasable: boolean("purchasable").notNull().default(true),
  /** False while the owner has not published the prices; the Billing page says they are proposals. */
  pricesPublished: boolean("prices_published").notNull().default(false),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** One per workspace: which plan it is on and where that stands. Kept in step with Stripe by the webhook. */
export const workspaceSubscriptionsTable = pgTable("workspace_subscriptions", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspacesTable.id, { onDelete: "cascade" }),
  /** A billing_plans key. A key that is not a known, active plan grants nothing (fail closed). */
  planKey: text("plan_key"),
  /** "trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused", or "none". */
  status: text("status").notNull().default("none"),
  /** "month" or "year" for a paid plan. */
  billingInterval: text("billing_interval"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Quantity of the base plan item in Stripe (normally 1). */
  seats: integer("seats").notNull().default(1),
  /** Organizations bought above the plan's included number (Agency add-on quantity). */
  extraOrganizations: integer("extra_organizations").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** The lookup key of the base price Stripe last reported, kept even when it matches no plan. */
  stripePriceLookupKey: text("stripe_price_lookup_key"),
  /** `created` of the newest Stripe event applied, so an older event delivered late cannot undo a newer one. */
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("uq_workspace_subscriptions_customer").on(table.stripeCustomerId),
  uniqueIndex("uq_workspace_subscriptions_subscription").on(table.stripeSubscriptionId),
]);

/** Metered usage, one row per counted thing per month (for example one application drafted with AI). */
export const billingUsageTable = pgTable("billing_usage", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  /** UTC calendar month, "YYYY-MM". */
  period: text("period").notNull(),
  /** "ai_drafted_application". */
  metric: text("metric").notNull(),
  /** What was counted (the application id), so drafting the same application again in a month counts once. */
  ref: text("ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_billing_usage").on(table.workspaceId, table.period, table.metric, table.ref),
  index("idx_billing_usage_period").on(table.workspaceId, table.period, table.metric),
]);

/** One-time purchases (expert review), recorded when Stripe reports the Checkout Session paid. */
export const billingPurchasesTable = pgTable("billing_purchases", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  planKey: text("plan_key").notNull(),
  /** The Grant Studio application it is for, when there is one. */
  applicationId: text("application_id"),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  amountCents: integer("amount_cents"),
  currency: text("currency"),
  status: text("status").notNull().default("paid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_billing_purchases_workspace").on(table.workspaceId)]);

/** Stripe event ids already processed, so a redelivered event is applied once. */
export const billingEventsTable = pgTable("billing_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  workspaceId: text("workspace_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingPlan = typeof billingPlansTable.$inferSelect;
export type WorkspaceSubscription = typeof workspaceSubscriptionsTable.$inferSelect;
export type BillingPurchase = typeof billingPurchasesTable.$inferSelect;
