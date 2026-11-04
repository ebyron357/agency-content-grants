-- Migration: Grant Studio saved writing (docs/GRANT_STUDIO.md).
-- Approved section text kept per organization for reuse in later applications.
CREATE TABLE IF NOT EXISTS "grant_snippets" (
  "id" text PRIMARY KEY NOT NULL,
  "applicant_id" text NOT NULL REFERENCES "grant_applicants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "section_key" text NOT NULL,
  "content" text NOT NULL,
  "source_application_id" text,
  "source_label" text,
  "saved_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_snippets_applicant" ON "grant_snippets" ("applicant_id");
