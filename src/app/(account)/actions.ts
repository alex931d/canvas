"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { clientIp, isValidEmail, normalizeEmail } from "@/lib/auth/account";
import { verifyCaptcha } from "@/lib/auth/captcha";
import {
  RESEND_AFTER_SECONDS,
  checkVerificationCode,
  normalizeCode,
  sendVerificationCode,
} from "@/lib/auth/email-verification";
import { safeNext, twoFactorPath } from "@/lib/auth/next-path";
import { checkPasswordStrength, hashPassword } from "@/lib/auth/password";
import { findResetLink, resetPassword, sendPasswordResetLink } from "@/lib/auth/password-reset";
import { limiters } from "@/lib/auth/rate-limit";
import { createSession, requireSignedIn, setSessionCookie } from "@/lib/auth/session";
import { hasTwoFactor } from "@/lib/auth/two-factor";
import { readMembership } from "@/lib/billing/membership";
import { sendEmailLater } from "@/lib/email/send";
import { passwordChangedEmail } from "@/lib/email/templates";
import { emailLinkOrigin } from "@/lib/site-url";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** Where a newly confirmed or reset account goes: on to `next`, else the drawings or the pricing page. */
async function landingFor(userId: string, next = "/") {
  if (next !== "/") return next;
  return (await readMembership(userId)).isMember ? "/" : "/pricing";
}

// ----------------------------------------------------------- confirm email

export type VerifyState = { error?: string; code?: string };

export async function verifyEmail(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const user = await requireSignedIn();
  const next = safeNext(formData.get("next"));
  if (user.emailVerified) redirect(next);

  const raw = str(formData.get("code")).slice(0, 32);
  if (!(await limiters.codeChecksByUser.consume(user.id)).ok) {
    return { error: "Too many tries. Wait a minute and try again.", code: raw };
  }
  const code = normalizeCode(raw);
  if (!code) return { error: "Enter the 8-digit code from the email.", code: raw };

  const result = await checkVerificationCode(user, code);
  switch (result.status) {
    case "verified":
      redirect(await landingFor(user.id, next));
    case "wrong":
      return {
        error: `That code isn't right. Check the email and try again (${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left).`,
        code: raw,
      };
    case "used-up":
      return { error: "Too many wrong codes. Send a new code and enter that one.", code: "" };
    case "expired":
      return { error: "That code has expired. Send a new code and enter that one.", code: "" };
    case "none":
      return { error: "That code doesn't work anymore. Send a new code and enter that one.", code: "" };
  }
}

export type ResendState = { notice?: string; error?: string; wait?: number };

export async function resendCode(): Promise<ResendState> {
  const user = await requireSignedIn();
  if (user.emailVerified) redirect("/");
  const sent = await sendVerificationCode(user, "now");
  if (sent.ok) return { notice: `We sent a new code to ${user.email}.`, wait: RESEND_AFTER_SECONDS };
  if (sent.reason === "wait") return { wait: sent.seconds };
  return { error: "We couldn't send the email just now. Try again in a minute." };
}

// ----------------------------------------------------------- forgot password

export type ForgotState = { error?: string; emailError?: string; email?: string; sent?: boolean };

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = normalizeEmail(str(formData.get("email")));
  const ip = await clientIp();
  if (!(await limiters.resetRequestsByIp.consume(ip)).ok) {
    return { error: "Too many requests from this network. Wait a minute and try again.", email };
  }
  const human = await verifyCaptcha(formData, "reset");
  if (!human.ok) return { error: human.error, email };
  if (!isValidEmail(email)) return { emailError: "Enter a valid email address.", email };

  // The same answer, in the same time, whether or not an account uses this
  // address: the lookup and the email happen after the response.
  const origin = await emailLinkOrigin();
  after(async () => {
    try {
      await sendPasswordResetLink(email, origin);
    } catch (err) {
      console.error("[email] couldn't send a password reset link:", err);
    }
  });
  return { sent: true, email };
}

// ----------------------------------------------------------- new password

export type ResetState = {
  error?: string;
  fieldErrors?: { password?: string; confirm?: string };
  /** The link stopped working (used, expired or replaced). */
  expired?: boolean;
};

export async function setNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = str(formData.get("token"));
  const password = str(formData.get("password"));
  const confirm = str(formData.get("confirm"));

  const ip = await clientIp();
  if (!(await limiters.passwordResetsByIp.consume(ip)).ok) {
    return { error: "Too many attempts from this network. Wait a few seconds and try again." };
  }
  if (!(await findResetLink(token))) return { expired: true };

  const fieldErrors: ResetState["fieldErrors"] = {};
  const strength = await checkPasswordStrength(password);
  if (!strength.ok) fieldErrors.password = strength.message;
  if (password !== confirm) fieldErrors.confirm = "The passwords don't match.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const user = await resetPassword(token, await hashPassword(password));
  if (!user) return { expired: true };

  await limiters.loginByAccount.reset(user.email);
  // The link proves they have the email, not the authenticator app: with
  // two-factor on, the code is still asked for.
  const twoFactor = await hasTwoFactor(user.id);
  await setSessionCookie(await createSession(user.id, { twoFactorPending: twoFactor }));
  const origin = await emailLinkOrigin();
  sendEmailLater({
    to: user.email,
    ...passwordChangedEmail({
      name: user.name,
      email: user.email,
      resetLink: origin ? `${origin}/forgot-password` : null,
    }),
  });
  redirect(twoFactor ? twoFactorPath("/") : await landingFor(user.id));
}
