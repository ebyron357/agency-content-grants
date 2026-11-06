// Prints the TOTP code (RFC 6238, SHA1, 30 s, 6 digits) for a base32 secret, at offset steps (default 0).
import { createHmac } from "node:crypto";
const [secretArg, offsetArg] = process.argv.slice(2);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const clean = secretArg.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
let bits = ""; for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
const step = Math.floor(Date.now() / 30000) + Number(offsetArg ?? 0);
const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
const mac = createHmac("sha1", key).update(counter).digest();
const o = mac[mac.length - 1] & 0xf;
const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
console.log(String(bin % 1e6).padStart(6, "0"));
