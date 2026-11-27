import "server-only";

/**
 * One question to any OpenAI-compatible chat API. Defaults to Google's
 * Gemini API free tier; switch with env vars:
 *
 *   AI_BASE_URL  https://generativelanguage.googleapis.com/v1beta/openai   (Gemini)
 *                https://api.groq.com/openai/v1                            (Groq)
 *                http://localhost:11434/v1                                 (Ollama, local)
 *   AI_API_KEY   provider key (not needed for Ollama)
 *   AI_MODEL     e.g. gemini-3.8-flash, qwen/qwen3.8-27b, qwen3-vl:8b
 *   AI_FALLBACK_MODEL  optional: a second model on the same provider, asked
 *                when the first stays overloaded
 *
 * Providers are sometimes briefly overloaded (503, "high demand") or out of
 * spare capacity (429, 500, 502, 504). Each model gets a few quick retries
 * with a growing pause (honouring Retry-After), then the fallback model if
 * there is one, all within about 15 seconds, before the student is told
 * the tool is busy.
 *
 * Used by the math check (an image), the proof check and the worksheet
 * maker (text). Each names itself ("math checker") for the messages.
 */

export const DEFAULTS = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.8-flash",
};

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function aiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL || DEFAULTS.model;
  const fallbackModel = process.env.AI_FALLBACK_MODEL?.trim() || null;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(baseUrl + "/");
  return { baseUrl, apiKey, model, fallbackModel, isLocal };
}

export function isAiConfigured() {
  const c = aiConfig();
  return c.isLocal || c.apiKey.length > 0;
}

/** Overloaded or briefly unavailable: worth asking again. */
const BUSY = new Set([429, 500, 502, 503, 504]);
/** Pauses before each retry of one model; the total stays well under the request's patience. */
const RETRY_PAUSES_MS = [1000, 3000];
const MAX_PAUSE_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the first JSON object out of a reply, tolerating ```json fences. */
export function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

type UserContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

/**
 * Asks once (with the retries above) and returns the reply's text.
 * `name` is how the tool is called in messages: "math checker".
 * `tooLong` is what to say when the AI doesn't answer in time.
 */
export async function askAi({
  name,
  system,
  user,
  temperature = 0,
  tooLong = "The AI took too long to answer. Try again with less.",
}: {
  name: string;
  system: string;
  user: UserContent;
  temperature?: number;
  tooLong?: string;
}): Promise<string> {
  const { baseUrl, apiKey, model, fallbackModel, isLocal } = aiConfig();
  const tag = `[${name.replace(/\s+/g, "-")}]`;
  if (!apiKey && !isLocal) {
    throw new AiError(
      `The ${name} isn't set up yet. Add a free AI_API_KEY to .env.local (see the README) and restart the server.`,
      503,
    );
  }

  const body = {
    model: model as string,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
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

  /** One model, retried while the provider is busy. */
  const ask = async (which: string): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      let res = await send({ ...body, model: which });
      // Some providers/models don't support JSON mode; the prompt asks for JSON anyway.
      if (res.status === 400) {
        const { response_format: _ignored, ...withoutJsonMode } = body;
        void _ignored;
        res = await send({ ...withoutJsonMode, model: which });
      }
      if (!BUSY.has(res.status) || attempt >= RETRY_PAUSES_MS.length) return res;
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.warn(`${tag} ${which} busy (${res.status}), trying again: ${detail}`);
      const after = Number(res.headers.get("Retry-After"));
      await sleep(after > 0 ? Math.min(after * 1000, MAX_PAUSE_MS) : RETRY_PAUSES_MS[attempt]);
    }
  };

  let res: Response;
  try {
    res = await ask(model);
    if (BUSY.has(res.status) && fallbackModel && fallbackModel !== model) {
      console.warn(`${tag} ${model} still busy (${res.status}); asking ${fallbackModel}`);
      res = await ask(fallbackModel);
    }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AiError(timedOut ? tooLong : `Couldn't reach the AI at ${baseUrl}.`, 504);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.warn(`${tag} provider returned ${res.status}: ${detail}`);
    if (res.status === 401 || res.status === 403) {
      throw new AiError("The AI provider rejected the API key. Check AI_API_KEY in .env.local.", 502);
    }
    if (res.status === 429) {
      throw new AiError(`The ${name} has had a lot of requests. Wait a minute and try again.`, 429);
    }
    if (BUSY.has(res.status)) {
      throw new AiError(`The ${name} is busy right now (the AI service is overloaded). Try again in a minute.`, 503);
    }
    if (res.status === 404) {
      throw new AiError(`The AI provider doesn't know the model "${model}". Check AI_MODEL.`, 502);
    }
    throw new AiError(`The AI provider returned an error (${res.status}).`, 502);
  }

  const payload = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : (content ?? "");
}
