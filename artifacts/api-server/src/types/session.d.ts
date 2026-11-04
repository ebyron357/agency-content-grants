import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    /** The data owner: the signed-in workspace's principal user. Every ownership check uses it. */
    userId?: string;
    /** The person signed in; absent for the shared operator password. */
    memberId?: string;
    workspaceId?: string;
    /** The member's role in the signed-in workspace. */
    role?: string;
    /** Name recorded on approvals and outcomes. */
    actorName?: string;
    /** The member_sessions row for this browser; revoking it ends the session. */
    memberSessionId?: string;
    /** Password accepted, waiting for the two-factor code. Not signed in yet. */
    pendingMfa?: { memberId: string; workspaceId: string; at: number; attempts: number };
    /** A two-factor secret being set up, until the first code confirms it. */
    mfaSetup?: { secret: string; at: number };
  }
}
