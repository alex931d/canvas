import "server-only";

import type { Email } from "./send";

/*
 * The emails canvas sends. Each has a plain-text part (what the console
 * fallback prints) and a simple HTML part with inline styles, which is what
 * email clients need.
 */

type Message = Omit<Email, "to">;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Single quotes only: this goes inside double-quoted style attributes.
const FONT = `'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** One centred white card on the app's beige background. `body` is trusted HTML. */
function page(preview: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f8f4f0;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f0;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:32px;font-family:${FONT};color:#201f24;font-size:15px;line-height:1.6;">
<div style="font-size:24px;font-weight:800;letter-spacing:-0.04em;margin-bottom:24px;">canvas</div>
${body}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (html: string, muted = false) =>
  `<p style="margin:0 0 16px;${muted ? "color:#696868;font-size:13px;" : ""}">${html}</p>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0;"><a href="${esc(href)}" style="display:inline-block;font-family:${FONT};background:#201f24;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 24px;border-radius:8px;">${esc(label)}</a></p>`;

/** "12345678" → "1234 5678", easier to read and type. */
const grouped = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

export function verificationEmail({ name, code, link }: { name: string; code: string; link: string | null }): Message {
  const text = [
    `Hi ${name},`,
    "",
    "Here's your code to confirm your email for canvas:",
    "",
    `    ${grouped(code)}`,
    "",
    link ? `Enter it on the page that asked for it, or open this link to fill it in:\n${link}` : "Enter it on the page that asked for it.",
    "",
    "The code works for 15 minutes. If you didn't sign up for canvas, you can ignore this email.",
  ].join("\n");
  const html = page(
    `Your canvas code is ${grouped(code)}`,
    p(`Hi ${esc(name)},`) +
      p("Here's your code to confirm your email for canvas:") +
      `<p style="margin:0 0 16px;font-family:${FONT};font-size:32px;font-weight:800;letter-spacing:0.12em;font-variant-numeric:tabular-nums;background:#f8f4f0;border-radius:8px;padding:12px 20px;display:inline-block;">${grouped(code)}</p>` +
      (link
        ? p("Enter it on the page that asked for it, or fill it in from here:") + button(link, "Confirm my email")
        : p("Enter it on the page that asked for it.")) +
      p("The code works for 15 minutes. If you didn't sign up for canvas, you can ignore this email.", true),
  );
  return { subject: `${grouped(code)} is your canvas code`, text, html };
}

export function passwordResetEmail({ name, link }: { name: string; link: string }): Message {
  const text = [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password for the canvas account that uses this email. Open this link to choose a new password:",
    "",
    link,
    "",
    "The link works once, for 1 hour. If you didn't ask for this, ignore this email and your password stays the same.",
  ].join("\n");
  const html = page(
    "Choose a new password for canvas",
    p(`Hi ${esc(name)},`) +
      p("Someone asked to reset the password for the canvas account that uses this email. Choose a new password here:") +
      button(link, "Choose a new password") +
      p(`Or paste this link into your browser:<br><a href="${esc(link)}" style="color:#277c78;word-break:break-all;">${esc(link)}</a>`, true) +
      p("The link works once, for 1 hour. If you didn't ask for this, ignore this email and your password stays the same.", true),
  );
  return { subject: "Reset your canvas password", text, html };
}

export function passwordChangedEmail({ name, email, resetLink }: { name: string; email: string; resetLink: string | null }): Message {
  const ifNotYou = resetLink
    ? `If you didn't, reset your password now: ${resetLink}`
    : "If you didn't, reset your password now from the canvas login page.";
  const text = [
    `Hi ${name},`,
    "",
    `The password for your canvas account (${email}) was just changed, and every device that was signed in has been signed out.`,
    "",
    `If you changed it, there's nothing else to do. ${ifNotYou}`,
  ].join("\n");
  const html = page(
    "Your canvas password was changed",
    p(`Hi ${esc(name)},`) +
      p(`The password for your canvas account (${esc(email)}) was just changed, and every device that was signed in has been signed out.`) +
      p("If you changed it, there's nothing else to do.") +
      (resetLink
        ? p("If you didn't, reset your password now:") + button(resetLink, "Reset my password")
        : p("If you didn't, reset your password now from the canvas login page.")),
  );
  return { subject: "Your canvas password was changed", text, html };
}

/**
 * A security change to the account: what happened, then "if you didn't, reset
 * your password". Two-factor and Google sign-in changes use this.
 */
function securityNotice({
  subject,
  name,
  lines,
  resetLink,
}: {
  subject: string;
  name: string;
  /** Plain sentences (escaped for the HTML part). */
  lines: string[];
  resetLink: string | null;
}): Message {
  const ifNotYou = resetLink
    ? `If it wasn't you, reset your password now: ${resetLink}`
    : "If it wasn't you, reset your password now from the canvas login page.";
  const text = [`Hi ${name},`, "", ...lines.flatMap((l) => [l, ""]), ifNotYou].join("\n");
  const html = page(
    subject,
    p(`Hi ${esc(name)},`) +
      lines.map((l) => p(esc(l))).join("") +
      (resetLink
        ? p("If it wasn't you, reset your password now:") + button(resetLink, "Reset my password")
        : p("If it wasn't you, reset your password now from the canvas login page.")),
  );
  return { subject, text, html };
}

type Notice = { name: string; email: string; resetLink: string | null };

export function twoFactorOnEmail({ name, email, resetLink }: Notice): Message {
  return securityNotice({
    subject: "Two-factor sign-in is on for your canvas account",
    name,
    lines: [
      `Two-factor sign-in was just turned on for your canvas account (${email}). Logging in now also needs a code from your authenticator app, or one of your recovery codes.`,
      "Every other device that was signed in has been signed out.",
    ],
    resetLink,
  });
}

export function twoFactorOffEmail({ name, email, resetLink, byStaff }: Notice & { byStaff: boolean }): Message {
  return securityNotice({
    subject: "Two-factor sign-in is off for your canvas account",
    name,
    lines: [
      byStaff
        ? `Two-factor sign-in was turned off for your canvas account (${email}) by the canvas team, as you asked. Logging in now only needs your password. You can turn it on again in Settings.`
        : `Two-factor sign-in was just turned off for your canvas account (${email}). Logging in now only needs your password.`,
    ],
    resetLink,
  });
}

export function recoveryCodeUsedEmail({ name, email, resetLink, left }: Notice & { left: number }): Message {
  return securityNotice({
    subject: "A recovery code was used to log in to canvas",
    name,
    lines: [
      `Someone just logged in to your canvas account (${email}) with one of your two-factor recovery codes. Each code works once; you have ${left} left.`,
      left <= 3
        ? "You're running low: make new ones in Settings, under Signing in."
        : "You can make a new set any time in Settings, under Signing in.",
    ],
    resetLink,
  });
}

export function googleLinkedEmail({ name, email, resetLink, googleEmail }: Notice & { googleEmail: string }): Message {
  return securityNotice({
    subject: "Google sign-in was added to your canvas account",
    name,
    lines: [
      `Your canvas account (${email}) can now be logged in to with the Google account ${googleEmail}.`,
      "You can disconnect it in Settings, under Signing in.",
    ],
    resetLink,
  });
}

export function workspaceInviteEmail({
  inviter,
  workspace,
  role,
  link,
}: {
  inviter: string;
  workspace: string;
  role: "editor" | "viewer";
  link: string;
}): Message {
  const what = role === "editor" ? "draw on its drawings together, live" : "open its drawings and follow along as they change";
  const subject = `${inviter} invited you to ${workspace} on canvas`;
  const text = [
    "Hi,",
    "",
    `${inviter} invited you to the workspace "${workspace}" on canvas, where you'll be able to ${what}.`,
    "",
    `Join it here (it works for 14 days, with an account for this email address):\n${link}`,
    "",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = page(
    subject,
    p(`${esc(inviter)} invited you to the workspace <strong>${esc(workspace)}</strong> on canvas, where you'll be able to ${esc(what)}.`) +
      button(link, "Join the workspace") +
      p("The link works for 14 days, with a canvas account for this email address. If you weren't expecting this, you can ignore this email.", true),
  );
  return { subject, text, html };
}

/** What's held in an account after its membership ended, in words: "3 drawings and 12 flashcards". */
function heldWords({ drawings, flashcards }: { drawings: number; flashcards: number }) {
  const parts = [
    drawings ? `${drawings} ${drawings === 1 ? "drawing" : "drawings"}` : null,
    flashcards ? `${flashcards} ${flashcards === 1 ? "flashcard" : "flashcards"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "profile picture";
}

type Held = {
  name: string;
  drawings: number;
  flashcards: number;
  /** The day it goes, written out ("December 26, 2026"). */
  deleteOn: string;
  /** Where to renew and where to move drawings into the browser; null when the site's address isn't known. */
  pricingLink: string | null;
  homeLink: string | null;
};

/** Sent when a membership ends with things still in the account: what happens, and when. */
export function storageEndedEmail(held: Held): Message {
  const what = heldWords(held);
  const subject = `Your canvas membership has ended: your ${what} will be deleted on ${held.deleteOn}`;
  const steps = [
    `Renew any time before then and everything stays as it is${held.pricingLink ? `: ${held.pricingLink}` : "."}`,
    `Or keep your drawings for free: open canvas${held.homeLink ? ` (${held.homeLink})` : ""} and move them into your browser from the home page. Flashcards are part of the membership and can't be moved.`,
  ];
  const text = [
    `Hi ${held.name},`,
    "",
    `Your canvas membership has ended. Without a membership, canvas keeps drawings in your browser rather than on our server, so the ${what} in your account will be deleted on ${held.deleteOn}, 30 days from now.`,
    "",
    ...steps,
    "",
    "We'll remind you a week before.",
  ].join("\n");
  const html = page(
    subject,
    p(`Hi ${esc(held.name)},`) +
      p(
        `Your canvas membership has ended. Without a membership, canvas keeps drawings in your browser rather than on our server, so the <strong>${esc(what)}</strong> in your account will be deleted on <strong>${esc(held.deleteOn)}</strong>, 30 days from now.`,
      ) +
      (held.pricingLink ? button(held.pricingLink, "Renew membership") : "") +
      p(
        `Or keep your drawings for free: open canvas${held.homeLink ? ` (<a href="${esc(held.homeLink)}" style="color:#201f24;">${esc(held.homeLink)}</a>)` : ""} and move them into your browser from the home page. Flashcards are part of the membership and can't be moved.`,
      ) +
      p("We'll remind you a week before.", true),
  );
  return { subject, text, html };
}

/** A week before the account's drawings and flashcards are deleted. */
export function storageReminderEmail(held: Held): Message {
  const what = heldWords(held);
  const subject = `Your ${what} on canvas will be deleted on ${held.deleteOn}`;
  const text = [
    `Hi ${held.name},`,
    "",
    `A reminder: your canvas membership has ended, and the ${what} in your account will be deleted on ${held.deleteOn}, a week from now.`,
    "",
    `Renew to keep everything${held.pricingLink ? `: ${held.pricingLink}` : "."}`,
    `Or move your drawings into your browser from the home page${held.homeLink ? ` (${held.homeLink})` : ""} to keep them on the free plan.`,
  ].join("\n");
  const html = page(
    subject,
    p(`Hi ${esc(held.name)},`) +
      p(
        `A reminder: your canvas membership has ended, and the <strong>${esc(what)}</strong> in your account will be deleted on <strong>${esc(held.deleteOn)}</strong>, a week from now.`,
      ) +
      (held.pricingLink ? button(held.pricingLink, "Renew membership") : "") +
      p(
        `Or move your drawings into your browser from the home page${held.homeLink ? ` (<a href="${esc(held.homeLink)}" style="color:#201f24;">${esc(held.homeLink)}</a>)` : ""} to keep them on the free plan.`,
        true,
      ),
  );
  return { subject, text, html };
}
