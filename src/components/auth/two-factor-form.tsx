"use client";

import { useActionState, useState } from "react";
import { cancelTwoFactorLogin, verifyTwoFactorLogin, type TwoFactorState } from "@/app/(auth)/actions";
import { Input } from "@/components/kit";
import { Field, FormError, SubmitButton, linkClass } from "./form-parts";

const lead = "text-sm leading-relaxed text-grey-500";

/** The second step of logging in, for accounts with two-factor sign-in on. */
export function TwoFactorForm({ email, next, contact }: { email: string; next: string; contact: string | null }) {
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(verifyTwoFactorLogin, {});
  const [recovery, setRecovery] = useState(false);

  return (
    <div className="grid gap-6">
      <p className={lead}>
        {recovery ? (
          <>
            Enter one of the recovery codes you saved when you turned on two-factor sign-in for{" "}
            <strong className="font-bold text-grey-900">{email}</strong>. Each one works once.
          </>
        ) : (
          <>
            Open your authenticator app and enter the 6-digit code it shows for canvas (
            <strong className="font-bold text-grey-900">{email}</strong>).
          </>
        )}
      </p>

      <form action={action} className="grid gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormError message={state.error} />
        <Field id="code" label={recovery ? "Recovery code" : "Code"}>
          <Input
            // A new field when switching, so the browser's suggestions and keyboard match.
            key={recovery ? "recovery" : "app"}
            id="code"
            name="code"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete={recovery ? "off" : "one-time-code"}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={recovery ? 16 : 8}
            placeholder={recovery ? "abcde-fghij" : undefined}
            required
            autoFocus
            aria-invalid={!!state.error || undefined}
            className="h-14 indent-[0.2em] text-center text-2xl font-bold tracking-[0.2em] tabular-nums placeholder:font-normal placeholder:tracking-normal placeholder:text-grey-300"
          />
        </Field>
        <SubmitButton pending={pending}>Continue</SubmitButton>
      </form>

      <div className="grid gap-3 text-sm text-grey-500">
        <p>
          {recovery ? "Have your phone? " : "No access to your app? "}
          <button type="button" onClick={() => setRecovery((r) => !r)} className={linkClass}>
            {recovery ? "Use a code from the app" : "Use a recovery code"}
          </button>
        </p>
        {recovery ? (
          <p>
            Lost your recovery codes too?{" "}
            {contact ? (
              <>
                Write to{" "}
                <a href={`mailto:${contact}`} className={linkClass}>
                  {contact}
                </a>{" "}
                from {email}, and we&apos;ll help you get back in.
              </>
            ) : (
              "Contact the canvas team from this email address, and they'll help you get back in."
            )}
          </p>
        ) : null}
      </div>

      <form action={cancelTwoFactorLogin} className="border-t border-grey-100 pt-5 text-sm text-grey-500">
        Not you?{" "}
        <button type="submit" className={linkClass}>
          Log in with another account
        </button>
      </form>
    </div>
  );
}
