-- ============================================================
-- Migration: Content Distribution Engine — destinations, scheduled
-- publications, attempt history.
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "publishing_destinations" (
  "id" text PRIMARY KEY,
  "brand_id" text NOT NULL,
  "provider" text NOT NULL,
  "platform" text NOT NULL,
  "label" text NOT NULL,
  "external_account_id" text,
  "config" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "scheduled_publications" (
  "id" text PRIMARY KEY,
  "brand_id" text NOT NULL,
  "project_id" text NOT NULL,
  "destination_id" text NOT NULL,
  "source_type" text NOT NULL,
  "document_id" text,
  "repurposed_asset_id" text,
  "title" text,
  "content" text NOT NULL,
  "scheduled_for" timestamptz NOT NULL,
  "next_attempt_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_attempt_at" timestamptz,
  "last_error" text,
  "external_post_id" text,
  "external_url" text,
  "published_at" timestamptz,
  "provider_payload" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "publication_attempts" (
  "id" text PRIMARY KEY,
  "scheduled_publication_id" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "outcome" text NOT NULL,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='publishing_destinations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='publishing_destinations_brand_id_brands_id_fk') THEN
    ALTER TABLE "publishing_destinations" ADD CONSTRAINT "publishing_destinations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scheduled_publications_brand_id_brands_id_fk') THEN
    ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='projects')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scheduled_publications_project_id_projects_id_fk') THEN
    ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='publishing_destinations')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scheduled_publications_destination_id_publishing_destinations_id_fk') THEN
    ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_destination_id_publishing_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."publishing_destinations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='documents')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scheduled_publications_document_id_documents_id_fk') THEN
    ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposed_assets')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scheduled_publications_repurposed_asset_id_repurposed_assets_id_fk') THEN
    ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_repurposed_asset_id_repurposed_assets_id_fk" FOREIGN KEY ("repurposed_asset_id") REFERENCES "public"."repurposed_assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='publication_attempts')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='publication_attempts_scheduled_publication_id_scheduled_publications_id_fk') THEN
    ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_scheduled_publication_id_scheduled_publications_id_fk" FOREIGN KEY ("scheduled_publication_id") REFERENCES "public"."scheduled_publications"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "publishing_destinations_brand_id_idx" ON "publishing_destinations"("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_publications_brand_id_idx" ON "scheduled_publications"("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_publications_project_id_idx" ON "scheduled_publications"("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_publications_destination_id_idx" ON "scheduled_publications"("destination_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_publications_status_next_attempt_idx" ON "scheduled_publications"("status", "next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publication_attempts_publication_id_idx" ON "publication_attempts"("scheduled_publication_id");
