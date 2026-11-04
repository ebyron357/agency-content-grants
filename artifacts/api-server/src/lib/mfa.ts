import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238: HMAC-SHA1,
 * 30-second steps, 6 digits), and single-use recovery codes.
 *
 * Pure module: no database import. Secrets are encrypted at rest with
 * AES-256-GCM under MFA_ENCRYPTION_KEY. Without that key they are stored
 * unencrypted and marked "v0:"; the security screen says so and the docs
 * tell the owner to set the key. Rotating SESSION_SECRET never affects them.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step too, for clock drift. */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
export const ISSUER = "Content Machine";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpAt(secret: string | Buffer, step: number, digits = TOTP_DIGITS): string {
  const key = typeof secret === "string" ? base32Decode(secret) : secret;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a code. Returns the step it matched, or null. A step at or before
 * `lastStep` is refused, so each code works once.
 */
export function verifyTotp(secret: string, code: unknown, lastStep: number | null, now = Date.now()): number | null {
  if (typeof code !== "string") return null;
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const candidate = step + delta;
    if (lastStep !== null && candidate <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(clean))) return candidate;
  }
  return null;
}

/** The otpauth:// link an authenticator app scans. */
export function otpauthUri(secret: string, account: string, issuer = ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Groups a secret in fours so it is easy to type. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function encryptionKey(): Buffer | null {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  // Any string works: it is stretched to 32 bytes, so Render's generated value can be used as is.
  return createHash("sha256").update(raw).digest();
}

export function mfaEncryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

export function sealSecret(secret: string): string {
  const key = encryptionKey();
  if (!key) return `v0:${secret}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function openSecret(sealed: string): string {
  if (sealed.startsWith("v0:")) return sealed.slice(3);
  if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format");
  const key = encryptionKey();
  if (!key) throw new Error("MFA_ENCRYPTION_KEY is not set, so the two-factor secret cannot be read.");
  const [iv, tag, body] = sealed.slice(3).split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Recovery codes look like "7KQ2-M9XD-PL": 10 base32 characters, about 50 bits each. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
  });
}

export function normalizeRecoveryCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const clean = code.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{10}$/.test(clean) ? clean : null;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`recovery:${normalizeRecoveryCode(code) ?? code}`).digest("hex");
}
