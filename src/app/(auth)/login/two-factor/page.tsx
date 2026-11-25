import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { safeNext } from "@/lib/auth/next-path";
import { getPendingTwoFactor } from "@/lib/auth/session";
import { contactEmail } from "@/lib/site/contact";

export const metadata: Metadata = { title: "Two-factor sign-in" };

/** Only for a login that got past the password (or Google) and waits for its code. */
async function TwoFactorCard({ searchParams }: { searchParams: PageProps<"/login/two-factor">["searchParams"] }) {
  const pending = await getPendingTwoFactor();
  const { next } = await searchParams;
  if (!pending) redirect("/login");
  return <TwoFactorForm email={pending.user.email} next={safeNext(next)} contact={await contactEmail()} />;
}

export default function TwoFactorPage({ searchParams }: PageProps<"/login/two-factor">) {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <h1 className="mb-4 text-[32px] leading-tight font-bold">Enter your code</h1>
      <Suspense fallback={<div className="h-80" />}>
        <TwoFactorCard searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
