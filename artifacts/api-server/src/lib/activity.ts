import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { currentActorName } from "./requestContext";

/**
 * Persist an activity/audit record. Best-effort: failures are logged by the
 * caller's request logger but never block the primary action.
 */
export async function logActivity(
  type: string,
  description: string,
  opts: { userId?: string; projectId?: string; projectTitle?: string; brandName?: string; actorName?: string | null } = {},
): Promise<void> {
  await db.insert(activityLogTable).values({
    id: randomUUID(),
    type,
    description,
    userId: opts.userId,
    projectId: opts.projectId,
    projectTitle: opts.projectTitle,
    brandName: opts.brandName,
    // Explicit when given; otherwise the person making the current request.
    actorName: opts.actorName ?? currentActorName(),
  });
}
