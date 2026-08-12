/**
 * Internal event model. This is the catalog every webhook subscription and
 * every developer-facing doc (docs/automation-api.md) is generated against —
 * add a new lifecycle action here first, then emit it at the call site.
 */
import { randomUUID } from "crypto";
import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { webhookEventsTable, webhookSubscriptionsTable, webhookDeliveriesTable } from "@workspace/db";

export const EVENT_TYPES = [
  "brand.created",
  "project.created",
  "project.workflow_stage_changed",
  "document.quality_evaluated",
  "repurposing.batch_completed",
  "repurposing.asset_approved",
  "publication.scheduled",
  "publication.published",
  "publication.failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isValidEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

export interface EmitEventInput {
  type: EventType;
  userId: string;
  brandId?: string | null;
  projectId?: string | null;
  /**
   * Event-specific data delivered to subscribers. Callers must never pass
   * secrets/credentials here (API keys, provider tokens, session data) —
   * this is a hard product invariant, not just a style preference.
   */
  data: Record<string, unknown>;
}

/**
 * Records the event in the durable journal and fans it out to every active,
 * matching webhook subscription as a pending delivery. Best-effort and
 * fire-and-forget from the caller's perspective — mirrors `logActivity`, a
 * webhook subscriber being unreachable must never affect the primary action
 * that triggered the event.
 */
export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    const eventId = `evt_${randomUUID()}`;
    const createdAt = new Date();
    await db.insert(webhookEventsTable).values({
      id: eventId,
      userId: input.userId,
      type: input.type,
      brandId: input.brandId ?? null,
      projectId: input.projectId ?? null,
      payload: input.data,
      createdAt,
    });

    const subscriptions = await db.select().from(webhookSubscriptionsTable).where(
      and(
        eq(webhookSubscriptionsTable.userId, input.userId),
        eq(webhookSubscriptionsTable.isActive, true),
        or(isNull(webhookSubscriptionsTable.brandId), input.brandId ? eq(webhookSubscriptionsTable.brandId, input.brandId) : isNull(webhookSubscriptionsTable.brandId)),
      ),
    );

    const matching = subscriptions.filter((sub) => {
      const types = (sub.eventTypes as string[]) ?? [];
      return types.includes("*") || types.includes(input.type);
    });
    if (matching.length === 0) return;

    const envelope = {
      id: eventId,
      type: input.type,
      createdAt: createdAt.toISOString(),
      data: input.data,
    };

    const now = new Date();
    await db.insert(webhookDeliveriesTable).values(
      matching.map((sub) => ({
        id: randomUUID(),
        subscriptionId: sub.id,
        eventId,
        eventType: input.type,
        payload: envelope,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
      })),
    );
  } catch (err) {
    console.error(`[webhooks] failed to emit event '${input.type}'`, err);
  }
}
