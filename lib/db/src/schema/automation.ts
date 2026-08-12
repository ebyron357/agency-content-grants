import { pgTable, text, timestamp, integer, jsonb, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

/**
 * Automation & Webhook Foundation — see docs/decisions/automation-webhook-foundation.md
 * and docs/automation-api.md for the full contract external tools (e.g. n8n)
 * build against.
 */

// ── API keys (bearer auth for programmatic callers) ───────────────────────────
/**
 * Never stores the raw secret — only a sha256 hash, looked up by exact match.
 * The raw key is shown to the user exactly once, at creation time. `scopes`
 * gates which automation actions the key may call (see
 * lib/automation/scopes.ts); a session-authenticated human always has full
 * access regardless of scopes.
 */
export const apiKeysTable = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // First 12 chars of the raw key, kept only for display ("cmk_live_AbCd1234...") — never usable to authenticate.
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").notNull(), // string[] — see lib/automation/scopes.ts AUTOMATION_SCOPES
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Internal event journal ─────────────────────────────────────────────────────
/**
 * Canonical, durable record of every lifecycle event Content Machine emits —
 * independent of whether any webhook subscription exists to receive it. This
 * is the "internal event model" the automation foundation is built on;
 * webhook deliveries are a fan-out of these rows, never the source of truth.
 */
export const webhookEventsTable = pgTable("webhook_events", {
  id: text("id").primaryKey(), // "evt_<uuid>"
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // see lib/automation/events.ts EVENT_TYPES
  brandId: text("brand_id"),
  projectId: text("project_id"),
  payload: jsonb("payload").notNull(), // event-specific data — never includes secrets/credentials
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index("webhook_events_user_id_idx").on(table.userId),
  typeIdx: index("webhook_events_type_idx").on(table.type),
}));

// ── Webhook subscriptions ──────────────────────────────────────────────────────
export const webhookSubscriptionsTable = pgTable("webhook_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Null = every brand this user owns. Set = only events for that brand.
  brandId: text("brand_id").references(() => brandsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description"),
  // Signing secret ("whsec_<base64>"), stored in plaintext by necessity (we must
  // compute an HMAC with it on every delivery, unlike a password/API key which
  // only ever needs one-way comparison). Never logged, never re-shown in full
  // after creation, never present in any event payload — see signing.ts.
  secret: text("secret").notNull(),
  eventTypes: jsonb("event_types").notNull(), // string[] of EVENT_TYPES, or ["*"] for all
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userIdx: index("webhook_subscriptions_user_id_idx").on(table.userId),
}));

// ── Webhook deliveries (one per subscription per matching event) ──────────────
/**
 * Mirrors the Content Distribution Engine's scheduled_publications claim
 * pattern: every dispatch (scheduler tick or a manual "redeliver" request) is
 * gated by an atomic claim + fencing token, so a race between the two can
 * never send the same delivery twice concurrently.
 */
export const webhookDeliveriesTable = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => webhookSubscriptionsTable.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => webhookEventsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  // Snapshot of the event payload at fan-out time, so a later change to the
  // subscription's config never alters what an in-flight/retried delivery sends.
  payload: jsonb("payload").notNull(),
  // pending | delivering | delivered | failed (terminal, retries exhausted)
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastResponseStatus: integer("last_response_status"),
  // Claim fields — see attemptDelivery()/reclaimStaleDeliveryClaims() in lib/webhooks/delivery.ts.
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimToken: text("claim_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  subscriptionIdx: index("webhook_deliveries_subscription_id_idx").on(table.subscriptionId),
  statusIdx: index("webhook_deliveries_status_idx").on(table.status),
}));

/** Visible attempt history for a delivery — every attempt audit-logged, never collapsed into a single last-error field. */
export const webhookDeliveryAttemptsTable = pgTable("webhook_delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => webhookDeliveriesTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  outcome: text("outcome").notNull(), // "success" | "failure"
  httpStatus: integer("http_status"),
  // Truncated response-body preview only — never the subscription secret, never full request/response headers.
  responsePreview: text("response_preview"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  deliveryIdx: index("webhook_delivery_attempts_delivery_id_idx").on(table.deliveryId),
}));

// ── Idempotency keys (safe retries for action endpoints) ───────────────────────
/**
 * One row per (userId, endpoint, idempotencyKey). A caller retrying the exact
 * same request (same key + same body) after a dropped response gets the
 * original response replayed, with no repeated side effect. A row stuck in
 * "in_progress" past IDEMPOTENCY_CLAIM_TIMEOUT_MS (see lib/automation/idempotency.ts)
 * is treated as an abandoned attempt (e.g. the process crashed mid-request)
 * and may be reclaimed, mirroring the stale-claim recovery pattern used
 * elsewhere in this codebase.
 */
export const idempotencyKeysTable = pgTable("idempotency_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress | completed
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  uniq: uniqueIndex("idempotency_keys_user_endpoint_key_idx").on(table.userId, table.endpoint, table.idempotencyKey),
}));

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ createdAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;

export const insertWebhookEventSchema = createInsertSchema(webhookEventsTable).omit({ createdAt: true });
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;

export const insertWebhookSubscriptionSchema = createInsertSchema(webhookSubscriptionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertWebhookSubscription = z.infer<typeof insertWebhookSubscriptionSchema>;
export type WebhookSubscription = typeof webhookSubscriptionsTable.$inferSelect;

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveriesTable).omit({ createdAt: true, updatedAt: true });
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type WebhookDelivery = typeof webhookDeliveriesTable.$inferSelect;

export const insertWebhookDeliveryAttemptSchema = createInsertSchema(webhookDeliveryAttemptsTable).omit({ createdAt: true });
export type InsertWebhookDeliveryAttempt = z.infer<typeof insertWebhookDeliveryAttemptSchema>;
export type WebhookDeliveryAttempt = typeof webhookDeliveryAttemptsTable.$inferSelect;

export const insertIdempotencyKeySchema = createInsertSchema(idempotencyKeysTable).omit({ createdAt: true, updatedAt: true });
export type InsertIdempotencyKey = z.infer<typeof insertIdempotencyKeySchema>;
export type IdempotencyKeyRecord = typeof idempotencyKeysTable.$inferSelect;
