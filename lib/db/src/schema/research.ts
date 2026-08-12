import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const researchPlansTable = pgTable("research_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  summary: text("summary"),
  timeframeStart: text("timeframe_start"),
  timeframeEnd: text("timeframe_end"),
  geographicBoundaries: text("geographic_boundaries"),
  sourceCategories: text("source_categories"),
  potentialConflicts: text("potential_conflicts"),
  missingInformation: text("missing_information"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const researchQuestionsTable = pgTable("research_questions", {
  id: text("id").primaryKey(),
  researchPlanId: text("research_plan_id").notNull().references(() => researchPlansTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("pending"),
  answer: text("answer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertResearchPlanSchema = createInsertSchema(researchPlansTable).omit({ createdAt: true, updatedAt: true });
export type InsertResearchPlan = z.infer<typeof insertResearchPlanSchema>;
export type ResearchPlan = typeof researchPlansTable.$inferSelect;

export const insertResearchQuestionSchema = createInsertSchema(researchQuestionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertResearchQuestion = z.infer<typeof insertResearchQuestionSchema>;
export type ResearchQuestion = typeof researchQuestionsTable.$inferSelect;
