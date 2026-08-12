import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { documentsTable } from "./documents";

export const exportsTable = pgTable("exports", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  status: text("status").notNull().default("pending"),
  fileUrl: text("file_url"),
  fileSizeBytes: integer("file_size_bytes"),
  validationPassed: boolean("validation_passed"),
  validationNotes: text("validation_notes"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExportSchema = createInsertSchema(exportsTable).omit({ createdAt: true, updatedAt: true });
export type InsertExport = z.infer<typeof insertExportSchema>;
export type Export = typeof exportsTable.$inferSelect;
