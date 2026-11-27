import "server-only";

import { createTransport } from "nodemailer";

/*
 * Handing one email to the mail server. Only the queue's worker calls this
 * (src/lib/email/queue.ts); everything else queues mail through send.ts.
 * With SMTP_URL set, mail goes out through that server (any provider with
 * SMTP works: Resend, Postmark, Brevo, Amazon SES, Gmail…). Without it, each
 * email is printed to the server's console instead, so sign-up and password
 * resets still work while you develop.
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

/** Throws the mail server's error (with its `responseCode`) if it refuses. */
export async function deliver(email: Email): Promise<void> {
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
