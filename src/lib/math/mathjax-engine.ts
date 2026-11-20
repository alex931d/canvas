/**
 * TeX (and mhchem's \ce{}) to a list of vector drawing operations, via
 * MathJax 4's SVG output. Loaded on demand by ./layout.ts: it is large.
 *
 * MathJax runs with its "lite" DOM adaptor, so nothing touches the page.
 * Its SVG tree is flattened into paths and rects with absolute transforms,
 * which the canvas draws directly: equations stay sharp at any zoom and
 * export like any other ink.
 *
 * Only the base, ams, mhchem, color, cancel and boldsymbol TeX packages are
 * loaded: no \href, \class or other HTML-producing commands.
 */

import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { MathJaxMhchemFontExtension } from "@mathjax/mathjax-mhchem-font-extension/js/svg.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import type { MathLayout, MathOp, Matrix } from "./layout-types";

// Less common glyphs (script letters, extra arrows, Greek variants...) live
// in separate files that MathJax asks for while typesetting.
// prettier-ignore
const FONT_FILES: Record<string, () => Promise<unknown>> = {
  PUA: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js"),
  "accents-b-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js"),
  accents: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js"),
  arabic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js"),
  arrows: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js"),
  "braille-d": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js"),
  braille: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js"),
  calligraphic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js"),
  cherokee: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js"),
  "cyrillic-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js"),
  cyrillic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js"),
  devanagari: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js"),
  "double-struck": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js"),
  fraktur: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js"),
  "greek-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js"),
  greek: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js"),
  hebrew: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js"),
  "latin-b": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js"),
  "latin-bi": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js"),
  "latin-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js"),
  latin: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js"),
  marrows: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js"),
  math: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js"),
  "monospace-ex": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js"),
  "monospace-l": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js"),
  monospace: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js"),
  mshapes: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js"),
  "phonetics-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js"),
  phonetics: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js"),
  "sans-serif-b": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js"),
  "sans-serif-bi": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js"),
  "sans-serif-ex": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js"),
  "sans-serif-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js"),
  "sans-serif-r": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js"),
  "sans-serif": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js"),
  script: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js"),
  shapes: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js"),
  "symbols-b-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js"),
  symbols: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js"),
  variants: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js"),
};

mathjax.asyncLoad = (name: string) => {
  const file = name.replace(/^.*\//, "").replace(/\.js$/, "");
  const load = FONT_FILES[file];
  return load ? load() : Promise.reject(new Error(`MathJax asked for an unknown file: ${name}`));
};

MathJaxNewcmFont.addExtension(MathJaxMhchemFontExtension);

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: ["base", "ams", "mhchem", "color", "cancel", "boldsymbol"],
  // Throw instead of drawing a red error box, so the editor can explain it.
  formatError: (_jax: unknown, err: Error) => {
    throw err;
  },
});
const svg = new SVG({ fontData: MathJaxNewcmFont, fontCache: "none" });
const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });

type LiteNode = LiteElement;

/** Element children only (text nodes are read through textContent). */
const children = (node: LiteNode) =>
  (adaptor.childNodes(node) as LiteNode[]).filter((c) => !adaptor.kind(c).startsWith("#"));

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function parseTransform(attr: string | null | undefined): Matrix {
  let m = IDENTITY;
  if (!attr) return m;
  for (const [, fn, args] of attr.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let t: Matrix = IDENTITY;
    if (fn === "translate") t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (fn === "scale") t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (fn === "matrix" && v.length === 6) t = v as Matrix;
    else if (fn === "rotate") {
      const a = ((v[0] ?? 0) * Math.PI) / 180;
      t = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
    } else if (fn === "skewX") t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

type Paint = { fill: string | null; stroke: string | null; strokeWidth: number };

/** "currentColor" → null (the element's own color); "none" stays "none". */
function color(value: string | null | undefined, inherited: string | null): string | null {
  if (value === undefined || value === null || value === "") return inherited;
  return value === "currentColor" ? null : value;
}

const num = (v: string | null | undefined, fallback = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
};

function walk(node: LiteNode, parent: Matrix, paint: Paint, ops: MathOp[]) {
  const kind = adaptor.kind(node);
  if (kind === "title" || kind === "desc" || kind === "defs") return;
  const attr = (name: string) => adaptor.getAttribute(node, name) as string | null;

  let m = multiply(parent, parseTransform(attr("transform")));
  if (kind === "svg") {
    // Nested <svg> (rare: padded boxes): position it.
    m = multiply(m, [1, 0, 0, 1, num(attr("x")), num(attr("y"))]);
  }
  const p: Paint = {
    fill: color(attr("fill"), paint.fill),
    stroke: color(attr("stroke"), paint.stroke),
    strokeWidth: attr("stroke-width") !== null ? num(attr("stroke-width")) : paint.strokeWidth,
  };

  switch (kind) {
    case "path": {
      const d = attr("d");
      if (d) ops.push({ t: "path", d, m, ...p });
      return;
    }
    case "rect":
      ops.push({
        t: "rect",
        x: num(attr("x")),
        y: num(attr("y")),
        w: num(attr("width")),
        h: num(attr("height")),
        m,
        ...p,
      });
      return;
    case "line":
      ops.push({
        t: "line",
        x1: num(attr("x1")),
        y1: num(attr("y1")),
        x2: num(attr("x2")),
        y2: num(attr("y2")),
        m,
        ...p,
      });
      return;
    case "ellipse":
    case "circle": {
      const rx = kind === "circle" ? num(attr("r")) : num(attr("rx"));
      const ry = kind === "circle" ? num(attr("r")) : num(attr("ry"));
      const cx = num(attr("cx"));
      const cy = num(attr("cy"));
      // An ellipse as a path: two arcs.
      const d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
      ops.push({ t: "path", d, m, ...p });
      return;
    }
    case "polygon":
    case "polyline": {
      const pts = (attr("points") ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      if (kind === "polygon") d += "Z";
      ops.push({ t: "path", d, m, ...p });
      return;
    }
    case "text": {
      const text = adaptor.textContent(node);
      if (!text) return;
      ops.push({
        t: "text",
        text,
        x: num(attr("x")),
        y: num(attr("y")),
        size: num(attr("font-size"), 1000),
        family: attr("font-family") ?? "serif",
        weight: attr("font-weight") ?? "normal",
        style: attr("font-style") ?? "normal",
        m,
        ...p,
      });
      return;
    }
  }
  for (const child of children(node)) walk(child, m, p, ops);
}

/** Typeset TeX into a layout in em units. Throws on TeX errors. */
export async function typeset(latex: string): Promise<MathLayout> {
  const container = (await mathjax.handleRetriesFor(() => doc.convert(latex, { display: true }))) as LiteNode;
  const root = children(container).find((n) => adaptor.kind(n) === "svg");
  if (!root) throw new Error("Nothing to draw");
  const [minX, minY, width, height] = String(adaptor.getAttribute(root, "viewBox") ?? "0 0 0 0")
    .split(/[\s,]+/)
    .map(Number);
  // 1000 units per em; move the view box origin to the top-left corner.
  const base: Matrix = multiply([0.001, 0, 0, 0.001, 0, 0], [1, 0, 0, 1, -minX, -minY]);
  const ops: MathOp[] = [];
  const paint: Paint = { fill: null, stroke: null, strokeWidth: 0 };
  for (const child of children(root)) walk(child, base, paint, ops);
  return { width: width / 1000, height: height / 1000, ops };
}
