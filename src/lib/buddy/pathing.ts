import { elementBounds } from "@/lib/canvas/geometry";
import type { CanvasElement } from "@/lib/canvas/schema";

/**
 * Keeping pandas off what's drawn. Everything is in world coordinates.
 *
 * - `obstaclesOf` turns the drawing into boxes to keep off. Shapes, text,
 *   pictures, graphs and to-do boards are their whole box; pen strokes and
 *   lines are cut into short pieces, so the empty space a scribble curls
 *   around stays walkable.
 * - `buildGrid` lays a grid of spots over the part of the drawing in view and
 *   marks the ones where a panda standing there would touch something.
 * - `findPath` finds a way between two spots that only crosses free spots
 *   (A*, eight directions, no cutting corners), then straightens it.
 *
 * A panda stands at its feet and its body rises above them, so a spot is
 * blocked if the body box over it would overlap an obstacle.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Strokes and lines are cut into pieces about this long. */
const PIECE = 48;

const cache = new WeakMap<CanvasElement, Rect[]>();

function pieces(points: readonly number[], pad: number): Rect[] {
  const out: Rect[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let run = 0;
  const flush = () => {
    if (minX !== Infinity) out.push({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    run = 0;
  };
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (i > 0) run += Math.hypot(x - points[i - 2], y - points[i - 1]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (run >= PIECE) {
      flush();
      // Each piece starts where the last ended, so there are no gaps.
      minX = maxX = x;
      minY = maxY = y;
    }
  }
  flush();
  return out;
}

function obstaclesFor(el: CanvasElement): Rect[] {
  switch (el.type) {
    case "eraser":
      return [];
    case "stroke":
      return pieces(el.points, el.size / 2 + 2);
    case "line": {
      const n = Math.max(1, Math.ceil(Math.hypot(el.x2 - el.x1, el.y2 - el.y1) / PIECE));
      const pts: number[] = [];
      for (let i = 0; i <= n; i++) pts.push(el.x1 + ((el.x2 - el.x1) * i) / n, el.y1 + ((el.y2 - el.y1) * i) / n);
      const out = pieces(pts, el.size / 2 + 2);
      // The arrow head is wider than the line.
      if (el.arrow) {
        const head = el.size * 2 + 12;
        out.push({ x: el.x2 - head, y: el.y2 - head, w: head * 2, h: head * 2 });
      }
      return out;
    }
    default:
      return [elementBounds(el)];
  }
}

/** Boxes to keep off, for the whole drawing (worked out once per element). */
export function obstaclesOf(elements: readonly CanvasElement[]): Rect[] {
  const out: Rect[] = [];
  for (const el of elements) {
    let boxes = cache.get(el);
    if (!boxes) {
      boxes = obstaclesFor(el);
      cache.set(el, boxes);
    }
    for (const b of boxes) out.push(b);
  }
  return out;
}

/** A panda's body over its feet: half its width, and its height. */
export type Body = { hw: number; h: number };

/** The box a panda standing at `feet` covers. */
export const bodyAt = (feet: Point, body: Body): Rect => ({
  x: feet.x - body.hw,
  y: feet.y - body.h,
  w: body.hw * 2,
  h: body.h,
});

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Would a panda standing at `feet` touch anything? (Exact, for one spot.) */
export function touchesDrawing(feet: Point, body: Body, obstacles: readonly Rect[], pad = 0): boolean {
  const box = bodyAt(feet, { hw: body.hw + pad, h: body.h + pad });
  box.h += pad;
  for (const o of obstacles) if (overlap(box, o)) return true;
  return false;
}

// ------------------------------------------------------------ the grid

export type Grid = {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 where a panda would touch something. */
  blocked: Uint8Array;
};

/**
 * Spots `cell` apart over `room` (where feet may go). A spot is blocked if a
 * panda anywhere in its cell would come within `pad` of an obstacle, so
 * anything inside a free cell is free.
 */
export function buildGrid(room: Rect, obstacles: readonly Rect[], body: Body, cell: number, pad: number): Grid {
  const cols = Math.max(1, Math.floor(room.w / cell) + 1);
  const rows = Math.max(1, Math.floor(room.h / cell) + 1);
  const blocked = new Uint8Array(cols * rows);
  const grow = pad + cell / 2;
  for (const o of obstacles) {
    // Feet that would put the body over this box.
    const left = o.x - body.hw - grow;
    const right = o.x + o.w + body.hw + grow;
    const top = o.y - grow;
    const bottom = o.y + o.h + body.h + grow;
    const c0 = Math.max(0, Math.ceil((left - room.x) / cell));
    const c1 = Math.min(cols - 1, Math.floor((right - room.x) / cell));
    const r0 = Math.max(0, Math.ceil((top - room.y) / cell));
    const r1 = Math.min(rows - 1, Math.floor((bottom - room.y) / cell));
    if (c0 > c1) continue;
    for (let r = r0; r <= r1; r++) blocked.fill(1, r * cols + c0, r * cols + c1 + 1);
  }
  return { x0: room.x, y0: room.y, cell, cols, rows, blocked };
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const cellOf = (g: Grid, p: Point) => ({
  c: clampInt(Math.round((p.x - g.x0) / g.cell), 0, g.cols - 1),
  r: clampInt(Math.round((p.y - g.y0) / g.cell), 0, g.rows - 1),
});
export const spotOf = (g: Grid, c: number, r: number): Point => ({ x: g.x0 + c * g.cell, y: g.y0 + r * g.cell });
const free = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !g.blocked[r * g.cols + c];

/** Is the spot nearest `p` free? */
export function isFree(g: Grid, p: Point): boolean {
  const { c, r } = cellOf(g, p);
  return free(g, c, r);
}

/** Every free spot. */
export function freeSpots(g: Grid): Point[] {
  const out: Point[] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (!g.blocked[r * g.cols + c]) out.push(spotOf(g, c, r));
  return out;
}

/** The free spot nearest `p` (null if there's none in view). */
export function nearestFree(g: Grid, p: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (g.blocked[r * g.cols + c]) continue;
      const s = spotOf(g, c, r);
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
  }
  return best;
}

/** Can a panda walk straight from `a` to `b` without touching anything? */
export function clearLine(g: Grid, a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (g.cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const { c, r } = cellOf(g, { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
    if (!free(g, c, r)) return false;
  }
  return true;
}

/**
 * A way from `from` to `to` over free spots: the points to walk through,
 * starting at `from`, straightened so it only turns where it has to. Null if
 * `to` isn't free or can't be reached. (`from` itself may be blocked: the
 * first step off it is allowed.)
 */
export function findPath(g: Grid, from: Point, to: Point): Point[] | null {
  const s = cellOf(g, from);
  const t = cellOf(g, to);
  if (!free(g, t.c, t.r)) return null;
  const n = g.cols * g.rows;
  const start = s.r * g.cols + s.c;
  const goal = t.r * g.cols + t.c;
  const cost = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - t.c);
    const dr = Math.abs(Math.floor(i / g.cols) - t.r);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  // A small binary heap of [priority, index].
  const heap: [number, number][] = [];
  const push = (p: number, i: number) => {
    heap.push([p, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (heap[parent][0] <= heap[k][0]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const [, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!free(g, nc, nr)) continue;
        // No squeezing between two blocked spots on a diagonal.
        if (dr && dc && (!free(g, c + dc, r) || !free(g, c, r + dr))) continue;
        const j = nr * g.cols + nc;
        const next = cost[i] + (dr && dc ? Math.SQRT2 : 1);
        if (next < cost[j]) {
          cost[j] = next;
          came[j] = i;
          push(next + h(j), j);
        }
      }
    }
  }
  if (start !== goal && came[goal] === -1) return null;
  const cells: Point[] = [];
  for (let i = goal; i !== -1 && i !== start; i = came[i]) cells.push(spotOf(g, i % g.cols, Math.floor(i / g.cols)));
  cells.reverse();
  // Straighten: from each point, jump to the furthest one it can walk to in a straight line.
  const path: Point[] = [from];
  const all = [...cells.slice(0, -1), to];
  let at = from;
  let k = 0;
  while (k < all.length) {
    let far = k;
    for (let j = all.length - 1; j > k; j--) {
      if (clearLine(g, at, all[j])) {
        far = j;
        break;
      }
    }
    path.push(all[far]);
    at = all[far];
    k = far + 1;
  }
  return path;
}

/** Is the walk through `path` (from where it is now) still clear? */
export function pathClear(g: Grid, path: readonly Point[]): boolean {
  for (let i = 1; i < path.length; i++) if (!clearLine(g, path[i - 1], path[i])) return false;
  return true;
}

/** The free spots along one side of the grid (for walking in or out of view). */
export function edgeSpots(g: Grid, side: "left" | "right" | "top" | "bottom"): Point[] {
  const out: Point[] = [];
  if (side === "left" || side === "right") {
    const c = side === "left" ? 0 : g.cols - 1;
    for (let r = 0; r < g.rows; r++) if (free(g, c, r)) out.push(spotOf(g, c, r));
  } else {
    const r = side === "top" ? 0 : g.rows - 1;
    for (let c = 0; c < g.cols; c++) if (free(g, c, r)) out.push(spotOf(g, c, r));
  }
  return out;
}
