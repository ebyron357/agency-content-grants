/**
 * Password utilities using Node.js built-in crypto.scrypt.
 * scrypt is a memory-hard key derivation function — equivalent
 * security to argon2 with no native compilation required.
 */
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedKey] = hash.split(":");
  if (!salt || !storedKey) return false;
  const derivedKey = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  const storedBuf = Buffer.from(storedKey, "hex");
  if (derivedKey.length !== storedBuf.length) return false;
  return timingSafeEqual(derivedKey, storedBuf);
}
