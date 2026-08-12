-- ============================================================
-- Migration: add title to repurposed_asset_revisions
-- Preserves title changes (not just content) so title-only edits are
-- recoverable, matching the guarantee already applied to content edits.
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

ALTER TABLE "repurposed_asset_revisions" ADD COLUMN IF NOT EXISTS "title" text;
