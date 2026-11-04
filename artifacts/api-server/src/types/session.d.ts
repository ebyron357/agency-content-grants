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
  }
}
