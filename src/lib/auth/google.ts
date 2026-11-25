import "server-only";

import { CodeChallengeMethod, OAuth2Client, decodeIdToken } from "arctic";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";

/*
 * "Continue with Google": OAuth 2.0 authorization code flow with PKCE and a
 * state check (arctic does the protocol; the routes are in
 * src/app/(auth)/login/google). Google's ID token comes straight from its
 * token endpoint over HTTPS, so its claims are read without checking its
 * signature (OpenID Connect Core 3.1.3.7), but the audience, issuer and
 * expiry still are.
 *
 * Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (README: Google sign-in);
 * without them the buttons don't show. GOOGLE_AUTH_URL and GOOGLE_TOKEN_URL
 * point it somewhere else, for the tests (e2e/mock-google.mjs).
 */

export const GOOGLE_CALLBACK_PATH = "/login/google/callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

type Config = { clientId: string; clientSecret: string; authUrl: string; tokenUrl: string };

function config(): Config | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authUrl: process.env.GOOGLE_AUTH_URL?.trim() || AUTH_URL,
    tokenUrl: process.env.GOOGLE_TOKEN_URL?.trim() || TOKEN_URL,
  };
}

/** Whether "Continue with Google" is set up on this server. */
export function googleEnabled(): boolean {
  return config() !== null;
}

/** Where to send the browser to sign in with Google. */
export function googleAuthorizationUrl(origin: string, state: string, codeVerifier: string): URL | null {
  const c = config();
  if (!c) return null;
  const client = new OAuth2Client(c.clientId, c.clientSecret, origin + GOOGLE_CALLBACK_PATH);
  const url = client.createAuthorizationURLWithPKCE(c.authUrl, state, CodeChallengeMethod.S256, codeVerifier, [
    "openid",
    "email",
    "profile",
  ]);
  // Always show Google's account chooser, so someone with several accounts picks the right one.
  url.searchParams.set("prompt", "select_account");
  return url;
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };

/** Trade the code Google sent back for who signed in. Throws if anything doesn't check out. */
export async function googleProfile(origin: string, code: string, codeVerifier: string): Promise<GoogleProfile> {
  const c = config();
  if (!c) throw new Error("Google sign-in isn't set up");
  const client = new OAuth2Client(c.clientId, c.clientSecret, origin + GOOGLE_CALLBACK_PATH);
  const tokens = await client.validateAuthorizationCode(c.tokenUrl, code, codeVerifier);
  const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(c.clientId)) throw new Error("ID token is for another app");
  if (!ISSUERS.includes(String(claims.iss))) throw new Error("ID token isn't from Google");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() - 60_000) throw new Error("ID token expired");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("ID token has no subject");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) throw new Error("Google didn't share an email address");

  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email.split("@")[0];
  return {
    sub: claims.sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: name.slice(0, 80),
  };
}

// ---------------------------------------------------------------- linking

/** The canvas account this Google account is linked to. */
export async function userForGoogle(sub: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerUserId, sub)));
  return row ?? null;
}

/** The Google account linked to a canvas account, if any. */
export async function googleLinkFor(userId: string) {
  const [row] = await db
    .select({ sub: oauthAccounts.providerUserId, email: oauthAccounts.email, since: oauthAccounts.createdAt })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, "google")));
  return row ?? null;
}

/**
 * Link a Google account to a canvas account. "taken": that Google account is
 * linked to another canvas account; "has-other": this canvas account already
 * has a different Google account.
 */
export async function linkGoogle(userId: string, profile: GoogleProfile): Promise<"linked" | "already" | "taken" | "has-other"> {
  const owner = await userForGoogle(profile.sub);
  if (owner) return owner.id === userId ? "already" : "taken";
  if (await googleLinkFor(userId)) return "has-other";
  const rows = await db
    .insert(oauthAccounts)
    .values({ provider: "google", providerUserId: profile.sub, userId, email: profile.email })
    .onConflictDoNothing()
    .returning({ userId: oauthAccounts.userId });
  return rows.length ? "linked" : "taken";
}

export async function unlinkGoogle(userId: string) {
  await db.delete(oauthAccounts).where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, "google")));
}

/** Whether the account has a password (accounts made with Google may not). */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ has: sql<boolean>`${users.passwordHash} is not null` })
    .from(users)
    .where(eq(users.id, userId));
  return !!row?.has;
}
