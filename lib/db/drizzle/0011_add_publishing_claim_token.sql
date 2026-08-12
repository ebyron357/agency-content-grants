-- ============================================================
-- Migration: fencing token for scheduled_publications claims.
-- Every write that finalizes a provider dispatch must be conditioned on
-- this token matching the token generated when the claim was taken, so a
-- reclaimed stale claim's original (still slowly running) caller can never
-- overwrite newer state with a stale result. Idempotent.
-- ============================================================

ALTER TABLE "scheduled_publications" ADD COLUMN IF NOT EXISTS "claim_token" text;
