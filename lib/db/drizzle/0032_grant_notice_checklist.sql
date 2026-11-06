-- Migration: Grant Studio notice checklist (docs/GRANT_STUDIO.md, Notice PDF and requirement checklist).
-- The funding notice PDF attached to an application, its text page by page, and
-- page citations on the compliance-matrix rows proposed from it. A proposed row
-- stays unconfirmed until a person confirms it; a rejected row is kept, with
-- who rejected it, and leaves the matrix.
CREATE TABLE IF NOT EXISTS "grant_notices" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "grant_applications"("id") ON DELETE CASCADE,
  "origin" text NOT NULL,
  "source_url" text,
  "file_name" text NOT NULL,
  "file_key" text,
  "file_bytes" integer DEFAULT 0 NOT NULL,
  "sha256" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "extractor" text,
  "extractor_note" text,
  "page_count" integer,
  "pages_read" integer DEFAULT 0 NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "checklist_provider" text,
  "checklist_demo" boolean DEFAULT false NOT NULL,
  "proposed" integer DEFAULT 0 NOT NULL,
  "dropped" integer DEFAULT 0 NOT NULL,
  "error" text,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grant_notice_app" ON "grant_notices" ("application_id");
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "notice_id" text REFERENCES "grant_notices"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "page" integer;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "quote" text;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "extracted_by" text;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "rejected_by" text;
--> statement-breakpoint
ALTER TABLE "grant_requirements" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_requirements_notice" ON "grant_requirements" ("notice_id");
