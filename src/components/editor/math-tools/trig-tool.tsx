"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Button, ToggleGroup, ToggleGroupItem } from "@/components/kit";
import { stepsFigure, unitCircleFigure } from "@/lib/math/figures";
import { exactTrig, parseAngle, radiansTex, TRIG_FNS, TRIG_IDENTITIES, type AngleUnit, type TrigFn } from "@/lib/math/trig";
import { Plus } from "lucide-react";
import { Tex, TexSteps } from "../tex";
import { AddButton, ErrorLine, Examples, type Place } from "./shared";

const EXAMPLES: { label: string; value: { fn: TrigFn; angle: string; unit: AngleUnit } }[] = [
  { label: "sin 150°", value: { fn: "sin", angle: "150", unit: "deg" } },
  { label: "cos 5π/4", value: { fn: "cos", angle: "5π/4", unit: "rad" } },
  { label: "tan 300°", value: { fn: "tan", angle: "300", unit: "deg" } },
  { label: "sec 2π/3", value: { fn: "sec", angle: "2π/3", unit: "rad" } },
];

export function TrigTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [fn, setFn] = useState<TrigFn>("sin");
  const [unit, setUnit] = useState<AngleUnit>("deg");
  const [angle, setAngle] = useState("150");
  const deferred = useDeferredValue(angle);

  const degrees = useMemo(() => parseAngle(deferred, unit), [deferred, unit]);
  const answer = useMemo(() => (degrees === null ? null : exactTrig(fn, degrees, unit)), [fn, degrees, unit]);
  const shown = degrees === null ? "" : unit === "deg" ? `${+degrees.toFixed(4)}^\\circ` : radiansTex(degrees);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <ToggleGroup value={fn} onValueChange={(v) => setFn(v as TrigFn)} aria-label="Function" size="md">
          {TRIG_FNS.map((f) => (
            <ToggleGroupItem key={f} value={f} className="font-mono">
              {f}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup value={unit} onValueChange={(v) => setUnit(v as AngleUnit)} aria-label="Angle unit" size="md">
          <ToggleGroupItem value="deg">Degrees</ToggleGroupItem>
          <ToggleGroupItem value="rad">Radians</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold text-grey-500">
        Angle
        <input
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder={unit === "deg" ? "e.g. 150" : "e.g. 5π/6 or 5pi/6"}
          spellCheck={false}
          autoComplete="off"
          data-testid="trig-angle"
          className="h-11 rounded-lg border border-beige-500 bg-white px-3 font-mono text-base font-normal text-grey-900 outline-none focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25"
        />
      </label>
      {unit === "rad" ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Type π as <code className="font-mono">pi</code> or <code className="font-mono">π</code>, like{" "}
          <code className="font-mono">3pi/4</code>.
        </p>
      ) : null}
      <Examples
        label="Examples"
        items={EXAMPLES}
        onPick={(v) => {
          setFn(v.fn);
          setUnit(v.unit);
          setAngle(v.angle);
        }}
      />

      {!angle.trim() ? null : degrees === null || !answer ? (
        <ErrorLine>{unit === "deg" ? "Type an angle in degrees, like 150." : "Type an angle in radians, like 5pi/6 or 2.5."}</ErrorLine>
      ) : (
        <>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            <p className="text-sm text-grey-300">{answer.exact ? "Exact value" : "Not a special angle, so a decimal"}</p>
            <p className="mt-1 text-2xl" data-testid="trig-answer">
              <Tex latex={`\\${fn} ${shown} = ${answer.tex}`} />
            </p>
          </div>
          <TexSteps steps={answer.steps} />
          <div className="flex flex-wrap gap-2">
            <AddButton
              testId="trig-add-circle"
              disabled={!canInsert}
              onClick={() => void place((ink, measure) => unitCircleFigure(degrees, unit, answer, ink, measure))}
            >
              Draw the unit circle
            </AddButton>
            <Button
              variant="secondary"
              disabled={!canInsert}
              onClick={() => void place((ink, measure) => stepsFigure([`\\${fn} ${shown} = ${answer.tex}`], ink, measure))}
            >
              <Plus /> Just the answer
            </Button>
          </div>
        </>
      )}

      <section className="flex flex-col gap-2 border-t border-beige-300 pt-4">
        <h3 className="text-sm font-bold">Identities</h3>
        <ul className="flex flex-col">
          {TRIG_IDENTITIES.map((id) => (
            <li key={id.name} className="flex items-center gap-3 border-b border-grey-100 py-2 last:border-0">
              <span className="w-36 shrink-0 text-xs text-grey-500">{id.name}</span>
              <span className="min-w-0 flex-1 overflow-x-auto">
                <Tex latex={id.tex} />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canInsert}
                aria-label={`Add the ${id.name.toLowerCase()} identity to the canvas`}
                onClick={() => void place((ink, measure) => stepsFigure([id.tex], ink, measure))}
              >
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
