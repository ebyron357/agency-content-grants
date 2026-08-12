-- A destination must never be deletable while a scheduled_publications row
-- still references it (that history is the audit trail proving what was
-- actually sent to a provider). The original migration set this FK to
-- ON DELETE CASCADE, which let deleting a destination silently wipe out
-- every publication and attempt record tied to it. Replace it with
-- ON DELETE RESTRICT so the database itself refuses the delete, closing the
-- check-then-act race where a publication is inserted after an application-level
-- count check but before the delete statement runs.
DO $$ BEGIN
 ALTER TABLE "scheduled_publications" DROP CONSTRAINT IF EXISTS "scheduled_publications_destination_id_publishing_destinations_id_fk";
EXCEPTION
 WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_destination_id_publishing_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."publishing_destinations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
