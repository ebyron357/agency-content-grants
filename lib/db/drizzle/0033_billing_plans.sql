-- Migration: billing plans, workspace subscriptions and usage (docs/BILLING.md).
-- Plans are data, so prices and limits change with an UPDATE, not a release.
-- The prices below are the owner's PROPOSALS from the 5 November 2026 plan; they are
-- not published (prices_published = false) until the owner decides.
-- Nothing here limits anyone: limits apply only when billing is configured (STRIPE_SECRET_KEY
-- and STRIPE_WEBHOOK_SECRET), and the agency workspace is never limited.
CREATE TABLE IF NOT EXISTS "billing_plans" (
  "key" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "kind" text DEFAULT 'subscription' NOT NULL,
  "monthly_price_cents" integer,
  "annual_price_cents" integer,
  "one_time_price_cents" integer,
  "stripe_lookup_monthly" text,
  "stripe_lookup_annual" text,
  "max_users" integer,
  "max_organizations" integer,
  "ai_drafted_applications_per_month" integer,
  "extra_organization_price_cents" integer,
  "stripe_lookup_extra_organization" text,
  "stripe_lookup_extra_organization_annual" text,
  "features" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "trial_days" integer DEFAULT 0 NOT NULL,
  "purchasable" boolean DEFAULT true NOT NULL,
  "prices_published" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_subscriptions" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_key" text,
  "status" text DEFAULT 'none' NOT NULL,
  "billing_interval" text,
  "trial_ends_at" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "seats" integer DEFAULT 1 NOT NULL,
  "extra_organizations" integer DEFAULT 0 NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_price_lookup_key" text,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspace_subscriptions_customer" ON "workspace_subscriptions" ("stripe_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspace_subscriptions_subscription" ON "workspace_subscriptions" ("stripe_subscription_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period" text NOT NULL,
  "metric" text NOT NULL,
  "ref" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_usage" ON "billing_usage" ("workspace_id", "period", "metric", "ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_usage_period" ON "billing_usage" ("workspace_id", "period", "metric");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_purchases" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_key" text NOT NULL,
  "application_id" text,
  "stripe_session_id" text NOT NULL UNIQUE,
  "amount_cents" integer,
  "currency" text,
  "status" text DEFAULT 'paid' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_purchases_workspace" ON "billing_purchases" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "workspace_id" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Proposed plans. Annual = 10 x monthly ("two months free"). 14-day trial without a card.
INSERT INTO "billing_plans" ("key", "name", "description", "kind", "monthly_price_cents", "annual_price_cents", "one_time_price_cents", "stripe_lookup_monthly", "stripe_lookup_annual", "max_users", "max_organizations", "ai_drafted_applications_per_month", "extra_organization_price_cents", "stripe_lookup_extra_organization", "stripe_lookup_extra_organization_annual", "features", "trial_days", "purchasable", "prices_published", "position")
VALUES
  ('starter', 'Starter', 'For a small nonprofit or business with one writer.', 'subscription', 4900, 49000, NULL, 'starter_monthly', 'starter_annual', 2, 1, 2, NULL, NULL, NULL,
   '["1 organization", "2 users", "All matching and deadline alerts", "2 AI-drafted applications a month"]'::jsonb, 14, true, false, 1),
  ('pro', 'Pro', 'For a nonprofit with a grants team.', 'subscription', 14900, 149000, NULL, 'pro_monthly', 'pro_annual', 5, 1, 10, NULL, NULL, NULL,
   '["5 users", "Foundation open calls", "10 AI-drafted applications a month", "Approvals and submission packages", "After-award tracking"]'::jsonb, 14, true, false, 2),
  ('agency', 'Agency', 'For grant writers and consultants serving several organizations.', 'subscription', 39900, 399000, NULL, 'agency_monthly', 'agency_annual', 15, 10, NULL, 2500, 'agency_extra_organization_monthly', 'agency_extra_organization_annual',
   '["Up to 10 client organizations", "15 users", "Every Pro feature", "$25 a month for each extra client organization"]'::jsonb, 14, true, false, 3),
  ('expert_review', 'Expert review', 'A vetted grant writer reviews one AI-drafted application before you submit it.', 'one_time', NULL, NULL, 75000, 'expert_review', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   '["One application", "Human review before submission"]'::jsonb, 0, true, false, 4),
  ('managed', 'Agency-managed', 'Run by the agency operator. No limits and no charge.', 'subscription', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   '["No limits"]'::jsonb, 0, false, true, 0)
ON CONFLICT ("key") DO NOTHING;
