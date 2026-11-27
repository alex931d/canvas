/**
 * Figures the math and chemistry tools put on the canvas, built from the
 * canvas's own elements (lines, ellipses, rects, text, typeset equations
 * and frames), so they can be moved, recoloured, erased and exported like
 * anything drawn by hand.
 *
 * Builders work in their own coordinates around (0, 0); the board moves the
 * whole group to the middle of the view. Equations need their typeset size
 * up front, so builders take `measure` (the typesetter's size in ems).
 */

import { measureText } from "@/lib/canvas/geometry";
import type { CanvasElement, MathElement, TextElement } from "@/lib/canvas/schema";
import { TEXT_LINE_HEIGHT } from "@/lib/canvas/schema";
import type { Proof, ProofVerdict } from "./proof";
import { stepsToTex } from "./steps";
import { fmt, triangleCorners, type TriangleSolution } from "./triangle";
import { radiansTex, UNIT_CIRCLE_ANGLES, unitPoint, type AngleUnit } from "./trig";
import type { Worksheet } from "./worksheet";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An element before it has an id (frames get their slide order on the board). */
export type FigurePart = DistributiveOmit<CanvasElement, "id">;

export type Measure = (tex: string) => Promise<{ width: number; height: number }>;

export const FIGURE_COLORS = {
  accent: "#2a62c9",
  good: "#1f7a4c",
  bad: "#c2362f",
  muted: "#77736d",
  fill: "#f2efe8",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

async function math(measure: Measure, source: string, at: { x: number; y: number }, size: number, color: string, anchor: "top-left" | "center" | "left" = "top-left"): Promise<Omit<MathElement, "id">> {
  const m = await measure(source);
  const w = Math.max(0.1, m.width * size);
  const h = Math.max(0.1, m.height * size);
  const x = anchor === "center" ? at.x - w / 2 : at.x;
  const y = anchor === "top-left" ? at.y : at.y - h / 2;
  return { type: "math", syntax: "tex", source, color, x: r1(x), y: r1(y), size, w: r1(w), h: r1(h) };
}

function text(value: string, at: { x: number; y: number }, fontSize: number, color: string, anchor: "top-left" | "center" = "top-left"): Omit<TextElement, "id"> {
  const el = { type: "text" as const, text: value, x: at.x, y: at.y, fontSize, color, font: "sans" as const };
  if (anchor === "center") {
    const m = measureText({ ...el, id: "measure" });
    el.x = r1(at.x - m.w / 2);
    el.y = r1(at.y - m.h / 2);
  }
  return el;
}

const line = (x1: number, y1: number, x2: number, y2: number, color: string, size = 3, arrow = false): FigurePart => ({
  type: "line", color, size, x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), ...(arrow ? { arrow } : {}),
});

/** A long working block split into equations of at most 2000 characters (the canvas's limit). */
function chunks(steps: string[]): string[][] {
  const out: string[][] = [[]];
  for (const s of steps) {
    const cur = out[out.length - 1];
    if (cur.length && stepsToTex([...cur, s]).length > 1900) out.push([s]);
    else cur.push(s);
  }
  return out.filter((c) => c.length);
}

/** Working lines stacked under `top`; returns the parts and where they end. */
async function working(measure: Measure, steps: string[], x: number, top: number, size: number, color: string) {
  const parts: FigurePart[] = [];
  let y = top;
  for (const c of chunks(steps)) {
    const m = await math(measure, stepsToTex(c), { x, y }, size, color);
    parts.push(m);
    y += m.h + size;
  }
  return { parts, bottom: y };
}

// ------------------------------------------------------------ triangle

export async function triangleFigure(solution: TriangleSolution, caseName: string, ink: string, measure: Measure): Promise<FigurePart[]> {
  const t = solution.triangle;
  const k = triangleCorners(t, 280);
  const V = { A: k.A, B: k.B, C: k.C };
  const G = [(k.A[0] + k.B[0] + k.C[0]) / 3, (k.A[1] + k.B[1] + k.C[1]) / 3];
  const unit = (dx: number, dy: number) => {
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const parts: FigurePart[] = [
    line(k.A[0], k.A[1], k.B[0], k.B[1], ink),
    line(k.B[0], k.B[1], k.C[0], k.C[1], ink),
    line(k.C[0], k.C[1], k.A[0], k.A[1], ink),
  ];
  for (const name of ["A", "B", "C"] as const) {
    const [vx, vy] = V[name];
    const [ox, oy] = unit(vx - G[0], vy - G[1]);
    parts.push(text(name, { x: vx + ox * 24, y: vy + oy * 24 }, 24, ink, "center"));
    const angle = t[name];
    if (Math.abs(angle - 90) < 1e-6) {
      // The little square in a right angle.
      const others = (["A", "B", "C"] as const).filter((n) => n !== name).map((n) => V[n]);
      const [u1x, u1y] = unit(others[0][0] - vx, others[0][1] - vy);
      const [u2x, u2y] = unit(others[1][0] - vx, others[1][1] - vy);
      const s = 16;
      parts.push(line(vx + u1x * s, vy + u1y * s, vx + (u1x + u2x) * s, vy + (u1y + u2y) * s, ink, 2));
      parts.push(line(vx + u2x * s, vy + u2y * s, vx + (u1x + u2x) * s, vy + (u1y + u2y) * s, ink, 2));
    }
    const [ix, iy] = unit(G[0] - vx, G[1] - vy);
    const reach = Math.min(58, Math.hypot(G[0] - vx, G[1] - vy) * 0.6);
    parts.push(await math(measure, `${fmt(angle)}^\\circ`, { x: vx + ix * reach, y: vy + iy * reach }, 15, FIGURE_COLORS.accent, "center"));
  }
  const sides = { a: ["B", "C"], b: ["C", "A"], c: ["A", "B"] } as const;
  for (const side of ["a", "b", "c"] as const) {
    const [p, q] = sides[side].map((n) => V[n]);
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const [ox, oy] = unit(mx - G[0], my - G[1]);
    parts.push(await math(measure, `${side} = ${fmt(t[side])}`, { x: mx + ox * 26, y: my + oy * 26 }, 17, ink, "center"));
  }
  const bottom = Math.max(k.A[1], k.B[1], k.C[1]) + 56;
  const left = Math.min(k.A[0], k.B[0], k.C[0]) - 20;
  parts.push(text(`Triangle (${caseName})`, { x: left, y: bottom }, 20, FIGURE_COLORS.muted));
  const steps = [
    ...solution.steps,
    `\\text{Perimeter} = ${fmt(solution.perimeter)}`,
  ];
  parts.push(...(await working(measure, steps, left, bottom + 20 * TEXT_LINE_HEIGHT + 10, 17, ink)).parts);
  return parts;
}

// ------------------------------------------------------------ unit circle

export async function unitCircleFigure(degrees: number | null, unit: AngleUnit, answer: { tex: string; steps: string[] } | null, ink: string, measure: Measure): Promise<FigurePart[]> {
  const R = 190;
  const parts: FigurePart[] = [
    { type: "ellipse", color: ink, size: 2.5, fill: null, x: -R, y: -R, w: 2 * R, h: 2 * R },
    line(-R - 40, 0, R + 40, 0, FIGURE_COLORS.muted, 2, true),
    line(0, R + 40, 0, -R - 40, FIGURE_COLORS.muted, 2, true),
  ];
  for (const a of UNIT_CIRCLE_ANGLES) {
    const r = (a * Math.PI) / 180;
    const x = Math.cos(r) * R;
    const y = -Math.sin(r) * R;
    parts.push({ type: "ellipse", color: ink, size: 1, fill: ink, x: r1(x - 4), y: r1(y - 4), w: 8, h: 8 });
    const label = unit === "deg" ? `${a}^\\circ` : radiansTex(a);
    parts.push(await math(measure, label, { x: Math.cos(r) * (R + 30), y: -Math.sin(r) * (R + 30) }, 14, FIGURE_COLORS.muted, "center"));
  }
  if (degrees !== null) {
    const r = (degrees * Math.PI) / 180;
    const x = Math.cos(r) * R;
    const y = -Math.sin(r) * R;
    parts.push(line(0, 0, x, y, FIGURE_COLORS.accent, 3));
    parts.push(line(x, y, x, 0, FIGURE_COLORS.accent, 1.5));
    parts.push({ type: "ellipse", color: FIGURE_COLORS.accent, size: 1, fill: FIGURE_COLORS.accent, x: r1(x - 7), y: r1(y - 7), w: 14, h: 14 });
    const p = unitPoint(degrees);
    const coords = p.xTex !== null ? `(${p.xTex},\\ ${p.yTex})` : `(${fmt(p.x, 3)},\\ ${fmt(p.y, 3)})`;
    parts.push(await math(measure, coords, { x: x * 0.6, y: y * 0.6 - 16 }, 16, FIGURE_COLORS.accent, "center"));
    parts.push(await math(measure, `\\theta = ${unit === "deg" ? `${fmt(degrees)}^\\circ` : radiansTex(degrees)}`, { x: 14, y: 14 }, 15, FIGURE_COLORS.accent));
  }
  if (answer) parts.push(...(await working(measure, answer.steps, -R - 40, R + 60, 18, ink)).parts);
  return parts;
}

// ------------------------------------------------------------ two-column proof

export async function proofFigure(proof: Proof, verdict: ProofVerdict | null, ink: string): Promise<FigurePart[]> {
  const fs = 19;
  const pad = 14;
  const rows = proof.rows.filter((r) => r.statement.trim() || r.reason.trim());
  const width = (s: string) => measureText({ id: "m", type: "text", text: s, x: 0, y: 0, fontSize: fs, color: ink, font: "sans" }).w;
  const statements = rows.map((r, i) => `${i + 1}.  ${r.statement.trim()}`);
  const col1 = Math.max(240, ...statements.map(width), width("Statements")) + pad * 2;
  const col2 = Math.max(200, ...rows.map((r) => width(r.reason.trim())), width("Reasons")) + pad * 2;
  const rowH = fs * TEXT_LINE_HEIGHT + pad * 1.4;
  const parts: FigurePart[] = [];
  let y = 0;
  if (proof.given.trim()) {
    parts.push(text(`Given: ${proof.given.trim()}`, { x: 0, y }, fs, ink));
    y += fs * TEXT_LINE_HEIGHT + 6;
  }
  parts.push(text(`Prove: ${proof.prove.trim()}`, { x: 0, y }, fs, ink));
  y += fs * TEXT_LINE_HEIGHT + 16;
  const top = y;
  const total = rowH * (rows.length + 1);
  parts.push({ type: "rect", color: ink, size: 2, fill: FIGURE_COLORS.fill, x: 0, y: top, w: r1(col1 + col2), h: r1(rowH) });
  parts.push({ type: "rect", color: ink, size: 2, fill: null, x: 0, y: top, w: r1(col1 + col2), h: r1(total) });
  parts.push(line(col1, top, col1, top + total, ink, 2));
  parts.push(text("Statements", { x: pad, y: top + pad * 0.7 }, fs, ink));
  parts.push(text("Reasons", { x: col1 + pad, y: top + pad * 0.7 }, fs, ink));
  rows.forEach((r, i) => {
    const rowTop = top + rowH * (i + 1);
    parts.push(line(0, rowTop, col1 + col2, rowTop, FIGURE_COLORS.muted, 1));
    const v = verdict?.lines[i];
    const color = v && !v.ok ? FIGURE_COLORS.bad : ink;
    parts.push(text(statements[i], { x: pad, y: rowTop + pad * 0.7 }, fs, color));
    parts.push(text(r.reason.trim() || "?", { x: col1 + pad, y: rowTop + pad * 0.7 }, fs, color));
    if (v) {
      parts.push(text(v.ok ? "✓" : "✗", { x: col1 + col2 + 12, y: rowTop + pad * 0.7 }, fs, v.ok ? FIGURE_COLORS.good : FIGURE_COLORS.bad));
      if (!v.ok && v.note) parts.push(text(v.note, { x: col1 + col2 + 40, y: rowTop + pad * 0.7 }, fs * 0.8, FIGURE_COLORS.bad));
    }
  });
  if (verdict?.summary) {
    parts.push(text(verdict.summary, { x: 0, y: top + total + 16 }, fs * 0.85, verdict.valid ? FIGURE_COLORS.good : FIGURE_COLORS.bad));
  }
  return parts;
}

// ------------------------------------------------------------ worksheets

/** A letter page at 96 px per inch, with half-inch margins. */
export const PAGE = { w: 816, h: 1056, margin: 56 };

/**
 * The worksheet as frames: numbered problems with room to work, as many
 * pages as it takes, and the answer key on its own page to the right.
 */
export async function worksheetFigure(sheet: Worksheet, ink: string, measure: Measure, opts: { workSpace?: number; key?: boolean } = {}): Promise<FigurePart[]> {
  const workSpace = opts.workSpace ?? 120;
  const parts: FigurePart[] = [];
  const pages: number[] = [];
  const size = 22;
  const startPage = (index: number) => {
    pages.push(index);
    return index * (PAGE.h + 80);
  };
  let pageTop = startPage(0);
  let y = pageTop + PAGE.margin;
  parts.push(text(sheet.title, { x: PAGE.margin, y }, 32, ink));
  y += 32 * TEXT_LINE_HEIGHT + 6;
  parts.push(text("Name: ______________________    Date: __________", { x: PAGE.margin, y }, 16, FIGURE_COLORS.muted));
  y += 16 * TEXT_LINE_HEIGHT + 10;
  parts.push(text(sheet.instructions, { x: PAGE.margin, y }, 18, ink));
  y += 18 * TEXT_LINE_HEIGHT + 24;
  for (const [i, p] of sheet.problems.entries()) {
    const m = await measure(p.prompt);
    const h = m.height * size;
    if (y + h + workSpace > pageTop + PAGE.h - PAGE.margin) {
      pageTop = startPage(pages.length);
      y = pageTop + PAGE.margin;
    }
    parts.push(text(`${i + 1}.`, { x: PAGE.margin, y: y + Math.max(0, h / 2 - (size * TEXT_LINE_HEIGHT) / 2) }, size, ink));
    parts.push(await math(measure, p.prompt, { x: PAGE.margin + 44, y }, size, ink));
    y += h + workSpace;
  }
  const many = pages.length > 1;
  for (const index of pages) {
    parts.push({
      type: "frame",
      x: 0,
      y: index * (PAGE.h + 80),
      w: PAGE.w,
      h: PAGE.h,
      title: `${sheet.title.slice(0, 60)}${many ? ` (page ${index + 1})` : ""}`,
      order: 0,
    });
  }
  const keyed = sheet.problems.filter((p) => p.answer);
  if (opts.key !== false && keyed.length) {
    const left = PAGE.w + 80;
    let ky = PAGE.margin;
    parts.push({ type: "frame", x: left, y: 0, w: PAGE.w, h: PAGE.h, title: "Answer key", order: 0 });
    parts.push(text(`Answer key: ${sheet.title}`, { x: left + PAGE.margin, y: ky }, 28, ink));
    ky += 28 * TEXT_LINE_HEIGHT + 20;
    for (const [i, p] of sheet.problems.entries()) {
      if (!p.answer) continue;
      const m = await math(measure, p.answer, { x: left + PAGE.margin + 44, y: ky }, 20, ink);
      if (ky + m.h > PAGE.h - PAGE.margin) break;
      parts.push(text(`${i + 1}.`, { x: left + PAGE.margin, y: ky }, 20, FIGURE_COLORS.muted));
      parts.push(m);
      ky += Math.max(m.h, 20 * TEXT_LINE_HEIGHT) + 16;
    }
  }
  return parts;
}

/** Steps as one figure (chemistry and trig results). */
export async function stepsFigure(steps: string[], ink: string, measure: Measure): Promise<FigurePart[]> {
  return (await working(measure, steps, 0, 0, 20, ink)).parts;
}
