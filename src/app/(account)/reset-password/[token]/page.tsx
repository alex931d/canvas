import type { Metadata } from "next";
import { Suspense } from "react";
import { ExpiredResetLink, ResetPasswordForm } from "@/components/auth/account-forms";
import { findResetLink } from "@/lib/auth/password-reset";

// The token is in the address: never send it to another site in a Referer header.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

async function ResetCard({ params }: { params: PageProps<"/reset-password/[token]">["params"] }) {
  const { token } = await params;
  const link = await findResetLink(token); // only looks: the link is used up when the form is sent
  return link ? <ResetPasswordForm token={token} email={link.email} /> : <ExpiredResetLink />;
}

export default function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <Suspense fallback={<div className="h-80" />}>
        <ResetCard params={params} />
      </Suspense>
    </section>
  );
}
