/**
 * Two-column proofs: what a student writes (Given, Prove, then numbered
 * statements each with a reason), the reasons they pick from, and the
 * checks that don't need the AI (every line has both halves, the last line
 * is what was to be proved, a "Given" reason matches something given).
 */

export type ProofRow = { statement: string; reason: string };
export type Proof = { given: string; prove: string; rows: ProofRow[] };

export type ProofIssue = { row: number | null; message: string };

export type ReasonGroup = { name: string; reasons: string[] };

export const PROOF_REASONS: ReasonGroup[] = [
  {
    name: "Starting points",
    reasons: ["Given", "Definition of midpoint", "Definition of angle bisector", "Definition of perpendicular", "Definition of congruence", "Definition of supplementary angles", "Definition of complementary angles", "Definition of right angle"],
  },
  {
    name: "Properties",
    reasons: ["Reflexive property", "Symmetric property", "Transitive property", "Substitution", "Addition property of equality", "Subtraction property of equality", "Multiplication property of equality", "Division property of equality", "Distributive property", "Segment addition postulate", "Angle addition postulate"],
  },
  {
    name: "Angles and lines",
    reasons: ["Vertical angles are congruent", "Linear pair postulate", "All right angles are congruent", "Corresponding angles postulate", "Alternate interior angles theorem", "Alternate exterior angles theorem", "Same-side interior angles theorem", "Converse of corresponding angles postulate", "Converse of alternate interior angles theorem", "Triangle sum theorem", "Exterior angle theorem"],
  },
  {
    name: "Triangles",
    reasons: ["SSS", "SAS", "ASA", "AAS", "HL", "CPCTC", "Isosceles triangle theorem", "Converse of isosceles triangle theorem", "AA similarity", "SAS similarity", "SSS similarity", "Pythagorean theorem"],
  },
  {
    name: "Algebra",
    reasons: ["Simplify", "Combine like terms", "Factor", "Square both sides", "Take the square root of both sides", "Definition of even number", "Definition of odd number", "Proof by contradiction", "Inductive hypothesis", "Base case"],
  },
];

export const ALL_REASONS = PROOF_REASONS.flatMap((g) => g.reasons);

/** Letters, digits and the symbols that matter; case and spacing don't. */
export function normalizeStatement(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\cong|≅/g, "≅")
    .replace(/\\angle|∠/g, "∠")
    .replace(/\\triangle|△|δ/g, "△")
    .replace(/\\overline\{([^}]*)\}/g, "$1")
    .replace(/[\s$\\{}]/g, "");
}

/** The checks that need no AI. An empty list means it's well formed. */
export function lintProof(proof: Proof): ProofIssue[] {
  const issues: ProofIssue[] = [];
  if (!proof.prove.trim()) issues.push({ row: null, message: "Write what you're proving." });
  const rows = proof.rows.filter((r) => r.statement.trim() || r.reason.trim());
  if (!rows.length) {
    issues.push({ row: null, message: "Add at least one statement." });
    return issues;
  }
  rows.forEach((r, i) => {
    if (!r.statement.trim()) issues.push({ row: i + 1, message: `Line ${i + 1} has a reason but no statement.` });
    if (!r.reason.trim()) issues.push({ row: i + 1, message: `Line ${i + 1} needs a reason.` });
  });
  const givens = proof.given
    .split(/[;,\n]|\band\b/)
    .map(normalizeStatement)
    .filter(Boolean);
  rows.forEach((r, i) => {
    if (r.reason.trim().toLowerCase() === "given" && givens.length && !givens.includes(normalizeStatement(r.statement))) {
      issues.push({ row: i + 1, message: `Line ${i + 1} says "Given", but that isn't one of the givens.` });
    }
  });
  const last = rows[rows.length - 1];
  if (proof.prove.trim() && last.statement.trim() && normalizeStatement(last.statement) !== normalizeStatement(proof.prove)) {
    issues.push({ row: rows.length, message: "The last statement should be what you set out to prove." });
  }
  return issues;
}

/** The proof as plain text, for the AI check and for copying. */
export function proofToText(proof: Proof): string {
  const rows = proof.rows.filter((r) => r.statement.trim() || r.reason.trim());
  return [
    `Given: ${proof.given.trim() || "(nothing)"}`,
    `Prove: ${proof.prove.trim()}`,
    "",
    ...rows.map((r, i) => `${i + 1}. ${r.statement.trim()} | ${r.reason.trim()}`),
  ].join("\n");
}

export type ProofVerdict = {
  valid: boolean;
  summary: string;
  /** One per statement line, in order. */
  lines: { ok: boolean; note: string }[];
};

/** Reads the AI's JSON answer, forgiving code fences and missing parts. */
export function parseProofVerdict(text: string, rows: number): ProofVerdict | null {
  const body = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { valid?: unknown; summary?: unknown; lines?: unknown };
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    valid: r.valid === true,
    summary: typeof r.summary === "string" ? r.summary.slice(0, 600) : "",
    lines: Array.from({ length: rows }, (_, i) => {
      const l = lines[i] as { ok?: unknown; note?: unknown } | undefined;
      return { ok: l?.ok !== false, note: typeof l?.note === "string" ? l.note.slice(0, 300) : "" };
    }),
  };
}
