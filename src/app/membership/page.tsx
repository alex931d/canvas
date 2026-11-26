import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SplitLayout } from "@/components/auth/split-layout";
import {
  ManageBillingButton,
  RefreshWhileConfirming,
  SignOutButton,
} from "@/components/billing/membership-buttons";
import { WelcomeMove } from "@/components/gallery/browser-gallery";
import { LocalDate } from "@/components/local-time";
import { Badge, Button, Skeleton } from "@/components/kit";
import type { SessionUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { readMembership, type Membership } from "@/lib/billing/membership";
import { MEMBERSHIP } from "@/lib/billing/plan";
import { stripe } from "@/lib/billing/stripe";
import { syncStripeCustomer } from "@/lib/billing/sync";

export const metadata: Metadata = { title: "Membership" };

/**
 * Members manage their membership here, and Stripe Checkout returns here to
 * confirm a new one. Anyone without a membership is sent to /pricing to
 * start or renew it.
 */
export default function MembershipPage({ searchParams }: PageProps<"/membership">) {
  return (
    <SplitLayout>
      <section className="@container w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
        <Suspense fallback={<CardSkeleton />}>
          <MembershipCard searchParams={searchParams} />
        </Suspense>
      </section>
    </SplitLayout>
  );
}

/** About as tall as the card it stands in for (narrow cards wrap more), so the centred card doesn't jump. */
function CardSkeleton() {
  return (
    <div className="flex h-[288px] flex-col gap-4 @[480px]:h-[236px]" aria-label="Loading">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="mt-auto h-[53px] w-full" />
      <Skeleton className="mx-auto h-4 w-3/4" />
    </div>
  );
}

/**
 * Back from Checkout: copy the new subscription from Stripe right away instead
 * of waiting for the webhook, so the member can start straight away.
 */
async function confirmCheckout(user: SessionUser, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== user.id || !session.customer) return;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
    await syncStripeCustomer(customerId, user.id);
  } catch (err) {
    // The webhook will bring it in; the page refreshes while it waits.
    console.error("[billing] couldn't confirm checkout:", err);
  }
}

async function MembershipCard({ searchParams }: { searchParams: PageProps<"/membership">["searchParams"] }) {
  const user = await requireUser();
  const { checkout, session_id } = await searchParams;
  if (checkout === "success" && typeof session_id === "string") await confirmCheckout(user, session_id);
  const membership = await readMembership(user.id);
  if (!membership.isMember && checkout !== "success") redirect("/pricing");

  return (
    <>
      {membership.isMember ? <MemberView membership={membership} welcome={checkout === "success"} /> : <Confirming />}
      <p className="mt-8 border-t pt-5 text-center text-sm text-grey-500">
        Signed in as <span className="font-bold text-grey-900">{user.email}</span>. <SignOutButton user={user} />
      </p>
    </>
  );
}

function Confirming() {
  return (
    <>
      <RefreshWhileConfirming />
      <h1 className="text-[32px] leading-tight font-bold">Confirming your payment</h1>
      <p className="mt-3 leading-relaxed text-grey-500">
        Stripe is confirming your membership. This usually takes a few seconds.
      </p>
      <Button asChild variant="secondary" size="xl" full className="mt-8">
        <Link href="/membership">Check again</Link>
      </Button>
    </>
  );
}

function MemberView({ membership, welcome }: { membership: Membership; welcome: boolean }) {
  const sub = membership.subscription!;
  const ending = sub.cancelAt !== null;
  const pastDue = sub.status === "past_due";

  const badge = membership.complimentary
    ? { label: "Complimentary", tone: "green" as const }
    : pastDue
      ? { label: "Payment due", tone: "red" as const }
      : ending
        ? { label: "Ending", tone: "orange" as const }
        : { label: "Active", tone: "green" as const };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[32px] leading-tight font-bold">{welcome ? "You're a member" : "Your membership"}</h1>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <p className="mt-3 leading-relaxed text-grey-500">
        {welcome ? "Thanks for joining. " : null}
        {membership.complimentary ? (
          "Your membership is on the house."
        ) : pastDue ? (
          "Your last payment didn't go through. Update your card in billing to keep your membership."
        ) : ending && sub.cancelAt ? (
          <>
            It ends on <LocalDate iso={sub.cancelAt.toISOString()} />, and you won&apos;t be charged again. You can
            renew any time before then in billing.
          </>
        ) : sub.currentPeriodEnd ? (
          <>
            {MEMBERSHIP.price} {MEMBERSHIP.per}, renewing on <LocalDate iso={sub.currentPeriodEnd.toISOString()} />.
          </>
        ) : (
          `${MEMBERSHIP.price} ${MEMBERSHIP.per}.`
        )}
      </p>

      {/* Drawings made in this browser on the free plan go into the account now (and on the home page later). */}
      {welcome ? <WelcomeMove className="mt-6 mb-0 bg-beige-100 sm:mb-0" /> : null}

      <div className="mt-8 grid gap-3">
        <Button asChild size="xl" full>
          <Link href="/">{welcome ? "Start drawing" : "Open your drawings"}</Link>
        </Button>
        {membership.complimentary ? null : <ManageBillingButton />}
      </div>
      {membership.complimentary ? null : (
        <p className="mt-3 text-center text-xs text-grey-500">
          Billing is on Stripe: change your card, get invoices or cancel.
        </p>
      )}
    </>
  );
}
