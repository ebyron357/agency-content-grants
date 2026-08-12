-- ============================================================
-- Migration: atomic claim/cancel fields for scheduled_publications,
-- so provider dispatch (publish/confirm) can never be double-submitted
-- by a race between an immediate "publish now" request and the
-- background scheduler tick. Idempotent.
-- ============================================================

ALTER TABLE "scheduled_publications" ADD COLUMN IF NOT EXISTS "claimed_at" timestamptz;--> statement-breakpoint
ALTER TABLE "scheduled_publications" ADD COLUMN IF NOT EXISTS "cancel_requested" boolean NOT NULL DEFAULT false;
