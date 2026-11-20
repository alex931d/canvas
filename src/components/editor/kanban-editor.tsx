"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import { Button } from "@/components/kit";
import {
  COLUMN_COLORS,
  findCard,
  moveCard,
  removeColumn,
  updateCard,
  updateColumn,
  withCard,
  withoutCard,
} from "@/lib/canvas/kanban";
import type { KanbanElement } from "@/lib/canvas/schema";
import { cn } from "@/lib/utils";

/**
 * The small editor that opens over a to-do board: a card's text (and which
 * column it's in), a column's name and colour, or the board's title.
 * Enter saves, Shift+Enter starts a new line in a card, Escape cancels.
 * Clicking elsewhere on the canvas saves too (through `commit`).
 */

export type KanbanEdit =
  | { mode: "card"; boardId: string; columnId: string; cardId: string | null }
  | { mode: "column"; boardId: string; columnId: string }
  | { mode: "title"; boardId: string };

export type KanbanEditorHandle = { commit: () => void };

const field =
  "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40";

export function KanbanEditor({
  edit,
  board,
  newCardId,
  style,
  onCommit,
  onClose,
  ref,
}: {
  edit: KanbanEdit;
  board: KanbanElement;
  /** Id for a card added from this editor. */
  newCardId: string;
  style: CSSProperties;
  /** The board after the edit (only called when something changed). */
  onCommit: (next: KanbanElement) => void;
  onClose: () => void;
  ref?: Ref<KanbanEditorHandle>;
}) {
  const column = "columnId" in edit ? board.columns.find((c) => c.id === edit.columnId) : undefined;
  const existing = edit.mode === "card" && edit.cardId ? findCard(board, edit.cardId) : null;

  const [text, setText] = useState(() =>
    edit.mode === "card" ? (existing?.card.text ?? "") : edit.mode === "column" ? (column?.title ?? "") : board.title,
  );
  const [columnId, setColumnId] = useState(edit.mode === "card" ? (existing?.column.id ?? edit.columnId) : "");
  const [color, setColor] = useState(column?.color ?? COLUMN_COLORS[0]);
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const done = useRef(false);

  // After the click that opened this has finished moving focus around.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Grow the card textarea with its text.
  useEffect(() => {
    const el = inputRef.current;
    if (edit.mode !== "card" || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text, edit.mode]);

  const close = (next: KanbanElement | null) => {
    if (done.current) return;
    done.current = true;
    if (next && JSON.stringify(next) !== JSON.stringify(board)) onCommit(next);
    onClose();
  };

  /** The board with this edit applied, or null when there's nothing to save. */
  const result = (): KanbanElement | null => {
    const value = text.trim();
    if (edit.mode === "title") return value ? { ...board, title: value.slice(0, 120) } : null;
    if (edit.mode === "column") {
      if (!column) return null;
      return updateColumn(board, column.id, { title: (value || column.title).slice(0, 60), color });
    }
    // A card.
    if (!existing) {
      if (!value) return null;
      const target = board.columns.find((c) => c.id === columnId) ?? column;
      if (!target || target.cards.length >= 100) return null;
      return withCard(board, target.id, target.cards.length, { id: newCardId, text: value.slice(0, 500) });
    }
    if (!value) return withoutCard(board, existing.card.id);
    let next = updateCard(board, existing.card.id, value.slice(0, 500));
    if (columnId !== existing.column.id) {
      const target = next.columns.find((c) => c.id === columnId);
      const moved = target ? moveCard(next, next, { cardId: existing.card.id, columnId, index: target.cards.length }) : null;
      if (moved) next = moved[0];
    }
    return next;
  };

  useImperativeHandle(ref, () => ({ commit: () => close(result()) }));

  const label =
    edit.mode === "title" ? "Board title" : edit.mode === "column" ? "Column" : existing ? "Edit card" : "New card";

  return (
    <div
      role="dialog"
      aria-label={label}
      className="absolute z-30 flex w-[min(320px,calc(100%-24px))] flex-col gap-3 rounded-xl border bg-card p-3 shadow-float"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        } else if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).matches("input, textarea")) {
          e.preventDefault();
          close(result());
        }
      }}
    >
      {edit.mode === "card" ? (
        <>
          <textarea
            ref={inputRef}
            aria-label="Card text"
            value={text}
            maxLength={500}
            rows={2}
            placeholder="What needs doing?"
            onChange={(e) => setText(e.target.value)}
            className={cn(field, "resize-none leading-snug")}
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Column</span>
            <select
              aria-label="Column"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <input
          ref={inputRef}
          aria-label={edit.mode === "title" ? "Board title" : "Column name"}
          value={text}
          maxLength={edit.mode === "title" ? 120 : 60}
          onChange={(e) => setText(e.target.value)}
          className={field}
        />
      )}

      {edit.mode === "column" ? (
        <div role="radiogroup" aria-label="Column colour" className="flex items-center gap-2">
          {COLUMN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "size-6 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring",
                color === c && "ring-2 ring-foreground",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {edit.mode === "card" && existing ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => close(withoutCard(board, existing.card.id))}
          >
            <Trash2 /> Delete
          </Button>
        ) : null}
        {edit.mode === "column" && column && board.columns.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => close(removeColumn(board, column.id))}
          >
            <Trash2 />
            {column.cards.length ? `Delete with ${column.cards.length} ${column.cards.length === 1 ? "card" : "cards"}` : "Delete column"}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => close(null)}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => close(result())} disabled={edit.mode !== "column" && !text.trim() && !existing}>
          {edit.mode === "card" && !existing ? "Add card" : "Save"}
        </Button>
      </div>
    </div>
  );
}
