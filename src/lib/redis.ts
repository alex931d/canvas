import "server-only";
import Redis from "ioredis";

/**
 * The Redis connection, from REDIS_URL (redis://… or rediss://… for TLS, as
 * Upstash, Redis Cloud and most hosts give it). Used for rate limiting
 * (src/lib/auth/rate-limit.ts) and, by default, as the realtime bus between
 * app servers (src/lib/collab/bus.ts, which opens a second connection for
 * subscribing). Null without REDIS_URL.
 *
 * One connection per server process, kept across dev hot reloads. Commands
 * give up after a second, so a Redis outage slows nothing down for long.
 */

const g = globalThis as unknown as { canvasRedis?: Redis | null };

let lastError = 0;

export function getRedis(): Redis | null {
  if (g.canvasRedis !== undefined) return g.canvasRedis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return (g.canvasRedis = null);
  const redis = new Redis(url, {
    lazyConnect: true, // connect on the first command, not while the app is being built
    connectTimeout: 2000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  // Connection trouble is reported by the commands that fail; just note it now and then.
  redis.on("error", (err) => {
    if (Date.now() - lastError < 60_000) return;
    lastError = Date.now();
    console.error("[redis]", err.message);
  });
  return (g.canvasRedis = redis);
}
