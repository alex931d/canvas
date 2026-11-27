/**
 * Worksheets: numbered problems with room to work, and an answer key.
 *
 * Problems come from the drawing's equations (in reading order: top to
 * bottom, then left to right), from the AI (practice problems on a topic,
 * or more like the ones on the drawing), or both. Prompts and answers are
 * LaTeX, typeset like any equation on the canvas.
 */

import type { CanvasElement } from "@/lib/canvas/schema";

export type WorksheetProblem = {
  /** LaTeX; may use \text{} for words. */
  prompt: string;
  /** LaTeX, or null when there's no key for this one. */
  answer: string | null;
};

export type Worksheet = {
  title: string;
  instructions: string;
  problems: WorksheetProblem[];
};

export type WorksheetLevel = "gentle" | "standard" | "challenge";
export const WORKSHEET_LEVELS: { id: WorksheetLevel; label: string }[] = [
  { id: "gentle", label: "Warm-up" },
  { id: "standard", label: "Standard" },
  { id: "challenge", label: "Challenge" },
];

/** What the worksheet AI is asked for. */
export type WorksheetRequest =
  | { mode: "topic"; topic: string; level: WorksheetLevel; count: number }
  | { mode: "similar"; problems: string[]; level: WorksheetLevel; count: number }
  | { mode: "key"; problems: string[] };

export const MAX_PROBLEMS = 30;
export const MAX_SOURCE = 500;

/** Only numbers, π, degrees, roots and fractions of them: a label like 90°, 3π/4 or (√2/2, ½). */
function isLabel(tex: string): boolean {
  // A plus or minus after a number is arithmetic (3/4 + 1/6), not a sign.
  if (/[\d}]\s*[-+−]/.test(tex)) return false;
  return (
    tex
      .replace(/\\(frac|dfrac|tfrac|pi|circ|sqrt|left|right|cdot|times|,|;|!| )/g, "")
      .replace(/[\d.,{}()[\]^+\-−\s]/g, "") === ""
  );
}

/**
 * Whether a typed equation reads as a problem rather than a figure's label
 * or an answer: working blocks, labels (90°, (√2/2, √2/2)) and results
 * (x = 4, c = 5, θ = 3π/4) are left out.
 */
export function isProblem(tex: string): boolean {
  const t = tex.trim();
  if (!t || /^\\begin\{(array|aligned|gathered)\}/.test(t)) return false;
  if (isLabel(t)) return false;
  const result = /^\\?[A-Za-z]+\s*=\s*(.+)$/.exec(t);
  return !(result && isLabel(result[1]));
}

/** The drawing's typed equations in reading order (rows of about one line, then left to right), labels and answers left out. */
export function problemsFromElements(elements: readonly CanvasElement[], only?: ReadonlySet<string>): string[] {
  const maths = elements.filter(
    (e): e is Extract<CanvasElement, { type: "math" }> => e.type === "math" && e.syntax === "tex" && (!only || only.has(e.id)),
  );
  const rowHeight = (e: { size: number }) => e.size * 1.2;
  return maths
    .slice()
    .sort((p, q) => (Math.abs(p.y - q.y) < Math.min(rowHeight(p), rowHeight(q)) ? p.x - q.x : p.y - q.y))
    .map((e) => e.source.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_SOURCE && isProblem(s))
    .slice(0, MAX_PROBLEMS);
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads the AI's JSON, keeping what's usable. Null when there's nothing to use. */
export function parseWorksheetReply(raw: unknown, fallbackTitle: string): Worksheet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; instructions?: unknown; problems?: unknown };
  const problems = (Array.isArray(r.problems) ? r.problems : [])
    .map((p): WorksheetProblem | null => {
      if (typeof p === "string") return p.trim() ? { prompt: clean(p, MAX_SOURCE), answer: null } : null;
      if (!p || typeof p !== "object") return null;
      const prompt = clean((p as { prompt?: unknown }).prompt, MAX_SOURCE);
      const answer = clean((p as { answer?: unknown }).answer, MAX_SOURCE);
      return prompt ? { prompt, answer: answer || null } : null;
    })
    .filter((p): p is WorksheetProblem => p !== null)
    .slice(0, MAX_PROBLEMS);
  if (!problems.length) return null;
  return {
    title: clean(r.title, 80) || fallbackTitle,
    instructions: clean(r.instructions, 200) || "Show your work.",
    problems,
  };
}

/** Answers from the AI laid onto the drawing's own problems, by position. */
export function withAnswers(prompts: string[], answered: Worksheet | null): WorksheetProblem[] {
  return prompts.map((prompt, i) => ({ prompt, answer: answered?.problems[i]?.answer ?? null }));
}

/** Shuffles a copy (Fisher–Yates), with a seedable random for tests. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
