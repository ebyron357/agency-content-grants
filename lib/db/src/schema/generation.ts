import { pgTable, text, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { documentSectionsTable } from "./documents";

export const generationRunsTable = pgTable("generation_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  documentSectionId: text("document_section_id").references(() => documentSectionsTable.id, { onDelete: "set null" }),
  pipelineStage: text("pipeline_stage").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: real("estimated_cost_usd"),
  latencyMs: integer("latency_ms"),
  retryCount: integer("retry_count").notNull().default(0),
  status: text("status").notNull().default("completed"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityLogTable = pgTable("activity_log", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  userId: text("user_id"),
  projectId: text("project_id"),
  projectTitle: text("project_title"),
  brandName: text("brand_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGenerationRunSchema = createInsertSchema(generationRunsTable).omit({ createdAt: true });
export type InsertGenerationRun = z.infer<typeof insertGenerationRunSchema>;
export type GenerationRun = typeof generationRunsTable.$inferSelect;

export const insertActivityLogSchema = createInsertSchema(activityLogTable).omit({ createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogTable.$inferSelect;
