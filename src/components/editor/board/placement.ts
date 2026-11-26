import type { Rect } from "@/lib/canvas/geometry";
import { kanbanLayout } from "@/lib/canvas/kanban";
import { FONT_FAMILIES, TEXT_LINE_HEIGHT, type GraphElement, type KanbanElement } from "@/lib/canvas/schema";
import { measureText } from "@/lib/canvas/geometry";
import type { KanbanEdit } from "../kanban-editor";
import type { Style } from "../tools";
import type { Camera, Size } from "./camera";
import type { EquationEdit, TextEdit } from "./types";
import { clamp } from "./util";

/*
 * Where the board's floating editors and bars go on screen (CSS pixels in
 * the board): next to what they're about, kept inside the view.
 */

export type Spot = { left: number; top: number };

/** The selection bar: centred above the selection, or below it when there's no room. */
export function selectionToolbarSpot(box: Rect, cam: Camera, view: Size): Spot {
  const tl = cam.toScreen(box);
  const w = box.w * cam.z;
  const left = clamp(tl.x + w / 2, 140, view.w - 140);
  const above = tl.y - 56;
  const top = above > 8 ? above : Math.min(tl.y + box.h * cam.z + 12, view.h - 56);
  return { left, top };
}

/** Check math's card: to the right of the region, else to its left, else over it. */
export function mathCardSpot(region: Rect, cam: Camera, view: Size): Spot {
  const s = cam.toScreen(region);
  const sw = region.w * cam.z;
  const cardW = Math.min(352, view.w - 24);
  let left = s.x + sw + 16;
  if (left + cardW > view.w - 12) left = s.x - cardW - 16;
  if (left < 12) left = clamp(s.x + sw / 2 - cardW / 2, 12, view.w - cardW - 12);
  return { left, top: clamp(s.y, 12, Math.max(12, view.h - 420)) };
}

/** The equation editor: below the equation (or the click), else above it. */
export function equationEditorSpot(edit: EquationEdit, cam: Camera, view: Size): Spot {
  const ex = edit.existing;
  const anchor = cam.toScreen(ex ? { x: ex.x, y: ex.y + ex.h } : edit.at);
  const width = Math.min(400, view.w - 24);
  const left = clamp(anchor.x - 24, 12, Math.max(12, view.w - width - 12));
  const height = 330;
  const aboveY = (ex ? (ex.y - cam.y) * cam.z : anchor.y) - height - 16;
  const top =
    anchor.y + 16 + height <= view.h
      ? anchor.y + 16
      : aboveY >= 12
        ? aboveY
        : clamp(anchor.y + 16, 12, Math.max(12, view.h - height - 12));
  return { left, top };
}

/** The graph editor: to the right of the graph, else its left, else the view's right edge. */
export function graphEditorSpot(g: GraphElement, cam: Camera, view: Size): Spot {
  const width = Math.min(360, view.w - 24);
  const s = cam.toScreen(g);
  const gw = g.w * cam.z;
  let left = s.x + gw + 16;
  if (left + width > view.w - 12) left = s.x - width - 16;
  if (left < 12) left = view.w - width - 12;
  return { left: Math.max(12, left), top: clamp(s.y, 12, Math.max(12, view.h - 460)) };
}

/** A to-do board's editor, over what's being edited (its title, a column, a card or the add button). */
export function kanbanEditorSpot(board: KanbanElement, edit: KanbanEdit, cam: Camera, view: Size): Spot | null {
  const l = kanbanLayout(board);
  let anchor: Rect = l.title;
  if (edit.mode !== "title") {
    const col = l.columns.find((c) => c.column.id === edit.columnId);
    if (!col) return null;
    const card = edit.mode === "card" && edit.cardId ? col.cards.find((c) => c.card.id === edit.cardId) : null;
    anchor = edit.mode === "column" ? col.header : (card?.rect ?? col.add);
  }
  const width = Math.min(320, view.w - 24);
  const height = edit.mode === "card" ? 200 : edit.mode === "column" ? 160 : 112;
  const s = cam.toScreen(anchor);
  return {
    left: clamp(s.x - 8, 12, Math.max(12, view.w - width - 12)),
    top: clamp(s.y - 8, 12, Math.max(12, view.h - height - 12)),
  };
}

/** The text box over a text being typed: the same font, size and colour, growing with what's typed. */
export function textEditorStyle(editing: TextEdit, style: Style, cam: Camera) {
  const s = editing.existing ?? style;
  const fontSize = s.fontSize;
  const font = "font" in s ? s.font : style.font;
  const color = s.color;
  const m = measureText({ id: "measure", type: "text", x: 0, y: 0, text: editing.text || " ", color, fontSize, font });
  const at = cam.toScreen(editing);
  return {
    left: at.x,
    top: at.y,
    width: Math.max(m.w * cam.z + fontSize * cam.z, 40),
    height: m.h * cam.z + 4,
    fontSize: fontSize * cam.z,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: FONT_FAMILIES[font],
    color,
  };
}
