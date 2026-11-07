-- Migration: foundation "accepts applications" flag and USAspending past-award cache (docs/GRANT_STUDIO.md). Additive.
-- Form 990-PF Part XIV line 2 per funder, read from the filing's e-file XML; null means unknown.
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_policy" text;
--> statement-breakpoint
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_policy_object_id" text;
--> statement-breakpoint
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_policy_tax_year" integer;
--> statement-breakpoint
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_policy_tax_period_end" text;
--> statement-breakpoint
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_info" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "foundation_funders" ADD COLUMN IF NOT EXISTS "application_policy_checked_at" timestamp with time zone;
--> statement-breakpoint
-- Past federal awards per Assistance Listing, cached from api.usaspending.gov (at most 100 recent awards per listing).
CREATE TABLE IF NOT EXISTS "usaspending_award_cache" (
  "program_number" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "fetched_at" timestamp with time zone,
  "attempted_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "period_start" text,
  "period_end" text,
  "total_awards" integer,
  "awards" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
