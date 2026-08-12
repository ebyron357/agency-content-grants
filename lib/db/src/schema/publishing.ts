import { pgTable, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";
import { documentsTable } from "./documents";
import { repurposedAssetsTable } from "./repurposing";

/**
 * A destination a brand can publish to. Core fields (provider, platform, label,
 * ownership) are shared across every adapter; provider-specific data (e.g. a
 * Typefully social-set id, extra per-platform options) lives in `config` so
 * adding a new provider never requires a schema change to this table.
 */
export const publishingDestinationsTable = pgTable("publishing_destinations", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "typefully" | "demo" | ... (see lib/publishing/router.ts PROVIDERS)
  platform: text("platform").notNull(), // "x" | "linkedin" | "threads" | "bluesky" | "mastodon" | "demo"
  label: text("label").notNull(),
  externalAccountId: text("external_account_id"), // provider's id for the connected account/social-set, if any
  config: jsonb("config"), // provider-specific fields, isolated from core columns
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * A single scheduled/published item. `content`/`title` are a snapshot taken at
 * schedule time so later edits to the source document/asset don't silently
 * change what was (or will be) published. Status only becomes "published"
 * once the provider adapter confirms it — see lib/workflows/publishing-workflow.ts.
 */
export const scheduledPublicationsTable = pgTable("scheduled_publications", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // Deliberately NOT cascade: a destination must never be deletable while
  // publications (including long-terminal published/failed/cancelled ones)
  // still reference it, since that would silently erase provider-publish
  // history. The DB constraint (onDelete: "restrict") is the actual
  // enforcement; removePublishingDestination's upfront count check only
  // exists to return a friendly 409 in the common case — see
  // artifacts/api-server/src/lib/workflows/publishing-workflow.ts.
  destinationId: text("destination_id").notNull().references(() => publishingDestinationsTable.id, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull(), // "document" | "repurposed_asset"
  documentId: text("document_id").references(() => documentsTable.id, { onDelete: "cascade" }),
  repurposedAssetId: text("repurposed_asset_id").references(() => repurposedAssetsTable.id, { onDelete: "cascade" }),
  title: text("title"),
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  // pending | publishing | queued | confirming | published | failed | cancelled
  // "publishing"/"confirming" are short-lived claim states (see claimForProcessing
  // in lib/workflows/publishing-workflow.ts) that make provider dispatch atomic:
  // only the process that wins the conditional UPDATE out of "pending"/"queued"
  // may call the provider, so an immediate "publish now" request racing the
  // background scheduler tick can never submit the same content twice.
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  // Set when a claim is taken (status -> publishing/confirming/cancelling), so
  // a crashed in-flight claim older than CLAIM_TIMEOUT_MS can be safely
  // reclaimed instead of leaving the row stuck forever.
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  // A fresh random token generated every time a claim is taken. Every write
  // that finalizes a provider dispatch (this claim's own eventual outcome)
  // must be conditioned on `claimToken = <the token this call was given>`.
  // If a stale claim gets reclaimed while the original call is still slowly
  // running, the reclaim generates a NEW token — so when the original,
  // now-superseded call finally finishes, its conditional write matches zero
  // rows and is a safe no-op instead of clobbering whatever the newer claim
  // already wrote (which may itself be a real published/cancelled result).
  claimToken: text("claim_token"),
  // Best-effort cancel signal recorded while a claim is held elsewhere (e.g. the
  // provider call is in flight). The holder checks this after its provider call
  // returns and attempts a real provider-side cancellation before finalizing —
  // cancelling in our DB alone is not enough once content has been submitted.
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  externalPostId: text("external_post_id"),
  externalUrl: text("external_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  providerPayload: jsonb("provider_payload"), // provider-specific extras, isolated from core columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Visible attempt history for a scheduled publication — never silently dropped. */
export const publicationAttemptsTable = pgTable("publication_attempts", {
  id: text("id").primaryKey(),
  scheduledPublicationId: text("scheduled_publication_id").notNull().references(() => scheduledPublicationsTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  outcome: text("outcome").notNull(), // "success" | "failure" | "confirmed" | "still_pending"
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPublishingDestinationSchema = createInsertSchema(publishingDestinationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPublishingDestination = z.infer<typeof insertPublishingDestinationSchema>;
export type PublishingDestination = typeof publishingDestinationsTable.$inferSelect;

export const insertScheduledPublicationSchema = createInsertSchema(scheduledPublicationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertScheduledPublication = z.infer<typeof insertScheduledPublicationSchema>;
export type ScheduledPublication = typeof scheduledPublicationsTable.$inferSelect;

export const insertPublicationAttemptSchema = createInsertSchema(publicationAttemptsTable).omit({ createdAt: true });
export type InsertPublicationAttempt = z.infer<typeof insertPublicationAttemptSchema>;
export type PublicationAttempt = typeof publicationAttemptsTable.$inferSelect;
