import { connection } from "next/server";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { lookForWild } from "@/lib/buddy/wild";

/**
 * POST: is a wild panda around? The drawing page asks every minute or so;
 * this answers with the one that's around (wandering, or mid-battle), may
 * let a new one turn up (src/lib/buddy/wild.ts), or says there's none.
 */
export async function POST() {
  await connection();
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to meet wild pandas" }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Study buddies");
  if (notMember) return notMember;
  if (!limiters.wildByUser.consume(user.id)) {
    return Response.json({ error: "Looking too often. Try again in a moment." }, { status: 429 });
  }
  const wild = await lookForWild(user.id);
  return Response.json({ wild }, { headers: { "Cache-Control": "private, no-store" } });
}
