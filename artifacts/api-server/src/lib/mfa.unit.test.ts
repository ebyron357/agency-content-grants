import { afterEach, describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  currentStep,
  groupSecret,
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  otpauthUri,
  sealSecret,
  totpAt,
  verifyTotp,
} from "./mfa";

const RFC_KEY = Buffer.from("12345678901234567890", "ascii");

describe("TOTP (RFC 6238 SHA-1 test vectors)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("time %i gives %s", (seconds, code) => {
    expect(totpAt(RFC_KEY, Math.floor(seconds / 30), 8)).toBe(code);
    expect(totpAt(RFC_KEY, Math.floor(seconds / 30))).toBe(code.slice(2));
  });

  it("round-trips base32", () => {
    expect(base32Encode(RFC_KEY)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(RFC_KEY)).toBe(true);
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("accepts the current and adjacent steps once, and nothing else", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const now = Date.UTC(2026, 10, 4, 12, 0, 15);
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    // Replay: once a step is used, it and earlier steps are refused.
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, ` ${totpAt(secret, step + 1).slice(0, 3)} ${totpAt(secret, step + 1).slice(3)} `, step, now)).toBe(step + 1);
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    expect(verifyTotp(secret, 123456, null, now)).toBeNull();
  });

  it("builds an authenticator link", () => {
    const uri = otpauthUri("ABCDEFGH", "ana@example.org");
    expect(uri).toBe("otpauth://totp/GrantCrest%3Aana%40example.org?secret=ABCDEFGH&issuer=GrantCrest&algorithm=SHA1&digits=6&period=30");
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});

describe("secret sealing", () => {
  const saved = process.env.MFA_ENCRYPTION_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = saved;
  });

  it("encrypts with MFA_ENCRYPTION_KEY and refuses to read it without the key", () => {
    process.env.MFA_ENCRYPTION_KEY = "test-mfa-encryption-key-not-for-production";
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(sealSecret("JBSWY3DPEHPK3PXP")).not.toBe(sealed);
    expect(openSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
    process.env.MFA_ENCRYPTION_KEY = "a-different-key";
    expect(() => openSecret(sealed)).toThrow();
    delete process.env.MFA_ENCRYPTION_KEY;
    expect(() => openSecret(sealed)).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it("marks unencrypted secrets when no key is set", () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    expect(sealSecret("ABC")).toBe("v0:ABC");
    expect(openSecret("v0:ABC")).toBe("ABC");
  });
});

describe("recovery codes", () => {
  it("are distinct, readable and hashed independent of formatting", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{2}$/);
    expect(hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, " "))).toBe(hashRecoveryCode(codes[0]));
    expect(normalizeRecoveryCode("short")).toBeNull();
  });
});
