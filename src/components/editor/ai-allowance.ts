"use client";

import { useEffect, useState } from "react";

/**
 * What's left of the month's AI allowance, for the tools that use it. The
 * AI routes answer with X-AI-Calls-Left; `noteAiCallsLeft` passes that on
 * to whatever is showing it.
 */

const EVENT = "canvas:ai-calls-left";

export function noteAiCallsLeft(res: Response) {
  const left = res.headers.get("X-AI-Calls-Left");
  if (left !== null) window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: Number(left) }));
}

export type AllowanceView = { left: number; limit: number; resetsAt: string } | null;

/** Loaded when `active` turns on, then kept current by each AI answer. */
export function useAiAllowance(active: boolean): AllowanceView {
  const [view, setView] = useState<AllowanceView>(null);
  useEffect(() => {
    if (!active) return;
    let stale = false;
    fetch("/api/ai-allowance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        if (!stale && a) setView({ left: a.left, limit: a.limit, resetsAt: a.resetsAt });
      })
      .catch(() => {});
    const onLeft = (e: Event) => {
      const left = (e as CustomEvent<number>).detail;
      setView((v) => (v ? { ...v, left } : v));
    };
    window.addEventListener(EVENT, onLeft);
    return () => {
      stale = true;
      window.removeEventListener(EVENT, onLeft);
    };
  }, [active]);
  return view;
}
