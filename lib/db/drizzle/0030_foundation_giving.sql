-- Migration: foundation giving history from funder-graph (docs/GRANT_STUDIO.md, Foundations). Additive.
-- Per-funder aggregates and a bounded set of recent grants; the full edge list is never stored.
CREATE TABLE IF NOT EXISTS "foundation_funders" (
  "ein" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "name_search" text NOT NULL,
  "state" text,
  "form_type" text NOT NULL,
  "total_paid_usd" bigint NOT NULL,
  "grant_count" integer NOT NULL,
  "first_tax_year" integer,
  "last_tax_year" integer,
  "giving_by_year" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "giving_by_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "giving_by_category" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "category_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "size_histogram" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "size_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "filings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "latest_object_id" text,
  "latest_tax_period_end" text,
  "latest_submitted_on" text,
  "dataset_version" text,
  "import_run_id" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_foundation_funders_total" ON "foundation_funders" ("total_paid_usd");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_foundation_funders_state" ON "foundation_funders" ("state");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_grants" (
  "funder_ein" text NOT NULL REFERENCES "foundation_funders"("ein") ON DELETE CASCADE,
  "id" text NOT NULL,
  "recipient_name" text NOT NULL,
  "recipient_city" text,
  "recipient_state" text,
  "recipient_ein" text,
  "match_confidence" double precision,
  "amount_usd" bigint NOT NULL,
  "tax_year" integer NOT NULL,
  "purpose" text,
  "category" text,
  "object_id" text NOT NULL,
  CONSTRAINT "foundation_grants_funder_ein_id_pk" PRIMARY KEY ("funder_ein", "id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "foundation_import_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text,
  "status" text NOT NULL,
  "base_url" text NOT NULL,
  "dataset_version" text,
  "years" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "years_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "min_confidence" double precision NOT NULL,
  "stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "funders" integer DEFAULT 0 NOT NULL,
  "grants_stored" integer DEFAULT 0 NOT NULL,
  "bytes_used" bigint,
  "note" text,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
