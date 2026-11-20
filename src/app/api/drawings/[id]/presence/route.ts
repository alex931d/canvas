import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { limiters } from "@/lib/auth/rate-limit";
import { getMembership } from "@/lib/billing/membership";
import { getRole } from "@/lib/collab/access";
import { notify } from "@/lib/collab/notify";
import { clientIdSchema } from "@/lib/collab/route-auth";

/**
 * Where someone's cursor is and what they have selected, passed straight on
 * to the others looking at the drawing. Nothing is stored. Access is cached
 * for a few seconds because cursors move many times a second.
 */

const coord = z.number().finite().min(-1e7).max(1e7);
const bodySchema = z.object({
  clientId: clientIdSchema,
  cursor: z.object({ x: coord, y: coord }).nullable(),
  selection: z.array(z.string().min(1).max(64)).max(50),
  hello: z.boolean().optional(),
});

const ACCESS_TTL_MS = 10_000;
const g = globalThis as unknown as { canvasPresenceAccess?: Map<string, { ok: boolean; at: number }> };
const accessCache = (g.canvasPresenceAccess ??= new Map());

async function mayView(drawingId: string, userId: string): Promise<boolean> {
  const key = `${drawingId}:${userId}`;
  const hit = accessCache.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok;
  const ok =
    z.uuid().safeParse(drawingId).success &&
    (await getMembership(userId)).isMember &&
    (await getRole(drawingId, userId)) !== null;
  if (accessCache.size > 5000) accessCache.clear();
  accessCache.set(key, { ok, at: Date.now() });
  return ok;
}

export async function POST(request: Request, ctx: RouteContext<"/api/drawings/[id]/presence">) {
  const { user } = await getCurrentSession();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  if (!(await mayView(id, user.id))) return new Response(null, { status: 404 });
  if (!limiters.presenceByUser.consume(user.id)) return new Response(null, { status: 429 });

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return new Response(null, { status: 422 });
    body = parsed.data;
  } catch {
    return new Response(null, { status: 400 });
  }

  await notify({
    t: "presence",
    d: id,
    c: body.clientId,
    u: user.id,
    n: user.name.slice(0, 60),
    a: user.avatarUrl,
    cur: body.cursor,
    sel: body.selection,
    ...(body.hello ? { hello: true } : {}),
  });
  return new Response(null, { status: 204 });
}
