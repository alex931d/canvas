import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { EmailTakenError, clientIp, createUser, findUserByEmail } from "@/lib/auth/account";
import { sendVerificationCode } from "@/lib/auth/email-verification";
import { googleProfile, linkGoogle, userForGoogle, type GoogleProfile } from "@/lib/auth/google";
import { twoFactorPath, verifyEmailPath } from "@/lib/auth/next-path";
import { limiters } from "@/lib/auth/rate-limit";
import {
  createSession,
  getCurrentSession,
  invalidateUserSessions,
  setSessionCookie,
} from "@/lib/auth/session";
import { hasTwoFactor } from "@/lib/auth/two-factor";
import { readMembership } from "@/lib/billing/membership";
import { sendEmailLater } from "@/lib/email/send";
import { googleLinkedEmail } from "@/lib/email/templates";
import { emailLinkOrigin, siteOrigin } from "@/lib/site-url";
import { takeFlow } from "../state";

/**
 * GET /login/google/callback: Google sends the browser back here.
 *
 * Logging in: the canvas account linked to this Google account; else the
 * account with the same email, which gets linked (only if Google has
 * confirmed the address); else a new account. Two-factor sign-in still
 * applies. Connecting (from Settings): link it to the signed-in account.
 */

const loginError = (code: string): never => redirect(`/login?error=${code}`);
const settings = (result: string): never => redirect(`/settings?google=${result}#signing-in`);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = await takeFlow();
  if (!flow) loginError("google-expired");
  const { intent, next } = flow!;
  const fail = intent === "connect" ? settings : loginError;

  if (params.get("error")) fail(intent === "connect" ? "cancelled" : "google-cancelled");
  const code = params.get("code");
  if (!code || params.get("state") !== flow!.state) fail(intent === "connect" ? "failed" : "google-failed");
  if (!(await limiters.googleByIp.consume(await clientIp())).ok) fail(intent === "connect" ? "limited" : "google-limited");

  const origin = await siteOrigin();
  let profile: GoogleProfile;
  try {
    profile = await googleProfile(origin, code!, flow!.verifier);
  } catch (err) {
    console.error("[google] sign-in failed:", err instanceof Error ? err.message : err);
    return fail(intent === "connect" ? "failed" : "google-failed");
  }

  if (intent === "connect") return connect(profile);
  return logIn(profile, next);
}

async function connect(profile: GoogleProfile): Promise<never> {
  const { user } = await getCurrentSession();
  if (!user) loginError("google-expired");
  const result = await linkGoogle(user!.id, profile);
  if (result === "linked") await tellLinked(user!, profile.email);
  return settings(result);
}

async function logIn(profile: GoogleProfile, next: string): Promise<never> {
  let account = await userForGoogle(profile.sub);
  let created = false;

  if (!account) {
    const existing = await findUserByEmail(profile.email);
    if (existing) {
      // Only Google's word that this is their address lets it into an existing account.
      if (!profile.emailVerified) loginError("google-unverified");
      if (!existing.emailVerified) {
        // Someone signed up with this address but never confirmed it: it
        // could have been anyone. The address's owner takes the account
        // over, and that sign-up's password and sessions stop working.
        await db.update(users).set({ passwordHash: null, emailVerified: true }).where(eq(users.id, existing.id));
        await invalidateUserSessions(existing.id);
      }
      const linked = await linkGoogle(existing.id, profile);
      if (linked === "has-other") loginError("google-other");
      if (linked === "taken") loginError("google-failed");
      if (linked === "linked") await tellLinked(existing, profile.email);
      account = { id: existing.id, name: existing.name, email: existing.email, emailVerified: true };
    } else {
      if (!(await limiters.signupByIp.consume(await clientIp())).ok) loginError("google-limited");
      try {
        account = await createUser(profile.name, profile.email, null, {
          emailVerified: profile.emailVerified,
          google: { sub: profile.sub, email: profile.email },
        });
      } catch (err) {
        if (err instanceof EmailTakenError) loginError("google-failed"); // made at the same moment by another request
        throw err;
      }
      created = true;
      if (!account.emailVerified) await sendVerificationCode(account, "after-response");
    }
  }

  if (await hasTwoFactor(account.id)) {
    await setSessionCookie(await createSession(account.id, { twoFactorPending: true }));
    redirect(twoFactorPath(next));
  }
  await setSessionCookie(await createSession(account.id));
  if (!account.emailVerified) redirect(verifyEmailPath(next));
  // New accounts see the membership first, like after confirming an email.
  if (created && next === "/" && !(await readMembership(account.id)).isMember) redirect("/pricing");
  redirect(next);
}

/** Adding a way to log in is worth an email: if it wasn't them, they can act. */
async function tellLinked(user: { name: string; email: string }, googleEmail: string) {
  const origin = await emailLinkOrigin();
  sendEmailLater({
    to: user.email,
    ...googleLinkedEmail({
      name: user.name,
      email: user.email,
      googleEmail,
      resetLink: origin ? `${origin}/forgot-password` : null,
    }),
  }, { priority: "security", kind: "Google linked" });
}
