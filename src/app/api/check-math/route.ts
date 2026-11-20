import { z } from "zod";
import { checkMath, MathCheckError } from "@/lib/ai/check-math";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";

/**
 * POST { image: "data:image/png;base64,..." } -> MathCheck JSON.
 * The browser renders the selected region of the canvas to an image first.
 *
 * It spends your AI quota, so it needs a signed-in member and is rate limited
 * per user (10 checks, then one every 30 seconds).
 */

const bodySchema = z.object({
  image: z
    .string()
    .max(8_000_000, "Selection image too large")
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Expected an image data URL"),
});

export async function POST(request: Request) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to check math." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Math checks");
  if (notMember) return notMember;
  if (!limiters.mathByUser.consume(user.id)) {
    const wait = limiters.mathByUser.retryAfter(user.id);
    return Response.json(
      { error: `You've checked a lot of math just now. Try again in ${wait} seconds.` },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  try {
    const result = await checkMath(parsed.data.image);
    return Response.json(result);
  } catch (err) {
    if (err instanceof MathCheckError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[check-math]", err);
    return Response.json({ error: "Checking failed unexpectedly." }, { status: 500 });
  }
}
