import { pgTable, text, timestamp, integer, jsonb, boolean, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";
import { grantOpportunitiesTable } from "./grants";

/**
 * The grant source registry (docs/SOURCE_REGISTRY.md, GRANT_PLATFORM_PLAN.md §4).
 *
 * Every place opportunities come from is a row: the federal and state feeds
 * that have connectors in code, and the state portal pages and foundation or
 * corporate open-call pages that are watched for change. Sources are shared
 * reference data (public notices), like `grant_opportunities`; only owners and
 * admins with admin access unlocked may change them.
 */
export const grantSourcesTable = pgTable("grant_sources", {
  id: text("id").primaryKey(),
  /** Stable machine key. For `feed` sources it equals `grant_opportunities.source`. */
  key: text("key").notNull(),
  name: text("name").notNull(),
  /** federal | state | foundation | corporate */
  jurisdictionKind: text("jurisdiction_kind").notNull(),
  /** Two-letter state code for state sources ("CA"); null otherwise. */
  jurisdictionCode: text("jurisdiction_code"),
  /** feed | portal_page | watched_page */
  connectorType: text("connector_type").notNull(),
  /** For feeds: the connector in code that reads it (grants_gov, ca_grants_portal). Null for pages. */
  connector: text("connector"),
  /** The source's URLs; the first is the one watched or read. */
  urls: jsonb("urls").$type<string[]>().notNull().default([]),
  /** How often to check, in hours. */
  scheduleHours: integer("schedule_hours").notNull().default(24),
  /** Who keeps this row correct. */
  owner: text("owner"),
  /** active | paused | disabled. A source whose terms were not checked, or forbid automated reading, cannot be active. */
  status: text("status").notNull().default("disabled"),
  termsNote: text("terms_note"),
  termsChecked: boolean("terms_checked").notNull().default(false),
  /** The terms, as checked, permit automated reading. */
  termsPermitAutomation: boolean("terms_permit_automation").notNull().default(false),
  termsCheckedAt: timestamp("terms_checked_at", { withTimezone: true }),
  termsCheckedBy: text("terms_checked_by"),
  /** Days without a successful check before the source is stale; null uses SOURCE_STALE_DAYS. */
  staleAfterDays: integer("stale_after_days"),
  /** The changedetection.io watch UUID, when that backend watches this page. */
  watchId: text("watch_id"),
  watchSyncedAt: timestamp("watch_synced_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastContentHash: text("last_content_hash"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_grant_sources_key").on(table.key)]);

/** One check of a watched page: fetched, unchanged, changed or failed. */
export const grantSourceChecksTable = pgTable("grant_source_checks", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => grantSourcesTable.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  /** builtin | changedetection */
  backend: text("backend").notNull(),
  /** unchanged | changed | failed */
  outcome: text("outcome").notNull(),
  httpStatus: integer("http_status"),
  contentHash: text("content_hash"),
  bytes: integer("bytes"),
  /** The page's text when it changed, kept for the extraction job and as evidence. */
  pageText: text("page_text"),
  /** Links on the page, for checking that an extracted official URL appears on it. */
  pageLinks: jsonb("page_links").$type<string[]>(),
  drafts: integer("drafts").notNull().default(0),
  error: text("error"),
  jobId: text("job_id"),
}, (table) => [index("idx_grant_source_checks_source").on(table.sourceId, table.checkedAt)]);

/**
 * A candidate opportunity extracted from a watched page. Never shown to
 * applicants: a person approves it, and only then does it become a
 * `grant_opportunities` row, which still has to pass the publication gate.
 */
export const grantSourceDraftsTable = pgTable("grant_source_drafts", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => grantSourcesTable.id, { onDelete: "cascade" }),
  checkId: text("check_id").references(() => grantSourceChecksTable.id, { onDelete: "set null" }),
  /** Same opportunity across checks: a hash of the normalized title and official URL. */
  fingerprint: text("fingerprint").notNull(),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  title: text("title").notNull(),
  funder: text("funder"),
  /** YYYY-MM-DD, only when the page states it. */
  deadline: text("deadline"),
  rollingDeadline: boolean("rolling_deadline").notNull().default(false),
  /** posted | forecasted, as the page states it. */
  opportunityStatus: text("opportunity_status").notNull().default("posted"),
  amountMin: doublePrecision("amount_min"),
  amountMax: doublePrecision("amount_max"),
  eligibilitySummary: text("eligibility_summary"),
  /** nonprofit | business, only when the page says who may apply. */
  applicantKinds: jsonb("applicant_kinds").$type<string[]>().notNull().default([]),
  officialUrl: text("official_url"),
  /** The watched page the draft came from. */
  sourceUrl: text("source_url").notNull(),
  /** When the page was read. */
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  /** A short quote from the page supporting the draft. */
  evidence: text("evidence"),
  /** What the validator removed or could not confirm. */
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  /** Produced without an AI provider: labelled demo output, never approvable. */
  demo: boolean("demo").notNull().default(false),
  provider: text("provider"),
  opportunityId: text("opportunity_id").references(() => grantOpportunitiesTable.id, { onDelete: "set null" }),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("uq_grant_source_drafts_fp").on(table.sourceId, table.fingerprint),
  index("idx_grant_source_drafts_status").on(table.status, table.createdAt),
]);

export type GrantSource = typeof grantSourcesTable.$inferSelect;
export type GrantSourceCheck = typeof grantSourceChecksTable.$inferSelect;
export type GrantSourceDraft = typeof grantSourceDraftsTable.$inferSelect;
