import type { CanvasElement } from "@/lib/canvas/schema";

/** Pen and eraser strokes split into a new element past this many coordinates (the schema's limit is 40,000). */
export const MAX_STROKE_COORDS = 39_998;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A seed for a sketchy shape's wobble. */
export const randomSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

/** Typing in a field: board shortcuts stay out of the way. */
export function isEditableTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true']");
}

/** The stroke eraser leaves these alone (delete them with the selection instead). */
export const UNERASABLE = new Set<CanvasElement["type"]>(["image", "gif", "video", "graph", "kanban", "eraser", "frame"]);

/** Corner drags keep these in proportion (Shift to stretch, or for a board: to change only its width). */
export const KEEP_ASPECT = new Set<CanvasElement["type"]>(["image", "gif", "video", "text", "kanban", "frame"]);
