-- ============================================================
-- Migration: Content Performance Engine — append-only ingested metrics
-- snapshots and evidence-backed recommendations.
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "performance_snapshots" (
  "id" text PRIMARY KEY,
  "scheduled_publication_id" text NOT NULL,
  "source" text NOT NULL,
  "external_post_id" text NOT NULL,
  "post_url" text,
  "impressions" integer NOT NULL,
  "engagement_total" integer NOT NULL,
  "likes" integer NOT NULL,
  "comments" integer NOT NULL,
  "shares" integer NOT NULL,
  "quotes" integer,
  "saves" integer,
  "profile_clicks" integer,
  "link_clicks" integer,
  "raw" jsonb,
  "captured_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "performance_recommendations" (
  "id" text PRIMARY KEY,
  "brand_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "rationale" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text,
  "subject_label" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "acted_at" timestamptz,
  "acted_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='performance_snapshots')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scheduled_publications')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_snapshots_scheduled_publication_id_scheduled_publications_id_fk') THEN
    ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_scheduled_publication_id_scheduled_publications_id_fk" FOREIGN KEY ("scheduled_publication_id") REFERENCES "public"."scheduled_publications"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='performance_recommendations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_recommendations_brand_id_brands_id_fk') THEN
    ALTER TABLE "performance_recommendations" ADD CONSTRAINT "performance_recommendations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "performance_snapshots_publication_id_idx" ON "performance_snapshots"("scheduled_publication_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_snapshots_captured_at_idx" ON "performance_snapshots"("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_recommendations_brand_id_idx" ON "performance_recommendations"("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_recommendations_status_idx" ON "performance_recommendations"("status");--> statement-breakpoint

-- The dedupe key is the natural key recomputation upserts against — must be
-- unique per brand so a recompute never creates a duplicate row for the same
-- underlying pattern.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_recommendations_dedupe_key_unique') THEN
    ALTER TABLE "performance_recommendations" ADD CONSTRAINT "performance_recommendations_dedupe_key_unique" UNIQUE ("dedupe_key");
  END IF;
END $$;
