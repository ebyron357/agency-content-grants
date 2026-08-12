import { pgTable, text, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const sourcesTable = pgTable("sources", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url"),
  publisher: text("publisher"),
  author: text("author"),
  publicationDate: text("publication_date"),
  retrievalDate: text("retrieval_date"),
  sourceType: text("source_type").notNull().default("web"),
  extractedText: text("extracted_text"),
  relevantExcerpts: text("relevant_excerpts"),
  authorityScore: real("authority_score"),
  freshnessScore: real("freshness_score"),
  isPrimarySource: boolean("is_primary_source").notNull().default(false),
  status: text("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  fileObjectPath: text("file_object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSourceSchema = createInsertSchema(sourcesTable).omit({ createdAt: true, updatedAt: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sourcesTable.$inferSelect;
