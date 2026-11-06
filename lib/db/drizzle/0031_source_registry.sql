-- Migration: grant source registry, page watcher and extraction review queue
-- (docs/SOURCE_REGISTRY.md; GRANT_PLATFORM_PLAN.md §4 and §8). Additive.
-- A source is a row: a new state or foundation page needs no release.
CREATE TABLE IF NOT EXISTS "grant_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "jurisdiction_kind" text NOT NULL,
  "jurisdiction_code" text,
  "connector_type" text NOT NULL,
  "connector" text,
  "urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "schedule_hours" integer DEFAULT 24 NOT NULL,
  "owner" text,
  "status" text DEFAULT 'disabled' NOT NULL,
  "terms_note" text,
  "terms_checked" boolean DEFAULT false NOT NULL,
  "terms_permit_automation" boolean DEFAULT false NOT NULL,
  "terms_checked_at" timestamp with time zone,
  "terms_checked_by" text,
  "stale_after_days" integer,
  "watch_id" text,
  "watch_synced_at" timestamp with time zone,
  "last_checked_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_changed_at" timestamp with time zone,
  "last_error" text,
  "last_content_hash" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grant_sources_key" ON "grant_sources" ("key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_source_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "grant_sources"("id") ON DELETE CASCADE,
  "checked_at" timestamp with time zone NOT NULL,
  "backend" text NOT NULL,
  "outcome" text NOT NULL,
  "http_status" integer,
  "content_hash" text,
  "bytes" integer,
  "page_text" text,
  "page_links" jsonb,
  "drafts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "job_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_source_checks_source" ON "grant_source_checks" ("source_id", "checked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_source_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "grant_sources"("id") ON DELETE CASCADE,
  "check_id" text REFERENCES "grant_source_checks"("id") ON DELETE SET NULL,
  "fingerprint" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "title" text NOT NULL,
  "funder" text,
  "deadline" text,
  "rolling_deadline" boolean DEFAULT false NOT NULL,
  "opportunity_status" text DEFAULT 'posted' NOT NULL,
  "amount_min" double precision,
  "amount_max" double precision,
  "eligibility_summary" text,
  "applicant_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "official_url" text,
  "source_url" text NOT NULL,
  "checked_at" timestamp with time zone NOT NULL,
  "evidence" text,
  "notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "demo" boolean DEFAULT false NOT NULL,
  "provider" text,
  "opportunity_id" text REFERENCES "grant_opportunities"("id") ON DELETE SET NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grant_source_drafts_fp" ON "grant_source_drafts" ("source_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grant_source_drafts_status" ON "grant_source_drafts" ("status", "created_at");
--> statement-breakpoint
-- The two connectors already in code, registered without changing how they run.
INSERT INTO "grant_sources" ("id", "key", "name", "jurisdiction_kind", "jurisdiction_code", "connector_type", "connector", "urls", "schedule_hours", "owner", "status", "terms_note", "terms_checked", "terms_permit_automation", "terms_checked_at", "terms_checked_by")
VALUES
  ('src-grants-gov', 'grants_gov', 'Grants.gov', 'federal', NULL, 'feed', 'grants_gov', '["https://api.grants.gov/v1/api/search2", "https://api.grants.gov/v1/api/fetchOpportunity"]'::jsonb, 24, 'ebyron357', 'active',
   'Grants.gov API terms (https://grants.gov/api/terms-conditions, read 5 Nov 2026): the API may be used to search, display, analyze and retrieve its public data; content must not be modified or misrepresented; HHS may limit or end access. Services using it must display: "This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services." That notice is not yet shown in the product (owner action).',
   true, true, '2026-11-05T00:00:00Z', 'Agent 2 (source registry PR)'),
  ('src-ca-grants-portal', 'ca_grants_portal', 'California Grants Portal', 'state', 'CA', 'feed', 'ca_grants_portal', '["https://data.ca.gov/dataset/california-grants-portal"]'::jsonb, 24, 'ebyron357', 'active',
   'data.ca.gov dataset california-grants-portal (read 5 Nov 2026): license "Other (Public Domain)", rights "No restrictions", updated daily by the State.',
   true, true, '2026-11-05T00:00:00Z', 'Agent 2 (source registry PR)')
ON CONFLICT ("key") DO NOTHING;
