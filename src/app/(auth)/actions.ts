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
import { safeNext, verifyEmailPath } from "@/lib/auth/next-path";
import { checkPasswordStrength, dummyPasswordHash, verifyPassword } from "@/lib/auth/password";
import { limiters } from "@/lib/auth/rate-limit";
import {
  createSession,
  deleteSessionCookie,
  getCurrentSession,
  invalidateSession,
  setSessionCookie,
} from "@/lib/auth/session";

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
  if (!limiters.signupByIp.consume(ip)) {
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
  if (!limiters.loginByIp.consume(ip)) {
    return { error: "Too many attempts from this network. Wait a moment and try again.", values };
  }
  const human = await verifyCaptcha(formData, "login");
  if (!human.ok) return { error: human.error, values };
  if (!isValidEmail(email) || !password) {
    return { error: "Enter your email and password.", values };
  }
  // Growing delay per account; keyed by email so unknown emails behave the same.
  if (!limiters.loginByAccount.consume(email)) {
    return { error: "Too many attempts for this account. Wait a few seconds and try again.", values };
  }

  const user = await findUserByEmail(email);
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await dummyPasswordHash(), password), false); // same timing either way
  if (!user || !ok) {
    return { error: "That email and password don't match an account.", values };
  }

  limiters.loginByAccount.reset(email);
  await setSessionCookie(await createSession(user.id));
  const next = safeNext(formData.get("next"));
  if (!user.emailVerified) {
    await ensureVerificationCode(user);
    redirect(verifyEmailPath(next));
  }
  redirect(next);
}

export async function signOut() {
  const { session } = await getCurrentSession();
  if (session) await invalidateSession(session.id);
  await deleteSessionCookie();
  redirect("/login");
}
