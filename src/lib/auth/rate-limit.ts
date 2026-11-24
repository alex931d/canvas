import "server-only";
import { getRedis } from "@/lib/redis";
import {
  MemoryThrottler,
  MemoryTokenBucket,
  RedisThrottler,
  RedisTokenBucket,
  type Throttler,
  type TokenBucket,
} from "@/lib/rate-limit/buckets";

/**
 * The app's rate limits (how they work: src/lib/rate-limit/buckets.ts).
 *
 * With REDIS_URL set they live in Redis, shared by every server instance and
 * kept across restarts and deploys: what production needs, since serverless
 * and multi-instance hosts run many processes. Without it (local development)
 * they live in this process's memory.
 *
 * Every check is async: `const limit = await limiters.loginByIp.consume(ip)`,
 * then `limit.ok` and `limit.retryAfter` (seconds).
 */

export type { Limit } from "@/lib/rate-limit/buckets";

const redis = getRedis();

if (!redis && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
  console.warn(
    "[rate-limit] REDIS_URL isn't set, so rate limits are kept in each server's memory. Set REDIS_URL in production.",
  );
}

const bucket = (name: string, max: number, refillSeconds: number): TokenBucket =>
  redis ? new RedisTokenBucket(redis, name, max, refillSeconds) : new MemoryTokenBucket(max, refillSeconds);

const throttler = (name: string, timeoutSeconds: number[]): Throttler =>
  redis ? new RedisThrottler(redis, name, timeoutSeconds) : new MemoryThrottler(timeoutSeconds);

// One set of limiters per server process (kept across dev hot reloads, so the
// in-memory ones keep their counts).
function makeLimiters() {
  return {
    /** 3 sign-ups, then one more every 10 s, per IP. */
    signupByIp: bucket("signupByIp", 3, 10),
    /** 20 login attempts, then one per second, per IP. */
    loginByIp: bucket("loginByIp", 20, 1),
    /** Growing waits between attempts on one account: 1 s, 2 s, 4 s … 5 min. */
    loginByAccount: throttler("loginByAccount", [1, 2, 4, 8, 16, 30, 60, 180, 300]),
    /** Email confirmation codes sent: 5, then one every 10 minutes, per account (plus 60 s between sends). */
    codeEmailsByUser: bucket("codeEmailsByUser", 5, 600),
    /** Codes entered: 10, then one every 6 s, per account (each code also allows only 5 wrong tries). */
    codeChecksByUser: bucket("codeChecksByUser", 10, 6),
    /** "Forgot password" requests: 10, then one every 30 s, per IP. */
    resetRequestsByIp: bucket("resetRequestsByIp", 10, 30),
    /** Reset emails: 3, then one every 20 minutes, per address, so nobody's inbox gets flooded. */
    resetEmailsByAddress: bucket("resetEmailsByAddress", 3, 1200),
    /** New passwords set from reset links: 10, then one every 10 s, per IP. */
    passwordResetsByIp: bucket("passwordResetsByIp", 10, 10),
    /** 10 AI checks, then one every 30 s, per user: protects your AI quota. */
    mathByUser: bucket("mathByUser", 10, 30),
    /** 10 trips to Stripe (checkout or billing portal), then one every 10 s, per user. */
    billingByUser: bucket("billingByUser", 10, 10),
    /** Drawing changes: bursts of 120 requests, then 5 a second, per user. */
    changesByUser: bucket("changesByUser", 120, 0.2),
    /** Cursor updates: bursts of 60, then 20 a second, per user. */
    presenceByUser: bucket("presenceByUser", 60, 0.05),
    /** Flashcards made: 60, then one every 2 s, per user. */
    flashcardsByUser: bucket("flashcardsByUser", 60, 2),
    /** Images, GIFs and videos uploaded: 100, then one every 6 s, per user. */
    uploadsByUser: bucket("uploadsByUser", 100, 6),
    /** Name and profile picture changes: 20, then one every 15 s, per user. */
    profileByUser: bucket("profileByUser", 20, 15),
    /** Settings page choices saved: 60, then one a second, per user. */
    preferencesByUser: bucket("preferencesByUser", 60, 1),
  };
}

const g = globalThis as unknown as { canvasLimiters?: ReturnType<typeof makeLimiters> };

// Spreading the existing set over a fresh one keeps its counts and adds any
// limiter introduced since it was created.
export const limiters = (g.canvasLimiters = { ...makeLimiters(), ...g.canvasLimiters });
