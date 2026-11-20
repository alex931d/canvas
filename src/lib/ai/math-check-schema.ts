import { z } from "zod";

/** Result of checking math in an image. Shared by the API route and the editor. */
export const mathCheckSchema = z.object({
  /** What the model read, as LaTeX. */
  transcription: z.string().catch(""),
  verdict: z
    .enum(["correct", "incorrect", "partially_correct", "not_math", "unreadable"])
    .catch("unreadable"),
  /** One or two plain sentences. */
  summary: z.string().catch(""),
  steps: z
    .array(
      z.object({
        latex: z.string().catch(""),
        status: z.enum(["correct", "incorrect", "unclear"]).catch("unclear"),
        note: z.string().nullish(),
      }),
    )
    .catch([]),
  /** The right result or line, as LaTeX, when something is wrong. */
  correction: z.string().nullish(),
});

export type MathCheck = z.infer<typeof mathCheckSchema>;
