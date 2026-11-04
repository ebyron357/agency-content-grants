-- Migration: Grant Studio match alerts (docs/GRANT_STUDIO.md).
-- Tracks when an organization's matches were last seen and last alerted, so
-- opportunities first stored after that time count as new.
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "matches_seen_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "grant_applicants" ADD COLUMN IF NOT EXISTS "alerted_at" timestamp with time zone;
