import { and, eq, gt, min } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { drawingChanges, drawings } from "@/db/schema";
import { hub, type Subscriber } from "@/lib/collab/hub";
import { notify } from "@/lib/collab/notify";
import { authorizeDrawing, clientIdSchema } from "@/lib/collab/route-auth";

/**
 * Live updates for one drawing, as Server-Sent Events:
 *
 *   change    {v, b, c, u, ops}  a change, in version order (SSE id = version)
 *   presence  {c, u, n, cur, sel, hello?, bye?}  someone else's cursor
 *   meta      {title?, presentation?}  renamed, or a new presentation style
 *   role      {role}             your access changed (e.g. to view-only)
 *   revoked / deleted            access removed / drawing deleted; stream ends
 *   reset     {v}                too far behind: reload the drawing, reconnect
 *
 * `?since=<version>` (or the Last-Event-ID header on reconnect) says what the
 * browser already has. Needs a long-running Node server (`next start`);
 * serverless platforms cut long responses off.
 */

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request, ctx: RouteContext<"/api/drawings/[id]/events">) {
  await connection();
  const { id } = await ctx.params;
  const auth = await authorizeDrawing(id, "view");
  if (auth instanceof Response) return auth;
  const { user, role } = auth;

  const url = new URL(request.url);
  const clientId = clientIdSchema.safeParse(url.searchParams.get("client"));
  if (!clientId.success) return Response.json({ error: "Missing client id." }, { status: 400 });
  const lastEventId = Number(request.headers.get("last-event-id"));
  const since = Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : Number(url.searchParams.get("since"));
  if (!Number.isSafeInteger(since) || since < 0) return Response.json({ error: "Invalid version." }, { status: 400 });

  const [state] = await db
    .select({ version: drawings.version, oldest: min(drawingChanges.version) })
    .from(drawings)
    .leftJoin(drawingChanges, and(eq(drawingChanges.drawingId, drawings.id), gt(drawingChanges.version, since)))
    .where(eq(drawings.id, id))
    .groupBy(drawings.version);
  if (!state) return Response.json({ error: "Drawing not found." }, { status: 404 });
  // Behind by more than the stored history (or ahead of it): start over.
  const mustReset = since > state.version || (since < state.version && state.oldest !== since + 1);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const send = (event: string, data: unknown, eventId?: string) =>
        write(`${eventId ? `id: ${eventId}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        // Tell the others this cursor is gone.
        void notify({ t: "presence", d: id, c: clientId.data, u: user.id, n: user.name, cur: null, sel: [], bye: true }).catch(
          () => {},
        );
      };
      cleanup = close;
      request.signal.addEventListener("abort", close);

      write("retry: 2000\n\n");
      send("hello", { v: since, role });
      if (mustReset) {
        send("reset", { v: state.version });
        close();
        return;
      }

      const sub: Subscriber = {
        drawingId: id,
        userId: user.id,
        clientId: clientId.data,
        role,
        lastVersion: since,
        send,
        close,
      };
      try {
        unsubscribe = await hub.subscribe(sub);
      } catch (err) {
        console.error("[events] couldn't subscribe", err);
        close();
        return;
      }
      if (closed) unsubscribe();
      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression middleware from buffering events.
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
