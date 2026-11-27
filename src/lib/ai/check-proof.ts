import "server-only";

import { parseProofVerdict, proofToText, type Proof, type ProofVerdict } from "@/lib/math/proof";
import { askAi } from "./chat";

/**
 * Checks a two-column proof: whether each statement follows from what came
 * before (and the givens) by the reason written beside it, and whether the
 * last line is what was to be proved.
 */

const SYSTEM_PROMPT = `You check two-column proofs for a student (geometry or algebra). You get the givens, what to prove, and numbered lines of "statement | reason".

For each line decide whether the statement follows from the givens and earlier lines by the stated reason. A line is wrong if the reason doesn't justify it, it uses something not yet established, or the statement itself is false. Be strict about reasons (e.g. SSA is not a congruence theorem) but accept common wordings and notation.

Reply with JSON only, no prose around it, in this shape:
{
  "valid": true | false,
  "summary": "1-2 short sentences for the student, plain language: say it's complete, or name the first problem and what would fix it",
  "lines": [{ "ok": true | false, "note": "why, only when ok is false; a hint, not the whole answer" }]
}
"lines" has exactly one entry per numbered line, in order. "valid" is true only when every line is ok and the last statement is what was to be proved.`;

export async function checkProof(proof: Proof): Promise<ProofVerdict> {
  const rows = proof.rows.filter((r) => r.statement.trim() || r.reason.trim());
  const text = await askAi({
    name: "proof checker",
    system: SYSTEM_PROMPT,
    user: `Check this proof.\n\n${proofToText(proof)}`,
    tooLong: "The AI took too long to answer. Try again in a moment.",
  });
  return (
    parseProofVerdict(text, rows.length) ?? {
      valid: false,
      summary: text.trim().slice(0, 600) || "The AI didn't return a readable answer.",
      lines: rows.map(() => ({ ok: true, note: "" })),
    }
  );
}
