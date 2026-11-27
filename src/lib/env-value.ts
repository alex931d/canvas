/**
 * A setting from the environment, forgiving how it was pasted into
 * .env.local: spaces around it, quotes around it, or a stray quote at one
 * end (UPSTASH_REDIS_REST_TOKEN="AX…  or  REDIS_URL=rediss://…:6379").
 * Quotes are never part of a URL, key or token, so they're dropped.
 * Empty is undefined.
 */
export function envValue(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  return value || undefined;
}

/** An error message with any password in a URL masked (redis://default:***@host). */
export function redactSecrets(message: string): string {
  return message.replace(/(\/\/[^:/@\s]*:)[^@\s]+@/g, "$1***@");
}
