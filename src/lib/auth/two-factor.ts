import "server-only";

import { randomBytes } from "node:crypto";
import { sha256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { createTOTPKeyURI, generateHOTP } from "@oslojs/otp";
import { and, count, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { renderSVG } from "uqr";
import { db } from "@/db";
import { twoFactorRecoveryCodes, userTwoFactor } from "@/db/schema";
import { canEncrypt, decrypt, encrypt } from "./secret-box";

/*
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238: 6 digits,
 * a new code every 30 s; Google Authenticator, 1Password, Authy… all work),
 * plus 10 one-time recovery codes for when the app isn't at hand.
 *
 *  - The app's secret key is stored encrypted with ENCRYPTION_KEY
 *    (secret-box.ts); recovery codes only as SHA-256 hashes.
 *  - A code is accepted for the current 30 s step and one on either side
 *    (for clocks that are a little off), and each step only once: a code
 *    someone sees you type can't be used again.
 *  - Setting up writes the key with no enabled_at; it's only asked for at
 *    login once a code from it has been entered (confirmSetup).
 */

const ISSUER = "canvas";
const DIGITS = 6;
const STEP_SECONDS = 30;
const RECOVERY_CODES = 10;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1

/** Whether this server can turn two-factor on (it needs ENCRYPTION_KEY). */
export const twoFactorAvailable = canEncrypt;

export type TwoFactorStatus =
  | { enabled: false; settingUp: boolean }
  | { enabled: true; since: Date; recoveryCodesLeft: number };

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const [row] = await db
    .select({ enabledAt: userTwoFactor.enabledAt })
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, userId));
  if (!row?.enabledAt) return { enabled: false, settingUp: !!row };
  const [{ left }] = await db
    .select({ left: count() })
    .from(twoFactorRecoveryCodes)
    .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt)));
  return { enabled: true, since: row.enabledAt, recoveryCodesLeft: left };
}

/** Whether logging in to this account asks for a code. */
export async function hasTwoFactor(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: userTwoFactor.userId })
    .from(userTwoFactor)
    .where(and(eq(userTwoFactor.userId, userId), isNotNull(userTwoFactor.enabledAt)));
  return !!row;
}

// ------------------------------------------------------------- set up

export type SetupDetails = {
  /** otpauth:// link: what the QR code holds, and what a phone can open directly. */
  uri: string;
  /** The key to type in by hand, in groups of four. */
  manualKey: string;
  /** The QR code, as an SVG document. */
  qrSvg: string;
};

function details(key: Uint8Array, email: string): SetupDetails {
  const uri = createTOTPKeyURI(ISSUER, email, key, STEP_SECONDS, DIGITS);
  return {
    uri,
    manualKey: encodeBase32UpperCaseNoPadding(key).replace(/(.{4})(?=.)/g, "$1 "),
    qrSvg: renderSVG(uri, { border: 2, pixelSize: 6 }),
  };
}

/**
 * A new key for the app (replacing any unfinished setup). Not asked for at
 * login until confirmSetup. Null if two-factor is already on.
 */
export async function startSetup(user: { id: string; email: string }): Promise<SetupDetails | null> {
  const key = new Uint8Array(randomBytes(20));
  const [row] = await db
    .insert(userTwoFactor)
    .values({ userId: user.id, totpKey: encrypt(key) })
    .onConflictDoUpdate({
      target: userTwoFactor.userId,
      set: { totpKey: encrypt(key), lastUsedStep: 0, createdAt: sql`now()` },
      setWhere: isNull(userTwoFactor.enabledAt),
    })
    .returning({ userId: userTwoFactor.userId });
  return row ? details(key, user.email) : null;
}

/** The setup in progress, to show its QR code again (after a reload, or a wrong code). */
export async function pendingSetup(user: { id: string; email: string }): Promise<SetupDetails | null> {
  const [row] = await db
    .select({ totpKey: userTwoFactor.totpKey })
    .from(userTwoFactor)
    .where(and(eq(userTwoFactor.userId, user.id), isNull(userTwoFactor.enabledAt)));
  const key = row ? decrypt(row.totpKey) : null;
  return key ? details(key, user.email) : null;
}

export type ConfirmResult = { ok: true; recoveryCodes: string[] } | { ok: false; reason: "wrong" | "no-setup" };

/** The first code from the app: two-factor is on, and here are the recovery codes (shown once). */
export async function confirmSetup(userId: string, code: string): Promise<ConfirmResult> {
  const [row] = await db
    .select({ totpKey: userTwoFactor.totpKey })
    .from(userTwoFactor)
    .where(and(eq(userTwoFactor.userId, userId), isNull(userTwoFactor.enabledAt)));
  const key = row ? decrypt(row.totpKey) : null;
  if (!key) return { ok: false, reason: "no-setup" };
  const step = matchingStep(key, code);
  if (step === null) return { ok: false, reason: "wrong" };
  return db.transaction(async (tx) => {
    const [enabled] = await tx
      .update(userTwoFactor)
      .set({ enabledAt: sql`now()`, lastUsedStep: step })
      .where(and(eq(userTwoFactor.userId, userId), isNull(userTwoFactor.enabledAt)))
      .returning({ userId: userTwoFactor.userId });
    if (!enabled) return { ok: false as const, reason: "no-setup" as const };
    const recoveryCodes = await replaceRecoveryCodes(tx, userId);
    return { ok: true as const, recoveryCodes };
  });
}

/** Two-factor off: the key and recovery codes are deleted. */
export async function turnOff(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId)).returning({ at: userTwoFactor.enabledAt });
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
    return rows.some((r) => r.at !== null);
  });
}

/** A fresh set of recovery codes; the old ones stop working. */
export async function newRecoveryCodes(userId: string): Promise<string[]> {
  return db.transaction((tx) => replaceRecoveryCodes(tx, userId));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  await tx.insert(twoFactorRecoveryCodes).values(codes.map((code) => ({ userId, codeHash: hashCode(code) })));
  return codes;
}

// ------------------------------------------------------------- check

export type CheckResult =
  | { ok: true; method: "app" }
  | { ok: true; method: "recovery"; recoveryCodesLeft: number }
  | { ok: false; reason: "wrong" | "format" | "no-key" };

/**
 * A code at login (or to change two-factor settings): 6 digits from the app,
 * or a recovery code, which is then used up.
 */
export async function checkCode(userId: string, input: string): Promise<CheckResult> {
  const clean = input.replace(/[\s-]/g, "").toLowerCase();
  if (/^\d{6}$/.test(clean)) return checkAppCode(userId, clean);
  if (new RegExp(`^[${ALPHABET}]{10}$`).test(clean)) return spendRecoveryCode(userId, clean);
  return { ok: false, reason: "format" };
}

async function checkAppCode(userId: string, code: string): Promise<CheckResult> {
  const [row] = await db
    .select({ totpKey: userTwoFactor.totpKey })
    .from(userTwoFactor)
    .where(and(eq(userTwoFactor.userId, userId), isNotNull(userTwoFactor.enabledAt)));
  if (!row) return { ok: false, reason: "wrong" };
  const key = decrypt(row.totpKey);
  if (!key) return { ok: false, reason: "no-key" };
  const step = matchingStep(key, code);
  if (step === null) return { ok: false, reason: "wrong" };
  // Only if this step hasn't been used yet: each code works once.
  const [used] = await db
    .update(userTwoFactor)
    .set({ lastUsedStep: step })
    .where(and(eq(userTwoFactor.userId, userId), lt(userTwoFactor.lastUsedStep, step)))
    .returning({ userId: userTwoFactor.userId });
  return used ? { ok: true, method: "app" } : { ok: false, reason: "wrong" };
}

async function spendRecoveryCode(userId: string, code: string): Promise<CheckResult> {
  const [used] = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, hashCode(code)),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    )
    .returning({ userId: twoFactorRecoveryCodes.userId });
  if (!used) return { ok: false, reason: "wrong" };
  const [{ left }] = await db
    .select({ left: count() })
    .from(twoFactorRecoveryCodes)
    .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt)));
  return { ok: true, method: "recovery", recoveryCodesLeft: left };
}

/** The 30 s step this code is for (now, or one either side), or null. */
function matchingStep(key: Uint8Array, code: string): number | null {
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const given = new TextEncoder().encode(code.padEnd(DIGITS, "x").slice(0, DIGITS));
  let found: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = new TextEncoder().encode(generateHOTP(key, BigInt(step), DIGITS));
    if (constantTimeEqual(expected, given)) found = step;
  }
  return found;
}

function recoveryCode(): string {
  let out = "";
  for (const byte of randomBytes(10)) out += ALPHABET[byte >> 3];
  return out;
}

const hashCode = (code: string) => Buffer.from(sha256(new TextEncoder().encode(code)));

/** How a recovery code is shown: two groups of five. */
export const formatRecoveryCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;
