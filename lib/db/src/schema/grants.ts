import { pgTable, text, timestamp, integer, jsonb, boolean, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Grant Studio (docs/GRANT_STUDIO.md).
 *
 * Every applicant record belongs to the signed-in operator (`user_id`), and every
 * child record belongs to an applicant. Routes check that chain on every request,
 * so one operator can never read another operator's applicants, applications or
 * budgets.
 */

/** An organization that applies for grants: a nonprofit or a business. */
export const grantApplicantsTable = pgTable("grant_applicants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** One of APPLICANT_TYPES in the API's grants/eligibility module. */
  applicantType: text("applicant_type").notNull(),
  ein: text("ein"),
  uei: text("uei"),
  state: text("state"),
  serviceArea: text("service_area"),
  mission: text("mission"),
  /** Topics the organization works on; used for matching. */
  focusAreas: jsonb("focus_areas").$type<string[]>().notNull().default([]),
  naicsCodes: jsonb("naics_codes").$type<string[]>().notNull().default([]),
  annualBudget: integer("annual_budget"),
  /** The largest cost share or match the organization can commit, as a percentage (0 = none). */
  maxCostSharePercent: integer("max_cost_share_percent").notNull().default(0),
  /** Principal office (or main project site) street address, used when checking place designations. */
  principalAddress: text("principal_address"),
  /** Census tract GEOID (11 digits) of that address, from the Census Geocoder. */
  censusTract: text("census_tract"),
  /** County FIPS code (5 digits). */
  countyFips: text("county_fips"),
  /**
   * Place designations a person checked on each agency's own tool: Opportunity
   * Zone, HUBZone, HUD QCT and DDA, persistent poverty, USDA rural. Keyed by
   * PLACE_DESIGNATIONS in the API's grants/places module.
   */
  placeDesignations: jsonb("place_designations").$type<Record<string, unknown>>().notNull().default({}),
  /** When the user last marked this organization's matches as seen; later opportunities count as new. */
  matchesSeenAt: timestamp("matches_seen_at", { withTimezone: true }),
  /** When the last new-matches webhook event was emitted for this organization. */
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_applicants_user").on(table.userId)]);

/** A readiness item: SAM.gov registration, IRS determination letter, audit and so on. */
export const grantReadinessItemsTable = pgTable("grant_readiness_items", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => grantApplicantsTable.id, { onDelete: "cascade" }),
  /** One of READINESS_KINDS. */
  kind: text("kind").notNull(),
  /** missing | in_progress | ready */
  status: text("status").notNull().default("missing"),
  expiresOn: text("expires_on"),
  note: text("note"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_grant_readiness_kind").on(table.applicantId, table.kind)]);

/**
 * A funding opportunity, from an official source. Opportunities are shared
 * reference data (public notices), not applicant data.
 */
export const grantOpportunitiesTable = pgTable("grant_opportunities", {
  id: text("id").primaryKey(),
  /** grants_gov (the only live connector so far) */
  source: text("source").notNull(),
  /** The id the source uses (Grants.gov opportunity id). */
  sourceRef: text("source_ref").notNull(),
  number: text("number"),
  title: text("title").notNull(),
  agency: text("agency"),
  agencyCode: text("agency_code"),
  /** posted | forecasted | closed | archived */
  status: text("status").notNull(),
  openDate: text("open_date"),
  closeDate: text("close_date"),
  awardFloor: doublePrecision("award_floor"),
  awardCeiling: doublePrecision("award_ceiling"),
  estimatedFunding: doublePrecision("estimated_funding"),
  costSharing: boolean("cost_sharing"),
  /** Required match as a percentage, when the source states one (California lists "25%"). */
  costSharePercent: integer("cost_share_percent"),
  /** The source states the program accepts applications on a rolling basis ("Ongoing"), so there is no closing date. */
  rollingDeadline: boolean("rolling_deadline").notNull().default(false),
  /** Null for federal programs; a state code ("CA") for state programs, which generally serve applicants or projects in that state. */
  jurisdiction: text("jurisdiction"),
  /** Grants.gov applicant-type codes, e.g. "12", "23". */
  eligibilityCodes: jsonb("eligibility_codes").$type<string[]>().notNull().default([]),
  eligibilityText: text("eligibility_text"),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  assistanceListings: jsonb("assistance_listings").$type<string[]>().notNull().default([]),
  description: text("description"),
  officialUrl: text("official_url").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  /** When the full opportunity record (not only the search row) was last read. */
  detailFetchedAt: timestamp("detail_fetched_at", { withTimezone: true }),
  checksum: text("checksum").notNull(),
  connectorVersion: text("connector_version").notNull(),
  /** Result of the publication gate: an opportunity is shown to applicants only when this is true. */
  publishable: boolean("publishable").notNull().default(false),
  gateMissing: jsonb("gate_missing").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("uq_grant_opportunity_source").on(table.source, table.sourceRef),
  index("idx_grant_opportunities_close").on(table.closeDate),
]);

/** One run of a source connector, kept for source health and evidence. */
export const grantSyncRunsTable = pgTable("grant_sync_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** running | succeeded | failed */
  status: text("status").notNull(),
  fetched: integer("fetched").notNull().default(0),
  upserted: integer("upserted").notNull().default(0),
  error: text("error"),
});

/** An application: one applicant, one opportunity, one package. */
export const grantApplicationsTable = pgTable("grant_applications", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => grantApplicantsTable.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").notNull().references(() => grantOpportunitiesTable.id, { onDelete: "restrict" }),
  /** federal_nonprofit | federal_business | sbir_sttr | foundation */
  template: text("template").notNull(),
  /** draft | in_review | approved | exported */
  status: text("status").notNull().default("draft"),
  title: text("title").notNull(),
  requestedAmount: doublePrecision("requested_amount"),
  /** The applicant's confirmation of the eligibility reasons (charter: a human approves eligibility). */
  eligibilityConfirmedAt: timestamp("eligibility_confirmed_at", { withTimezone: true }),
  eligibilityConfirmedBy: text("eligibility_confirmed_by"),
  eligibilityNote: text("eligibility_note"),
  /** Notice of funding opportunity text the applicant pasted, used for requirement extraction. */
  noticeText: text("notice_text"),
  indirectRatePercent: doublePrecision("indirect_rate_percent").notNull().default(0),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  /** The last deadline reminder threshold (days before closing) sent as a webhook event. */
  deadlineAlertDays: integer("deadline_alert_days"),
  /** A person's record of what happened after export: submitted, awarded, declined or withdrawn. Grant Studio never submits. */
  outcome: text("outcome"),
  /** ISO date of the latest outcome (submission date, decision date or withdrawal date). */
  outcomeDate: text("outcome_date"),
  submittedOn: text("submitted_on"),
  /** The funder's tracking number, for example a Grants.gov GRANT########. */
  trackingNumber: text("tracking_number"),
  /** The amount requested, captured when the submission is recorded. */
  submittedAmount: doublePrecision("submitted_amount"),
  awardedAmount: doublePrecision("awarded_amount"),
  outcomeNote: text("outcome_note"),
  outcomeRecordedBy: text("outcome_recorded_by"),
  /** Font, size, spacing, margins, narrative page limit and package file name from the notice (writing toolkit). */
  formatProfile: jsonb("format_profile").$type<Record<string, unknown>>().notNull().default({}),
  /** The competitiveness rating (0–100) and band frozen when the submission was recorded, for calibration against outcomes. */
  ratingAtSubmission: integer("rating_at_submission"),
  ratingBandAtSubmission: text("rating_band_at_submission"),
  /** The logic model: inputs, activities, outputs, outcomes and assumptions, each a list. */
  logicModel: jsonb("logic_model").$type<Record<string, string[]>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_grant_application").on(table.applicantId, table.opportunityId)]);

/** A row of the compliance matrix: one requirement from the funding notice. */
export const grantRequirementsTable = pgTable("grant_requirements", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => grantApplicationsTable.id, { onDelete: "cascade" }),
  /** section | attachment | form | eligibility | formatting | criterion | deadline */
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  detail: text("detail"),
  /** Where in the notice it came from (page or heading), or "template" for defaults. */
  sourceRef: text("source_ref"),
  /** The section that answers it, when kind is section or criterion. */
  sectionKey: text("section_key"),
  points: integer("points"),
  /** open | covered | not_applicable */
  status: text("status").notNull().default("open"),
  /** template | extracted | manual */
  origin: text("origin").notNull().default("template"),
  confirmed: boolean("confirmed").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_requirements_app").on(table.applicationId)]);

/** A narrative section of the application. */
export const grantSectionsTable = pgTable("grant_sections", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => grantApplicationsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  title: text("title").notNull(),
  guidance: text("guidance"),
  /** words | characters | pages (pages are counted at 500 words per page) */
  limitType: text("limit_type"),
  limitValue: integer("limit_value"),
  /** Sanitized rich text (HTML). */
  content: text("content").notNull().default(""),
  /** empty | drafting | ready_for_review | approved */
  status: text("status").notNull().default("empty"),
  /** True when the latest content came from the demo provider (no AI key configured). */
  demoContent: boolean("demo_content").notNull().default(false),
  reviewScore: integer("review_score"),
  reviewNotes: jsonb("review_notes").$type<string[]>().notNull().default([]),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_grant_section_key").on(table.applicationId, table.key)]);

/** A budget line in the SF-424A object-class categories. */
export const grantBudgetLinesTable = pgTable("grant_budget_lines", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => grantApplicationsTable.id, { onDelete: "cascade" }),
  /** One of BUDGET_CATEGORIES. */
  category: text("category").notNull(),
  description: text("description").notNull(),
  quantity: doublePrecision("quantity").notNull().default(1),
  unitCost: doublePrecision("unit_cost").notNull().default(0),
  /** Share of the line paid by the applicant as cost share or match, 0 to 100. */
  matchPercent: doublePrecision("match_percent").notNull().default(0),
  justification: text("justification"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_budget_app").on(table.applicationId)]);

/** An approval recorded in the application's audit trail. */
export const grantApprovalsTable = pgTable("grant_approvals", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => grantApplicationsTable.id, { onDelete: "cascade" }),
  /** eligibility | section | package */
  scope: text("scope").notNull(),
  subjectId: text("subject_id"),
  /** writer | reviewer | authorized_representative */
  role: text("role").notNull(),
  approvedBy: text("approved_by").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_grant_approvals_app").on(table.applicationId)]);

export type GrantApplicant = typeof grantApplicantsTable.$inferSelect;
export type GrantReadinessItem = typeof grantReadinessItemsTable.$inferSelect;
export type GrantOpportunity = typeof grantOpportunitiesTable.$inferSelect;
export type GrantApplication = typeof grantApplicationsTable.$inferSelect;
export type GrantRequirement = typeof grantRequirementsTable.$inferSelect;
export type GrantSection = typeof grantSectionsTable.$inferSelect;
export type GrantBudgetLine = typeof grantBudgetLinesTable.$inferSelect;
export type GrantApproval = typeof grantApprovalsTable.$inferSelect;

/**
 * The organization's fact library: reusable, sourced statements (history,
 * programs, outcomes, staff, partners, finances, community need). Only facts a
 * person has confirmed are given to AI drafting, which may use nothing else.
 */
export const grantFactsTable = pgTable("grant_facts", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => grantApplicantsTable.id, { onDelete: "cascade" }),
  /** One of FACT_CATEGORIES in the API's grants/facts module. */
  category: text("category").notNull(),
  label: text("label").notNull(),
  body: text("body").notNull(),
  /** Where the fact comes from: a document, report or URL. */
  source: text("source"),
  /** ISO date the fact was true as of. */
  asOf: text("as_of"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_facts_applicant").on(table.applicantId)]);

export type GrantFact = typeof grantFactsTable.$inferSelect;

/**
 * Saved writing: approved section text an organization keeps to reuse in later
 * applications. Only approved, non-demo sections can be saved, so everything
 * here has passed a person's review once.
 */
export const grantSnippetsTable = pgTable("grant_snippets", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull().references(() => grantApplicantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** The template section key it was written for (for example "capacity"), used to suggest it for the same section later. */
  sectionKey: text("section_key").notNull(),
  /** Sanitized HTML. */
  content: text("content").notNull(),
  /** Where it came from; kept as text so deleting the application does not delete the saved writing. */
  sourceApplicationId: text("source_application_id"),
  sourceLabel: text("source_label"),
  savedBy: text("saved_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_snippets_applicant").on(table.applicantId)]);

export type GrantSnippet = typeof grantSnippetsTable.$inferSelect;

/**
 * Application templates a workspace made or customized (docs/GRANT_STUDIO.md).
 * Built-in templates live in the API's lib/grants/templates.ts and are read
 * only; a workspace duplicates one to change it. An application copies its
 * template's sections and requirements when it starts, so editing a template
 * never changes applications already under way.
 */
export const grantTemplatesTable = pgTable("grant_templates", {
  id: text("id").primaryKey(),
  /** The workspace principal that owns the template. */
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  description: text("description"),
  /** The built-in template it started from, if any. */
  basedOn: text("based_on"),
  /** When it is chosen automatically: { applicantKind, jurisdiction, titleIncludes }. */
  appliesTo: jsonb("applies_to").notNull(),
  sections: jsonb("sections").notNull(),
  requirements: jsonb("requirements").notNull(),
  /** "active" or "archived". Archived templates are not offered for new applications. */
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_templates_user").on(table.userId)]);

export type GrantTemplate = typeof grantTemplatesTable.$inferSelect;

/** A letter of support or commitment the application needs from a partner. */
export const grantSupportLettersTable = pgTable("grant_support_letters", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => grantApplicationsTable.id, { onDelete: "cascade" }),
  /** The person asked. */
  name: text("name").notNull(),
  organization: text("organization"),
  /** What they commit to or speak to, for example "Hosts the after-school sessions". */
  purpose: text("purpose"),
  email: text("email"),
  /** to_request | requested | received | declined */
  status: text("status").notNull().default("to_request"),
  requestedOn: text("requested_on"),
  dueOn: text("due_on"),
  receivedOn: text("received_on"),
  /** The compliance-matrix row the letter answers, when there is one. */
  requirementId: text("requirement_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("idx_grant_letters_app").on(table.applicationId)]);

export type GrantSupportLetter = typeof grantSupportLettersTable.$inferSelect;
