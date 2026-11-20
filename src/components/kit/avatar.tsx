"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** First and last initials ("Maya Chen" → "MC"). */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * A round profile picture, or initials on teal when there's none (or it
 * fails to load). Decorative: put the person's name in text next to it.
 * Size it with `size-*` and the initials with `text-*`.
 */
export function Avatar({
  name,
  src,
  className,
  style,
}: {
  name: string;
  src?: string | null;
  className?: string;
  /** e.g. a per-person background colour for the initials. */
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;
  return (
    <span
      aria-hidden
      data-ui="avatar"
      data-photo={showImage ? "" : undefined}
      style={style}
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-green text-sm font-bold text-white select-none",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- small private images served by our own route
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
