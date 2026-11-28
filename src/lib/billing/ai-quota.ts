import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { aiMonthlyLimit, allowance, allowanceUsedMessage, usageMonth, type AiAllowance } from "./ai-allowance";

/**
 * Counting members' AI calls against the monthly allowance (see
 * ./ai-allowance.ts). `takeAiCall` reserves one atomically before the AI is
 * asked, so two tabs can't both take the last one; `giveBackAiCall` returns
 * it when the provider fails.
 */

export async function getAiAllowance(userId: string, now = new Date()): Promise<AiAllowance> {
  const [row] = await db
    .select({ calls: aiUsage.calls })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, usageMonth(now))));
  return allowance(row?.calls ?? 0, aiMonthlyLimit(), now);
}

/** Reserves one call: the allowance after it, or null when it's used up. */
export async function takeAiCall(userId: string, now = new Date()): Promise<AiAllowance | null> {
  const limit = aiMonthlyLimit();
  if (limit <= 0) return null;
  const month = usageMonth(now);
  const [row] = await db
    .insert(aiUsage)
    .values({ userId, month, calls: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.month],
      set: { calls: sql`${aiUsage.calls} + 1` },
      setWhere: lt(aiUsage.calls, limit),
    })
    .returning({ calls: aiUsage.calls });
  return row ? allowance(row.calls, limit, now) : null;
}

export async function giveBackAiCall(userId: string, now = new Date()): Promise<void> {
  await db
    .update(aiUsage)
    .set({ calls: sql`greatest(${aiUsage.calls} - 1, 0)` })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, usageMonth(now))));
}

/**
 * For the AI routes: reserves a call, or the 429 to send when the month's
 * allowance is used. Run the AI with `run`; a thrown error gives the call
 * back. The answer carries X-AI-Calls-Left.
 */
export async function withAiAllowance(userId: string, run: () => Promise<Response>): Promise<Response> {
  const now = new Date();
  const taken = await takeAiCall(userId, now);
  if (!taken) {
    const used = await getAiAllowance(userId, now);
    return Response.json(
      { error: allowanceUsedMessage(used), code: "ai_allowance_used", allowance: used },
      { status: 429, headers: { "Retry-After": String(Math.ceil((Date.parse(used.resetsAt) - now.getTime()) / 1000)) } },
    );
  }
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    await giveBackAiCall(userId, now).catch(() => {});
    throw err;
  }
  if (!res.ok) {
    await giveBackAiCall(userId, now).catch(() => {});
    return res;
  }
  res.headers.set("X-AI-Calls-Left", String(taken.left));
  return res;
}
