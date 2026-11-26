import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { drawingChanges, drawings } from "@/db/schema";
import { getRole, type Role } from "./access";
import { bus } from "./bus";
import type { HubMessage } from "./notify";

/**
 * One per server process: fans drawing events out to the open event streams
 * (GET /api/drawings/[id]/events) of the people looking at each drawing.
 * Events come from this server (notify) and from the others (the bus).
 *
 * Changes are read from drawing_changes in version order and each stream
 * remembers the last version it sent, so a stream never skips or repeats a
 * change, even when events arrive late, twice, or not at all: after the bus
 * reconnects, and every 30 s when there are other servers, every stream is
 * caught up from the database.
 */

export type Subscriber = {
  drawingId: string;
  userId: string;
  clientId: string;
  role: Role;
  /** Last change version this stream has sent. */
  lastVersion: number;
  send: (event: string, data: unknown, id?: string) => void;
  close: () => void;
};

const BATCH = 200;
const SWEEP_MS = 30_000;

class Hub {
  private subs = new Map<string, Set<Subscriber>>();
  private delivering = new Map<string, { again: boolean }>();
  private sweep: ReturnType<typeof setInterval> | null = null;

  /** Start following a drawing. Sends anything after `lastVersion` right away. */
  async subscribe(sub: Subscriber): Promise<() => void> {
    this.start();
    let set = this.subs.get(sub.drawingId);
    if (!set) this.subs.set(sub.drawingId, (set = new Set()));
    set.add(sub);
    void this.deliver(sub.drawingId);
    return () => {
      set.delete(sub);
      if (set.size === 0 && this.subs.get(sub.drawingId) === set) this.subs.delete(sub.drawingId);
    };
  }

  /** Number of open streams, for logs and tests. */
  get size() {
    let n = 0;
    for (const s of this.subs.values()) n += s.size;
    return n;
  }

  private start() {
    bus.listen({ message: (msg) => this.receive(msg), connected: () => void this.catchUp() });
    // A lost bus message only delays a change until the next one; this
    // bounds the delay when there is no next one.
    if (bus.kind !== "local" && !this.sweep) {
      this.sweep = setInterval(() => void this.catchUp(), SWEEP_MS);
      this.sweep.unref?.();
    }
  }

  /**
   * Send every stream anything it may have missed: one query for the
   * current versions of all open drawings, then reads only where something
   * is new. Streams of drawings that no longer exist are closed.
   */
  private async catchUp() {
    const ids = [...this.subs.keys()];
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const rows = await db
          .select({ id: drawings.id, version: drawings.version })
          .from(drawings)
          .where(inArray(drawings.id, chunk));
        const versions = new Map(rows.map((r) => [r.id, r.version]));
        for (const id of chunk) {
          const subs = this.subs.get(id);
          if (!subs) continue;
          const version = versions.get(id);
          if (version === undefined) this.receive({ t: "deleted", d: id });
          else if ([...subs].some((s) => s.lastVersion < version)) void this.deliver(id);
        }
      }
    } catch (err) {
      console.warn("[collab] couldn't catch up", err);
    }
  }

  /** An event for a drawing, from this server or another. */
  receive(msg: HubMessage) {
    const subs = this.subs.get(msg.d);
    if (!subs?.size) return;
    switch (msg.t) {
      case "change":
        void this.deliver(msg.d);
        break;
      case "presence": {
        const presence = { c: msg.c, u: msg.u, n: msg.n, a: msg.a ?? null, cur: msg.cur, sel: msg.sel, hello: msg.hello, bye: msg.bye };
        for (const s of subs) if (s.clientId !== msg.c) s.send("presence", presence);
        break;
      }
      case "meta":
        for (const s of subs) s.send("meta", { title: msg.title, presentation: msg.presentation });
        break;
      case "deleted":
        for (const s of [...subs]) {
          s.send("deleted", {});
          s.close();
        }
        break;
      case "access":
        for (const s of [...subs]) void this.recheck(s);
        break;
    }
  }

  private async recheck(s: Subscriber) {
    try {
      const role = await getRole(s.drawingId, s.userId);
      if (!role) {
        s.send("revoked", {});
        s.close();
      } else if (role !== s.role) {
        s.role = role;
        s.send("role", { role });
      }
    } catch (err) {
      console.warn("[collab] access check failed", err);
    }
  }

  /**
   * Send each stream of a drawing the changes it hasn't had yet. Calls that
   * arrive while one is running fold into one more pass.
   */
  private async deliver(drawingId: string) {
    const running = this.delivering.get(drawingId);
    if (running) {
      running.again = true;
      return;
    }
    const state = { again: false };
    this.delivering.set(drawingId, state);
    try {
      do {
        state.again = false;
        const subs = this.subs.get(drawingId);
        if (!subs?.size) break;
        const from = Math.min(...[...subs].map((s) => s.lastVersion));
        const rows = await db
          .select({
            version: drawingChanges.version,
            batchId: drawingChanges.batchId,
            clientId: drawingChanges.clientId,
            userId: drawingChanges.userId,
            ops: drawingChanges.ops,
          })
          .from(drawingChanges)
          .where(and(eq(drawingChanges.drawingId, drawingId), gt(drawingChanges.version, from)))
          .orderBy(asc(drawingChanges.version))
          .limit(BATCH);
        for (const s of subs) {
          for (const row of rows) {
            if (row.version <= s.lastVersion) continue;
            if (row.version !== s.lastVersion + 1) {
              // Older changes were pruned: the browser has to reload the drawing.
              s.send("reset", { v: row.version });
              s.close();
              break;
            }
            s.send("change", { v: row.version, b: row.batchId, c: row.clientId, u: row.userId, ops: row.ops }, String(row.version));
            s.lastVersion = row.version;
          }
        }
        if (rows.length === BATCH) state.again = true;
      } while (state.again);
    } catch (err) {
      console.warn("[collab] couldn't deliver changes", err);
    } finally {
      this.delivering.delete(drawingId);
    }
  }
}

const g = globalThis as unknown as { canvasLiveHub?: Hub };
/** Shared across hot reloads in development. */
export const hub = (g.canvasLiveHub ??= new Hub());
