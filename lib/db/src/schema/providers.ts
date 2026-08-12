import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providerConfigsTable = pgTable("provider_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isConfigured: boolean("is_configured").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  status: text("status").notNull().default("unconfigured"),
  defaultModel: text("default_model"),
  availableModels: text("available_models"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const modelConfigTable = pgTable("model_config", {
  id: text("id").primaryKey().default("singleton"),
  planningModel: text("planning_model"),
  researchModel: text("research_model"),
  outlineModel: text("outline_model"),
  writingModel: text("writing_model"),
  editingModel: text("editing_model"),
  verificationModel: text("verification_model"),
  evaluationModel: text("evaluation_model"),
  utilityModel: text("utility_model"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProviderConfigSchema = createInsertSchema(providerConfigsTable).omit({ updatedAt: true });
export type InsertProviderConfig = z.infer<typeof insertProviderConfigSchema>;
export type ProviderConfig = typeof providerConfigsTable.$inferSelect;

export const insertModelConfigSchema = createInsertSchema(modelConfigTable).omit({ updatedAt: true });
export type InsertModelConfig = z.infer<typeof insertModelConfigSchema>;
export type ModelConfig = typeof modelConfigTable.$inferSelect;
