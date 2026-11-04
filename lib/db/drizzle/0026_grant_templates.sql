-- Migration: workspace application templates (docs/GRANT_STUDIO.md). Additive.
CREATE TABLE IF NOT EXISTS "grant_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "description" text,
  "based_on" text,
  "applies_to" jsonb NOT NULL,
  "sections" jsonb NOT NULL,
  "requirements" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_templates_user" ON "grant_templates" ("user_id");
