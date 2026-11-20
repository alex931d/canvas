import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SplitLayout } from "@/components/auth/split-layout";
import { getCurrentSession } from "@/lib/auth/session";

/** Already signed in? Skip the login screens. */
async function RedirectIfSignedIn() {
  const { user } = await getCurrentSession();
  if (user) redirect("/");
  return null;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SplitLayout>
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      {children}
    </SplitLayout>
  );
}
