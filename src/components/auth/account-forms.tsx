"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  requestPasswordReset,
  resendCode,
  setNewPassword,
  verifyEmail,
  type ForgotState,
  type ResendState,
  type ResetState,
  type VerifyState,
} from "@/app/(account)/actions";
import { signOut } from "@/app/(auth)/actions";
import { Button, Input } from "@/components/kit";
import type { CaptchaSite } from "@/lib/auth/captcha-shared";
import { cn } from "@/lib/utils";
import { useCaptcha } from "./captcha";
import { Field, FormError, FormNotice, PasswordInput, SubmitButton, linkClass } from "./form-parts";

const heading = "text-[32px] leading-tight font-bold";
const lead = "text-sm leading-relaxed text-grey-500";

/** Counts down from `seconds`, starting over whenever `restartKey` changes. */
function useCountdown(seconds: number, restartKey: unknown) {
  const [left, setLeft] = useState(seconds);
  const [key, setKey] = useState(restartKey);
  if (key !== restartKey) {
    setKey(restartKey);
    setLeft(seconds);
  }
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return left;
}

// ------------------------------------------------------------ confirm email

export function VerifyEmailForm({
  email,
  next,
  initialCode,
  resendWait,
}: {
  email: string;
  next: string;
  initialCode: string;
  resendWait: number;
}) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyEmail, {});
  const [resent, resend, resending] = useActionState<ResendState, FormData>(resendCode, {});
  const wait = useCountdown(resent.wait ?? resendWait, resent);

  return (
    <div className="grid gap-6">
      <p className={lead}>
        We sent an 8-digit code to <strong className="font-bold text-grey-900">{email}</strong>. Enter it below to
        finish setting up your account.
      </p>

      <form action={action} className="grid gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormError message={state.error} />
        <Field id="code" label="Code">
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={16}
            required
            defaultValue={state.code ?? initialCode}
            aria-invalid={!!state.error || undefined}
            // indent = tracking, so the trailing letter-space doesn't pull the digits off centre
            className="h-14 indent-[0.3em] text-center text-2xl font-bold tracking-[0.3em] tabular-nums"
          />
        </Field>
        <SubmitButton pending={pending}>Confirm email</SubmitButton>
      </form>

      <form action={resend} className="grid gap-3 text-sm text-grey-500">
        <p>
          Didn&apos;t get it? It can take a minute, and it might be in your spam folder.{" "}
          <button
            type="submit"
            disabled={wait > 0 || resending}
            className={cn(linkClass, "disabled:font-normal disabled:text-grey-500 disabled:no-underline")}
          >
            {wait > 0 ? `Send a new code in ${wait} s` : resending ? "Sending…" : "Send a new code"}
          </button>
        </p>
        <FormNotice message={resent.notice} />
        <FormError message={resent.error} />
      </form>

      <div className="border-t border-grey-100 pt-5 text-sm text-grey-500">
        Signed up with the wrong email?{" "}
        <form action={signOut} className="inline">
          <button type="submit" className={linkClass}>
            Sign out
          </button>
        </form>{" "}
        and sign up again.
      </div>
    </div>
  );
}

// ------------------------------------------------------------ forgot password

export function ForgotPasswordForm({ captcha }: { captcha: CaptchaSite | "loading" }) {
  // "Try again" starts a fresh form (and a fresh CAPTCHA).
  const [round, setRound] = useState(0);
  return <ForgotPasswordRound key={round} captcha={captcha} onTryAgain={() => setRound((r) => r + 1)} />;
}

function ForgotPasswordRound({ captcha, onTryAgain }: { captcha: CaptchaSite | "loading"; onTryAgain: () => void }) {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  const human = useCaptcha(captcha, "reset");

  if (state.sent) {
    return (
      <div className="grid gap-6">
        <h1 className={heading}>Check your email</h1>
        <p className={lead}>
          If an account uses <strong className="font-bold text-grey-900">{state.email}</strong>, we&apos;ve sent it a
          link to choose a new password. The link works for 1 hour.
        </p>
        <p className="text-sm text-grey-500">
          Didn&apos;t get it? It might be in your spam folder, or you may have signed up with another address.{" "}
          <button type="button" onClick={onTryAgain} className={linkClass}>
            Try again
          </button>
        </p>
        <Button asChild size="xl" full>
          <Link href="/login">Back to login</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <h1 className={heading}>Reset your password</h1>
        <p className={lead}>Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
      </div>
      <form action={action} {...human.formProps} className="grid gap-4" noValidate>
        <FormError message={state.error} />
        <Field id="email" label="Email" error={state.emailError}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.email}
            aria-invalid={!!state.emailError || undefined}
          />
        </Field>
        {human.field}
        <SubmitButton pending={pending || human.waiting}>
          {human.waiting ? "Checking you're human…" : "Send reset link"}
        </SubmitButton>
        <p className="mt-2 text-center text-sm text-grey-500">
          Remembered it?{" "}
          <Link href="/login" className={linkClass}>
            Login
          </Link>
        </p>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ new password

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  if (state.expired) return <ExpiredResetLink />;
  const fe = state.fieldErrors ?? {};
  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <h1 className={heading}>Choose a new password</h1>
        <p className={lead}>
          For <strong className="font-bold text-grey-900">{email}</strong>. Saving it signs the account out on every
          device and signs you in here.
        </p>
      </div>
      <form action={action} className="grid gap-4" noValidate>
        <input type="hidden" name="token" value={token} />
        {/* So password managers save the new password to the right account. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <FormError message={state.error} />
        <Field id="password" label="New password" error={fe.password} hint="At least 8 characters">
          <PasswordInput id="password" autoComplete="new-password" invalid={!!fe.password} describedBy="password-hint" />
        </Field>
        <Field id="confirm" label="Confirm new password" error={fe.confirm}>
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" invalid={!!fe.confirm} />
        </Field>
        <SubmitButton pending={pending}>Save new password</SubmitButton>
      </form>
    </div>
  );
}

export function ExpiredResetLink() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <h1 className={heading}>This link doesn&apos;t work anymore</h1>
        <p className={lead}>
          Reset links work once and expire after an hour. Ask for a new one and open the newest email.
        </p>
      </div>
      <Button asChild size="xl" full>
        <Link href="/forgot-password">Send a new link</Link>
      </Button>
      <p className="text-center text-sm text-grey-500">
        Remembered your password?{" "}
        <Link href="/login" className={linkClass}>
          Login
        </Link>
      </p>
    </div>
  );
}
