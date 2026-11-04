-- Migration: workspaces, members, memberships and invitations (docs/SECURITY_AND_ACCESS_HANDOFF.md).
-- A workspace owns its data through its own principal row in "users", so every
-- existing ownership check (session.userId) scopes to the workspace.
CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "principal_user_id" text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE RESTRICT,
  "kind" text DEFAULT 'client' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_sign_in_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_members_email" ON "members" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_membership" ON "memberships" ("member_id", "workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memberships_workspace" ON "memberships" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_invites" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "invited_by" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invites_workspace" ON "workspace_invites" ("workspace_id");
