import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, isPublicPath, secureCookies } from "@/lib/auth/constants";

/**
 * Runs before every request (see `config.matcher`):
 *
 * 1. CSRF protection (Lucia guide): non-GET requests must come from this
 *    site. Browsers send Sec-Fetch-Site, which must be "same-origin"; the
 *    Origin header must also match this host (a missing Origin is rejected
 *    in production). Server Actions also get Next.js's own check. The
 *    Stripe webhook is exempt: it's verified by Stripe's signature.
 * 2. Optimistic routing on the cookie alone: "/" without a session cookie
 *    shows the landing page (/welcome) instead of the drawings; other pages
 *    without one go to /login. Every page, action and route still validates
 *    the session against the database.
 * 3. Keeps the cookie alive: re-sets it on page loads so active users stay
 *    signed in (Lucia's Next.js notes). Expiry itself is decided server-side.
 */
const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";

export function proxy(request: NextRequest) {
  const { method, nextUrl } = request;

  // Stripe's servers send no Origin header; the route checks Stripe's signature instead.
  if (nextUrl.pathname === STRIPE_WEBHOOK_PATH) return NextResponse.next();

  if (method !== "GET" && method !== "HEAD") {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite !== null && fetchSite !== "same-origin") {
      return new NextResponse("Forbidden: cross-site request", { status: 403 });
    }
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin === null) {
      if (process.env.NODE_ENV === "production") {
        return new NextResponse("Forbidden: missing Origin header", { status: 403 });
      }
    } else {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!host || originHost !== host) {
        return new NextResponse("Forbidden: cross-site request", { status: 403 });
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const path = nextUrl.pathname;
  const isPublic = isPublicPath(path);
  const isApi = path.startsWith("/api/");

  if (!token && path === "/") {
    const welcome = nextUrl.clone();
    welcome.pathname = "/welcome";
    return NextResponse.rewrite(welcome);
  }

  if (!token && !isPublic && !isApi) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path + nextUrl.search);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  if (token && !isApi) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  // Everything except build assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
