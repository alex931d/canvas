import "server-only";

import { createHash } from "node:crypto";
import { sha256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { avatarUrl } from "@/lib/profile/avatar";
import {
  ACTIVITY_CHECK_INTERVAL_SECONDS,
  INACTIVITY_TIMEOUT_SECONDS,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  secureCookies,
} from "./constants";
import { can, type Permission, type Role } from "./roles";

/*
 * Session management, recreated from the Lucia guide (lucia-auth.com):
 *
 *  - The client holds a token "<id>.<secret>". Both halves are 24 random
 *    characters from a 32-letter alphabet (120 bits each).
 *  - The database stores the id and SHA-256(secret), never the secret, so a
 *    leaked sessions table can't be used to sign in. A fast hash is fine here
 *    because the secret is random, not a human password.
 *  - Validation looks the session up by id, then compares hashes in constant
 *    time.
 *  - Inactivity timeout: sessions unused for 30 days are deleted;
 *    last_verified_at is refreshed at most once an hour.
 */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  /** Their profile picture, or null to show initials (src/lib/profile/avatar.ts). */
  avatarUrl: string | null;
};
export type CurrentSession = { id: string; userId: string; createdAt: Date; lastVerifiedAt: Date };
type ValidationResult =
  | { session: CurrentSession; user: SessionUser }
  | { session: null; user: null };

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1

function generateSecureRandomString(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte >> 3]; // top 5 bits -> 0..31
  return out;
}

function hashSecret(secret: string): Uint8Array {
  return sha256(new TextEncoder().encode(secret));
}

/** Create a session for a user and return the token to put in the cookie. */
export async function createSession(userId: string): Promise<string> {
  const id = generateSecureRandomString();
  const secret = generateSecureRandomString();
  await db.insert(sessions).values({ id, secretHash: Buffer.from(hashSecret(secret)), userId });
  return `${id}.${secret}`;
}

export async function validateSessionToken(token: string): Promise<ValidationResult> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { session: null, user: null };
  const [id, secret] = parts;

  const [row] = await db
    .select({
      id: sessions.id,
      secretHash: sessions.secretHash,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      lastVerifiedAt: sessions.lastVerifiedAt,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      role: users.role,
      avatarUpdatedAt: users.avatarUpdatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return { session: null, user: null };

  const now = Date.now();
  if (now - row.lastVerifiedAt.getTime() >= INACTIVITY_TIMEOUT_SECONDS * 1000) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return { session: null, user: null };
  }

  if (!constantTimeEqual(hashSecret(secret), new Uint8Array(row.secretHash))) {
    return { session: null, user: null };
  }

  let lastVerifiedAt = row.lastVerifiedAt;
  if (now - lastVerifiedAt.getTime() >= ACTIVITY_CHECK_INTERVAL_SECONDS * 1000) {
    lastVerifiedAt = new Date(now);
    await db.update(sessions).set({ lastVerifiedAt }).where(eq(sessions.id, id));
  }

  return {
    session: { id: row.id, userId: row.userId, createdAt: row.createdAt, lastVerifiedAt },
    user: {
      id: row.userId,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      role: row.role,
      avatarUrl: avatarUrl(row.userId, row.avatarUpdatedAt),
    },
  };
}

export async function invalidateSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  for (const [key, hit] of recentSessions) if (hit.sessionId === sessionId) recentSessions.delete(key);
}

/** Sign a user out everywhere (e.g. after a password change). */
export async function invalidateUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  for (const [key, hit] of recentSessions) if (hit.user.id === userId) recentSessions.delete(key);
}

// ------------------------------------------------------------- cookies
// Only Server Actions, Route Handlers and the proxy can set cookies.

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

export async function deleteSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ------------------------------------------------- data access layer

/** The signed-in user for this request (validated once per request). */
export const getCurrentSession = cache(async (): Promise<ValidationResult> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  if (!token) return { session: null, user: null };
  return validateSessionToken(token);
});

type RecentSession = { sessionId: string; user: SessionUser; at: number };
const gs = globalThis as unknown as { canvasRecentSessions?: Map<string, RecentSession> };
const recentSessions = (gs.canvasRecentSessions ??= new Map());

/**
 * For requests that come many times a second and carry nothing to protect
 * (cursor positions): the signed-in user, remembered by this server for
 * `maxAgeMs` instead of read from the database every time. Signing out on
 * this server forgets it at once; on another server, within `maxAgeMs`.
 * Keyed by a hash of the token, so no tokens are kept.
 */
export async function getRecentSessionUser(maxAgeMs = 10_000): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const key = createHash("sha256").update(token).digest("base64url");
  const hit = recentSessions.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.user;
  const { session, user } = await validateSessionToken(token);
  if (recentSessions.size > 5000) recentSessions.clear();
  if (session) recentSessions.set(key, { sessionId: session.id, user, at: Date.now() });
  else recentSessions.delete(key);
  return user;
}

/**
 * For pages and Server Actions: the user, or a redirect to the login page.
 * Accounts that haven't confirmed their email yet go to /verify-email: that
 * page is all they can open until they do.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await requireSignedIn();
  if (!user.emailVerified) redirect("/verify-email");
  return user;
}

/**
 * For staff pages: the signed-in user if their role has `permission`. Anyone
 * else gets the 404 page, so the admin pages don't reveal that they exist.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) notFound();
  return user;
}

/** Like requireUser, but lets in accounts whose email isn't confirmed yet (for /verify-email itself). */
export async function requireSignedIn(): Promise<SessionUser> {
  const { user } = await getCurrentSession();
  if (!user) redirect("/login");
  return user;
}
