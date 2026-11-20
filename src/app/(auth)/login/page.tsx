import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-form";
import { captchaSite } from "@/lib/auth/captcha";

export const metadata: Metadata = { title: "Login" };

async function LoginWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next } = await searchParams;
  // Read per request (after the dynamic searchParams), so CAPTCHA keys can change without a rebuild.
  return <LoginForm next={typeof next === "string" ? next : "/"} captcha={captchaSite()} />;
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
