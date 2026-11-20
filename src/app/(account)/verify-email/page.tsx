import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/account-forms";
import { secondsUntilResend } from "@/lib/auth/email-verification";
import { safeNext } from "@/lib/auth/next-path";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer" };

async function VerifyCard({ searchParams }: { searchParams: PageProps<"/verify-email">["searchParams"] }) {
  const user = await requireSignedIn();
  const { code, next } = await searchParams;
  const nextPath = safeNext(next);
  if (user.emailVerified) redirect(nextPath);
  return (
    <VerifyEmailForm
      email={user.email}
      next={nextPath}
      // The email's link only fills the code in; confirming still takes a press.
      initialCode={typeof code === "string" ? code.slice(0, 16) : ""}
      resendWait={await secondsUntilResend(user.id)}
    />
  );
}

export default function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <h1 className="mb-4 text-[32px] leading-tight font-bold">Check your email</h1>
      <Suspense fallback={<div className="h-72" />}>
        <VerifyCard searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
