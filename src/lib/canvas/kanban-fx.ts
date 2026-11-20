import { animate } from "motion";
import { kanbanLayout } from "./kanban";
import type { CardFx, KanbanFxView } from "./kanban-render";
import type { CanvasElement, KanbanElement } from "./schema";

/**
 * To-do board animations (the "To-do boards" setting), driven by Motion:
 * when a board changes, each card glides from where it was drawn to its new
 * slot (from where you let go, after a drag), new cards pop in, the progress
 * bar slides, and a card that reaches the last column gets its line drawn
 * through as you watch.
 */

type Point = { x: number; y: number };

type CardAnim = {
  /** Offset from the card's slot right now. */
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  strike: number;
  stops: (() => void)[];
};

const GLIDE = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 } as const;
const APPEAR = { type: "spring", stiffness: 460, damping: 26 } as const;

const key = (boardId: string, cardId: string) => `${boardId}:${cardId}`;

/** Where each card's slot is (top-left), and which cards are in the last column. */
function slots(el: KanbanElement) {
  const at = new Map<string, Point>();
  const done = new Set<string>();
  const layout = kanbanLayout(el);
  const last = el.columns.length - 1;
  layout.columns.forEach((col, i) => {
    for (const c of col.cards) {
      at.set(c.card.id, { x: c.rect.x, y: c.rect.y });
      if (i === last && last > 0) done.add(c.card.id);
    }
  });
  return { at, done };
}

const doneShare = (el: KanbanElement) => {
  const total = el.columns.reduce((n, c) => n + c.cards.length, 0);
  const done = el.columns.length > 1 ? el.columns[el.columns.length - 1].cards.length : 0;
  return total === 0 ? 0 : done / total;
};

export class KanbanEffects implements KanbanFxView {
  private cards = new Map<string, CardAnim>();
  private bars = new Map<string, { value: number; stop: () => void }>();
  /** Where a dragged card was let go (its top-left), so it glides from there. */
  private drops = new Map<string, Point>();
  /**
   * Boards as they looked during a drag (the slot already open where the
   * card lands): the next change starts from that, so only the card moves.
   */
  private shown = new Map<string, { board: KanbanElement; at: number }>();

  constructor(
    private enabled: boolean,
    private onFrame: () => void,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.dispose();
  }

  card(boardId: string, cardId: string): CardFx | undefined {
    return this.cards.get(key(boardId, cardId));
  }

  progress(boardId: string): number | undefined {
    return this.bars.get(boardId)?.value;
  }

  get busy() {
    return this.cards.size > 0 || this.bars.size > 0;
  }

  /**
   * A card was dropped with its top-left here, onto boards that already show
   * where it lands (`shown`): the next change glides just that card from there.
   */
  noteDrop(boardId: string, cardId: string, topLeft: Point, shown: readonly CanvasElement[] = []) {
    if (!this.enabled) return;
    this.drops.set(key(boardId, cardId), topLeft);
    const at = Date.now();
    for (const el of shown) if (el.type === "kanban") this.shown.set(el.id, { board: el, at });
  }

  /** A board changed from `before` to `after`: start the animations that show what moved. */
  change(committed: KanbanElement, after: KanbanElement) {
    if (!this.enabled) return;
    const preview = this.shown.get(after.id);
    this.shown.delete(after.id);
    const before = preview && Date.now() - preview.at < 2000 ? preview.board : committed;
    const share0 = this.bars.get(before.id)?.value ?? doneShare(before);
    const share1 = doneShare(after);
    if (Math.abs(share1 - share0) > 0.001) this.slideBar(after.id, share0, share1);
    // Resized: every card changes size, so let the new layout show at once.
    if (before.scale !== after.scale || before.w !== after.w) return;
    // Moved as a whole: cards come along with the board, not after it.
    const shiftX = after.x - before.x;
    const shiftY = after.y - before.y;
    const a = slots(before);
    const b = slots(after);
    // "Finished" compares with the saved board: a drag preview shows the slot, not the card.
    const wasDone = before === committed ? a.done : slots(committed).done;
    let i = 0;
    for (const [cardId, to] of b.at) {
      const k = key(after.id, cardId);
      const running = this.cards.get(k);
      const dropped = this.drops.get(k);
      this.drops.delete(k);
      const fromSlot = a.at.get(cardId);
      if (!fromSlot && !dropped) {
        this.appear(k, i++ * 0.03);
        continue;
      }
      // Where it's drawn right now: its old slot plus any offset it still had, or where it was let go.
      const from = dropped ?? {
        x: fromSlot!.x + shiftX + (running?.dx ?? 0),
        y: fromSlot!.y + shiftY + (running?.dy ?? 0),
      };
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const finished = b.done.has(cardId) && !wasDone.has(cardId);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !finished) continue;
      this.glide(k, dx, dy, finished);
    }
  }

  dispose() {
    for (const c of this.cards.values()) for (const stop of c.stops) stop();
    for (const b of this.bars.values()) b.stop();
    this.cards.clear();
    this.bars.clear();
    this.drops.clear();
    this.shown.clear();
  }

  private take(k: string): CardAnim {
    const old = this.cards.get(k);
    if (old) for (const stop of old.stops) stop();
    const anim: CardAnim = { dx: 0, dy: 0, scale: 1, alpha: 1, strike: 1, stops: [] };
    this.cards.set(k, anim);
    return anim;
  }

  /** Remove the card's entry once none of its animations are still running. */
  private settle(k: string, anim: CardAnim, pending: { n: number }) {
    pending.n -= 1;
    if (pending.n > 0 || this.cards.get(k) !== anim) return;
    this.cards.delete(k);
    this.onFrame();
  }

  private glide(k: string, dx: number, dy: number, finished: boolean) {
    const anim = this.take(k);
    anim.dx = dx;
    anim.dy = dy;
    const pending = { n: finished ? 2 : 1 };
    const glide = animate(1, 0, {
      ...GLIDE,
      onUpdate: (v: number) => {
        anim.dx = dx * v;
        anim.dy = dy * v;
        this.onFrame();
      },
      onComplete: () => this.settle(k, anim, pending),
    });
    anim.stops.push(() => glide.stop());
    if (finished) {
      anim.strike = 0;
      const strike = animate(0, 1, {
        duration: 0.4,
        delay: 0.18,
        ease: [0.3, 0, 0.2, 1],
        onUpdate: (v: number) => {
          anim.strike = v;
          this.onFrame();
        },
        onComplete: () => this.settle(k, anim, pending),
      });
      anim.stops.push(() => strike.stop());
    }
    this.onFrame();
  }

  private appear(k: string, delay: number) {
    const anim = this.take(k);
    anim.scale = 0.9;
    anim.alpha = 0;
    const pending = { n: 1 };
    const pop = animate(0, 1, {
      ...APPEAR,
      delay,
      onUpdate: (v: number) => {
        anim.scale = 0.9 + 0.1 * v;
        anim.alpha = Math.min(1, v * 1.5);
        this.onFrame();
      },
      onComplete: () => this.settle(k, anim, pending),
    });
    anim.stops.push(() => pop.stop());
    this.onFrame();
  }

  private slideBar(boardId: string, from: number, to: number) {
    this.bars.get(boardId)?.stop();
    const bar = { value: from, stop: () => {} };
    this.bars.set(boardId, bar);
    const controls = animate(from, to, {
      duration: 0.45,
      ease: [0.3, 0, 0.2, 1],
      onUpdate: (v: number) => {
        bar.value = v;
        this.onFrame();
      },
      onComplete: () => {
        if (this.bars.get(boardId) === bar) this.bars.delete(boardId);
        this.onFrame();
      },
    });
    bar.stop = () => controls.stop();
  }
}
