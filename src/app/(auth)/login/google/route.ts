import { generateCodeVerifier, generateState } from "arctic";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { googleAuthorizationUrl } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/next-path";
import { getCurrentSession } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/site-url";
import { rememberFlow } from "./state";

/**
 * GET /login/google: off to Google's account chooser. ?next= is where to go
 * afterwards; ?intent=connect (from Settings) links Google to the signed-in
 * account instead of logging in.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const intent = params.get("intent") === "connect" ? "connect" : "login";
  const next = safeNext(params.get("next"));
  if (intent === "login" && (await getCurrentSession()).user) redirect(next);

  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = googleAuthorizationUrl(await siteOrigin(), state, verifier);
  if (!url) redirect(intent === "connect" ? "/settings?google=off#signing-in" : "/login?error=google-off");

  await rememberFlow({ state, verifier, next, intent });
  redirect(url.toString());
}
