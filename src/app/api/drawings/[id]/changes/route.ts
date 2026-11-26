import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { drawingChanges, drawingMembers, drawings, workspaceMembers } from "@/db/schema";
import { limiters } from "@/lib/auth/rate-limit";
import { drawingDataSchema, normalizeDrawing } from "@/lib/canvas/schema";
import { applyOps, batchSchema } from "@/lib/collab/ops";
import { notify } from "@/lib/collab/notify";
import { authorizeDrawing, clientIdSchema } from "@/lib/collab/route-auth";
import { drawingRoleFrom } from "@/lib/workspaces/roles";

/**
 * Apply batches of changes from one browser tab (see src/lib/collab/ops.ts).
 *
 * The drawing row is locked for the update, so changes from different
 * people are applied one at a time, each getting the next version number.
 * A batch id that was already applied returns its version again instead of
 * applying twice, so clients can safely retry after a timeout.
 */

const MAX_BODY_BYTES = 24 * 1024 * 1024;
/** Keep about this many recent changes per drawing for catching up. */
const KEEP_CHANGES = 2000;

const bodySchema = z.object({
  clientId: clientIdSchema,
  batches: z.array(batchSchema).min(1).max(200),
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/drawings/[id]/changes">) {
  const { id } = await ctx.params;
  const auth = await authorizeDrawing(id, "edit");
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const limit = await limiters.changesByUser.consume(user.id);
  if (!limit.ok) {
    return Response.json(
      { error: "Too many changes at once. Retrying shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return Response.json({ error: "That change is too large to send." }, { status: 413 });
  let body: z.infer<typeof bodySchema>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "That change is too large to send." }, { status: 413 });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.warn("[changes] rejected:", parsed.error.issues.slice(0, 3));
      return Response.json({ error: "Invalid changes." }, { status: 422 });
    }
    body = parsed.data;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [drawing] = await tx
        .select({ userId: drawings.userId, workspaceId: drawings.workspaceId, data: drawings.data, version: drawings.version })
        .from(drawings)
        .where(eq(drawings.id, id))
        .for("update");
      if (!drawing) throw new HttpError(404, "Drawing not found.");
      // Re-check under the lock: sharing may have changed since authorizeDrawing.
      if (drawing.userId !== user.id) {
        const [member] = await tx
          .select({ role: drawingMembers.role })
          .from(drawingMembers)
          .where(and(eq(drawingMembers.drawingId, id), eq(drawingMembers.userId, user.id)));
        // Or through the drawing's team workspace.
        const [inWorkspace] = drawing.workspaceId
          ? await tx
              .select({ role: workspaceMembers.role })
              .from(workspaceMembers)
              .where(and(eq(workspaceMembers.workspaceId, drawing.workspaceId), eq(workspaceMembers.userId, user.id)))
          : [];
        const fromWorkspace = drawingRoleFrom(inWorkspace?.role);
        if (!member && !fromWorkspace) throw new HttpError(404, "Drawing not found.");
        if (member?.role !== "editor" && fromWorkspace !== "editor") {
          throw new HttpError(403, "You can view this drawing but not change it.");
        }
      }

      const seen = new Map(
        (
          await tx
            .select({ batchId: drawingChanges.batchId, version: drawingChanges.version })
            .from(drawingChanges)
            .where(
              and(
                eq(drawingChanges.drawingId, id),
                inArray(
                  drawingChanges.batchId,
                  body.batches.map((b) => b.id),
                ),
              ),
            )
        ).map((r) => [r.batchId, r.version]),
      );

      const current = normalizeDrawing(drawing.data);
      let elements = current.elements;
      let version = drawing.version;
      const rows: (typeof drawingChanges.$inferInsert)[] = [];
      const versions: { id: string; version: number }[] = [];
      for (const batch of body.batches) {
        const done = seen.get(batch.id);
        if (done !== undefined) {
          versions.push({ id: batch.id, version: done });
          continue;
        }
        elements = applyOps(elements, batch.ops);
        version += 1;
        rows.push({ drawingId: id, version, batchId: batch.id, clientId: body.clientId, userId: user.id, ops: batch.ops });
        versions.push({ id: batch.id, version });
      }
      if (rows.length === 0) return { versions, version, added: 0 };

      const data = drawingDataSchema.safeParse({ version: 2, background: current.background, elements });
      if (!data.success) throw new HttpError(413, "This drawing is full (20,000 items). Remove some to add more.");

      await tx.update(drawings).set({ data: data.data, version }).where(eq(drawings.id, id));
      await tx.insert(drawingChanges).values(rows);
      if (Math.floor(version / 100) !== Math.floor((version - rows.length) / 100)) {
        await tx
          .delete(drawingChanges)
          .where(and(eq(drawingChanges.drawingId, id), lt(drawingChanges.version, sql`${version - KEEP_CHANGES}`)));
      }
      return { versions, version, added: rows.length };
    });
    // After the commit, so the streams told about it can read it.
    if (result.added) await notify({ t: "change", d: id });
    return Response.json({ versions: result.versions, version: result.version });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[changes] failed", err);
    return Response.json({ error: "Couldn't save the change." }, { status: 500 });
  }
}
