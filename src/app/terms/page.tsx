import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderAccount } from "@/components/landing/header-account";
import { INNER, linkFocus, OUTER, SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { MEMBERSHIP } from "@/lib/billing/plan";
import { contactEmail } from "@/lib/site/contact";
import { cn } from "@/lib/utils";

/**
 * The terms of service. Public (src/lib/auth/constants.ts), linked from the
 * site footer, the sign-up form and the pricing card. The price comes from
 * the plan, so it can't drift from what Stripe charges; the contact address
 * from CONTACT_EMAIL (else the address emails are sent from).
 *
 * When the terms change, update UPDATED, and email members about important
 * changes 30 days ahead (section 11 promises it).
 */

const UPDATED = { iso: "2026-11-23", text: "November 23, 2026" };

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using canvas: your account, the membership, your drawings and the rules.",
};

const SECTIONS = [
  { id: "who", title: "Who can use canvas" },
  { id: "account", title: "Your account" },
  { id: "membership", title: "Membership and payment" },
  { id: "content", title: "Your drawings and other content" },
  { id: "rules", title: "Using canvas fairly" },
  { id: "ai", title: "Math checks and other AI features" },
  { id: "changes-to-canvas", title: "Keeping canvas running" },
  { id: "ending", title: "Closing your account" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limits on liability" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const link = cn(linkFocus, "font-bold underline underline-offset-4 hover:text-green");

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const n = SECTIONS.findIndex((s) => s.id === id) + 1;
  const { title } = SECTIONS[n - 1];
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8">
      <h2 id={`${id}-title`} className="flex gap-3 text-xl leading-snug font-bold sm:text-[22px]">
        <span className="w-7 shrink-0 text-grey-500 tabular-nums">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 sm:pl-10 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
    </section>
  );
}

const NO_ADDRESS = "Questions about these terms, or want your account closed? Contact us by email.";

async function ContactLine() {
  const contact = await contactEmail();
  if (!contact) return NO_ADDRESS;
  return (
    <>
      Questions about these terms, or want your account closed? Write to us at{" "}
      <a href={`mailto:${contact}`} className={link}>
        {contact}
      </a>
      .
    </>
  );
}

export default function TermsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        account={
          <Suspense fallback={<span className="h-11 w-24" />}>
            <HeaderAccount />
          </Suspense>
        }
      />

      <main className={cn(OUTER, "flex-1")}>
        <div className="mx-auto max-w-[1392px] rounded-xl bg-white py-10 sm:py-14 xl:py-20">
          <div className={cn(INNER, "grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] xl:gap-20")}>
            <header className="lg:col-span-2">
              <h1 className="text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-[56px]">
                Terms of service
              </h1>
              <p className="mt-4 text-grey-500">
                Last updated <time dateTime={UPDATED.iso}>{UPDATED.text}</time>
              </p>
            </header>

            {/* Contents: beside the terms on wide screens, staying in view while reading */}
            <nav aria-labelledby="contents-title" className="lg:sticky lg:top-8 lg:self-start">
              <h2 id="contents-title" className="text-sm font-bold">
                Contents
              </h2>
              <ol className="mt-3 grid gap-1.5 text-sm text-grey-500 sm:grid-cols-2 lg:grid-cols-1">
                {SECTIONS.map((s, i) => (
                  <li key={s.id} className="flex gap-2">
                    <span className="w-5 shrink-0 tabular-nums">{i + 1}.</span>
                    <a href={`#${s.id}`} className={cn(linkFocus, "hover:text-grey-900 hover:underline")}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <article className="max-w-[42rem] space-y-10 text-[17px] leading-[1.7] text-grey-900">
              <p className="text-lg leading-relaxed">
                These terms are the agreement between you and canvas for using the canvas website and app. By
                creating an account or using canvas, you agree to them. If you don&apos;t agree, please don&apos;t use
                canvas.
              </p>

              <Section id="who">
                <p>
                  You need to be at least 13 years old to use canvas. If you&apos;re under 18, or under the age of
                  majority where you live, a parent or guardian has to agree to these terms for you, and is responsible
                  for how you use canvas, including any payments.
                </p>
              </Section>

              <Section id="account">
                <ul>
                  <li>Use your real name and an email address you can receive mail at, and keep them up to date.</li>
                  <li>
                    Keep your password to yourself. You&apos;re responsible for what happens in your account, so tell
                    us straight away if you think someone else has got into it.
                  </li>
                  <li>We may ask you to confirm your email address before you can use canvas.</li>
                  <li>
                    Your account is for you. To work with other people, share a drawing with them instead of sharing
                    your login.
                  </li>
                </ul>
              </Section>

              <Section id="membership">
                <ul>
                  <li>
                    Using canvas takes a membership. It costs {MEMBERSHIP.price} {MEMBERSHIP.per} in US dollars, plus
                    any tax that applies where you live.
                  </li>
                  <li>
                    Payments are handled by Stripe, and Stripe&apos;s terms apply to them too. We never see or store
                    your full card number.
                  </li>
                  <li>
                    Your membership renews automatically every month, on the day of the month you started, until you
                    cancel. By starting one, you allow us to charge your payment method through Stripe each month.
                  </li>
                  <li>
                    You can cancel any time from the{" "}
                    <Link href="/membership" className={link}>
                      Membership
                    </Link>{" "}
                    page. Cancelling stops the next renewal; you keep using canvas until the end of the month you&apos;ve
                    paid for.
                  </li>
                  <li>We don&apos;t refund partial months, except where the law requires us to.</li>
                  <li>If a payment fails, we may pause your membership until it goes through.</li>
                  <li>
                    If the price changes, we&apos;ll email you at least 30 days before the new price applies to your
                    membership, so you can cancel first if you&apos;d like to.
                  </li>
                  <li>A complimentary membership we&apos;ve given you can be ended at any time.</li>
                </ul>
              </Section>

              <Section id="content">
                <ul>
                  <li>
                    What you make and upload in canvas (drawings, notes, equations, flashcards, to-do boards, images
                    and videos) stays yours.
                  </li>
                  <li>
                    You give us permission to store, copy, process and show your content only as needed to run canvas
                    for you: saving it, making previews, showing it to the people you share a drawing with, and sending
                    what you select to our AI provider when you ask for a math check.
                  </li>
                  <li>
                    Anyone you share a drawing with can see everything on it and copy it, and can change it if you let
                    them edit. Share with care.
                  </li>
                  <li>You&apos;re responsible for what you put in canvas, and need the right to upload it.</li>
                  <li>
                    Keep copies of anything important. Any drawing can be saved as a backup from its Export menu.
                  </li>
                </ul>
              </Section>

              <Section id="rules">
                <p>When you use canvas, don&apos;t:</p>
                <ul>
                  <li>break the law, or help someone else break it;</li>
                  <li>
                    upload anything you don&apos;t have the right to share, or anything sexual involving a minor,
                    threatening, hateful or meant to harass someone;
                  </li>
                  <li>bully, harass or pretend to be other people, including in shared drawings;</li>
                  <li>upload malware, or try to get into accounts, data or systems that aren&apos;t yours;</li>
                  <li>
                    get around our limits, payments or security, or overload canvas with automated or bulk requests;
                  </li>
                  <li>copy, resell or rent out canvas itself, or access to it.</li>
                </ul>
                <p>We may remove content that breaks these rules.</p>
              </Section>

              <Section id="ai">
                <ul>
                  <li>
                    Math checks are written by an AI model and can be wrong. Treat them as a second opinion: check the
                    work yourself, and don&apos;t rely on them for exams, grades or anything important.
                  </li>
                  <li>
                    When you ask for a check, the part of your drawing you selected is sent to our AI provider to be
                    read. Leave personal information out of it.
                  </li>
                </ul>
              </Section>

              <Section id="changes-to-canvas">
                <ul>
                  <li>
                    We work to keep canvas running, but it may sometimes be unavailable, for maintenance or because
                    something has gone wrong.
                  </li>
                  <li>We may add, change or remove features as canvas grows.</li>
                  <li>
                    If we ever close canvas, we&apos;ll tell you at least 30 days ahead so you can save your drawings,
                    and we won&apos;t charge you for any time after it closes.
                  </li>
                </ul>
              </Section>

              <Section id="ending">
                <ul>
                  <li>
                    You can cancel your membership at any time. To close your account and have it deleted, write to
                    us (see Contact below).
                  </li>
                  <li>
                    We may suspend or close your account if you break these terms, if your payments fail, or if the
                    law requires us to. Where we reasonably can, we&apos;ll tell you why first and give you a chance to
                    put things right.
                  </li>
                </ul>
              </Section>

              <Section id="disclaimers">
                <p>
                  canvas is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. As far as the law allows, we
                  don&apos;t make promises about it beyond the ones in these terms, including any implied promise that
                  it will suit a particular purpose, be free of errors, or be available without interruption.
                </p>
              </Section>

              <Section id="liability">
                <p>
                  As far as the law allows, we aren&apos;t liable for indirect, incidental, special, consequential or
                  punitive losses, or for lost data, profits or revenue. Our total liability for any claim about canvas
                  is limited to the greater of what you paid us for canvas in the 12 months before the claim, or US$50.
                </p>
                <p>
                  Some places don&apos;t allow these limits, and there they apply only as far as allowed. Nothing in
                  these terms takes away rights you have as a consumer that can&apos;t be waived.
                </p>
              </Section>

              <Section id="changes">
                <p>
                  We may update these terms. When we do, we&apos;ll change the date at the top, and for important
                  changes we&apos;ll email you at least 30 days before they take effect, unless a change is needed
                  sooner for legal or security reasons. If you keep using canvas after the changes take effect, you
                  accept them; if you don&apos;t, cancel your membership before then.
                </p>
              </Section>

              <Section id="contact">
                <p>
                  <Suspense fallback={NO_ADDRESS}>
                    <ContactLine />
                  </Suspense>
                </p>
              </Section>
            </article>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
