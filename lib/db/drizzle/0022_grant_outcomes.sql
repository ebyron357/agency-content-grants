-- Migration: Grant Studio outcomes (docs/GRANT_STUDIO.md).
-- A person's record of submission and decision for each application.
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "outcome" text;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "outcome_date" text;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "submitted_on" text;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "tracking_number" text;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "submitted_amount" double precision;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "awarded_amount" double precision;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "outcome_note" text;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "outcome_recorded_by" text;
