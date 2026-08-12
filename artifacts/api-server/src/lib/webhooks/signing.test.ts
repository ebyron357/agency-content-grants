/**
 * Standard Webhooks signing — pure crypto, no db/network involved.
 */
import { describe, it, expect } from "vitest";
import { generateWebhookSecret, computeSignature, signWebhook, verifyWebhookSignature } from "./signing";

describe("generateWebhookSecret", () => {
  it("produces a whsec_-prefixed secret with sufficient entropy", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_/);
    expect(a).not.toEqual(b);
  });
});

describe("signWebhook / verifyWebhookSignature", () => {
  const secret = generateWebhookSecret();
  const id = "whd_test123";
  const body = JSON.stringify({ type: "project.created", data: { projectId: "p1" } });
  const timestamp = 1_700_000_000;

  it("produces a v1,<base64> signature header", () => {
    const headers = signWebhook(secret, id, body, timestamp);
    expect(headers["webhook-id"]).toBe(id);
    expect(headers["webhook-timestamp"]).toBe(String(timestamp));
    expect(headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/=]+$/);
  });

  it("verifies successfully against the correct secret/id/timestamp/body", () => {
    const headers = signWebhook(secret, id, body, timestamp);
    expect(verifyWebhookSignature(secret, id, timestamp, body, headers["webhook-signature"])).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    expect(computeSignature(secret, id, timestamp, body)).toBe(computeSignature(secret, id, timestamp, body));
  });

  it("rejects a tampered body", () => {
    const headers = signWebhook(secret, id, body, timestamp);
    const tampered = JSON.stringify({ type: "project.created", data: { projectId: "p2" } });
    expect(verifyWebhookSignature(secret, id, timestamp, tampered, headers["webhook-signature"])).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const headers = signWebhook(generateWebhookSecret(), id, body, timestamp);
    expect(verifyWebhookSignature(secret, id, timestamp, body, headers["webhook-signature"])).toBe(false);
  });

  it("rejects a signature computed with a different delivery id", () => {
    const headers = signWebhook(secret, "whd_other", body, timestamp);
    expect(verifyWebhookSignature(secret, id, timestamp, body, headers["webhook-signature"])).toBe(false);
  });

  it("rejects a signature computed with a different timestamp", () => {
    const headers = signWebhook(secret, id, body, timestamp);
    expect(verifyWebhookSignature(secret, id, timestamp + 1, body, headers["webhook-signature"])).toBe(false);
  });

  it("accepts a space-separated multi-scheme signature header if one scheme matches", () => {
    const correct = signWebhook(secret, id, body, timestamp)["webhook-signature"];
    const multi = `v0,unrelated ${correct}`;
    expect(verifyWebhookSignature(secret, id, timestamp, body, multi)).toBe(true);
  });
});
