"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { userTwoFactor } from "@/db/schema";
import { hasPassword, unlinkGoogle } from "@/lib/auth/google";
import { RESET_LINK_LIFETIME_MINUTES, sendPasswordResetLink } from "@/lib/auth/password-reset";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession, invalidateOtherSessions } from "@/lib/auth/session";
import {
  checkCode,
  confirmSetup,
  formatRecoveryCode,
  newRecoveryCodes,
  startSetup,
  turnOff,
  twoFactorAvailable,
  type SetupDetails,
} from "@/lib/auth/two-factor";
import { sendEmailLater } from "@/lib/email/send";
import { twoFactorOffEmail, twoFactorOnEmail } from "@/lib/email/templates";
import { emailLinkOrigin } from "@/lib/site-url";

/*
 * Settings > Signing in: two-factor sign-in, Google, and the password.
 * Changing two-factor needs a current code (from the app or a recovery
 * code), so a borrowed, signed-in laptop isn't enough to turn it off.
 */

const SIGNED_OUT = "Your session ended. Log in again to change your settings.";
const TOO_MANY = "Too many tries. Wait a minute and try again.";

async function signedIn() {
  const { session, user } = await getCurrentSession();
  return session && user.emailVerified ? { session, user } : null;
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

async function resetLink() {
  const origin = await emailLinkOrigin();
  return origin ? `${origin}/forgot-password` : null;
}

// ------------------------------------------------------------ two-factor

export type SetupResult = { ok: true; setup: SetupDetails } | { ok: false; error: string };

/** A new key and QR code for the authenticator app. */
export async function beginTwoFactor(): Promise<SetupResult> {
  const me = await signedIn();
  if (!me) return { ok: false, error: SIGNED_OUT };
  if (!twoFactorAvailable()) return { ok: false, error: "Two-factor sign-in isn't available on this site yet." };
  if (!(await limiters.profileByUser.consume(me.user.id)).ok) {
    return { ok: false, error: "That's a lot of changes at once. Wait a few seconds and try again." };
  }
  const setup = await startSetup(me.user);
  if (!setup) return { ok: false, error: "Two-factor sign-in is already on." };
  return { ok: true, setup };
}

/** Stop a setup before it's finished. */
export async function cancelTwoFactorSetup(): Promise<void> {
  const me = await signedIn();
  if (!me) return;
  await db.delete(userTwoFactor).where(and(eq(userTwoFactor.userId, me.user.id), isNull(userTwoFactor.enabledAt)));
  refresh();
}

export type CodesState = { error?: string; recoveryCodes?: string[]; ok?: string };

/** The first code from the app turns it on; the recovery codes are shown once. */
export async function confirmTwoFactor(_prev: CodesState, formData: FormData): Promise<CodesState> {
  const me = await signedIn();
  if (!me) return { error: SIGNED_OUT };
  if (!(await limiters.twoFactorByUser.consume(me.user.id)).ok) return { error: TOO_MANY };
  const code = str(formData.get("code")).replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code your app shows for canvas." };

  const result = await confirmSetup(me.user.id, code);
  if (!result.ok) {
    return result.reason === "wrong"
      ? { error: "That code isn't right. Check the time on your phone is set automatically, then try the newest code." }
      : { error: "This setup has ended. Start again." };
  }
  // Anyone else who was signed in has to log in again, now with a code.
  await invalidateOtherSessions(me.user.id, me.session.id);
  sendEmailLater({ to: me.user.email, ...twoFactorOnEmail({ ...me.user, resetLink: await resetLink() }) });
  refresh(); // the codes stay on screen (client state); the page behind them now says it's on
  return { recoveryCodes: result.recoveryCodes.map(formatRecoveryCode) };
}

/** Turn it off, with a current code. */
export async function disableTwoFactor(_prev: CodesState, formData: FormData): Promise<CodesState> {
  const me = await signedIn();
  if (!me) return { error: SIGNED_OUT };
  const check = await currentCode(me.user.id, formData);
  if (check) return { error: check };
  await turnOff(me.user.id);
  sendEmailLater({ to: me.user.email, ...twoFactorOffEmail({ ...me.user, byStaff: false, resetLink: await resetLink() }) });
  refresh();
  return { ok: "Two-factor sign-in is off." };
}

/** A new set of recovery codes (the old ones stop working), with a current code. */
export async function regenerateRecoveryCodes(_prev: CodesState, formData: FormData): Promise<CodesState> {
  const me = await signedIn();
  if (!me) return { error: SIGNED_OUT };
  const check = await currentCode(me.user.id, formData);
  if (check) return { error: check };
  const codes = await newRecoveryCodes(me.user.id);
  refresh();
  return { recoveryCodes: codes.map(formatRecoveryCode) };
}

/** Null when the form's code checks out, else what to say. */
async function currentCode(userId: string, formData: FormData): Promise<string | null> {
  if (!(await limiters.twoFactorByUser.consume(userId)).ok) return TOO_MANY;
  const result = await checkCode(userId, str(formData.get("code")).slice(0, 40));
  if (result.ok) return null;
  if (result.reason === "format") return "Enter the 6-digit code from your app, or a recovery code.";
  if (result.reason === "no-key") return "Codes from your app can't be checked on this server right now. Use a recovery code.";
  return "That code isn't right (each code works once).";
}

// ---------------------------------------------------------------- Google

export type SimpleState = { ok?: string; error?: string };

export async function disconnectGoogle(): Promise<SimpleState> {
  const me = await signedIn();
  if (!me) return { error: SIGNED_OUT };
  if (!(await hasPassword(me.user.id))) {
    return { error: "Set a password first, so you can still log in without Google." };
  }
  await unlinkGoogle(me.user.id);
  refresh();
  return { ok: "Google is disconnected. Log in with your email and password." };
}

// -------------------------------------------------------------- password

/** The "Forgot password?" link, sent to your own address: how you set or change your password. */
export async function emailPasswordLink(): Promise<SimpleState> {
  const me = await signedIn();
  if (!me) return { error: SIGNED_OUT };
  let result;
  try {
    result = await sendPasswordResetLink(me.user.email, await emailLinkOrigin());
  } catch (err) {
    console.error("[email] couldn't send a password link:", err);
    return { error: "The email couldn't be sent. Try again in a minute." };
  }
  if (result === "limited") return { error: "We've sent you 3 of these recently. Check your inbox, or try again in 20 minutes." };
  if (result === "no-app-url") return { error: "This site can't send links yet (APP_URL isn't set)." };
  if (result !== "sent") return { error: SIGNED_OUT };
  return { ok: `We sent a link to ${me.user.email}. It works for ${RESET_LINK_LIFETIME_MINUTES} minutes.` };
}
