import { envValue } from "./env-value";

/**
 * Where Redis is, as a redis:// or rediss:// connection string:
 *
 *   REDIS_URL                      any Redis (rediss://… for TLS), used as is
 *   UPSTASH_REDIS_REST_URL and     Upstash, as its console shows them for the
 *   UPSTASH_REDIS_REST_TOKEN       @upstash/redis SDK: the token is also the
 *                                  database's password, so this becomes
 *                                  rediss://default:<token>@<host>:6379
 *
 * The app talks to Redis over its regular protocol (ioredis), not Upstash's
 * REST API, because the realtime bus needs pub/sub, which REST can't do.
 *
 * In that order: REDIS_URL, then Upstash's, then BUNDLED_REDIS_URL (the
 * Redis that deploy/compose.yml runs next to the app). Null when none is set.
 */
export function redisUrl(env: Record<string, string | undefined> = process.env): string | null {
  const token = envValue("UPSTASH_REDIS_REST_TOKEN", env);
  const direct = envValue("REDIS_URL", env);
  // Upstash's REST URL pasted as REDIS_URL: use it as the REST URL.
  const restInDirect = direct && /^https?:\/\//i.test(direct) ? direct : undefined;
  if (direct && !restInDirect) return direct;
  const rest = envValue("UPSTASH_REDIS_REST_URL", env) ?? restInDirect;
  const bundled = envValue("BUNDLED_REDIS_URL", env) ?? null;
  if (!rest || !token) return bundled;
  let host: string;
  try {
    host = new URL(rest.includes("://") ? rest : `https://${rest}`).hostname;
  } catch {
    return bundled;
  }
  if (!host) return bundled;
  const port = envValue("UPSTASH_REDIS_PORT", env)?.replace(/\D/g, "") || "6379";
  return `rediss://default:${encodeURIComponent(token)}@${host}:${port}`;
}
