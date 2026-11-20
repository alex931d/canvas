"use client";

import "katex/dist/katex.min.css";

import katex from "katex";
import { CircleCheck, CircleQuestionMark, CircleX, NotebookPen, RotateCcw, Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Skeleton, type BadgeTone } from "@/components/kit";
import type { MathCheck } from "@/lib/ai/math-check-schema";
import { cn } from "@/lib/utils";

export type MathState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "done"; result: MathCheck };

const VERDICT: Record<MathCheck["verdict"], { label: string; tone: BadgeTone }> = {
  correct: { label: "Correct", tone: "green" },
  incorrect: { label: "Mistake found", tone: "red" },
  partially_correct: { label: "Almost: a slip", tone: "orange" },
  not_math: { label: "No math found", tone: "neutral" },
  unreadable: { label: "Couldn't read it", tone: "neutral" },
};

/** KaTeX output is safe to inject: trust is off, so no links or raw HTML. */
function Tex({ latex, display = false, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "html",
      }),
    [latex, display],
  );
  return <span className={cn("[&_.katex]:text-[1.05em]", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathCard({
  state,
  style,
  onClose,
  onRetry,
  onAddNote,
}: {
  state: MathState;
  style: React.CSSProperties;
  onClose: () => void;
  onRetry: () => void;
  onAddNote: (result: MathCheck) => void;
}) {
  return (
    <section
      aria-label="Math check"
      aria-live="polite"
      className="absolute z-30 flex max-h-[min(34rem,calc(100%-1.5rem))] w-[22rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-float"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Sparkles className="size-4 text-green" aria-hidden />
          Math check
        </h2>
        <div className="flex items-center gap-2">
          {state.status === "done" ? (
            <Badge tone={VERDICT[state.result.verdict].tone}>{VERDICT[state.result.verdict].label}</Badge>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close math check">
            <X />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
        {state.status === "loading" ? (
          <div className="space-y-3" aria-label="Checking">
            <p className="text-muted-foreground">Reading your selection and checking each step…</p>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : state.status === "error" ? (
          <div className="space-y-3">
            <p className="text-destructive">{state.error}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          </div>
        ) : (
          <Result result={state.result} />
        )}
      </div>

      {state.status === "done" ? (
        <footer className="flex gap-2 border-t px-5 py-3">
          <Button size="sm" onClick={() => onAddNote(state.result)}>
            <NotebookPen /> Add note to canvas
          </Button>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RotateCcw /> Check again
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

function Result({ result }: { result: MathCheck }) {
  return (
    <div className="space-y-4">
      {result.summary ? <p className="text-[0.95rem] leading-relaxed">{result.summary}</p> : null}

      {result.transcription ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">What I read</h3>
          <div className="relative overflow-x-auto rounded-lg bg-beige-100 px-3 py-2">
            <Tex latex={result.transcription} display />
          </div>
        </div>
      ) : null}

      {result.steps.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Step by step</h3>
          <ol className="space-y-2">
            {result.steps.map((step, i) => {
              const Icon =
                step.status === "correct" ? CircleCheck : step.status === "incorrect" ? CircleX : CircleQuestionMark;
              return (
                <li
                  key={i}
                  className={cn(
                    "border-l-4 py-1 pl-3",
                    step.status === "correct"
                      ? "border-green"
                      : step.status === "incorrect"
                        ? "border-red"
                        : "border-gold",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      aria-label={step.status}
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        step.status === "correct"
                          ? "text-green"
                          : step.status === "incorrect"
                            ? "text-red"
                            : "text-gold",
                      )}
                    />
                    <Tex latex={step.latex} className="relative min-w-0 overflow-x-auto" />
                  </div>
                  {step.note ? <p className="mt-1 text-xs text-muted-foreground">{step.note}</p> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {result.correction ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Should be</h3>
          <div className="relative overflow-x-auto rounded-lg border-l-4 border-green bg-beige-100 px-3 py-2">
            <Tex latex={result.correction} display />
          </div>
        </div>
      ) : null}
    </div>
  );
}
