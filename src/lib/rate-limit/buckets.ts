import { createHash } from "node:crypto";
import type Redis from "ioredis";

/**
 * Rate limiting, following the Lucia examples:
 *  - token buckets: N tokens per key, one more every `refillSeconds`;
 *  - throttlers: each attempt for a key must wait longer than the last
 *    (reset on success), for failed logins against one account.
 *
 * Two kinds of storage with the same (async) interface: Redis, shared by
 * every server and kept across restarts, and this process's memory, for
 * local development without Redis. src/lib/auth/rate-limit.ts picks one.
 *
 * In Redis each check is one Lua script, so it's atomic (requests arriving
 * together can't both take the last token) and uses Redis's clock (servers'
 * clocks don't have to agree). Keys are hashed, so no email addresses or IPs
 * are stored, and they expire once there's nothing left to remember. If
 * Redis can't be reached, requests are let through (and the error logged):
 * a Redis outage shouldn't lock everyone out of the app.
 */

/** A token bucket's answer: allowed, or how many seconds until it would be. */
export type Limit = { ok: boolean; retryAfter: number };

export interface TokenBucket {
  consume(key: string, cost?: number): Promise<Limit>;
}

export interface Throttler {
  /** May this key try now? Each "yes" makes the next wait longer. */
  consume(key: string): Promise<boolean>;
  /** Forget the key (after a successful login). */
  reset(key: string): Promise<void>;
}

// ------------------------------------------------------------ in memory

type Bucket = { count: number; refilledAt: number };

export class MemoryTokenBucket implements TokenBucket {
  private storage = new Map<string, Bucket>();

  constructor(
    readonly max: number,
    readonly refillSeconds: number,
  ) {}

  async consume(key: string, cost = 1): Promise<Limit> {
    const now = Date.now();
    const interval = this.refillSeconds * 1000;
    let bucket = this.storage.get(key);
    if (!bucket) {
      bucket = { count: this.max - cost, refilledAt: now };
      this.storage.set(key, bucket);
      return { ok: bucket.count >= 0, retryAfter: bucket.count >= 0 ? 0 : waitFor(bucket, cost, interval, now) };
    }
    const refill = Math.floor((now - bucket.refilledAt) / interval);
    bucket.count = Math.min(bucket.count + refill, this.max);
    bucket.refilledAt += refill * interval; // keep partial progress toward the next token
    if (bucket.count < cost) return { ok: false, retryAfter: waitFor(bucket, cost, interval, now) };
    bucket.count -= cost;
    return { ok: true, retryAfter: 0 };
  }
}

/** Whole seconds (at least 1) until `cost` tokens are back. */
function waitFor(bucket: Bucket, cost: number, interval: number, now: number) {
  const ms = bucket.refilledAt + (cost - Math.max(bucket.count, 0)) * interval - now;
  return Math.max(1, Math.ceil(ms / 1000));
}

type Counter = { index: number; updatedAt: number };

export class MemoryThrottler implements Throttler {
  private storage = new Map<string, Counter>();

  constructor(readonly timeoutSeconds: number[]) {}

  async consume(key: string): Promise<boolean> {
    const now = Date.now();
    const counter = this.storage.get(key);
    if (!counter) {
      this.storage.set(key, { index: 0, updatedAt: now });
      return true;
    }
    const allowed = now - counter.updatedAt >= this.timeoutSeconds[counter.index] * 1000;
    if (!allowed) return false;
    counter.updatedAt = now;
    counter.index = Math.min(counter.index + 1, this.timeoutSeconds.length - 1);
    return true;
  }

  async reset(key: string) {
    this.storage.delete(key);
  }
}

// ------------------------------------------------------------ in Redis

/** Where a limiter keeps a key: hashed, so the keys say nothing about who they're for. */
export function redisKey(prefix: string, name: string, key: string) {
  return `${prefix}:${name}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

// ARGV: max tokens, ms per token, cost. Returns {1, 0} when allowed, else {0, ms to wait}.
const BUCKET_LUA = `
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local max = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local stored = redis.call("HMGET", KEYS[1], "count", "refilledAt")
local count, refilled
if not stored[1] then
  count = max - cost
  refilled = now
  redis.call("HSET", KEYS[1], "count", count, "refilledAt", refilled)
  redis.call("PEXPIRE", KEYS[1], math.max(1000, math.ceil(max * interval)))
  if count >= 0 then return {1, 0} end
  return {0, refilled + (cost - math.max(count, 0)) * interval - now}
end
count = tonumber(stored[1])
refilled = tonumber(stored[2])
local refill = math.floor((now - refilled) / interval)
count = math.min(count + refill, max)
refilled = refilled + refill * interval
if count < cost then
  redis.call("HSET", KEYS[1], "count", count, "refilledAt", refilled)
  return {0, refilled + (cost - math.max(count, 0)) * interval - now}
end
count = count - cost
redis.call("HSET", KEYS[1], "count", count, "refilledAt", refilled)
-- Gone once it would be full again: then it's the same as a fresh bucket.
redis.call("PEXPIRE", KEYS[1], math.max(1000, math.ceil((max - count) * interval - (now - refilled))))
return {1, 0}
`;

// ARGV: the waits in seconds (JSON), ms to keep the key. Returns 1 when allowed, else 0.
const THROTTLE_LUA = `
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local timeouts = cjson.decode(ARGV[1])
local keep = tonumber(ARGV[2])
local stored = redis.call("HMGET", KEYS[1], "index", "updatedAt")
if not stored[1] then
  redis.call("HSET", KEYS[1], "index", 0, "updatedAt", now)
  redis.call("PEXPIRE", KEYS[1], keep)
  return 1
end
local index = tonumber(stored[1])
if now - tonumber(stored[2]) < timeouts[index + 1] * 1000 then return 0 end
index = math.min(index + 1, #timeouts - 1)
redis.call("HSET", KEYS[1], "index", index, "updatedAt", now)
redis.call("PEXPIRE", KEYS[1], keep)
return 1
`;

type LimiterRedis = Redis & {
  canvasBucket(key: string, max: number, interval: number, cost: number): Promise<[number, number]>;
  canvasThrottle(key: string, timeouts: string, keep: number): Promise<number>;
};

/** The client with the two scripts on it (sent once, then run by their hash). */
function withScripts(redis: Redis): LimiterRedis {
  const r = redis as LimiterRedis;
  if (typeof r.canvasBucket !== "function") {
    redis.defineCommand("canvasBucket", { numberOfKeys: 1, lua: BUCKET_LUA });
    redis.defineCommand("canvasThrottle", { numberOfKeys: 1, lua: THROTTLE_LUA });
  }
  return r;
}

let lastComplaint = 0;
/** Logs Redis trouble at most once a minute, so an outage doesn't flood the logs. */
export function complain(err: unknown) {
  if (Date.now() - lastComplaint < 60_000) return;
  lastComplaint = Date.now();
  console.error("[rate-limit] Redis isn't answering; letting requests through:", (err as Error)?.message ?? err);
}

export class RedisTokenBucket implements TokenBucket {
  private redis: LimiterRedis;

  constructor(
    redis: Redis,
    readonly name: string,
    readonly max: number,
    readonly refillSeconds: number,
    readonly prefix = "canvas:rl",
  ) {
    this.redis = withScripts(redis);
  }

  async consume(key: string, cost = 1): Promise<Limit> {
    try {
      const [ok, waitMs] = await this.redis.canvasBucket(
        redisKey(this.prefix, this.name, key),
        this.max,
        this.refillSeconds * 1000,
        cost,
      );
      return ok === 1 ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    } catch (err) {
      complain(err);
      return { ok: true, retryAfter: 0 };
    }
  }
}

/** How long a throttler remembers a key after its last attempt: a day. */
const THROTTLE_KEEP_MS = 24 * 60 * 60 * 1000;

export class RedisThrottler implements Throttler {
  private redis: LimiterRedis;

  constructor(
    redis: Redis,
    readonly name: string,
    readonly timeoutSeconds: number[],
    readonly prefix = "canvas:rl",
  ) {
    this.redis = withScripts(redis);
  }

  async consume(key: string): Promise<boolean> {
    try {
      const ok = await this.redis.canvasThrottle(
        redisKey(this.prefix, this.name, key),
        JSON.stringify(this.timeoutSeconds),
        THROTTLE_KEEP_MS,
      );
      return ok === 1;
    } catch (err) {
      complain(err);
      return true;
    }
  }

  async reset(key: string) {
    try {
      await this.redis.del(redisKey(this.prefix, this.name, key));
    } catch (err) {
      complain(err);
    }
  }
}
