/** Drops a reasoning model's <think>…</think> (Qwen on Groq, DeepSeek) so only the answer is read. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
}

/** Pull the first JSON object out of a reply, tolerating ```json fences and thinking. */
export function parseJsonReply(text: string): unknown {
  const answer = stripThinking(text);
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : answer).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}
