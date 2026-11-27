import "server-only";

import { after } from "next/server";
import { awaitDelivery, queueEmail, type DeliveryResult, type QueueOptions } from "./queue";
import type { Email } from "./transport";

/*
 * Sending email: everything goes through the queue (src/lib/email/queue.ts),
 * which sends the most urgent mail first and retries failures. Each email
 * says how urgent it is and what it is:
 *
 *   sendEmail(email, { priority: "security", kind: "two-factor on" })
 */

export type { Email };
export { EMAIL_PRIORITY, type EmailPriority } from "./queue";

/** Queue an email; resolves once it's safely stored. */
export async function sendEmail(email: Email, options: QueueOptions): Promise<void> {
  await queueEmail(email, options);
}

/**
 * Queue once the response has gone out, so the page never waits on the
 * database for it and its timing can't tell anyone whether an account
 * exists. Failures to queue are logged.
 */
export function sendEmailLater(email: Email, options: QueueOptions) {
  after(async () => {
    try {
      await queueEmail(email, options);
    } catch (err) {
      console.error(`[email] couldn't queue "${options.kind}" to ${email.to}:`, err);
    }
  });
}

/**
 * Queue and wait (up to 10 s) to hear how it went, for when the page should
 * say if it didn't send (a code someone asked for again). "failed" means it
 * was taken out of the queue; "queued" means it's still on its way.
 */
export async function sendEmailAndWait(email: Email, options: QueueOptions): Promise<DeliveryResult> {
  return awaitDelivery(await queueEmail(email, options));
}
