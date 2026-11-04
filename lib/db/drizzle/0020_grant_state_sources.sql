-- Migration: Grant Studio state sources (docs/GRANT_STUDIO.md).
-- California Grants Portal records state a required match percentage, may
-- accept applications on a rolling basis, and belong to a state.
ALTER TABLE "grant_opportunities" ADD COLUMN IF NOT EXISTS "cost_share_percent" integer;
--> statement-breakpoint
ALTER TABLE "grant_opportunities" ADD COLUMN IF NOT EXISTS "rolling_deadline" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "grant_opportunities" ADD COLUMN IF NOT EXISTS "jurisdiction" text;
