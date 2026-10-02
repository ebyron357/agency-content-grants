import { boolean, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const businessOutcomesTable = pgTable("business_outcomes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  clientName: text("client_name"),
  packageType: text("package_type"),
  revenueUsd: real("revenue_usd"),
  humanHours: real("human_hours"),
  revisionCount: integer("revision_count").notNull().default(0),
  clientApproved: boolean("client_approved"),
  repeatPurchase: boolean("repeat_purchase"),
  businessResult: text("business_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBusinessOutcomeSchema = createInsertSchema(businessOutcomesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessOutcome = z.infer<typeof insertBusinessOutcomeSchema>;
export type BusinessOutcome = typeof businessOutcomesTable.$inferSelect;
