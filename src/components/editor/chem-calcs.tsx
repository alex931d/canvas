"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Select, ToggleGroup, ToggleGroupItem } from "@/components/kit";
import { combinedGas, idealGas, PRESSURE_UNITS, TEMP_UNITS, VOLUME_UNITS, type CombinedKey, type PressureUnit, type TempUnit, type VolumeUnit } from "@/lib/chem/gas";
import { dilution, molarity, ph, type PhInput } from "@/lib/chem/solution";
import { stoichiometry, type Amount } from "@/lib/chem/stoich";
import { speciesToMhchem, speciesToText } from "@/lib/chem/formula";
import { stepsFigure } from "@/lib/math/figures";
import { AddButton, ErrorLine, Examples, num, NumField, type Place } from "./math-tools/shared";
import { Tex, TexSteps } from "./tex";

/**
 * The chemistry calculators: amounts (stoichiometry with the limiting
 * reagent and yields), gas laws, and solutions (molarity, dilution, pH).
 * Each shows its working and can put it on the canvas.
 */

const g = (n: number) => (Math.abs(n) >= 1e4 || (Math.abs(n) < 1e-3 && n !== 0) ? n.toExponential(3) : String(+n.toPrecision(4)));
const ce = (s: Parameters<typeof speciesToMhchem>[0]) => `\\ce{${speciesToMhchem({ ...s, state: null, coefficient: null })}}`;
const inputClass =
  "h-11 rounded-lg border border-beige-500 bg-white px-3 font-mono text-base font-normal text-grey-900 outline-none focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25";

function AddSteps({ steps, place, canInsert, testId }: { steps: string[]; place: Place; canInsert: boolean; testId?: string }) {
  return (
    <AddButton testId={testId} disabled={!canInsert} onClick={() => void place((ink, measure) => stepsFigure(steps, ink, measure))}>
      Add the working to the canvas
    </AddButton>
  );
}

// ------------------------------------------------------------ amounts

const STOICH_EXAMPLES = [
  { label: "2H₂ + O₂ → 2H₂O", value: { eq: "H2 + O2 -> H2O", amounts: [["4", "g"], ["16", "g"]] } },
  { label: "Iron rusting", value: { eq: "Fe + O2 -> Fe2O3", amounts: [["10", "g"], ["", "g"]] } },
  { label: "Burning propane", value: { eq: "C3H8 + O2 -> CO2 + H2O", amounts: [["44", "g"], ["3", "mol"]] } },
];

export function AmountsTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [eq, setEq] = useState("H2 + O2 -> H2O");
  const [amounts, setAmounts] = useState<[string, Amount["unit"]][]>([
    ["4", "g"],
    ["16", "g"],
  ]);
  const [actual, setActual] = useState<string[]>([]);
  const deferred = useDeferredValue(eq);
  const parsed = stoichiometry(deferred, [{ value: 1, unit: "mol" }]);
  const reactants = parsed.ok ? parsed.balanced.reactants : [];

  const result = (() => {
    if (!parsed.ok) return null;
    const list = reactants.map((_, i) => {
      const [v, unit] = amounts[i] ?? ["", "g"];
      const n = num(v);
      return n === undefined || Number.isNaN(n) ? undefined : { value: n, unit };
    });
    const yields: Record<number, number> = {};
    actual.forEach((v, j) => {
      const n = num(v);
      if (n !== undefined && !Number.isNaN(n)) yields[j] = n;
    });
    return stoichiometry(deferred, list, yields);
  })();

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Reaction
        <input value={eq} onChange={(e) => setEq(e.target.value)} spellCheck={false} autoComplete="off" className={inputClass} data-testid="stoich-eq" />
      </label>
      <p className="-mt-2 text-xs text-muted-foreground">It’s balanced for you. Leave an amount blank for a reactant that’s in excess.</p>
      <Examples
        label="Examples"
        items={STOICH_EXAMPLES}
        onPick={(v) => {
          setEq(v.eq);
          setAmounts(v.amounts as [string, Amount["unit"]][]);
          setActual([]);
        }}
      />
      {!parsed.ok ? (
        eq.trim() ? <ErrorLine>{parsed.error}</ErrorLine> : null
      ) : (
        <>
          <p className="text-lg" data-testid="stoich-balanced">
            <Tex latex={`\\ce{${parsed.balanced.mhchem}}`} />
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {reactants.map((s, i) => (
              <div key={`${s.body}-${i}`} className="flex items-end gap-2">
                <NumField
                  className="flex-1"
                  label={<Tex latex={ce(s)} />}
                  value={amounts[i]?.[0] ?? ""}
                  placeholder="excess"
                  testId={`stoich-amount-${i}`}
                  onChange={(v) => setAmounts((a) => Object.assign([...a], { [i]: [v, a[i]?.[1] ?? "g"] }))}
                />
                <Select
                  fieldSize="sm"
                  className="h-10 w-20"
                  aria-label="Unit"
                  value={amounts[i]?.[1] ?? "g"}
                  onChange={(e) => setAmounts((a) => Object.assign([...a], { [i]: [a[i]?.[0] ?? "", e.target.value as Amount["unit"]] }))}
                >
                  <option value="g">g</option>
                  <option value="mol">mol</option>
                </Select>
              </div>
            ))}
          </div>
          {result && !result.ok ? (
            <ErrorLine>{result.error}</ErrorLine>
          ) : result?.ok ? (
            <>
              <div className="rounded-xl bg-grey-900 p-5 text-white">
                <p className="text-sm text-grey-300">Limiting reagent</p>
                <p className="mt-1 text-2xl font-bold" data-testid="stoich-limiting">
                  {speciesToText({ ...result.limiting.species, state: null })}
                </p>
                <p className="mt-1 text-sm text-grey-300">It runs out first; the rest are left over.</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 text-right font-medium">mol</th>
                    <th className="py-2 text-right font-medium">Theoretical g</th>
                    <th className="py-2 text-right font-medium">Actual g</th>
                    <th className="py-2 text-right font-medium">Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((p, j) => (
                    <tr key={`${p.species.body}-${j}`} className="border-b border-grey-100 last:border-0">
                      <td className="py-2">
                        <Tex latex={ce(p.species)} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{g(p.moles)}</td>
                      <td className="py-2 text-right tabular-nums" data-testid={`stoich-grams-${j}`}>
                        {g(p.grams)}
                      </td>
                      <td className="py-2 text-right">
                        <input
                          aria-label={`Actual grams of product ${j + 1}`}
                          inputMode="decimal"
                          value={actual[j] ?? ""}
                          onChange={(e) => setActual((a) => Object.assign([...a], { [j]: e.target.value }))}
                          className="h-8 w-20 rounded-md border border-beige-500 bg-white px-2 text-right font-mono tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-green/25"
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums">{p.percentYield === null ? "" : `${p.percentYield.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TexSteps steps={result.steps} />
              <AddSteps steps={result.steps} place={place} canInsert={canInsert} testId="stoich-add" />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ gases

type IdealFields = { P: string; V: string; n: string; T: string };

export function GasTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [law, setLaw] = useState<"ideal" | "combined">("ideal");
  const [pUnit, setPUnit] = useState<PressureUnit>("atm");
  const [vUnit, setVUnit] = useState<VolumeUnit>("L");
  const [tUnit, setTUnit] = useState<TempUnit>("C");
  const [ideal, setIdeal] = useState<IdealFields>({ P: "1", V: "", n: "1", T: "0" });
  const [comb, setComb] = useState<Record<CombinedKey, string>>({ P1: "1", V1: "2", T1: "25", P2: "", V2: "1.5", T2: "50" });

  const result = (() => {
    if (law === "ideal") {
      const v = { P: num(ideal.P), V: num(ideal.V), n: num(ideal.n), T: num(ideal.T) };
      if (Object.values(v).some((x) => Number.isNaN(x))) return { ok: false as const, error: "Those have to be numbers." };
      return idealGas(
        {
          P: v.P === undefined ? undefined : { value: v.P, unit: pUnit },
          V: v.V === undefined ? undefined : { value: v.V, unit: vUnit },
          n: v.n === undefined ? undefined : { value: v.n },
          T: v.T === undefined ? undefined : { value: v.T, unit: tUnit },
        },
        { P: pUnit, V: vUnit, T: tUnit },
      );
    }
    const input: Partial<Record<CombinedKey, number>> = {};
    for (const [k, s] of Object.entries(comb) as [CombinedKey, string][]) {
      const v = num(s);
      if (Number.isNaN(v)) return { ok: false as const, error: "Those have to be numbers." };
      if (v !== undefined) input[k] = v;
    }
    return combinedGas({ ...input, pUnit, vUnit, tUnit });
  })();

  const units = (
    <div className="flex flex-wrap gap-2 text-xs">
      <Select fieldSize="sm" className="w-24" aria-label="Pressure unit" value={pUnit} onChange={(e) => setPUnit(e.target.value as PressureUnit)}>
        {PRESSURE_UNITS.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </Select>
      <Select fieldSize="sm" className="w-20" aria-label="Volume unit" value={vUnit} onChange={(e) => setVUnit(e.target.value as VolumeUnit)}>
        {VOLUME_UNITS.map((u) => (
          <option key={u} value={u}>
            {u === "m3" ? "m³" : u}
          </option>
        ))}
      </Select>
      <Select fieldSize="sm" className="w-20" aria-label="Temperature unit" value={tUnit} onChange={(e) => setTUnit(e.target.value as TempUnit)}>
        {TEMP_UNITS.map((u) => (
          <option key={u} value={u}>
            {u === "K" ? "K" : `°${u}`}
          </option>
        ))}
      </Select>
    </div>
  );
  const tLabel = tUnit === "K" ? "K" : `°${tUnit}`;

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup value={law} onValueChange={(v) => setLaw(v as "ideal" | "combined")} aria-label="Law" size="md" className="self-start">
        <ToggleGroupItem value="ideal">PV = nRT</ToggleGroupItem>
        <ToggleGroupItem value="combined">Before and after</ToggleGroupItem>
      </ToggleGroup>
      {units}
      {law === "ideal" ? (
        <>
          <p className="text-sm text-grey-700">Fill in three and leave the one to find blank.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField label="Pressure P" value={ideal.P} onChange={(v) => setIdeal({ ...ideal, P: v })} suffix={pUnit} testId="gas-P" />
            <NumField label="Volume V" value={ideal.V} onChange={(v) => setIdeal({ ...ideal, V: v })} suffix={vUnit === "m3" ? "m³" : vUnit} testId="gas-V" />
            <NumField label="Amount n" value={ideal.n} onChange={(v) => setIdeal({ ...ideal, n: v })} suffix="mol" testId="gas-n" />
            <NumField label="Temperature T" value={ideal.T} onChange={(v) => setIdeal({ ...ideal, T: v })} suffix={tLabel} testId="gas-T" />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-grey-700">
            Leave the one to find blank. Leave both of a pair blank when it stays the same (that’s Boyle’s, Charles’s or Gay-Lussac’s law).
          </p>
          <div className="grid grid-cols-3 gap-3">
            {(["P1", "V1", "T1", "P2", "V2", "T2"] as const).map((k) => (
              <NumField
                key={k}
                label={`${k[0] === "P" ? "Pressure" : k[0] === "V" ? "Volume" : "Temperature"} ${k[1] === "1" ? "before" : "after"}`}
                value={comb[k]}
                onChange={(v) => setComb({ ...comb, [k]: v })}
                suffix={k[0] === "P" ? pUnit : k[0] === "V" ? (vUnit === "m3" ? "m³" : vUnit) : tLabel}
                testId={`gas-${k}`}
              />
            ))}
          </div>
        </>
      )}
      {!result.ok ? (
        <ErrorLine>{result.error}</ErrorLine>
      ) : (
        <>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            <p className="text-sm text-grey-300">{result.key.replace(/(\d)/, " $1")}</p>
            <p className="mt-1 text-[32px] leading-tight font-bold tabular-nums" data-testid="gas-answer">
              {g(result.value)} <span className="text-lg font-semibold text-grey-300">{result.unit === "C" || result.unit === "F" ? `°${result.unit}` : result.unit === "m3" ? "m³" : result.unit}</span>
            </p>
          </div>
          <TexSteps steps={result.steps} />
          <AddSteps steps={result.steps} place={place} canInsert={canInsert} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ solutions

type PhKind = PhInput["kind"];
const PH_KINDS: { id: PhKind; label: string }[] = [
  { id: "pH", label: "pH" },
  { id: "pOH", label: "pOH" },
  { id: "H", label: "[H⁺]" },
  { id: "OH", label: "[OH⁻]" },
  { id: "strong-acid", label: "Strong acid" },
  { id: "strong-base", label: "Strong base" },
  { id: "weak-acid", label: "Weak acid" },
  { id: "weak-base", label: "Weak base" },
];

export function SolutionsTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [mode, setMode] = useState<"molarity" | "dilution" | "ph">("molarity");
  const [m, setM] = useState({ formula: "NaCl", amount: "5.844", unit: "g" as "g" | "mol", liters: "0.5", molarity: "" });
  const [d, setD] = useState({ M1: "6", V1: "", M2: "1.5", V2: "250" });
  const [p, setP] = useState({ kind: "weak-acid" as PhKind, value: "0.1", k: "1.8e-5", ions: "1" });

  const result = useMemo(() => {
    if (mode === "molarity") {
      const amount = num(m.amount);
      const liters = num(m.liters);
      const M = num(m.molarity);
      if ([amount, liters, M].some((x) => Number.isNaN(x))) return { ok: false as const, error: "Those have to be numbers." };
      return molarity({ formula: m.formula, ...(m.unit === "g" ? { grams: amount } : { moles: amount }), liters, molarity: M });
    }
    if (mode === "dilution") {
      const v = { M1: num(d.M1), V1: num(d.V1), M2: num(d.M2), V2: num(d.V2) };
      if (Object.values(v).some((x) => Number.isNaN(x))) return { ok: false as const, error: "Those have to be numbers." };
      return dilution(v);
    }
    const value = num(p.value);
    if (value === undefined || Number.isNaN(value)) return null;
    const input: PhInput =
      p.kind === "weak-acid" || p.kind === "weak-base"
        ? { kind: p.kind, value, k: num(p.k) ?? NaN }
        : p.kind === "strong-acid" || p.kind === "strong-base"
          ? { kind: p.kind, value, ions: num(p.ions) ?? 1 }
          : { kind: p.kind, value };
    const r = ph(input);
    return r.ok ? { ok: true as const, value: r.pH, unit: "pH", steps: r.steps, extra: { pOH: r.pOH, H: r.H, OH: r.OH } } : r;
  }, [mode, m, d, p]);

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} aria-label="Calculator" size="md" className="self-start">
        <ToggleGroupItem value="molarity">Molarity</ToggleGroupItem>
        <ToggleGroupItem value="dilution">Dilution</ToggleGroupItem>
        <ToggleGroupItem value="ph">pH</ToggleGroupItem>
      </ToggleGroup>

      {mode === "molarity" ? (
        <>
          <p className="text-sm text-grey-700">Fill in two of amount, volume and molarity.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-grey-500">
              Solute (optional, to use grams)
              <input value={m.formula} onChange={(e) => setM({ ...m, formula: e.target.value })} spellCheck={false} className={inputClass} data-testid="sol-formula" />
            </label>
            <div className="flex items-end gap-2">
              <NumField className="flex-1" label="Amount" value={m.amount} onChange={(v) => setM({ ...m, amount: v })} testId="sol-amount" />
              <Select fieldSize="sm" className="h-10 w-20" aria-label="Amount unit" value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value as "g" | "mol" })}>
                <option value="g">g</option>
                <option value="mol">mol</option>
              </Select>
            </div>
            <NumField label="Volume" value={m.liters} onChange={(v) => setM({ ...m, liters: v })} suffix="L" testId="sol-liters" />
            <NumField label="Molarity" value={m.molarity} onChange={(v) => setM({ ...m, molarity: v })} suffix="M" testId="sol-molarity" />
          </div>
        </>
      ) : mode === "dilution" ? (
        <>
          <p className="text-sm text-grey-700">
            <Tex latex="M_1V_1 = M_2V_2" />: fill in three. Use the same volume unit for both.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Stock molarity M₁" value={d.M1} onChange={(v) => setD({ ...d, M1: v })} suffix="M" testId="dil-M1" />
            <NumField label="Stock volume V₁" value={d.V1} onChange={(v) => setD({ ...d, V1: v })} testId="dil-V1" />
            <NumField label="Final molarity M₂" value={d.M2} onChange={(v) => setD({ ...d, M2: v })} suffix="M" testId="dil-M2" />
            <NumField label="Final volume V₂" value={d.V2} onChange={(v) => setD({ ...d, V2: v })} testId="dil-V2" />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Start from">
            {PH_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={p.kind === k.id}
                onClick={() => setP({ ...p, kind: k.id })}
                className={
                  p.kind === k.id
                    ? "rounded-full bg-grey-900 px-3 py-1 text-xs text-white"
                    : "rounded-full bg-muted px-3 py-1 text-xs transition-colors hover:bg-grey-300/50"
                }
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label={p.kind === "pH" || p.kind === "pOH" ? p.kind : p.kind === "H" ? "[H⁺]" : p.kind === "OH" ? "[OH⁻]" : "Concentration"}
              suffix={p.kind === "pH" || p.kind === "pOH" ? undefined : "M"}
              value={p.value}
              onChange={(v) => setP({ ...p, value: v })}
              testId="ph-value"
            />
            {p.kind === "weak-acid" || p.kind === "weak-base" ? (
              <NumField label={p.kind === "weak-acid" ? "Kₐ" : "K_b"} value={p.k} onChange={(v) => setP({ ...p, k: v })} testId="ph-k" placeholder="1.8e-5" />
            ) : p.kind === "strong-acid" || p.kind === "strong-base" ? (
              <NumField label={p.kind === "strong-acid" ? "H⁺ per formula (H₂SO₄: 2)" : "OH⁻ per formula (Ca(OH)₂: 2)"} value={p.ions} onChange={(v) => setP({ ...p, ions: v })} />
            ) : null}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">At 25 °C. Type powers of ten like 1.8e-5.</p>
        </>
      )}

      {!result ? null : !result.ok ? (
        <ErrorLine>{result.error}</ErrorLine>
      ) : (
        <>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            {mode === "ph" && result.extra ? (
              <>
                <p className="text-sm text-grey-300">pH</p>
                <p className="mt-1 text-[32px] leading-tight font-bold tabular-nums" data-testid="sol-answer">
                  {result.value.toFixed(2)}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-grey-300 tabular-nums">
                  <div className="flex gap-1.5">
                    <dt>pOH</dt>
                    <dd className="text-white">{result.extra.pOH.toFixed(2)}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>[H⁺]</dt>
                    <dd className="text-white">{g(result.extra.H)} M</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>[OH⁻]</dt>
                    <dd className="text-white">{g(result.extra.OH)} M</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <p className="text-sm text-grey-300">Answer</p>
                <p className="mt-1 text-[32px] leading-tight font-bold tabular-nums" data-testid="sol-answer">
                  {g(result.value)} <span className="text-lg font-semibold text-grey-300">{result.unit === "volume" ? "" : result.unit}</span>
                </p>
              </>
            )}
          </div>
          <TexSteps steps={result.steps} />
          <AddSteps steps={result.steps} place={place} canInsert={canInsert} />
        </>
      )}
    </div>
  );
}
