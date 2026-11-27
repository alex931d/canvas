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

// Proof checks and worksheets are told apart by their system prompt.
// A proof line whose reason is "Because I said so" doesn't follow; the rest do.
function proofVerdict(user) {
  const rows = user.split("\n").filter((l) => /^\d+\. /.test(l));
  const lines = rows.map((l) => {
    const reason = l.split("|").pop().trim();
    return reason === "Because I said so" ? { ok: false, note: "That isn't a reason: which theorem gives this?" } : { ok: true, note: "" };
  });
  const valid = lines.every((l) => l.ok);
  return { valid, summary: valid ? "Every line follows. Nice proof." : "Line " + (lines.findIndex((l) => !l.ok) + 1) + " needs a real reason.", lines };
}

function worksheet(system, user) {
  const count = Number(/exactly (\d+)/.exec(system)?.[1] ?? 0);
  if (/answer keys/.test(system)) {
    const prompts = user.split("\n").map((l) => l.replace(/^\d+\. /, ""));
    return { title: "Worksheet", instructions: "Solve each one. Show your work.", problems: prompts.map((p, i) => ({ prompt: p, answer: "\\text{answer " + (i + 1) + "}" })) };
  }
  const topic = /Topic: (.*)/.exec(user)?.[1] ?? "More practice";
  return {
    title: topic === "More practice" ? topic : "Practice: " + topic,
    instructions: "Solve for x.",
    problems: Array.from({ length: count }, (_, i) => ({ prompt: `x + ${i + 1} = ${2 * (i + 1)}`, answer: `x = ${i + 1}` })),
  };
}

// POST /__test/busy {"times": n, "model": "only-this-one"}: the next n answers
// (for that model, or any) are 503 "high demand", like an overloaded provider.
let busy = { times: 0, model: null };

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__test/busy") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      busy = { times: 0, model: null, ...JSON.parse(raw || "{}") };
      res.writeHead(204).end();
    });
    return;
  }
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
    let asked = null;
    try {
      asked = JSON.parse(body).model;
    } catch {
      /* ignore */
    }
    if (busy.times > 0 && (!busy.model || busy.model === asked)) {
      busy.times--;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }]));
      return;
    }
    let answer = verdict;
    try {
      const json = JSON.parse(body);
      const system = String(json.messages?.[0]?.content ?? "");
      const user = typeof json.messages?.[1]?.content === "string" ? json.messages[1].content : "";
      if (/two-column proofs/.test(system)) answer = proofVerdict(user);
      else if (/worksheets/.test(system)) answer = worksheet(system, user);
      writeFileSync("/tmp/mock-ai-text.json", JSON.stringify({ system: system.slice(0, 200), user }));
    } catch {
      /* the math check's verdict */
    }
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }));
    }, 600);
  });
}).listen(PORT, () => console.log(`mock AI on :${PORT}`));
