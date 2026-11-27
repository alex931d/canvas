/**
 * Exact trig values and the unit circle.
 *
 * `exactTrig("sin", 150)` gives "\frac{1}{2}" with the working: the
 * reference angle, the quadrant and the sign rule (All Students Take
 * Calculus). Angles can be degrees or radians written the way students do
 * ("pi/6", "5π/4", "-3pi/2", "2.5"), and anything not on the special
 * angles gets a decimal instead.
 */

export type TrigFn = "sin" | "cos" | "tan" | "csc" | "sec" | "cot";
export const TRIG_FNS: TrigFn[] = ["sin", "cos", "tan", "csc", "sec", "cot"];

export type AngleUnit = "deg" | "rad";

/** sin and cos of the first-quadrant special angles, exactly. */
const BASE: Record<number, { sin: string; cos: string; sinV: number; cosV: number }> = {
  0: { sin: "0", cos: "1", sinV: 0, cosV: 1 },
  30: { sin: "\\frac{1}{2}", cos: "\\frac{\\sqrt{3}}{2}", sinV: 0.5, cosV: Math.sqrt(3) / 2 },
  45: { sin: "\\frac{\\sqrt{2}}{2}", cos: "\\frac{\\sqrt{2}}{2}", sinV: Math.SQRT1_2, cosV: Math.SQRT1_2 },
  60: { sin: "\\frac{\\sqrt{3}}{2}", cos: "\\frac{1}{2}", sinV: Math.sqrt(3) / 2, cosV: 0.5 },
  90: { sin: "1", cos: "0", sinV: 1, cosV: 0 },
};

/**
 * The other four ratios at a reference angle, written in simplest form
 * (rationalised denominators, as most classes want them).
 */
const DERIVED: Record<number, Record<"tan" | "csc" | "sec" | "cot", string | null>> = {
  0: { tan: "0", csc: null, sec: "1", cot: null },
  30: { tan: "\\frac{\\sqrt{3}}{3}", csc: "2", sec: "\\frac{2\\sqrt{3}}{3}", cot: "\\sqrt{3}" },
  45: { tan: "1", csc: "\\sqrt{2}", sec: "\\sqrt{2}", cot: "1" },
  60: { tan: "\\sqrt{3}", csc: "\\frac{2\\sqrt{3}}{3}", sec: "2", cot: "\\frac{\\sqrt{3}}{3}" },
  90: { tan: null, csc: "1", sec: null, cot: "0" },
};

/**
 * Reads an angle. Degrees take a plain number ("150", "-45.5"); radians take
 * a number or a multiple of pi ("pi", "π/6", "5pi/4", "-2π/3", "3π").
 * Returns the angle in degrees, or null when it can't be read.
 */
export function parseAngle(text: string, unit: AngleUnit): number | null {
  const s = text.trim().toLowerCase().replace(/π/g, "pi").replace(/\s+/g, "").replace(/°$/, "");
  if (!s) return null;
  if (/^[-+]?\d*\.?\d+$/.test(s)) {
    const n = Number(s);
    return unit === "deg" ? n : (n * 180) / Math.PI;
  }
  if (unit === "deg") return null;
  const m = /^([-+]?)(\d*\.?\d*)\*?pi(?:\/(\d*\.?\d+))?$/.exec(s);
  if (!m) return null;
  const k = (m[2] === "" ? 1 : Number(m[2])) * (m[1] === "-" ? -1 : 1);
  const over = m[3] ? Number(m[3]) : 1;
  if (!Number.isFinite(k) || !over) return null;
  return (k * 180) / over;
}

/** 0 ≤ result < 360 */
export const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;

/** An angle in degrees as a multiple of pi, e.g. 150 → "\frac{5\pi}{6}". */
export function radiansTex(degrees: number): string {
  // Over the denominators of the special angles; otherwise a decimal.
  for (const den of [1, 2, 3, 4, 6, 12, 180]) {
    const num = (degrees * den) / 180;
    if (Math.abs(num - Math.round(num)) < 1e-9) {
      const n = Math.round(num);
      if (n === 0) return "0";
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      const top = abs === 1 ? "\\pi" : `${abs}\\pi`;
      return den === 1 ? `${sign}${top}` : `${sign}\\frac{${top}}{${den}}`;
    }
  }
  return ((degrees * Math.PI) / 180).toFixed(4).replace(/\.?0+$/, "");
}

export function quadrant(degrees: number): 1 | 2 | 3 | 4 | null {
  const a = normalize(degrees);
  if (a % 90 === 0) return null; // on an axis
  return (Math.floor(a / 90) + 1) as 1 | 2 | 3 | 4;
}

export function referenceAngle(degrees: number): number {
  const a = normalize(degrees);
  if (a <= 90) return a;
  if (a <= 180) return 180 - a;
  if (a <= 270) return a - 180;
  return 360 - a;
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;

/** The point on the unit circle, exact when it's a special angle. */
export function unitPoint(degrees: number): { x: number; y: number; xTex: string | null; yTex: string | null } {
  const a = normalize(degrees);
  const ref = round(referenceAngle(a));
  const x = round(Math.cos((a * Math.PI) / 180));
  const y = round(Math.sin((a * Math.PI) / 180));
  const base = BASE[ref];
  if (!base) return { x, y, xTex: null, yTex: null };
  const signed = (tex: string, v: number) => (tex === "0" ? "0" : v < 0 ? `-${tex}` : tex);
  return { x, y, xTex: signed(base.cos, x), yTex: signed(base.sin, y) };
}

export type TrigAnswer = {
  /** The value in LaTeX: exact when it can be, otherwise a 4-place decimal. */
  tex: string;
  value: number | null;
  exact: boolean;
  undefined: boolean;
  /** The working, one LaTeX line each. */
  steps: string[];
};

const RECIPROCAL: Record<"csc" | "sec" | "cot", "sin" | "cos" | "tan"> = { csc: "sin", sec: "cos", cot: "tan" };

export function trigValue(fn: TrigFn, degrees: number): number | null {
  const r = (degrees * Math.PI) / 180;
  const s = round(Math.sin(r));
  const c = round(Math.cos(r));
  const v = {
    sin: s,
    cos: c,
    tan: c === 0 ? null : s / c,
    csc: s === 0 ? null : 1 / s,
    sec: c === 0 ? null : 1 / c,
    cot: s === 0 ? null : c / s,
  }[fn];
  return v === null ? null : round(v);
}

/** Which ratios are positive in each quadrant: All, Sin, Tan, Cos. */
const POSITIVE: Record<1 | 2 | 3 | 4, TrigFn[]> = {
  1: ["sin", "cos", "tan", "csc", "sec", "cot"],
  2: ["sin", "csc"],
  3: ["tan", "cot"],
  4: ["cos", "sec"],
};

export function exactTrig(fn: TrigFn, degrees: number, unit: AngleUnit = "deg"): TrigAnswer {
  const a = normalize(degrees);
  const shown = unit === "deg" ? `${round(degrees)}^\\circ` : radiansTex(degrees);
  const value = trigValue(fn, degrees);
  const steps: string[] = [];
  if (a !== round(degrees)) {
    steps.push(`${shown} \\text{ is coterminal with } ${unit === "deg" ? `${round(a)}^\\circ` : radiansTex(a)}`);
  }
  if (value === null) {
    const zero = fn === "tan" || fn === "sec" ? "\\cos" : "\\sin";
    steps.push(`${zero} ${shown} = 0 \\text{, so } \\${fn} ${shown} \\text{ is undefined}`);
    return { tex: "\\text{undefined}", value: null, exact: true, undefined: true, steps };
  }
  const ref = round(referenceAngle(a));
  const base = BASE[ref];
  if (!base) {
    const tex = value.toFixed(4).replace(/\.?0+$/, "");
    steps.push(`\\${fn} ${shown} \\approx ${tex}`);
    return { tex, value, exact: false, undefined: false, steps };
  }
  let positive = value > 0;
  const q = quadrant(a);
  if (q && ref !== 0 && ref !== 90) {
    const refShown = unit === "deg" ? `${ref}^\\circ` : radiansTex(ref);
    steps.push(`\\text{Reference angle: } ${refShown} \\text{ (quadrant ${["I", "II", "III", "IV"][q - 1]})}`);
    positive = POSITIVE[q].includes(fn);
    steps.push(`\\${fn} \\text{ is ${positive ? "positive" : "negative"} in quadrant ${["I", "II", "III", "IV"][q - 1]} (ASTC)}`);
  } else {
    const p = unitPoint(a);
    steps.push(`\\text{On the unit circle, } ${shown} \\text{ is at } (${p.xTex}, ${p.yTex})`);
  }
  let magnitude: string;
  if (fn === "sin" || fn === "cos") magnitude = base[fn];
  else {
    magnitude = DERIVED[ref][fn]!;
    if (fn in RECIPROCAL) {
      steps.push(`\\${fn}\\theta = \\frac{1}{\\${RECIPROCAL[fn as "csc"]}\\theta}`);
    } else {
      steps.push(`\\tan\\theta = \\frac{\\sin\\theta}{\\cos\\theta}`);
    }
  }
  const tex = magnitude === "0" ? "0" : value < 0 ? `-${magnitude}` : magnitude;
  steps.push(`\\${fn} ${shown} = ${tex}`);
  return { tex, value, exact: true, undefined: false, steps };
}

/** The sixteen special angles around the unit circle, for drawing it. */
export const UNIT_CIRCLE_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];

/** The identities students lean on, for the reference list in the panel. */
export const TRIG_IDENTITIES: { name: string; tex: string }[] = [
  { name: "Pythagorean", tex: "\\sin^2\\theta + \\cos^2\\theta = 1" },
  { name: "Pythagorean (tan)", tex: "1 + \\tan^2\\theta = \\sec^2\\theta" },
  { name: "Pythagorean (cot)", tex: "1 + \\cot^2\\theta = \\csc^2\\theta" },
  { name: "Quotient", tex: "\\tan\\theta = \\frac{\\sin\\theta}{\\cos\\theta}" },
  { name: "Double angle (sin)", tex: "\\sin 2\\theta = 2\\sin\\theta\\cos\\theta" },
  { name: "Double angle (cos)", tex: "\\cos 2\\theta = \\cos^2\\theta - \\sin^2\\theta" },
  { name: "Sum (sin)", tex: "\\sin(\\alpha \\pm \\beta) = \\sin\\alpha\\cos\\beta \\pm \\cos\\alpha\\sin\\beta" },
  { name: "Sum (cos)", tex: "\\cos(\\alpha \\pm \\beta) = \\cos\\alpha\\cos\\beta \\mp \\sin\\alpha\\sin\\beta" },
  { name: "Law of sines", tex: "\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}" },
  { name: "Law of cosines", tex: "c^2 = a^2 + b^2 - 2ab\\cos C" },
];
