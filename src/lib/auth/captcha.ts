import "server-only";

import { isIP } from "node:net";
import { clientIp } from "./account";
import { CAPTCHA_FIELD, type CaptchaAction, type CaptchaSite } from "./captcha-shared";

/*
 * CAPTCHA with Cloudflare Turnstile (free; most people never see a puzzle).
 * The sign-up, login and "forgot password" forms show the widget, which puts
 * a one-time token in the form; the Server Action asks Cloudflare whether the
 * token is real before doing anything else (siteverify). Tokens work once and
 * expire after 5 minutes, so the form gets a fresh one after every attempt.
 *
 * Switched on by TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY. Without them
 * the forms work with no CAPTCHA (and production logs a warning).
 * TURNSTILE_SCRIPT_URL and TURNSTILE_VERIFY_URL exist only for the tests'
 * stand-in (e2e/mock-turnstile.mjs).
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let warned = false;

function keys() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (siteKey && secretKey) return { siteKey, secretKey };
  if (!warned) {
    warned = true;
    if (siteKey || secretKey) {
      console.error("[captcha] Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY. Until then the forms have no CAPTCHA.");
    } else if (process.env.NODE_ENV === "production") {
      console.warn("[captcha] TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY aren't set, so sign-up and login have no CAPTCHA.");
    }
  }
  return null;
}

/** For pages: what the form needs to show the widget. Read per request (env can change without a rebuild). */
export function captchaSite(): CaptchaSite {
  const k = keys();
  return k ? { siteKey: k.siteKey, scriptUrl: process.env.TURNSTILE_SCRIPT_URL?.trim() || SCRIPT_URL } : null;
}

export type CaptchaResult = { ok: true } | { ok: false; error: string };

type SiteverifyResponse = { success?: boolean; action?: string; "error-codes"?: string[] };

/** For Server Actions: checks the form's token with Cloudflare. Fails closed. */
export async function verifyCaptcha(formData: FormData, action: CaptchaAction): Promise<CaptchaResult> {
  const k = keys();
  if (!k) return { ok: true };

  const token = formData.get(CAPTCHA_FIELD);
  if (typeof token !== "string" || !token || token.length > 2048) {
    return { ok: false, error: "Wait for the check that you're human to finish, then try again." };
  }

  const body = new URLSearchParams({ secret: k.secretKey, response: token });
  const ip = await clientIp();
  if (isIP(ip)) body.set("remoteip", ip);

  let result: SiteverifyResponse;
  try {
    const res = await fetch(process.env.TURNSTILE_VERIFY_URL?.trim() || VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    result = (await res.json()) as SiteverifyResponse;
  } catch (err) {
    console.error("[captcha] couldn't reach Cloudflare Turnstile:", err);
    return { ok: false, error: "We couldn't check that you're human just now. Try again in a moment." };
  }

  if (!result.success) {
    const codes = result["error-codes"] ?? [];
    if (codes.some((c) => c.includes("secret"))) {
      console.error(`[captcha] Cloudflare didn't accept TURNSTILE_SECRET_KEY (${codes.join(", ")}).`);
    }
    return { ok: false, error: "The check that you're human didn't pass. Try again." };
  }
  // Only a token made on this form counts (Cloudflare's test keys report no action).
  if (result.action && result.action !== action) {
    return { ok: false, error: "The check that you're human didn't pass. Try again." };
  }
  return { ok: true };
}
