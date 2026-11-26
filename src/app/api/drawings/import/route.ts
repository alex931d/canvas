import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { drawings } from "@/db/schema";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { drawingDataSchema, presentationSchema, thumbnailSchema, titleSchema } from "@/lib/canvas/schema";

/**
 * Move a drawing from this browser into the member's account (the free plan
 * keeps drawings in the browser; src/lib/local-store/mover.ts sends them
 * here once someone becomes a member). Its images and videos follow through
 * /api/drawings/[id]/assets.
 *
 * The drawing keeps the id it had in the browser, which makes moving safe to
 * retry: a drawing that's already in your account is left as it is, and
 * the answer says so. An id that belongs to someone else's drawing is
 * refused (ids are random UUIDs, so that only happens on purpose).
 */

const MAX_BODY_BYTES = 24 * 1024 * 1024;

const bodySchema = z.object({
  id: z.uuid(),
  title: titleSchema,
  data: drawingDataSchema,
  presentation: presentationSchema.optional(),
  thumbnail: thumbnailSchema.nullish(),
});

export async function POST(request: Request) {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to move drawings to your account." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Drawings in your account");
  if (notMember) return notMember;

  const rate = await limiters.importsByUser.consume(user.id);
  if (!rate.ok) {
    return Response.json(
      { error: "That's a lot of drawings at once. Carrying on shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return Response.json({ error: "This drawing is too large to move." }, { status: 413 });
  let body: z.infer<typeof bodySchema>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "This drawing is too large to move." }, { status: 413 });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      const tooMany = parsed.error.issues.some((i) => i.path[0] === "data" && i.path[1] === "elements" && i.code === "too_big");
      return tooMany
        ? Response.json({ error: "This drawing has more than 20,000 items, more than an account can hold." }, { status: 413 })
        : Response.json({ error: "This drawing couldn't be read." }, { status: 422 });
    }
    body = parsed.data;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const [inserted] = await db
    .insert(drawings)
    .values({
      id: body.id,
      userId: user.id,
      title: body.title,
      data: body.data,
      ...(body.presentation ? { presentation: body.presentation } : {}),
      thumbnail: body.thumbnail ?? null,
    })
    .onConflictDoNothing({ target: drawings.id })
    .returning({ id: drawings.id });
  if (inserted) return Response.json({ id: inserted.id, existed: false }, { status: 201 });

  // Moved before (a retry after the files didn't all make it): fine if it's yours.
  const [existing] = await db.select({ userId: drawings.userId }).from(drawings).where(eq(drawings.id, body.id));
  if (existing?.userId !== user.id) return Response.json({ error: "That drawing can't be moved." }, { status: 409 });
  return Response.json({ id: body.id, existed: true });
}
