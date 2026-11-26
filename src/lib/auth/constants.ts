/**
 * Shared by the auth code and src/proxy.ts (which must stay free of
 * server-only imports), so constants only.
 */

export const SESSION_COOKIE = "session";

/** Sessions end after this long without activity (Lucia "inactivity timeout"). */
export const INACTIVITY_TIMEOUT_SECONDS = 60 * 60 * 24 * 30;

/** last_verified_at is written at most this often, to limit database writes. */
export const ACTIVITY_CHECK_INTERVAL_SECONDS = 60 * 60;

/**
 * The cookie outlives the session on purpose: the server decides validity,
 * and the proxy re-sets the cookie on page loads so active users stay in.
 * Browsers cap cookie lifetimes at 400 days.
 */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Secure cookies need HTTPS (browsers make an exception for localhost). */
export function secureCookies() {
  return process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";
}

/** Pages anyone can open without a session cookie… */
export const PUBLIC_PATHS = ["/login", "/signup", "/welcome", "/pricing", "/terms", "/forgot-password", "/local"];
/**
 * …and everything under these (password reset links, Google sign-in and its
 * return, and drawings kept in this browser: the free plan needs no account).
 */
export const PUBLIC_PREFIXES = ["/reset-password/", "/login/google", "/local/"];

export function isPublicPath(path: string) {
  return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}
