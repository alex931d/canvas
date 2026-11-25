import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/auth-form";
import { captchaSite } from "@/lib/auth/captcha";
import { googleEnabled } from "@/lib/auth/google";

export const metadata: Metadata = { title: "Sign up" };

/** Read per request, so CAPTCHA and Google keys can change without a rebuild. */
async function SignupWithCaptcha() {
  await connection();
  return <SignupForm captcha={captchaSite()} google={googleEnabled()} />;
}

export default function SignupPage() {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <h1 className="mb-8 text-[32px] leading-tight font-bold">Sign Up</h1>
      <Suspense fallback={<SignupForm captcha="loading" />}>
        <SignupWithCaptcha />
      </Suspense>
    </section>
  );
}
