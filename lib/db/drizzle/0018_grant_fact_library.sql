-- Migration: Grant Studio fact library (docs/GRANT_STUDIO.md).
-- Reusable, sourced organization facts; only confirmed facts reach AI drafting.
CREATE TABLE IF NOT EXISTS "grant_facts" (
  "id" text PRIMARY KEY NOT NULL,
  "applicant_id" text NOT NULL REFERENCES "grant_applicants"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "label" text NOT NULL,
  "body" text NOT NULL,
  "source" text,
  "as_of" text,
  "confirmed_by" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_facts_applicant" ON "grant_facts" ("applicant_id");
