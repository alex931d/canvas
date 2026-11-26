import { rectFromPoints, type Point, type Rect } from "@/lib/canvas/geometry";
import type { CanvasElement, FrameElement, GraphElement } from "@/lib/canvas/schema";
import { FRAME_ASPECTS, GRAPH_COLORS, type Style, type Tool } from "../tools";
import { clamp, MAX_STROKE_COORDS, newId, randomSeed, round1, round2 } from "./util";

/** A pointer sample, in world coordinates; pressure for pens. */
export type Sample = { x: number; y: number; pressure?: number };

/**
 * One stroke or shape while it's being drawn: started by a press with a
 * drawing tool, grown or reshaped as the pointer moves, and turned into the
 * element to add when it lifts. The draft is changed in place (it's drawn
 * every frame), so anything kept must be a `snapshot()`.
 */
export class DraftSession {
  private constructor(
    public draft: CanvasElement,
    /** Where the press started. */
    readonly origin: Point,
  ) {}

  /**
   * A draft for the tool at `p`, or null for tools that don't draw (and the
   * whole-stroke eraser). `slide` is the title and order a new frame gets.
   */
  static start(
    tool: Tool,
    p: Point,
    style: Style,
    extra: { pressure?: number; slide: () => Pick<FrameElement, "title" | "order"> },
  ): DraftSession | null {
    const s = style;
    const id = newId();
    const x = round1(p.x);
    const y = round1(p.y);
    const sketch = s.sketchy ? { seed: randomSeed(), roughness: s.roughness, fillStyle: s.fillStyle } : undefined;
    let draft: CanvasElement | null = null;
    switch (tool) {
      case "pen": {
        const pressure = extra.pressure && s.brush === "ink" ? { pressures: [round2(extra.pressure)] } : {};
        draft = {
          id,
          type: "stroke",
          color: s.color,
          size: s.brush === "highlighter" ? s.highlighterSize : s.penSize,
          brush: s.brush,
          points: [x, y],
          ...pressure,
        };
        break;
      }
      case "eraser":
        draft = s.eraserMode === "pixel" ? { id, type: "eraser", size: s.eraserSize, points: [x, y] } : null;
        break;
      case "line":
      case "arrow":
        draft = {
          id,
          type: "line",
          color: s.color,
          size: s.shapeSize,
          x1: x,
          y1: y,
          x2: x,
          y2: y,
          ...(tool === "arrow" ? { arrow: true } : {}),
          ...(sketch ? { sketch } : {}),
        };
        break;
      case "graph":
        draft = {
          id,
          type: "graph",
          x,
          y,
          w: 0,
          h: 0,
          fns: [{ expr: "sin(x)", color: GRAPH_COLORS[0] }],
          xMin: -10,
          xMax: 10,
          yMin: -4,
          yMax: 4,
          grid: true,
        };
        break;
      case "frame":
        draft = { id, type: "frame", x, y, w: 0, h: 0, ...extra.slide() };
        break;
      case "rect":
      case "ellipse":
        draft = {
          id,
          type: tool,
          color: s.color,
          size: s.shapeSize,
          fill: s.fill ? s.color : null,
          x,
          y,
          w: 0,
          h: 0,
          ...(sketch ? { sketch } : {}),
        };
        break;
    }
    return draft ? new DraftSession(draft, { x: p.x, y: p.y }) : null;
  }

  /** Pen strokes and pixel erasers grow point by point; everything else is reshaped. */
  get freehand() {
    return this.draft.type === "stroke" || this.draft.type === "eraser";
  }

  /**
   * Add pointer samples to a freehand draft, skipping ones closer than
   * `minStep` to the last. A very long stroke is cut: the finished part
   * comes back to be added, and the draft carries on from where it ended.
   */
  addSamples(samples: readonly Sample[], minStep: number): CanvasElement | null {
    const d = this.draft;
    if (d.type !== "stroke" && d.type !== "eraser") return null;
    for (const q of samples) {
      const n = d.points.length;
      const dx = q.x - d.points[n - 2];
      const dy = q.y - d.points[n - 1];
      if (dx * dx + dy * dy < minStep * minStep) continue;
      d.points.push(round1(q.x), round1(q.y));
      if (d.type === "stroke" && d.pressures) d.pressures.push(round2(q.pressure || 0.5));
    }
    if (d.points.length < MAX_STROKE_COORDS) return null;
    const done = this.snapshot();
    this.draft = {
      ...d,
      id: newId(),
      points: d.points.slice(-2),
      ...(d.type === "stroke" && d.pressures ? { pressures: d.pressures.slice(-1) } : {}),
    } as CanvasElement;
    return done;
  }

  /**
   * Follow the pointer with a shape. Shift keeps lines to 45° steps and
   * rectangles and ellipses square; frames keep the frame tool's shape
   * (Shift: any shape, or square when the shape is "Any").
   */
  reshape(p: Point, shift: boolean, frameAspect: Style["frameAspect"]) {
    const d = this.draft;
    const o = this.origin;
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    switch (d.type) {
      case "line": {
        if (shift) {
          const step = Math.PI / 4;
          const ang = Math.round(Math.atan2(dy, dx) / step) * step;
          const len = Math.hypot(dx, dy);
          dx = Math.cos(ang) * len;
          dy = Math.sin(ang) * len;
        }
        d.x2 = round1(o.x + dx);
        d.y2 = round1(o.y + dy);
        break;
      }
      case "graph": {
        const r = rectFromPoints(o, p);
        Object.assign(d, { x: round1(r.x), y: round1(r.y), w: round1(r.w), h: round1(r.h) });
        break;
      }
      case "frame": {
        const ratio = FRAME_ASPECTS.find((a) => a.id === frameAspect)?.ratio ?? null;
        const r = shift ? (ratio ? null : 1) : ratio;
        let w = Math.abs(dx);
        let h = Math.abs(dy);
        if (r) {
          if (w / r >= h) h = w / r;
          else w = h * r;
        }
        Object.assign(d, {
          x: round1(dx < 0 ? o.x - w : o.x),
          y: round1(dy < 0 ? o.y - h : o.y),
          w: round1(w),
          h: round1(h),
        });
        break;
      }
      case "rect":
      case "ellipse": {
        if (shift) {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * m;
          dy = Math.sign(dy || 1) * m;
        }
        d.w = round1(dx);
        d.h = round1(dy);
        break;
      }
    }
  }

  /**
   * What to add when the pointer lifts, or null when nothing was really
   * drawn. A click with the graph tool makes a graph about 480 × 320 on
   * screen; with the frame tool, `clickFrame` says where a frame goes.
   */
  finish(z: number, clickFrame: (at: Point) => Rect): CanvasElement | null {
    const d = this.draft;
    switch (d.type) {
      case "graph": {
        if (d.w * z >= 40 && d.h * z >= 40) return { ...d, w: Math.max(40, d.w), h: Math.max(40, d.h) } satisfies GraphElement;
        const w = round1(clamp(480 / z, 80, 4000));
        const h = round1(clamp(320 / z, 60, 3000));
        return { ...d, x: round1(this.origin.x - w / 2), y: round1(this.origin.y - h / 2), w, h };
      }
      case "frame":
        return d.w * z >= 12 && d.h * z >= 12 ? { ...d } : { ...d, ...clickFrame(this.origin) };
      case "line":
        return Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 1 ? this.snapshot() : null;
      case "rect":
      case "ellipse":
        return Math.abs(d.w) >= 1 || Math.abs(d.h) >= 1 ? this.snapshot() : null;
      default:
        return this.snapshot();
    }
  }

  /** A copy that later changes to the draft won't touch (render caches key on the object). */
  snapshot(): CanvasElement {
    const d = this.draft;
    if (d.type === "stroke") return { ...d, points: d.points.slice(), ...(d.pressures ? { pressures: d.pressures.slice() } : {}) };
    if (d.type === "eraser") return { ...d, points: d.points.slice() };
    return { ...d };
  }
}
