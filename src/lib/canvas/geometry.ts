import { kanbanLayout, kanbanMinWidth, resetKanbanLayouts } from "./kanban";
import {
  FONT_FAMILIES,
  TEXT_LINE_HEIGHT,
  type CanvasElement,
  type FrameElement,
  type TextElement,
} from "./schema";

/** World-space geometry: bounds, hit-testing, lasso tests and transforms. */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function normalizeRect(x: number, y: number, w: number, h: number): Rect {
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeRect(a.x, a.y, b.x - a.x, b.y - a.y);
}

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContainsRect(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function pointInRect(p: Point, r: Rect) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function pointInPolygon(p: Point, poly: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonBounds(poly: readonly Point[]): Rect | null {
  return unionRects(poly.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
}

function distToSegmentSq(p: Point, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((p.x - ax) * dx + (p.y - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - p.x;
  const y = ay + t * dy - p.y;
  return x * x + y * y;
}

// ------------------------------------------------------------ text metrics

let measureCtx: CanvasRenderingContext2D | null = null;
let textCache = new WeakMap<TextElement, { w: number; h: number; lines: string[] }>();

/** Call after web fonts finish loading so text is re-measured. */
export function resetTextMetrics() {
  textCache = new WeakMap();
  boundsCache = new WeakMap();
  resetKanbanLayouts();
}

export function measureText(el: TextElement) {
  const cached = textCache.get(el);
  if (cached) return cached;
  const lines = el.text.split("\n");
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  let w = 0;
  if (measureCtx) {
    measureCtx.font = `${el.fontSize}px ${FONT_FAMILIES[el.font]}`;
    for (const line of lines) w = Math.max(w, measureCtx.measureText(line).width);
  } else {
    w = Math.max(...lines.map((l) => l.length)) * el.fontSize * 0.55;
  }
  const m = { w: Math.max(w, el.fontSize * 0.5), h: lines.length * el.fontSize * TEXT_LINE_HEIGHT, lines };
  textCache.set(el, m);
  return m;
}

// ------------------------------------------------------------ bounds

let boundsCache = new WeakMap<CanvasElement, Rect>();

function pointsBounds(points: readonly number[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Geometric box without stroke width (what resize handles act on). */
export function elementBox(el: CanvasElement): Rect {
  switch (el.type) {
    case "stroke":
    case "eraser":
      return pointsBounds(el.points);
    case "line":
      return rectFromPoints({ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 });
    case "rect":
    case "ellipse":
      return normalizeRect(el.x, el.y, el.w, el.h);
    case "text": {
      const m = measureText(el);
      return { x: el.x, y: el.y, w: m.w, h: m.h };
    }
    case "image":
    case "gif":
    case "video":
    case "math":
    case "graph":
    case "frame":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "kanban": {
      const l = kanbanLayout(el);
      return { x: el.x, y: el.y, w: l.w, h: l.h };
    }
  }
}

/** Elements drawn as a box: no stroke width around them. */
const BOXED = new Set<CanvasElement["type"]>(["text", "image", "gif", "video", "math", "graph", "kanban", "frame"]);
type Boxed = Extract<CanvasElement, { type: "text" | "image" | "gif" | "video" | "math" | "graph" | "kanban" | "frame" }>;
const isBoxed = (el: CanvasElement): el is Boxed => BOXED.has(el.type);

/** Visual bounds including stroke width; used for culling and selection. */
export function elementBounds(el: CanvasElement): Rect {
  const cached = boundsCache.get(el);
  if (cached) return cached;
  const box = elementBox(el);
  const pad = isBoxed(el)
      ? 0
      : el.type === "line" && el.arrow
        ? el.size * 2 + 12
        : el.size / 2 + (("sketch" in el && el.sketch) ? el.size + 4 : 1);
  const r = padRect(box, pad);
  boundsCache.set(el, r);
  return r;
}

export function contentBounds(elements: readonly CanvasElement[]): Rect | null {
  return unionRects(elements.filter((e) => e.type !== "eraser").map(elementBounds));
}

// ------------------------------------------------------------ hit testing

/** Is world point `p` on the element, within `tol` world units? */
export function hitTest(el: CanvasElement, p: Point, tol: number): boolean {
  const b = elementBounds(el);
  if (!pointInRect(p, padRect(b, tol))) return false;

  switch (el.type) {
    case "eraser":
      return false;
    case "stroke": {
      const r = el.size / 2 + tol;
      const pts = el.points;
      if (pts.length === 2) return (pts[0] - p.x) ** 2 + (pts[1] - p.y) ** 2 <= r * r;
      for (let i = 2; i < pts.length; i += 2) {
        if (distToSegmentSq(p, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]) <= r * r) return true;
      }
      return false;
    }
    case "line": {
      const r = el.size / 2 + tol;
      return distToSegmentSq(p, el.x1, el.y1, el.x2, el.y2) <= r * r;
    }
    case "rect": {
      const r = normalizeRect(el.x, el.y, el.w, el.h);
      if (el.fill) return pointInRect(p, padRect(r, tol));
      const e = el.size / 2 + tol;
      return pointInRect(p, padRect(r, e)) && !pointInRect(p, padRect(r, -e));
    }
    case "ellipse": {
      const r = normalizeRect(el.x, el.y, el.w, el.h);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rx = Math.max(r.w / 2, 0.5);
      const ry = Math.max(r.h / 2, 0.5);
      const d = Math.sqrt(((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2);
      if (el.fill) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= el.size / 2 + tol;
    }
    case "text":
    case "image":
    case "gif":
    case "video":
    case "math":
    case "graph":
    case "kanban":
      return pointInRect(p, padRect(elementBox(el), tol));
    case "frame": {
      // Only its edge: what's drawn inside a frame stays clickable. (Its title is hit in the board.)
      const r = elementBox(el);
      return pointInRect(p, padRect(r, tol)) && !pointInRect(p, padRect(r, -tol));
    }
  }
}

/** The frames' slides in order (lowest `order` first; ties by position on the canvas). */
export function slidesOf(elements: readonly CanvasElement[]): FrameElement[] {
  return elements
    .filter((e): e is FrameElement => e.type === "frame")
    .sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
}

/** What a frame carries along when it moves: everything (frames too) wholly inside it. */
export function insideFrame(elements: readonly CanvasElement[], frame: FrameElement): CanvasElement[] {
  const box = elementBox(frame);
  return elements.filter((e) => e.id !== frame.id && e.type !== "eraser" && rectContainsRect(box, elementBounds(e)));
}

/** Topmost element under the point (last drawn wins). */
export function hitTestAll(
  elements: readonly CanvasElement[],
  p: Point,
  tol: number,
): CanvasElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTest(elements[i], p, tol)) return elements[i];
  }
  return null;
}

/** Does a stroke passing through `p` with radius `r` touch the element? (stroke eraser) */
export function touches(el: CanvasElement, p: Point, r: number) {
  return hitTest(el, p, r);
}

// ------------------------------------------------------------ lasso

function samplePoints(el: CanvasElement): Point[] {
  switch (el.type) {
    case "stroke":
    case "eraser": {
      const out: Point[] = [];
      const step = Math.max(2, Math.floor(el.points.length / 2 / 24) * 2);
      for (let i = 0; i < el.points.length; i += step) out.push({ x: el.points[i], y: el.points[i + 1] });
      return out;
    }
    case "line":
      return [
        { x: el.x1, y: el.y1 },
        { x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 },
        { x: el.x2, y: el.y2 },
      ];
    default: {
      const b = elementBox(el);
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ];
    }
  }
}

/** Mostly inside the lasso (≥ 60 % of sample points). */
export function insidePolygon(el: CanvasElement, poly: readonly Point[]) {
  const pts = samplePoints(el);
  const inside = pts.filter((p) => pointInPolygon(p, poly)).length;
  return inside / pts.length >= 0.6;
}

// ------------------------------------------------------------ transforms

const r1 = (v: number) => Math.round(v * 10) / 10;

export function translateElement<T extends CanvasElement>(el: T, dx: number, dy: number): T {
  switch (el.type) {
    case "stroke":
    case "eraser":
      return { ...el, points: el.points.map((v, i) => r1(v + (i % 2 === 0 ? dx : dy))) };
    case "line":
      return { ...el, x1: r1(el.x1 + dx), y1: r1(el.y1 + dy), x2: r1(el.x2 + dx), y2: r1(el.y2 + dy) };
    default:
      return { ...el, x: r1((el as { x: number }).x + dx), y: r1((el as { y: number }).y + dy) };
  }
}

/** Map an element from box `from` to box `to` (resize). */
export function scaleElement<T extends CanvasElement>(el: T, from: Rect, to: Rect): T {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mx = (x: number) => r1(to.x + (x - from.x) * sx);
  const my = (y: number) => r1(to.y + (y - from.y) * sy);
  switch (el.type) {
    case "stroke":
    case "eraser":
      return { ...el, points: el.points.map((v, i) => (i % 2 === 0 ? mx(v) : my(v))) };
    case "line":
      return { ...el, x1: mx(el.x1), y1: my(el.y1), x2: mx(el.x2), y2: my(el.y2) };
    case "rect":
    case "ellipse": {
      const r = normalizeRect(el.x, el.y, el.w, el.h);
      return { ...el, x: mx(r.x), y: my(r.y), w: r1(r.w * sx), h: r1(r.h * sy) };
    }
    case "image":
    case "gif":
    case "video":
    case "frame":
      return { ...el, x: mx(el.x), y: my(el.y), w: Math.max(1, r1(el.w * sx)), h: Math.max(1, r1(el.h * sy)) };
    case "kanban": {
      // Corner drags scale the whole board; with Shift (sx ≠ sy) only the
      // width changes and the cards re-wrap.
      const uniform = Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-6;
      const scale = uniform ? Math.max(0.05, Math.min(50, el.scale * Math.abs(sx))) : el.scale;
      const w = Math.max(kanbanMinWidth(el.columns.length, scale), kanbanLayout(el).w * Math.abs(sx));
      return { ...el, x: mx(el.x), y: my(el.y), scale: Math.round(scale * 1000) / 1000, w: r1(w) };
    }
    case "graph":
      return { ...el, x: mx(el.x), y: my(el.y), w: Math.max(40, r1(el.w * sx)), h: Math.max(40, r1(el.h * sy)) };
    case "math": {
      // Equations keep their proportions, like text.
      const k = Math.min(Math.abs(sx), Math.abs(sy));
      const size = Math.max(4, Math.min(800, el.size * k));
      const f = size / el.size;
      return { ...el, x: mx(el.x), y: my(el.y), size: r1(size), w: Math.max(0.1, el.w * f), h: Math.max(0.1, el.h * f) };
    }
    case "text":
      return {
        ...el,
        x: mx(el.x),
        y: my(el.y),
        fontSize: Math.max(4, Math.min(800, r1(el.fontSize * Math.min(Math.abs(sx), Math.abs(sy))))),
      };
  }
}
