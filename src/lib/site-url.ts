import "server-only";

import { headers } from "next/headers";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function configured(): string | null {
  return process.env.APP_URL ? process.env.APP_URL.trim().replace(/\/+$/, "") : null;
}

/**
 * This site's address, for sending the person who made the request back here
 * (Stripe Checkout and the billing portal). Set APP_URL in production.
 */
export async function siteOrigin(): Promise<string> {
  const url = configured();
  if (url) return url;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (LOCAL_HOST.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The address links in emails point to, or null if it isn't known.
 *
 * Emails can go to someone other than the person making the request (anyone
 * can ask for a password reset link for any address), so in production this
 * never trusts the request's Host header: a forged one would put a working
 * reset link to someone else's site in the victim's inbox. It's APP_URL, or
 * the request's own address only when that's this machine (localhost).
 */
export async function emailLinkOrigin(): Promise<string | null> {
  const url = configured();
  if (url) return url;
  const host = (await headers()).get("host") ?? "";
  if (LOCAL_HOST.test(host) || (process.env.NODE_ENV !== "production" && host)) return `http://${host}`;
  return null;
}
