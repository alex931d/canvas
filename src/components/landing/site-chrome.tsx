import Link from "next/link";
import { SeasonalHeaderDecor } from "@/components/seasonal/site-decor";
import { Button } from "@/components/kit";
import { cn } from "@/lib/utils";

/** The public pages' frame (landing, pricing and terms): header, footer and shared spacing. */

/** The dotted paper of the canvas, for "board" panels. */
export const DOT_GRID = {
  backgroundImage: "radial-gradient(circle, #d8d1ca 1.1px, transparent 1.3px)",
  backgroundSize: "24px 24px",
};

/** The boards' outer and inner padding, so every section shares its left edge. */
export const OUTER = "px-3 sm:px-6";
export const INNER = "mx-auto w-full max-w-[1392px] px-5 sm:px-12 xl:px-16";

export const linkFocus = "rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("leading-none font-extrabold tracking-[-0.04em]", linkFocus, className)}>
      canvas
    </Link>
  );
}

const navLink = cn(linkFocus, "px-2 py-2 text-sm font-bold whitespace-nowrap underline-offset-4 hover:underline sm:px-3");

/** Log in, and the drawings in this browser (no account needed), for visitors who aren't signed in. */
export function SignedOutLinks() {
  return (
    <>
      <Link href="/login" className={navLink}>
        Log in
      </Link>
      <Button asChild size="lg" className="px-4 sm:px-5">
        <Link href="/local">Open canvas</Link>
      </Button>
    </>
  );
}

/** For signed-in visitors: straight back into the app. */
export function SignedInLinks() {
  return (
    <Button asChild size="lg" className="px-4 sm:px-5">
      <Link href="/">Open canvas</Link>
    </Button>
  );
}

export function SiteHeader({ current, account }: { current?: "pricing"; account: React.ReactNode }) {
  return (
    <header className={OUTER}>
      <div className={cn(INNER, "flex h-20 items-center justify-between gap-4")}>
        <span className="flex items-center gap-2">
          <Wordmark className="text-2xl sm:text-[28px]" />
          <SeasonalHeaderDecor />
        </span>
        <nav aria-label="Site" className="flex items-center gap-1 sm:gap-3">
          <Link
            href="/pricing"
            aria-current={current === "pricing" ? "page" : undefined}
            // Phones have no room for it next to the account buttons; the pages link to pricing in their text.
            className={cn(navLink, "hidden aria-[current=page]:underline sm:block")}
          >
            Pricing
          </Link>
          {account}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={OUTER}>
      {/* Extra room underneath for the seasonal "Hide decorations" button, which sits in the corner. */}
      <div className={cn(INNER, "flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-10 pb-20 text-sm text-grey-500")}>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Wordmark className="text-xl text-grey-900" />
          <span>An infinite canvas for notes and math.</span>
        </span>
        <nav aria-label="About canvas" className="-mx-2 flex gap-1 sm:-mx-3">
          <Link href="/pricing" className={cn(navLink, "font-normal text-grey-500 hover:text-grey-900")}>
            Pricing
          </Link>
          <Link href="/terms" className={cn(navLink, "font-normal text-grey-500 hover:text-grey-900")}>
            Terms of service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
