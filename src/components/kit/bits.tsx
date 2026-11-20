import { cn } from "@/lib/utils";

/** Small pieces: badges, keycaps, loading placeholders and dividers. */

export type BadgeTone = "dark" | "green" | "orange" | "red" | "neutral";

const BADGE_TONES: Record<BadgeTone, string> = {
  dark: "bg-grey-900 text-white",
  green: "bg-green text-white",
  orange: "bg-warning text-white",
  red: "bg-red text-white",
  neutral: "bg-white text-grey-500 shadow-[inset_0_0_0_1px_rgb(152_144_139_/_0.45)]",
};

/** A rounded tag for a status or a role. */
export function Badge({ tone = "dark", className, ...props }: React.ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      data-ui="badge"
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap [&>svg]:size-3",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A key on the keyboard: `light` on white surfaces, `dark` on the sidebar and dark cards. */
export function Kbd({
  tone = "light",
  className,
  ...props
}: React.ComponentProps<"kbd"> & { tone?: "light" | "dark" }) {
  return (
    <kbd
      data-ui="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-b-2 px-1 font-sans text-[11px] leading-none font-bold tabular-nums",
        tone === "light" ? "border-beige-500/50 bg-white text-grey-900" : "border-white/20 bg-white/10 text-current",
        className,
      )}
      {...props}
    />
  );
}

/** A beige placeholder, a shade darker than the page so it shows on beige and on white, that shimmers while something loads (still, with reduced motion). */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-ui="skeleton" aria-hidden className={cn("kit-shimmer rounded-lg bg-[#ebe4dc]", className)} {...props} />
  );
}

export function Separator({
  orientation = "horizontal",
  className,
  ...props
}: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      data-ui="separator"
      role="separator"
      aria-orientation={orientation}
      className={cn("shrink-0 bg-beige-500/30", orientation === "horizontal" ? "h-px w-full" : "h-6 w-px", className)}
      {...props}
    />
  );
}
