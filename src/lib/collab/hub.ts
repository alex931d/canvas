import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";
import { Client } from "pg";
import { db } from "@/db";
import { drawingChanges } from "@/db/schema";
import { getRole, type Role } from "./access";
import { CHANNEL, type HubMessage } from "./notify";

/**
 * One per server process: holds a dedicated Postgres connection that
 * LISTENs for drawing events, and fans them out to the open event streams
 * (GET /api/drawings/[id]/events) of the people looking at each drawing.
 *
 * Changes are read from drawing_changes in version order and each stream
 * remembers the last version it sent, so a stream never skips or repeats a
 * change, even when notifications arrive late, twice, or after the LISTEN
 * connection drops and comes back.
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

class Hub {
  private listener: Client | null = null;
  private starting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Map<string, Set<Subscriber>>();
  private delivering = new Map<string, { again: boolean }>();

  /** Start following a drawing. Sends anything after `lastVersion` right away. */
  async subscribe(sub: Subscriber): Promise<() => void> {
    await this.start();
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

  private async start() {
    if (this.listener) return;
    this.starting ??= (async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      client.on("notification", (msg) => this.onMessage(msg.payload));
      client.on("error", (err) => {
        console.warn("[collab] LISTEN connection error:", err.message);
        this.drop(client);
      });
      client.on("end", () => this.drop(client));
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
    })().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  /** Lost the LISTEN connection: reconnect, then catch every stream up. */
  private drop(client: Client) {
    if (this.listener !== client) return;
    this.listener = null;
    client.end().catch(() => {});
    this.scheduleReconnect(1000);
  }

  private scheduleReconnect(delay: number) {
    if (this.reconnectTimer || this.subs.size === 0) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.start();
        for (const drawingId of this.subs.keys()) void this.deliver(drawingId);
      } catch {
        this.scheduleReconnect(Math.min(delay * 2, 15_000));
      }
    }, delay);
  }

  private onMessage(payload: string | undefined) {
    let msg: HubMessage;
    try {
      msg = JSON.parse(payload ?? "");
    } catch {
      return;
    }
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
        for (const s of subs) s.send("meta", { title: msg.title });
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

const g = globalThis as unknown as { canvasHub?: Hub };
/** Shared across hot reloads in development. */
export const hub = (g.canvasHub ??= new Hub());
