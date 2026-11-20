import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { assets, drawingMembers, drawings } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { parseRange } from "@/lib/http/range";

/**
 * Serve an uploaded image, GIF or video to the drawing's owner and the people
 * it's shared with. Asset ids never change content, so the browser may cache
 * it forever, but only privately (never a shared CDN).
 *
 * Range requests (what video players send) get one piece at a time, read
 * straight from Postgres with substring(), so a long video is never loaded
 * into memory whole.
 */

/** Rows of the asset this user may see: they own the drawing or were invited to it. */
const memberOf = (userId: string) => and(eq(drawingMembers.drawingId, drawings.id), eq(drawingMembers.userId, userId));
const visible = (id: string, userId: string) =>
  and(eq(assets.id, id), or(eq(drawings.userId, userId), isNotNull(drawingMembers.userId)));

const HEADERS = {
  "Accept-Ranges": "bytes",
  "Cache-Control": "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  await connection();
  const { user } = await getCurrentSession();
  if (!user) return new Response("Sign in to view files", { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Images");
  if (notMember) return notMember;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const [meta] = await db
      .select({ mimeType: assets.mimeType, byteSize: assets.byteSize })
      .from(assets)
      .innerJoin(drawings, eq(drawings.id, assets.drawingId))
      .leftJoin(drawingMembers, memberOf(user.id))
      .where(visible(id, user.id))
      .limit(1);
    if (!meta) return new Response("Not found", { status: 404 });
    const range = parseRange(rangeHeader, meta.byteSize);
    if (range === "invalid") {
      return new Response(null, { status: 416, headers: { ...HEADERS, "Content-Range": `bytes */${meta.byteSize}` } });
    }
    if (range) {
      const length = range.end - range.start + 1;
      const [row] = await db
        .select({ chunk: sql<Buffer>`substring(${assets.bytes} from ${range.start + 1}::int for ${length}::int)` })
        .from(assets)
        .innerJoin(drawings, eq(drawings.id, assets.drawingId))
        .leftJoin(drawingMembers, memberOf(user.id))
        .where(visible(id, user.id))
        .limit(1);
      if (!row) return new Response("Not found", { status: 404 });
      return new Response(new Uint8Array(row.chunk), {
        status: 206,
        headers: {
          ...HEADERS,
          "Content-Type": meta.mimeType,
          "Content-Length": String(row.chunk.byteLength),
          "Content-Range": `bytes ${range.start}-${range.start + row.chunk.byteLength - 1}/${meta.byteSize}`,
        },
      });
    }
  }

  const [row] = await db
    .select({ mimeType: assets.mimeType, bytes: assets.bytes })
    .from(assets)
    .innerJoin(drawings, eq(drawings.id, assets.drawingId))
    .leftJoin(drawingMembers, memberOf(user.id))
    .where(visible(id, user.id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.bytes), {
    headers: { ...HEADERS, "Content-Type": row.mimeType, "Content-Length": String(row.bytes.byteLength) },
  });
}
