-- ============================================================
-- Migration: Repurposing Engine — batches, derivative assets, revisions
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "repurposing_batches" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "document_id" text NOT NULL,
  "document_section_id" text,
  "campaign_name" text,
  "channels" jsonb NOT NULL,
  "tone" text,
  "audience" text,
  "cta" text,
  "target_length" text,
  "additional_instructions" text,
  "status" text NOT NULL DEFAULT 'processing',
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repurposed_assets" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "batch_id" text NOT NULL,
  "document_id" text NOT NULL,
  "document_section_id" text,
  "channel" text NOT NULL,
  "title" text,
  "content" text NOT NULL DEFAULT '',
  "tone" text,
  "audience" text,
  "cta" text,
  "target_length" text,
  "status" text NOT NULL DEFAULT 'draft',
  "is_approved" boolean NOT NULL DEFAULT false,
  "version_number" integer NOT NULL DEFAULT 1,
  "brand_check_score" real,
  "brand_check_passed" boolean,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repurposed_asset_revisions" (
  "id" text PRIMARY KEY,
  "repurposed_asset_id" text NOT NULL,
  "content" text NOT NULL,
  "version_number" integer NOT NULL DEFAULT 1,
  "was_approved" boolean NOT NULL DEFAULT false,
  "edit_type" text NOT NULL DEFAULT 'regenerate',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposing_batches')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='projects')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposing_batches_project_id_projects_id_fk') THEN
    ALTER TABLE "repurposing_batches" ADD CONSTRAINT "repurposing_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposing_batches')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='documents')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposing_batches_document_id_documents_id_fk') THEN
    ALTER TABLE "repurposing_batches" ADD CONSTRAINT "repurposing_batches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposing_batches')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='document_sections')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposing_batches_document_section_id_document_sections_id_fk') THEN
    ALTER TABLE "repurposing_batches" ADD CONSTRAINT "repurposing_batches_document_section_id_document_sections_id_fk" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='projects')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposed_assets_project_id_projects_id_fk') THEN
    ALTER TABLE "repurposed_assets" ADD CONSTRAINT "repurposed_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposing_batches')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposed_assets_batch_id_repurposing_batches_id_fk') THEN
    ALTER TABLE "repurposed_assets" ADD CONSTRAINT "repurposed_assets_batch_id_repurposing_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."repurposing_batches"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='documents')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposed_assets_document_id_documents_id_fk') THEN
    ALTER TABLE "repurposed_assets" ADD CONSTRAINT "repurposed_assets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='document_sections')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposed_assets_document_section_id_document_sections_id_fk') THEN
    ALTER TABLE "repurposed_assets" ADD CONSTRAINT "repurposed_assets_document_section_id_document_sections_id_fk" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_asset_revisions')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposed_asset_revisions_repurposed_asset_id_repurposed_assets_id_fk') THEN
    ALTER TABLE "repurposed_asset_revisions" ADD CONSTRAINT "repurposed_asset_revisions_repurposed_asset_id_repurposed_assets_id_fk" FOREIGN KEY ("repurposed_asset_id") REFERENCES "public"."repurposed_assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "repurposing_batches_project_id_idx" ON "repurposing_batches"("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repurposed_assets_project_id_idx" ON "repurposed_assets"("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repurposed_assets_batch_id_idx" ON "repurposed_assets"("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repurposed_asset_revisions_asset_id_idx" ON "repurposed_asset_revisions"("repurposed_asset_id");
