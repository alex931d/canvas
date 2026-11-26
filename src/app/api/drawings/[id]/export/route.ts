import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assets, drawings } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { normalizeDrawing, normalizePresentation } from "@/lib/canvas/schema";

/**
 * A drawing as it is on the server, for its owner to take into their browser
 * (src/lib/local-store/mover.ts): the elements, title, slide style, picture
 * and the list of its files (each fetched from /api/assets/[id]). Open to the
 * owner with or without a membership, since after one ends this is how they
 * keep their drawings before the server's copies are deleted.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/drawings/[id]/export">) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to take your drawings." }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Drawing not found." }, { status: 404 });

  const [row] = await db
    .select({
      id: drawings.id,
      title: drawings.title,
      data: drawings.data,
      presentation: drawings.presentation,
      thumbnail: drawings.thumbnail,
      updatedAt: drawings.updatedAt,
    })
    .from(drawings)
    .where(and(eq(drawings.id, id), eq(drawings.userId, user.id)));
  if (!row) return Response.json({ error: "Drawing not found." }, { status: 404 });

  const files = await db
    .select({ id: assets.id, mimeType: assets.mimeType, width: assets.width, height: assets.height })
    .from(assets)
    .where(eq(assets.drawingId, id));
  return Response.json(
    {
      ...row,
      data: normalizeDrawing(row.data),
      presentation: normalizePresentation(row.presentation),
      files,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
