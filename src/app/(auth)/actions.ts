"use server";

import { redirect } from "next/navigation";
import {
  EmailTakenError,
  clientIp,
  createUser,
  findUserByEmail,
  isValidEmail,
  normalizeEmail,
} from "@/lib/auth/account";
import { verifyCaptcha } from "@/lib/auth/captcha";
import { ensureVerificationCode, sendVerificationCode } from "@/lib/auth/email-verification";
import { googleEnabled } from "@/lib/auth/google";
import { safeNext, twoFactorPath, verifyEmailPath } from "@/lib/auth/next-path";
import { checkPasswordStrength, dummyPasswordHash, verifyPassword } from "@/lib/auth/password";
import { limiters } from "@/lib/auth/rate-limit";
import {
  completeTwoFactor,
  createSession,
  deleteSessionCookie,
  getCurrentSession,
  getPendingTwoFactor,
  invalidateSession,
  setSessionCookie,
} from "@/lib/auth/session";
import { checkCode, hasTwoFactor } from "@/lib/auth/two-factor";
import { sendEmailLater } from "@/lib/email/send";
import { recoveryCodeUsedEmail } from "@/lib/email/templates";
import { emailLinkOrigin } from "@/lib/site-url";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
  values?: { name?: string; email?: string };
};

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = str(formData.get("name")).trim();
  const email = normalizeEmail(str(formData.get("email")));
  const password = str(formData.get("password"));
  const values = { name, email };

  const ip = await clientIp();
  if (!(await limiters.signupByIp.consume(ip)).ok) {
    return { error: "Too many sign-ups from this network. Wait a few seconds and try again.", values };
  }
  const human = await verifyCaptcha(formData, "signup");
  if (!human.ok) return { error: human.error, values };

  const fieldErrors: AuthFormState["fieldErrors"] = {};
  if (!name) fieldErrors.name = "Enter your name.";
  else if (name.length > 80) fieldErrors.name = "Keep it under 80 characters.";
  if (!isValidEmail(email)) fieldErrors.email = "Enter a valid email address.";
  const strength = await checkPasswordStrength(password);
  if (!strength.ok) fieldErrors.password = strength.message;
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  let user: { id: string; name: string; email: string };
  try {
    user = await createUser(name, email, password);
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return { fieldErrors: { email: "An account with this email already exists. Log in instead." }, values };
    }
    throw err;
  }

  await setSessionCookie(await createSession(user.id));
  // The code goes out after the response; /verify-email is all they can open until it's entered.
  await sendVerificationCode(user, "after-response");
  redirect("/verify-email");
}

export async function logIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(str(formData.get("email")));
  const password = str(formData.get("password"));
  const values = { email };

  const ip = await clientIp();
  if (!(await limiters.loginByIp.consume(ip)).ok) {
    return { error: "Too many attempts from this network. Wait a moment and try again.", values };
  }
  const human = await verifyCaptcha(formData, "login");
  if (!human.ok) return { error: human.error, values };
  if (!isValidEmail(email) || !password) {
    return { error: "Enter your email and password.", values };
  }
  // Growing delay per account; keyed by email so unknown emails behave the same.
  if (!(await limiters.loginByAccount.consume(email))) {
    return { error: "Too many attempts for this account. Wait a few seconds and try again.", values };
  }

  const user = await findUserByEmail(email);
  // Same timing whether or not there's an account, or a password on it.
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await dummyPasswordHash(), password), false);
  if (!user || !ok) {
    if (user && !user.passwordHash && googleEnabled()) {
      return { error: "This account signs in with Google. Use Continue with Google, or set a password with Forgot password.", values };
    }
    return { error: "That email and password don't match an account.", values };
  }

  await limiters.loginByAccount.reset(email);
  const next = safeNext(formData.get("next"));
  if (await hasTwoFactor(user.id)) {
    await setSessionCookie(await createSession(user.id, { twoFactorPending: true }));
    redirect(twoFactorPath(next));
  }
  await setSessionCookie(await createSession(user.id));
  if (!user.emailVerified) {
    await ensureVerificationCode(user);
    redirect(verifyEmailPath(next));
  }
  redirect(next);
}

// ------------------------------------------------------- two-factor code

export type TwoFactorState = { error?: string };

/** The second step of logging in: a code from the authenticator app, or a recovery code. */
export async function verifyTwoFactorLogin(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const pending = await getPendingTwoFactor();
  if (!pending) redirect("/login");
  const { session, user } = pending;
  const next = safeNext(formData.get("next"));

  if (!(await limiters.twoFactorByUser.consume(user.id)).ok) {
    return { error: "Too many tries. Wait a minute and try again." };
  }
  const result = await checkCode(user.id, str(formData.get("code")).slice(0, 40));
  if (!result.ok) {
    switch (result.reason) {
      case "format":
        return { error: "Enter the 6-digit code from your authenticator app, or a recovery code." };
      case "no-key":
        return { error: "Codes from your app can't be checked on this server right now. Use a recovery code instead." };
      case "wrong":
        return { error: "That code isn't right. Check your app and try again (each code works once)." };
    }
  }

  await completeTwoFactor(session.id, user.id);
  if (result.method === "recovery") {
    const origin = await emailLinkOrigin();
    sendEmailLater({
      to: user.email,
      ...recoveryCodeUsedEmail({
        name: user.name,
        email: user.email,
        left: result.recoveryCodesLeft,
        resetLink: origin ? `${origin}/forgot-password` : null,
      }),
    });
  }
  if (!user.emailVerified) redirect(verifyEmailPath(next));
  redirect(next);
}

/** "Not you?" on the code page: forget the half-finished login. */
export async function cancelTwoFactorLogin() {
  const pending = await getPendingTwoFactor();
  if (pending) await invalidateSession(pending.session.id);
  await deleteSessionCookie();
  redirect("/login");
}

export async function signOut() {
  const { session } = await getCurrentSession();
  if (session) await invalidateSession(session.id);
  await deleteSessionCookie();
  redirect("/login");
}
