/**
 * Standard Webhooks (https://www.standardwebhooks.com) signing — see
 * docs/decisions/automation-webhook-foundation.md for why this open spec was
 * adopted instead of a bespoke signature scheme. A subscriber can verify a
 * delivery with any existing Standard-Webhooks-compatible library; nothing
 * Content Machine-specific is required to consume it.
 *
 * Secret format: "whsec_<base64-encoded random bytes>". Signed content is
 * exactly `${id}.${timestamp}.${body}` where `id` is the delivery id,
 * `timestamp` is whole seconds since epoch, and `body` is the exact raw JSON
 * string sent on the wire. Signature header: "v1,<base64 hmac-sha256>".
 */
import { randomBytes, createHmac } from "crypto";

const SECRET_PREFIX = "whsec_";

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

function secretKeyBytes(secret: string): Buffer {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return Buffer.from(raw, "base64");
}

/** Computes the `webhook-signature` value's payload (without the "v1," scheme prefix). */
export function computeSignature(secret: string, id: string, timestampSeconds: number, body: string): string {
  const signedContent = `${id}.${timestampSeconds}.${body}`;
  return createHmac("sha256", secretKeyBytes(secret)).update(signedContent).digest("base64");
}

export interface SignedWebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

export function signWebhook(secret: string, id: string, body: string, timestampSeconds: number = Math.floor(Date.now() / 1000)): SignedWebhookHeaders {
  const signature = computeSignature(secret, id, timestampSeconds, body);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestampSeconds),
    "webhook-signature": `v1,${signature}`,
  };
}

/** Verifies a received delivery — provided for our own tests and as a documented reference implementation; real subscribers do this on their own end. */
export function verifyWebhookSignature(secret: string, id: string, timestampSeconds: number, body: string, signatureHeader: string): boolean {
  const expected = computeSignature(secret, id, timestampSeconds, body);
  return signatureHeader.split(" ").some((scheme) => {
    const [version, sig] = scheme.split(",");
    return version === "v1" && sig === expected;
  });
}
