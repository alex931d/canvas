import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-form";
import { captchaSite } from "@/lib/auth/captcha";
import { googleEnabled } from "@/lib/auth/google";

export const metadata: Metadata = { title: "Login" };

/** Why a Google sign-in came back here (/login/google/callback). */
const GOOGLE_ERRORS: Record<string, string> = {
  "google-cancelled": "Google sign-in was cancelled.",
  "google-failed": "Google sign-in didn't work. Try again, or log in with your email and password.",
  "google-expired": "That Google sign-in took too long. Try again.",
  "google-limited": "Too many sign-ins from this network. Wait a minute and try again.",
  "google-off": "Google sign-in isn't set up on this site.",
  "google-unverified":
    "An account already uses this email, and Google hasn't confirmed the address is yours. Log in with your password, then connect Google in Settings.",
  "google-other":
    "This canvas account is connected to a different Google account. Continue with that one, or log in with your password.",
};

async function LoginWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next, error } = await searchParams;
  // Read per request (after the dynamic searchParams), so CAPTCHA and Google keys can change without a rebuild.
  return (
    <LoginForm
      next={typeof next === "string" ? next : "/"}
      captcha={captchaSite()}
      google={googleEnabled()}
      error={typeof error === "string" ? GOOGLE_ERRORS[error] : undefined}
    />
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
      <h1 className="mb-8 text-[32px] leading-tight font-bold">Login</h1>
      <Suspense fallback={<LoginForm next="/" captcha="loading" />}>
        <LoginWithNext searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
