import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const brandsTable = pgTable("brands", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  industry: text("industry"),
  website: text("website"),
  voiceDescription: text("voice_description"),
  tonePreferences: text("tone_preferences"),
  readingLevel: text("reading_level"),
  preferredVocabulary: text("preferred_vocabulary"),
  prohibitedVocabulary: text("prohibited_vocabulary"),
  geographicFocus: text("geographic_focus"),
  complianceNotes: text("compliance_notes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const audienceProfilesTable = pgTable("audience_profiles", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  demographics: text("demographics"),
  knowledgeLevel: text("knowledge_level"),
  painPoints: text("pain_points"),
  goals: text("goals"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const brandFactsTable = pgTable("brand_facts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  claim: text("claim").notNull(),
  source: text("source"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBrandSchema = createInsertSchema(brandsTable).omit({ createdAt: true, updatedAt: true });
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;

export const insertAudienceProfileSchema = createInsertSchema(audienceProfilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertAudienceProfile = z.infer<typeof insertAudienceProfileSchema>;
export type AudienceProfile = typeof audienceProfilesTable.$inferSelect;

export const insertBrandFactSchema = createInsertSchema(brandFactsTable).omit({ createdAt: true, updatedAt: true });
export type InsertBrandFact = z.infer<typeof insertBrandFactSchema>;
export type BrandFact = typeof brandFactsTable.$inferSelect;

/**
 * Brand Brain: structured, reusable brand knowledge entries.
 * Each entry has a category (positioning, competitor, cta, statistic, ...),
 * a short label, free-form content, and an optional structured JSON payload
 * for category-specific fields. Entries can be individually enabled/disabled
 * and carry provenance metadata for imported knowledge.
 */
export const brandKnowledgeEntriesTable = pgTable("brand_knowledge_entries", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  label: text("label").notNull(),
  content: text("content").notNull(),
  structured: jsonb("structured"),
  enabled: boolean("enabled").notNull().default(true),
  provenance: text("provenance").notNull().default("manual"), // manual | imported | ai_extracted
  sourceUrl: text("source_url"),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBrandKnowledgeEntrySchema = createInsertSchema(brandKnowledgeEntriesTable).omit({ createdAt: true, updatedAt: true });
export type InsertBrandKnowledgeEntry = z.infer<typeof insertBrandKnowledgeEntrySchema>;
export type BrandKnowledgeEntry = typeof brandKnowledgeEntriesTable.$inferSelect;
