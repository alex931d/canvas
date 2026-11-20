import { animate, type ValueAnimationTransition } from "motion";
import type { DrawEffect } from "@/lib/preferences";
import { elementBounds, rectsIntersect, type Rect } from "./geometry";
import type { FxState } from "./render";
import type { CanvasElement } from "./schema";

/**
 * Drawing effects on the canvas (the "Drawing effects" setting): elements
 * fading, popping or tracing themselves in when they arrive, and leaving the
 * same way. Motion (motion.dev, formerly Framer Motion) drives the numbers;
 * the board reads the current state of each element while it paints.
 *
 * Only what's in view animates, and a big batch (opening a large drawing,
 * clearing the board) just appears or goes, so effects never slow work down.
 */

/** More than this many elements in view at once: no effect, it would only be a wait. */
export const MAX_ANIMATED = 240;

/** Opening a drawing: the whole replay fits in about this many seconds. */
const OPEN_BUDGET = { fade: 0.5, pop: 0.6, trace: 1.1 } as const;

type Running = {
  el: CanvasElement;
  state: FxState;
  leaving: boolean;
  stop: () => void;
};

/** Rough length of what an element draws, in world units (how long a trace takes). */
export function inkLength(el: CanvasElement): number {
  switch (el.type) {
    case "stroke":
    case "eraser": {
      let len = 0;
      for (let i = 2; i < el.points.length; i += 2) {
        len += Math.hypot(el.points[i] - el.points[i - 2], el.points[i + 1] - el.points[i - 1]);
      }
      return len;
    }
    case "line":
      return Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
    case "rect":
    case "ellipse":
      return 2 * (Math.abs(el.w) + Math.abs(el.h));
    default:
      return elementBounds(el).w;
  }
}

/** Seconds a trace of this element takes at this zoom: longer lines take a little longer. */
export function traceDuration(el: CanvasElement, zoom: number): number {
  return Math.min(1, Math.max(0.3, 0.25 + (inkLength(el) * zoom) / 1600));
}

/** Delay between elements when several arrive together, so the whole batch fits `budget` seconds. */
export function staggerStep(count: number, budget: number, max = 0.06): number {
  return count <= 1 ? 0 : Math.min(max, budget / count);
}

export class ElementEffects {
  private running = new Map<string, Running>();
  /** True until a newly opened drawing's replay starts: everything waits, hidden. */
  private holding = false;
  private holdState: FxState = { kind: "fade", t: 0 };

  constructor(
    private effect: DrawEffect,
    private onFrame: () => void,
  ) {
    if (effect !== "off") {
      this.holding = true;
      this.holdState = { kind: effect, t: 0 };
    }
  }

  get enabled() {
    return this.effect !== "off";
  }

  setEffect(effect: DrawEffect) {
    if (effect === this.effect) return;
    this.effect = effect;
    if (effect === "off") this.finishAll();
  }

  /** How an element in the scene is drawn right now; undefined when it's settled. */
  stateOf = (el: CanvasElement): FxState | undefined => {
    const r = this.running.get(el.id);
    if (r && !r.leaving) return r.state;
    if (this.holding && el.type !== "eraser") return this.holdState;
    return undefined;
  };

  /** Elements that have left the drawing but are still animating out. */
  *ghosts(): Iterable<{ el: CanvasElement; state: FxState }> {
    for (const r of this.running.values()) if (r.leaving) yield r;
  }

  isLeaving(id: string) {
    return this.running.get(id)?.leaving ?? false;
  }

  get busy() {
    return this.running.size > 0 || this.holding;
  }

  /**
   * A drawing just opened: replay what's in view in drawing order, all within
   * about a second. Ends the hold either way.
   */
  open(elements: readonly CanvasElement[], view: Rect, zoom: number) {
    this.holding = false;
    if (this.effect === "off") return this.onFrame();
    const shown = elements.filter((el) => el.type !== "eraser" && rectsIntersect(elementBounds(el), view));
    if (shown.length === 0 || shown.length > MAX_ANIMATED) return this.onFrame();
    const step = staggerStep(shown.length, OPEN_BUDGET[this.effect]);
    shown.forEach((el, i) => this.enter(el, zoom, i * step));
  }

  /** Several elements arrived together (someone else drew, paste, undo, an inserted picture). */
  enterMany(elements: readonly CanvasElement[], view: Rect, zoom: number) {
    if (this.effect === "off") return;
    const shown = elements.filter((el) => el.type !== "eraser" && rectsIntersect(elementBounds(el), view));
    if (shown.length > MAX_ANIMATED) return;
    const step = staggerStep(shown.length, 0.35, 0.03);
    shown.forEach((el, i) => this.enter(el, zoom, i * step));
  }

  /** Several elements left together (erased, deleted, undone, removed by someone else). */
  leaveMany(elements: readonly CanvasElement[], view: Rect) {
    if (this.effect === "off") return;
    const shown = elements.filter(
      (el) => el.type !== "eraser" && !this.isLeaving(el.id) && rectsIntersect(elementBounds(el), view),
    );
    if (shown.length > MAX_ANIMATED) return;
    for (const el of shown) this.leave(el);
  }

  enter(el: CanvasElement, zoom: number, delay = 0) {
    if (this.effect === "off" || el.type === "eraser") return;
    this.stop(el.id);
    const kind = this.effect;
    const state: FxState = { kind, t: 0 };
    const transition =
      kind === "pop"
        ? ({ type: "spring", stiffness: 420, damping: 24, mass: 0.9 } as const)
        : kind === "fade"
          ? ({ duration: 0.28, ease: "easeOut" } as const)
          : ({ duration: traceDuration(el, zoom), ease: [0.45, 0, 0.25, 1] } as const);
    this.run(el, state, false, 0, 1, { ...transition, delay });
  }

  leave(el: CanvasElement) {
    if (this.effect === "off" || el.type === "eraser") return;
    this.stop(el.id);
    // A trace doesn't run backwards well; it fades out instead.
    const state: FxState = { kind: this.effect === "pop" ? "pop" : "fade", t: 1 };
    this.run(el, state, true, 1, 0, { duration: this.effect === "pop" ? 0.18 : 0.2, ease: "easeIn" });
  }

  /** Stop waiting for the opening replay (the board never got a size to replay in). */
  release() {
    if (!this.holding) return;
    this.holding = false;
    this.onFrame();
  }

  /** Jump everything to its end state (before the board takes a snapshot to draw over). */
  finishAll() {
    const any = this.running.size > 0 || this.holding;
    this.holding = false;
    for (const r of this.running.values()) r.stop();
    this.running.clear();
    if (any) this.onFrame();
  }

  dispose() {
    for (const r of this.running.values()) r.stop();
    this.running.clear();
    this.holding = false;
  }

  private stop(id: string) {
    const r = this.running.get(id);
    if (!r) return;
    r.stop();
    this.running.delete(id);
  }

  private run(
    el: CanvasElement,
    state: FxState,
    leaving: boolean,
    from: number,
    to: number,
    transition: ValueAnimationTransition<number>,
  ) {
    const entry: Running = { el, state, leaving, stop: () => {} };
    this.running.set(el.id, entry);
    const finish = () => {
      if (this.running.get(el.id) !== entry) return;
      this.running.delete(el.id);
      this.onFrame();
    };
    const controls = animate(from, to, {
      ...transition,
      onUpdate: (v: number) => {
        state.t = v;
        this.onFrame();
      },
      onComplete: finish,
    });
    entry.stop = () => controls.stop();
    this.onFrame();
  }
}
