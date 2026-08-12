import { pgTable, text, timestamp, integer, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { documentsTable, documentSectionsTable } from "./documents";
import { brandsTable } from "./brands";

/**
 * Repurposing Engine — turn one approved document (or a specific section)
 * into multiple channel-specific derivative assets in a single batch action.
 *
 * A batch is the campaign-level generation request (source scope, channels,
 * tone/audience/CTA settings). Each channel produces one repurposedAsset —
 * the current, editable "slot" for that channel. Regenerating or manually
 * editing an asset pushes its prior content into repurposedAssetRevisions
 * before overwriting, so an already-approved version is never silently lost:
 * it stays recoverable via revision history, and the slot is marked back to
 * draft/unapproved until it is explicitly re-approved (mirrors the
 * document-section draft/revision/approve pattern).
 */
export const repurposingBatchesTable = pgTable("repurposing_batches", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  // Source scope: null = whole document, set = a single section (lineage)
  documentSectionId: text("document_section_id").references(() => documentSectionsTable.id, { onDelete: "set null" }),
  campaignName: text("campaign_name"),
  channels: jsonb("channels").notNull(), // string[] of channel keys requested
  tone: text("tone"),
  audience: text("audience"),
  cta: text("cta"),
  targetLength: text("target_length"),
  additionalInstructions: text("additional_instructions"),
  status: text("status").notNull().default("processing"), // processing | completed | failed | partial
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const repurposedAssetsTable = pgTable("repurposed_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull().references(() => repurposingBatchesTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  documentSectionId: text("document_section_id").references(() => documentSectionsTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  title: text("title"),
  content: text("content").notNull().default(""),
  tone: text("tone"),
  audience: text("audience"),
  cta: text("cta"),
  targetLength: text("target_length"),
  status: text("status").notNull().default("draft"), // draft | approved | rejected
  isApproved: boolean("is_approved").notNull().default(false),
  versionNumber: integer("version_number").notNull().default(1),
  brandCheckScore: real("brand_check_score"),
  brandCheckPassed: boolean("brand_check_passed"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const repurposedAssetRevisionsTable = pgTable("repurposed_asset_revisions", {
  id: text("id").primaryKey(),
  repurposedAssetId: text("repurposed_asset_id").notNull().references(() => repurposedAssetsTable.id, { onDelete: "cascade" }),
  title: text("title"),
  content: text("content").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  wasApproved: boolean("was_approved").notNull().default(false),
  editType: text("edit_type").notNull().default("regenerate"), // regenerate | manual_edit
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Repurposing presets — a brand's saved tone/audience/CTA/length combination
 * so recurring campaigns (e.g. "always this CTA for LinkedIn") don't require
 * re-typing the same overrides on every batch. Presets only pre-fill the
 * generation form; they don't change generation or versioning behavior.
 */
export const repurposingPresetsTable = pgTable("repurposing_presets", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tone: text("tone"),
  audience: text("audience"),
  cta: text("cta"),
  targetLength: text("target_length"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRepurposingBatchSchema = createInsertSchema(repurposingBatchesTable).omit({ createdAt: true, updatedAt: true });
export type InsertRepurposingBatch = z.infer<typeof insertRepurposingBatchSchema>;
export type RepurposingBatch = typeof repurposingBatchesTable.$inferSelect;

export const insertRepurposedAssetSchema = createInsertSchema(repurposedAssetsTable).omit({ createdAt: true, updatedAt: true });
export type InsertRepurposedAsset = z.infer<typeof insertRepurposedAssetSchema>;
export type RepurposedAsset = typeof repurposedAssetsTable.$inferSelect;

export const insertRepurposedAssetRevisionSchema = createInsertSchema(repurposedAssetRevisionsTable).omit({ createdAt: true });
export type InsertRepurposedAssetRevision = z.infer<typeof insertRepurposedAssetRevisionSchema>;
export type RepurposedAssetRevision = typeof repurposedAssetRevisionsTable.$inferSelect;

export const insertRepurposingPresetSchema = createInsertSchema(repurposingPresetsTable).omit({ createdAt: true, updatedAt: true });
export type InsertRepurposingPreset = z.infer<typeof insertRepurposingPresetSchema>;
export type RepurposingPreset = typeof repurposingPresetsTable.$inferSelect;
