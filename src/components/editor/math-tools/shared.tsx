"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/kit";
import type { FigurePart, Measure } from "@/lib/math/figures";
import { cn } from "@/lib/utils";

/** Builds a figure in the pen colour, with the typesetter for equation sizes. */
export type Build = (ink: string, measure: Measure) => Promise<FigurePart[]>;
/** Puts a figure on the canvas (selected, in view). */
export type Place = (build: Build) => Promise<void>;

/** Reads a number field: blank is undefined, anything unreadable is NaN. */
export function num(text: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function NumField({
  label,
  value,
  onChange,
  suffix,
  className,
  testId,
  placeholder,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  suffix?: React.ReactNode;
  className?: string;
  testId?: string;
  placeholder?: string;
}) {
  const bad = value.trim() !== "" && Number.isNaN(num(value));
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-bold text-grey-500", className)}>
      {label}
      <span className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={bad || undefined}
          data-testid={testId}
          placeholder={placeholder ?? "?"}
          autoComplete="off"
          className="h-10 w-full min-w-0 rounded-lg border border-beige-500 bg-white px-3 font-mono text-sm font-normal text-grey-900 tabular-nums outline-none placeholder:text-grey-500/60 focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25 aria-invalid:border-red"
        />
        {suffix ? <span className="shrink-0 text-sm font-normal text-grey-700">{suffix}</span> : null}
      </span>
    </label>
  );
}

export function Examples<T>({ items, label, onPick }: { items: { label: string; value: T }[]; label: string; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={label} role="group">
      {items.map((ex) => (
        <button
          key={ex.label}
          type="button"
          onClick={() => onPick(ex.value)}
          className="rounded-full bg-muted px-3 py-1 text-xs transition-colors hover:bg-grey-300/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ex.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-red" role="alert">
      {children}
    </p>
  );
}

export function AddButton({ onClick, disabled, children = "Add to canvas", testId }: { onClick: () => void; disabled?: boolean; children?: React.ReactNode; testId?: string }) {
  return (
    <Button className="self-start" disabled={disabled} onClick={onClick} data-testid={testId}>
      <Plus /> {children}
    </Button>
  );
}

/** The dark result card the chemistry tools use too. */
export function ResultCard({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl bg-grey-900 p-5 text-white" data-testid={testId}>
      <p className="text-sm text-grey-300">{label}</p>
      <div className="mt-1 text-2xl leading-snug font-bold break-words">{children}</div>
    </div>
  );
}
