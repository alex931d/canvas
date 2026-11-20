import { ELEMENT_BY_SYMBOL, type ChemicalElement } from "./elements";

/**
 * Chemical formulas as students type them:
 *
 *   H2O   Ca(OH)2   K4[Fe(CN)6]   CuSO4·5H2O (also CuSO4.5H2O, CuSO4*5H2O)
 *   2H2O  (leading coefficient)     NaCl(aq)  (state)
 *   Fe3+  Fe^3+  Fe^{3+}  Fe+3  SO4^2-  SO42-  NO3-  NH4+  e-  (charges)
 *
 * Plain trailing charges are read the way they're usually meant: "Fe3+" is
 * Fe³⁺ (a lone element's digit is its charge), "NO3-" is NO₃⁻ (one digit on
 * a polyatomic ion is a subscript) and "SO42-" is SO₄²⁻ (with two or more
 * digits, the last is the charge). "^" or a space removes any doubt.
 */

export class FormulaError extends Error {}

export type ChemState = "s" | "l" | "g" | "aq";

export type Species = {
  /** As typed, trimmed. */
  input: string;
  /** Leading coefficient, when one was typed ("2H2O" → 2). */
  coefficient: number | null;
  /** The formula without coefficient, charge and state ("CuSO4·5H2O"). */
  body: string;
  /** Atoms per formula unit, in order of first appearance. */
  counts: Map<string, number>;
  charge: number;
  state: ChemState | null;
  isElectron: boolean;
};

const SUBSCRIPTS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};
const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-",
};

/** Unicode sub/superscripts and dots to plain ASCII ("SO₄²⁻" → "SO4^2-"). */
export function normalizeChemText(text: string): string {
  let out = "";
  let inSuper = false;
  for (const ch of text) {
    if (ch in SUPERSCRIPTS) {
      if (!inSuper) out += "^";
      inSuper = true;
      out += SUPERSCRIPTS[ch];
      continue;
    }
    inSuper = false;
    if (ch in SUBSCRIPTS) out += SUBSCRIPTS[ch];
    else if (ch === "·" || ch === "•" || ch === "⋅" || ch === "∙") out += "·";
    else if (ch === "−" || ch === "–") out += "-";
    else out += ch;
  }
  return out;
}

type Charge = { body: string; charge: number };

/** Split a trailing charge off the formula text. */
function splitCharge(text: string): Charge {
  // Explicit: ^{2+}, ^2+, ^+, ^{-}, ^3-, ^+2
  let m = text.match(/\^\{?\s*(\d*)\s*([+-]+)\s*\}?$/) ?? text.match(/\^\{?\s*([+-])\s*(\d+)\s*\}?$/);
  if (m) {
    const [digits, signs] = /\d/.test(m[1]) || m[1] === "" ? [m[1], m[2]] : [m[2], m[1]];
    return { body: text.slice(0, m.index).trimEnd(), charge: chargeValue(digits, signs) };
  }
  // With a space: "SO4 2-", "Fe 3+"
  m = text.match(/\s+(\d*)([+-]+)$/);
  if (m) return { body: text.slice(0, m.index).trimEnd(), charge: chargeValue(m[1], m[2]) };
  // Sign then digits: "Fe+3", "SO4-2"
  m = text.match(/([+-])(\d+)$/);
  if (m && /[A-Za-z0-9)\]]$/.test(text.slice(0, m.index))) {
    return { body: text.slice(0, m.index), charge: chargeValue(m[2], m[1]) };
  }
  // Plain: "Fe3+", "NO3-", "SO42-", "NH4+", "Na+", "Fe+++"
  m = text.match(/(\d*)([+-]+)$/);
  if (m) {
    let body = text.slice(0, m.index);
    let digits = m[1];
    const signs = m[2];
    if (digits && signs.length === 1) {
      const monatomic = /^[A-Z][a-z]?$/.test(body);
      if (monatomic) {
        if (digits.length >= 2) {
          body += digits.slice(0, -1);
          digits = digits.slice(-1);
        }
      } else if (digits.length >= 2) {
        body += digits.slice(0, -1);
        digits = digits.slice(-1);
      } else {
        body += digits;
        digits = "";
      }
    }
    return { body, charge: chargeValue(digits, signs) };
  }
  return { body: text, charge: 0 };
}

function chargeValue(digits: string, signs: string): number {
  const sign = signs[0] === "-" ? -1 : 1;
  const magnitude = digits ? Number(digits) : signs.length;
  return sign * magnitude;
}

/** Parse one species ("2Fe2(SO4)3(aq)", "e-"). Throws FormulaError. */
export function parseSpecies(raw: string): Species {
  const input = raw.trim();
  let text = normalizeChemText(input).replace(/\s+/g, " ").trim();
  if (!text) throw new FormulaError("Type a formula, like H2O or Ca(OH)2.");

  let state: ChemState | null = null;
  const stateMatch = text.match(/\s*\((s|l|g|aq)\)$/i);
  if (stateMatch) {
    state = stateMatch[1].toLowerCase() as ChemState;
    text = text.slice(0, stateMatch.index).trimEnd();
  }

  let coefficient: number | null = null;
  const coef = text.match(/^(\d+\/\d+|\d*\.\d+|\d+)\s*(?=[A-Za-z([{])/);
  if (coef) {
    const [num, den] = coef[1].split("/");
    coefficient = den ? Number(num) / Number(den) : Number(num);
    if (!(coefficient > 0)) throw new FormulaError("A coefficient has to be more than zero.");
    text = text.slice(coef[0].length);
  }

  if (/^e(\^?\{?-?\}?|-)?$/.test(text)) {
    return { input, coefficient, body: "e", counts: new Map(), charge: -1, state, isElectron: true };
  }

  const { body, charge } = splitCharge(text);
  const counts = parseBody(body.trim());
  return { input, coefficient, body: body.trim(), counts, charge, state, isElectron: false };
}

/** Atoms in a formula body: "Ca(OH)2" → Ca 1, O 2, H 2. */
export function parseBody(body: string): Map<string, number> {
  if (!body) throw new FormulaError("Type a formula, like H2O or Ca(OH)2.");
  const counts = new Map<string, number>();
  // Hydrates and adducts: CuSO4·5H2O, CuSO4.5H2O, CuSO4*5H2O
  const parts = body.split(/\s*[·*]\s*|(?<=[A-Za-z0-9)\]}])\.(?=\d*[A-Z(\[{])/);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*/);
    const multiplier = m ? Number(m[1]) : 1;
    const rest = m ? part.slice(m[0].length) : part;
    const parser = new BodyParser(rest);
    for (const [symbol, n] of parser.parse()) {
      counts.set(symbol, (counts.get(symbol) ?? 0) + n * multiplier);
    }
  }
  return counts;
}

const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

class BodyParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Map<string, number> {
    if (!this.s) throw new FormulaError("Something is missing after a dot: add the formula that follows it.");
    const counts = this.group(null);
    if (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === ")" || ch === "]" || ch === "}") throw new FormulaError(`There's a "${ch}" without an opening bracket.`);
      throw new FormulaError(`"${ch}" can't go there.`);
    }
    if (counts.size === 0) throw new FormulaError("Type a formula, like H2O or Ca(OH)2.");
    return counts;
  }

  private group(close: string | null): Map<string, number> {
    const counts = new Map<string, number>();
    const add = (sym: string, n: number) => counts.set(sym, (counts.get(sym) ?? 0) + n);
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === close) return counts;
      if (ch === "(" || ch === "[" || ch === "{") {
        this.i++;
        const inner = this.group(CLOSE[ch]);
        if (this.s[this.i] !== CLOSE[ch]) throw new FormulaError(`A "${ch}" is never closed: add "${CLOSE[ch]}".`);
        this.i++;
        if (inner.size === 0) throw new FormulaError("There's an empty pair of brackets.");
        const n = this.count();
        for (const [sym, k] of inner) add(sym, k * n);
        continue;
      }
      if (/[A-Z]/.test(ch)) {
        const two = this.s.slice(this.i, this.i + 2);
        let symbol: string;
        if (/^[A-Z][a-z]$/.test(two) && ELEMENT_BY_SYMBOL.has(two)) symbol = two;
        else if (ELEMENT_BY_SYMBOL.has(ch)) symbol = ch;
        else if (/^[A-Z][a-z]$/.test(two)) throw new FormulaError(`"${two}" isn't an element symbol.`);
        else throw new FormulaError(`"${ch}" isn't an element symbol.`);
        this.i += symbol.length;
        add(symbol, this.count());
        continue;
      }
      if (/[a-z]/.test(ch)) {
        const guess = ch.toUpperCase() + (this.s[this.i + 1] && /[a-z]/.test(this.s[this.i + 1]) ? this.s[this.i + 1] : "");
        const hint = ELEMENT_BY_SYMBOL.has(guess) ? guess : ch.toUpperCase();
        throw new FormulaError(`Element symbols start with a capital letter: try "${hint}".`);
      }
      if (/\d/.test(ch)) throw new FormulaError("A number has to come after the element or bracket it counts.");
      if (ch === ")" || ch === "]" || ch === "}") {
        throw new FormulaError(`There's a "${ch}" without an opening bracket.`);
      }
      if (ch === " ") {
        this.i++;
        continue;
      }
      throw new FormulaError(`"${ch}" can't go in a formula.`);
    }
    if (close) throw new FormulaError(`A bracket is never closed: add "${close}".`);
    return counts;
  }

  private count(): number {
    const m = this.s.slice(this.i).match(/^\d+/);
    if (!m) return 1;
    this.i += m[0].length;
    const n = Number(m[0]);
    if (n === 0) throw new FormulaError("A count of 0 means the atom isn't there: remove it.");
    return n;
  }
}

export type MolarMassPart = {
  element: ChemicalElement;
  count: number;
  /** g/mol contributed by this element. */
  mass: number;
  /** Share of the total mass, 0–100. */
  percent: number;
};

export type MolarMass = { total: number; parts: MolarMassPart[]; usesRadioactive: boolean };

/** Molar mass in g/mol with a per-element breakdown. */
export function molarMass(counts: ReadonlyMap<string, number>): MolarMass {
  let total = 0;
  const parts: Omit<MolarMassPart, "percent">[] = [];
  let usesRadioactive = false;
  for (const [symbol, count] of counts) {
    const element = ELEMENT_BY_SYMBOL.get(symbol);
    if (!element) throw new FormulaError(`"${symbol}" isn't an element symbol.`);
    usesRadioactive ||= element.radioactive;
    const mass = element.weight * count;
    total += mass;
    parts.push({ element, count, mass });
  }
  return {
    total,
    parts: parts.map((p) => ({ ...p, percent: total > 0 ? (p.mass / total) * 100 : 0 })),
    usesRadioactive,
  };
}

/** Text for mhchem's \ce{}: the body plus an explicit charge and state. */
export function speciesToMhchem(s: Species, coefficient?: number): string {
  const coef = coefficient && coefficient !== 1 ? String(coefficient) : "";
  if (s.isElectron) return `${coef}e-`;
  const body = s.body.replace(/·/g, "*");
  const charge =
    s.charge === 0 ? "" : `^{${Math.abs(s.charge) === 1 ? "" : Math.abs(s.charge)}${s.charge > 0 ? "+" : "-"}}`;
  const state = s.state ? `(${s.state})` : "";
  return `${coef}${body}${charge}${state}`;
}

/** Plain text with Unicode charge, for results ("Fe³⁺", "SO₄²⁻" stays readable). */
export function speciesToText(s: Species, coefficient?: number): string {
  const coef = coefficient && coefficient !== 1 ? String(coefficient) : "";
  if (s.isElectron) return `${coef}e⁻`;
  const sup = (t: string) => t.replace(/[0-9+-]/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"["0123456789".indexOf(c)] ?? (c === "+" ? "⁺" : "⁻"));
  const sub = (t: string) => t.replace(/\d/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)]);
  // Subscript digits that follow an element or bracket; keep hydrate multipliers ("5H2O") normal.
  const body = s.body.replace(/([A-Za-z)\]}])(\d+)/g, (_, a: string, d: string) => a + sub(d));
  const charge =
    s.charge === 0 ? "" : sup(`${Math.abs(s.charge) === 1 ? "" : Math.abs(s.charge)}${s.charge > 0 ? "+" : "-"}`);
  const state = s.state ? `(${s.state})` : "";
  return `${coef}${body}${charge}${state}`;
}
