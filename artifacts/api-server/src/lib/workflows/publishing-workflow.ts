/**
 * Content Distribution Engine — scheduling/retry/confirmation logic.
 * Talks only to the PublishProvider adapter interface (lib/publishing/types.ts),
 * never to a specific provider's SDK. This file is what the background
 * scheduler (lib/publishing/scheduler.ts) drives, and what routes/publishing.ts
 * calls directly for an immediate "publish now" request.
 *
 * Every provider dispatch (initial publish, confirmation poll, cancel) is
 * gated by `claimForProcessing`, an atomic conditional UPDATE that only one
 * caller can win. This is what prevents an immediate "publish now" request
 * and a concurrent scheduler tick from both calling the provider for the same
 * row and creating a duplicate external post.
 */
import { randomUUID } from "crypto";
import { and, eq, lte, inArray, lt, or, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { publishingDestinationsTable, scheduledPublicationsTable, publicationAttemptsTable, projectsTable, documentsTable, documentSectionsTable } from "@workspace/db";
import type { ScheduledPublication, PublishingDestination } from "@workspace/db";
import { getPublishProvider } from "../publishing/router";
import { PublishNotSubmittedError, type PublishDestinationRef, type PublishProvider, type CancelResult } from "../publishing/types";
import { emitEvent } from "../webhooks/events";

/** Best-effort event emission for a publication reaching a terminal state — never throws, never blocks finalization. */
async function emitPublicationEvent(type: "publication.published" | "publication.failed", pub: ScheduledPublication, extra: Record<string, unknown> = {}) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, pub.projectId)).limit(1);
  if (!project?.userId) return;
  await emitEvent({
    type, userId: project.userId, brandId: pub.brandId, projectId: pub.projectId,
    data: { publicationId: pub.id, projectId: pub.projectId, destinationId: pub.destinationId, ...extra },
  });
}

/** Assemble the publishable text for a whole document from its sections (also used by routes/automation.ts for the action-API equivalent). */
export async function resolveDocumentContent(documentId: string): Promise<{ title: string; content: string }> {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  if (!doc) throw new Error("Document not found");
  const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, documentId));
  const withContent = sections.filter((s) => s.content).sort((a, b) => a.sortOrder - b.sortOrder);
  if (withContent.length === 0) throw new Error("Document has no drafted content to publish yet");
  return { title: doc.title, content: withContent.map((s) => `## ${s.title}\n${s.content}`).join("\n\n") };
}

// Exponential-ish backoff after a failed *attempt* (not a "still pending" confirmation poll).
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;
export const CONFIRM_POLL_INTERVAL_MS = 30_000;
export const MAX_CONFIRM_POLLS = 10;
// A claim ("publishing"/"confirming"/"cancelling") older than this is assumed
// to belong to a crashed process and is safe to reclaim, rather than leaving
// the row stuck forever. Kept comfortably larger than PROVIDER_CALL_TIMEOUT_MS
// so that, under normal operation, a genuinely-slow (not crashed) provider
// call always times out and finalizes on its own claim before a reclaim could
// possibly race it.
export const CLAIM_TIMEOUT_MS = 2 * 60_000;
// Every provider call is bounded so a hung network request can't hold a claim
// forever. A timed-out call is treated as a failed attempt (retried with
// backoff, same as a thrown error) — never left to finish unobserved.
export const PROVIDER_CALL_TIMEOUT_MS = 45_000;

class ProviderCallTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderCallTimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function backoffForAttempt(attemptNumber: number): number {
  const idx = Math.min(attemptNumber - 1, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[Math.max(idx, 0)];
}

export function destinationRef(destination: PublishingDestination): PublishDestinationRef {
  return {
    externalAccountId: destination.externalAccountId,
    platform: destination.platform,
    config: (destination.config as Record<string, unknown> | null) ?? null,
  };
}

async function recordAttempt(scheduledPublicationId: string, attemptNumber: number, outcome: string, errorMessage?: string | null) {
  await db.insert(publicationAttemptsTable).values({
    id: randomUUID(),
    scheduledPublicationId,
    attemptNumber,
    outcome,
    errorMessage: errorMessage ?? null,
  });
}

/**
 * Atomically move a row from `fromStatus` to `toStatus` — a single UPDATE with
 * a status predicate, so exactly one caller can win the claim even if two
 * callers (e.g. an immediate "publish now" request and a scheduler tick)
 * evaluate the same row at the same time. Also stamps a fresh `claimToken`:
 * every subsequent write this caller makes to finalize its own claim must go
 * through `finalizeClaim` with this exact token, so that if the claim is
 * later reclaimed as stale (see `reclaimStaleClaims`), the original caller's
 * eventual, now-superseded write becomes a safe no-op instead of overwriting
 * whatever the newer claim already recorded. Returns the claimed row
 * (including its token), or `null` if someone else already claimed it,
 * cancelled it, or it's no longer in `fromStatus` for any other reason.
 */
async function claimForProcessing(id: string, fromStatus: string, toStatus: string): Promise<ScheduledPublication | null> {
  const token = randomUUID();
  const [row] = await db.update(scheduledPublicationsTable)
    .set({ status: toStatus, claimedAt: new Date(), claimToken: token })
    .where(and(eq(scheduledPublicationsTable.id, id), eq(scheduledPublicationsTable.status, fromStatus)))
    .returning();
  return row ?? null;
}

/**
 * Finalize the outcome of a claim taken via `claimForProcessing`. Conditioned
 * on `claimToken` (not just `id`), so a call whose claim was reclaimed as
 * stale while it was still (slowly) running never clobbers newer state —
 * the WHERE clause simply matches zero rows and this returns `null`.
 * Callers must treat `null` as "do nothing further" (no attempt record, no
 * side effects), not as an error.
 */
async function finalizeClaim(id: string, claimToken: string, updates: Partial<typeof scheduledPublicationsTable.$inferInsert>): Promise<ScheduledPublication | null> {
  const [row] = await db.update(scheduledPublicationsTable)
    .set(updates)
    .where(and(eq(scheduledPublicationsTable.id, id), eq(scheduledPublicationsTable.claimToken, claimToken)))
    .returning();
  return row ?? null;
}

/**
 * Wrap provider.cancel so an unexpected throw (including a timeout — a hung
 * cancel call must not block a claim forever any more than publish/checkStatus
 * can) never gets confused with a legitimate "cannot cancel".
 */
async function safeProviderCancel(provider: PublishProvider, destination: PublishDestinationRef, externalPostId: string): Promise<CancelResult> {
  try {
    return await withTimeout(provider.cancel(destination, externalPostId), PROVIDER_CALL_TIMEOUT_MS, `${provider.name}.cancel`);
  } catch (err) {
    return { cancelled: false, reason: (err as Error).message };
  }
}

/** Attempt a "pending" publication that is due (initial send, or a retry after a prior failure). */
export async function attemptPublication(pub: ScheduledPublication): Promise<void> {
  const claimed = await claimForProcessing(pub.id, "pending", "publishing");
  if (!claimed) return; // lost the race (already claimed, cancelled, or no longer pending) — nothing to do
  pub = claimed;
  const token = pub.claimToken!;

  const [destination] = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.id, pub.destinationId)).limit(1);
  const now = new Date();
  const nextAttemptNumber = pub.attemptCount + 1;

  if (!destination || !destination.isActive) {
    const finalized = await finalizeClaim(pub.id, token, {
      status: "failed",
      attemptCount: nextAttemptNumber,
      lastAttemptAt: now,
      lastError: "Destination was removed or deactivated.",
    });
    if (finalized) await recordAttempt(pub.id, nextAttemptNumber, "failure", "Destination was removed or deactivated.");
    return;
  }

  const provider = getPublishProvider(destination.provider);

  try {
    // idempotencyKey = the row's own id: stable across retries (including a
    // retry after this exact claim gets reclaimed as stale), so a provider
    // that supports request dedup can guarantee this never double-posts even
    // if our own bookkeeping about the first attempt was lost.
    const result = await withTimeout(
      provider.publish(destinationRef(destination), { title: pub.title, content: pub.content }, pub.scheduledFor, pub.id),
      PROVIDER_CALL_TIMEOUT_MS,
      `${destination.provider}.publish`,
    );

    // A cancel may have been requested while the provider call was in flight —
    // our own claim ("publishing") blocked the DB-only cancel path, so honor
    // it now via a real provider-side cancellation before finalizing anything.
    const [fresh] = await db.select().from(scheduledPublicationsTable).where(eq(scheduledPublicationsTable.id, pub.id)).limit(1);
    if (fresh?.cancelRequested && !result.confirmed) {
      const cancelResult = await safeProviderCancel(provider, destinationRef(destination), result.externalPostId);
      if (cancelResult.cancelled) {
        const finalized = await finalizeClaim(pub.id, token, {
          status: "cancelled",
          attemptCount: nextAttemptNumber,
          lastAttemptAt: now,
          lastError: null,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
        });
        if (finalized) await recordAttempt(pub.id, nextAttemptNumber, "cancelled");
        return;
      }
      if (cancelResult.alreadyPublished) {
        // Cannot be undone — remain truthful and mark it published, not cancelled.
        result.confirmed = true;
        result.externalUrl = cancelResult.externalUrl ?? result.externalUrl;
      }
      // Otherwise cancellation isn't possible right now (unsupported/failed);
      // fall through to the normal queued/published path below. cancelRequested
      // stays true, so pollConfirmation will retry the cancel on its next tick.
    }

    if (result.confirmed) {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "published",
        attemptCount: nextAttemptNumber,
        lastAttemptAt: now,
        lastError: null,
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        publishedAt: now,
        providerPayload: result.providerPayload ?? null,
      });
      if (finalized) {
        await recordAttempt(pub.id, nextAttemptNumber, "confirmed");
        await emitPublicationEvent("publication.published", finalized, { externalUrl: finalized.externalUrl });
      }
    } else {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "queued",
        attemptCount: nextAttemptNumber,
        lastAttemptAt: now,
        lastError: null,
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        nextAttemptAt: new Date(now.getTime() + CONFIRM_POLL_INTERVAL_MS),
        providerPayload: result.providerPayload ?? null,
      });
      if (finalized) await recordAttempt(pub.id, nextAttemptNumber, "success");
    }
  } catch (err) {
    const message = (err as Error).message;
    // A retry is only safe to schedule automatically when we can be sure this
    // attempt never created (or duplicated) content on the provider's side:
    // either the provider guarantees idempotent dedup on its own
    // (publishIsIdempotent), or this specific failure is proven to have
    // happened before/without submission (PublishNotSubmittedError). Anything
    // else — a timeout, a network error, an unparseable success response —
    // is "submission unknown": the request may have actually gone through, so
    // resubmitting could create a real duplicate post. Go straight to a
    // terminal failure instead and require a human to verify on the provider
    // directly before republishing.
    const safeToAutoRetry = provider.publishIsIdempotent || err instanceof PublishNotSubmittedError;
    const exhausted = nextAttemptNumber >= MAX_ATTEMPTS;
    const willRetry = safeToAutoRetry && !exhausted;
    const lastError = safeToAutoRetry
      ? message
      : `${message} — this may have actually reached ${provider.name}; treating as ambiguous since this provider can't guarantee safe automatic retries (publishIsIdempotent is false). Verify directly on ${provider.name} before republishing.`;
    const finalized = await finalizeClaim(pub.id, token, {
      status: willRetry ? "pending" : "failed",
      attemptCount: nextAttemptNumber,
      lastAttemptAt: now,
      lastError,
      nextAttemptAt: willRetry ? new Date(now.getTime() + backoffForAttempt(nextAttemptNumber)) : pub.nextAttemptAt,
    });
    if (finalized) {
      await recordAttempt(pub.id, nextAttemptNumber, "failure", lastError);
      if (finalized.status === "failed") await emitPublicationEvent("publication.failed", finalized, { errorMessage: lastError });
    }
  }
}

/** Poll a "queued" (provider-accepted, not yet confirmed) publication that is due for a status check. */
export async function pollConfirmation(pub: ScheduledPublication): Promise<void> {
  const claimed = await claimForProcessing(pub.id, "queued", "confirming");
  if (!claimed) return; // lost the race — another poll/cancel already owns this tick
  pub = claimed;
  const token = pub.claimToken!;

  const [destination] = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.id, pub.destinationId)).limit(1);
  const now = new Date();
  const pollNumber = pub.attemptCount + 1;

  if (!destination || !pub.externalPostId) {
    const finalized = await finalizeClaim(pub.id, token, {
      status: "failed",
      lastAttemptAt: now,
      lastError: "Missing destination or external post id while confirming publication.",
    });
    if (finalized) {
      await recordAttempt(pub.id, pollNumber, "failure", "Missing destination or external post id while confirming publication.");
      await emitPublicationEvent("publication.failed", finalized, { errorMessage: "Missing destination or external post id while confirming publication." });
    }
    return;
  }

  const provider = getPublishProvider(destination.provider);

  if (pub.cancelRequested) {
    const cancelResult = await safeProviderCancel(provider, destinationRef(destination), pub.externalPostId);
    if (cancelResult.cancelled) {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "cancelled",
        attemptCount: pollNumber,
        lastAttemptAt: now,
        lastError: null,
      });
      if (finalized) await recordAttempt(pub.id, pollNumber, "cancelled");
      return;
    }
    if (cancelResult.alreadyPublished) {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "published",
        attemptCount: pollNumber,
        lastAttemptAt: now,
        lastError: "Cancellation was requested but the provider had already published this post.",
        externalUrl: cancelResult.externalUrl ?? pub.externalUrl,
        publishedAt: now,
      });
      if (finalized) {
        await recordAttempt(pub.id, pollNumber, "confirmed");
        await emitPublicationEvent("publication.published", finalized, { externalUrl: finalized.externalUrl });
      }
      return;
    }
    // Cancellation not possible right now (unsupported/transient failure) —
    // fall through to a normal status check; cancelRequested stays true so
    // the next tick retries the cancel again before checking status.
  }

  try {
    const status = await withTimeout(
      provider.checkStatus(destinationRef(destination), pub.externalPostId),
      PROVIDER_CALL_TIMEOUT_MS,
      `${destination.provider}.checkStatus`,
    );

    if (status.state === "published") {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "published",
        attemptCount: pollNumber,
        lastAttemptAt: now,
        lastError: null,
        externalUrl: status.externalUrl ?? pub.externalUrl,
        publishedAt: now,
      });
      if (finalized) {
        await recordAttempt(pub.id, pollNumber, "confirmed");
        await emitPublicationEvent("publication.published", finalized, { externalUrl: finalized.externalUrl });
      }
      return;
    }

    if (status.state === "failed") {
      const finalized = await finalizeClaim(pub.id, token, {
        status: "failed",
        attemptCount: pollNumber,
        lastAttemptAt: now,
        lastError: status.errorMessage,
      });
      if (finalized) {
        await recordAttempt(pub.id, pollNumber, "failure", status.errorMessage);
        await emitPublicationEvent("publication.failed", finalized, { errorMessage: status.errorMessage });
      }
      return;
    }

    // still pending confirmation
    const exhausted = pollNumber >= MAX_CONFIRM_POLLS;
    const finalized = await finalizeClaim(pub.id, token, {
      status: exhausted ? "failed" : "queued",
      attemptCount: pollNumber,
      lastAttemptAt: now,
      lastError: exhausted ? "Provider never confirmed publication after repeated checks." : null,
      nextAttemptAt: exhausted ? pub.nextAttemptAt : new Date(now.getTime() + CONFIRM_POLL_INTERVAL_MS),
    });
    if (finalized) {
      await recordAttempt(pub.id, pollNumber, exhausted ? "failure" : "still_pending", exhausted ? "Provider never confirmed publication after repeated checks." : null);
      if (exhausted) await emitPublicationEvent("publication.failed", finalized, { errorMessage: "Provider never confirmed publication after repeated checks." });
    }
  } catch (err) {
    const message = (err as Error).message;
    const exhausted = pollNumber >= MAX_CONFIRM_POLLS;
    const finalized = await finalizeClaim(pub.id, token, {
      status: exhausted ? "failed" : "queued",
      attemptCount: pollNumber,
      lastAttemptAt: now,
      lastError: message,
      nextAttemptAt: exhausted ? pub.nextAttemptAt : new Date(now.getTime() + CONFIRM_POLL_INTERVAL_MS),
    });
    if (finalized) {
      await recordAttempt(pub.id, pollNumber, "failure", message);
      if (exhausted) await emitPublicationEvent("publication.failed", finalized, { errorMessage: message });
    }
  }
}

/**
 * Recover claims ("publishing"/"confirming"/"cancelling") abandoned by a
 * crashed process — anything claimed longer than CLAIM_TIMEOUT_MS ago is put
 * back so it gets retried instead of staying stuck forever. Each reclaim is
 * conditioned on both `status` AND the row still holding the exact
 * `claimToken` it had when we read it, and clears `claimToken` to `null` —
 * this is itself a "claim transfer": the original caller's own eventual
 * `finalizeClaim(..., oldToken, ...)` write will now match zero rows and be
 * dropped, so it can never clobber whatever this reclaim (or whoever wins the
 * next claim) records instead.
 */
export async function reclaimStaleClaims(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  // A "publishing" claim only ever gets this stale (CLAIM_TIMEOUT_MS is well
  // over PROVIDER_CALL_TIMEOUT_MS) if the process holding it crashed/restarted
  // mid-call — attemptPublication's own try/catch would otherwise have
  // finalized it long before this point. That means we have NO information
  // about whether provider.publish() actually reached the provider: it's the
  // exact same "submission unknown" situation as an ambiguous error inside
  // attemptPublication's catch block, so it gets the same treatment — safe to
  // auto-retry only when the provider guarantees idempotent dedup, otherwise
  // a terminal failure requiring manual verification.
  const stalePublishing = await db.select().from(scheduledPublicationsTable).where(
    and(eq(scheduledPublicationsTable.status, "publishing"), lt(scheduledPublicationsTable.claimedAt, staleBefore))
  );
  for (const pub of stalePublishing) {
    const [destination] = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.id, pub.destinationId)).limit(1);
    const provider = destination ? getPublishProvider(destination.provider) : null;
    const safeToAutoRetry = !!provider?.publishIsIdempotent;
    const nextAttemptNumber = pub.attemptCount + 1;

    if (safeToAutoRetry) {
      // Deliberately not recorded via recordAttempt here: nothing was
      // actually attempted by this reclaim itself, and the row simply goes
      // back to "pending" to be attempted normally (which does record its
      // own outcome) — recording a synthetic attempt here would be redundant.
      await db.update(scheduledPublicationsTable).set({
        status: "pending",
        claimToken: null,
        lastError: "Recovered from an interrupted publish attempt (process restarted or the provider call timed out).",
        nextAttemptAt: now,
      }).where(and(eq(scheduledPublicationsTable.id, pub.id), eq(scheduledPublicationsTable.status, "publishing"), eq(scheduledPublicationsTable.claimToken, pub.claimToken!)));
      continue;
    }

    const message = `Recovered from an interrupted publish attempt on '${provider?.name ?? destination?.provider ?? "unknown"}' whose outcome is unknown — this provider has no verified request deduplication, so it cannot be auto-retried without risking a duplicate post. Verify directly on the provider before manually rescheduling.`;
    const [finalized] = await db.update(scheduledPublicationsTable).set({
      status: "failed",
      claimToken: null,
      attemptCount: nextAttemptNumber,
      lastAttemptAt: now,
      lastError: message,
    }).where(and(eq(scheduledPublicationsTable.id, pub.id), eq(scheduledPublicationsTable.status, "publishing"), eq(scheduledPublicationsTable.claimToken, pub.claimToken!)))
      .returning();
    if (finalized) await recordAttempt(pub.id, nextAttemptNumber, "failure", message);
  }

  const staleConfirming = await db.select().from(scheduledPublicationsTable).where(
    and(eq(scheduledPublicationsTable.status, "confirming"), lt(scheduledPublicationsTable.claimedAt, staleBefore))
  );
  for (const pub of staleConfirming) {
    await db.update(scheduledPublicationsTable).set({
      status: "queued",
      claimToken: null,
      nextAttemptAt: now,
    }).where(and(eq(scheduledPublicationsTable.id, pub.id), eq(scheduledPublicationsTable.status, "confirming"), eq(scheduledPublicationsTable.claimToken, pub.claimToken!)));
  }

  // A "cancelling" claim (see cancelPublication) abandoned mid-flight must
  // resume as a cancel retry, not silently vanish back to a plain "queued" —
  // otherwise the user's cancel request is lost with no record it needs
  // retrying. cancelRequested stays/becomes true so the next scheduler tick's
  // pollConfirmation attempts the provider cancel again before checking status.
  const staleCancelling = await db.select().from(scheduledPublicationsTable).where(
    and(eq(scheduledPublicationsTable.status, "cancelling"), lt(scheduledPublicationsTable.claimedAt, staleBefore))
  );
  for (const pub of staleCancelling) {
    await db.update(scheduledPublicationsTable).set({
      status: "queued",
      claimToken: null,
      cancelRequested: true,
      nextAttemptAt: now,
    }).where(and(eq(scheduledPublicationsTable.id, pub.id), eq(scheduledPublicationsTable.status, "cancelling"), eq(scheduledPublicationsTable.claimToken, pub.claimToken!)));
  }
}

/** One scheduler tick: reclaim stale claims, attempt every due "pending" row, poll every due "queued" row. */
export async function processDuePublications(): Promise<{ attempted: number; polled: number }> {
  const now = new Date();
  await reclaimStaleClaims(now);

  const duePending = await db.select().from(scheduledPublicationsTable).where(
    and(eq(scheduledPublicationsTable.status, "pending"), lte(scheduledPublicationsTable.nextAttemptAt, now))
  );
  for (const pub of duePending) {
    await attemptPublication(pub);
  }

  const dueQueued = await db.select().from(scheduledPublicationsTable).where(
    or(
      and(eq(scheduledPublicationsTable.status, "queued"), lte(scheduledPublicationsTable.nextAttemptAt, now)),
      and(eq(scheduledPublicationsTable.status, "queued"), eq(scheduledPublicationsTable.cancelRequested, true)),
    )
  );
  for (const pub of dueQueued) {
    await pollConfirmation(pub);
  }

  return { attempted: duePending.length, polled: dueQueued.length };
}

/**
 * Cancel a scheduled publication. Handles every status atomically:
 * - "pending" (never submitted): cancelled immediately in our own DB.
 * - "queued" (submitted, not yet confirmed): claims the row, then attempts a
 *   real provider-side cancellation — a DB-only cancel is not truthful once
 *   content has already been handed to the provider.
 * - "publishing"/"confirming" (a provider call is in flight right now): the
 *   claim can't be taken, so we record a best-effort cancel request that the
 *   in-flight call will honor via provider.cancel() once it returns.
 * - already terminal (published/failed/cancelled): rejected, nothing to cancel.
 */
export async function cancelPublication(id: string): Promise<{ outcome: "cancelled" | "already_published" | "pending_best_effort" | "not_cancellable"; publication: ScheduledPublication | null; message?: string }> {
  const [current] = await db.select().from(scheduledPublicationsTable).where(eq(scheduledPublicationsTable.id, id)).limit(1);
  if (!current) return { outcome: "not_cancellable", publication: null, message: "Not found" };

  if (current.status === "published" || current.status === "failed" || current.status === "cancelled") {
    return { outcome: "not_cancellable", publication: current, message: `Cannot cancel a publication that is already ${current.status}.` };
  }

  if (current.status === "pending") {
    const claimed = await claimForProcessing(id, "pending", "cancelled");
    if (claimed) return { outcome: "cancelled", publication: claimed };
    // Lost the race (a scheduler tick just claimed it as "publishing") — fall
    // through to the best-effort path below instead of reporting failure.
  }

  if (current.status === "queued") {
    const claimed = await claimForProcessing(id, "queued", "cancelling");
    if (claimed) {
      const token = claimed.claimToken!;
      const [destination] = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.id, claimed.destinationId)).limit(1);
      if (!destination || !claimed.externalPostId) {
        const finalized = await finalizeClaim(id, token, { status: "cancelled" });
        if (finalized) await recordAttempt(id, claimed.attemptCount, "cancelled");
        return { outcome: "cancelled", publication: finalized ?? claimed };
      }
      const provider = getPublishProvider(destination.provider);
      const cancelResult = await safeProviderCancel(provider, destinationRef(destination), claimed.externalPostId);
      if (cancelResult.cancelled) {
        const finalized = await finalizeClaim(id, token, { status: "cancelled" });
        if (finalized) await recordAttempt(id, claimed.attemptCount, "cancelled");
        return { outcome: "cancelled", publication: finalized ?? claimed };
      }
      if (cancelResult.alreadyPublished) {
        const finalized = await finalizeClaim(id, token, {
          status: "published",
          publishedAt: new Date(),
          externalUrl: cancelResult.externalUrl ?? claimed.externalUrl,
          lastError: "Cancellation was requested but the provider had already published this post.",
        });
        if (finalized) await recordAttempt(id, claimed.attemptCount, "confirmed");
        return { outcome: "already_published", publication: finalized ?? claimed, message: "This post had already been published by the provider before the cancellation could take effect." };
      }
      // Provider couldn't cancel it right now — put it back as queued and
      // flag it so the scheduler retries the cancel on its next poll.
      const reverted = await finalizeClaim(id, token, { status: "queued", cancelRequested: true });
      return { outcome: "pending_best_effort", publication: reverted ?? claimed, message: cancelResult.reason ?? "The provider could not confirm cancellation right now; we'll keep trying." };
    }
    // Lost the race (a confirmation poll just claimed it) — fall through.
  }

  // "publishing" / "confirming" (claimed elsewhere right now), or we lost a
  // race above: record the cancel request so the in-flight call honors it.
  const [flagged] = await db.update(scheduledPublicationsTable).set({ cancelRequested: true }).where(eq(scheduledPublicationsTable.id, id)).returning();
  return { outcome: "pending_best_effort", publication: flagged ?? current, message: "This publication is currently being processed; it will be cancelled if possible once that finishes." };
}

/** Fetch attempt history for a publication, newest first. */
export async function getAttemptHistory(scheduledPublicationId: string) {
  const attempts = await db.select().from(publicationAttemptsTable).where(eq(publicationAttemptsTable.scheduledPublicationId, scheduledPublicationId));
  return attempts.sort((a, b) => b.attemptNumber - a.attemptNumber);
}

export async function getPublicationsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(scheduledPublicationsTable).where(inArray(scheduledPublicationsTable.id, ids));
}

/**
 * Remove a publishing destination — but only when doing so is safe. The FK
 * from scheduled_publications to this table is `onDelete: "restrict"` (see
 * lib/db/src/schema/publishing.ts), not cascade: removing a destination must
 * never take its scheduled/published history or attempt records with it,
 * since that would silently erase the record that content was actually sent
 * to a provider. If any publication still references this destination
 * (pending, queued, or long since published/failed/cancelled), the delete is
 * refused — the caller should deactivate it instead (isActive: false), which
 * preserves history and makes new attempts against it fail loudly via the
 * existing `!destination.isActive` check in attemptPublication.
 *
 * The upfront count is only a fast path for a friendly result in the common
 * case — it does NOT by itself close the race where a publication is
 * scheduled against this destination between the count and the delete. The
 * actual enforcement is the database's RESTRICT constraint: if that race
 * happens, the DELETE statement itself fails with a Postgres foreign-key
 * violation (SQLSTATE 23503), which is caught below and translated into the
 * same "in_use" result instead of throwing.
 */
export async function removePublishingDestination(id: string): Promise<{ outcome: "deleted" } | { outcome: "in_use"; publicationCount: number }> {
  const [{ count: referencingCount }] = await db.select({ count: count() })
    .from(scheduledPublicationsTable)
    .where(eq(scheduledPublicationsTable.destinationId, id));

  if (referencingCount > 0) {
    return { outcome: "in_use", publicationCount: referencingCount };
  }

  try {
    await db.delete(publishingDestinationsTable).where(eq(publishingDestinationsTable.id, id));
  } catch (err: any) {
    if (err?.code === "23503") {
      // Lost the race: a publication was inserted against this destination
      // after the count above but before the delete committed. Re-count for
      // an accurate message; the DB already guaranteed nothing was lost.
      const [{ count: recount }] = await db.select({ count: count() })
        .from(scheduledPublicationsTable)
        .where(eq(scheduledPublicationsTable.destinationId, id));
      return { outcome: "in_use", publicationCount: recount || 1 };
    }
    throw err;
  }

  return { outcome: "deleted" };
}
