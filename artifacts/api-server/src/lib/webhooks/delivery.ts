/**
 * Webhook delivery dispatch — retry/backoff and claim/fencing-token logic
 * that exactly mirrors the Content Distribution Engine's
 * `publishing-workflow.ts` (see docs/decisions/automation-webhook-foundation.md
 * for why). Every HTTP POST to a subscriber is gated by an atomic claim so a
 * scheduler tick and a manual "redeliver" click can never both fire the same
 * delivery concurrently.
 */
import { randomUUID } from "crypto";
import { and, eq, lte, lt, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { webhookDeliveriesTable, webhookSubscriptionsTable, webhookDeliveryAttemptsTable } from "@workspace/db";
import type { WebhookDelivery } from "@workspace/db";
import { signWebhook } from "./signing";
import { safeHttpRequest } from "./urlSafety";

export const RETRY_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;
export const CLAIM_TIMEOUT_MS = 2 * 60_000;
export const DELIVERY_TIMEOUT_MS = 10_000;
const RESPONSE_PREVIEW_MAX_CHARS = 500;

export function backoffForAttempt(attemptNumber: number): number {
  const idx = Math.min(attemptNumber - 1, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[Math.max(idx, 0)];
}

async function claimDelivery(id: string, fromStatuses: string[]): Promise<WebhookDelivery | null> {
  const token = randomUUID();
  const [row] = await db.update(webhookDeliveriesTable)
    .set({ status: "delivering", claimedAt: new Date(), claimToken: token })
    .where(and(eq(webhookDeliveriesTable.id, id), or(...fromStatuses.map((s) => eq(webhookDeliveriesTable.status, s)))))
    .returning();
  return row ?? null;
}

async function finalizeClaim(id: string, claimToken: string, updates: Partial<typeof webhookDeliveriesTable.$inferInsert>): Promise<WebhookDelivery | null> {
  const [row] = await db.update(webhookDeliveriesTable)
    .set(updates)
    .where(and(eq(webhookDeliveriesTable.id, id), eq(webhookDeliveriesTable.claimToken, claimToken)))
    .returning();
  return row ?? null;
}

async function recordAttempt(deliveryId: string, attemptNumber: number, outcome: "success" | "failure", opts: { httpStatus?: number | null; responsePreview?: string | null; errorMessage?: string | null; durationMs: number }) {
  await db.insert(webhookDeliveryAttemptsTable).values({
    id: randomUUID(),
    deliveryId,
    attemptNumber,
    outcome,
    httpStatus: opts.httpStatus ?? null,
    responsePreview: opts.responsePreview ?? null,
    errorMessage: opts.errorMessage ?? null,
    durationMs: opts.durationMs,
  });
}

/** Attempt a due delivery (initial send or a retry). Safe to call concurrently with itself for the same row — only one caller wins the claim. */
export async function attemptDelivery(delivery: WebhookDelivery): Promise<void> {
  const claimed = await claimDelivery(delivery.id, ["pending"]);
  if (!claimed) return; // lost the race, or no longer pending
  const token = claimed.claimToken!;
  const attemptNumber = claimed.attemptCount + 1;
  const now = new Date();

  const [subscription] = await db.select().from(webhookSubscriptionsTable).where(eq(webhookSubscriptionsTable.id, claimed.subscriptionId)).limit(1);
  if (!subscription || !subscription.isActive) {
    const finalized = await finalizeClaim(claimed.id, token, {
      status: "failed", attemptCount: attemptNumber, lastAttemptAt: now,
      lastError: "Subscription was removed or deactivated.",
    });
    if (finalized) await recordAttempt(claimed.id, attemptNumber, "failure", { errorMessage: "Subscription was removed or deactivated.", durationMs: 0 });
    return;
  }

  const body = JSON.stringify(claimed.payload);
  // The delivery id (not the event id) is the signature's "id" — stable
  // across retries of this exact delivery, distinct per subscriber, which is
  // what lets a subscriber dedupe on `webhook-id` if a retry arrives after
  // they already processed a prior attempt's response was lost in transit.
  const headers = signWebhook(subscription.secret, claimed.id, body);

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    // Uses safeHttpRequest (not global fetch) — it resolves and validates the
    // destination address itself and pins the connection to it, which is
    // what prevents this scheduler from being turned into an SSRF proxy
    // against internal/private addresses. See urlSafety.ts.
    const response = await safeHttpRequest(subscription.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    const text = await response.text().catch(() => "");
    const preview = text.slice(0, RESPONSE_PREVIEW_MAX_CHARS);

    if (response.ok) {
      const finalized = await finalizeClaim(claimed.id, token, {
        status: "delivered", attemptCount: attemptNumber, lastAttemptAt: now,
        lastError: null, lastResponseStatus: response.status,
      });
      if (finalized) await recordAttempt(claimed.id, attemptNumber, "success", { httpStatus: response.status, responsePreview: preview, durationMs });
      return;
    }

    const exhausted = attemptNumber >= MAX_ATTEMPTS;
    const errorMessage = `Subscriber responded with HTTP ${response.status}.`;
    const finalized = await finalizeClaim(claimed.id, token, {
      status: exhausted ? "failed" : "pending",
      attemptCount: attemptNumber, lastAttemptAt: now,
      lastError: errorMessage, lastResponseStatus: response.status,
      nextAttemptAt: exhausted ? claimed.nextAttemptAt : new Date(now.getTime() + backoffForAttempt(attemptNumber)),
    });
    if (finalized) await recordAttempt(claimed.id, attemptNumber, "failure", { httpStatus: response.status, responsePreview: preview, errorMessage, durationMs });
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = (err as Error).name === "AbortError" ? `Subscriber did not respond within ${DELIVERY_TIMEOUT_MS}ms.` : (err as Error).message;
    const exhausted = attemptNumber >= MAX_ATTEMPTS;
    const finalized = await finalizeClaim(claimed.id, token, {
      status: exhausted ? "failed" : "pending",
      attemptCount: attemptNumber, lastAttemptAt: now,
      lastError: message,
      nextAttemptAt: exhausted ? claimed.nextAttemptAt : new Date(now.getTime() + backoffForAttempt(attemptNumber)),
    });
    if (finalized) await recordAttempt(claimed.id, attemptNumber, "failure", { errorMessage: message, durationMs });
  } finally {
    clearTimeout(timeout);
  }
}

/** Recover deliveries whose claim was abandoned by a crashed process, same rationale as reclaimStaleClaims() in publishing-workflow.ts. */
export async function reclaimStaleDeliveryClaims(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const stale = await db.select().from(webhookDeliveriesTable).where(
    and(eq(webhookDeliveriesTable.status, "delivering"), lt(webhookDeliveriesTable.claimedAt, staleBefore)),
  );
  for (const delivery of stale) {
    // A delivery is a plain HTTP POST with no side effect on our own data —
    // unlike a publish call, resubmitting it is always safe (subscribers are
    // expected to dedupe on `webhook-id` per the Standard Webhooks contract),
    // so an interrupted attempt simply goes back to pending for retry.
    await db.update(webhookDeliveriesTable).set({
      status: "pending", claimToken: null, nextAttemptAt: now,
      lastError: "Recovered from an interrupted delivery attempt (process restarted or the request timed out).",
    }).where(and(eq(webhookDeliveriesTable.id, delivery.id), eq(webhookDeliveriesTable.status, "delivering"), eq(webhookDeliveriesTable.claimToken, delivery.claimToken!)));
  }
}

/** One scheduler tick: reclaim stale claims, then attempt every due pending delivery. */
export async function processDueDeliveries(): Promise<{ attempted: number }> {
  const now = new Date();
  await reclaimStaleDeliveryClaims(now);

  const due = await db.select().from(webhookDeliveriesTable).where(
    and(eq(webhookDeliveriesTable.status, "pending"), lte(webhookDeliveriesTable.nextAttemptAt, now)),
  );
  for (const delivery of due) {
    await attemptDelivery(delivery);
  }
  return { attempted: due.length };
}

/**
 * Manually re-send a delivery (terminal or not) — puts it back to "pending"
 * so the next scheduler tick attempts it through the exact same claim path
 * as an automatic retry. Refused only while a send is actively in flight
 * right now, to avoid a redundant concurrent POST to the same subscriber.
 */
export async function redeliverWebhookDelivery(id: string): Promise<{ outcome: "queued" | "in_progress" | "not_found" }> {
  const [row] = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.id, id)).limit(1);
  if (!row) return { outcome: "not_found" };
  if (row.status === "delivering") return { outcome: "in_progress" };
  await db.update(webhookDeliveriesTable).set({ status: "pending", nextAttemptAt: new Date(), claimToken: null, claimedAt: null }).where(eq(webhookDeliveriesTable.id, id));
  return { outcome: "queued" };
}
