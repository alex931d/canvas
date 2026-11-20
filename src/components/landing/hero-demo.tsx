import "katex/dist/katex.min.css";
import "./hero-demo.css";

import katex from "katex";
import { CircleCheck, CircleX, Copy, NotebookPen, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Badge, buttonClasses } from "@/components/kit";
import { cn } from "@/lib/utils";

/**
 * The landing page's opening scene: a piece of canvas with handwritten
 * algebra, a lasso drawn around it and the Math check card the editor shows,
 * built from the same pieces and styles as the real editor. It plays once
 * (see hero-demo.css) and is static for reduced motion.
 *
 * Coordinates are CSS pixels inside a fixed 320 × 306 block, so the lasso
 * path, the cursor's motion path and the text line up at every screen size.
 */

/** When each piece starts, in ms after load. */
const T = {
  lines: [250, 1150, 1700, 2250],
  lineMs: [560, 500, 500, 260],
  swipe: 850,
  lasso: 2650,
  lassoMs: 900,
  lassoDone: 3500,
  toolbar: 3600,
  card: 3900,
};

const LINES = ["3(x - 2) = 2x + 5", "3x - 6 = 2x + 5", "3x - 2x = 5 - 6", "x = -1"];
const LINE_TOP = [56, 106, 156, 206];

/** A hand-drawn loop around the four lines, slightly overshooting where it closes. */
const LASSO =
  "M 44 60 C 112 40, 238 38, 290 54 C 320 64, 316 128, 308 184 C 300 244, 268 284, 186 290 C 112 296, 30 286, 16 238 C 4 192, 6 114, 22 80 C 28 68, 44 59, 66 56";

const delay = (ms: number, dur?: number) =>
  ({ "--delay": `${ms}ms`, ...(dur ? { "--dur": `${dur}ms` } : {}) }) as CSSProperties;

/** KaTeX markup is safe to inject: trust is off, so no links or raw HTML. */
function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "html",
  });
  return <span className="[&_.katex]:text-[1.05em]" dangerouslySetInnerHTML={{ __html: html }} />;
}

const STEPS = [
  { latex: "3x - 6 = 2x + 5", ok: true },
  { latex: "3x - 2x = 5 - 6", ok: false, note: "−6 becomes +6 on the other side." },
  { latex: "x = -1", ok: false, note: "Follows from the slip above." },
];

/** A still copy of the editor's Math check card (src/components/editor/math-card.tsx). */
function VerdictCard({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn("w-[21rem] max-w-full overflow-hidden rounded-xl border bg-card text-left shadow-float", className)}
      style={style}
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <span className="flex items-center gap-2 text-base font-bold">
          <Sparkles className="size-4 text-green" />
          Math check
        </span>
        <span className="flex items-center gap-2">
          <Badge tone="red">Mistake found</Badge>
          <X className="size-4 text-grey-500" />
        </span>
      </div>

      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="text-[0.95rem] leading-relaxed">
          Line 3 moves −6 across without flipping its sign, so x should be 11.
        </p>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Step by step</p>
          <ol className="space-y-2">
            {STEPS.map((step) => {
              const Icon = step.ok ? CircleCheck : CircleX;
              return (
                <li key={step.latex} className={cn("border-l-4 py-1 pl-3", step.ok ? "border-green" : "border-red")}>
                  <div className="flex items-start gap-2">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", step.ok ? "text-green" : "text-red")} />
                    <Tex latex={step.latex} />
                  </div>
                  {step.note ? <p className="mt-1 text-xs text-muted-foreground">{step.note}</p> : null}
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Should be</p>
          <div className="rounded-lg border-l-4 border-green bg-beige-100 px-3 py-0.5 [&_.katex-display]:my-2.5">
            <Tex latex="x = 11" display />
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t px-5 py-3">
        <span className={buttonClasses({ size: "sm" })}>
          <NotebookPen /> Add note to canvas
        </span>
        <span className={buttonClasses({ size: "sm", variant: "ghost" })}>
          <RotateCcw /> Check again
        </span>
      </div>
    </div>
  );
}

export function HeroDemo({ className }: { className?: string }) {
  return (
    <figure
      role="img"
      aria-label="Example: handwritten working for 3(x − 2) = 2x + 5 is circled with the lasso. The Math check card marks 3x − 2x = 5 − 6 as the mistake and says x should be 11."
      className={cn("relative w-full max-w-[632px] select-none min-[800px]:h-[524px]", className)}
    >
      {/* The work on the canvas */}
      <div className="relative h-[306px] w-[320px] max-[379px]:[zoom:0.88]">
        <p className="absolute top-0 left-6 text-lg text-grey-900">Solve for x</p>

        {/* Highlighter, under the text like the real one */}
        <svg className="absolute inset-0 overflow-visible" width="320" height="306" viewBox="0 0 320 306" aria-hidden>
          <path
            d="M 24 98 L 268 96"
            pathLength={1}
            fill="none"
            stroke="#82c9d7"
            strokeOpacity={0.55}
            strokeWidth={17}
            className="hero-swipe"
            style={{ ...delay(T.swipe, 300), mixBlendMode: "multiply" }}
          />
        </svg>

        {LINES.map((line, i) => (
          <p
            key={line}
            className="hero-write absolute left-5 px-1 py-2 font-hand text-[38px] leading-none whitespace-nowrap text-grey-900"
            style={{ top: LINE_TOP[i], ...delay(T.lines[i], T.lineMs[i]) }}
          >
            {line}
          </p>
        ))}

        {/* The lasso: drawn as a solid line, then shown as the selection */}
        <svg className="absolute inset-0 overflow-visible" width="320" height="306" viewBox="0 0 320 306" aria-hidden>
          <path
            d={`${LASSO} Z`}
            fill="#277c78"
            fillOpacity={0.07}
            stroke="#277c78"
            strokeWidth={1.6}
            strokeDasharray="6 5"
            className="hero-appear"
            style={delay(T.lassoDone)}
          />
          <path
            d={LASSO}
            pathLength={1}
            fill="none"
            stroke="#277c78"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="hero-lasso-draw"
            style={delay(T.lasso, T.lassoMs)}
          />
        </svg>

        {/* Pointer that draws the loop */}
        <svg
          className="hero-cursor absolute top-0 left-0 drop-shadow-sm"
          style={{ offsetPath: `path("${LASSO}")`, ...delay(T.lasso, T.lassoMs) }}
          width="20"
          height="22"
          viewBox="0 0 20 22"
          aria-hidden
        >
          <path
            d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.2 19.3 L10.3 13 L16.5 13 Z"
            fill="#201f24"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>

        {/* The selection toolbar */}
        <div
          className="hero-pop absolute top-0 -right-4 flex items-center gap-0.5 rounded-lg border bg-white p-1 whitespace-nowrap shadow-float"
          style={delay(T.toolbar)}
        >
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-green px-3 text-sm font-medium text-white">
            <Sparkles className="size-4" />
            Check math
          </span>
          <span className="grid size-8 place-items-center text-grey-900">
            <Copy className="size-4" />
          </span>
          <span className="grid size-8 place-items-center text-grey-900">
            <Trash2 className="size-4" />
          </span>
        </div>
      </div>

      {/* The verdict, beside the selection like in the editor */}
      <VerdictCard
        className="hero-card mt-5 min-[800px]:absolute min-[800px]:top-[58px] min-[800px]:left-[296px] min-[800px]:mt-0"
        style={delay(T.card)}
      />
    </figure>
  );
}
