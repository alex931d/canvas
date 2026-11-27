"use client";

import "katex/contrib/mhchem";

import katex from "katex";
import type { Worksheet } from "@/lib/math/worksheet";

/**
 * Prints a worksheet (or saves it as a PDF from the print dialog): the
 * problems with room to work, then the answer key on a page of its own.
 * Built in a hidden frame with the page's own styles, so KaTeX's fonts load.
 */

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const tex = (latex: string) =>
  katex.renderToString(latex, { displayMode: false, throwOnError: false, strict: "ignore", trust: false, output: "html" });

export function worksheetHtml(sheet: Worksheet, opts: { workSpace: number; key: boolean }): string {
  const problems = sheet.problems
    .map(
      (p, i) => `<li style="min-height:${opts.workSpace}px"><span class="n">${i + 1}.</span><span class="p">${tex(p.prompt)}</span></li>`,
    )
    .join("");
  const keyed = sheet.problems.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => p.answer);
  const key =
    opts.key && keyed.length
      ? `<section class="key"><h2>Answer key</h2><ol>${keyed
          .map((p) => `<li><span class="n">${p.n}.</span><span class="p">${tex(p.answer!)}</span></li>`)
          .join("")}</ol></section>`
      : "";
  return `<main>
  <h1>${escape(sheet.title)}</h1>
  <p class="meta">Name: ________________________ &nbsp;&nbsp; Date: ____________</p>
  <p class="instructions">${escape(sheet.instructions)}</p>
  <ol class="problems">${problems}</ol>
  ${key}
</main>`;
}

const PRINT_CSS = `
  @page { size: letter; margin: 0.6in; }
  html, body { background: #fff !important; color: #111; margin: 0; }
  body { font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 22px; margin: 0 0 16px; }
  .meta { color: #555; margin: 0 0 10px; }
  .instructions { margin: 0 0 20px; }
  ol { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 12px; align-items: baseline; break-inside: avoid; margin-bottom: 10px; }
  .n { font-weight: 700; min-width: 28px; }
  .p .katex { font-size: 1.2em; }
  .key { break-before: page; }
  .key li { margin-bottom: 12px; }
`;

/** Opens the print dialog for the worksheet. Resolves once it's been shown. */
export async function printWorksheet(sheet: Worksheet, opts: { workSpace: number; key: boolean }): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  // The page's stylesheets carry KaTeX's CSS and font URLs.
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("\n");
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(sheet.title)}</title>${styles}<style>${PRINT_CSS}</style></head><body>${worksheetHtml(sheet, opts)}</body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  await new Promise<void>((resolve) => {
    if (doc.readyState === "complete") resolve();
    else win.addEventListener("load", () => resolve(), { once: true });
  });
  await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
  win.focus();
  win.print();
  // Printing blocks in most browsers; give the rest a moment before removing the frame.
  setTimeout(() => frame.remove(), 60_000);
}
