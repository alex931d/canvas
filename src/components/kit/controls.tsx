"use client";

import { Check } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * Controls built from plain elements, with the keyboard and screen-reader
 * behaviour each one is expected to have:
 *
 *   Switch       a button with role="switch"; sends `name=on` with a form when on
 *   Slider       a native range input, styled (globals.css .kit-range)
 *   Toggle       a button with aria-pressed
 *   ToggleGroup  pick one of a few: role="radiogroup", arrow keys move and choose
 *   Tabs         role="tablist"/"tab"/"tabpanel", arrow keys, Home and End
 */

// ------------------------------------------------------------------ switch

type SwitchProps = Omit<React.ComponentProps<"button">, "value" | "onChange"> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Sends `name=value` with the surrounding form while on. */
  name?: string;
  value?: string;
};

export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  name,
  value = "on",
  disabled,
  className,
  ...props
}: SwitchProps) {
  const [own, setOwn] = useState(defaultChecked);
  const on = checked ?? own;
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-ui="switch"
        data-state={on ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={() => {
          if (checked === undefined) setOwn(!on);
          onCheckedChange?.(!on);
        }}
        className={cn(
          "group/switch relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors outline-none",
          "focus-visible:ring-[3px] focus-visible:ring-green/45 disabled:cursor-not-allowed disabled:opacity-45",
          on ? "bg-green" : "bg-grey-300",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full bg-white shadow-sm transition-transform duration-150",
            on && "translate-x-4",
          )}
        >
          {on ? <Check className="size-3 text-green" strokeWidth={3} aria-hidden /> : null}
        </span>
      </button>
      {name && on && !disabled ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}

// ------------------------------------------------------------------ slider

type SliderProps = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Once the drag (or key press) is over. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** "light" for dark surfaces. */
  tone?: "dark" | "light";
};

export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  tone = "dark",
  className,
  style,
  ...props
}: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const commit = (e: React.SyntheticEvent<HTMLInputElement>) => onValueCommit?.(Number(e.currentTarget.value));
  return (
    <input
      type="range"
      data-ui="slider"
      data-tone={tone}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange(Number(e.currentTarget.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      className={cn("kit-range w-full", className)}
      style={{ "--fill": `${fill}%`, ...style } as React.CSSProperties}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ toggle

type ToggleSize = "sm" | "md";
const TOGGLE_SIZES: Record<ToggleSize, string> = {
  sm: "h-8 min-w-8 px-2.5 text-xs",
  md: "h-9 min-w-9 px-3 text-sm",
};

const toggleItem = (size: ToggleSize, active: boolean) =>
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-bold whitespace-nowrap transition-colors outline-none",
    "focus-visible:ring-[3px] focus-visible:ring-green/45 disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    TOGGLE_SIZES[size],
    active ? "bg-grey-900 text-white" : "text-grey-900 hover:bg-beige-100",
  );

/** A single on/off button (e.g. Sketchy). */
export function Toggle({
  pressed,
  onPressedChange,
  size = "sm",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  size?: ToggleSize;
}) {
  return (
    <button
      type="button"
      data-ui="toggle"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      onClick={() => onPressedChange(!pressed)}
      // Standing alone, an off toggle keeps a thin edge so it still reads as a button.
      className={cn(
        toggleItem(size, pressed),
        !pressed && "shadow-[inset_0_0_0_1px_rgb(152_144_139_/_0.45)]",
        className,
      )}
      {...props}
    />
  );
}

type GroupContext = {
  value: string;
  choose: (value: string) => void;
  size: ToggleSize;
};
const ToggleGroupContext = createContext<GroupContext | null>(null);

/** Pick one of a few options, side by side (brush, font, fill). */
export function ToggleGroup({
  value,
  onValueChange,
  size = "sm",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  size?: ToggleSize;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]:not(:disabled)")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    const next = items[(at + step + items.length) % items.length];
    next.focus();
    next.click();
  };
  return (
    <ToggleGroupContext.Provider value={{ value, choose: onValueChange, size }}>
      <div
        role="radiogroup"
        data-ui="toggle-group"
        onKeyDown={onKeyDown}
        className={cn("inline-flex items-center gap-0.5 rounded-lg bg-beige-100/70 p-0.5", className)}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "value"> & { value: string }) {
  const group = useContext(ToggleGroupContext);
  if (!group) throw new Error("ToggleGroupItem goes inside a ToggleGroup");
  const active = group.value === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-state={active ? "on" : "off"}
      tabIndex={active ? 0 : -1}
      onClick={() => group.choose(value)}
      className={cn(toggleItem(group.size, active), className)}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ tabs

type TabsContext = {
  value: string;
  choose: (value: string) => void;
  id: string;
};
const TabsCtx = createContext<TabsContext | null>(null);

function useTabs() {
  const tabs = useContext(TabsCtx);
  if (!tabs) throw new Error("Tab parts go inside <Tabs>");
  return tabs;
}

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <TabsCtx.Provider value={{ value, choose: onValueChange, id }}>
      <div data-ui="tabs" className={cn("flex flex-col gap-4", className)}>
        {children}
      </div>
    </TabsCtx.Provider>
  );
}

/** The row of tabs: a beige track with the chosen tab raised in white. */
export function TabList({ className, ...props }: React.ComponentProps<"div">) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]:not(:disabled)")];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    const target =
      e.key === "ArrowRight"
        ? tabs[(at + 1) % tabs.length]
        : e.key === "ArrowLeft"
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : e.key === "Home"
            ? tabs[0]
            : e.key === "End"
              ? tabs.at(-1)
              : null;
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.click();
  };
  return (
    <div
      role="tablist"
      data-ui="tab-list"
      onKeyDown={onKeyDown}
      className={cn("flex w-full items-stretch gap-1 rounded-lg bg-beige-100 p-1", className)}
      {...props}
    />
  );
}

export function Tab({ value, className, ...props }: Omit<React.ComponentProps<"button">, "value"> & { value: string }) {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.id}-tab-${value}`}
      aria-controls={`${tabs.id}-panel-${value}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      onClick={() => tabs.choose(value)}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-bold whitespace-nowrap transition-[background-color,color,box-shadow] outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-green/45",
        active ? "bg-white text-grey-900 shadow-[0_1px_2px_rgb(32_31_36_/_0.12)]" : "text-grey-500 hover:text-grey-900",
        className,
      )}
      {...props}
    />
  );
}

export function TabPanel({ value, className, ...props }: React.ComponentProps<"div"> & { value: string }) {
  const tabs = useTabs();
  if (tabs.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${tabs.id}-panel-${value}`}
      aria-labelledby={`${tabs.id}-tab-${value}`}
      tabIndex={0}
      className={cn("outline-none", className)}
      {...props}
    />
  );
}
