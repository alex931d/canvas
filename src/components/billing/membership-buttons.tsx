"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { manageBilling, startMembership, type BillingActionState } from "@/app/membership/actions";
import { Button, type ButtonVariant } from "@/components/kit";
import { useSignOut, type MenuUser } from "@/components/user-menu";
import { cn } from "@/lib/utils";

function ActionError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg border-l-4 border-red bg-beige-100 px-4 py-3 text-sm">
      {message}
    </p>
  );
}

/** Goes to Stripe Checkout. */
export function StartMembershipButton({
  label,
  className,
  variant = "primary",
}: {
  label: string;
  className?: string;
  /** `light` on the dark pricing card. */
  variant?: ButtonVariant;
}) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(startMembership, {});
  return (
    <form action={action} className={className}>
      <ActionError message={state.error} />
      <Button type="submit" variant={variant} size="xl" full loading={pending}>
        {label}
      </Button>
    </form>
  );
}

/** Goes to Stripe's billing portal. */
export function ManageBillingButton({ className }: { className?: string }) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(manageBilling, {});
  return (
    <form action={action} className={className}>
      <ActionError message={state.error} />
      <Button type="submit" variant="secondary" size="xl" full loading={pending}>
        Manage billing
      </Button>
    </form>
  );
}

export function SignOutButton({ user, className }: { user: MenuUser; className?: string }) {
  const { pending, run } = useSignOut(user);
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={cn("font-bold text-grey-900 underline underline-offset-4 disabled:opacity-60", className)}
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

/**
 * After paying, Stripe's confirmation can take a moment to reach us. This
 * reloads the page's data a few times while it does.
 */
export function RefreshWhileConfirming() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 10) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, 2000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return null;
}
