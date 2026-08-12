-- ============================================================
-- Migration: Persistent rate-limit counters
-- Backs express-rate-limit with Postgres so login/admin-unlock
-- lockouts survive server restarts and are shared across instances.
-- ============================================================

CREATE TABLE IF NOT EXISTS "rate_limit" (
  "prefix" varchar NOT NULL,
  "key" varchar NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("prefix", "key")
);

CREATE INDEX IF NOT EXISTS "IDX_rate_limit_expires_at" ON "rate_limit" ("expires_at");
