import "server-only";

/**
 * In-memory rate limiting, following the Lucia examples:
 *  - RefillingTokenBucket: N tokens per key, one more every `refillSeconds`.
 *  - Throttler: each attempt for a key must wait longer than the last
 *    (reset on success), for failed logins against one account.
 *
 * State lives in this process. With several server instances or serverless,
 * move it to Redis (the Lucia token-bucket page has a Redis version).
 */

type Bucket = { count: number; refilledAt: number };

export class RefillingTokenBucket<Key> {
  private storage = new Map<Key, Bucket>();

  constructor(
    readonly max: number,
    readonly refillSeconds: number,
  ) {}

  consume(key: Key, cost = 1): boolean {
    const now = Date.now();
    const interval = this.refillSeconds * 1000;
    let bucket = this.storage.get(key);
    if (!bucket) {
      bucket = { count: this.max - cost, refilledAt: now };
      this.storage.set(key, bucket);
      return bucket.count >= 0;
    }
    const refill = Math.floor((now - bucket.refilledAt) / interval);
    bucket.count = Math.min(bucket.count + refill, this.max);
    bucket.refilledAt += refill * interval; // keep partial progress toward the next token
    if (bucket.count < cost) return false;
    bucket.count -= cost;
    return true;
  }

  /** Seconds until one token is available. */
  retryAfter(key: Key): number {
    const bucket = this.storage.get(key);
    if (!bucket || bucket.count > 0) return 0;
    return Math.max(1, Math.ceil((bucket.refilledAt + this.refillSeconds * 1000 - Date.now()) / 1000));
  }
}

type Counter = { index: number; updatedAt: number };

export class Throttler<Key> {
  private storage = new Map<Key, Counter>();

  constructor(readonly timeoutSeconds: number[]) {}

  consume(key: Key): boolean {
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

  reset(key: Key) {
    this.storage.delete(key);
  }
}

// One set of limiters per server process (kept across dev hot reloads).
function makeLimiters() {
  return {
    /** 3 sign-ups, then one more every 10 s, per IP. */
    signupByIp: new RefillingTokenBucket<string>(3, 10),
    /** 20 login attempts, then one per second, per IP. */
    loginByIp: new RefillingTokenBucket<string>(20, 1),
    /** Growing waits between attempts on one account: 1 s, 2 s, 4 s … 5 min. */
    loginByAccount: new Throttler<string>([1, 2, 4, 8, 16, 30, 60, 180, 300]),
    /** Email confirmation codes sent: 5, then one every 10 minutes, per account (plus 60 s between sends). */
    codeEmailsByUser: new RefillingTokenBucket<string>(5, 600),
    /** Codes entered: 10, then one every 6 s, per account (each code also allows only 5 wrong tries). */
    codeChecksByUser: new RefillingTokenBucket<string>(10, 6),
    /** "Forgot password" requests: 10, then one every 30 s, per IP. */
    resetRequestsByIp: new RefillingTokenBucket<string>(10, 30),
    /** Reset emails: 3, then one every 20 minutes, per address, so nobody's inbox gets flooded. */
    resetEmailsByAddress: new RefillingTokenBucket<string>(3, 1200),
    /** New passwords set from reset links: 10, then one every 10 s, per IP. */
    passwordResetsByIp: new RefillingTokenBucket<string>(10, 10),
    /** 10 AI checks, then one every 30 s, per user: protects your AI quota. */
    mathByUser: new RefillingTokenBucket<string>(10, 30),
    /** 10 trips to Stripe (checkout or billing portal), then one every 10 s, per user. */
    billingByUser: new RefillingTokenBucket<string>(10, 10),
    /** Drawing changes: bursts of 120 requests, then 5 a second, per user. */
    changesByUser: new RefillingTokenBucket<string>(120, 0.2),
    /** Cursor updates: bursts of 60, then 20 a second, per user. */
    presenceByUser: new RefillingTokenBucket<string>(60, 0.05),
    /** Flashcards made: 60, then one every 2 s, per user. */
    flashcardsByUser: new RefillingTokenBucket<string>(60, 2),
    /** Images, GIFs and videos uploaded: 100, then one every 6 s, per user. */
    uploadsByUser: new RefillingTokenBucket<string>(100, 6),
    /** Study buddy settings saved: 60, then one a second, per user. */
    buddyByUser: new RefillingTokenBucket<string>(60, 1),
    /** Looking for wild pandas: 20, then one every 10 s, per user. */
    wildByUser: new RefillingTokenBucket<string>(20, 10),
    /** Battle turns: 120, then two a second, per user. */
    battleByUser: new RefillingTokenBucket<string>(120, 0.5),
    /** Name and profile picture changes: 20, then one every 15 s, per user. */
    profileByUser: new RefillingTokenBucket<string>(20, 15),
    /** Settings page choices saved: 60, then one a second, per user. */
    preferencesByUser: new RefillingTokenBucket<string>(60, 1),
  };
}

const g = globalThis as unknown as { canvasLimiters?: ReturnType<typeof makeLimiters> };

// Spreading the existing set over a fresh one keeps its counts and adds any
// limiter introduced since it was created.
export const limiters = (g.canvasLimiters = { ...makeLimiters(), ...g.canvasLimiters });
