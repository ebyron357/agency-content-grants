-- Migration: Grant Studio writing toolkit (docs/GRANT_STUDIO.md, Writing toolkit).
-- Each application's format profile and logic model, and its letters of support.
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "format_profile" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "logic_model" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_support_letters" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "grant_applications"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "organization" text,
  "purpose" text,
  "email" text,
  "status" text DEFAULT 'to_request' NOT NULL,
  "requested_on" text,
  "due_on" text,
  "received_on" text,
  "requirement_id" text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_letters_app" ON "grant_support_letters" ("application_id");
