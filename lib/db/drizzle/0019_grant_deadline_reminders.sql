-- Migration: Grant Studio deadline reminders (docs/GRANT_STUDIO.md).
-- Remembers the last reminder threshold sent per application, so each one fires once.
ALTER TABLE "grant_applications" ADD COLUMN IF NOT EXISTS "deadline_alert_days" integer;
