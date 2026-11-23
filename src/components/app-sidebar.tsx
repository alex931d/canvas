"use client";

import { ChevronsLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { Kbd, Tip } from "@/components/kit";
import { useSeason } from "@/components/seasonal/season-context";
import { SidebarSeason } from "@/components/seasonal/sidebar-decor";
import { cn } from "@/lib/utils";
import { SIDEBAR_KEY } from "./app-sidebar-key";

/*
 * Dark sidebar in the dashboard style: lowercase wordmark, nav items with a
 * beige "active" tab and a green edge. On phones it becomes a bar along the
 * bottom; on tablets a rail of icons; on bigger screens the full menu, with a
 * "Minimize menu" toggle that makes it the rail there too.
 *
 * What the rail looks like is all CSS (the `rail:` variant in globals.css),
 * so it's right from the first paint: the minimized choice is on <html> as
 * data-sidebar="collapsed" before the page draws (src/app/layout.tsx). React
 * only needs it for the toggle's label and the icons' tooltips.
 */

const listeners = new Set<() => void>();
const TABLET = "(min-width: 48rem) and (max-width: 63.99rem)";

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function setCollapsed(value: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (value) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const tablet = window.matchMedia(TABLET);
  tablet.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    tablet.removeEventListener("change", cb);
  };
};

/** The menu minimized by choice (bigger screens). */
export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, readCollapsed, () => false);
}

/** The menu showing as a rail of icons right now: on a tablet, or minimized. */
function useRail() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(TABLET).matches || readCollapsed(), () => false);
}

export function AppSidebar({
  children,
  footer,
  seasonalMotion = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** Let seasonal snow, bats or petals move in the menu (off next to the drawing). */
  seasonalMotion?: boolean;
}) {
  const collapsed = useSidebarCollapsed();
  const season = useSeason();
  return (
    <aside
      data-season={season ?? undefined}
      className={cn(
        "group/sidebar fixed inset-x-0 bottom-0 z-40 flex shrink-0 flex-col rounded-t-lg bg-grey-900 text-grey-300",
        "md:sticky md:top-0 md:h-dvh md:w-[260px] md:rounded-t-none md:rounded-r-2xl md:transition-[width] md:duration-200 rail:w-[88px]",
      )}
    >
      {season ? <SidebarSeason theme={season} motion={seasonalMotion} /> : null}
      <Link
        href="/"
        className="hidden h-[101px] shrink-0 items-center px-8 short:h-20 shorter:h-16 text-[32px] leading-none font-extrabold tracking-[-0.04em] text-white md:flex"
        aria-label="canvas, all drawings"
      >
        <span className="rail:hidden">canvas</span>
        <span className="hidden rail:inline">c</span>
      </Link>

      <nav className="flex min-h-0 flex-1 overflow-x-auto px-2 pt-2 md:block md:overflow-x-visible md:overflow-y-auto md:px-0 md:pt-4 md:pb-2">
        <ul className="flex w-full items-stretch justify-around gap-1 md:block md:space-y-0.5">{children}</ul>
      </nav>

      {footer ? <div className="mx-4 hidden border-t border-white/10 pt-2 pb-1 md:block">{footer}</div> : null}

      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        // Bigger screens only: on a tablet the menu is always the rail.
        className="mb-6 hidden h-12 shrink-0 items-center gap-4 px-8 short:mb-3 short:h-11 text-base font-bold text-grey-300 transition-colors hover:text-white lg:flex"
        aria-label={collapsed ? "Expand menu" : "Minimize menu"}
      >
        <ChevronsLeft className="size-5 shrink-0 transition-transform rail:rotate-180" />
        <span className="rail:hidden">Minimize menu</span>
      </button>
    </aside>
  );
}

const itemClass = (active: boolean, compact: boolean) =>
  cn(
    "group/item relative flex w-full items-center gap-4 font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-green",
    // phones: icon tabs along the bottom bar
    "h-14 flex-col justify-center gap-1 rounded-t-lg border-b-4 px-3 text-xs md:flex-row md:justify-start md:gap-4 md:rounded-t-none md:rounded-r-xl md:border-b-0 md:border-l-4 md:text-base",
    compact ? "md:h-11 short:h-9 shorter:h-8" : "md:h-14 short:h-12",
    "md:w-[calc(100%-24px)] md:pl-7",
    "rail:w-[calc(100%-12px)] rail:pl-[26px]",
    active
      ? "border-green bg-beige-100 text-grey-900 [&_svg]:text-green"
      : "border-transparent text-grey-300 hover:text-white",
    "disabled:pointer-events-none disabled:opacity-35",
  );

type ItemProps = {
  icon: ReactNode;
  label: string;
  /** Left out of the phones' bottom bar (still in the menu on bigger screens). */
  wideOnly?: boolean;
  active?: boolean;
  shortcut?: string;
  compact?: boolean;
  disabled?: boolean;
};

function ItemInner({ icon, label, shortcut }: ItemProps) {
  return (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center [&_svg]:size-6 md:[&_svg]:size-5">{icon}</span>
      <span className="whitespace-nowrap md:truncate rail:sr-only">{label}</span>
      {shortcut ? (
        <span className="ml-auto hidden md:inline-flex rail:hidden">
          <Kbd tone="dark" className="text-grey-300 uppercase group-hover/item:text-white">
            {shortcut}
          </Kbd>
        </span>
      ) : null}
    </>
  );
}

function WithTooltip({
  show,
  label,
  shortcut,
  children,
}: {
  show: boolean;
  label: string;
  shortcut?: string;
  children: ReactElement;
}) {
  if (!show) return children;
  return (
    <Tip content={label} shortcut={shortcut} side="right">
      {children}
    </Tip>
  );
}

export function SidebarButton({
  onClick,
  pressed,
  ...props
}: ItemProps & { onClick: () => void; pressed?: boolean }) {
  const rail = useRail();
  return (
    <li className="shrink-0 md:shrink">
      <WithTooltip show={rail} label={props.label} shortcut={props.shortcut}>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={pressed}
          aria-label={props.label}
          disabled={props.disabled}
          className={itemClass(!!props.active, !!props.compact)}
        >
          <ItemInner {...props} />
        </button>
      </WithTooltip>
    </li>
  );
}

export function SidebarLink({ href, ...props }: ItemProps & { href: string }) {
  const rail = useRail();
  return (
    <li className={cn("shrink-0 md:shrink", props.wideOnly && "hidden md:list-item")}>
      <WithTooltip show={rail} label={props.label}>
        <Link
          href={href}
          aria-current={props.active ? "page" : undefined}
          className={itemClass(!!props.active, !!props.compact)}
        >
          <ItemInner {...props} />
        </Link>
      </WithTooltip>
    </li>
  );
}

export function SidebarSeparator() {
  return <li aria-hidden className="mx-8 my-3 hidden h-px bg-white/10 md:block shorter:my-2" />;
}
