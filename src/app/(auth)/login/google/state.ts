import "server-only";

import { cookies } from "next/headers";
import { secureCookies } from "@/lib/auth/constants";

/**
 * What the start of a Google sign-in remembers for its return, in one
 * short-lived cookie that only the Google routes see: the state (checked
 * against what Google sends back, so nobody can hand you their sign-in),
 * the PKCE verifier, where to go after, and whether it's a login or
 * connecting Google from Settings.
 */

export type GoogleFlow = { state: string; verifier: string; next: string; intent: "login" | "connect" };

const COOKIE = "google_oauth";
const PATH = "/login/google";

export async function rememberFlow(flow: GoogleFlow) {
  (await cookies()).set(COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax", // sent on Google's redirect back, which is a top-level navigation
    path: PATH,
    maxAge: 10 * 60,
  });
}

/** The flow this return belongs to (and forget it: each one is used once). */
export async function takeFlow(): Promise<GoogleFlow | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.set(COOKIE, "", { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: PATH, maxAge: 0 });
  if (!raw) return null;
  try {
    const flow = JSON.parse(Buffer.from(raw, "base64url").toString()) as GoogleFlow;
    return typeof flow.state === "string" && typeof flow.verifier === "string" ? flow : null;
  } catch {
    return null;
  }
}
