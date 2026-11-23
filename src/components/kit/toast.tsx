"use client";

import { CircleAlert, CircleCheck, Info, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/*
 * Toasts: short notes at the bottom of the screen.
 *
 *   toast("Drawing deleted", { description, action: { label: "Undo", onClick } })
 *   toast.success("Saved.")   toast.error("Couldn't save.")   toast.info(…)
 *   toast.loading("Adding the video…", { id: "media" })   toast.dismiss("media")
 *
 * Giving an `id` replaces the toast with that id instead of stacking another.
 * They go after a few seconds (errors stay longer, loading ones until
 * replaced or dismissed); hovering or focusing one holds it. <Toaster /> in
 * the root layout shows them, in a live region screen readers announce.
 */

type Kind = "default" | "success" | "error" | "info" | "loading";
type Options = {
  id?: string;
  description?: React.ReactNode;
  duration?: number;
  action?: { label: string; onClick: () => void };
};
type Item = Options & {
  id: string;
  kind: Kind;
  message: React.ReactNode;
  version: number;
};

const MAX = 4;
let items: Item[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function show(kind: Kind, message: React.ReactNode, options: Options = {}) {
  const id = options.id ?? `toast-${++counter}`;
  const item: Item = { ...options, id, kind, message, version: ++counter };
  const at = items.findIndex((t) => t.id === id);
  items = at === -1 ? [...items, item].slice(-MAX) : items.map((t, i) => (i === at ? item : t));
  emit();
  return id;
}

function dismiss(id?: string) {
  items = id === undefined ? [] : items.filter((t) => t.id !== id);
  emit();
}

export const toast = Object.assign((message: React.ReactNode, options?: Options) => show("default", message, options), {
  success: (message: React.ReactNode, options?: Options) => show("success", message, options),
  error: (message: React.ReactNode, options?: Options) => show("error", message, options),
  info: (message: React.ReactNode, options?: Options) => show("info", message, options),
  loading: (message: React.ReactNode, options?: Options) => show("loading", message, options),
  dismiss,
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const NONE: Item[] = [];

const ICONS: Record<Kind, React.ReactNode> = {
  default: null,
  success: <CircleCheck className="size-5 text-[#7fd1c3]" aria-hidden />,
  error: <CircleAlert className="size-5 text-[#f19a8b]" aria-hidden />,
  info: <Info className="size-5 text-cyan" aria-hidden />,
  loading: <LoaderCircle className="size-5 animate-spin text-grey-300" aria-hidden />,
};

function ToastCard({ item }: { item: Item }) {
  const held = useRef(false);
  const duration = item.duration ?? (item.kind === "error" ? 7000 : item.kind === "loading" ? Infinity : 4500);

  useEffect(() => {
    if (!Number.isFinite(duration)) return;
    let left = duration;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (!held.current) left -= now - last;
      last = now;
      if (left <= 0) dismiss(item.id);
    }, 200);
    return () => clearInterval(timer);
    // A replaced toast (same id, new version) starts its time again.
  }, [item.id, item.version, duration]);

  return (
    <li
      data-toast={item.kind}
      role={item.kind === "error" ? "alert" : "status"}
      onPointerEnter={() => (held.current = true)}
      onPointerLeave={() => (held.current = false)}
      onFocus={() => (held.current = true)}
      onBlur={() => (held.current = false)}
      className="kit-toast pointer-events-auto flex w-full items-start gap-3 rounded-xl bg-grey-900 py-3 pr-2 pl-4 text-sm text-white shadow-float"
    >
      {ICONS[item.kind] ? <span className="mt-px">{ICONS[item.kind]}</span> : null}
      <div className="min-w-0 flex-1 py-px leading-snug">
        <p className="font-bold">{item.message}</p>
        {item.description ? <p className="mt-0.5 text-grey-300">{item.description}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            dismiss(item.id);
          }}
          className="h-8 shrink-0 rounded-md bg-white px-3 text-xs font-bold text-grey-900 outline-none hover:bg-white/90 focus-visible:ring-[3px] focus-visible:ring-green/60"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-grey-300 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-[3px] focus-visible:ring-green/60"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

export function Toaster({ className }: { className?: string }) {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => NONE,
  );
  return (
    <section
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-4 z-[70] max-md:bottom-[84px] flex justify-center px-4",
        className,
      )}
    >
      <ol className="flex w-full max-w-[420px] flex-col gap-2">
        {list.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </ol>
    </section>
  );
}
