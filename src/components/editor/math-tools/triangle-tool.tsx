"use client";

import { useDeferredValue, useState } from "react";
import { Badge, ToggleGroup, ToggleGroupItem } from "@/components/kit";
import { triangleFigure } from "@/lib/math/figures";
import { fmt, solveTriangle, triangleCorners, type Triangle, type TriangleInput } from "@/lib/math/triangle";
import { TexSteps } from "../tex";
import { AddButton, ErrorLine, Examples, num, NumField, type Place } from "./shared";

type Fields = Record<keyof Triangle, string>;
const EMPTY: Fields = { a: "", b: "", c: "", A: "", B: "", C: "" };

const EXAMPLES: { label: string; value: Partial<Fields> }[] = [
  { label: "3, 4, 5 (SSS)", value: { a: "3", b: "4", c: "5" } },
  { label: "Two sides and the angle between (SAS)", value: { a: "5", b: "7", C: "49" } },
  { label: "Two angles and a side (ASA)", value: { A: "40", B: "60", c: "10" } },
  { label: "The ambiguous case (SSA)", value: { A: "30", a: "6", b: "10" } },
];

export function TriangleTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [fields, setFields] = useState<Fields>({ ...EMPTY, a: "5", b: "7", C: "49" });
  const [which, setWhich] = useState("0");
  const deferred = useDeferredValue(fields);
  const set = (k: keyof Fields) => (v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setWhich("0");
  };

  const result = (() => {
    const input: TriangleInput = {};
    let filled = 0;
    for (const k of Object.keys(deferred) as (keyof Fields)[]) {
      const v = num(deferred[k]);
      if (v === undefined) continue;
      if (Number.isNaN(v)) return { ok: false as const, error: `${k} isn't a number.` };
      input[k] = v;
      filled++;
    }
    if (filled < 3) return null;
    return solveTriangle(input);
  })();

  const solution = result?.ok ? (result.solutions[Number(which)] ?? result.solutions[0]) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-grey-700">
        Fill in any three: sides <i>a</i>, <i>b</i>, <i>c</i> and the angles opposite them, <i>A</i>, <i>B</i>, <i>C</i>, in
        degrees. At least one has to be a side.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {(["a", "b", "c"] as const).map((k) => (
          <NumField key={k} label={`Side ${k}`} value={fields[k]} onChange={set(k)} testId={`tri-${k}`} />
        ))}
        {(["A", "B", "C"] as const).map((k) => (
          <NumField key={k} label={`Angle ${k}`} value={fields[k]} onChange={set(k)} suffix="°" testId={`tri-${k}`} />
        ))}
      </div>
      <Examples label="Examples" items={EXAMPLES} onPick={(v) => (setFields({ ...EMPTY, ...v }), setWhich("0"))} />

      {!result ? (
        <p className="text-sm text-muted-foreground">Fill in three values to solve the triangle.</p>
      ) : !result.ok ? (
        <ErrorLine>{result.error}</ErrorLine>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="dark" data-testid="tri-case">{result.case}</Badge>
            {result.right ? <Badge tone="green">Right triangle</Badge> : null}
            {result.solutions.length > 1 ? (
              <>
                <Badge tone="orange">Two triangles fit</Badge>
                <ToggleGroup value={which} onValueChange={setWhich} aria-label="Which triangle">
                  <ToggleGroupItem value="0">Acute</ToggleGroupItem>
                  <ToggleGroupItem value="1">Obtuse</ToggleGroupItem>
                </ToggleGroup>
              </>
            ) : null}
          </div>
          {solution ? (
            <>
              <div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl bg-beige-100 p-4">
                <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm" data-testid="tri-values">
                  {(["a", "b", "c", "A", "B", "C"] as const).map((k) => (
                    <div key={k}>
                      <dt className="text-xs text-grey-500">{k === k.toUpperCase() ? `Angle ${k}` : `Side ${k}`}</dt>
                      <dd className="font-mono font-bold tabular-nums" data-testid={`tri-out-${k}`}>
                        {fmt(solution.triangle[k])}
                        {k === k.toUpperCase() ? "°" : ""}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-grey-500">Area</dt>
                    <dd className="font-mono font-bold tabular-nums">{fmt(solution.area)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-grey-500">Perimeter</dt>
                    <dd className="font-mono font-bold tabular-nums">{fmt(solution.perimeter)}</dd>
                  </div>
                </dl>
                <TrianglePreview t={solution.triangle} />
              </div>
              <TexSteps steps={solution.steps} />
              <AddButton
                testId="tri-add"
                disabled={!canInsert}
                onClick={() => void place((ink, measure) => triangleFigure(solution, result.case, ink, measure))}
              >
                Draw it on the canvas
              </AddButton>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A small, to-scale picture of the triangle with its corners named. */
function TrianglePreview({ t }: { t: Triangle }) {
  const k = triangleCorners(t, 100);
  const xs = [k.A[0], k.B[0], k.C[0]];
  const ys = [k.A[1], k.B[1], k.C[1]];
  const minX = Math.min(...xs) - 14;
  const minY = Math.min(...ys) - 14;
  const w = Math.max(...xs) - minX + 14;
  const h = Math.max(...ys) - minY + 14;
  const g = [(xs[0] + xs[1] + xs[2]) / 3, (ys[0] + ys[1] + ys[2]) / 3];
  const label = (name: "A" | "B" | "C") => {
    const [x, y] = k[name];
    const dx = x - g[0];
    const dy = y - g[1];
    const l = Math.hypot(dx, dy) || 1;
    return (
      <text key={name} x={x + (dx / l) * 9} y={y + (dy / l) * 9} fontSize="10" textAnchor="middle" dominantBaseline="middle" fill="currentColor">
        {name}
      </text>
    );
  };
  return (
    <svg viewBox={`${minX} ${minY} ${w} ${h}`} className="h-28 w-28 text-grey-900" role="img" aria-label="The triangle, to scale">
      <polygon points={`${k.A.join(",")} ${k.B.join(",")} ${k.C.join(",")}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {label("A")}
      {label("B")}
      {label("C")}
    </svg>
  );
}

