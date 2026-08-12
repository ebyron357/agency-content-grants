import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contentBlueprintsTable = pgTable("content_blueprints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  description: text("description"),
  structureDefinition: text("structure_definition"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContentBlueprintSchema = createInsertSchema(contentBlueprintsTable).omit({ createdAt: true, updatedAt: true });
export type InsertContentBlueprint = z.infer<typeof insertContentBlueprintSchema>;
export type ContentBlueprint = typeof contentBlueprintsTable.$inferSelect;
