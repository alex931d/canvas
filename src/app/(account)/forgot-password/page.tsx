import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/account-forms";
import { captchaSite } from "@/lib/auth/captcha";

export const metadata: Metadata = { title: "Reset your password" };

/** Read per request, so CAPTCHA keys can change without a rebuild. */
async function FormWithCaptcha() {
  await connection();
  return <ForgotPasswordForm captcha={captchaSite()} />;
}

export default function ForgotPasswordPage() {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <Suspense fallback={<ForgotPasswordForm captcha="loading" />}>
        <FormWithCaptcha />
      </Suspense>
    </section>
  );
}
