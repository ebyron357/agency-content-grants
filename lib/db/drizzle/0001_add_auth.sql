-- ============================================================
-- Migration: Add authentication and resource ownership
-- ============================================================

-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Add user_id to brands (nullable so existing rows survive)
ALTER TABLE "brands"
  ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "users"("id") ON DELETE CASCADE;

-- Add user_id to projects (nullable so existing rows survive)
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "users"("id") ON DELETE CASCADE;

-- Indexes for fast per-user queries
CREATE INDEX IF NOT EXISTS "brands_user_id_idx" ON "brands"("user_id");
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects"("user_id");
