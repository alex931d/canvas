import type { MathLayout, MathOp } from "./layout-types";

/**
 * Typeset equations, cached by their TeX source. Rendering is synchronous
 * (the canvas draws whatever is ready); MathJax itself loads on first use
 * and every finished layout notifies subscribers so the board repaints.
 */

export type MathEntry =
  | { status: "loading" }
  | { status: "ready"; layout: MathLayout }
  | { status: "error"; message: string };

type Engine = typeof import("./mathjax-engine");

const MAX_ENTRIES = 400;
const entries = new Map<string, MathEntry>();
const listeners = new Set<() => void>();
let engine: Promise<Engine> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function loadEngine(): Promise<Engine> {
  engine ??= import("./mathjax-engine").catch((err) => {
    engine = null; // let a later call try again (e.g. after going back online)
    throw err;
  });
  return engine;
}

/** MathJax's TeX errors aren't Error instances; get their message either way. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** The TeX that an equation element renders. */
export function texSource(el: { source: string; syntax: "tex" | "chem" }): string {
  return el.syntax === "chem" ? `\\ce{${el.source}}` : el.source;
}

/** Typeset (one at a time: MathJax keeps state while fonts load). Throws TeX errors. */
export function typesetMath(latex: string): Promise<MathLayout> {
  const run = async () => (await loadEngine()).typeset(latex);
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

function remember(latex: string, entry: MathEntry) {
  entries.delete(latex);
  entries.set(latex, entry);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** What's ready for this TeX right now; starts typesetting it if needed. */
export function mathEntry(latex: string): MathEntry {
  const hit = entries.get(latex);
  if (hit) return hit;
  remember(latex, { status: "loading" });
  typesetMath(latex).then(
    (layout) => remember(latex, { status: "ready", layout }),
    (err: unknown) => {
      const message = errorMessage(err);
      remember(latex, { status: "error", message });
      // A failed download (not a TeX error) gets another try later.
      if (/import|fetch|load|chunk/i.test(message)) setTimeout(() => entries.delete(latex), 10_000);
    },
  ).finally(() => listeners.forEach((l) => l()));
  return { status: "loading" };
}

export function subscribeMath(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const paths = new WeakMap<MathOp, Path2D>();

/** Draw a layout into the box (x, y, w, h); `color` replaces currentColor. */
export function drawMathLayout(
  ctx: CanvasRenderingContext2D,
  layout: MathLayout,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  if (layout.width <= 0 || layout.height <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / layout.width, h / layout.height);
  for (const op of layout.ops) {
    const fill = op.fill === null ? color : op.fill;
    const stroke = op.stroke === null ? color : op.stroke;
    ctx.save();
    ctx.transform(...op.m);
    switch (op.t) {
      case "path": {
        let p = paths.get(op);
        if (!p) {
          p = new Path2D(op.d);
          paths.set(op, p);
        }
        if (fill !== "none") {
          ctx.fillStyle = fill;
          ctx.fill(p);
        }
        if (op.strokeWidth > 0 && stroke !== "none") {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = op.strokeWidth;
          ctx.stroke(p);
        }
        break;
      }
      case "rect":
        if (fill !== "none") {
          ctx.fillStyle = fill;
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        if (op.strokeWidth > 0 && stroke !== "none") {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = op.strokeWidth;
          ctx.strokeRect(op.x, op.y, op.w, op.h);
        }
        break;
      case "line":
        if (stroke !== "none") {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = op.strokeWidth || 60;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
        }
        break;
      case "text":
        if (fill !== "none") {
          ctx.fillStyle = fill;
          ctx.font = `${op.style} ${op.weight} ${op.size}px ${op.family}`;
          ctx.fillText(op.text, op.x, op.y);
        }
        break;
    }
    ctx.restore();
  }
  ctx.restore();
}
