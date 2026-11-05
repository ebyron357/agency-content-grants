import { pgTable, text, timestamp, integer, bigint, jsonb, doublePrecision, index, primaryKey } from "drizzle-orm/pg-core";

/**
 * Foundation giving history (docs/GRANT_STUDIO.md, Foundations).
 *
 * Imported from the funder-graph dataset (IRS Form 990-PF Part XV and Form 990
 * Schedule I grant lines) by the `foundation_import` background job. This is
 * public reference data, like grant_opportunities: it belongs to no workspace
 * and holds nothing a workspace entered. It is funding history from tax
 * filings, never an open call.
 *
 * Only aggregates per funder and a bounded set of recent grants are stored, so
 * the full 15.3M-row dataset is never loaded into the database.
 */

/** One grant-making organization (the filer), with its giving aggregated across the imported filings. */
export const foundationFundersTable = pgTable("foundation_funders", {
  /** Nine digits, no dash. */
  ein: text("ein").primaryKey(),
  name: text("name").notNull(),
  /** Upper-cased name, for search. */
  nameSearch: text("name_search").notNull(),
  state: text("state"),
  /** 990PF or 990 (the form of the latest filing counted). */
  formType: text("form_type").notNull(),
  /** Grants paid (amount_type = paid) to organizations, in whole US dollars. */
  totalPaidUsd: bigint("total_paid_usd", { mode: "number" }).notNull(),
  grantCount: integer("grant_count").notNull(),
  firstTaxYear: integer("first_tax_year"),
  lastTaxYear: integer("last_tax_year"),
  /** { "2023": usd } */
  givingByYear: jsonb("giving_by_year").$type<Record<string, number>>().notNull().default({}),
  /** { "CA": usd, "foreign": usd, "unknown": usd } by recipient state. */
  givingByState: jsonb("giving_by_state").$type<Record<string, number>>().notNull().default({}),
  /** { "B": usd } by NTEE major group letter, or "unclassified". */
  givingByCategory: jsonb("giving_by_category").$type<Record<string, number>>().notNull().default({}),
  /** How each counted grant's category was found: { ntee, purpose, none } grant counts. */
  categorySources: jsonb("category_sources").$type<Record<string, number>>().notNull().default({}),
  /** Sparse log-scale histogram of grant sizes: { bucket: count }. */
  sizeHistogram: jsonb("size_histogram").$type<Record<string, number>>().notNull().default({}),
  /** Estimated from the histogram: { count, p25, median, p75, min, max }. */
  sizeStats: jsonb("size_stats").$type<Record<string, number>>().notNull().default({}),
  /** The tax period end (YYYY-MM-DD) of each filing counted, and its IRS object id: one filing per period. */
  filings: jsonb("filings").$type<Record<string, string>>().notNull().default({}),
  /** The most recent filing counted. */
  latestObjectId: text("latest_object_id"),
  latestTaxPeriodEnd: text("latest_tax_period_end"),
  latestSubmittedOn: text("latest_submitted_on"),
  datasetVersion: text("dataset_version"),
  importRunId: text("import_run_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_foundation_funders_total").on(table.totalPaidUsd),
  index("idx_foundation_funders_state").on(table.state),
]);

/** A bounded set of each funder's largest recent grants (the last three tax years it filed for). */
export const foundationGrantsTable = pgTable("foundation_grants", {
  funderEin: text("funder_ein").notNull().references(() => foundationFundersTable.ein, { onDelete: "cascade" }),
  /** funder-graph grant_id (a hash of the object id and row ordinal). */
  id: text("id").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientCity: text("recipient_city"),
  recipientState: text("recipient_state"),
  /** Shown only when funder-graph's match confidence met the import's minimum. */
  recipientEin: text("recipient_ein"),
  matchConfidence: doublePrecision("match_confidence"),
  amountUsd: bigint("amount_usd", { mode: "number" }).notNull(),
  taxYear: integer("tax_year").notNull(),
  purpose: text("purpose"),
  category: text("category"),
  objectId: text("object_id").notNull(),
}, (table) => [primaryKey({ columns: [table.funderEin, table.id] })]);

/** One import run: what was read, what was kept and why the rest was left out. */
export const foundationImportRunsTable = pgTable("foundation_import_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id"),
  /** running | succeeded | partial | failed */
  status: text("status").notNull(),
  baseUrl: text("base_url").notNull(),
  datasetVersion: text("dataset_version"),
  years: jsonb("years").$type<number[]>().notNull().default([]),
  yearsDone: jsonb("years_done").$type<number[]>().notNull().default([]),
  minConfidence: doublePrecision("min_confidence").notNull(),
  /** Counters: rows read, kept, and each exclusion reason. */
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  funders: integer("funders").notNull().default(0),
  grantsStored: integer("grants_stored").notNull().default(0),
  /** Bytes used by the foundation tables when the run ended. */
  bytesUsed: bigint("bytes_used", { mode: "number" }),
  note: text("note"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type FoundationFunder = typeof foundationFundersTable.$inferSelect;
export type FoundationGrant = typeof foundationGrantsTable.$inferSelect;
export type FoundationImportRun = typeof foundationImportRunsTable.$inferSelect;
