import type { Point } from "@/lib/canvas/geometry";
import { dropSlot, findCard, kanbanLayout, moveCard, newKanban, withoutCard } from "@/lib/canvas/kanban";
import type { CanvasElement, KanbanElement } from "@/lib/canvas/schema";
import type { CardTarget } from "./types";
import { clamp, newId, round1 } from "./util";

/*
 * To-do boards on the board: placing a new one, and where a dragged card
 * would land. Pure: the board does the dispatching.
 */

export function kanbanById(elements: readonly CanvasElement[], id: string): KanbanElement | null {
  const el = elements.find((e) => e.id === id);
  return el?.type === "kanban" ? el : null;
}

/** A new to-do board centred on `p`, sized to look the same at any zoom. */
export function newBoardAt(p: Point, z: number): KanbanElement {
  const scale = Math.round(clamp(1 / z, 0.05, 50) * 1000) / 1000;
  const draft = newKanban({ id: newId(), x: 0, y: 0, scale, ids: newId });
  const w = kanbanLayout(draft).w;
  return { ...draft, x: round1(p.x - w / 2), y: round1(p.y - 24 * scale) };
}

/** Where a dragged card would land if dropped at `p`: the topmost board under it (with a little slack). */
export function cardTargetAt(
  elements: readonly CanvasElement[],
  boardId: string,
  cardId: string,
  p: Point,
  z: number,
): CardTarget | null {
  const src = kanbanById(elements, boardId);
  if (!src || !findCard(src, cardId)) return null;
  const without = withoutCard(src, cardId);
  const slack = 16 / z;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type !== "kanban") continue;
    const b = el.id === src.id ? without : el;
    const l = kanbanLayout(b);
    if (p.x < l.x - slack || p.x > l.x + l.w + slack || p.y < l.y - slack || p.y > l.y + l.h + slack) continue;
    return { boardId: el.id, ...dropSlot(b, p) };
  }
  return null;
}

/** The boards as they'd be after dropping the card on `target`, or null if nothing would change. */
export function cardMoveResult(
  elements: readonly CanvasElement[],
  boardId: string,
  cardId: string,
  target: CardTarget | null,
): KanbanElement[] | null {
  if (!target) return null;
  const src = kanbanById(elements, boardId);
  const dst = kanbanById(elements, target.boardId);
  if (!src || !dst) return null;
  return moveCard(src, dst, { cardId, columnId: target.columnId, index: target.index });
}
