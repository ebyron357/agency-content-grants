import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scheduledPublicationsTable } from "./publishing";
import { brandsTable } from "./brands";

/**
 * Content Performance Engine — append-only ingested metrics.
 * See docs/decisions/content-performance-engine.md for why this is an
 * extension of the existing PublishProvider adapter (Typefully's real
 * analytics endpoint) rather than a separate ingestion path.
 *
 * One row per (publication, ingestion run). NEVER updated/overwritten —
 * trends over time come from querying the row history for a publication,
 * not from a mutable "current stats" column. A publication only gains a
 * snapshot once scheduled_publications.status = 'published': pending,
 * failed, or cancelled content was never actually sent to the platform, so
 * it must never get a fabricated performance number.
 */
export const performanceSnapshotsTable = pgTable("performance_snapshots", {
  id: text("id").primaryKey(),
  scheduledPublicationId: text("scheduled_publication_id").notNull().references(() => scheduledPublicationsTable.id, { onDelete: "cascade" }),
  // Which provider/adapter produced this snapshot ("typefully" | "demo").
  // Demo-sourced rows are simulated data for local dev/testing and must
  // never be conflated with real platform numbers in the UI.
  source: text("source").notNull(),
  // The provider's post/draft id these metrics describe — denormalized from
  // scheduled_publications.externalPostId at ingestion time for audit clarity.
  externalPostId: text("external_post_id").notNull(),
  postUrl: text("post_url"),
  // Normalized indicator fields shared across providers. Required fields are
  // ones every provider analytics response is expected to supply; nullable
  // ones (quotes/saves/profileClicks/linkClicks) reflect Typefully's own
  // schema, where some metrics are "when available".
  impressions: integer("impressions").notNull(),
  engagementTotal: integer("engagement_total").notNull(),
  likes: integer("likes").notNull(),
  comments: integer("comments").notNull(),
  shares: integer("shares").notNull(),
  quotes: integer("quotes"),
  saves: integer("saves"),
  profileClicks: integer("profile_clicks"),
  linkClicks: integer("link_clicks"),
  // Full provider payload for this post's analytics at ingestion time — audit
  // trail and a forward-compatible home for indicators not yet promoted to
  // their own normalized column.
  raw: jsonb("raw"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rule-based, evidence-backed suggestions derived from ingested performance
 * data. Persisted (not purely computed-on-request) so a user's decision to
 * accept or dismiss a specific suggestion survives future recomputation —
 * `dedupeKey` is the stable natural key re-generation upserts against.
 */
export const performanceRecommendationsTable = pgTable("performance_recommendations", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // repurpose_top_performer | double_down_channel | topic_momentum | format_underperformance
  title: text("title").notNull(),
  // Must explicitly frame evidence as correlation, never unsupported
  // causation — enforced by the generator in lib/performance/recommendations.ts,
  // not just a convention.
  rationale: text("rationale").notNull(),
  evidence: jsonb("evidence").notNull(),
  subjectType: text("subject_type").notNull(), // document | channel | topic | campaign
  subjectId: text("subject_id"),
  subjectLabel: text("subject_label").notNull(),
  // brandId + kind + subjectType + subjectId(or label) — stable across
  // recomputation so accept/dismiss state is never silently reset.
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | accepted | dismissed
  actedAt: timestamp("acted_at", { withTimezone: true }),
  actedNote: text("acted_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPerformanceSnapshotSchema = createInsertSchema(performanceSnapshotsTable).omit({ capturedAt: true });
export type InsertPerformanceSnapshot = z.infer<typeof insertPerformanceSnapshotSchema>;
export type PerformanceSnapshot = typeof performanceSnapshotsTable.$inferSelect;

export const insertPerformanceRecommendationSchema = createInsertSchema(performanceRecommendationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPerformanceRecommendation = z.infer<typeof insertPerformanceRecommendationSchema>;
export type PerformanceRecommendation = typeof performanceRecommendationsTable.$inferSelect;
