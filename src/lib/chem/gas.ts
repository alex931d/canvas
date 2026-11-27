/**
 * Gas laws: the ideal gas law (PV = nRT, solve for whichever is left blank)
 * and the combined law (P₁V₁/T₁ = P₂V₂/T₂, solve for the one blank; leave
 * a pair out to get Boyle's, Charles's or Gay-Lussac's law). Units are
 * converted to atm, L and K for the working and back for the answer.
 */

export type PressureUnit = "atm" | "kPa" | "mmHg" | "Pa" | "bar";
export type VolumeUnit = "L" | "mL" | "m3";
export type TempUnit = "K" | "C" | "F";

export const PRESSURE_UNITS: PressureUnit[] = ["atm", "kPa", "mmHg", "Pa", "bar"];
export const VOLUME_UNITS: VolumeUnit[] = ["L", "mL", "m3"];
export const TEMP_UNITS: TempUnit[] = ["K", "C", "F"];

const TO_ATM: Record<PressureUnit, number> = { atm: 1, kPa: 1 / 101.325, mmHg: 1 / 760, Pa: 1 / 101325, bar: 1 / 1.01325 };
const TO_L: Record<VolumeUnit, number> = { L: 1, mL: 1e-3, m3: 1000 };
export const R_L_ATM = 0.082057;

export const toAtm = (v: number, u: PressureUnit) => v * TO_ATM[u];
export const fromAtm = (v: number, u: PressureUnit) => v / TO_ATM[u];
export const toL = (v: number, u: VolumeUnit) => v * TO_L[u];
export const fromL = (v: number, u: VolumeUnit) => v / TO_L[u];
export function toK(v: number, u: TempUnit) {
  return u === "K" ? v : u === "C" ? v + 273.15 : ((v - 32) * 5) / 9 + 273.15;
}
export function fromK(v: number, u: TempUnit) {
  return u === "K" ? v : u === "C" ? v - 273.15 : ((v - 273.15) * 9) / 5 + 32;
}

const n4 = (n: number) => +n.toPrecision(4);
const tempTex = (u: TempUnit) => (u === "K" ? "\\mathrm{K}" : u === "C" ? "^\\circ\\mathrm{C}" : "^\\circ\\mathrm{F}");
const unitTex = (u: string) => (u === "m3" ? "\\mathrm{m^3}" : `\\mathrm{${u}}`);

export type GasResult = { ok: true; key: string; value: number; unit: string; steps: string[] } | { ok: false; error: string };

export type IdealInput = {
  P?: { value: number; unit: PressureUnit };
  V?: { value: number; unit: VolumeUnit };
  n?: { value: number };
  T?: { value: number; unit: TempUnit };
};

export function idealGas(input: IdealInput, want: { P?: PressureUnit; V?: VolumeUnit; T?: TempUnit } = {}): GasResult {
  const keys = (["P", "V", "n", "T"] as const).filter((k) => input[k] !== undefined && Number.isFinite(input[k]!.value));
  if (keys.length !== 3) return { ok: false, error: "Fill in three of P, V, n and T and leave the one to find blank." };
  const P = input.P && toAtm(input.P.value, input.P.unit);
  const V = input.V && toL(input.V.value, input.V.unit);
  const n = input.n?.value;
  const T = input.T && toK(input.T.value, input.T.unit);
  if ((P !== undefined && P <= 0) || (V !== undefined && V <= 0) || (n !== undefined && n <= 0)) {
    return { ok: false, error: "Pressure, volume and amount have to be more than 0." };
  }
  if (T !== undefined && T <= 0) return { ok: false, error: "That temperature is at or below absolute zero." };
  const steps = ["PV = nRT,\\quad R = 0.08206\\ \\mathrm{L\\,atm/(mol\\,K)}"];
  if (input.T && input.T.unit !== "K") steps.push(`T = ${input.T.value}${tempTex(input.T.unit)} = ${n4(T!)}\\ \\mathrm{K}`);
  if (input.P && input.P.unit !== "atm") steps.push(`P = ${input.P.value}\\ ${unitTex(input.P.unit)} = ${n4(P!)}\\ \\mathrm{atm}`);
  if (input.V && input.V.unit !== "L") steps.push(`V = ${input.V.value}\\ ${unitTex(input.V.unit)} = ${n4(V!)}\\ \\mathrm{L}`);
  const missing = (["P", "V", "n", "T"] as const).find((k) => !keys.includes(k))!;
  switch (missing) {
    case "P": {
      const v = (n! * R_L_ATM * T!) / V!;
      const unit = want.P ?? "atm";
      steps.push(`P = \\frac{nRT}{V} = \\frac{(${n4(n!)})(0.08206)(${n4(T!)})}{${n4(V!)}} = ${n4(v)}\\ \\mathrm{atm}`);
      if (unit !== "atm") steps.push(`= ${n4(fromAtm(v, unit))}\\ ${unitTex(unit)}`);
      return { ok: true, key: "P", value: fromAtm(v, unit), unit, steps };
    }
    case "V": {
      const v = (n! * R_L_ATM * T!) / P!;
      const unit = want.V ?? "L";
      steps.push(`V = \\frac{nRT}{P} = \\frac{(${n4(n!)})(0.08206)(${n4(T!)})}{${n4(P!)}} = ${n4(v)}\\ \\mathrm{L}`);
      if (unit !== "L") steps.push(`= ${n4(fromL(v, unit))}\\ ${unitTex(unit)}`);
      return { ok: true, key: "V", value: fromL(v, unit), unit, steps };
    }
    case "n": {
      const v = (P! * V!) / (R_L_ATM * T!);
      steps.push(`n = \\frac{PV}{RT} = \\frac{(${n4(P!)})(${n4(V!)})}{(0.08206)(${n4(T!)})} = ${n4(v)}\\ \\mathrm{mol}`);
      return { ok: true, key: "n", value: v, unit: "mol", steps };
    }
    case "T": {
      const v = (P! * V!) / (n! * R_L_ATM);
      const unit = want.T ?? "K";
      steps.push(`T = \\frac{PV}{nR} = \\frac{(${n4(P!)})(${n4(V!)})}{(${n4(n!)})(0.08206)} = ${n4(v)}\\ \\mathrm{K}`);
      if (unit !== "K") steps.push(`= ${n4(fromK(v, unit))}${tempTex(unit)}`);
      return { ok: true, key: "T", value: fromK(v, unit), unit, steps };
    }
  }
}

export type CombinedKey = "P1" | "V1" | "T1" | "P2" | "V2" | "T2";
export type CombinedInput = Partial<Record<CombinedKey, number>> & { pUnit: PressureUnit; vUnit: VolumeUnit; tUnit: TempUnit };

/**
 * Five of the six (or, for a two-variable law, both of a pair left blank and
 * four given). Pressures and volumes share a unit, so they cancel; only
 * temperatures need converting.
 */
export function combinedGas(input: CombinedInput): GasResult {
  const all: CombinedKey[] = ["P1", "V1", "T1", "P2", "V2", "T2"];
  const has = (k: CombinedKey) => input[k] !== undefined && Number.isFinite(input[k]!);
  const blank = all.filter((k) => !has(k));
  // A pair left out on both sides drops out of the law (it's constant).
  const constant = (["P", "V", "T"] as const).filter((q) => !has(`${q}1` as CombinedKey) && !has(`${q}2` as CombinedKey));
  if (constant.length > 1) return { ok: false, error: "Only one quantity can stay constant." };
  const unknowns = blank.filter((k) => !constant.includes(k[0] as "P"));
  if (unknowns.length !== 1) return { ok: false, error: "Leave exactly one value blank to solve for it." };
  const target = unknowns[0];
  const k = (key: CombinedKey) => (key[0] === "T" ? toK(input[key]!, input.tUnit) : input[key]!);
  for (const key of all) if (has(key) && k(key) <= 0) return { ok: false, error: "Every value has to be more than 0 (and temperatures above absolute zero)." };

  const lawName = !constant.length ? "Combined gas law" : { P: "Charles's law", V: "Gay-Lussac's law", T: "Boyle's law" }[constant[0]];
  const side = (i: 1 | 2) => {
    const top = (["P", "V"] as const).filter((q) => !constant.includes(q)).map((q) => `${q}_${i}`).join("");
    return constant.includes("T") ? top : `\\frac{${top || "1"}}{T_${i}}`;
  };
  const steps = [`\\text{${lawName}: } ${side(1)} = ${side(2)}`];
  if (input.tUnit !== "K") {
    for (const key of ["T1", "T2"] as const) if (has(key)) steps.push(`T_${key[1]} = ${input[key]}${tempTex(input.tUnit)} = ${n4(k(key))}\\ \\mathrm{K}`);
  }
  // value(side) = product of P and V over T, with the target treated as 1.
  const weight = (i: "1" | "2") => {
    let w = 1;
    for (const q of ["P", "V"] as const) {
      const key = `${q}${i}` as CombinedKey;
      if (!constant.includes(q) && key !== target) w *= k(key);
    }
    const t = `T${i}` as CombinedKey;
    if (!constant.includes("T") && t !== target) w /= k(t);
    return w;
  };
  const own = target[1] as "1" | "2";
  const other = own === "1" ? "2" : "1";
  // target appears on its own side as a factor (P or V) or a divisor (T).
  const value = target[0] === "T" ? weight(own) / weight(other) : weight(other) / weight(own);
  const tex = target.replace(/(\d)/, "_$1");
  const shown = target[0] === "T" ? fromK(value, input.tUnit) : value;
  const unit = target[0] === "P" ? input.pUnit : target[0] === "V" ? input.vUnit : input.tUnit;
  steps.push(`${tex} = ${n4(target[0] === "T" ? value : shown)}${target[0] === "T" ? "\\ \\mathrm{K}" : `\\ ${unitTex(unit)}`}`);
  if (target[0] === "T" && input.tUnit !== "K") steps.push(`= ${n4(shown)}${tempTex(input.tUnit)}`);
  return { ok: true, key: target, value: shown, unit, steps };
}
