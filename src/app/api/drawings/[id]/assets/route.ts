import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assets, drawings } from "@/db/schema";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import {
  ASSET_MIME_TYPES,
  MAX_ACCOUNT_ASSET_BYTES,
  MAX_ASSET_BYTES,
  MAX_VIDEO_BYTES,
  isVideoType,
} from "@/lib/canvas/schema";
import { canEdit, getRole } from "@/lib/collab/access";

/**
 * Upload one image, GIF or video for a drawing (multipart form: id, file,
 * width, height). The id comes from the browser, which already shows and
 * stores the file locally; re-uploading the same id is a no-op, so retries
 * are safe.
 *
 * 413 and 415 mean "never": the browser stops retrying and undoes the
 * change that added the file.
 */

const fieldsSchema = z.object({
  id: z.uuid(),
  width: z.coerce.number().int().min(1).max(20_000),
  height: z.coerce.number().int().min(1).max(20_000),
});

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export async function POST(request: Request, ctx: RouteContext<"/api/drawings/[id]/assets">) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to upload files" }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Uploads");
  if (notMember) return notMember;

  const { id: drawingId } = await ctx.params;
  if (!z.uuid().safeParse(drawingId).success) {
    return Response.json({ error: "Invalid drawing id" }, { status: 400 });
  }

  const rate = await limiters.uploadsByUser.consume(user.id);
  if (!rate.ok) {
    return Response.json(
      { error: "Too many uploads at once. Retrying shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES + 1024 * 1024) {
    return Response.json({ error: `Files can be up to ${mb(MAX_VIDEO_BYTES)}.` }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const fields = fieldsSchema.safeParse({
    id: form.get("id"),
    width: form.get("width"),
    height: form.get("height"),
  });
  const file = form.get("file");
  if (!fields.success || !(file instanceof Blob)) {
    return Response.json({ error: "Missing or invalid id, width, height or file" }, { status: 400 });
  }
  if (!(ASSET_MIME_TYPES as readonly string[]).includes(file.type)) {
    return Response.json(
      { error: `That kind of file (${file.type || "unknown"}) can't go on the board. Use an image, GIF, MP4 or WebM.` },
      { status: 415 },
    );
  }
  const video = isVideoType(file.type);
  const limit = video ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
  if (file.size > limit) {
    return Response.json(
      { error: `${video ? "Videos" : "Images"} can be up to ${mb(limit)}; that one is ${mb(file.size)}.` },
      { status: 413 },
    );
  }

  // Owners and editors can add files. A drawing you can't see looks the same as a missing one.
  const role = await getRole(drawingId, user.id);
  if (!role) return Response.json({ error: "Drawing not found" }, { status: 404 });
  if (!canEdit(role)) return Response.json({ error: "You can view this drawing but not change it." }, { status: 403 });

  // Already stored (a retry)? Nothing to do, and it doesn't count twice.
  const [existing] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, fields.data.id)).limit(1);
  if (existing) return Response.json({ ok: true, id: fields.data.id });

  // Space is counted against the drawing's owner, across all their drawings.
  const [usage] = await db
    .select({ bytes: sql<string>`coalesce(sum(${assets.byteSize}), 0)` })
    .from(assets)
    .innerJoin(drawings, eq(drawings.id, assets.drawingId))
    .where(eq(drawings.userId, sql`(select ${drawings.userId} from ${drawings} where ${drawings.id} = ${drawingId})`));
  if (Number(usage?.bytes ?? 0) + file.size > MAX_ACCOUNT_ASSET_BYTES) {
    const own = role === "owner";
    return Response.json(
      {
        error: own
          ? "You've used the 2 GB of space for images and videos. Delete drawings you no longer need to make room."
          : "This drawing's owner has used their 2 GB of space for images and videos.",
      },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await db
    .insert(assets)
    .values({
      id: fields.data.id,
      drawingId,
      mimeType: file.type,
      bytes,
      byteSize: bytes.byteLength,
      width: fields.data.width,
      height: fields.data.height,
    })
    .onConflictDoNothing({ target: assets.id });

  return Response.json({ ok: true, id: fields.data.id });
}
