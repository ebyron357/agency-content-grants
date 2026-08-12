import { pgTable, text, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { sourcesTable } from "./sources";

export const claimsTable = pgTable("claims", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => sourcesTable.id, { onDelete: "set null" }),
  claimText: text("claim_text").notNull(),
  claimType: text("claim_type").notNull().default("factual"),
  supportingExcerpt: text("supporting_excerpt"),
  confidence: real("confidence"),
  timeSensitive: boolean("time_sensitive").notNull().default(false),
  verificationStatus: text("verification_status").notNull().default("proposed"),
  conflictStatus: text("conflict_status").notNull().default("none"),
  reviewerDecision: text("reviewer_decision"),
  reviewerNotes: text("reviewer_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClaimSchema = createInsertSchema(claimsTable).omit({ createdAt: true, updatedAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claimsTable.$inferSelect;
