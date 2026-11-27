import { z } from "zod";
import { MathCheckError } from "@/lib/ai/check-math";
import { checkProof } from "@/lib/ai/check-proof";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";

/**
 * POST { given, prove, rows: [{ statement, reason }] } -> ProofVerdict JSON.
 * Members only, and rate limited per user like the math check.
 */

const text = (max: number) => z.string().max(max, "That proof is too long to check.");
const bodySchema = z.object({
  given: text(1000),
  prove: text(300).trim().min(1, "Write what you're proving."),
  rows: z
    .array(z.object({ statement: text(300), reason: text(120) }))
    .min(1, "Add at least one statement.")
    .max(40, "That proof is too long to check: 40 lines at most."),
});

export async function POST(request: Request) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to check proofs." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Proof checks");
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
    return Response.json(await checkProof(parsed.data));
  } catch (err) {
    if (err instanceof MathCheckError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[check-proof]", err);
    return Response.json({ error: "Checking failed unexpectedly." }, { status: 500 });
  }
}
