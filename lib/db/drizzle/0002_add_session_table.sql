-- ============================================================
-- Migration: Create the express-session store table
-- (connect-pg-simple's createTableIfMissing has proven unreliable,
--  so the table is created explicitly for fresh deployments)
-- ============================================================

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
