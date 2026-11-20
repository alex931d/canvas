import "server-only";

import { hash, verify } from "@node-rs/argon2";
import { sha1 } from "@oslojs/crypto/sha1";
import { encodeHexLowerCase } from "@oslojs/encoding";

/**
 * Password hashing with Argon2id (the parameters used in the Lucia examples,
 * which follow OWASP's minimum: 19 MiB memory, 2 iterations, 1 lane).
 */

const ARGON2 = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A real hash to verify against when the email doesn't exist, so timing doesn't reveal it. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash() {
  return (dummyHash ??= hashPassword("not-a-real-password-just-for-timing"));
}

export type StrengthResult = { ok: true } | { ok: false; message: string };

/**
 * Length limits plus a check against known breached passwords using the
 * Have I Been Pwned range API (k-anonymity: only the first 5 hex characters
 * of the SHA-1 leave the server). If that service can't be reached the check
 * is skipped rather than blocking sign-up. Set PASSWORD_BREACH_CHECK=off to
 * disable it.
 */
export async function checkPasswordStrength(password: string): Promise<StrengthResult> {
  if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
  if (password.length > 255) return { ok: false, message: "Use at most 255 characters." };
  if (process.env.PASSWORD_BREACH_CHECK === "off") return { ok: true };

  const digest = encodeHexLowerCase(sha1(new TextEncoder().encode(password)));
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { ok: true };
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix?.toLowerCase() === suffix && Number(count) > 0) {
        return {
          ok: false,
          message: "This password has appeared in a data breach. Choose a different one.",
        };
      }
    }
  } catch {
    // Offline or blocked: don't stop people signing up.
  }
  return { ok: true };
}
