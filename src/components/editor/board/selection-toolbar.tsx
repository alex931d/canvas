"use client";

import { Columns3, Copy, GalleryVerticalEnd, Lock, Pencil, Play, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/kit";
import type { AssetCache } from "@/lib/canvas/images";
import type { CanvasElement, KanbanElement } from "@/lib/canvas/schema";
import { MediaControls } from "../media-controls";

/**
 * The bar above (or below) what's selected: Check math and Flashcard for
 * anything, then what fits the one thing selected (present a frame, add a
 * column to a to-do board, edit a text, equation or graph, play a GIF or
 * video), then duplicate and delete. View-only: no changes offered.
 */
export function SelectionToolbar({
  position,
  selected,
  single,
  readOnly,
  images,
  onCheck,
  checkLocked = false,
  onFlashcard,
  onPresent,
  onRenameFrame,
  onAddColumn,
  onRenameBoard,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  position: { left: number; top: number };
  selected: readonly string[];
  /** The selected element, when there's exactly one. */
  single: CanvasElement | null;
  readOnly: boolean;
  images: AssetCache | null;
  onCheck: () => void;
  /** Part of the membership, which this person doesn't have: Check math offers it. */
  checkLocked?: boolean;
  onFlashcard?: () => void;
  onPresent?: (frameId: string) => void;
  onRenameFrame?: (frameId: string) => void;
  onAddColumn: (board: KanbanElement) => void;
  onRenameBoard: (board: KanbanElement) => void;
  onEdit: (el: CanvasElement) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const el = single;
  const editLabel =
    el?.type === "text" ? "Edit text" : el?.type === "math" ? "Edit equation" : el?.type === "graph" ? "Edit graph" : null;
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card p-1 shadow-float"
      style={position}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button size="sm" className="bg-green hover:bg-green/90" onClick={onCheck} data-locked={checkLocked || undefined}>
        <Sparkles /> Check math
        {checkLocked ? <Lock className="size-3.5 opacity-80" aria-label="Members" /> : null}
      </Button>
      {onFlashcard ? (
        <Button size="sm" variant="ghost" onClick={onFlashcard} title="Make a flashcard from this">
          <GalleryVerticalEnd /> Flashcard
        </Button>
      ) : null}

      {el?.type === "frame" ? (
        <>
          {onPresent ? (
            <Button size="sm" variant="ghost" onClick={() => onPresent(el.id)} title="Present from this slide">
              <Play /> Present
            </Button>
          ) : null}
          {onRenameFrame && !readOnly ? (
            <Button size="icon-sm" variant="ghost" aria-label="Rename slide" title="Rename slide" onClick={() => onRenameFrame(el.id)}>
              <Pencil />
            </Button>
          ) : null}
        </>
      ) : null}

      {!readOnly && el?.type === "kanban" ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={el.columns.length >= 6}
            title={el.columns.length >= 6 ? "Boards have up to 6 columns" : undefined}
            onClick={() => onAddColumn(el)}
          >
            <Columns3 /> Add column
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Rename board" title="Rename board" onClick={() => onRenameBoard(el)}>
            <Pencil />
          </Button>
        </>
      ) : null}

      {!readOnly && el && editLabel ? (
        <Button size="icon-sm" variant="ghost" aria-label={editLabel} title={editLabel} onClick={() => onEdit(el)}>
          <Pencil />
        </Button>
      ) : null}

      {images && (el?.type === "gif" || el?.type === "video") ? <MediaControls el={el} cache={images} /> : null}

      {selected.length > 0 && !readOnly ? (
        <>
          <Button size="icon-sm" variant="ghost" aria-label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Delete selection"
            className="hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </>
      ) : null}
    </div>
  );
}
