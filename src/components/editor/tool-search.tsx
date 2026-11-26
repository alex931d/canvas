"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { Dialog, DialogContent, Kbd } from "@/components/kit";
import { cn } from "@/lib/utils";

/** Something the search can find: a tool, a thing to insert, or an editor command. */
export type SearchItem = {
  id: string;
  label: string;
  /** What it's for, in a few words; searched too. */
  hint?: string;
  /** Other words people might type for it. */
  words?: string;
  shortcut?: string;
  Icon: ComponentType<{ className?: string }>;
  run: () => void;
};

/** How well `query` matches: words starting with it count most, then anywhere. 0 = not at all. */
function score(item: SearchItem, query: string) {
  if (!query) return 1;
  const label = item.label.toLowerCase();
  const rest = `${item.hint ?? ""} ${item.words ?? ""}`.toLowerCase();
  if (label.startsWith(query)) return 4;
  if (label.split(/\s+/).some((w) => w.startsWith(query))) return 3;
  if (label.includes(query)) return 2;
  if (rest.split(/\s+/).some((w) => w.startsWith(query))) return 1.5;
  return rest.includes(query) ? 1 : 0;
}

/**
 * Find any tool or command by typing part of its name (/ or ⌘K on the
 * board): ↑ ↓ to choose, Enter to use it. Quicker than any menu once the
 * list of tools grows.
 */
export function ToolSearch({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SearchItem[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      items
        .map((item, i) => ({ item, s: score(item, q), i }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((r) => r.item),
    [items, q],
  );
  const current = Math.min(index, Math.max(0, results.length - 1));

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setIndex(0);
    }
  };
  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    close(false);
    // After the dialog has gone, so focus and keys go back to the board first.
    requestAnimationFrame(item.run);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Find a tool" titleHidden size="md" className="gap-0 p-0 sm:p-0" data-testid="tool-search">
        <label className="flex items-center gap-3 border-b px-5 py-4">
          <Search className="size-5 shrink-0 text-grey-500" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((current + 1) % Math.max(1, results.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((current - 1 + results.length) % Math.max(1, results.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[current]);
              }
            }}
            placeholder="Find a tool or command…"
            aria-label="Find a tool or command"
            aria-controls="tool-search-results"
            aria-activedescendant={results[current] ? `tool-search-${results[current].id}` : undefined}
            role="combobox"
            aria-expanded
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-grey-500"
          />
        </label>
        <ul id="tool-search-results" role="listbox" aria-label="Results" className="max-h-[min(420px,60dvh)] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-grey-500">Nothing called “{query.trim()}”. Try a shorter word.</li>
          ) : (
            results.map((item, i) => (
              <li
                key={item.id}
                id={`tool-search-${item.id}`}
                role="option"
                aria-selected={i === current}
                data-testid="tool-search-option"
                onPointerMove={() => i !== current && setIndex(i)}
                onClick={() => choose(item)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
                  i === current ? "bg-beige-100" : "hover:bg-beige-100/60",
                )}
              >
                <item.Icon className={cn("size-5 shrink-0", i === current ? "text-green" : "text-grey-500")} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.label}</span>
                  {item.hint ? <span className="block truncate text-xs text-grey-500">{item.hint}</span> : null}
                </span>
                {item.shortcut ? <Kbd className="uppercase">{item.shortcut}</Kbd> : null}
                {i === current ? <CornerDownLeft className="size-4 text-grey-500" aria-hidden /> : null}
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
