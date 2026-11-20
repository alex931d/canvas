import "server-only";

import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailVerificationCodes, passwordResetTokens, sessions, users } from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates";
import { findUserByEmail } from "./account";
import { limiters } from "./rate-limit";

/*
 * Password reset links (the Copenhagen Book's "password reset"):
 *
 *  - The link carries 32 random bytes (256 bits); only SHA-256 of it is
 *    stored, so a leaked table holds no working links.
 *  - A link works once, for 1 hour, and only while the account still uses
 *    the address it was sent to.
 *  - Setting the new password removes every link for the account, signs it
 *    out everywhere and counts its email as confirmed (opening the link
 *    proves they read that inbox).
 *  - The "forgot password" page answers the same whether or not an account
 *    uses the address, and sends nothing when none does.
 */

export const RESET_LINK_LIFETIME_MINUTES = 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => Buffer.from(sha256(new TextEncoder().encode(token)));

export type ResetLinkResult = "sent" | "no-account" | "no-app-url" | "limited";

/**
 * Email a reset link if an account uses this address. The forgot-password
 * action runs this after its response has gone out, so how long it takes
 * says nothing about whether the account exists; the admin dashboard awaits
 * it to report the result.
 */
export async function sendPasswordResetLink(email: string, origin: string | null): Promise<ResetLinkResult> {
  const user = await findUserByEmail(email);
  if (!user) return "no-account";
  if (!origin) {
    console.error(
      "[email] Set APP_URL to this site's address so password reset emails can link to it. No reset email was sent.",
    );
    return "no-app-url";
  }
  if (!limiters.resetEmailsByAddress.consume(user.email)) return "limited";

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = encodeBase64urlNoPadding(bytes);
  await db.insert(passwordResetTokens).values({
    tokenHash: hashToken(token),
    userId: user.id,
    email: user.email,
    expiresAt: sql`now() + make_interval(mins => ${RESET_LINK_LIFETIME_MINUTES})`,
  });
  // Tidy up this account's dead links while we're here.
  await db
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, user.id), lte(passwordResetTokens.expiresAt, sql`now()`)));

  await sendEmail({ to: user.email, ...passwordResetEmail({ name: user.name, link: `${origin}/reset-password/${token}` }) });
  return "sent";
}

/** The account a reset link is for, while the link still works. Doesn't use it up. */
export async function findResetLink(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(passwordResetTokens)
    .innerJoin(users, and(eq(users.id, passwordResetTokens.userId), eq(users.email, passwordResetTokens.email)))
    .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), gt(passwordResetTokens.expiresAt, sql`now()`)));
  return row ?? null;
}

/**
 * Use the link up and set the new password (already hashed). Returns the
 * account, or null when the link no longer works.
 */
export async function resetPassword(token: string, passwordHash: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  return db.transaction(async (tx) => {
    const [link] = await tx
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
      .returning({
        userId: passwordResetTokens.userId,
        email: passwordResetTokens.email,
        live: sql<boolean>`${passwordResetTokens.expiresAt} > now()`,
      });
    if (!link?.live) return null;

    const [user] = await tx
      .update(users)
      .set({ passwordHash, emailVerified: true })
      .where(and(eq(users.id, link.userId), eq(users.email, link.email)))
      .returning({ id: users.id, name: users.name, email: users.email });
    if (!user) return null;

    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    return user;
  });
}
