import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type Redis from "ioredis";
import { Client } from "pg";
import { db } from "@/db";
import { getRedis } from "@/lib/redis";
import { redactSecrets } from "@/lib/env-value";
import { redisUrl } from "@/lib/redis-url";
import type { HubMessage } from "./notify";

/**
 * How live events (changes announced, cursors, renames, sharing changes)
 * reach app servers other than the one that received them. The people on
 * the same server always get them straight from memory; the bus is only for
 * the others. Pick one with REALTIME_BUS:
 *
 *   local     one app server: nothing leaves the process. Cheapest, and the
 *             right choice for a single VPS or container.
 *   redis     several app servers: Redis pub/sub on REDIS_URL. One PUBLISH
 *             per event; nothing is stored.
 *   postgres  several app servers without Redis: LISTEN/NOTIFY on the
 *             database you already have. Costs a database round trip per
 *             event, cursors included.
 *
 * Default: redis when REDIS_URL is set, otherwise postgres, so any number of
 * servers works out of the box.
 *
 * Every event says which process sent it, so a server ignores its own
 * events when the bus brings them back. Bus messages can be lost while a
 * connection is down; after every (re)connect the hub re-reads what it may
 * have missed (changes are in the database, so nothing is lost for good).
 */

export type BusKind = "local" | "redis" | "postgres";

const CHANNEL = "drawing_events";

type Handlers = {
  /** A message from another server. */
  message: (msg: HubMessage) => void;
  /** (Re)connected: anything sent meanwhile may have been missed. */
  connected: () => void;
};

interface Transport {
  listen(onPayload: (payload: string) => void, onConnected: () => void): void;
  publish(payload: string): Promise<void>;
}

function chooseKind(): BusKind {
  const asked = process.env.REALTIME_BUS?.trim().toLowerCase();
  const hasRedis = redisUrl() !== null;
  if (asked === "local" || asked === "postgres") return asked;
  if (asked === "redis") {
    if (hasRedis) return "redis";
    console.warn("[bus] REALTIME_BUS=redis but Redis isn't set up (REDIS_URL, or Upstash's REST URL and token): using postgres.");
    return "postgres";
  }
  if (asked) console.warn(`[bus] Unknown REALTIME_BUS "${asked}" (local, redis or postgres): using the default.`);
  return hasRedis ? "redis" : "postgres";
}

let lastError = 0;
function logError(what: string, err: unknown) {
  if (Date.now() - lastError < 60_000) return;
  lastError = Date.now();
  console.error(`[bus] ${what}:`, redactSecrets(err instanceof Error ? err.message : String(err)));
}

// ----------------------------------------------------------------- redis

class RedisTransport implements Transport {
  private sub: Redis | null = null;

  constructor(private readonly redis: Redis) {}

  listen(onPayload: (payload: string) => void, onConnected: () => void) {
    // A connection in subscriber mode can't run other commands: it needs its own.
    const sub = this.redis.duplicate({
      lazyConnect: true,
      autoResubscribe: false,
      maxRetriesPerRequest: null,
      commandTimeout: 10_000,
    });
    this.sub = sub;
    sub.on("error", (err) => logError("Redis subscriber", err));
    sub.on("message", (_channel: string, payload: string) => onPayload(payload));
    // Subscribe ourselves on every connect, then catch up, so nothing slips
    // between the two.
    sub.on("ready", () => {
      sub.subscribe(CHANNEL).then(onConnected, (err) => {
        logError("subscribe", err);
        sub.disconnect(true); // reconnect, and try again
      });
    });
    sub.connect().catch((err) => logError("Redis subscriber", err)); // ioredis keeps retrying
  }

  async publish(payload: string) {
    await this.redis.publish(CHANNEL, payload);
  }
}

// -------------------------------------------------------------- postgres

class PostgresTransport implements Transport {
  private client: Client | null = null;
  private retry = 1000;

  listen(onPayload: (payload: string) => void, onConnected: () => void) {
    const connect = async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      const drop = (err?: Error) => {
        if (err) logError("LISTEN connection", err);
        if (this.client !== client) return;
        this.client = null;
        client.end().catch(() => {});
        setTimeout(() => void connect(), this.retry).unref?.();
      };
      client.on("notification", (msg) => msg.payload && onPayload(msg.payload));
      client.on("error", drop);
      client.on("end", () => drop());
      this.client = client;
      try {
        await client.connect();
        await client.query(`LISTEN ${CHANNEL}`);
        this.retry = 1000;
        onConnected();
      } catch (err) {
        this.retry = Math.min(this.retry * 2, 15_000);
        drop(err as Error);
      }
    };
    void connect();
  }

  async publish(payload: string) {
    // Postgres caps payloads at 8000 bytes; ours stay well under (changes are
    // only announced, and selections are capped at 50 ids).
    await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
  }
}

// ------------------------------------------------------------------- bus

class Bus {
  /** This process, so it can ignore its own messages coming back. */
  readonly origin = randomUUID().slice(0, 8);
  readonly kind: BusKind;
  private transport: Transport | null;
  private handlers: Handlers | null = null;

  constructor() {
    this.kind = chooseKind();
    const redis = this.kind === "redis" ? getRedis() : null;
    this.transport = redis ? new RedisTransport(redis) : this.kind === "postgres" ? new PostgresTransport() : null;
  }

  /** Start hearing other servers' messages (once; reconnects by itself). */
  listen(handlers: Handlers) {
    if (this.handlers) return;
    this.handlers = handlers;
    this.transport?.listen(
      (payload) => {
        let msg: HubMessage & { o?: string };
        try {
          msg = JSON.parse(payload);
        } catch {
          return;
        }
        if (msg.o === this.origin) return; // ours: already delivered here
        delete msg.o;
        handlers.message(msg);
      },
      () => handlers.connected(),
    );
  }

  /** Tell the other servers. Failures are logged, never thrown: the caller's work is done. */
  async publish(msg: HubMessage) {
    if (!this.transport) return;
    try {
      await this.transport.publish(JSON.stringify({ ...msg, o: this.origin }));
    } catch (err) {
      logError(`couldn't publish ${msg.t}`, err);
    }
  }
}

const g = globalThis as unknown as { canvasBus?: Bus };
/** One per server process, kept across dev hot reloads. */
export const bus = (g.canvasBus ??= new Bus());
