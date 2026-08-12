import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { contentBlueprintsTable } from "./blueprints";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
  blueprintId: text("blueprint_id").references(() => contentBlueprintsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  topic: text("topic"),
  contentType: text("content_type").notNull().default("blog"),
  purpose: text("purpose"),
  intendedAudience: text("intended_audience"),
  audienceKnowledgeLevel: text("audience_knowledge_level"),
  desiredReaderOutcome: text("desired_reader_outcome"),
  geographicFocus: text("geographic_focus"),
  targetLength: text("target_length"),
  tone: text("tone"),
  readingLevel: text("reading_level"),
  pointOfView: text("point_of_view"),
  researchFreshness: text("research_freshness"),
  citationRequirement: text("citation_requirement"),
  requiredSections: text("required_sections"),
  subjectsToAvoid: text("subjects_to_avoid"),
  wordsToAvoid: text("words_to_avoid"),
  additionalInstructions: text("additional_instructions"),
  status: text("status").notNull().default("active"),
  workflowStage: text("workflow_stage").notNull().default("assignment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
