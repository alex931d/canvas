import { balanceEquation, type Balanced } from "./balance";
import { molarMass, speciesToMhchem, type Species } from "./formula";

/**
 * Stoichiometry from a balanced equation: given amounts of the reactants
 * (grams or moles), which one runs out first, how much of each product it
 * makes, what's left of the others and, with an actual yield, the percent
 * yield. The working comes back as LaTeX lines.
 */

export type Amount = { value: number; unit: "g" | "mol" };

export type StoichReactant = {
  species: Species;
  coefficient: number;
  molarMass: number;
  moles: number;
  /** moles ÷ coefficient: the smallest one runs out first. */
  ratio: number;
  limiting: boolean;
  /** Moles and grams left over (0 for the limiting reagent). */
  leftMoles: number;
  leftGrams: number;
};

export type StoichProduct = {
  species: Species;
  coefficient: number;
  molarMass: number;
  moles: number;
  grams: number;
  /** With an actual yield in grams: actual ÷ theoretical × 100. */
  percentYield: number | null;
};

export type StoichResult =
  | { ok: true; balanced: Balanced; reactants: StoichReactant[]; products: StoichProduct[]; limiting: StoichReactant; steps: string[] }
  | { ok: false; error: string };

const g = (n: number) => (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0) ? n.toPrecision(3) : n.toFixed(2).replace(/\.?0+$/, "") || "0");
const ce = (s: Species) => `\\ce{${speciesToMhchem({ ...s, state: null, coefficient: null })}}`;

/**
 * `amounts` is one entry per reactant, in order; leave an entry undefined
 * for a reactant that's in excess. `actual` maps product index → grams
 * actually collected.
 */
export function stoichiometry(equation: string, amounts: (Amount | undefined)[], actual: Record<number, number> = {}): StoichResult {
  const balanced = balanceEquation(equation);
  if (!balanced.ok) return balanced;
  if (balanced.reactants.some((s) => s.isElectron) || balanced.products.some((s) => s.isElectron)) {
    return { ok: false, error: "Half equations with electrons can't be used for amounts: write the full reaction." };
  }
  const nR = balanced.reactants.length;
  const given = amounts.slice(0, nR);
  if (!given.some((a) => a && a.value > 0)) return { ok: false, error: "Give an amount for at least one reactant." };
  if (given.some((a) => a && !(a.value > 0))) return { ok: false, error: "Amounts have to be more than 0." };

  const steps: string[] = [`\\text{Balanced: } \\ce{${balanced.mhchem}}`];
  const reactants: StoichReactant[] = balanced.reactants.map((species, i) => {
    const mm = molarMass(species.counts).total;
    const a = given[i];
    const coefficient = balanced.coefficients[i];
    const moles = !a ? Infinity : a.unit === "mol" ? a.value : a.value / mm;
    if (a) {
      steps.push(
        a.unit === "g"
          ? `n(${ce(species)}) = \\frac{${g(a.value)}\\ \\mathrm{g}}{${g(mm)}\\ \\mathrm{g/mol}} = ${g(moles)}\\ \\mathrm{mol}`
          : `n(${ce(species)}) = ${g(moles)}\\ \\mathrm{mol}`,
      );
    }
    return { species, coefficient, molarMass: mm, moles, ratio: moles / coefficient, limiting: false, leftMoles: 0, leftGrams: 0 };
  });
  const limiting = reactants.reduce((min, r) => (r.ratio < min.ratio ? r : min));
  limiting.limiting = true;
  const extent = limiting.ratio;
  const measured = reactants.filter((r) => Number.isFinite(r.moles));
  if (measured.length > 1) {
    steps.push(
      `\\text{Divide by coefficients: } ${measured.map((r) => `\\frac{${g(r.moles)}}{${r.coefficient}} = ${g(r.ratio)}`).join(",\\ ")}`,
    );
    steps.push(`\\text{Limiting reagent: } ${ce(limiting.species)} \\text{ (smallest)}`);
  }
  for (const r of reactants) {
    if (r.limiting || !Number.isFinite(r.moles)) continue;
    r.leftMoles = r.moles - extent * r.coefficient;
    r.leftGrams = r.leftMoles * r.molarMass;
    steps.push(
      `\\text{Left over } ${ce(r.species)}: ${g(r.moles)} - ${r.coefficient}(${g(extent)}) = ${g(r.leftMoles)}\\ \\mathrm{mol} = ${g(r.leftGrams)}\\ \\mathrm{g}`,
    );
  }
  const products: StoichProduct[] = balanced.products.map((species, j) => {
    const coefficient = balanced.coefficients[nR + j];
    const mm = molarMass(species.counts).total;
    const moles = extent * coefficient;
    const grams = moles * mm;
    steps.push(
      `${ce(species)}: ${g(limiting.moles)}\\ \\mathrm{mol} \\times \\frac{${coefficient}}{${limiting.coefficient}} = ${g(moles)}\\ \\mathrm{mol} \\times ${g(mm)}\\ \\mathrm{g/mol} = ${g(grams)}\\ \\mathrm{g}`,
    );
    const got = actual[j];
    const percentYield = got !== undefined && got > 0 && grams > 0 ? (got / grams) * 100 : null;
    if (percentYield !== null) {
      steps.push(`\\text{Percent yield} = \\frac{${g(got)}}{${g(grams)}} \\times 100\\% = ${percentYield.toFixed(1)}\\%`);
    }
    return { species, coefficient, molarMass: mm, moles, grams, percentYield };
  });
  return { ok: true, balanced, reactants, products, limiting, steps };
}
