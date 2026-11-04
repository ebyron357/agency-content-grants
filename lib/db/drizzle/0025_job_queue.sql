-- Migration: durable background job queue (docs/BACKGROUND_JOBS.md). Additive.
CREATE TABLE IF NOT EXISTS "jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "user_id" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by" text,
  "heartbeat_at" timestamp with time zone,
  "dedupe_key" text,
  "progress" jsonb,
  "result" jsonb,
  "last_error" text,
  "requested_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_claim" ON "jobs" ("status", "run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_created" ON "jobs" ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_jobs_dedupe_active" ON "jobs" ("dedupe_key") WHERE status in ('queued', 'running');
