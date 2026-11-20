import Link from "next/link";

const wordmarkFocus = "rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-white/40";

/**
 * The two-column frame shared by the login, sign-up and membership pages:
 * a dark story panel on the left (a bar with the wordmark on phones) and the
 * page's card on the right.
 */
export function SplitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,560px)_1fr] lg:p-5">
      {/* Phones: a dark bar with the wordmark */}
      <header className="flex h-[70px] items-center justify-center rounded-b-lg bg-grey-900 lg:hidden">
        <Link href="/" className={`text-2xl font-extrabold tracking-[-0.04em] text-white ${wordmarkFocus}`}>
          canvas
        </Link>
      </header>

      {/* Desktop: the dark story panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden rounded-xl bg-grey-900 p-10 text-white lg:flex">
        <Link
          href="/"
          className={`self-start text-[32px] leading-none font-extrabold tracking-[-0.04em] ${wordmarkFocus}`}
        >
          canvas
        </Link>

        <div aria-hidden className="relative mx-auto my-10 w-full max-w-[380px] font-hand text-[44px] leading-[1.35]">
          <svg
            viewBox="0 0 380 230"
            className="absolute -inset-x-4 -inset-y-3 h-[calc(100%+24px)] w-[calc(100%+32px)]"
            fill="none"
          >
            <path
              d="M24 40 C 80 6, 300 2, 352 34 C 380 80, 372 170, 330 206 C 250 236, 90 232, 34 200 C 2 160, 0 80, 24 40 Z"
              stroke="#277c78"
              strokeWidth="3"
              strokeDasharray="10 9"
              strokeLinecap="round"
            />
          </svg>
          <p className="relative pl-8 text-sand">2x + 3 = 11</p>
          <p className="relative pl-8 text-cyan">2x = 8</p>
          <p className="relative pl-8 text-white">
            x = 4 <span className="text-green">✓</span>
          </p>
        </div>

        <div>
          <h2 className="text-[32px] leading-tight font-bold">Sketch it, paste it, check it</h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-grey-300">
            Write math by hand or paste a screenshot onto an endless canvas. Loop around an equation and canvas checks
            every step.
          </p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-10 lg:py-0">{children}</main>
    </div>
  );
}
