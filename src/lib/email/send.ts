import "server-only";

import { after } from "next/server";
import { createTransport } from "nodemailer";

/*
 * Sending email. With SMTP_URL set, mail goes out through that server (any
 * provider with SMTP works: Resend, Postmark, Brevo, Amazon SES, Gmail…).
 * Without it, each email is printed to the server's console instead, so
 * sign-up and password resets still work while you develop.
 */

export type Email = { to: string; subject: string; text: string; html: string };

let transport: ReturnType<typeof createTransport> | null | undefined;
let warned = false;

function smtp() {
  if (transport === undefined) {
    const url = process.env.SMTP_URL?.trim();
    transport = url ? createTransport(url) : null;
  }
  return transport;
}

export async function sendEmail(email: Email): Promise<void> {
  const server = smtp();
  if (!server) {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn("[email] SMTP_URL isn't set, so emails are printed here instead of sent. Set it before people sign up.");
    }
    console.info(`[email] To: ${email.to}\n[email] Subject: ${email.subject}\n\n${email.text}\n`);
    return;
  }
  await server.sendMail({
    from: process.env.EMAIL_FROM?.trim() || "canvas <no-reply@localhost>",
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

/**
 * Send once the response has gone out, so the page never waits on the mail
 * server and its timing can't tell anyone whether an account exists.
 * Failures are logged.
 */
export function sendEmailLater(email: Email) {
  after(async () => {
    try {
      await sendEmail(email);
    } catch (err) {
      console.error(`[email] couldn't send "${email.subject}" to ${email.to}:`, err);
    }
  });
}
