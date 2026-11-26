import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowserGallery, NewBrowserDrawingButton } from "@/components/gallery/browser-gallery";
import { HeaderAccount } from "@/components/landing/header-account";
import { OUTER, INNER, SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { Skeleton } from "@/components/kit";
import { getViewerPlan } from "@/lib/billing/membership";
import { cn } from "@/lib/utils";

/**
 * Drawings kept in this browser, for anyone (the free plan needs no
 * account). Signed-in people see these on their home page too.
 */

export const metadata: Metadata = {
  title: "Your drawings",
  description: "Drawings saved in this browser. No account needed.",
};

async function Gallery() {
  const { user, plan } = await getViewerPlan();
  return <BrowserGallery member={plan === "member" && !!user} />;
}

export default function BrowserDrawingsPage() {
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
        <div className={cn(INNER, "py-6 sm:py-10")}>
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[32px] leading-tight font-bold">Your drawings</h1>
              <p className="mt-1 max-w-[36rem] text-sm leading-relaxed text-grey-500">
                Saved in this browser, on this device. No account needed.
              </p>
            </div>
            <NewBrowserDrawingButton />
          </header>
          <Suspense fallback={<Skeleton className="h-80 rounded-xl bg-card" />}>
            <Gallery />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
