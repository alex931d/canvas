/**
 * The membership's monthly AI allowance: math checks, proof checks and
 * worksheet calls together, per calendar month (UTC). Change it with
 * AI_MONTHLY_CALLS. A call the AI provider fails (busy, timed out, a bad
 * key) is given back, so only answers count.
 */

export const DEFAULT_AI_MONTHLY_CALLS = 250;

export function aiMonthlyLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AI_MONTHLY_CALLS?.trim());
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AI_MONTHLY_CALLS;
}

/** "2026-11-01": the month a call counts against. */
export function usageMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** When the allowance starts over: midnight UTC on the 1st of next month. */
export function allowanceResetsAt(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type AiAllowance = { used: number; limit: number; left: number; resetsAt: string };

export function allowance(used: number, limit: number, now = new Date()): AiAllowance {
  return { used, limit, left: Math.max(0, limit - used), resetsAt: allowanceResetsAt(now).toISOString() };
}

/** "December 1", for messages. */
export function resetDay(resetsAt: string): string {
  return new Date(resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function allowanceUsedMessage(a: AiAllowance): string {
  return `You've used all ${a.limit} AI checks and worksheets for this month. They start over on ${resetDay(a.resetsAt)}.`;
}
