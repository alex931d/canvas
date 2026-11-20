"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Switch } from "@/components/kit";
import { fitYRange } from "@/lib/canvas/graph-render";
import type { GraphElement } from "@/lib/canvas/schema";
import { compiledOrError, ExprError } from "@/lib/math/expr";

/**
 * Popover for a graph: up to six functions of x, the visible ranges and the
 * grid. Every edit previews on the canvas right away (`onPreview`); "Done"
 * saves it as one change, Escape puts it back as it was.
 */

export const GRAPH_COLORS = ["#277c78", "#c94736", "#3f82b2", "#826cb0", "#be6c49", "#cab361"];

type Draft = {
  fns: { expr: string; color: string }[];
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  grid: boolean;
};

const toDraft = (el: GraphElement): Draft => ({
  fns: el.fns.map((f) => ({ ...f })),
  xMin: String(el.xMin),
  xMax: String(el.xMax),
  yMin: String(el.yMin),
  yMax: String(el.yMax),
  grid: el.grid,
});

function rangeError(min: string, max: string, axis: string): string | null {
  const a = Number(min);
  const b = Number(max);
  if (min.trim() === "" || max.trim() === "" || !Number.isFinite(a) || !Number.isFinite(b)) return `Enter both ${axis} limits.`;
  if (Math.abs(a) > 1e6 || Math.abs(b) > 1e6) return `Keep ${axis} between −1,000,000 and 1,000,000.`;
  if (a >= b) return `The ${axis} "to" value has to be bigger than "from".`;
  return null;
}

/** The draft as an element, or null while a range is invalid. */
function apply(base: GraphElement, d: Draft): GraphElement | null {
  if (rangeError(d.xMin, d.xMax, "x") || rangeError(d.yMin, d.yMax, "y")) return null;
  const fns = d.fns.filter((f) => f.expr.trim()).map((f) => ({ expr: f.expr.trim().slice(0, 200), color: f.color }));
  if (fns.length === 0) return null;
  return {
    ...base,
    fns,
    xMin: Number(d.xMin),
    xMax: Number(d.xMax),
    yMin: Number(d.yMin),
    yMax: Number(d.yMax),
    grid: d.grid,
  };
}

export function GraphEditor({
  element,
  style,
  onPreview,
  onDone,
  onCancel,
}: {
  element: GraphElement;
  style: CSSProperties;
  onPreview: (el: GraphElement) => void;
  onDone: (el: GraphElement) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(element));
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
    firstInput.current?.select();
  }, []);

  const update = (next: Draft) => {
    setDraft(next);
    const el = apply(element, next);
    if (el) onPreview(el);
  };

  const setFn = (i: number, patch: Partial<Draft["fns"][number]>) =>
    update({ ...draft, fns: draft.fns.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  const xError = rangeError(draft.xMin, draft.xMax, "x");
  const yError = rangeError(draft.yMin, draft.yMax, "y");
  const result = apply(element, draft);

  const fit = () => {
    if (!result) return;
    const r = fitYRange(result);
    if (r) update({ ...draft, yMin: String(r.yMin), yMax: String(r.yMax) });
  };

  const done = () => {
    if (result) onDone(result);
  };

  return (
    <div
      role="dialog"
      aria-label="Graph"
      className="absolute z-30 flex max-h-[calc(100%-24px)] w-[min(360px,calc(100%-24px))] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-3 shadow-float"
      style={style}
      data-scrollable
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          done();
        }
      }}
    >
      <p className="text-sm font-bold">Functions of x</p>
      <ul className="flex flex-col gap-2">
        {draft.fns.map((fn, i) => {
          const compiled = fn.expr.trim() ? compiledOrError(fn.expr) : null;
          const error = compiled instanceof ExprError ? compiled.message : null;
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Change colour of function ${i + 1}`}
                  title="Change colour"
                  className="size-5 shrink-0 rounded-full ring-2 ring-white outline-none ring-offset-1 focus-visible:ring-ring"
                  style={{ backgroundColor: fn.color, boxShadow: `0 0 0 1px ${fn.color}` }}
                  onClick={() => setFn(i, { color: GRAPH_COLORS[(GRAPH_COLORS.indexOf(fn.color) + 1) % GRAPH_COLORS.length] })}
                />
                <label className="flex min-w-0 flex-1 items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
                  <span className="pl-3 font-mono text-sm text-muted-foreground">y&nbsp;=</span>
                  <input
                    ref={i === 0 ? firstInput : undefined}
                    aria-label={`Function ${i + 1}`}
                    aria-invalid={!!error}
                    value={fn.expr}
                    maxLength={200}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="sin(x)"
                    onChange={(e) => setFn(i, { expr: e.target.value })}
                    className="h-9 min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none"
                  />
                </label>
                {draft.fns.length > 1 ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove function ${i + 1}`}
                    onClick={() => update({ ...draft, fns: draft.fns.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
              {error ? <p className="pl-7 text-xs text-red">{error}</p> : null}
            </li>
          );
        })}
      </ul>
      {draft.fns.length < 6 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() =>
            update({
              ...draft,
              fns: [
                ...draft.fns,
                { expr: "", color: GRAPH_COLORS.find((c) => !draft.fns.some((f) => f.color === c)) ?? GRAPH_COLORS[0] },
              ],
            })
          }
        >
          <Plus /> Add function
        </Button>
      ) : null}

      <fieldset className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-2 text-sm">
        <legend className="mb-2 text-sm font-bold">Window</legend>
        <RangeInputs axis="x" min={draft.xMin} max={draft.xMax} onChange={(a, b) => update({ ...draft, xMin: a, xMax: b })} />
        <RangeInputs axis="y" min={draft.yMin} max={draft.yMax} onChange={(a, b) => update({ ...draft, yMin: a, yMax: b })} />
      </fieldset>
      {xError || yError ? <p className="text-xs text-red">{xError ?? yError}</p> : null}

      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={fit} disabled={!result}>
          Fit y to the curves
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch checked={draft.grid} onCheckedChange={(grid) => update({ ...draft, grid })} aria-label="Grid" />
          Grid
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={done} disabled={!result}>
          Done
        </Button>
      </div>
    </div>
  );
}

function RangeInputs({
  axis,
  min,
  max,
  onChange,
}: {
  axis: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
}) {
  const cls =
    "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40";
  return (
    <>
      <span className="text-muted-foreground">{axis} from</span>
      <input aria-label={`${axis} from`} inputMode="decimal" value={min} onChange={(e) => onChange(e.target.value, max)} className={cls} />
      <span className="text-muted-foreground">to</span>
      <input aria-label={`${axis} to`} inputMode="decimal" value={max} onChange={(e) => onChange(min, e.target.value)} className={cls} />
    </>
  );
}
