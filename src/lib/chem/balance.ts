import { FormulaError, normalizeChemText, parseSpecies, speciesToMhchem, speciesToText, type Species } from "./formula";

/**
 * Balance a chemical equation: "Fe + O2 -> Fe2O3" → 4Fe + 3O2 → 2Fe2O3.
 *
 * Each element (and the charge, for ionic and half equations) must be
 * conserved, which gives a homogeneous linear system A·c = 0 over the
 * coefficients c. Its null space is found exactly with fractions (BigInt
 * rationals, so no rounding), and the one basis vector is scaled to the
 * smallest whole numbers.
 */

export type BalanceRow = { symbol: string; left: number; right: number };

export type Balanced = {
  ok: true;
  reactants: Species[];
  products: Species[];
  /** Coefficients for reactants, then products. */
  coefficients: number[];
  reversible: boolean;
  /** "4Fe + 3O₂ → 2Fe₂O₃" */
  text: string;
  /** mhchem source: "4Fe + 3O2 -> 2Fe2O3" */
  mhchem: string;
  /** Atom (and charge) counts per side, for showing the check. */
  rows: BalanceRow[];
};

export type BalanceResult = Balanced | { ok: false; error: string };

// ------------------------------------------------------------ fractions

type Frac = { n: bigint; d: bigint };
const ZERO = BigInt(0);
const ONE = BigInt(1);
const abs = (a: bigint) => (a < ZERO ? -a : a);
const gcd = (a: bigint, b: bigint): bigint => {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const frac = (n: bigint, d = ONE): Frac => {
  if (d < ZERO) [n, d] = [-n, -d];
  const g = gcd(n, d) || ONE;
  return { n: n / g, d: d / g };
};
const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n);
const isZero = (a: Frac) => a.n === ZERO;

/** Basis of the null space of a rational matrix (rows × cols). */
function nullSpace(matrix: Frac[][], cols: number): Frac[][] {
  const m = matrix.map((r) => r.slice());
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < cols && row < m.length; col++) {
    let p = row;
    while (p < m.length && isZero(m[p][col])) p++;
    if (p === m.length) continue;
    [m[row], m[p]] = [m[p], m[row]];
    const pivot = m[row][col];
    m[row] = m[row].map((v) => div(v, pivot));
    for (let r = 0; r < m.length; r++) {
      if (r === row || isZero(m[r][col])) continue;
      const factor = m[r][col];
      m[r] = m[r].map((v, c) => sub(v, mul(factor, m[row][c])));
    }
    pivots.push(col);
    row++;
  }
  const free = [...Array(cols).keys()].filter((c) => !pivots.includes(c));
  return free.map((f) => {
    const v: Frac[] = Array.from({ length: cols }, () => frac(ZERO));
    v[f] = frac(ONE);
    pivots.forEach((pc, r) => {
      v[pc] = frac(-m[r][f].n, m[r][f].d);
    });
    return v;
  });
}

// ------------------------------------------------------------ parsing

const ARROWS: [RegExp, boolean][] = [
  [/<=>|<->|⇌|⇄|↔|⟷|<-->/, true],
  [/-+>|=+>|→|⟶|⇒|=/, false],
];

/** Split one side on "+" signs that separate species, not ones in charges. */
export function splitSide(side: string): string[] {
  const out: string[] = [];
  let cur = "";
  let braces = 0;
  for (let i = 0; i < side.length; i++) {
    const ch = side[i];
    if (ch === "{") braces++;
    if (ch === "}") braces = Math.max(0, braces - 1);
    if (ch !== "+" || braces > 0) {
      cur += ch;
      continue;
    }
    const before = cur.trimEnd();
    const rest = side.slice(i + 1);
    const next = rest.trimStart();
    // In a charge: "^+", "^2+", "Fe3+ + ...", a trailing "+", or before a state "(aq)".
    const inCharge =
      /\^\d*$/.test(before) ||
      next === "" ||
      next.startsWith("+") ||
      /^\((s|l|g|aq)\)/i.test(next) ||
      // "Na+" followed by digits as in "Fe+3"
      (/^\d+(\s|$|\+)/.test(rest) && /[A-Za-z)\]]$/.test(before) && !/\s/.test(rest[0] ?? ""));
    if (inCharge || before === "") {
      cur += ch;
      continue;
    }
    out.push(cur);
    cur = "";
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseEquation(text: string): { reactants: string[]; products: string[]; reversible: boolean } {
  const normalized = normalizeChemText(text).trim();
  for (const [re, reversible] of ARROWS) {
    const parts = normalized.split(re);
    if (parts.length === 2) {
      return { reactants: splitSide(parts[0]), products: splitSide(parts[1]), reversible };
    }
    if (parts.length > 2) throw new FormulaError("Use one arrow, between the reactants and the products.");
  }
  throw new FormulaError("Put an arrow between reactants and products, like H2 + O2 -> H2O.");
}

// ------------------------------------------------------------ balancing

export function balanceEquation(text: string): BalanceResult {
  let parsed: ReturnType<typeof parseEquation>;
  try {
    parsed = parseEquation(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (parsed.reactants.length === 0) return { ok: false, error: "Add the reactants before the arrow." };
  if (parsed.products.length === 0) return { ok: false, error: "Add the products after the arrow." };

  let reactants: Species[];
  let products: Species[];
  try {
    reactants = parsed.reactants.map(parseSpecies);
    products = parsed.products.map(parseSpecies);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const species = [...reactants, ...products];
  if (species.length > 24) return { ok: false, error: "That's too many substances for one equation." };

  const symbols: string[] = [];
  for (const s of species) for (const sym of s.counts.keys()) if (!symbols.includes(sym)) symbols.push(sym);

  // An element on one side only can never balance; say which.
  for (const sym of symbols) {
    const left = reactants.some((s) => s.counts.has(sym));
    const right = products.some((s) => s.counts.has(sym));
    if (left !== right) {
      return { ok: false, error: `${sym} appears only on the ${left ? "left" : "right"}, so this can't balance. Check the formulas.` };
    }
  }

  const hasCharge = species.some((s) => s.charge !== 0);
  const rowsSpec = [...symbols.map((sym) => (s: Species) => s.counts.get(sym) ?? 0)];
  if (hasCharge) rowsSpec.push((s) => s.charge);

  const matrix = rowsSpec.map((get) =>
    species.map((s, j) => frac(BigInt(get(s) * (j < reactants.length ? 1 : -1)))),
  );
  const basis = nullSpace(matrix, species.length);

  if (basis.length === 0) {
    return { ok: false, error: "This can't be balanced with these formulas. Check each one, including charges." };
  }
  if (basis.length > 1) {
    return {
      ok: false,
      error: "There's more than one way to balance this. It may be two reactions in one: balance them separately.",
    };
  }

  const v = basis[0];
  const lcm = v.reduce((acc, f) => (acc * f.d) / gcd(acc, f.d), ONE);
  let ints = v.map((f) => (f.n * lcm) / f.d);
  const g = ints.reduce((acc, n) => gcd(acc, n), ZERO) || ONE;
  ints = ints.map((n) => n / g);
  if (ints.every((n) => n <= ZERO)) ints = ints.map((n) => -n);
  if (ints.some((n) => n <= ZERO)) {
    const bad = species[ints.findIndex((n) => n <= ZERO)];
    return {
      ok: false,
      error: `${bad.input} would need a coefficient of zero or less, so it doesn't belong on that side.`,
    };
  }
  const coefficients = ints.map(Number);

  const side = (list: Species[], offset: number, f: (s: Species, c: number) => string) =>
    list.map((s, i) => f(s, coefficients[offset + i])).join(" + ");
  const arrowText = parsed.reversible ? " ⇌ " : " → ";
  const arrowCe = parsed.reversible ? " <=> " : " -> ";
  const text_ =
    side(reactants, 0, speciesToText) + arrowText + side(products, reactants.length, speciesToText);
  const mhchem =
    side(reactants, 0, speciesToMhchem) + arrowCe + side(products, reactants.length, speciesToMhchem);

  const count = (list: Species[], offset: number, get: (s: Species) => number) =>
    list.reduce((acc, s, i) => acc + get(s) * coefficients[offset + i], 0);
  const rows: BalanceRow[] = symbols.map((symbol) => ({
    symbol,
    left: count(reactants, 0, (s) => s.counts.get(symbol) ?? 0),
    right: count(products, reactants.length, (s) => s.counts.get(symbol) ?? 0),
  }));
  if (hasCharge) {
    rows.push({
      symbol: "charge",
      left: count(reactants, 0, (s) => s.charge),
      right: count(products, reactants.length, (s) => s.charge),
    });
  }

  return {
    ok: true,
    reactants,
    products,
    coefficients,
    reversible: parsed.reversible,
    text: text_,
    mhchem,
    rows,
  };
}
