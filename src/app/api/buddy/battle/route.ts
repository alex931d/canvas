import { connection } from "next/server";
import { z } from "zod";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { beginBattle, GameError, playTurn } from "@/lib/buddy/wild";

/**
 * POST: a battle with a wild panda. `{ id, action: "start", first? }` starts
 * one; `{ id, turn, action }` plays a turn (the move, bamboo, a switch or
 * running away). The server plays it out and answers with the battle and the
 * steps to show.
 */

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), move: z.enum(["bump", "swipe", "stare", "special"]) }),
  z.object({ type: z.literal("bamboo") }),
  z.object({ type: z.literal("switch"), to: z.number().int().min(0).max(2) }),
  z.object({ type: z.literal("run") }),
]);

const bodySchema = z.union([
  z.object({ id: z.uuid(), action: z.literal("start"), first: z.number().int().min(0).max(2).optional() }),
  z.object({ id: z.uuid(), turn: z.number().int().min(0).max(10_000), action: actionSchema }),
]);

export async function POST(request: Request) {
  await connection();
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to battle" }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Study buddies");
  if (notMember) return notMember;
  if (!(await limiters.battleByUser.consume(user.id)).ok) {
    return Response.json({ error: "That's a lot of turns at once. Take a breath." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't something you can do in a battle." }, { status: 422 });
  const body = parsed.data;
  try {
    const reply =
      body.action === "start"
        ? await beginBattle(user.id, body.id, body.first)
        : await playTurn(user.id, body.id, body.turn, body.action);
    return Response.json(reply, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
