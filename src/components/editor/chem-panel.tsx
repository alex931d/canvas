"use client";

import { Check, Plus } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Button, SidePanel, Tab, TabList, TabPanel, Tabs } from "@/components/kit";
import { balanceEquation } from "@/lib/chem/balance";
import {
  CATEGORY_LABELS,
  ELEMENTS,
  formatWeight,
  type ChemicalElement,
  type ElementCategory,
} from "@/lib/chem/elements";
import { FormulaError, molarMass, parseSpecies, speciesToMhchem, speciesToText } from "@/lib/chem/formula";
import type { MathElement } from "@/lib/canvas/schema";
import { cn } from "@/lib/utils";

/**
 * Chemistry tools beside the canvas: molar mass (with a grams ⇄ moles
 * converter), an equation balancer and the periodic table. Results can be
 * placed on the canvas as typeset equations.
 *
 * The sheet is non-modal, so drawing continues while it's open.
 */

type Insert = (value: Pick<MathElement, "syntax" | "source">) => Promise<void> | void;

const CATEGORY_COLORS: Record<ElementCategory, string> = {
  alkali: "#f9c8a0",
  "alkaline-earth": "#f6e39b",
  transition: "#c6e3f0",
  lanthanide: "#e9dcc4",
  actinide: "#f0d0f0",
  "post-transition": "#c9e7d2",
  metalloid: "#e2d4f5",
  nonmetal: "#d3dbf7",
  halogen: "#fbcfdc",
  "noble-gas": "#e5e3e8",
};

const fmt = (n: number, digits = 3) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function ChemPanel({
  open,
  onOpenChange,
  onInsert,
  canInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: Insert;
  canInsert: boolean;
}) {
  const [tab, setTab] = useState("mass");
  const [formula, setFormula] = useState("CuSO4·5H2O");

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      title="Chemistry"
      description="Molar masses, balanced equations and the periodic table. Atomic weights are the IUPAC standard values."
      className="overflow-y-auto sm:max-w-[680px]"
      onInteractOutside={(e) => e.preventDefault()}
      data-scrollable
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-4 px-5 pb-6">
        <TabList className="w-full">
          <Tab value="mass">Molar mass</Tab>
          <Tab value="balance">Balance</Tab>
          <Tab value="table">Periodic table</Tab>
        </TabList>
        <TabPanel value="mass">
          <MolarMassTool formula={formula} setFormula={setFormula} onInsert={onInsert} canInsert={canInsert} />
        </TabPanel>
        <TabPanel value="balance">
          <BalanceTool onInsert={onInsert} canInsert={canInsert} />
        </TabPanel>
        <TabPanel value="table">
          <PeriodicTable
            onUse={(el) => {
              setFormula((f) => (f.trim() ? f.trim() : "") + el.symbol);
              setTab("mass");
            }}
          />
        </TabPanel>
      </Tabs>
    </SidePanel>
  );
}

// ------------------------------------------------------------ molar mass

function MolarMassTool({
  formula,
  setFormula,
  onInsert,
  canInsert,
}: {
  formula: string;
  setFormula: (f: string) => void;
  onInsert: Insert;
  canInsert: boolean;
}) {
  const deferred = useDeferredValue(formula);
  type Result =
    | { ok: true; species: ReturnType<typeof parseSpecies>; mass: ReturnType<typeof molarMass> }
    | { ok: false; error: string };
  const result = useMemo((): Result | null => {
    if (!deferred.trim()) return null;
    try {
      const species = parseSpecies(deferred);
      if (species.isElectron) return { ok: false, error: "That's an electron: type a compound, like H2O." };
      return { ok: true, species, mass: molarMass(species.counts) };
    } catch (err) {
      return { ok: false, error: err instanceof FormulaError ? err.message : "That formula can't be read." };
    }
  }, [deferred]);
  const [grams, setGrams] = useState("10");
  const [moles, setMoles] = useState<string | null>(null);

  const total = result?.ok ? result.mass.total : null;
  const gramsNum = Number(grams);
  const molesShown =
    moles ?? (total && grams.trim() && Number.isFinite(gramsNum) ? String(+(gramsNum / total).toPrecision(5)) : "");

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Formula
        <input
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="e.g. Ca(OH)2 or CuSO4·5H2O"
          spellCheck={false}
          autoComplete="off"
          className="h-11 rounded-lg border border-input bg-background px-3 font-mono text-base font-normal outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      </label>

      {!result ? (
        <p className="text-sm text-muted-foreground">Type a formula to see its molar mass.</p>
      ) : !result.ok ? (
        <p className="text-sm text-red" role="alert">
          {result.error}
        </p>
      ) : (
        <>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            <p className="text-sm text-grey-300">{speciesToText(result.species)}</p>
            <p className="mt-1 text-[32px] leading-tight font-bold tabular-nums" data-testid="molar-mass">
              {fmt(result.mass.total)} <span className="text-lg font-semibold text-grey-300">g/mol</span>
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Element</th>
                <th className="py-2 text-right font-medium">Atoms</th>
                <th className="py-2 text-right font-medium">g/mol</th>
                <th className="py-2 text-right font-medium">Mass %</th>
              </tr>
            </thead>
            <tbody>
              {result.mass.parts.map((p) => (
                <tr key={p.element.symbol} className="border-b border-grey-100 last:border-0">
                  <td className="py-2">
                    <span className="font-bold">{p.element.symbol}</span>{" "}
                    <span className="text-muted-foreground">{p.element.name}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.count}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(p.mass)}</td>
                  <td className="py-2 text-right tabular-nums">{p.percent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.mass.usesRadioactive ? (
            <p className="text-xs text-muted-foreground">
              Includes an element with no stable isotopes: its value is the mass number of its longest-lived isotope.
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2 rounded-xl bg-beige-100 p-4">
            <legend className="sr-only">Grams to moles</legend>
            <p className="text-sm font-semibold">Grams ⇄ moles</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                aria-label="Mass in grams"
                inputMode="decimal"
                value={grams}
                onChange={(e) => {
                  setGrams(e.target.value);
                  setMoles(null);
                }}
                className="h-9 w-28 rounded-md border border-input bg-background px-2 font-mono tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
              <span>g =</span>
              <input
                aria-label="Amount in moles"
                inputMode="decimal"
                value={molesShown}
                onChange={(e) => {
                  const v = e.target.value;
                  setMoles(v);
                  const n = Number(v);
                  if (total && v.trim() && Number.isFinite(n)) setGrams(String(+(n * total).toPrecision(6)));
                }}
                className="h-9 w-28 rounded-md border border-input bg-background px-2 font-mono tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
              <span>mol</span>
            </div>
          </fieldset>

          <Button
            className="self-start"
            disabled={!canInsert}
            onClick={() =>
              void onInsert({
                syntax: "tex",
                source: `\\ce{${speciesToMhchem({ ...result.species, coefficient: null, state: null })}}\\quad M = ${result.mass.total.toFixed(3)}\\ \\mathrm{g/mol}`,
              })
            }
          >
            <Plus /> Add to canvas
          </Button>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------- balance

const EXAMPLES = [
  "Fe + O2 -> Fe2O3",
  "C3H8 + O2 -> CO2 + H2O",
  "Al + HCl -> AlCl3 + H2",
  "MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O",
];

function BalanceTool({ onInsert, canInsert }: { onInsert: Insert; canInsert: boolean }) {
  const [text, setText] = useState("Fe + O2 -> Fe2O3");
  const deferred = useDeferredValue(text);
  const result = useMemo(() => (deferred.trim() ? balanceEquation(deferred) : null), [deferred]);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Equation
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Fe + O2 -> Fe2O3"
          spellCheck={false}
          autoComplete="off"
          className="h-11 rounded-lg border border-input bg-background px-3 font-mono text-base font-normal outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      </label>
      <p className="-mt-2 text-xs text-muted-foreground">
        Use <code className="font-mono">-&gt;</code> for the arrow, <code className="font-mono">&lt;=&gt;</code> for an
        equilibrium and <code className="font-mono">^</code> for charges, like <code className="font-mono">Fe^3+</code>.
        Coefficients you type are ignored.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded-full bg-muted px-3 py-1 font-mono text-xs transition-colors hover:bg-grey-300/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ex}
          </button>
        ))}
      </div>

      {!result ? null : !result.ok ? (
        <p className="text-sm text-red" role="alert">
          {result.error}
        </p>
      ) : (
        <>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            <p className="text-sm text-grey-300">Balanced</p>
            <p className="mt-1 text-2xl leading-snug font-bold break-words" data-testid="balanced">
              {result.text}
            </p>
          </div>
          <table className="w-full text-sm">
            <caption className="mb-2 text-left text-xs text-muted-foreground">Atoms on each side</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Element</th>
                <th className="py-2 text-right font-medium">Left</th>
                <th className="py-2 text-right font-medium">Right</th>
                <th className="w-8 py-2" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.symbol} className="border-b border-grey-100 last:border-0">
                  <td className="py-2 font-bold">{r.symbol === "charge" ? "Charge" : r.symbol}</td>
                  <td className="py-2 text-right tabular-nums">{r.left}</td>
                  <td className="py-2 text-right tabular-nums">{r.right}</td>
                  <td className="py-2 text-right text-green">
                    <Check className="ml-auto size-4" aria-label="Equal" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            className="self-start"
            disabled={!canInsert}
            onClick={() => void onInsert({ syntax: "chem", source: result.mhchem })}
          >
            <Plus /> Add to canvas
          </Button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------- periodic table

function PeriodicTable({ onUse }: { onUse: (el: ChemicalElement) => void }) {
  const [selected, setSelected] = useState<ChemicalElement>(ELEMENTS[25]); // iron

  // f-block rows go below the table; placeholders mark where they belong.
  const position = (el: ChemicalElement) => {
    if (el.group > 0) return { col: el.group, row: el.period };
    const first = el.period === 6 ? 57 : 89;
    return { col: 3 + (el.z - first), row: el.period + 3 };
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-xl bg-beige-100 p-4">
        <div
          className="flex size-20 shrink-0 flex-col items-center justify-center rounded-lg text-grey-900"
          style={{ backgroundColor: CATEGORY_COLORS[selected.category] }}
        >
          <span className="text-xs tabular-nums">{selected.z}</span>
          <span className="text-3xl leading-none font-bold">{selected.symbol}</span>
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm" aria-live="polite">
          <dt className="sr-only">Name</dt>
          <dd className="col-span-2 text-lg font-bold">{selected.name}</dd>
          <dt className="text-muted-foreground">Atomic weight</dt>
          <dd className="tabular-nums">
            {selected.radioactive ? `[${selected.weight}]` : selected.weight}
          </dd>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{CATEGORY_LABELS[selected.category]}</dd>
          <dt className="text-muted-foreground">Group, period</dt>
          <dd>
            {selected.group > 0 ? selected.group : "f-block"}, {selected.period}
          </dd>
        </dl>
        <Button size="sm" variant="secondary" className="shrink-0 self-end" onClick={() => onUse(selected)}>
          Use in formula
        </Button>
      </div>

      <div className="relative overflow-x-auto pb-2" data-scrollable>
        <div
          className="grid min-w-[600px] gap-[3px]"
          style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))", gridTemplateRows: "repeat(7, auto) 10px repeat(2, auto)" }}
          role="group"
          aria-label="Periodic table"
        >
          {ELEMENTS.map((el) => {
            const { col, row } = position(el);
            const active = el.z === selected.z;
            return (
              <button
                key={el.z}
                type="button"
                onClick={() => setSelected(el)}
                aria-label={`${el.name}, ${el.symbol}, atomic number ${el.z}`}
                aria-pressed={active}
                title={`${el.name}: ${formatWeight(el)}`}
                className={cn(
                  "flex aspect-square min-w-0 flex-col items-center justify-center rounded-[5px] text-grey-900 transition-transform outline-none hover:scale-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-grey-900",
                  active && "z-10 ring-2 ring-grey-900",
                )}
                style={{ gridColumn: col, gridRow: row, backgroundColor: CATEGORY_COLORS[el.category] }}
              >
                <span className="text-[8px] leading-none tabular-nums opacity-70">{el.z}</span>
                <span className="text-[13px] leading-tight font-bold">{el.symbol}</span>
              </button>
            );
          })}
          {[6, 7].map((period) => (
            <div
              key={period}
              aria-hidden
              className="flex aspect-square items-center justify-center rounded-[5px] border border-dashed border-grey-300 text-[8px] text-muted-foreground"
              style={{ gridColumn: 3, gridRow: period }}
            >
              {period === 6 ? "57–71" : "89–103"}
            </div>
          ))}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {(Object.keys(CATEGORY_LABELS) as ElementCategory[]).map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[c] }} />
            {CATEGORY_LABELS[c]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Values in brackets are for elements with no stable isotopes: the mass number of the longest-lived isotope.
      </p>
    </div>
  );
}
