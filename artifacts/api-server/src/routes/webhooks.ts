/**
 * Webhook subscription management + the internal event/delivery audit trail
 * a user inspects to debug their own automations. Session-authenticated only
 * (this is dashboard configuration, not an action an external tool calls).
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, desc, and } from "drizzle-orm";
import { db, webhookSubscriptionsTable, webhookEventsTable, webhookDeliveriesTable, webhookDeliveryAttemptsTable } from "@workspace/db";
import { getBrandOwned, getWebhookSubscriptionOwned, getWebhookDeliveryOwned } from "../middleware/ownershipHelpers";
import { generateWebhookSecret } from "../lib/webhooks/signing";
import { assertValidWebhookUrl, UnsafeWebhookUrlError } from "../lib/webhooks/urlSafety";
import { redeliverWebhookDelivery } from "../lib/webhooks/delivery";
import { EVENT_TYPES, isValidEventType } from "../lib/webhooks/events";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

function serializeSubscription(sub: typeof webhookSubscriptionsTable.$inferSelect, opts: { includeSecret?: boolean } = {}) {
  return {
    id: sub.id,
    brandId: sub.brandId,
    url: sub.url,
    description: sub.description,
    eventTypes: sub.eventTypes,
    isActive: sub.isActive,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    ...(opts.includeSecret ? { secret: sub.secret } : {}),
  };
}

// GET /webhooks/event-types — the full catalog, so a client can build a subscription form without hardcoding the list.
router.get("/webhooks/event-types", (_req, res): void => {
  res.json({ eventTypes: EVENT_TYPES });
});

// GET /webhooks/subscriptions
router.get("/webhooks/subscriptions", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const subs = await db.select().from(webhookSubscriptionsTable).where(eq(webhookSubscriptionsTable.userId, userId)).orderBy(desc(webhookSubscriptionsTable.createdAt));
  res.json(subs.map((s) => serializeSubscription(s)));
});

// POST /webhooks/subscriptions — the signing secret is returned in full only in this response.
router.post("/webhooks/subscriptions", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  const brandId = typeof req.body?.brandId === "string" ? req.body.brandId : null;
  const eventTypes = Array.isArray(req.body?.eventTypes) ? req.body.eventTypes : [];

  if (!url || !/^https?:\/\//.test(url)) { res.status(400).json({ error: "url must be a valid http(s) URL" }); return; }
  try {
    await assertValidWebhookUrl(url);
  } catch (err) {
    if (err instanceof UnsafeWebhookUrlError) { res.status(400).json({ error: `url ${err.message}` }); return; }
    throw err;
  }
  if (eventTypes.length === 0 || !eventTypes.every((t: unknown) => t === "*" || isValidEventType(t))) {
    res.status(400).json({ error: `eventTypes must be a non-empty array of: ${EVENT_TYPES.join(", ")}, or ["*"] for all` });
    return;
  }
  if (brandId) {
    const brand = await getBrandOwned(brandId, userId, res);
    if (!brand) return;
  }

  const [sub] = await db.insert(webhookSubscriptionsTable).values({
    id: randomUUID(),
    userId,
    brandId,
    url,
    description,
    secret: generateWebhookSecret(),
    eventTypes,
    isActive: true,
  }).returning();

  await logActivity("webhook_subscription_created", `Webhook subscription created for ${url}`, { userId }).catch(() => {});
  res.status(201).json(serializeSubscription(sub, { includeSecret: true }));
});

// PATCH /webhooks/subscriptions/:id — update url/description/eventTypes/isActive. Never rotates the secret (use a dedicated rotate action).
router.patch("/webhooks/subscriptions/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const sub = await getWebhookSubscriptionOwned(paramId(req.params.id), userId, res);
  if (!sub) return;

  const updates: Partial<typeof webhookSubscriptionsTable.$inferInsert> = {};
  if (typeof req.body?.url === "string") {
    if (!/^https?:\/\//.test(req.body.url)) { res.status(400).json({ error: "url must be a valid http(s) URL" }); return; }
    try {
      await assertValidWebhookUrl(req.body.url);
    } catch (err) {
      if (err instanceof UnsafeWebhookUrlError) { res.status(400).json({ error: `url ${err.message}` }); return; }
      throw err;
    }
    updates.url = req.body.url.trim();
  }
  if (typeof req.body?.description === "string" || req.body?.description === null) updates.description = req.body.description;
  if (Array.isArray(req.body?.eventTypes)) {
    if (req.body.eventTypes.length === 0 || !req.body.eventTypes.every((t: unknown) => t === "*" || isValidEventType(t))) {
      res.status(400).json({ error: `eventTypes must be a non-empty array of: ${EVENT_TYPES.join(", ")}, or ["*"] for all` });
      return;
    }
    updates.eventTypes = req.body.eventTypes;
  }
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;

  const [updated] = await db.update(webhookSubscriptionsTable).set(updates).where(eq(webhookSubscriptionsTable.id, sub.id)).returning();
  res.json(serializeSubscription(updated));
});

// POST /webhooks/subscriptions/:id/rotate-secret — issues a new signing secret, returned once.
router.post("/webhooks/subscriptions/:id/rotate-secret", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const sub = await getWebhookSubscriptionOwned(paramId(req.params.id), userId, res);
  if (!sub) return;
  const [updated] = await db.update(webhookSubscriptionsTable).set({ secret: generateWebhookSecret() }).where(eq(webhookSubscriptionsTable.id, sub.id)).returning();
  res.json(serializeSubscription(updated, { includeSecret: true }));
});

// DELETE /webhooks/subscriptions/:id
router.delete("/webhooks/subscriptions/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const sub = await getWebhookSubscriptionOwned(paramId(req.params.id), userId, res);
  if (!sub) return;
  await db.delete(webhookSubscriptionsTable).where(eq(webhookSubscriptionsTable.id, sub.id));
  res.status(204).send();
});

// GET /webhooks/events — the durable internal event journal, independent of any subscription.
router.get("/webhooks/events", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : undefined;
  const conditions = [eq(webhookEventsTable.userId, userId)];
  if (brandId) conditions.push(eq(webhookEventsTable.brandId, brandId));
  const events = await db.select().from(webhookEventsTable).where(and(...conditions)).orderBy(desc(webhookEventsTable.createdAt)).limit(200);
  res.json(events);
});

// GET /webhooks/subscriptions/:id/deliveries — a subscription's delivery queue/history.
router.get("/webhooks/subscriptions/:id/deliveries", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const sub = await getWebhookSubscriptionOwned(paramId(req.params.id), userId, res);
  if (!sub) return;
  const deliveries = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.subscriptionId, sub.id)).orderBy(desc(webhookDeliveriesTable.createdAt)).limit(200);
  res.json(deliveries);
});

// GET /webhooks/deliveries/:id/attempts — full audit-logged attempt history for one delivery.
router.get("/webhooks/deliveries/:id/attempts", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const delivery = await getWebhookDeliveryOwned(paramId(req.params.id), userId, res);
  if (!delivery) return;
  const attempts = await db.select().from(webhookDeliveryAttemptsTable).where(eq(webhookDeliveryAttemptsTable.deliveryId, delivery.id)).orderBy(desc(webhookDeliveryAttemptsTable.attemptNumber));
  res.json(attempts);
});

// POST /webhooks/deliveries/:id/redeliver — manual resend, reusing the exact same claim path as an automatic retry.
router.post("/webhooks/deliveries/:id/redeliver", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const delivery = await getWebhookDeliveryOwned(paramId(req.params.id), userId, res);
  if (!delivery) return;
  const result = await redeliverWebhookDelivery(delivery.id);
  if (result.outcome === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (result.outcome === "in_progress") { res.status(409).json({ error: "This delivery is currently in flight." }); return; }
  res.json({ outcome: result.outcome });
});

export default router;
