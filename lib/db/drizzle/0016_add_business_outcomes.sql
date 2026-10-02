-- Migration: add project-level business outcome tracking.
-- AI cost remains derived from generation_runs rather than duplicated here.

CREATE TABLE IF NOT EXISTS business_outcomes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  client_name TEXT,
  package_type TEXT,
  revenue_usd REAL,
  human_hours REAL,
  revision_count INTEGER NOT NULL DEFAULT 0,
  client_approved BOOLEAN,
  repeat_purchase BOOLEAN,
  business_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_outcomes_project ON business_outcomes(project_id);
