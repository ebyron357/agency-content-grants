import { pgTable, text, timestamp, uniqueIndex, index, boolean, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Workspaces (tenants) and the people in them.
 *
 * All application data is owned by a `users` row and every route checks
 * ownership against `session.userId`. A workspace owns its data through its
 * own principal row in `users`: signing in to a workspace puts that principal
 * in `session.userId`, so every existing ownership check scopes to the
 * workspace. People are `members`; a member belongs to workspaces through
 * `memberships`, each with a role.
 */
export const workspacesTable = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The data owner: the users row all of this workspace's records belong to. */
  principalUserId: text("principal_user_id").notNull().unique().references(() => usersTable.id, { onDelete: "restrict" }),
  /** "agency" for the operator's own workspace, "client" for organizations it serves or that sign up. */
  kind: text("kind").notNull().default("client"),
  /** When true, members must use two-factor sign-in before they can use the workspace. */
  requireMfa: boolean("require_mfa").notNull().default(false),
  /** "operator" when the operator created it, "self_signup" when its owner signed up (docs/SELF_SIGNUP.md). */
  createdVia: text("created_via").notNull().default("operator"),
  /** When someone hid the getting-started checklist. The setup wizard stays reachable. */
  onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** A person with their own sign-in. */
export const membersTable = pgTable("members", {
  id: text("id").primaryKey(),
  /** Stored lowercased and trimmed. */
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** "active" or "disabled". */
  status: text("status").notNull().default("active"),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  /** Authenticator (TOTP) secret, encrypted at rest (see the API's lib/mfa.ts). Null until two-factor is on. */
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** The last time step a code was accepted for, so a code cannot be used twice. */
  totpLastStep: integer("totp_last_step"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_members_email").on(table.email)]);

export const membershipsTable = pgTable("memberships", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => membersTable.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  /** One of ROLES in the API's workspaces module. */
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("uq_membership").on(table.memberId, table.workspaceId), index("idx_memberships_workspace").on(table.workspaceId)]);

/** An invitation to join a workspace. Only a SHA-256 hash of the token is stored. */
export const invitesTable = pgTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_invites_workspace").on(table.workspaceId)]);

/**
 * One row per signed-in browser of a member. The session cookie carries the row id;
 * revoking the row ends that session on its next request, whatever the session store.
 */
export const memberSessionsTable = pgTable("member_sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => membersTable.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  /** "password", "mfa" or "recovery_code": how the sign-in was completed. */
  method: text("method").notNull().default("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [index("idx_member_sessions_member").on(table.memberId)]);

/** Single-use recovery codes for two-factor sign-in. Only a SHA-256 hash is stored. */
export const memberRecoveryCodesTable = pgTable("member_recovery_codes", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => membersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_recovery_codes_member").on(table.memberId)]);

export type Workspace = typeof workspacesTable.$inferSelect;
export type Member = typeof membersTable.$inferSelect;
export type Membership = typeof membershipsTable.$inferSelect;
export type WorkspaceInvite = typeof invitesTable.$inferSelect;
export type MemberSession = typeof memberSessionsTable.$inferSelect;
