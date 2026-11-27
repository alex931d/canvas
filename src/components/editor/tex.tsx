"use client";

import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";

import katex from "katex";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * LaTeX (and mhchem's \ce{}) rendered with KaTeX, for panels and cards.
 * KaTeX output is safe to inject: trust is off, so no links or raw HTML.
 */
export function Tex({ latex, display = false, className }: { latex: string; display?: boolean; className?: string }) {
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

/** Working lines, one under another, scrolling sideways when they're wide. */
export function TexSteps({ steps, className }: { steps: string[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-2 overflow-x-auto text-sm", className)} data-testid="tex-steps">
      {steps.map((s, i) => (
        <li key={i} className="min-w-max">
          <Tex latex={`\\displaystyle ${s}`} />
        </li>
      ))}
    </ol>
  );
}
