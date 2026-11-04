-- Migration: Grant Studio (docs/GRANT_PLATFORM_PLAN.md).
-- Applicants (nonprofits and businesses), readiness items, opportunities from
-- official sources, sync runs, applications with their compliance matrix,
-- sections, SF-424A budget lines and approvals.

CREATE TABLE IF NOT EXISTS grant_applicants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  applicant_type TEXT NOT NULL,
  ein TEXT,
  uei TEXT,
  state TEXT,
  service_area TEXT,
  mission TEXT,
  focus_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  annual_budget INTEGER,
  max_cost_share_percent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grant_applicants_user ON grant_applicants(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_readiness_items (
  id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES grant_applicants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'missing',
  expires_on TEXT,
  note TEXT,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_readiness_kind ON grant_readiness_items(applicant_id, kind);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_opportunities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  number TEXT,
  title TEXT NOT NULL,
  agency TEXT,
  agency_code TEXT,
  status TEXT NOT NULL,
  open_date TEXT,
  close_date TEXT,
  award_floor DOUBLE PRECISION,
  award_ceiling DOUBLE PRECISION,
  estimated_funding DOUBLE PRECISION,
  cost_sharing BOOLEAN,
  eligibility_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  eligibility_text TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  assistance_listings JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  official_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  detail_fetched_at TIMESTAMPTZ,
  checksum TEXT NOT NULL,
  connector_version TEXT NOT NULL,
  publishable BOOLEAN NOT NULL DEFAULT FALSE,
  gate_missing JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_opportunity_source ON grant_opportunities(source, source_ref);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grant_opportunities_close ON grant_opportunities(close_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_applications (
  id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES grant_applicants(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES grant_opportunities(id) ON DELETE RESTRICT,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  requested_amount DOUBLE PRECISION,
  eligibility_confirmed_at TIMESTAMPTZ,
  eligibility_confirmed_by TEXT,
  eligibility_note TEXT,
  notice_text TEXT,
  indirect_rate_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_application ON grant_applications(applicant_id, opportunity_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_requirements (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  source_ref TEXT,
  section_key TEXT,
  points INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  origin TEXT NOT NULL DEFAULT 'template',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grant_requirements_app ON grant_requirements(application_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_sections (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  guidance TEXT,
  limit_type TEXT,
  limit_value INTEGER,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'empty',
  demo_content BOOLEAN NOT NULL DEFAULT FALSE,
  review_score INTEGER,
  review_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_section_key ON grant_sections(application_id, key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_budget_lines (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  match_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  justification TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grant_budget_app ON grant_budget_lines(application_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS grant_approvals (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  subject_id TEXT,
  role TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grant_approvals_app ON grant_approvals(application_id);
