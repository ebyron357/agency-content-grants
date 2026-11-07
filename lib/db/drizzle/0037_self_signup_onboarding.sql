-- Migration: self sign-up and onboarding (docs/SELF_SIGNUP.md).
-- Changes no behaviour on its own: self sign-up stays off unless SELF_SIGNUP_ENABLED=true,
-- APP_BASE_URL and an email provider are configured. Existing workspaces get created_via = 'operator'.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "created_via" text DEFAULT 'operator' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "onboarding_dismissed_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_signups" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "organization_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_signups_email" ON "pending_signups" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nonprofit_lookups" (
  "ein" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "data" jsonb,
  "source" text DEFAULT 'propublica_nonprofit_explorer_v2' NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL
);
