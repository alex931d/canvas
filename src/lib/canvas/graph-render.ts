import { compiledOrError, ExprError, formatTick, niceStep, stripLhs } from "@/lib/math/expr";
import type { GraphElement } from "./schema";

/**
 * Draws a graph element: grid, axes with labels, and each function sampled
 * across the visible x range. Everything is vector, in world units, so it
 * stays crisp when zoomed and exports like the rest of the canvas.
 */

type Ctx = CanvasRenderingContext2D;

const DEFAULT_RANGE = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };

export function graphRanges(el: GraphElement) {
  const xOk = el.xMax > el.xMin;
  const yOk = el.yMax > el.yMin;
  return {
    xMin: xOk ? el.xMin : DEFAULT_RANGE.xMin,
    xMax: xOk ? el.xMax : DEFAULT_RANGE.xMax,
    yMin: yOk ? el.yMin : DEFAULT_RANGE.yMin,
    yMax: yOk ? el.yMax : DEFAULT_RANGE.yMax,
  };
}

/** Samples of one function across [xMin, xMax], cached per element and density. */
const sampleCache = new WeakMap<GraphElement, Map<string, Float64Array | ExprError>>();

function samples(el: GraphElement, index: number, n: number): Float64Array | ExprError {
  let perEl = sampleCache.get(el);
  if (!perEl) {
    perEl = new Map();
    sampleCache.set(el, perEl);
  }
  const key = `${index}:${n}`;
  const hit = perEl.get(key);
  if (hit) return hit;
  const f = compiledOrError(el.fns[index].expr);
  let out: Float64Array | ExprError;
  if (f instanceof ExprError) {
    out = f;
  } else {
    const { xMin, xMax } = graphRanges(el);
    out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = xMin + ((xMax - xMin) * i) / (n - 1);
      let y: number;
      try {
        y = f(x);
      } catch {
        y = NaN;
      }
      out[i] = y;
    }
  }
  perEl.set(key, out);
  return out;
}

/** Suggest a y range that shows the functions well (for "Fit"). */
export function fitYRange(el: GraphElement): { yMin: number; yMax: number } | null {
  const values: number[] = [];
  for (let i = 0; i < el.fns.length; i++) {
    const s = samples(el, i, 400);
    if (s instanceof ExprError) continue;
    for (const v of s) if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  // Ignore the extreme 2 % on each side (asymptotes like tan x).
  let lo = values[Math.floor(values.length * 0.02)];
  let hi = values[Math.ceil(values.length * 0.98) - 1];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  const step = niceStep(hi - lo + 2 * pad, 6);
  return { yMin: Math.floor((lo - pad) / step) * step, yMax: Math.ceil((hi + pad) / step) * step };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export function drawGraph(ctx: Ctx, el: GraphElement) {
  const { xMin, xMax, yMin, yMax } = graphRanges(el);
  const { x, y, w, h } = el;
  const unit = Math.min(w, h);
  const font = Math.max(9, Math.min(28, unit / 22));
  const t = ctx.getTransform();
  const screenScale = Math.hypot(t.a, t.b) || 1;

  // Panel
  roundRect(ctx, x, y, w, h, font * 0.7);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = Math.max(1, unit / 320);
  ctx.strokeStyle = "#d6d1cc";
  ctx.stroke();

  const pad = font * 0.6;
  const plot = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };
  if (plot.w <= 0 || plot.h <= 0) return;
  const px = (vx: number) => plot.x + ((vx - xMin) / (xMax - xMin)) * plot.w;
  const py = (vy: number) => plot.y + ((yMax - vy) / (yMax - yMin)) * plot.h;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  const xStep = niceStep(xMax - xMin, Math.max(2, Math.round(plot.w / (font * 5))));
  const yStep = niceStep(yMax - yMin, Math.max(2, Math.round(plot.h / (font * 3.2))));
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax + xStep * 1e-9; v += xStep) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + yStep * 1e-9; v += yStep) yTicks.push(v);

  // Grid
  if (el.grid) {
    ctx.lineWidth = Math.max(0.5, unit / 700);
    ctx.strokeStyle = "#ebe6e1";
    ctx.beginPath();
    for (const v of xTicks) {
      ctx.moveTo(px(v), plot.y);
      ctx.lineTo(px(v), plot.y + plot.h);
    }
    for (const v of yTicks) {
      ctx.moveTo(plot.x, py(v));
      ctx.lineTo(plot.x + plot.w, py(v));
    }
    ctx.stroke();
  }

  // Axes (where 0 is visible)
  const axisX = yMin <= 0 && yMax >= 0 ? py(0) : null;
  const axisY = xMin <= 0 && xMax >= 0 ? px(0) : null;
  ctx.lineWidth = Math.max(1, unit / 260);
  ctx.strokeStyle = "#4d4b52";
  ctx.beginPath();
  if (axisX !== null) {
    ctx.moveTo(plot.x, axisX);
    ctx.lineTo(plot.x + plot.w, axisX);
  }
  if (axisY !== null) {
    ctx.moveTo(axisY, plot.y);
    ctx.lineTo(axisY, plot.y + plot.h);
  }
  ctx.stroke();

  // Tick labels along the axes, or along the edges when an axis is off view.
  ctx.fillStyle = "#696868";
  ctx.font = `${font * 0.78}px ui-sans-serif, system-ui, sans-serif`;
  const labelY = axisX === null ? plot.y + plot.h - font * 0.25 : Math.min(axisX + font * 0.25, plot.y + plot.h - font);
  ctx.textAlign = "center";
  ctx.textBaseline = axisX === null ? "bottom" : "top";
  for (const v of xTicks) {
    if (Math.abs(v) < xStep * 1e-9 && axisY !== null) continue;
    const X = px(v);
    if (X < plot.x + font || X > plot.x + plot.w - font) continue;
    ctx.fillText(formatTick(v, xStep), X, labelY);
  }
  const labelX = axisY === null ? plot.x + font * 0.3 : Math.max(axisY - font * 0.3, plot.x + font * 1.8);
  ctx.textAlign = axisY === null ? "left" : "right";
  ctx.textBaseline = "middle";
  for (const v of yTicks) {
    if (Math.abs(v) < yStep * 1e-9 && axisX !== null) continue;
    const Y = py(v);
    if (Y < plot.y + font * 0.6 || Y > plot.y + plot.h - font * 0.6) continue;
    ctx.fillText(formatTick(v, yStep), labelX, Y);
  }
  if (axisX !== null && axisY !== null) {
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("0", axisY - font * 0.3, axisX + font * 0.25);
  }

  // Curves
  const n = Math.max(64, Math.min(4096, 2 ** Math.round(Math.log2(Math.max(1, plot.w * screenScale)))));
  const span = yMax - yMin;
  ctx.lineWidth = Math.max(1.5, Math.min(6, unit / 150));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i < el.fns.length; i++) {
    const s = samples(el, i, n);
    if (s instanceof ExprError) continue;
    ctx.strokeStyle = el.fns[i].color;
    ctx.beginPath();
    let down = false;
    let prev = NaN;
    for (let k = 0; k < n; k++) {
      const v = s[k];
      if (!Number.isFinite(v)) {
        down = false;
        prev = NaN;
        continue;
      }
      // A jump from far above to far below (or back) is an asymptote: lift the pen.
      const jump =
        Number.isFinite(prev) &&
        ((prev > yMax + span && v < yMin - span) || (prev < yMin - span && v > yMax + span));
      const X = px(xMin + ((xMax - xMin) * k) / (n - 1));
      const Y = Math.max(plot.y - plot.h * 4, Math.min(plot.y + plot.h * 5, py(v)));
      if (!down || jump) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
      down = true;
      prev = v;
    }
    ctx.stroke();
  }
  ctx.restore();

  // Legend
  ctx.font = `600 ${font * 0.82}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lineH = font * 1.25;
  const labels = el.fns.map((fn, i) => {
    const s = samples(el, i, n);
    return s instanceof ExprError ? `Can't plot ${stripLhs(fn.expr)}` : `y = ${stripLhs(fn.expr)}`;
  });
  const maxW = Math.min(plot.w - font * 2, Math.max(...labels.map((l) => ctx.measureText(l).width)) + font * 2.2);
  const boxH = lineH * labels.length + font * 0.4;
  if (maxW > font * 3 && boxH < plot.h * 0.8) {
    roundRect(ctx, plot.x + font * 0.4, plot.y + font * 0.4, maxW, boxH, font * 0.35);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    labels.forEach((label, i) => {
      const cy = plot.y + font * 0.6 + lineH * (i + 0.5);
      const error = label.startsWith("Can't");
      ctx.strokeStyle = error ? "#c94736" : el.fns[i].color;
      ctx.lineWidth = Math.max(1.5, font / 6);
      ctx.beginPath();
      ctx.moveTo(plot.x + font * 0.8, cy);
      ctx.lineTo(plot.x + font * 1.6, cy);
      ctx.stroke();
      ctx.fillStyle = error ? "#c94736" : "#201f24";
      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.x + maxW - plot.x, plot.h);
      ctx.clip();
      ctx.fillText(label, plot.x + font * 1.9, cy);
      ctx.restore();
    });
  }
}
