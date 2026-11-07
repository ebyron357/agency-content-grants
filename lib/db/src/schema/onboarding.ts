import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Self sign-up and onboarding (docs/SELF_SIGNUP.md).
 *
 * `pending_signups` holds a sign-up until its owner opens the verification
 * link. Nothing is created in `members`, `workspaces` or `users` before then,
 * so an unverified sign-up never becomes an account. Only a SHA-256 hash of
 * the token is stored; the password is stored only as its scrypt hash.
 *
 * `nonprofit_lookups` caches organization records from the ProPublica
 * Nonprofit Explorer API (public IRS data). It is shared reference data, like
 * grant opportunities: it belongs to no workspace and holds nothing a
 * workspace entered.
 */
export const pendingSignupsTable = pgTable("pending_signups", {
  id: text("id").primaryKey(),
  /** Stored lowercased and trimmed. */
  email: text("email").notNull(),
  name: text("name").notNull(),
  organizationName: text("organization_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_pending_signups_email").on(table.email)]);

export const nonprofitLookupsTable = pgTable("nonprofit_lookups", {
  /** Nine digits, no dash. */
  ein: text("ein").primaryKey(),
  /** "found" or "not_found". Failed requests are never cached. */
  status: text("status").notNull(),
  /** The fields read from the source (see the API's lib/onboarding/propublica.ts), not the raw response. */
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  source: text("source").notNull().default("propublica_nonprofit_explorer_v2"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export type PendingSignup = typeof pendingSignupsTable.$inferSelect;
export type NonprofitLookup = typeof nonprofitLookupsTable.$inferSelect;
