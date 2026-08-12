-- ============================================================
-- Migration: Brand Brain — structured brand knowledge entries
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "brand_knowledge_entries" (
  "id" text PRIMARY KEY,
  "brand_id" text NOT NULL,
  "category" text NOT NULL,
  "label" text NOT NULL,
  "content" text NOT NULL,
  "structured" jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "provenance" text NOT NULL DEFAULT 'manual',
  "source_url" text,
  "imported_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brand_knowledge_entries')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brand_knowledge_entries_brand_id_brands_id_fk') THEN
    ALTER TABLE "brand_knowledge_entries" ADD CONSTRAINT "brand_knowledge_entries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "brand_knowledge_entries_brand_id_idx" ON "brand_knowledge_entries"("brand_id");