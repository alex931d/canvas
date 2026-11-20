import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { flashcards } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";

/** A card's picture, for its owner only. Pictures never change, so it caches privately. */
export async function GET(_request: Request, ctx: RouteContext<"/api/flashcards/[id]/image">) {
  await connection();
  const { user } = await getCurrentSession();
  if (!user) return new Response("Sign in to view this", { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Flashcards");
  if (notMember) return notMember;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ image: flashcards.image, mime: flashcards.imageMimeType })
    .from(flashcards)
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)))
    .limit(1);
  if (!row?.image || !row.mime) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(row.image), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.image.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
