/**
 * Solving a triangle from any three of its six parts (sides a, b, c and the
 * angles A, B, C opposite them, in degrees), with the working written out in
 * LaTeX the way a student would on paper.
 *
 *   SSS  three sides                       law of cosines for each angle
 *   SAS  two sides and the angle between   law of cosines, then sines
 *   ASA / AAS  two angles and a side       angles add to 180°, law of sines
 *   SSA  two sides and an angle not        law of sines: none, one or two
 *        between them                      triangles (the ambiguous case)
 *
 * A right triangle is SAS/ASA/... with one angle 90°; the steps then use
 * SOH CAH TOA and Pythagoras' names where they apply.
 */

export type Side = "a" | "b" | "c";
export type Angle = "A" | "B" | "C";
export type TriangleInput = Partial<Record<Side | Angle, number>>;
export type Triangle = Record<Side | Angle, number>;

export type TriangleCase = "SSS" | "SAS" | "ASA" | "AAS" | "SSA";

export type TriangleSolution = {
  triangle: Triangle;
  area: number;
  perimeter: number;
  /** The working, one LaTeX line each. */
  steps: string[];
};

export type TriangleResult =
  | { ok: true; case: TriangleCase; solutions: TriangleSolution[]; right: boolean }
  | { ok: false; error: string };

const SIDES: Side[] = ["a", "b", "c"];
const ANGLES: Angle[] = ["A", "B", "C"];
const opposite = (s: Side): Angle => s.toUpperCase() as Angle;
const sideOf = (a: Angle): Side => a.toLowerCase() as Side;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const EPS = 1e-9;

/** A number as students write it: up to 4 significant decimals, no trailing zeros. */
export function fmt(n: number, places = 2): string {
  if (!Number.isFinite(n)) return "?";
  const rounded = Math.round(n * 10 ** places) / 10 ** places;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(places).replace(/\.?0+$/, "");
}
const d = (n: number) => `${fmt(n)}^\\circ`;

function heron(t: Triangle) {
  const s = (t.a + t.b + t.c) / 2;
  return Math.sqrt(Math.max(0, s * (s - t.a) * (s - t.b) * (s - t.c)));
}

function finish(t: Triangle, steps: string[]): TriangleSolution {
  const area = heron(t);
  steps.push(`\\text{Area} = \\tfrac12 ab\\sin C = \\tfrac12(${fmt(t.a)})(${fmt(t.b)})\\sin ${d(t.C)} \\approx ${fmt(area)}`);
  return { triangle: t, area, perimeter: t.a + t.b + t.c, steps };
}

/** Law of cosines for the angle opposite `s`. */
function angleFromSides(t: Partial<Triangle>, s: Side, steps: string[]): number {
  const [p, q] = SIDES.filter((x) => x !== s);
  const cos = (t[p]! ** 2 + t[q]! ** 2 - t[s]! ** 2) / (2 * t[p]! * t[q]!);
  const value = deg(Math.acos(Math.min(1, Math.max(-1, cos))));
  const A = opposite(s);
  steps.push(
    `\\cos ${A} = \\frac{${p}^2 + ${q}^2 - ${s}^2}{2${p}${q}} = \\frac{${fmt(t[p]!)}^2 + ${fmt(t[q]!)}^2 - ${fmt(t[s]!)}^2}{2(${fmt(t[p]!)})(${fmt(t[q]!)})} \\Rightarrow ${A} \\approx ${d(value)}`,
  );
  return value;
}

export function solveTriangle(input: TriangleInput): TriangleResult {
  const given = Object.fromEntries(
    Object.entries(input).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as TriangleInput;
  const sides = SIDES.filter((s) => given[s] !== undefined);
  const angles = ANGLES.filter((a) => given[a] !== undefined);
  if (sides.length + angles.length !== 3) return { ok: false, error: "Give exactly three of the six: sides a, b, c and angles A, B, C." };
  if (sides.length === 0) return { ok: false, error: "Three angles fix the shape but not the size: give at least one side." };
  if (sides.some((s) => given[s]! <= 0)) return { ok: false, error: "Sides have to be longer than 0." };
  if (angles.some((a) => given[a]! <= 0 || given[a]! >= 180)) return { ok: false, error: "Angles have to be between 0° and 180°." };
  if (angles.reduce((sum, a) => sum + given[a]!, 0) >= 180 - EPS) {
    return { ok: false, error: "The angles add up to 180° or more, so there's no triangle." };
  }
  const right = angles.some((a) => Math.abs(given[a]! - 90) < EPS);

  // ------------------------------------------------------------ SSS
  if (sides.length === 3) {
    const [a, b, c] = [given.a!, given.b!, given.c!];
    const longest = Math.max(a, b, c);
    if (longest >= a + b + c - longest - EPS) {
      return { ok: false, error: "The longest side is as long as the other two together, so they can't close into a triangle." };
    }
    const steps: string[] = [`\\text{Three sides (SSS): } a = ${fmt(a)},\\ b = ${fmt(b)},\\ c = ${fmt(c)}`];
    const t: Partial<Triangle> = { a, b, c };
    t.A = angleFromSides(t, "a", steps);
    t.B = angleFromSides(t, "b", steps);
    t.C = 180 - t.A - t.B;
    steps.push(`C = 180^\\circ - A - B \\approx ${d(t.C)}`);
    const isRight = [t.A, t.B, t.C].some((x) => Math.abs(x - 90) < 1e-6);
    return { ok: true, case: "SSS", solutions: [finish(t as Triangle, steps)], right: isRight };
  }

  // ------------------------------------------------------------ two angles (ASA, AAS)
  if (angles.length === 2) {
    const missing = ANGLES.find((a) => given[a] === undefined)!;
    const t: Partial<Triangle> = { ...given };
    t[missing] = 180 - angles.reduce((s, a) => s + given[a]!, 0);
    const known = sides[0];
    const between = sideOf(missing) === known; // the side between the two given angles
    const steps = [
      `\\text{Two angles and a side (${between ? "ASA" : "AAS"})}`,
      `${missing} = 180^\\circ - ${angles.join(" - ")} = ${d(t[missing]!)}`,
    ];
    const ratio = t[known]! / Math.sin(rad(t[opposite(known)]!));
    steps.push(`\\frac{${known}}{\\sin ${opposite(known)}} = \\frac{${fmt(t[known]!)}}{\\sin ${d(t[opposite(known)]!)}} \\approx ${fmt(ratio, 4)}`);
    for (const s of SIDES.filter((x) => x !== known)) {
      t[s] = ratio * Math.sin(rad(t[opposite(s)]!));
      steps.push(`${s} = ${fmt(ratio, 4)} \\sin ${d(t[opposite(s)]!)} \\approx ${fmt(t[s]!)}`);
    }
    return { ok: true, case: between ? "ASA" : "AAS", solutions: [finish(t as Triangle, steps)], right };
  }

  // two sides and one angle
  const angle = angles[0];
  const angleSide = sideOf(angle);

  // ------------------------------------------------------------ SAS
  if (!sides.includes(angleSide)) {
    const [p, q] = sides;
    const t: Partial<Triangle> = { ...given };
    const isRight = Math.abs(t[angle]! - 90) < EPS;
    t[angleSide] = Math.sqrt(t[p]! ** 2 + t[q]! ** 2 - 2 * t[p]! * t[q]! * Math.cos(rad(t[angle]!)));
    const steps = [
      `\\text{Two sides and the angle between them (SAS)}`,
      isRight
        ? `${angleSide}^2 = ${p}^2 + ${q}^2 \\text{ (Pythagoras)} \\Rightarrow ${angleSide} = \\sqrt{${fmt(t[p]!)}^2 + ${fmt(t[q]!)}^2} \\approx ${fmt(t[angleSide]!)}`
        : `${angleSide}^2 = ${p}^2 + ${q}^2 - 2${p}${q}\\cos ${angle} \\Rightarrow ${angleSide} \\approx ${fmt(t[angleSide]!)}`,
    ];
    // The smaller remaining angle by the law of sines (never obtuse), the last from 180°.
    const smaller = t[p]! <= t[q]! ? p : q;
    const other = smaller === p ? q : p;
    t[opposite(smaller)] = deg(Math.asin(Math.min(1, (t[smaller]! * Math.sin(rad(t[angle]!))) / t[angleSide]!)));
    steps.push(
      isRight
        ? `\\sin ${opposite(smaller)} = \\frac{\\text{opposite}}{\\text{hypotenuse}} = \\frac{${fmt(t[smaller]!)}}{${fmt(t[angleSide]!)}} \\Rightarrow ${opposite(smaller)} \\approx ${d(t[opposite(smaller)]!)}`
        : `\\sin ${opposite(smaller)} = \\frac{${smaller}\\sin ${angle}}{${angleSide}} \\Rightarrow ${opposite(smaller)} \\approx ${d(t[opposite(smaller)]!)}`,
    );
    t[opposite(other)] = 180 - t[angle]! - t[opposite(smaller)]!;
    steps.push(`${opposite(other)} = 180^\\circ - ${angle} - ${opposite(smaller)} \\approx ${d(t[opposite(other)]!)}`);
    return { ok: true, case: "SAS", solutions: [finish(t as Triangle, steps)], right: isRight };
  }

  // ------------------------------------------------------------ SSA (the ambiguous case)
  const other = sides.find((s) => s !== angleSide)!;
  const A = given[angle]!;
  const sinB = (given[other]! * Math.sin(rad(A))) / given[angleSide]!;
  const head = `\\sin ${opposite(other)} = \\frac{${other}\\sin ${angle}}{${angleSide}} = \\frac{${fmt(given[other]!)}\\sin ${d(A)}}{${fmt(given[angleSide]!)}} \\approx ${fmt(sinB, 4)}`;
  if (sinB > 1 + EPS) {
    return { ok: false, error: `No triangle has these: sin ${opposite(other)} would be ${fmt(sinB, 3)}, more than 1.` };
  }
  const candidates = [deg(Math.asin(Math.min(1, sinB)))];
  if (sinB < 1 - 1e-9) candidates.push(180 - candidates[0]);
  const solutions: TriangleSolution[] = [];
  for (const [i, B] of candidates.entries()) {
    const third = ANGLES.find((x) => x !== angle && x !== opposite(other))!;
    const C = 180 - A - B;
    if (C <= EPS) continue;
    const t: Partial<Triangle> = { ...given, [opposite(other)]: B, [third]: C };
    t[sideOf(third)] = (given[angleSide]! * Math.sin(rad(C))) / Math.sin(rad(A));
    const steps = [
      `\\text{Two sides and an angle not between them (SSA)${candidates.length > 1 ? `: triangle ${i + 1}` : ""}}`,
      head,
      i === 0
        ? `${opposite(other)} = \\sin^{-1}(${fmt(sinB, 4)}) \\approx ${d(B)}`
        : `${opposite(other)} = 180^\\circ - ${d(candidates[0])} \\approx ${d(B)} \\text{ (the obtuse one)}`,
      `${third} = 180^\\circ - ${angle} - ${opposite(other)} \\approx ${d(C)}`,
      `${sideOf(third)} = \\frac{${angleSide}\\sin ${third}}{\\sin ${angle}} \\approx ${fmt(t[sideOf(third)]!)}`,
    ];
    solutions.push(finish(t as Triangle, steps));
  }
  if (!solutions.length) return { ok: false, error: "No triangle has these: the angles would add up to more than 180°." };
  return { ok: true, case: "SSA", solutions, right };
}

/**
 * Where the corners go to draw it: A at the origin, side c along the x axis
 * to B, and C above (y grows downwards, as on the canvas), scaled so the
 * longest side is `size` long.
 */
export function triangleCorners(t: Triangle, size = 240): { A: [number, number]; B: [number, number]; C: [number, number] } {
  const k = size / Math.max(t.a, t.b, t.c);
  return {
    A: [0, 0],
    B: [t.c * k, 0],
    C: [t.b * k * Math.cos(rad(t.A)), -t.b * k * Math.sin(rad(t.A))],
  };
}
