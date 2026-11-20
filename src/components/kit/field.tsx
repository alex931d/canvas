import { cn } from "@/lib/utils";

/** Text fields: white, a beige edge, and a dark edge with a soft teal ring when focused. */

const field = cn(
  "w-full min-w-0 rounded-lg border border-beige-500 bg-white text-sm font-normal text-grey-900 outline-none",
  "transition-[border-color,box-shadow] placeholder:text-grey-500/80",
  "focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25",
  "aria-invalid:border-red aria-invalid:focus-visible:ring-red/20",
  "disabled:cursor-not-allowed disabled:bg-beige-100 disabled:text-grey-500",
);

export type FieldSize = "sm" | "md";

export function Input({
  className,
  fieldSize = "md",
  ...props
}: React.ComponentProps<"input"> & { fieldSize?: FieldSize }) {
  return (
    <input data-ui="input" className={cn(field, fieldSize === "md" ? "h-11 px-5" : "h-9 px-3", className)} {...props} />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-ui="textarea"
      className={cn(field, "min-h-20 resize-y px-4 py-3 leading-relaxed", className)}
      {...props}
    />
  );
}

/** The small grey label above a field. */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-ui="label"
      className={cn("text-xs font-bold text-grey-500 select-none peer-disabled:opacity-50", className)}
      {...props}
    />
  );
}

/** A native select dressed like the text fields. */
export function Select({
  className,
  fieldSize = "md",
  ...props
}: React.ComponentProps<"select"> & { fieldSize?: FieldSize }) {
  return (
    <select
      data-ui="select"
      className={cn(field, fieldSize === "md" ? "h-11 px-4" : "h-9 px-3", "cursor-pointer", className)}
      {...props}
    />
  );
}
