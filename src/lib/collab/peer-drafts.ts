import type { CanvasElement } from "@/lib/canvas/schema";

/*
 * Strokes and shapes while they're being drawn, shared live: the person
 * drawing sends what's new with their presence (src/lib/collab/sync-client.ts),
 * and everyone else draws it as it grows. Pen strokes and pixel erasers are
 * sent in pieces (only the points since the last piece); shapes whole, as
 * they're small. When the pointer lifts, the finished element arrives the
 * usual way, through the drawing's changes, with the same id.
 */

/** One piece of someone's draft: the element, with only the points from `from` on (a coordinate index). */
export type DraftPiece = { from: number; el: CanvasElement };

/** A draft nobody has added to for this long is dropped (its tab closed mid-stroke). */
const STALE_MS = 30_000;

/** Most coordinates in one piece, so a presence message stays well under the realtime bus's 8 kB. */
export const MAX_PIECE_COORDS = 600;

const freehand = (el: CanvasElement): el is Extract<CanvasElement, { type: "stroke" | "eraser" }> =>
  el.type === "stroke" || el.type === "eraser";

/**
 * The sending side: given this tab's draft as it is now, what to send next.
 * `undefined` means nothing new; `null` that the draft ended.
 */
export class DraftOutbox {
  private sent: { id: string; len: number; key: string | null } | null = null;
  private current: CanvasElement | null = null;

  /** The draft right now (changed in place while drawing), or null when not drawing. */
  set(draft: CanvasElement | null) {
    this.current = draft;
  }

  /** Something is waiting to go out. */
  get pending() {
    return this.peek() !== undefined;
  }

  /** The next piece to send (and note it as sent). */
  take(): DraftPiece | null | undefined {
    const next = this.peek();
    if (next === undefined) return undefined;
    if (next === null) {
      this.sent = null;
      return null;
    }
    const el = this.current!;
    if (freehand(el)) {
      const to = Math.min(el.points.length, next.from + MAX_PIECE_COORDS);
      this.sent = { id: el.id, len: to, key: null };
      const piece = { ...el, points: el.points.slice(next.from, to) } as CanvasElement;
      if (piece.type === "stroke" && el.type === "stroke" && el.pressures) {
        piece.pressures = el.pressures.slice(next.from / 2, to / 2);
      }
      return { from: next.from, el: piece };
    }
    const key = JSON.stringify(el);
    this.sent = { id: el.id, len: 0, key };
    return { from: 0, el: { ...el } };
  }

  private peek(): { from: number } | null | undefined {
    const el = this.current;
    if (!el) return this.sent ? null : undefined;
    const same = this.sent?.id === el.id;
    if (freehand(el)) {
      const from = same ? this.sent!.len : 0;
      return from < el.points.length ? { from } : undefined;
    }
    return same && this.sent!.key === JSON.stringify(el) ? undefined : { from: 0 };
  }
}

/**
 * The receiving side: everyone else's drafts, put back together from their
 * pieces. A piece that doesn't follow on from what arrived (one went
 * missing) is ignored; the finished element still arrives with the changes.
 */
export class PeerDrafts {
  private readonly drafts = new Map<string, { el: CanvasElement; endedAt: number | null; at: number }>();

  /** Apply what one tab sent: a piece, null (they lifted the pointer), or nothing. Returns their draft now. */
  apply(clientId: string, piece: DraftPiece | null | undefined, now = Date.now()): CanvasElement | null {
    const had = this.drafts.get(clientId);
    if (piece === undefined) return had?.el ?? null;
    if (piece === null) {
      // Kept a moment, until the finished element arrives in its place.
      if (had && had.endedAt === null) had.endedAt = now;
      return had?.el ?? null;
    }
    const el = piece.el;
    if (!freehand(el) || piece.from === 0) {
      this.drafts.set(clientId, { el, endedAt: null, at: now });
      return el;
    }
    const prev = had?.el;
    if (!prev || prev.id !== el.id || !freehand(prev) || prev.points.length !== piece.from) return prev ?? null;
    const joined = { ...prev, points: prev.points.concat(el.points) } as CanvasElement;
    if (joined.type === "stroke" && prev.type === "stroke" && el.type === "stroke" && prev.pressures && el.pressures) {
      joined.pressures = prev.pressures.concat(el.pressures);
    }
    this.drafts.set(clientId, { el: joined, endedAt: null, at: now });
    return joined;
  }

  forget(clientId: string) {
    this.drafts.delete(clientId);
  }

  /**
   * Drafts to draw now: not ones whose finished element has arrived
   * (`landed`), nor ones that ended over `grace` ms ago, nor ones nothing has
   * been heard of for `STALE_MS` (whoever drew it went away mid-stroke).
   */
  visible(landed: (id: string) => boolean, now = Date.now(), grace = 1500): CanvasElement[] {
    const out: CanvasElement[] = [];
    for (const [clientId, d] of this.drafts) {
      const ended = d.endedAt !== null && now - d.endedAt > grace;
      if (landed(d.el.id) || ended || now - d.at > STALE_MS) {
        this.drafts.delete(clientId);
        continue;
      }
      out.push(d.el);
    }
    return out;
  }
}
