"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Kbd } from "@/components/kit";
import type { MathElement } from "@/lib/canvas/schema";
import { drawMathLayout, errorMessage, texSource, typesetMath } from "@/lib/math/layout";
import type { MathLayout } from "@/lib/math/layout-types";
import { cn } from "@/lib/utils";

/**
 * Popover for typing an equation (LaTeX) or a chemical equation (mhchem),
 * with a live preview drawn the same way the canvas draws it.
 */

export type EquationValue = { syntax: MathElement["syntax"]; source: string; layout: MathLayout };

type Snippet = { label: string; insert: string; title: string; caret?: number };

// `caret` = where the cursor goes, counted from the start of the insert.
const MATH_SNIPPETS: Snippet[] = [
  { label: "a⁄b", insert: "\\frac{}{}", caret: 6, title: "Fraction" },
  { label: "√", insert: "\\sqrt{}", caret: 6, title: "Square root" },
  { label: "xⁿ", insert: "^{}", caret: 2, title: "Power" },
  { label: "xₙ", insert: "_{}", caret: 2, title: "Subscript" },
  { label: "∫", insert: "\\int_{}^{} ", caret: 6, title: "Integral" },
  { label: "Σ", insert: "\\sum_{}^{} ", caret: 6, title: "Sum" },
  { label: "lim", insert: "\\lim_{x \\to } ", caret: 13, title: "Limit" },
  { label: "π", insert: "\\pi ", title: "Pi" },
  { label: "θ", insert: "\\theta ", title: "Theta" },
  { label: "Δ", insert: "\\Delta ", title: "Delta" },
  { label: "±", insert: "\\pm ", title: "Plus or minus" },
  { label: "≤", insert: "\\le ", title: "Less than or equal" },
  { label: "≥", insert: "\\ge ", title: "Greater than or equal" },
  { label: "≠", insert: "\\ne ", title: "Not equal" },
  { label: "∞", insert: "\\infty ", title: "Infinity" },
  { label: "→", insert: "\\to ", title: "Arrow" },
];

const CHEM_SNIPPETS: Snippet[] = [
  { label: "→", insert: " -> ", title: "Reaction arrow" },
  { label: "⇌", insert: " <=> ", title: "Equilibrium" },
  { label: "Δ→", insert: " ->[\\Delta] ", title: "Arrow with heat" },
  { label: "x²⁺", insert: "^{2+}", title: "Charge" },
  { label: "·", insert: "*", title: "Hydrate dot (CuSO4*5H2O)" },
  { label: "↑", insert: " ^", title: "Gas given off" },
  { label: "↓", insert: " v", title: "Precipitate" },
  { label: "(aq)", insert: "(aq)", title: "Aqueous" },
  { label: "(s)", insert: "(s)", title: "Solid" },
  { label: "(l)", insert: "(l)", title: "Liquid" },
  { label: "(g)", insert: "(g)", title: "Gas" },
];

const PLACEHOLDER = {
  tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  chem: "2H2 + O2 -> 2H2O",
};

type Preview =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; layout: MathLayout }
  | { status: "error"; message: string };

export function EquationEditor({
  initial,
  color,
  style,
  onSubmit,
  onCancel,
}: {
  initial: Pick<MathElement, "syntax" | "source"> | null;
  color: string;
  style: CSSProperties;
  onSubmit: (value: EquationValue) => void;
  onCancel: () => void;
}) {
  const [syntax, setSyntax] = useState<MathElement["syntax"]>(initial?.syntax ?? "tex");
  const [source, setSource] = useState(initial?.source ?? "");
  const [preview, setPreview] = useState<Preview>({ status: "empty" });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Typeset as you type (debounced); stale results are ignored.
  useEffect(() => {
    const text = source.trim();
    let stale = false;
    const t = setTimeout(
      () => {
        if (!text) {
          setPreview({ status: "empty" });
          return;
        }
        setPreview((p) => (p.status === "ready" ? p : { status: "loading" }));
        typesetMath(texSource({ syntax, source: text })).then(
          (layout) => !stale && setPreview({ status: "ready", layout }),
          (err: unknown) => !stale && setPreview({ status: "error", message: explain(errorMessage(err)) }),
        );
      },
      text ? 150 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [source, syntax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || preview.status !== "ready") return;
    const { layout } = preview;
    const dpr = window.devicePixelRatio || 1;
    const maxW = canvas.parentElement!.clientWidth - 24;
    const size = Math.min(30, maxW / Math.max(layout.width, 0.1), 96 / Math.max(layout.height, 0.1));
    const w = layout.width * size;
    const h = layout.height * size;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawMathLayout(ctx, layout, 0, 0, w, h, color === "#ffffff" ? "#201f24" : color);
  }, [preview, color]);

  const insert = (s: Snippet) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = source.slice(0, start) + s.insert + source.slice(end);
    setSource(next);
    const caret = start + (s.caret ?? s.insert.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const submit = () => {
    if (preview.status === "ready" && source.trim()) onSubmit({ syntax, source: source.trim(), layout: preview.layout });
  };

  const snippets = syntax === "tex" ? MATH_SNIPPETS : CHEM_SNIPPETS;

  return (
    <div
      role="dialog"
      aria-label={initial ? "Edit equation" : "New equation"}
      className="absolute z-30 flex w-[min(400px,calc(100%-24px))] flex-col gap-3 rounded-xl border bg-card p-3 shadow-float"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Kind" className="inline-flex rounded-lg bg-muted p-[3px] text-sm">
          {(
            [
              ["tex", "Math"],
              ["chem", "Chemistry"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={syntax === value}
              onClick={() => {
                setSyntax(value);
                inputRef.current?.focus();
              }}
              className={cn(
                "rounded-md px-3 py-1 font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                syntax === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {syntax === "tex" ? "LaTeX" : "mhchem: H2O, Fe^3+, ->"}
        </span>
      </div>

      <textarea
        ref={inputRef}
        aria-label={syntax === "tex" ? "Equation in LaTeX" : "Chemical equation"}
        value={source}
        rows={2}
        spellCheck={false}
        placeholder={PLACEHOLDER[syntax]}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />

      <div className="flex flex-wrap gap-1" aria-label="Insert">
        {snippets.map((s) => (
          <button
            key={s.title}
            type="button"
            title={s.title}
            aria-label={s.title}
            onClick={() => insert(s)}
            className="h-7 min-w-8 rounded-md bg-muted px-2 text-sm font-medium text-foreground transition-colors hover:bg-grey-300/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        className="flex min-h-16 items-center justify-center overflow-hidden rounded-lg bg-beige-100 p-3"
        aria-live="polite"
        data-testid="equation-preview"
      >
        {preview.status === "ready" ? (
          <canvas ref={canvasRef} role="img" aria-label="Preview" />
        ) : preview.status === "loading" ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Typesetting" />
        ) : preview.status === "error" ? (
          <p className="text-sm text-red">{preview.message}</p>
        ) : (
          <p className="text-sm text-muted-foreground">The preview shows here as you type.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">
          <Kbd>Enter</Kbd> to {initial ? "save" : "add"}, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={preview.status !== "ready" || !source.trim()}>
          {initial ? "Save" : "Add equation"}
        </Button>
      </div>
    </div>
  );
}

/** MathJax's messages, phrased for students. */
function explain(message: string): string {
  if (/Missing close brace/i.test(message)) return 'A "{" is never closed: add "}".';
  if (/Extra close brace/i.test(message)) return 'There\'s a "}" without a matching "{".';
  const undefinedCs = message.match(/Undefined control sequence (\\\w+)/i);
  if (undefinedCs) return `${undefinedCs[1]} isn't a command I know.`;
  if (/Missing argument/i.test(message)) return "A command is missing its {…} part.";
  if (/Double exponent/i.test(message)) return "Two ^ in a row: wrap one in braces, like x^{a^b}.";
  if (/Double subscripts/i.test(message)) return "Two _ in a row: wrap one in braces, like x_{a_b}.";
  if (/import|fetch|chunk|load/i.test(message)) return "Couldn't load the equation tools. Check your connection.";
  return message;
}
