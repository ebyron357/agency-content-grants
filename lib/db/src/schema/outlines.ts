import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const outlinesTable = pgTable("outlines", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const outlineSectionsTable = pgTable("outline_sections", {
  id: text("id").primaryKey(),
  outlineId: text("outline_id").notNull().references(() => outlinesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  purpose: text("purpose"),
  questionsAnswered: text("questions_answered"),
  targetWordCount: integer("target_word_count"),
  readerOutcome: text("reader_outcome"),
  examples: text("examples"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOutlineSchema = createInsertSchema(outlinesTable).omit({ createdAt: true, updatedAt: true });
export type InsertOutline = z.infer<typeof insertOutlineSchema>;
export type Outline = typeof outlinesTable.$inferSelect;

export const insertOutlineSectionSchema = createInsertSchema(outlineSectionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertOutlineSection = z.infer<typeof insertOutlineSectionSchema>;
export type OutlineSection = typeof outlineSectionsTable.$inferSelect;
