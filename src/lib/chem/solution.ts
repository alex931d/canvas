import { molarMass, parseSpecies, speciesToMhchem } from "./formula";

/**
 * Solutions: molarity (moles or grams of a solute in a volume), dilution
 * (M₁V₁ = M₂V₂) and pH (from [H⁺], [OH⁻], pH or pOH, or from a strong or
 * weak acid or base's concentration). Results come with LaTeX working.
 */

export type CalcResult = { ok: true; value: number; unit: string; steps: string[]; extra?: Record<string, number> } | { ok: false; error: string };

const n4 = (n: number) => +n.toPrecision(4);
const sci = (n: number) => {
  if (n === 0) return "0";
  if (n >= 0.001 && n < 10000) return String(n4(n));
  const [m, e] = n.toExponential(2).split("e");
  return `${m} \\times 10^{${Number(e)}}`;
};

/**
 * Molarity: give two of moles/grams, volume (L) and molarity; the third is
 * worked out. With a formula, grams are allowed in place of moles.
 */
export function molarity(input: { formula?: string; grams?: number; moles?: number; liters?: number; molarity?: number }): CalcResult {
  let mm: number | null = null;
  let label = "\\text{solute}";
  if (input.formula?.trim()) {
    try {
      const s = parseSpecies(input.formula);
      mm = molarMass(s.counts).total;
      label = `\\ce{${speciesToMhchem({ ...s, coefficient: null, state: null })}}`;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const steps: string[] = [];
  let moles = input.moles;
  if (moles === undefined && input.grams !== undefined) {
    if (!mm) return { ok: false, error: "Give the formula to use grams." };
    moles = input.grams / mm;
    steps.push(`n = \\frac{${n4(input.grams)}\\ \\mathrm{g}}{${n4(mm)}\\ \\mathrm{g/mol}} = ${sci(moles)}\\ \\mathrm{mol}`);
  }
  const known = [moles, input.liters, input.molarity].filter((v) => v !== undefined && Number.isFinite(v)).length;
  if (known !== 2) return { ok: false, error: "Fill in two of: amount (moles or grams), volume and molarity." };
  if ([moles, input.liters, input.molarity].some((v) => v !== undefined && v <= 0)) return { ok: false, error: "Values have to be more than 0." };
  if (input.molarity === undefined) {
    const M = moles! / input.liters!;
    steps.push(`M = \\frac{n}{V} = \\frac{${sci(moles!)}\\ \\mathrm{mol}}{${n4(input.liters!)}\\ \\mathrm{L}} = ${sci(M)}\\ \\mathrm{M}\\ ${label}`);
    return { ok: true, value: M, unit: "M", steps };
  }
  if (input.liters === undefined) {
    const V = moles! / input.molarity;
    steps.push(`V = \\frac{n}{M} = \\frac{${sci(moles!)}}{${sci(input.molarity)}} = ${sci(V)}\\ \\mathrm{L}`);
    return { ok: true, value: V, unit: "L", steps };
  }
  const n = input.molarity * input.liters;
  steps.push(`n = MV = (${sci(input.molarity)})(${n4(input.liters)}) = ${sci(n)}\\ \\mathrm{mol}`);
  if (mm) {
    const grams = n * mm;
    steps.push(`m = n \\times M_r = ${sci(n)} \\times ${n4(mm)} = ${sci(grams)}\\ \\mathrm{g}\\ ${label}`);
    return { ok: true, value: grams, unit: "g", steps, extra: { moles: n } };
  }
  return { ok: true, value: n, unit: "mol", steps };
}

export function dilution(input: { M1?: number; V1?: number; M2?: number; V2?: number }): CalcResult {
  const keys = ["M1", "V1", "M2", "V2"] as const;
  const blank = keys.filter((k) => input[k] === undefined || !Number.isFinite(input[k]!));
  if (blank.length !== 1) return { ok: false, error: "Fill in three of M₁, V₁, M₂ and V₂." };
  if (keys.some((k) => input[k] !== undefined && input[k]! <= 0)) return { ok: false, error: "Values have to be more than 0." };
  const { M1, V1, M2, V2 } = input;
  const steps = ["M_1V_1 = M_2V_2"];
  const target = blank[0];
  const value =
    target === "M1" ? (M2! * V2!) / V1! : target === "V1" ? (M2! * V2!) / M1! : target === "M2" ? (M1! * V1!) / V2! : (M1! * V1!) / M2!;
  const [num, den] =
    target === "M1" || target === "V1"
      ? [`(${n4(M2!)})(${n4(V2!)})`, n4(target === "M1" ? V1! : M1!)]
      : [`(${n4(M1!)})(${n4(V1!)})`, n4(target === "M2" ? V2! : M2!)];
  const tex = target.replace(/(\d)/, "_$1");
  steps.push(`${tex} = \\frac{${num}}{${den}} = ${n4(value)}`);
  if ((target === "M2" && value > M1!) || (target === "M1" && value < M2!)) {
    return { ok: false, error: "Diluting can't make a solution stronger: check which is the starting solution." };
  }
  if (target === "V2" || target === "V1") {
    const add = (target === "V2" ? value : V2!) - (target === "V1" ? value : V1!);
    if (add > 0) steps.push(`\\text{Add } ${n4(add)} \\text{ of solvent}`);
  }
  return { ok: true, value, unit: target[0] === "M" ? "M" : "volume", steps };
}

export type PhInput =
  | { kind: "pH" | "pOH" | "H" | "OH"; value: number }
  | { kind: "strong-acid" | "strong-base"; value: number; ions?: number }
  | { kind: "weak-acid" | "weak-base"; value: number; k: number };

export type PhResult = { ok: true; pH: number; pOH: number; H: number; OH: number; steps: string[] } | { ok: false; error: string };

/** At 25 °C (Kw = 1.0 × 10⁻¹⁴). */
export function ph(input: PhInput): PhResult {
  const v = input.value;
  if (!Number.isFinite(v)) return { ok: false, error: "Type a number." };
  const steps: string[] = [];
  let H: number;
  switch (input.kind) {
    case "pH":
      H = 10 ** -v;
      steps.push(`[\\mathrm{H^+}] = 10^{-\\mathrm{pH}} = 10^{-${v}} = ${sci(H)}\\ \\mathrm{M}`);
      break;
    case "pOH": {
      const OH = 10 ** -v;
      H = 1e-14 / OH;
      steps.push(`\\mathrm{pH} = 14 - \\mathrm{pOH} = 14 - ${v} = ${n4(14 - v)}`);
      break;
    }
    case "H":
      if (v <= 0) return { ok: false, error: "A concentration has to be more than 0." };
      H = v;
      break;
    case "OH":
      if (v <= 0) return { ok: false, error: "A concentration has to be more than 0." };
      H = 1e-14 / v;
      steps.push(`[\\mathrm{H^+}] = \\frac{K_w}{[\\mathrm{OH^-}]} = \\frac{1.0 \\times 10^{-14}}{${sci(v)}} = ${sci(H)}\\ \\mathrm{M}`);
      break;
    case "strong-acid":
    case "strong-base": {
      if (v <= 0) return { ok: false, error: "A concentration has to be more than 0." };
      const ions = input.ions ?? 1;
      const c = v * ions;
      const ion = input.kind === "strong-acid" ? "H^+" : "OH^-";
      steps.push(`\\text{Strong, so it dissociates fully: } [\\mathrm{${ion}}] = ${ions > 1 ? `${ions} \\times ` : ""}${sci(v)} = ${sci(c)}\\ \\mathrm{M}`);
      H = input.kind === "strong-acid" ? c : 1e-14 / c;
      break;
    }
    case "weak-acid":
    case "weak-base": {
      if (v <= 0 || !(input.k > 0)) return { ok: false, error: "Give a concentration and a K above 0." };
      // x²/(C − x) = K  →  x = (−K + √(K² + 4KC)) / 2
      const x = (-input.k + Math.sqrt(input.k ** 2 + 4 * input.k * v)) / 2;
      const ion = input.kind === "weak-acid" ? "H^+" : "OH^-";
      const K = input.kind === "weak-acid" ? "K_a" : "K_b";
      steps.push(`${K} = \\frac{x^2}{C - x} \\Rightarrow ${sci(input.k)} = \\frac{x^2}{${sci(v)} - x}`);
      steps.push(`x = [\\mathrm{${ion}}] = \\frac{-${K} + \\sqrt{${K}^2 + 4${K}C}}{2} = ${sci(x)}\\ \\mathrm{M}`);
      steps.push(`\\text{Percent ionized} = \\frac{${sci(x)}}{${sci(v)}} \\times 100\\% = ${n4((x / v) * 100)}\\%`);
      H = input.kind === "weak-acid" ? x : 1e-14 / x;
      break;
    }
  }
  const pH = -Math.log10(H);
  const OH = 1e-14 / H;
  if (input.kind !== "pH" && input.kind !== "pOH") steps.push(`\\mathrm{pH} = -\\log[\\mathrm{H^+}] = -\\log(${sci(H)}) = ${pH.toFixed(2)}`);
  steps.push(`\\mathrm{pOH} = 14 - \\mathrm{pH} = ${(14 - pH).toFixed(2)}`);
  steps.push(`\\text{${pH < 6.995 ? "Acidic" : pH > 7.005 ? "Basic" : "Neutral"}}`);
  return { ok: true, pH, pOH: 14 - pH, H, OH, steps };
}

