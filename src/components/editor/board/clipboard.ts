import { translateElement } from "@/lib/canvas/geometry";
import type { CanvasElement } from "@/lib/canvas/schema";
import { newId, randomSeed } from "./util";

/** Copied elements on the system clipboard start with this, so a paste knows them from ordinary text. */
const MARKER = "canvas-elements:v1:";

/**
 * Copy and paste of things on the board. One for the whole tab (a
 * singleton), so what you copy in one drawing pastes into the next one you
 * open. Copies also go on the system clipboard as marked text, for pasting
 * in another tab; when the browser won't share the system clipboard, the
 * tab's own copy is used.
 */
export class BoardClipboard {
  static readonly shared = new BoardClipboard();

  private items: CanvasElement[] = [];

  private constructor() {}

  copy(elements: readonly CanvasElement[]) {
    this.items = structuredClone([...elements]);
    void navigator.clipboard?.writeText(MARKER + JSON.stringify(elements)).catch(() => {});
  }

  /**
   * What a paste with this text brings: copied elements, or null when it's
   * ordinary text (or nothing was copied).
   */
  read(text: string): CanvasElement[] | null {
    if (text.startsWith(MARKER)) {
      try {
        const els = JSON.parse(text.slice(MARKER.length));
        return Array.isArray(els) && els.length ? els : null;
      } catch {
        return null;
      }
    }
    return !text && this.items.length ? this.items : null;
  }
}

/** Copies of elements, moved by `offset`, with fresh ids (a to-do board's columns and cards too) and sketch seeds. */
export function cloneElements(els: readonly CanvasElement[], offset: number): CanvasElement[] {
  return els.map((el) => {
    const moved = translateElement(el, offset, offset);
    if (moved.type === "kanban") {
      // Fresh ids for the copy's columns and cards too, so moving cards between the two boards works.
      return {
        ...moved,
        id: newId(),
        columns: moved.columns.map((c) => ({ ...c, id: newId(), cards: c.cards.map((k) => ({ ...k, id: newId() })) })),
      };
    }
    return {
      ...moved,
      id: newId(),
      ...("sketch" in moved && moved.sketch ? { sketch: { ...moved.sketch, seed: randomSeed() } } : {}),
    } as CanvasElement;
  });
}
