"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button, Input, Label } from "@/components/kit";

/** Pieces shared by the sign-up, login, email and password forms. */

export function Field({
  id,
  label,
  error,
  hint,
  aside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Shown at the end of the label row (e.g. a "Forgot password?" link). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-right text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-right text-xs text-grey-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordInput({
  id,
  name = "password",
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  name?: string;
  autoComplete: string;
  invalid: boolean;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : describedBy}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-grey-900 hover:text-green"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function SubmitButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" size="xl" full loading={pending} disabled={disabled} className="mt-2">
      {children}
    </Button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border-l-4 border-red bg-beige-100 px-4 py-3 text-sm">
      {message}
    </p>
  );
}

/** A confirmation in the same shape as FormError, in green. */
export function FormNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg border-l-4 border-green bg-beige-100 px-4 py-3 text-sm">
      {message}
    </p>
  );
}

export const linkClass = "font-bold text-grey-900 underline underline-offset-4 hover:text-green";
