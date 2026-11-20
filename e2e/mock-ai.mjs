// A stand-in for an OpenAI-compatible vision API, for tests.
// Start: node e2e/mock-ai.mjs   then run the app with AI_BASE_URL=http://localhost:4010/v1
// It records the last request to /tmp/mock-ai-last.json and answers with a fixed verdict.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_AI_PORT ?? 4010);

const verdict = {
  transcription: "2x + 3 = 11 \\\\ 2x = 14 \\\\ x = 7",
  verdict: "incorrect",
  summary: "Line 2 adds 3 instead of subtracting it: 11 − 3 = 8, so 2x = 8 and x = 4.",
  steps: [
    { latex: "2x + 3 = 11", status: "correct", note: null },
    { latex: "2x = 14", status: "incorrect", note: "Subtract 3 from both sides: 2x = 8." },
    { latex: "x = 7", status: "incorrect", note: "Follows from the earlier slip." },
  ],
  correction: "x = 4",
};

createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const json = JSON.parse(body);
      const image = json.messages?.[1]?.content?.find?.((c) => c.type === "image_url")?.image_url?.url ?? "";
      writeFileSync(
        "/tmp/mock-ai-last.json",
        JSON.stringify({ model: json.model, auth: req.headers.authorization ?? null, imagePrefix: image.slice(0, 30), imageLength: image.length, responseFormat: json.response_format ?? null }),
      );
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "```json\n" + JSON.stringify(verdict) + "\n```" } }] }));
    }, 600);
  });
}).listen(PORT, () => console.log(`mock AI on :${PORT}`));
