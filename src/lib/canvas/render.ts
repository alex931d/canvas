import { getStroke } from "perfect-freehand";
import rough from "roughjs";
import type { Options as RoughOptions } from "roughjs/bin/core";
import { drawMathLayout, mathEntry, texSource } from "@/lib/math/layout";
import { contentBounds, elementBounds, measureText, normalizeRect, padRect, rectsIntersect, type Point, type Rect } from "./geometry";
import { drawGraph } from "./graph-render";
import { drawKanban, type KanbanFxView } from "./kanban-render";
import {
  FONT_FAMILIES,
  TEXT_LINE_HEIGHT,
  type CanvasElement,
  type DrawingData,
  type LineElement,
  type MathElement,
  type MediaElement,
  type ShapeElement,
  type StrokeElement,
} from "./schema";

/**
 * Canvas 2D rendering for the editor, exports, thumbnails and the math-check
 * crop. Callers set the world->screen transform on the context first.
 *
 * Elements are immutable, so expensive derived paths (perfect-freehand
 * outlines, rough.js sketches) are cached per element object in WeakMaps:
 * any edit produces a new object and the cache entry simply goes away.
 */

export type Ctx = CanvasRenderingContext2D;

/** What a GIF or video shows right now (see src/lib/canvas/images.ts). */
export type MediaView = {
  /** The current frame, or null while it loads. */
  source: CanvasImageSource | null;
  playing: boolean;
  /** 0–1 through a video; null for GIFs. */
  progress: number | null;
  error: boolean;
};

export type RenderEnv = {
  /** Returns a decoded image for an asset, or null while it loads. */
  getImage: (assetId: string) => CanvasImageSource | null;
  /** The current frame and state of a GIF or video. */
  getMedia?: (el: MediaElement) => MediaView | null;
  /** A to-do card being dragged: its slot is drawn as an empty outline. */
  draggingCardId?: string | null;
  /** To-do board animations in progress (src/lib/canvas/kanban-fx.ts). */
  kanbanFx?: KanbanFxView | null;
};

/**
 * An element part-way through appearing (t 0 → 1) or leaving (t 1 → 0),
 * driven by src/lib/canvas/effects.ts. `pop` may overshoot 1 a little.
 */
export type FxState = { kind: "fade" | "pop" | "trace"; t: number };

// ------------------------------------------------------------ freehand

/** Even-width smooth line through the points (marker, highlighter, eraser). */
function traceSmooth(ctx: Ctx, points: readonly number[]) {
  const n = points.length / 2;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  if (n === 1) {
    ctx.lineTo(points[0] + 0.01, points[1]);
    return;
  }
  if (n === 2) {
    ctx.lineTo(points[2], points[3]);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const nx = points[(i + 1) * 2];
    const ny = points[(i + 1) * 2 + 1];
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(points[(n - 1) * 2], points[(n - 1) * 2 + 1]);
}

const inkCache = new WeakMap<StrokeElement, Path2D>();

/** perfect-freehand outline (helper from its README), as a fillable path. */
function inkPath(el: StrokeElement): Path2D {
  const cached = inkCache.get(el);
  if (cached) return cached;
  const input: [number, number, number][] = [];
  for (let i = 0; i < el.points.length; i += 2) {
    input.push([el.points[i], el.points[i + 1], el.pressures?.[i / 2] ?? 0.5]);
  }
  // Real pen pressure gets a stronger effect; simulated (mouse/touch) pressure
  // is based on speed, so keep it gentle or quick strokes turn hairline.
  const outline = getStroke(input, {
    size: el.size * 1.6,
    thinning: el.pressures ? 0.6 : 0.3,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !el.pressures,
    last: true,
  });
  const path = new Path2D(svgPathFromOutline(outline));
  inkCache.set(el, path);
  return path;
}

function svgPathFromOutline(points: number[][]): string {
  if (points.length === 0) return "";
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M ${f(points[0][0])} ${f(points[0][1])} Q`;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    d += ` ${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`;
  }
  return d + " Z";
}

// ------------------------------------------------------------ rough.js

type RoughPiece = { path: Path2D; stroke?: string; fill?: string; width: number };
const roughCache = new WeakMap<CanvasElement, RoughPiece[]>();
const generator = rough.generator();

function roughPieces(el: ShapeElement | LineElement): RoughPiece[] {
  const cached = roughCache.get(el);
  if (cached) return cached;
  const sketch = el.sketch!;
  const opts: RoughOptions = {
    seed: sketch.seed,
    roughness: sketch.roughness,
    bowing: 1,
    stroke: el.color,
    strokeWidth: el.size,
    preserveVertices: true,
  };
  let drawables;
  if (el.type === "line") {
    drawables = [generator.line(el.x1, el.y1, el.x2, el.y2, opts)];
    if (el.arrow) {
      const [a, b] = arrowHead(el);
      drawables.push(generator.linearPath([a, [el.x2, el.y2], b], opts));
    }
  } else {
    const r = normalizeRect(el.x, el.y, el.w, el.h);
    const fillOpts: RoughOptions = el.fill
      ? {
          ...opts,
          fill: el.fill,
          fillStyle: sketch.fillStyle,
          fillWeight: Math.max(1, el.size / 2),
          hachureGap: Math.max(4, el.size * 3),
        }
      : opts;
    drawables = [
      el.type === "rect"
        ? generator.rectangle(r.x, r.y, r.w, r.h, fillOpts)
        : generator.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, fillOpts),
    ];
  }
  const pieces = drawables.flatMap((d) =>
    generator.toPaths(d).map((p) => ({
      path: new Path2D(p.d),
      stroke: p.stroke && p.stroke !== "none" ? p.stroke : undefined,
      fill: p.fill && p.fill !== "none" ? p.fill : undefined,
      width: p.strokeWidth,
    })),
  );
  roughCache.set(el, pieces);
  return pieces;
}

function arrowHead(el: LineElement): [[number, number], [number, number]] {
  const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
  const len = Math.min(Math.max(el.size * 4, 12), Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * 0.5);
  const spread = Math.PI / 7;
  return [
    [el.x2 - len * Math.cos(angle - spread), el.y2 - len * Math.sin(angle - spread)],
    [el.x2 - len * Math.cos(angle + spread), el.y2 - len * Math.sin(angle + spread)],
  ];
}

// ------------------------------------------------------------ elements

export function drawElement(ctx: Ctx, el: CanvasElement, env: RenderEnv) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (el.type) {
    case "stroke": {
      const brush = el.brush ?? "marker";
      if (brush === "ink") {
        ctx.fillStyle = el.color;
        ctx.fill(inkPath(el));
      } else {
        if (brush === "highlighter") {
          ctx.globalAlpha *= 0.45;
          ctx.globalCompositeOperation = "multiply";
          ctx.lineCap = "square";
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.size;
        traceSmooth(ctx, el.points);
        ctx.stroke();
      }
      break;
    }
    case "eraser": {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = el.size;
      traceSmooth(ctx, el.points);
      ctx.stroke();
      break;
    }
    case "line": {
      if (el.sketch) {
        drawRough(ctx, roughPieces(el));
        break;
      }
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.size;
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      if (el.arrow) {
        const [a, b] = arrowHead(el);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(el.x2, el.y2);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      break;
    }
    case "rect":
    case "ellipse": {
      if (el.sketch) {
        drawRough(ctx, roughPieces(el));
        break;
      }
      const r = normalizeRect(el.x, el.y, el.w, el.h);
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.size;
      ctx.beginPath();
      if (el.type === "rect") ctx.rect(r.x, r.y, r.w, r.h);
      else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (el.fill) {
        ctx.fillStyle = el.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "text": {
      const m = measureText(el);
      ctx.fillStyle = el.color;
      ctx.font = `${el.fontSize}px ${FONT_FAMILIES[el.font]}`;
      ctx.textBaseline = "top";
      const lh = el.fontSize * TEXT_LINE_HEIGHT;
      const offset = (lh - el.fontSize) / 2;
      m.lines.forEach((line, i) => ctx.fillText(line, el.x, el.y + i * lh + offset));
      break;
    }
    case "image": {
      const img = env.getImage(el.assetId);
      if (img) {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, el.x, el.y, el.w, el.h);
      } else {
        ctx.fillStyle = "#f2f2f2";
        ctx.fillRect(el.x, el.y, el.w, el.h);
        ctx.strokeStyle = "#b3b3b3";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      }
      break;
    }
    case "math": {
      const entry = mathEntry(texSource(el));
      if (entry.status === "ready") drawMathLayout(ctx, entry.layout, el.x, el.y, el.w, el.h, el.color);
      else drawMathPlaceholder(ctx, el, entry.status === "error");
      break;
    }
    case "graph":
      drawGraph(ctx, el);
      break;
    case "gif":
    case "video":
      drawMedia(ctx, el, env.getMedia?.(el) ?? null);
      break;
    case "kanban":
      drawKanban(ctx, el, env.draggingCardId ?? null, env.kanbanFx ?? null);
      break;
  }
  ctx.restore();
}

/** A GIF or video frame, with a play button while a video is paused. */
function drawMedia(ctx: Ctx, el: MediaElement, view: MediaView | null) {
  const { x, y, w, h } = el;
  const unit = Math.min(w, h);
  if (view?.source) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(view.source, x, y, w, h);
  } else {
    ctx.fillStyle = el.type === "video" ? "#2b2a30" : "#f2f2f2";
    ctx.fillRect(x, y, w, h);
    if (view?.error) {
      ctx.fillStyle = el.type === "video" ? "#f2cdac" : "#c94736";
      ctx.font = `${Math.max(8, unit * 0.07)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.type === "video" ? "This video can't play here" : "This GIF can't be shown", x + w / 2, y + h / 2, w * 0.9);
      ctx.textAlign = "left";
      return;
    }
  }

  if (el.type === "video") {
    const playing = view?.playing ?? false;
    if (!playing) {
      const r = Math.max(6, Math.min(unit * 0.13, 64 * Math.max(1, unit / 600)));
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = "rgba(32,31,36,0.62)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.32, cy - r * 0.45);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.lineTo(cx - r * 0.32, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    const p = view?.progress ?? 0;
    if (playing || p > 0) {
      const bh = Math.max(2, h * 0.014);
      ctx.fillStyle = "rgba(32,31,36,0.35)";
      ctx.fillRect(x, y + h - bh, w, bh);
      ctx.fillStyle = "#82c9d7";
      ctx.fillRect(x, y + h - bh, w * Math.min(1, Math.max(0, p)), bh);
    }
  } else if (view && !view.playing && view.source) {
    // A paused GIF says so in its corner.
    const fs = Math.max(6, unit * 0.08);
    const label = "GIF ▶";
    ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const pad = fs * 0.45;
    ctx.fillStyle = "rgba(32,31,36,0.7)";
    ctx.beginPath();
    ctx.roundRect(x + pad, y + h - pad - fs * 1.6, tw + pad * 2, fs * 1.6, fs * 0.4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + pad * 2, y + h - pad - fs * 0.8);
  }
}

/** While MathJax loads (or if the TeX can't be read): a quiet box in its place. */
function drawMathPlaceholder(ctx: Ctx, el: MathElement, error: boolean) {
  ctx.fillStyle = error ? "#fbeeec" : "#f4f1ee";
  ctx.beginPath();
  ctx.roundRect(el.x, el.y, el.w, el.h, Math.min(6, el.h / 4));
  ctx.fill();
  if (error) {
    ctx.fillStyle = "#c94736";
    ctx.font = `${Math.min(el.size * 0.6, el.h * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText("Can't show this equation", el.x + el.size * 0.3, el.y + el.h / 2, el.w - el.size * 0.6);
  }
}

function drawRough(ctx: Ctx, pieces: RoughPiece[]) {
  for (const p of pieces) {
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill(p.path);
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.stroke(p.path);
    }
  }
}

/**
 * Draw every element that intersects `view` (world rect), skipping `skip`.
 * `fx` gives the elements that are animating in, which draw part-way.
 */
export function drawScene(
  ctx: Ctx,
  elements: readonly CanvasElement[],
  env: RenderEnv,
  view: Rect | null,
  skip?: ReadonlySet<string>,
  fx?: (el: CanvasElement) => FxState | undefined,
) {
  for (const el of elements) {
    if (skip?.has(el.id)) continue;
    // Erasers must always run so holes stay holes even if the eraser is offscreen-adjacent.
    if (view && el.type !== "eraser" && !rectsIntersect(elementBounds(el), view)) continue;
    const state = fx?.(el);
    if (state) drawElementFx(ctx, el, env, state);
    else drawElement(ctx, el, env);
  }
}

// ------------------------------------------------------------ effects

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** An element part-way through an effect: faded, scaled about its centre, or partly drawn. */
export function drawElementFx(ctx: Ctx, el: CanvasElement, env: RenderEnv, fx: FxState) {
  if (fx.t <= 0.001) return;
  if (fx.kind !== "pop" && fx.t >= 0.999) {
    drawElement(ctx, el, env);
    return;
  }
  ctx.save();
  if (fx.kind === "fade") {
    ctx.globalAlpha *= clamp01(fx.t);
    drawElement(ctx, el, env);
  } else if (fx.kind === "pop") {
    const b = elementBounds(el);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const s = 0.82 + 0.18 * fx.t;
    ctx.globalAlpha *= clamp01(fx.t * 1.6);
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    drawElement(ctx, el, env);
  } else {
    drawTraced(ctx, el, env, clamp01(fx.t));
  }
  ctx.restore();
}

/**
 * The first `t` of an element, as if it were still being drawn: pen strokes
 * and plain lines follow their path, plain shapes trace their outline, and
 * everything else (text, pictures, sketchy shapes) sweeps in from the left.
 */
function drawTraced(ctx: Ctx, el: CanvasElement, env: RenderEnv, t: number) {
  switch (el.type) {
    case "stroke": {
      const n = el.points.length / 2;
      const k = Math.max(1, Math.ceil(n * t));
      const part: StrokeElement = {
        ...el,
        points: el.points.slice(0, k * 2),
        ...(el.pressures ? { pressures: el.pressures.slice(0, k) } : {}),
      };
      drawElement(ctx, part, env);
      return;
    }
    case "line":
      if (!el.sketch) {
        drawElement(ctx, { ...el, x2: el.x1 + (el.x2 - el.x1) * t, y2: el.y1 + (el.y2 - el.y1) * t }, env);
        return;
      }
      break;
    case "rect":
    case "ellipse":
      if (!el.sketch) {
        traceOutline(ctx, el, t);
        return;
      }
      break;
  }
  const b = padRect(elementBounds(el), ("size" in el ? el.size : 0) + 2);
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w * t, b.h);
  ctx.clip();
  drawElement(ctx, el, env);
}

function traceOutline(ctx: Ctx, el: ShapeElement, t: number) {
  const r = normalizeRect(el.x, el.y, el.w, el.h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  let length: number;
  if (el.type === "rect") {
    ctx.rect(r.x, r.y, r.w, r.h);
    length = 2 * (r.w + r.h);
  } else {
    const a = r.w / 2;
    const b = r.h / 2;
    ctx.ellipse(r.x + a, r.y + b, a, b, 0, 0, Math.PI * 2);
    length = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); // Ramanujan
  }
  if (el.fill) {
    ctx.save();
    ctx.globalAlpha *= t;
    ctx.fillStyle = el.fill;
    ctx.fill();
    ctx.restore();
  }
  ctx.setLineDash([length * t, length + 1]);
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.size;
  ctx.stroke();
}

// ------------------------------------------------------------ offscreen output

/**
 * Render a world-space region to a new canvas with the background filled.
 * Used for PNG export, thumbnails and the math-check crop (with `clip`).
 */
export function renderRegion(opts: {
  elements: readonly CanvasElement[];
  background: string;
  region: Rect;
  scale: number;
  env: RenderEnv;
  clip?: readonly Point[];
}): HTMLCanvasElement {
  const { elements, background, region, scale, env, clip } = opts;
  const w = Math.max(1, Math.round(region.w * scale));
  const h = Math.max(1, Math.round(region.h * scale));

  // Ink goes on a transparent layer so the pixel eraser only removes ink.
  const ink = document.createElement("canvas");
  ink.width = w;
  ink.height = h;
  const ictx = ink.getContext("2d")!;
  ictx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  if (clip && clip.length > 2) {
    ictx.beginPath();
    ictx.moveTo(clip[0].x, clip[0].y);
    for (const p of clip.slice(1)) ictx.lineTo(p.x, p.y);
    ictx.closePath();
    ictx.clip();
  }
  drawScene(ictx, elements, env, region);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.fillStyle = background;
  octx.fillRect(0, 0, w, h);
  octx.drawImage(ink, 0, 0);
  return out;
}

/** Content bounds plus padding, or a default area for an empty drawing. */
export function exportRegion(elements: readonly CanvasElement[], pad = 32): Rect {
  const b = contentBounds(elements);
  return b ? padRect(b, pad) : { x: 0, y: 0, w: 800, h: 500 };
}

const THUMB_W = 480;
const THUMB_H = 300;
const THUMBNAIL_BUDGET = 280_000;

export function makeThumbnail(data: DrawingData, env: RenderEnv): string | null {
  // Fit the content into a 16:10 frame, centered.
  const b = exportRegion(data.elements, 24);
  const aspect = THUMB_W / THUMB_H;
  const region =
    b.w / b.h > aspect
      ? { x: b.x, y: b.y + b.h / 2 - b.w / aspect / 2, w: b.w, h: b.w / aspect }
      : { x: b.x + b.w / 2 - (b.h * aspect) / 2, y: b.y, w: b.h * aspect, h: b.h };
  const canvas = renderRegion({
    elements: data.elements,
    background: data.background,
    region,
    scale: THUMB_W / region.w,
    env,
  });
  const webp = canvas.toDataURL("image/webp", 0.85);
  if (webp.length <= THUMBNAIL_BUDGET) return webp;
  const jpeg = canvas.toDataURL("image/jpeg", 0.75);
  return jpeg.length <= THUMBNAIL_BUDGET ? jpeg : null;
}
