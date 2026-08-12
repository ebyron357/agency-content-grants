-- ============================================================
-- Migration: repurposing presets — saved tone/audience/CTA/length
-- combinations per brand, for pre-filling the repurposing batch form.
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "repurposing_presets" (
  "id" text PRIMARY KEY,
  "brand_id" text NOT NULL,
  "name" text NOT NULL,
  "tone" text,
  "audience" text,
  "cta" text,
  "target_length" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='repurposing_presets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='repurposing_presets_brand_id_brands_id_fk') THEN
    ALTER TABLE "repurposing_presets" ADD CONSTRAINT "repurposing_presets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "repurposing_presets_brand_id_idx" ON "repurposing_presets"("brand_id");
