import { pgTable, text, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { documentsTable, documentSectionsTable } from "./documents";

export const qualityEvaluationsTable = pgTable("quality_evaluations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  accuracyScore: real("accuracy_score"),
  citationScore: real("citation_score"),
  sourceQualityScore: real("source_quality_score"),
  coverageScore: real("coverage_score"),
  coherenceScore: real("coherence_score"),
  continuityScore: real("continuity_score"),
  naturalnessScore: real("naturalness_score"),
  usefulnessScore: real("usefulness_score"),
  audienceFitScore: real("audience_fit_score"),
  brandFitScore: real("brand_fit_score"),
  readabilityScore: real("readability_score"),
  repetitionScore: real("repetition_score"),
  overallPass: boolean("overall_pass").notNull().default(false),
  isPublicationReady: boolean("is_publication_ready").notNull().default(false),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qualityIssuesTable = pgTable("quality_issues", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => qualityEvaluationsTable.id, { onDelete: "cascade" }),
  documentSectionId: text("document_section_id").references(() => documentSectionsTable.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("warning"),
  description: text("description").notNull(),
  suggestedFix: text("suggested_fix"),
  status: text("status").notNull().default("open"),
});

export const insertQualityEvaluationSchema = createInsertSchema(qualityEvaluationsTable).omit({ createdAt: true });
export type InsertQualityEvaluation = z.infer<typeof insertQualityEvaluationSchema>;
export type QualityEvaluation = typeof qualityEvaluationsTable.$inferSelect;

export const insertQualityIssueSchema = createInsertSchema(qualityIssuesTable);
export type InsertQualityIssue = z.infer<typeof insertQualityIssueSchema>;
export type QualityIssue = typeof qualityIssuesTable.$inferSelect;
