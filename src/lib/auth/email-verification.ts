import "server-only";

import { randomInt } from "node:crypto";
import { sha256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailVerificationCodes, users } from "@/db/schema";
import { sendEmail, sendEmailLater } from "@/lib/email/send";
import { verificationEmail } from "@/lib/email/templates";
import { emailLinkOrigin } from "@/lib/site-url";
import { limiters } from "./rate-limit";

/*
 * Confirming an account's email (the Copenhagen Book's "email verification
 * codes"): after sign-up we email an 8-digit code, and the account can't use
 * anything but /verify-email until it's entered.
 *
 *  - Codes come from a CSPRNG and only SHA-256(code) is stored.
 *  - A code works for 15 minutes and 5 wrong tries; then a new one is needed.
 *  - New codes: at most one a minute, and 5 then one per 10 minutes.
 *  - The email's link only fills the code in (GET changes nothing), so link
 *    scanners in mail systems can't use the code up.
 *  - A code only verifies the address it was sent to.
 */

export const CODE_LIFETIME_MINUTES = 15;
export const RESEND_AFTER_SECONDS = 60;
export const MAX_WRONG_CODES = 5;

type Account = { id: string; name: string; email: string };

const hashCode = (code: string) => Buffer.from(sha256(new TextEncoder().encode(code)));

/** "1234 5678", "1234-5678" → "12345678"; anything else → null. */
export function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "");
  return /^\d{8}$/.test(code) ? code : null;
}

export type SendCodeResult =
  | { ok: true }
  | { ok: false; reason: "wait"; seconds: number }
  | { ok: false; reason: "failed" };

/** Seconds until this account may be sent another code (0 = now). */
export async function secondsUntilResend(userId: string): Promise<number> {
  const [row] = await db
    .select({
      seconds: sql<number>`ceil(extract(epoch from (${emailVerificationCodes.sentAt} + make_interval(secs => ${RESEND_AFTER_SECONDS}) - now())))::int`,
    })
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.userId, userId));
  return Math.max(0, row?.seconds ?? 0);
}

/**
 * Make a new code for the account (the old one stops working) and email it.
 * `deliver: "now"` sends before returning so a failure can be shown;
 * "after-response" sends once the page has gone out.
 */
export async function sendVerificationCode(account: Account, deliver: "now" | "after-response"): Promise<SendCodeResult> {
  const wait = await secondsUntilResend(account.id);
  if (wait > 0) return { ok: false, reason: "wait", seconds: wait };
  const limit = await limiters.codeEmailsByUser.consume(account.id);
  if (!limit.ok) return { ok: false, reason: "wait", seconds: limit.retryAfter };

  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  const row = {
    email: account.email,
    codeHash: hashCode(code),
    attempts: 0,
    sentAt: sql`now()`,
    expiresAt: sql`now() + make_interval(mins => ${CODE_LIFETIME_MINUTES})`,
  };
  await db
    .insert(emailVerificationCodes)
    .values({ userId: account.id, ...row })
    .onConflictDoUpdate({ target: emailVerificationCodes.userId, set: row });

  const origin = await emailLinkOrigin();
  const link = origin ? `${origin}/verify-email?code=${code}` : null;
  const email = { to: account.email, ...verificationEmail({ name: account.name, code, link }) };
  if (deliver === "after-response") {
    sendEmailLater(email);
    return { ok: true };
  }
  try {
    await sendEmail(email);
    return { ok: true };
  } catch (err) {
    console.error(`[email] couldn't send a confirmation code to ${account.email}:`, err);
    // Let them ask again straight away.
    await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, account.id));
    return { ok: false, reason: "failed" };
  }
}

/** At login: send a code unless one that still works is already out there. */
export async function ensureVerificationCode(account: Account) {
  const [usable] = await db
    .select({ userId: emailVerificationCodes.userId })
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.userId, account.id),
        eq(emailVerificationCodes.email, account.email),
        gt(emailVerificationCodes.expiresAt, sql`now()`),
        lt(emailVerificationCodes.attempts, MAX_WRONG_CODES),
      ),
    );
  if (!usable) await sendVerificationCode(account, "after-response");
}

export type CheckCodeResult =
  | { status: "verified" }
  | { status: "wrong"; triesLeft: number }
  | { status: "expired" | "used-up" | "none" };

/** Check a code; the right one marks the account's email as confirmed. */
export async function checkVerificationCode(account: Account, code: string): Promise<CheckCodeResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        email: emailVerificationCodes.email,
        codeHash: emailVerificationCodes.codeHash,
        attempts: emailVerificationCodes.attempts,
        expired: sql<boolean>`${emailVerificationCodes.expiresAt} <= now()`,
      })
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.userId, account.id))
      .for("update");
    if (!row || row.email !== account.email) return { status: "none" };
    if (row.expired) return { status: "expired" };
    if (row.attempts >= MAX_WRONG_CODES) return { status: "used-up" };

    if (!constantTimeEqual(hashCode(code), new Uint8Array(row.codeHash))) {
      const attempts = row.attempts + 1;
      await tx.update(emailVerificationCodes).set({ attempts }).where(eq(emailVerificationCodes.userId, account.id));
      return attempts >= MAX_WRONG_CODES ? { status: "used-up" } : { status: "wrong", triesLeft: MAX_WRONG_CODES - attempts };
    }

    await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, account.id));
    await tx
      .update(users)
      .set({ emailVerified: true })
      .where(and(eq(users.id, account.id), eq(users.email, row.email)));
    return { status: "verified" };
  });
}
