import { z } from "zod";
import { AiError } from "@/lib/ai/chat";
import { makeWorksheet } from "@/lib/ai/worksheet";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { MAX_PROBLEMS, MAX_SOURCE } from "@/lib/math/worksheet";

/**
 * POST a WorksheetRequest -> Worksheet JSON: practice problems on a topic,
 * more like the drawing's, or an answer key for the drawing's own.
 * Members only, and rate limited per user.
 */

const level = z.enum(["gentle", "standard", "challenge"]);
const count = z.number().int().min(1).max(20);
const problems = z.array(z.string().trim().min(1).max(MAX_SOURCE)).min(1, "There are no equations to use.").max(MAX_PROBLEMS);
const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("topic"), topic: z.string().trim().min(2, "Name a topic.").max(160), level, count }),
  z.object({ mode: z.literal("similar"), problems, level, count }),
  z.object({ mode: z.literal("key"), problems }),
]);

export async function POST(request: Request) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to make worksheets." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Worksheets");
  if (notMember) return notMember;
  const limit = await limiters.aiToolsByUser.consume(user.id);
  if (!limit.ok) {
    return Response.json(
      { error: `You've used the AI a lot just now. Try again in ${limit.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  try {
    return Response.json(await makeWorksheet(parsed.data));
  } catch (err) {
    if (err instanceof AiError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[worksheet]", err);
    return Response.json({ error: "The worksheet couldn't be made." }, { status: 500 });
  }
}
