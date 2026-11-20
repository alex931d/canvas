/** Shared by src/lib/auth/captcha.ts and the forms, so types and constants only. */

/** What a form needs to show the CAPTCHA, or null when it's switched off. */
export type CaptchaSite = { siteKey: string; scriptUrl: string } | null;

/** Which form a CAPTCHA was solved on; Cloudflare reports it back so a token can't move between forms. */
export type CaptchaAction = "signup" | "login" | "reset";

/** The form field the token travels in (Turnstile's own name for it). */
export const CAPTCHA_FIELD = "cf-turnstile-response";
