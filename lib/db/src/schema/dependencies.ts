import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dependencyRegistryTable = pgTable("dependency_registry", {
  id: text("id").primaryKey(),
  repositorySlug: text("repository_slug").notNull(),
  componentName: text("component_name").notNull(),
  purpose: text("purpose").notNull(),
  category: text("category").notNull(),
  installedVersion: text("installed_version"),
  pinnedVersion: text("pinned_version"),
  license: text("license"),
  repositoryStatus: text("repository_status"),
  installStatus: text("install_status").notNull().default("not_installed"),
  replacementOption: text("replacement_option"),
  securityReviewStatus: text("security_review_status").notNull().default("pending"),
  maintenanceNotes: text("maintenance_notes"),
  knownRisks: text("known_risks"),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDependencySchema = createInsertSchema(dependencyRegistryTable).omit({ createdAt: true, updatedAt: true });
export type InsertDependency = z.infer<typeof insertDependencySchema>;
export type Dependency = typeof dependencyRegistryTable.$inferSelect;
