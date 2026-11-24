// The rate limiters (src/lib/rate-limit/buckets.ts) against a real Redis:
// the same answers as the in-memory ones, atomic under load, hashed keys that
// expire, the login throttler, and letting requests through when Redis is down.
//
// Starts its own throwaway redis-server (needs `redis-server` installed):
//   npx tsx e2e/test-rate-limit.mts
import { spawn } from "node:child_process";
import Redis from "ioredis";
import {
  MemoryThrottler,
  MemoryTokenBucket,
  RedisThrottler,
  RedisTokenBucket,
  redisKey,
} from "../src/lib/rate-limit/buckets";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const port = 6390 + Math.floor(Math.random() * 500);
const server = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
const redis = new Redis(`redis://127.0.0.1:${port}`, { maxRetriesPerRequest: 1, lazyConnect: true });
redis.on("error", () => {}); // while the server starts up
for (let i = 0; i < 50; i++) {
  try {
    await redis.connect();
    break;
  } catch {
    await sleep(100);
  }
}
const prefix = `test:${Date.now()}`;

try {
  // ------------------------------------------------------------ token buckets
  {
    const inRedis = new RedisTokenBucket(redis, "signups", 3, 1, prefix);
    const inMemory = new MemoryTokenBucket(3, 1);
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await inRedis.consume("203.0.113.7");
      const m = await inMemory.consume("203.0.113.7");
      a.push(`${r.ok}/${r.retryAfter}`);
      b.push(`${m.ok}/${m.retryAfter}`);
    }
    check("3 tokens: three yes, then no with a 1 s wait", a.join() === "true/0,true/0,true/0,false/1,false/1", a.join());
    check("…the same answers as in memory", a.join() === b.join(), `${a.join()} vs ${b.join()}`);
    await sleep(1100);
    const refilled = [await inRedis.consume("203.0.113.7"), await inRedis.consume("203.0.113.7")].map((r) => r.ok);
    check("a second later, one more (and only one)", refilled.join() === "true,false", refilled.join());
    check("other keys have their own tokens", (await inRedis.consume("198.51.100.1")).ok);
    check(
      "…and so do other limiters",
      (await new RedisTokenBucket(redis, "logins", 3, 1, prefix).consume("203.0.113.7")).ok,
    );
  }
  {
    const slow = new RedisTokenBucket(redis, "reset-emails", 1, 600, prefix);
    await slow.consume("ada@example.com");
    const second = await slow.consume("ada@example.com");
    check("a slow bucket says how long to wait", !second.ok && second.retryAfter > 590 && second.retryAfter <= 600, String(second.retryAfter));
    const keys = await redis.keys(`${prefix}:*`);
    check("keys are hashed: no email addresses or IPs in Redis", keys.length > 0 && !keys.some((k) => /@|\d+\.\d+\.\d+\.\d+/.test(k)), keys.join());
    check("…named after the limiter", keys.includes(redisKey(prefix, "reset-emails", "ada@example.com")));
    const ttl = await redis.pttl(redisKey(prefix, "reset-emails", "ada@example.com"));
    check("…and kept only until the bucket would be full again", ttl > 590_000 && ttl <= 600_000, String(ttl));
  }
  {
    const costly = new RedisTokenBucket(redis, "uploads", 10, 1, prefix);
    const r = [await costly.consume("u1", 6), await costly.consume("u1", 6), await costly.consume("u1", 4)];
    check("costs: 6 of 10, then 6 more is too many, 4 is fine", r.map((x) => x.ok).join() === "true,false,true", JSON.stringify(r));
  }
  {
    // 50 requests at once against 10 tokens: exactly 10 get through.
    const busy = new RedisTokenBucket(redis, "changes", 10, 60, prefix);
    const answers = await Promise.all(Array.from({ length: 50 }, () => busy.consume("u2")));
    check("atomic: 50 at once against 10 tokens lets exactly 10 through", answers.filter((a) => a.ok).length === 10, String(answers.filter((a) => a.ok).length));
  }
  {
    // A fast bucket (5 a second, like drawing changes) keeps partial progress between checks.
    const fast = new RedisTokenBucket(redis, "fast", 2, 0.2, prefix);
    await fast.consume("u3");
    await fast.consume("u3");
    const empty = await fast.consume("u3");
    await sleep(450);
    const after = [await fast.consume("u3"), await fast.consume("u3"), await fast.consume("u3")].map((x) => x.ok);
    check("a fast bucket refills two tokens in 0.45 s", !empty.ok && after.join() === "true,true,false", after.join());
  }

  // ------------------------------------------------------------ the login throttler
  {
    const inRedis = new RedisThrottler(redis, "login", [1, 2, 4], prefix);
    const inMemory = new MemoryThrottler([1, 2, 4]);
    const seq = async (t: RedisThrottler | MemoryThrottler) => {
      const out = [await t.consume("ada@example.com"), await t.consume("ada@example.com")];
      await sleep(1050);
      out.push(await t.consume("ada@example.com"), await t.consume("ada@example.com"));
      await sleep(1050);
      out.push(await t.consume("ada@example.com"));
      return out.join();
    };
    const [r, m] = await Promise.all([seq(inRedis), seq(inMemory)]);
    check("throttler: yes, then wait 1 s, then 2 s", r === "true,false,true,false,false", r);
    check("…the same as in memory", r === m, `${r} vs ${m}`);
    await inRedis.reset("ada@example.com");
    check("a successful login resets it", await inRedis.consume("ada@example.com"));
    const ttl = await redis.pttl(redisKey(prefix, "login", "ada@example.com"));
    check("…and it's forgotten a day after the last try", ttl > 86_000_000 && ttl <= 86_400_000, String(ttl));
  }

  // ------------------------------------------------------------ Redis down
  {
    const gone = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      connectTimeout: 300,
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    gone.on("error", () => {});
    const errors: string[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    const started = Date.now();
    const bucket = await new RedisTokenBucket(gone, "down", 1, 60, prefix).consume("u4");
    const again = await new RedisTokenBucket(gone, "down", 1, 60, prefix).consume("u4");
    const throttle = await new RedisThrottler(gone, "down", [60], prefix).consume("u4");
    console.error = log;
    check("Redis down: requests are let through", bucket.ok && again.ok && throttle, JSON.stringify({ bucket, again, throttle }));
    check("…quickly", Date.now() - started < 3000, `${Date.now() - started} ms`);
    check("…and it's logged once, not on every request", errors.length === 1 && /Redis isn't answering/.test(errors[0]), errors.join(" | "));
    gone.disconnect();
  }
} finally {
  await redis.quit().catch(() => {});
  server.kill();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
