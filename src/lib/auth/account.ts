import "server-only";

import { count, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { drawings, users } from "@/db/schema";
import { hashPassword } from "./password";

export class EmailTakenError extends Error {}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Create an account. The very first account also adopts drawings made
 * before sign-in existed (rows with no owner), so nothing is stranded.
 */
export async function createUser(name: string, email: string, password: string) {
  const passwordHash = await hashPassword(password);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name, email: normalizeEmail(email), passwordHash })
        .returning({ id: users.id, name: users.name, email: users.email });
      const [{ n }] = await tx.select({ n: count() }).from(users);
      if (n === 1) {
        await tx.update(drawings).set({ userId: user.id }).where(isNull(drawings.userId));
      }
      return user;
    });
  } catch (err) {
    // 23505 = unique_violation on users_email_idx
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new EmailTakenError();
    }
    throw err;
  }
}

export async function findUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return row ?? null;
}

/**
 * Client IP for rate limiting. X-Forwarded-For is only trustworthy behind a
 * proxy you control (it sets/overwrites the header); otherwise treat this as
 * best effort.
 */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
