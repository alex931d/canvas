import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/*
 * Buttons in canvas's style: near-black for the main action, white with a
 * beige edge for the second one, plain for toolbars. Sizes are the app's own:
 * 32 and 36 px in the editor's bars, 44 px in headers and forms, 53 px for a
 * page's main action.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "light" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "xl" | "icon-sm" | "icon-md" | "icon-lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-grey-900 text-white hover:bg-[#38363d]",
  secondary: "bg-white text-grey-900 shadow-[inset_0_0_0_1px_rgb(152_144_139_/_0.45)] hover:bg-beige-100",
  ghost: "text-grey-900 hover:bg-beige-100 aria-expanded:bg-beige-100",
  danger: "bg-red text-white hover:bg-[#b13e2f]",
  /** White: the editor's top bar on the beige page, and buttons on dark surfaces. */
  light: "bg-white text-grey-900 hover:bg-white/90",
  link: "text-grey-900 underline underline-offset-4 hover:text-green",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 rounded-md px-3 text-xs",
  md: "h-9 rounded-lg px-3.5 text-sm",
  lg: "h-11 rounded-lg px-5 text-sm",
  xl: "h-[53px] rounded-lg px-7 text-sm",
  "icon-sm": "size-8 rounded-md",
  "icon-md": "size-9 rounded-lg",
  "icon-lg": "size-10 rounded-lg",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  full = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 font-bold whitespace-nowrap outline-none select-none",
    "transition-[background-color,color,box-shadow,translate] active:translate-y-px",
    "focus-visible:ring-[3px] focus-visible:ring-green/45",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variant === "link" ? "h-auto rounded-sm p-0" : SIZES[size],
    VARIANTS[variant],
    full && "w-full",
    className,
  );
}

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fill the width of its container. */
  full?: boolean;
  /** Shows a spinner and stops further presses. */
  loading?: boolean;
  /** Style a child element (a link, say) as the button instead. */
  asChild?: boolean;
};

export function Button({
  variant,
  size,
  full,
  loading,
  asChild,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = buttonClasses({ variant, size, full, className });
  if (asChild) {
    return (
      <Slot.Root data-ui="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      data-ui="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
