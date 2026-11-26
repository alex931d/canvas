import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { drawings } from "@/db/schema";
import { normalizeDrawing, normalizePresentation } from "@/lib/canvas/schema";
import { authorizeDrawing } from "@/lib/collab/route-auth";

/**
 * The drawing as it is now, with its version. Editors load this when their
 * live stream says they've fallen too far behind to catch up change by change.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/drawings/[id]/doc">) {
  await connection();
  const { id } = await ctx.params;
  const auth = await authorizeDrawing(id, "view");
  if (auth instanceof Response) return auth;

  const [row] = await db
    .select({ title: drawings.title, data: drawings.data, version: drawings.version, presentation: drawings.presentation })
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "Drawing not found." }, { status: 404 });

  return Response.json(
    {
      version: row.version,
      title: row.title,
      presentation: normalizePresentation(row.presentation),
      role: auth.role,
      data: normalizeDrawing(row.data),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
