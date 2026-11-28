import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton, StartMembershipButton } from "@/components/billing/membership-buttons";
import {
  DOT_GRID,
  INNER,
  OUTER,
  SiteFooter,
  SiteHeader,
  linkFocus,
} from "@/components/landing/site-chrome";
import { HeaderAccount } from "@/components/landing/header-account";
import { LocalDate } from "@/components/local-time";
import { SeasonalBoardDecor, SeasonalEffects } from "@/components/seasonal/site-decor";
import { Button, Skeleton } from "@/components/kit";
import { getCurrentSession, type SessionUser } from "@/lib/auth/session";
import { getMembership, type Membership } from "@/lib/billing/membership";
import { CENTS_A_DAY, FREE_INCLUDES, MEMBERSHIP, MEMBERSHIP_INCLUDES } from "@/lib/billing/plan";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";

/**
 * The two plans, for everyone: free (no account, drawings in the browser)
 * and the membership. Visitors arrive from the landing page, and anyone
 * reaching for a member feature is sent here. The plans are static; what
 * the membership card offers depends on who's looking, so that part renders
 * per request.
 */

export const metadata: Metadata = {
  title: "Pricing",
  description: `Draw for free in your browser, no account needed. The membership, ${MEMBERSHIP.price} ${MEMBERSHIP.per}, keeps your drawings in your account and adds math checks, geometry and proof tools, worksheets, chemistry tools, flashcards and drawing together.`,
};

type Viewer =
  | { kind: "signed-out" }
  | { kind: "unconfirmed"; user: SessionUser }
  | { kind: "new" | "ended" | "member"; user: SessionUser; membership: Membership };

async function getViewer(): Promise<Viewer> {
  const { user } = await getCurrentSession();
  if (!user) return { kind: "signed-out" };
  if (!user.emailVerified) return { kind: "unconfirmed", user };
  const membership = await getMembership(user.id);
  if (membership.isMember) return { kind: "member", user, membership };
  return { kind: membership.subscription ? "ended" : "new", user, membership };
}

const quietLink = cn(linkFocus, "font-bold text-white underline underline-offset-4 hover:text-grey-300");

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-lg border-l-4 border-cyan bg-white/10 px-4 py-3 text-sm leading-relaxed">
      {children}
    </p>
  );
}

function SignedInAs({ user }: { user: SessionUser }) {
  return (
    <p className="text-center text-sm text-grey-300">
      Signed in as <span className="font-bold text-white">{user.email}</span>.{" "}
      <SignOutButton user={user} className="text-white" />
    </p>
  );
}

/** What the plan card offers: the next step for whoever is looking. */
async function PlanActions({ searchParams }: { searchParams: PageProps<"/pricing">["searchParams"] }) {
  const viewer = await getViewer();
  const { checkout } = await searchParams;
  const canceled = checkout === "canceled" && viewer.kind !== "member";

  switch (viewer.kind) {
    case "signed-out":
      return (
        <div className="grid gap-4">
          <Button asChild variant="light" size="xl" full>
            <Link href="/signup">Create account</Link>
          </Button>
          <p className="text-center text-sm text-grey-300">
            Already have one?{" "}
            <Link href="/login?next=%2Fpricing" className={quietLink}>
              Log in
            </Link>{" "}
            to start your membership. Drawings already in this browser come with you.
          </p>
        </div>
      );
    case "unconfirmed":
      return (
        <div className="grid gap-4">
          <Notice>
            Confirm your email first: we sent a code to <strong>{viewer.user.email}</strong>.
          </Notice>
          <Button asChild variant="light" size="xl" full>
            <Link href="/verify-email?next=%2Fpricing">Enter the code</Link>
          </Button>
          <SignedInAs user={viewer.user} />
        </div>
      );
    case "new":
    case "ended": {
      const ended = viewer.kind === "ended" ? viewer.membership.subscription : null;
      return (
        <div className="grid gap-4">
          {canceled ? <Notice>Checkout was canceled, so you haven&apos;t been charged.</Notice> : null}
          {ended && !canceled ? (
            <Notice>
              {ended.endedAt ? (
                <>
                  Your membership ended on <LocalDate iso={ended.endedAt.toISOString()} />.
                </>
              ) : (
                "Your membership isn't active right now."
              )}{" "}
              Renew within 30 days of it ending to keep what&apos;s in your account.
            </Notice>
          ) : null}
          <StartMembershipButton label={ended ? "Renew membership" : "Start membership"} variant="light" />
          <p className="text-center text-xs leading-relaxed text-grey-300">
            You&apos;ll pay on Stripe&apos;s secure checkout page. Billed monthly in US dollars until you cancel. By
            starting a membership you agree to the{" "}
            <Link href="/terms#membership" className={quietLink}>
              terms of service
            </Link>
            .
          </p>
          <SignedInAs user={viewer.user} />
        </div>
      );
    }
    case "member":
      return (
        <div className="grid gap-4">
          <Notice>
            {viewer.membership.complimentary ? "Your membership is on the house." : "You're a member."} Everything above
            is yours.
          </Notice>
          <Button asChild variant="light" size="xl" full>
            <Link href="/">Open your drawings</Link>
          </Button>
          <Link href="/membership" className={cn(quietLink, "justify-self-center text-sm")}>
            Manage membership
          </Link>
        </div>
      );
  }
}

function ActionsSkeleton() {
  return (
    <div className="grid gap-4" aria-label="Loading">
      <Skeleton className="h-[53px] w-full bg-white/15" />
      <Skeleton className="mx-auto h-5 w-2/3 bg-white/10" />
    </div>
  );
}


const STEPS = [
  { title: "Create an account", text: "Your name, email and a password." },
  { title: "Confirm your email", text: "Enter the 8-digit code we send you." },
  {
    title: "Start your membership",
    text: `Pay ${MEMBERSHIP.price} on Stripe's checkout page. Drawings already in this browser move into your account.`,
  },
] as const;

/** The three steps, with the ones already done ticked off. */
async function Steps() {
  const viewer = await getViewer();
  const done = { "signed-out": 0, unconfirmed: 1, new: 2, ended: 2, member: 3 }[viewer.kind];
  return <StepList done={done} />;
}

function StepList({ done }: { done: number }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {STEPS.map((step, i) => {
        const state = i < done ? "done" : i === done ? "next" : "later";
        return (
          <li
            key={step.title}
            aria-current={state === "next" ? "step" : undefined}
            className={cn(
              "flex gap-4 rounded-xl bg-white p-5 sm:p-6",
              state === "next" && "ring-2 ring-grey-900",
              state === "later" && "bg-white/60",
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
                state === "done" ? "bg-green text-white" : state === "next" ? "bg-grey-900 text-white" : "bg-beige-100",
              )}
            >
              {state === "done" ? <Check className="size-4" aria-label="Done" /> : i + 1}
            </span>
            <span>
              <span className="block font-bold">{step.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-grey-500">{step.text}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const QUESTIONS = [
  {
    q: "What's free?",
    a: "Every drawing tool, with no account: pens and shapes, text, images, GIFs and videos, equations and graphs, to-do boards, tracing pictures, and frames you can present as slides.",
  },
  {
    q: "Where are free drawings kept?",
    a: "In the browser you made them in, on that device. They never reach our server, so they won't be on your other devices, and clearing the browser's data deletes them. Download a backup from the Export menu to keep a copy.",
  },
  {
    q: "What does the membership add?",
    a: "Your drawings kept in your account, on every device you sign in on; step-by-step math checks; the geometry, trig and proof tools; worksheets with answer keys (math checks, proof checks and AI worksheets share 250 AI uses a month); the chemistry tools; flashcards; drawing live with others; and team workspaces.",
  },
  {
    q: "What happens to my drawings when I join?",
    a: "The drawings in your browser move into your account, pictures and all, as soon as your membership starts. Nothing to export or upload yourself.",
  },
  {
    q: "How do I pay?",
    a: `By card on Stripe's checkout page. It's ${MEMBERSHIP.price} each month, in US dollars, and you can enter a promotion code there if you have one.`,
  },
  {
    q: "Can I cancel?",
    a: "Yes, any time, from Manage billing on your membership page. You keep the membership until the end of the month you've paid for. After that, what's in your account is kept for 30 days and then deleted unless you renew; we email you when it ends and a week before. Move your drawings into your browser from the home page to keep them on the free plan.",
  },
  {
    q: "What if a payment doesn't go through?",
    a: "Stripe tries the payment again, and you keep the membership while it does. Update your card in billing to keep going.",
  },
  {
    q: "Can classmates open my drawings?",
    a: "Drawing together is part of the membership: share a drawing with a link and anyone with a membership can join it, live.",
  },
] as const;

export default function PricingPage({ searchParams }: PageProps<"/pricing">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        current="pricing"
        account={
          <Suspense fallback={<span className="h-11 w-24" />}>
            <HeaderAccount />
          </Suspense>
        }
      />

      <main className="flex-1">
        <section aria-labelledby="pricing-title" className={OUTER}>
          <div
            className="relative mx-auto max-w-[1392px] overflow-hidden rounded-xl bg-white px-5 py-10 sm:px-12 sm:py-14 xl:px-16 xl:py-20"
            style={DOT_GRID}
          >
            <SeasonalBoardDecor />
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end xl:gap-16">
              <div>
                <h1
                  id="pricing-title"
                  className="text-[42px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-[60px]"
                >
                  Draw for free. Join for the rest.
                </h1>
                <p className="mt-6 max-w-[36rem] text-lg leading-relaxed text-grey-500">
                  Every drawing tool is free and needs no account: your drawings save in your browser. The membership
                  keeps them in your account and adds math checks, chemistry, flashcards and drawing together.
                </p>
              </div>

              {/* The price, worked out by hand the way it would be on the canvas */}
              <figure className="relative mx-6 mb-4 w-fit font-hand text-[34px] leading-[1.3] sm:text-[40px] lg:mr-8">
                <svg
                  aria-hidden
                  viewBox="0 0 360 170"
                  preserveAspectRatio="none"
                  className="absolute -inset-x-6 -inset-y-4 h-[calc(100%+32px)] w-[calc(100%+48px)]"
                  fill="none"
                >
                  <path
                    d="M22 34 C 70 4, 290 0, 338 28 C 362 64, 356 128, 318 152 C 240 176, 82 172, 30 150 C 2 120, 0 64, 22 34 Z"
                    stroke="#277c78"
                    strokeWidth="2.5"
                    strokeDasharray="9 8"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="relative text-grey-900">{MEMBERSHIP.price} ÷ 30 days</p>
                <p className="relative text-grey-900">
                  ≈ {CENTS_A_DAY}¢ a day <span className="text-green">✓</span>
                </p>
                <figcaption className="sr-only">
                  {MEMBERSHIP.price} {MEMBERSHIP.per} works out at about {CENTS_A_DAY} cents a day.
                </figcaption>
              </figure>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-2 lg:gap-6">
              {/* Free: the canvas itself, in this browser */}
              <div
                className="flex flex-col rounded-xl bg-white p-6 ring-1 ring-grey-900/10 sm:p-8"
                data-testid="plan-free"
              >
                <h2 className="text-lg font-bold">Free</h2>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-[64px] leading-none font-extrabold tracking-[-0.03em]">$0</span>
                  <span className="text-lg text-grey-500">no account needed</span>
                </p>
                <ul className="mt-6 space-y-3">
                  {FREE_INCLUDES.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <Check className="mt-0.5 size-5 shrink-0 text-green" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto border-t border-grey-900/10 pt-6 max-lg:mt-8">
                  <Button asChild variant="secondary" size="xl" full>
                    <Link href="/local/new">Start drawing</Link>
                  </Button>
                  <p className="mt-4 text-center text-sm leading-relaxed text-grey-500">
                    Drawings stay on this device, in this browser.{" "}
                    <Link href="/local" className={cn(linkFocus, "font-bold text-grey-900 underline underline-offset-4")}>
                      Your drawings here
                    </Link>
                  </p>
                </div>
              </div>

              {/* The membership: what it adds, and the next step for whoever is looking */}
              <div className="rounded-xl bg-grey-900 p-6 text-white sm:p-8" data-testid="plan-member">
                <h2 className="text-lg font-bold">canvas membership</h2>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-[64px] leading-none font-extrabold tracking-[-0.03em]">{MEMBERSHIP.price}</span>
                  <span className="text-lg text-grey-300">{MEMBERSHIP.per}</span>
                </p>
                <p className="mt-6 text-sm font-bold text-grey-300">Everything free, and</p>
                <ul className="mt-3 space-y-3">
                  {MEMBERSHIP_INCLUDES.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <Check className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 border-t border-white/10 pt-6">
                  <Suspense fallback={<ActionsSkeleton />}>
                    <PlanActions searchParams={searchParams} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="steps-title" className={cn(OUTER, "py-20 sm:py-24")}>
          <div className={INNER}>
            <h2 id="steps-title" className="mb-8 text-[30px] leading-tight font-bold tracking-[-0.02em] sm:text-[34px]">
              Getting the membership
            </h2>
            <Suspense fallback={<StepList done={0} />}>
              <Steps />
            </Suspense>
          </div>
        </section>

        <section aria-labelledby="questions-title" className={cn(OUTER, "pb-20 sm:pb-28")}>
          <div className={cn(INNER, "grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]")}>
            <h2 id="questions-title" className="text-[30px] leading-tight font-bold tracking-[-0.02em] sm:text-[34px]">
              Questions
            </h2>
            <dl className="grid gap-8 sm:grid-cols-2">
              {QUESTIONS.map(({ q, a }, i) => (
                <Reveal key={q} delay={(i % 2) * 0.06}>
                  <dt className="font-bold">{q}</dt>
                  <dd className="mt-2 leading-relaxed text-grey-500">{a}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <SiteFooter />
      <SeasonalEffects />
    </div>
  );
}
