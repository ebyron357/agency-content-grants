-- Migration: Grant Studio place designations (docs/GRANT_STUDIO.md, Place designations).
-- The organization's location and the designations a person checked on each agency's tool.
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "principal_address" text;
--> statement-breakpoint
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "census_tract" text;
--> statement-breakpoint
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "county_fips" text;
--> statement-breakpoint
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "place_designations" jsonb DEFAULT '{}'::jsonb NOT NULL;
