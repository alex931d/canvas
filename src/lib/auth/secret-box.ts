import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts small secrets the app has to read back (two-factor keys) with
 * ENCRYPTION_KEY, so a copy of the database or a backup alone doesn't give
 * them away. AES-256-GCM: a fresh 12-byte IV per value, and the 16-byte tag
 * makes any change to the stored value fail to decrypt.
 *
 * ENCRYPTION_KEY is 32 random bytes, as base64 (`openssl rand -base64 32`)
 * or 64 hex characters. Keep it: values encrypted with it can't be read
 * without it.
 */

let warned = false;

function key(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length === 32) return bytes;
  if (!warned) {
    warned = true;
    console.error("[encryption] ENCRYPTION_KEY must be 32 bytes (openssl rand -base64 32). It's being ignored.");
  }
  return null;
}

/** Whether ENCRYPTION_KEY is set (and usable). */
export function canEncrypt(): boolean {
  return key() !== null;
}

export function encrypt(plain: Uint8Array): Buffer {
  const k = key();
  if (!k) throw new Error("ENCRYPTION_KEY isn't set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** The original bytes, or null if there's no key or this value wasn't encrypted with it. */
export function decrypt(sealed: Buffer): Uint8Array | null {
  const k = key();
  if (!k || sealed.length < 29) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]));
  } catch {
    return null;
  }
}
