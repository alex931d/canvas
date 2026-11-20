import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { drawings } from "@/db/schema";
import { thumbnailSchema } from "@/lib/canvas/schema";
import { authorizeDrawing } from "@/lib/collab/route-auth";

/** The gallery preview, sent by an editor's browser after a burst of changes. */
export async function POST(request: Request, ctx: RouteContext<"/api/drawings/[id]/thumbnail">) {
  const { id } = await ctx.params;
  const auth = await authorizeDrawing(id, "edit");
  if (auth instanceof Response) return auth;

  let thumbnail: string;
  try {
    const parsed = z.object({ thumbnail: thumbnailSchema }).safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid thumbnail." }, { status: 422 });
    thumbnail = parsed.data.thumbnail;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  // Keep updated_at: a new preview isn't a new edit.
  await db.update(drawings).set({ thumbnail, updatedAt: sql`${drawings.updatedAt}` }).where(eq(drawings.id, id));
  return new Response(null, { status: 204 });
}
