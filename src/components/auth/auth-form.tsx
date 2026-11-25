"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/app/(auth)/actions";
import { logIn, signUp } from "@/app/(auth)/actions";
import { Input, buttonClasses } from "@/components/kit";
import type { CaptchaSite } from "@/lib/auth/captcha-shared";
import { useCaptcha } from "./captcha";
import { Field, FormError, PasswordInput, SubmitButton, linkClass } from "./form-parts";

const CHECKING = "Checking you're human…";

/** "Continue with Google", and the line between it and the email form. */
function GoogleChoice({ next, note }: { next: string; note: React.ReactNode }) {
  const href = next === "/" ? "/login/google" : `/login/google?next=${encodeURIComponent(next)}`;
  return (
    <div className="grid gap-4">
      <a href={href} className={buttonClasses({ variant: "secondary", size: "xl", full: true })}>
        Continue with Google
      </a>
      <p className="text-center text-xs leading-relaxed text-grey-500">{note}</p>
      <div className="flex items-center gap-4 text-xs text-grey-500" aria-hidden>
        <span className="h-px flex-1 bg-grey-100" />
        or with your email
        <span className="h-px flex-1 bg-grey-100" />
      </div>
    </div>
  );
}

export function LoginForm({
  next,
  captcha,
  google = false,
  error,
}: {
  next: string;
  captcha: CaptchaSite | "loading";
  /** Show "Continue with Google" (it's set up on this server). */
  google?: boolean;
  /** Why the last Google sign-in didn't work. */
  error?: string;
}) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(logIn, {});
  const human = useCaptcha(captcha, "login");
  return (
    <form action={action} {...human.formProps} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error ?? error} />
      {google ? (
        <GoogleChoice
          next={next}
          note={
            <>
              New to canvas? This makes you an account, under the{" "}
              <Link href="/terms" className={linkClass}>
                terms of service
              </Link>
              .
            </>
          }
        />
      ) : null}
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <Field
        id="password"
        label="Password"
        aside={
          <Link
            href="/forgot-password"
            // A taller tap area than the text, without moving anything.
            className="-my-1.5 inline-block py-1.5 text-xs font-bold text-grey-900 underline underline-offset-4 hover:text-green"
          >
            Forgot password?
          </Link>
        }
      >
        <PasswordInput id="password" autoComplete="current-password" invalid={false} />
      </Field>
      {human.field}
      <SubmitButton pending={pending || human.waiting}>{human.waiting ? CHECKING : "Login"}</SubmitButton>
      <p className="mt-2 text-center text-sm text-grey-500">
        Need to create an account?{" "}
        <Link href="/signup" className={linkClass}>
          Sign Up
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ captcha, google = false }: { captcha: CaptchaSite | "loading"; google?: boolean }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});
  const human = useCaptcha(captcha, "signup");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} {...human.formProps} className="grid gap-4" noValidate>
      <FormError message={state.error} />
      {google ? (
        <GoogleChoice
          next="/"
          note={
            <>
              By continuing with Google you agree to the{" "}
              <Link href="/terms" className={linkClass}>
                terms of service
              </Link>
              .
            </>
          }
        />
      ) : null}
      <Field id="name" label="Name" error={fe.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          defaultValue={state.values?.name}
          aria-invalid={!!fe.name || undefined}
        />
      </Field>
      <Field id="email" label="Email" error={fe.email} hint="We'll send a code to confirm it">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={!!fe.email || undefined}
          aria-describedby={fe.email ? "email-error" : "email-hint"}
        />
      </Field>
      <Field id="password" label="Create Password" error={fe.password} hint="Passwords must be at least 8 characters">
        <PasswordInput id="password" autoComplete="new-password" invalid={!!fe.password} describedBy="password-hint" />
      </Field>
      {human.field}
      <p className="text-xs leading-relaxed text-grey-500">
        By creating an account you agree to the{" "}
        <Link href="/terms" className={linkClass}>
          terms of service
        </Link>
        .
      </p>
      <SubmitButton pending={pending || human.waiting}>{human.waiting ? CHECKING : "Create Account"}</SubmitButton>
      <p className="mt-2 text-center text-sm text-grey-500">
        Already have an account?{" "}
        <Link href="/login" className={linkClass}>
          Login
        </Link>
      </p>
    </form>
  );
}
