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
import { MoveBrowserProfile } from "@/components/settings/move-browser-profile";
import { LocalDate } from "@/components/local-time";
import { Badge, Button, Skeleton } from "@/components/kit";
import type { SessionUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import type { AiAllowance } from "@/lib/billing/ai-allowance";
import { getAiAllowance } from "@/lib/billing/ai-quota";
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
  const ai = membership.isMember ? await getAiAllowance(user.id) : null;

  return (
    <>
      {membership.isMember ? <MemberView membership={membership} welcome={checkout === "success"} ai={ai} /> : <Confirming />}
      {/* A picture or effect choices kept in this browser before joining go into the account. */}
      {membership.isMember ? <MoveBrowserProfile userId={user.id} /> : null}
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

function MemberView({ membership, welcome, ai }: { membership: Membership; welcome: boolean; ai: AiAllowance | null }) {
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
            renew any time before then in billing. After it ends, what&apos;s in your account is kept for 30 days.
          </>
        ) : sub.currentPeriodEnd ? (
          <>
            {MEMBERSHIP.price} {MEMBERSHIP.per}, renewing on <LocalDate iso={sub.currentPeriodEnd.toISOString()} />.
          </>
        ) : (
          `${MEMBERSHIP.price} ${MEMBERSHIP.per}.`
        )}
      </p>

      {ai ? <AiAllowanceMeter ai={ai} /> : null}

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

/** How much of this month's AI allowance (math checks, proof checks, worksheets) is used. */
function AiAllowanceMeter({ ai }: { ai: AiAllowance }) {
  const share = ai.limit ? Math.min(1, ai.used / ai.limit) : 1;
  const low = ai.left <= Math.max(10, ai.limit * 0.1);
  return (
    <div className="mt-6 rounded-lg bg-beige-100 p-4" data-testid="ai-allowance">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-bold">AI checks and worksheets</span>
        <span className="text-grey-700 tabular-nums">
          {ai.used} of {ai.limit} used this month
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-beige-300"
        role="meter"
        aria-label="AI checks and worksheets used this month"
        aria-valuemin={0}
        aria-valuemax={ai.limit}
        aria-valuenow={ai.used}
      >
        <div className={low ? "h-full bg-orange" : "h-full bg-green"} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-grey-500">
        {ai.left === 0 ? "All used. " : null}
        Starts over on <LocalDate iso={ai.resetsAt} />. Math checks, proof checks and AI worksheets each count once.
      </p>
    </div>
  );
}
