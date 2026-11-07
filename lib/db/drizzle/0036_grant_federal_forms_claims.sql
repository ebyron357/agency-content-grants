-- Migration: federal forms in the package and the unsupported-claim check (docs/GRANT_STUDIO.md).
-- grant_federal_forms keeps only what a person entered in SF-424, SF-424A, SF-424B
-- and SF-LLL (prefilled values are recomputed on read), SF-LLL's "not applicable"
-- record and each form's review. grant_claim_flags keeps every claim the check
-- flagged and how a person resolved it. Both belong to an application and are
-- deleted with it.
CREATE TABLE IF NOT EXISTS "grant_federal_forms" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "grant_applications"("id") ON DELETE CASCADE,
  "form_key" text NOT NULL,
  "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "not_applicable" boolean DEFAULT false NOT NULL,
  "not_applicable_reason" text,
  "not_applicable_by" text,
  "not_applicable_at" timestamp with time zone,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_hash" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grant_federal_form" ON "grant_federal_forms" ("application_id", "form_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_claim_flags" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "grant_applications"("id") ON DELETE CASCADE,
  "section_id" text NOT NULL REFERENCES "grant_sections"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "claim" text NOT NULL,
  "sentence" text NOT NULL,
  "reason" text NOT NULL,
  "fingerprint" text NOT NULL,
  "detected_by" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolution" text,
  "fact_id" text REFERENCES "grant_facts"("id") ON DELETE SET NULL,
  "dismiss_reason" text,
  "resolved_by" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grant_claim_flag" ON "grant_claim_flags" ("section_id", "detected_by", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_claim_flags_app" ON "grant_claim_flags" ("application_id");
--> statement-breakpoint
ALTER TABLE "grant_sections" ADD COLUMN IF NOT EXISTS "claims_checked_hash" text;
--> statement-breakpoint
ALTER TABLE "grant_sections" ADD COLUMN IF NOT EXISTS "claims_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "grant_sections" ADD COLUMN IF NOT EXISTS "claims_ai_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "grant_sections" ADD COLUMN IF NOT EXISTS "claims_ai_provider" text;
--> statement-breakpoint
ALTER TABLE "grant_sections" ADD COLUMN IF NOT EXISTS "claims_ai_hash" text;
