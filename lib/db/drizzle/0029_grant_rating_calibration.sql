-- Migration: Grant Studio competitiveness rating (docs/GRANT_STUDIO.md, Competitiveness rating).
-- The rating frozen when a submission is recorded, so award rates can be measured by band.
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "rating_at_submission" integer;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "rating_band_at_submission" text;
