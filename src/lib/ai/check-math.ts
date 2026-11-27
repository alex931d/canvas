import "server-only";

import { AiError, askAi, DEFAULTS, isAiConfigured, parseJsonReply } from "./chat";
import { mathCheckSchema, type MathCheck } from "./math-check-schema";

/**
 * Checks math in an image with any OpenAI-compatible chat API that accepts
 * images (see ./chat.ts for the provider settings and retries).
 */

export { DEFAULTS, isAiConfigured, mathCheckSchema, type MathCheck };

/** Kept under its old name: the route and tests catch it. */
export { AiError as MathCheckError };

const SYSTEM_PROMPT = `You check math for a student. You get an image cropped from their notes: handwriting, typed text or a screenshot.

1. Transcribe the math you see as LaTeX, line by line, exactly as written (keep their mistakes).
2. Check every step. A step is wrong if it doesn't follow from the previous one or the arithmetic/algebra is off. A final answer is wrong if it doesn't solve the problem.
3. Reply with JSON only, no prose around it, in this shape:
{
  "transcription": "LaTeX of everything you read, lines separated by \\\\\\\\",
  "verdict": "correct" | "incorrect" | "partially_correct" | "not_math" | "unreadable",
  "summary": "1-2 short sentences for the student, plain language, name the first mistake if any",
  "steps": [{ "latex": "one line", "status": "correct" | "incorrect" | "unclear", "note": "why, only if incorrect or unclear" }],
  "correction": "LaTeX of the corrected line or answer, or null if everything is right"
}
Use "partially_correct" when the method is right but there is a slip, "not_math" if there is no math, "unreadable" if you can't read it. Don't invent steps that aren't in the image.`;

export async function checkMath(imageDataUrl: string): Promise<MathCheck> {
  const text = await askAi({
    name: "math checker",
    system: SYSTEM_PROMPT,
    user: [
      { type: "text", text: "Check the math in this image." },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
    tooLong: "The AI took too long to answer. Try a smaller selection.",
  });
  try {
    return mathCheckSchema.parse(parseJsonReply(text));
  } catch {
    // Still useful: show what the model said rather than nothing.
    return {
      transcription: "",
      verdict: "unreadable",
      summary: text.trim().slice(0, 600) || "The AI didn't return a readable answer.",
      steps: [],
      correction: null,
    };
  }
}
