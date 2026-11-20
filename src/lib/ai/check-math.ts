import "server-only";

import { mathCheckSchema, type MathCheck } from "./math-check-schema";

/**
 * Checks math in an image with any OpenAI-compatible chat API that accepts
 * images. Defaults to Google's Gemini API free tier; switch with env vars:
 *
 *   AI_BASE_URL  https://generativelanguage.googleapis.com/v1beta/openai   (Gemini)
 *                https://api.groq.com/openai/v1                            (Groq)
 *                http://localhost:11434/v1                                 (Ollama, local)
 *   AI_API_KEY   provider key (not needed for Ollama)
 *   AI_MODEL     e.g. gemini-3.8-flash, qwen/qwen3.8-27b, qwen3-vl:8b
 */

export const DEFAULTS = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.8-flash",
};

export { mathCheckSchema, type MathCheck };

export class MathCheckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

function config() {
  const baseUrl = (process.env.AI_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL || DEFAULTS.model;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(baseUrl + "/");
  return { baseUrl, apiKey, model, isLocal };
}

export function isAiConfigured() {
  const c = config();
  return c.isLocal || c.apiKey.length > 0;
}

/** Pull the first JSON object out of a reply, tolerating ```json fences. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function checkMath(imageDataUrl: string): Promise<MathCheck> {
  const { baseUrl, apiKey, model, isLocal } = config();
  if (!apiKey && !isLocal) {
    throw new MathCheckError(
      "The math checker isn't set up yet. Add a free AI_API_KEY to .env.local (see the README) and restart the server.",
      503,
    );
  }

  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Check the math in this image." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };

  const send = (payload: object) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });

  let res: Response;
  try {
    res = await send(body);
    // Some providers/models don't support JSON mode; the prompt asks for JSON anyway.
    if (res.status === 400) {
      const { response_format: _ignored, ...withoutJsonMode } = body;
      void _ignored;
      res = await send(withoutJsonMode);
    }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new MathCheckError(
      timedOut ? "The AI took too long to answer. Try a smaller selection." : `Couldn't reach the AI at ${baseUrl}.`,
      504,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.warn(`[check-math] provider returned ${res.status}: ${detail}`);
    if (res.status === 401 || res.status === 403) {
      throw new MathCheckError("The AI provider rejected the API key. Check AI_API_KEY in .env.local.", 502);
    }
    if (res.status === 429) {
      throw new MathCheckError("The free AI quota is used up for now. Wait a minute and try again.", 429);
    }
    if (res.status === 404) {
      throw new MathCheckError(`The AI provider doesn't know the model "${model}". Check AI_MODEL.`, 502);
    }
    throw new MathCheckError(`The AI provider returned an error (${res.status}).`, 502);
  }

  const payload = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : (content ?? "");

  try {
    return mathCheckSchema.parse(parseJson(text));
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
