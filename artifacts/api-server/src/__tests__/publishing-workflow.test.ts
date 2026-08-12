/**
 * Scheduling/retry/confirmation logic tests for the Content Distribution
 * Engine, run against a mocked provider and a mocked db (no real database or
 * network) — this is the "integration test using a mocked provider" required
 * by the task, kept fast and hermetic by faking the persistence layer's shape
 * rather than hitting Postgres.
 *
 * The fake db models every db.update(...).where(...).returning() call (both
 * the atomic "claim" that gates a provider call, and the later "finalize"
 * that records its outcome — both use `.returning()` so a stale-reclaimed
 * finalize can detect it matched zero rows) via a single FIFO `returningQueue`.
 * Each test pushes exactly the rows it expects each successive `.returning()`
 * call, in call order, to make via `primeReturning`. A pushed `[]` simulates
 * "this conditional UPDATE matched zero rows" — either a lost claim race, or
 * (new) a finalize whose claim was reclaimed as stale in the meantime.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as any[][],
    returningQueue: [] as any[][],
    updates: [] as any[],
    inserts: [] as any[],
    deletes: [] as any[],
    deleteErrorQueue: [] as any[],
  };
  return {
    fakeState: state,
    resetFakeState: () => {
      state.selectQueue = [];
      state.returningQueue = [];
      state.updates = [];
      state.inserts = [];
      state.deletes = [];
      state.deleteErrorQueue = [];
    },
  };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = fakeState.selectQueue.shift() ?? [];
          return Object.assign(thenable(result), {
            limit: (n: number) => thenable(result.slice(0, n)),
          });
        },
      }),
    }),
    update: () => ({
      set: (setObj: any) => ({
        where: () => {
          fakeState.updates.push(setObj);
          return Object.assign(thenable(undefined), {
            returning: () => thenable(fakeState.returningQueue.shift() ?? []),
          });
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        return thenable(undefined);
      },
    }),
    delete: () => ({
      where: () => {
        const err = fakeState.deleteErrorQueue.shift();
        if (err) return { then: (_resolve: any, reject: any) => reject(err) };
        fakeState.deletes.push(true);
        return thenable(undefined);
      },
    }),
  };
  return {
    db,
    publishingDestinationsTable: {},
    scheduledPublicationsTable: {},
    publicationAttemptsTable: {},
    projectsTable: {},
    documentsTable: {},
    documentSectionsTable: {},
  };
});

// Event emission is a separate concern (see lib/webhooks/events.test.ts) —
// stub it out here so these tests stay focused on publish/retry/confirmation
// logic and don't need to prime selectQueue for emitPublicationEvent's
// internal project lookup.
vi.mock("../lib/webhooks/events", () => ({ emitEvent: vi.fn() }));

const { providerState } = vi.hoisted(() => ({
  providerState: {
    publish: null as any,
    checkStatus: null as any,
    cancel: null as any,
    publishIsIdempotent: true,
  },
}));

vi.mock("../lib/publishing/router", () => ({
  getPublishProvider: () => ({
    name: "mock",
    isConfigured: () => true,
    get publishIsIdempotent() { return providerState.publishIsIdempotent; },
    publish: (...args: any[]) => providerState.publish(...args),
    checkStatus: (...args: any[]) => providerState.checkStatus(...args),
    cancel: (...args: any[]) => providerState.cancel(...args),
  }),
}));

const {
  attemptPublication,
  pollConfirmation,
  processDuePublications,
  cancelPublication,
  reclaimStaleClaims,
  removePublishingDestination,
  backoffForAttempt,
  RETRY_BACKOFF_MS,
  MAX_ATTEMPTS,
  CONFIRM_POLL_INTERVAL_MS,
  MAX_CONFIRM_POLLS,
  PROVIDER_CALL_TIMEOUT_MS,
  CLAIM_TIMEOUT_MS,
} = await import("../lib/workflows/publishing-workflow");

const baseDestination = {
  id: "dest-1",
  provider: "mock",
  platform: "x",
  externalAccountId: "acct-1",
  config: null,
  isActive: true,
};

function basePublication(overrides: Record<string, unknown> = {}) {
  return {
    id: "pub-1",
    destinationId: "dest-1",
    title: "Hello",
    content: "Hello world",
    status: "pending",
    attemptCount: 0,
    externalPostId: null,
    externalUrl: null,
    cancelRequested: false,
    claimToken: null,
    scheduledFor: new Date(),
    nextAttemptAt: new Date(),
    ...overrides,
  } as any;
}

/** Prime the next db.update(...).returning() call's result, in call order. */
function primeReturning(row: any) {
  fakeState.returningQueue.push(row ? [row] : []);
}
// Both the atomic claim and the later finalize go through the same
// `.returning()` mechanism — these names exist purely for readability at the
// call site (claim vs. finalize), not because the mock treats them differently.
const primeClaim = primeReturning;
const primeFinalize = primeReturning;

beforeEach(() => {
  resetFakeState();
  providerState.publish = null;
  providerState.checkStatus = null;
  providerState.cancel = null;
  providerState.publishIsIdempotent = true;
  vi.useRealTimers();
});

describe("backoffForAttempt", () => {
  it("returns the schedule's backoff step for each attempt number", () => {
    expect(backoffForAttempt(1)).toBe(RETRY_BACKOFF_MS[0]);
    expect(backoffForAttempt(2)).toBe(RETRY_BACKOFF_MS[1]);
    expect(backoffForAttempt(RETRY_BACKOFF_MS.length)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  });

  it("clamps to the final backoff step beyond the configured attempts", () => {
    expect(backoffForAttempt(RETRY_BACKOFF_MS.length + 5)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  });

  it("never returns a shorter wait for a later attempt (monotonic backoff)", () => {
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      expect(backoffForAttempt(i + 1)).toBeGreaterThanOrEqual(backoffForAttempt(i));
    }
  });
});

describe("attemptPublication", () => {
  it("never calls the provider when the row is no longer 'pending' (duplicate-publish prevention)", async () => {
    // Simulates the exact race the atomic claim exists for: an immediate
    // "publish now" request and a concurrent scheduler tick both pick up the
    // same row. Whichever loses the atomic UPDATE gets nothing back here and
    // must not touch the provider or read the destination at all.
    primeClaim(null); // conditional UPDATE matched zero rows — lost the race
    providerState.publish = vi.fn();

    await attemptPublication(basePublication());

    expect(providerState.publish).not.toHaveBeenCalled();
    expect(fakeState.selectQueue).toHaveLength(0); // never got to selecting the destination
    expect(fakeState.updates).toHaveLength(1); // only the failed claim attempt itself
    expect(fakeState.inserts).toHaveLength(0);
  });

  it("fails immediately without calling the provider when the destination is inactive", async () => {
    const pub = basePublication({ claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([{ ...baseDestination, isActive: false }]);
    primeFinalize({ ...pub, status: "failed" });
    providerState.publish = vi.fn();

    await attemptPublication(pub);

    expect(providerState.publish).not.toHaveBeenCalled();
    expect(fakeState.updates[0].status).toBe("publishing"); // the claim
    expect(fakeState.updates[1].status).toBe("failed");
    expect(fakeState.inserts[0].outcome).toBe("failure");
  });

  it("marks 'published' only when the provider confirms immediately", async () => {
    const pub = basePublication({ claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: false }]);
    primeFinalize({ ...pub, status: "published" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-1", externalUrl: "https://x.com/1", confirmed: true });

    await attemptPublication(pub);

    expect(providerState.publish).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), "pub-1");
    expect(fakeState.updates[1].status).toBe("published");
    expect(fakeState.updates[1].publishedAt).toBeInstanceOf(Date);
    expect(fakeState.inserts[0].outcome).toBe("confirmed");
  });

  it("stays 'queued' (not 'published') when the provider accepts but hasn't confirmed yet", async () => {
    const pub = basePublication({ claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: false }]);
    primeFinalize({ ...pub, status: "queued" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-2", externalUrl: null, confirmed: false });

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("queued");
    expect(fakeState.updates[1].publishedAt).toBeUndefined();
    expect(fakeState.updates[1].nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    expect(fakeState.inserts[0].outcome).toBe("success");
  });

  it("retries with backoff on a transient failure instead of giving up immediately", async () => {
    const pub = basePublication({ attemptCount: 0, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "pending" });
    providerState.publish = vi.fn().mockRejectedValue(new Error("network blip"));

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("pending");
    expect(fakeState.updates[1].lastError).toBe("network blip");
    const expectedNext = backoffForAttempt(1);
    expect(fakeState.updates[1].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + expectedNext - 1000);
    expect(fakeState.inserts[0]).toMatchObject({ outcome: "failure", errorMessage: "network blip" });
  });

  it("marks 'failed' (not silently dropped) once retries are exhausted", async () => {
    const pub = basePublication({ attemptCount: MAX_ATTEMPTS - 1, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "failed" });
    providerState.publish = vi.fn().mockRejectedValue(new Error("still broken"));

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("failed");
    expect(fakeState.inserts[0].attemptNumber).toBe(MAX_ATTEMPTS);
  });

  it("does NOT auto-retry an ambiguous publish failure on a non-idempotent provider — goes straight to 'failed' even on the very first attempt", async () => {
    // The provider (like real Typefully) cannot guarantee that calling
    // publish() again never creates a second post, and this specific error
    // is NOT a PublishNotSubmittedError — so we genuinely don't know whether
    // the first call actually reached the provider. Auto-retrying here could
    // create a real duplicate; the only safe move is a terminal failure that
    // asks a human to verify before republishing.
    providerState.publishIsIdempotent = false;
    const pub = basePublication({ attemptCount: 0, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "failed" });
    providerState.publish = vi.fn().mockRejectedValue(new Error("connection reset"));

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("failed");
    expect(fakeState.updates[1].lastError).toMatch(/ambiguous/i);
    expect(fakeState.updates[1].lastError).toMatch(/connection reset/);
    expect(fakeState.inserts[0].outcome).toBe("failure");
  });

  it("DOES auto-retry on a non-idempotent provider when the failure is a PublishNotSubmittedError (proven nothing was created)", async () => {
    const { PublishNotSubmittedError } = await import("../lib/publishing/types");
    providerState.publishIsIdempotent = false;
    const pub = basePublication({ attemptCount: 0, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "pending" });
    providerState.publish = vi.fn().mockRejectedValue(new PublishNotSubmittedError("Typefully API error 422: invalid platform"));

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("pending");
    expect(fakeState.updates[1].lastError).toBe("Typefully API error 422: invalid platform");
    expect(fakeState.updates[1].nextAttemptAt).toBeInstanceOf(Date);
  });

  it("records every attempt (success or failure) so history is visible, never dropped silently", async () => {
    const pub = basePublication({ attemptCount: 2, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "pending" });
    providerState.publish = vi.fn().mockRejectedValue(new Error("boom"));

    await attemptPublication(pub);

    expect(fakeState.inserts).toHaveLength(1);
    expect(fakeState.inserts[0].scheduledPublicationId).toBe("pub-1");
    expect(fakeState.inserts[0].attemptNumber).toBe(3);
  });

  it("honors a cancel requested while the provider call was in flight instead of finalizing as queued", async () => {
    // Models: user hits "cancel" on a queued-for-dispatch row at the exact
    // moment the claimed worker is mid-`provider.publish()` call. The DB-only
    // cancel can't win the claim (status is already "publishing"), so it just
    // flags cancelRequested; the in-flight worker must notice that after its
    // provider call returns and unwind via a real provider-side cancellation.
    const pub = basePublication({ claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: true }]);
    primeFinalize({ ...pub, status: "cancelled" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-mid", externalUrl: null, confirmed: false });
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: true });

    await attemptPublication(pub);

    expect(providerState.cancel).toHaveBeenCalledWith(expect.anything(), "ext-mid");
    expect(fakeState.updates[1].status).toBe("cancelled");
    expect(fakeState.inserts[0].outcome).toBe("cancelled");
  });

  it("finalizes as 'published' (never a false 'cancelled') when the provider says the cancel-requested post already went live", async () => {
    const pub = basePublication({ claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: true }]);
    primeFinalize({ ...pub, status: "published" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-late", externalUrl: null, confirmed: false });
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: false, alreadyPublished: true, externalUrl: "https://x.com/late" });

    await attemptPublication(pub);

    expect(fakeState.updates[1].status).toBe("published");
    expect(fakeState.inserts[0].outcome).toBe("confirmed");
  });

  it("passes the publication id as a stable idempotency key so a provider-side retry can dedupe", async () => {
    const pub = basePublication({ id: "pub-idem", claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: false }]);
    primeFinalize({ ...pub, status: "queued" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-1", externalUrl: null, confirmed: false });

    await attemptPublication(pub);

    expect(providerState.publish.mock.calls[0][3]).toBe("pub-idem");
  });

  it("drops a finalize safely, without recording a false attempt, when its claim was reclaimed as stale mid-flight (fencing token)", async () => {
    // Models: this claim's provider.publish() call is genuinely slow. While
    // it's in flight, CLAIM_TIMEOUT_MS elapses and reclaimStaleClaims() puts
    // the row back to "pending" with a NEW claimToken so someone else can
    // retry it. When this original call's provider.publish() finally
    // resolves, its finalize UPDATE is conditioned on the OLD claimToken and
    // must match zero rows — never overwrite whatever the reclaim/retry has
    // since done to the row.
    const pub = basePublication({ claimToken: "stale-token" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination], [{ ...pub, cancelRequested: false }]);
    primeFinalize(null); // the finalize UPDATE...WHERE claimToken='stale-token' matches nothing anymore
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-1", externalUrl: null, confirmed: true });

    await expect(attemptPublication(pub)).resolves.toBeUndefined();

    expect(fakeState.inserts).toHaveLength(0); // no attempt recorded for a dropped/superseded finalize
  });

  it("treats a hung provider.publish() call as a failed attempt after PROVIDER_CALL_TIMEOUT_MS instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const pub = basePublication({ attemptCount: 0, claimToken: "tok-1" });
      primeClaim(pub);
      fakeState.selectQueue.push([baseDestination]);
      primeFinalize({ ...pub, status: "pending" });
      providerState.publish = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves

      const promise = attemptPublication(pub);
      await vi.advanceTimersByTimeAsync(PROVIDER_CALL_TIMEOUT_MS + 100);
      await promise;

      expect(fakeState.updates[1].status).toBe("pending"); // retried, not stuck
      expect(fakeState.updates[1].lastError).toMatch(/timed out/);
      expect(fakeState.inserts[0]).toMatchObject({ outcome: "failure" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pollConfirmation", () => {
  it("never calls the provider when the row is no longer 'queued' (duplicate-poll prevention)", async () => {
    primeClaim(null); // lost the race to another poll (or a cancel) claiming it first
    providerState.checkStatus = vi.fn();

    await pollConfirmation(basePublication({ status: "queued", externalPostId: "ext-1" }));

    expect(providerState.checkStatus).not.toHaveBeenCalled();
    expect(fakeState.selectQueue).toHaveLength(0);
    expect(fakeState.updates).toHaveLength(1);
  });

  it("fails when there is no external post id to check", async () => {
    const pub = basePublication({ externalPostId: null, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "failed" });
    await pollConfirmation(pub);
    expect(fakeState.updates[1].status).toBe("failed");
  });

  it("confirms 'published' only after the provider says so", async () => {
    const pub = basePublication({ externalPostId: "ext-1", attemptCount: 1, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "published" });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "published", externalUrl: "https://x.com/1" });

    await pollConfirmation(pub);

    expect(fakeState.updates[1].status).toBe("published");
    expect(fakeState.updates[1].externalUrl).toBe("https://x.com/1");
    expect(fakeState.inserts[0].outcome).toBe("confirmed");
  });

  it("surfaces a provider-reported failure instead of leaving it stuck 'queued'", async () => {
    const pub = basePublication({ externalPostId: "ext-1", claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "failed" });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "failed", errorMessage: "post was rejected" });

    await pollConfirmation(pub);

    expect(fakeState.updates[1].status).toBe("failed");
    expect(fakeState.updates[1].lastError).toBe("post was rejected");
  });

  it("keeps polling while still pending and under the poll limit", async () => {
    const pub = basePublication({ externalPostId: "ext-1", attemptCount: 1, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "queued" });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "pending" });

    await pollConfirmation(pub);

    expect(fakeState.updates[1].status).toBe("queued");
    expect(fakeState.updates[1].nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + CONFIRM_POLL_INTERVAL_MS - 5000);
  });

  it("gives up as 'failed' once the provider never confirms after the max number of polls", async () => {
    const pub = basePublication({ externalPostId: "ext-1", attemptCount: MAX_CONFIRM_POLLS - 1, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "failed" });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "pending" });

    await pollConfirmation(pub);

    expect(fakeState.updates[1].status).toBe("failed");
    expect(fakeState.updates[1].lastError).toMatch(/never confirmed/);
  });

  it("attempts a real provider-side cancellation instead of a DB-only one when a queued post has cancelRequested set", async () => {
    const pub = basePublication({ externalPostId: "ext-1", attemptCount: 1, cancelRequested: true, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "cancelled" });
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: true });
    providerState.checkStatus = vi.fn();

    await pollConfirmation(pub);

    expect(providerState.cancel).toHaveBeenCalledWith(expect.anything(), "ext-1");
    expect(providerState.checkStatus).not.toHaveBeenCalled(); // cancelled before ever checking status
    expect(fakeState.updates[1].status).toBe("cancelled");
    expect(fakeState.inserts[0].outcome).toBe("cancelled");
  });

  it("falls back to a normal status check when the provider cannot cancel a queued post right now", async () => {
    const pub = basePublication({ externalPostId: "ext-1", attemptCount: 1, cancelRequested: true, claimToken: "tok-1" });
    primeClaim(pub);
    fakeState.selectQueue.push([baseDestination]);
    primeFinalize({ ...pub, status: "queued" });
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: false, reason: "not supported" });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "pending" });

    await pollConfirmation(pub);

    expect(providerState.checkStatus).toHaveBeenCalledTimes(1);
    expect(fakeState.updates[1].status).toBe("queued"); // still pending — will retry the cancel next tick
  });
});

describe("processDuePublications", () => {
  it("attempts due pending rows and polls due queued rows in one tick, without duplicating provider calls", async () => {
    const pubPending = basePublication({ id: "p-pending", claimToken: "tok-pending" });
    const pubQueued = basePublication({ id: "p-queued", status: "queued", externalPostId: "ext-9", claimToken: "tok-queued" });

    // Order of db reads/claims for one tick:
    //  1) reclaim stale "publishing" claims (none)
    //  2) reclaim stale "confirming" claims (none)
    //  3) reclaim stale "cancelling" claims (none)
    //  4) select due-pending rows -> [pubPending]
    //     -> attemptPublication: claim, select destination, publish(), fresh select (not cancelled), finalize
    //  5) select due-queued rows -> [pubQueued]
    //     -> pollConfirmation: claim, select destination, checkStatus(), finalize
    fakeState.selectQueue.push(
      [], // stale "publishing"
      [], // stale "confirming"
      [], // stale "cancelling"
      [pubPending], // due pending
      [baseDestination], // destination lookup inside attemptPublication
      [{ ...pubPending, cancelRequested: false }], // fresh cancel-check inside attemptPublication
      [pubQueued], // due queued
      [baseDestination], // destination lookup inside pollConfirmation
    );
    primeClaim(pubPending);
    primeFinalize({ ...pubPending, status: "queued" });
    primeClaim(pubQueued);
    primeFinalize({ ...pubQueued, status: "queued" });
    providerState.publish = vi.fn().mockResolvedValue({ externalPostId: "ext-new", externalUrl: null, confirmed: false });
    providerState.checkStatus = vi.fn().mockResolvedValue({ state: "pending" });

    const result = await processDuePublications();

    expect(result).toEqual({ attempted: 1, polled: 1 });
    expect(providerState.publish).toHaveBeenCalledTimes(1);
    expect(providerState.checkStatus).toHaveBeenCalledTimes(1);
  });

  it("does nothing and reports zero counts when nothing is due", async () => {
    fakeState.selectQueue.push([], [], [], [], []);
    const result = await processDuePublications();
    expect(result).toEqual({ attempted: 0, polled: 0 });
  });
});

describe("reclaimStaleClaims", () => {
  it("recovers a stale 'publishing' claim back to pending on an idempotent provider, clearing its claim token", async () => {
    providerState.publishIsIdempotent = true;
    const now = new Date();
    const stalePub = basePublication({ status: "publishing", claimToken: "old-tok", claimedAt: new Date(now.getTime() - CLAIM_TIMEOUT_MS - 1000) });
    // Order: select stale-publishing rows, then (per row) select its destination, then confirming, then cancelling.
    fakeState.selectQueue.push([stalePub], [baseDestination], [], []);

    await reclaimStaleClaims(now);

    const publishingReclaim = fakeState.updates.find((u) => u.status === "pending");
    expect(publishingReclaim).toBeDefined();
    expect(publishingReclaim.claimToken).toBeNull();
  });

  it("does NOT auto-retry a crashed 'publishing' claim on a non-idempotent provider — finalizes straight to 'failed' with an ambiguous-outcome message instead", async () => {
    // Models: the process died mid-provider.publish() call on a provider
    // (like real Typefully) with no verified request dedup. Whether the
    // create request actually reached the provider is unknown, so recovering
    // it back to "pending" for an automatic retry could create a real
    // duplicate post — the only safe outcome is a terminal failure that
    // tells a human to check the provider directly.
    providerState.publishIsIdempotent = false;
    providerState.publish = vi.fn();
    const now = new Date();
    const stalePub = basePublication({ status: "publishing", claimToken: "old-tok", attemptCount: 0, claimedAt: new Date(now.getTime() - CLAIM_TIMEOUT_MS - 1000) });
    fakeState.selectQueue.push([stalePub], [baseDestination], [], []);
    primeReturning({ ...stalePub, status: "failed" });

    await reclaimStaleClaims(now);

    expect(providerState.publish).not.toHaveBeenCalled();
    const finalize = fakeState.updates.find((u) => u.status === "failed");
    expect(finalize).toBeDefined();
    expect(finalize.claimToken).toBeNull();
    expect(finalize.attemptCount).toBe(1);
    expect(finalize.lastError).toMatch(/ambiguous outcome|no verified request deduplication|whose outcome is unknown/i);
    expect(fakeState.inserts[0]).toMatchObject({ scheduledPublicationId: "pub-1", outcome: "failure" });
    // Never put back to "pending" — no automatic retry for this case.
    expect(fakeState.updates.some((u) => u.status === "pending")).toBe(false);
  });

  it("recovers a stale 'cancelling' claim back to 'queued' with cancelRequested set, instead of leaving the cancel request stuck forever", async () => {
    // Models: a process died (or a provider.cancel() call hung) right after
    // taking the "cancelling" claim. Without this recovery, the row would
    // never be picked up by the scheduler again (it only selects
    // pending/queued rows) and the user's cancel request would be silently lost.
    const now = new Date();
    const staleCancelling = basePublication({ status: "cancelling", claimToken: "old-tok", claimedAt: new Date(now.getTime() - CLAIM_TIMEOUT_MS - 1000) });
    fakeState.selectQueue.push([], [], [staleCancelling]);

    await reclaimStaleClaims(now);

    const cancellingReclaim = fakeState.updates.find((u) => u.status === "queued" && u.cancelRequested === true);
    expect(cancellingReclaim).toBeDefined();
    expect(cancellingReclaim.claimToken).toBeNull();
  });

  it("does nothing when there are no stale claims", async () => {
    fakeState.selectQueue.push([], [], []);
    await reclaimStaleClaims(new Date());
    expect(fakeState.updates).toHaveLength(0);
  });
});

describe("cancelPublication", () => {
  it("cancels a 'pending' publication purely in our own DB (never submitted, nothing to tell the provider)", async () => {
    const pub = basePublication({ status: "pending" });
    fakeState.selectQueue.push([pub]); // getCurrent lookup
    primeClaim({ ...pub, status: "cancelled" });

    const result = await cancelPublication("pub-1");

    expect(result.outcome).toBe("cancelled");
    expect(fakeState.updates[0].status).toBe("cancelled");
  });

  it("rejects cancelling a publication that is already published, failed, or cancelled", async () => {
    fakeState.selectQueue.push([basePublication({ status: "published" })]);
    const result = await cancelPublication("pub-1");
    expect(result.outcome).toBe("not_cancellable");
  });

  it("cancels a 'queued' publication by invoking the provider, not just flipping the DB status", async () => {
    const pub = basePublication({ status: "queued", externalPostId: "ext-1" });
    fakeState.selectQueue.push([pub], [baseDestination]);
    primeClaim({ ...pub, status: "cancelling", claimToken: "tok-1" }); // the claim (queued -> cancelling)
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: true });
    primeFinalize({ ...pub, status: "cancelled" }); // the final finalizeClaim() after provider confirms

    const result = await cancelPublication("pub-1");

    expect(providerState.cancel).toHaveBeenCalledWith(expect.anything(), "ext-1");
    expect(result.outcome).toBe("cancelled");
  });

  it("reports 'already_published' (never a false 'cancelled') when the provider says the post already went live", async () => {
    const pub = basePublication({ status: "queued", externalPostId: "ext-1" });
    fakeState.selectQueue.push([pub], [baseDestination]);
    primeClaim({ ...pub, status: "cancelling", claimToken: "tok-1" });
    providerState.cancel = vi.fn().mockResolvedValue({ cancelled: false, alreadyPublished: true, externalUrl: "https://x.com/late" });
    primeFinalize({ ...pub, status: "published" });

    const result = await cancelPublication("pub-1");

    expect(result.outcome).toBe("already_published");
  });

  it("flags cancelRequested (best effort) instead of lying about success when a claim is held elsewhere (in-flight provider call)", async () => {
    fakeState.selectQueue.push([basePublication({ status: "publishing" })]);
    primeClaim(basePublication({ status: "publishing", cancelRequested: true }));

    const result = await cancelPublication("pub-1");

    expect(result.outcome).toBe("pending_best_effort");
  });
});

describe("removePublishingDestination", () => {
  it("refuses to delete (and never touches the row) when publications still reference it, preserving their history", async () => {
    fakeState.selectQueue.push([{ count: 3 }]);

    const result = await removePublishingDestination("dest-1");

    expect(result).toEqual({ outcome: "in_use", publicationCount: 3 });
    expect(fakeState.deletes).toHaveLength(0);
  });

  it("deletes a destination that has zero scheduled/published publications referencing it", async () => {
    fakeState.selectQueue.push([{ count: 0 }]);

    const result = await removePublishingDestination("dest-1");

    expect(result).toEqual({ outcome: "deleted" });
    expect(fakeState.deletes).toHaveLength(1);
  });

  it("refuses to delete even when the only reference is a long-terminal (published/failed/cancelled) publication — history must survive too", async () => {
    // A destination with only historical (not pending/queued) publications
    // still has real audit value: proof of what was actually sent to a
    // provider. The guard counts every reference, not just active ones.
    fakeState.selectQueue.push([{ count: 1 }]);

    const result = await removePublishingDestination("dest-1");

    expect(result.outcome).toBe("in_use");
    expect(fakeState.deletes).toHaveLength(0);
  });

  it("safely translates a concurrent-insert race into 'in_use' instead of throwing (DB restrict constraint is the real guarantee, not the upfront count)", async () => {
    // The count says "safe to delete" (0 references) but a publication was
    // scheduled against this destination in the gap before the DELETE
    // actually runs. The DB's ON DELETE RESTRICT constraint refuses the
    // delete with a Postgres foreign-key-violation error (23503); this must
    // be caught and turned into the same documented "in_use" result, not
    // surfaced as an unhandled 500.
    fakeState.selectQueue.push([{ count: 0 }]); // upfront check: looked safe
    fakeState.deleteErrorQueue.push({ code: "23503", message: "foreign key violation" });
    fakeState.selectQueue.push([{ count: 1 }]); // re-count after the failed delete

    const result = await removePublishingDestination("dest-1");

    expect(result).toEqual({ outcome: "in_use", publicationCount: 1 });
    expect(fakeState.deletes).toHaveLength(0);
  });

  it("re-throws non-FK-violation delete errors instead of misreporting them as 'in_use'", async () => {
    fakeState.selectQueue.push([{ count: 0 }]);
    fakeState.deleteErrorQueue.push({ code: "OTHER", message: "connection reset" });

    await expect(removePublishingDestination("dest-1")).rejects.toMatchObject({ code: "OTHER" });
  });
});
