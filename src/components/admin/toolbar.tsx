"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { adminHref, type AdminQuery } from "@/lib/admin/query";
import { ROLES, ROLE_INFO } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

const field =
  "h-11 rounded-lg border border-beige-500 bg-white text-sm outline-none focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Search and role filter. Typing updates the address as you go (replacing
 * the history entry, so Back isn't full of half-typed searches); choosing a
 * role adds a history entry. Without JavaScript it's a plain GET form.
 */
export function AdminToolbar({ query }: { query: AdminQuery }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q);
  // What this box last put in the address, so a page update caused by our own
  // typing doesn't overwrite what's been typed since.
  const [sent, setSent] = useState(query.q);
  const [seen, setSeen] = useState(query.q);
  if (query.q !== seen) {
    setSeen(query.q);
    if (query.q !== sent) {
      setText(query.q); // changed elsewhere: Back button, a link
      setSent(query.q);
    }
  }

  const go = (href: string, replace: boolean) =>
    startTransition(() => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })));

  useEffect(() => {
    const q = text.trim();
    if (q === query.q) return;
    const timer = setTimeout(() => {
      setSent(q);
      go(adminHref(query, { q }), true);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is recreated each render; the timer only needs the text and query
  }, [text, query]);

  return (
    <form
      role="search"
      action="/admin"
      method="get"
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        setSent(q);
        go(adminHref(query, { q }), false);
      }}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search by name or email</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-grey-500" />
        <input
          type="search"
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name or email"
          autoComplete="off"
          spellCheck={false}
          className={cn(field, "w-full pr-11 pl-11")}
        />
        {pending ? (
          <LoaderCircle
            aria-label="Searching"
            className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin text-grey-500"
          />
        ) : null}
      </label>
      <label className="flex items-center gap-2">
        <span className="text-sm font-bold text-grey-500">Role</span>
        <select
          name="role"
          value={query.role ?? ""}
          onChange={(e) => go(adminHref(query, { role: (e.target.value || null) as AdminQuery["role"] }), false)}
          className={cn(field, "min-w-36 px-3")}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_INFO[r].label}
            </option>
          ))}
        </select>
      </label>
      {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
      <noscript>
        <button type="submit" className="h-11 rounded-lg bg-grey-900 px-4 text-sm font-bold text-white">
          Search
        </button>
      </noscript>
    </form>
  );
}
