import "server-only";

import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailJobs } from "@/db/schema";
import { canEncrypt, decrypt, encrypt } from "@/lib/auth/secret-box";
import { deliver, type Email } from "./transport";

/**
 * The email queue: every email the app sends waits here (the email_jobs
 * table) and a worker sends them, most urgent first. Someone waiting for a
 * sign-in code never queues behind a batch of membership reminders.
 *
 *   urgent    someone is waiting on it: sign-in and confirmation codes,
 *             password reset links
 *   security  about their account's safety: two-factor on or off, Google
 *             linked, the email or password changed, changes by staff
 *   normal    invitations and other things people asked for
 *   bulk      notices sent to many people at once: a membership ending,
 *             reminders
 *
 * The worker (started in src/instrumentation.ts) claims one job at a time
 * with FOR UPDATE SKIP LOCKED, so several servers can share the queue
 * without sending anything twice, and the next one it takes is always the
 * most urgent due. A failed send is tried again after 30 s, then 2, 8, 30
 * minutes and 2 hours; a mail server's "no such mailbox" (5xx) isn't
 * retried. Jobs stuck in "sending" (a server stopped mid-send) go back to
 * the queue after 5 minutes.
 *
 * Messages hold sign-in codes and reset links, so they're encrypted with
 * ENCRYPTION_KEY while they wait and erased once sent. Sent jobs are kept 7
 * days (address, kind and times only) and failed ones 30, for the admin page.
 *
 * Settings: EMAIL_PER_MINUTE caps how fast it sends (your provider's limit;
 * unset = as fast as the mail server answers), EMAIL_WORKER=off stops this
 * server from sending (another one does).
 */

export const EMAIL_PRIORITY = { urgent: 0, security: 1, normal: 2, bulk: 3 } as const;
export type EmailPriority = keyof typeof EMAIL_PRIORITY;

export type QueueOptions = {
  priority: EmailPriority;
  /** What it is, shown on the admin page ("sign-in code"). */
  kind: string;
};

const RETRY_AFTER_SECONDS = [30, 120, 480, 1800, 7200];
const MAX_ATTEMPTS = RETRY_AFTER_SECONDS.length + 1;
const STUCK_AFTER_MS = 5 * 60_000;
const POLL_MS = 2000;
const KEEP_SENT_DAYS = 7;
const KEEP_FAILED_DAYS = 30;

type Body = Pick<Email, "subject" | "text" | "html">;
let warnedPlain = false;

function seal(body: Body): { body: Buffer; sealed: boolean } {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  if (canEncrypt()) return { body: encrypt(bytes), sealed: true };
  if (!warnedPlain && process.env.NODE_ENV === "production") {
    warnedPlain = true;
    console.warn("[email] ENCRYPTION_KEY isn't set, so queued emails (with sign-in codes) are stored unencrypted until sent.");
  }
  return { body: bytes, sealed: false };
}

function open(row: { body: Buffer | null; sealed: boolean }): Body | null {
  if (!row.body) return null;
  const bytes = row.sealed ? decrypt(row.body) : row.body;
  if (!bytes) return null;
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as Body;
  } catch {
    return null;
  }
}

/** Put an email in the queue; resolves its job id once it's stored. */
export async function queueEmail(email: Email, options: QueueOptions): Promise<number> {
  const [job] = await db
    .insert(emailJobs)
    .values({
      toAddress: email.to,
      kind: options.kind,
      priority: EMAIL_PRIORITY[options.priority],
      ...seal({ subject: email.subject, text: email.text, html: email.html }),
    })
    .returning({ id: emailJobs.id });
  EmailWorker.wake();
  return job.id;
}

export type DeliveryResult = "sent" | "queued" | "failed";

/**
 * Wait (up to `timeoutMs`) to hear how a queued email went: sent; failed (its
 * first try failed, so it's taken out of the queue: the caller tells the
 * person and they ask again); or still queued, which is fine.
 */
export async function awaitDelivery(id: number, timeoutMs = 10_000): Promise<DeliveryResult> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const [job] = await db
      .select({ status: emailJobs.status, attempts: emailJobs.attempts })
      .from(emailJobs)
      .where(eq(emailJobs.id, id));
    if (!job || job.status === "sent") return "sent";
    if (job.status === "failed" || (job.status === "queued" && job.attempts > 0)) {
      await db
        .update(emailJobs)
        .set({ status: "cancelled", body: null })
        .where(and(eq(emailJobs.id, id), inArray(emailJobs.status, ["queued", "failed"])));
      return "failed";
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return "queued";
}

// ---------------------------------------------------------------- worker

type Job = typeof emailJobs.$inferSelect;

/**
 * Sends what's queued, one at a time, most urgent first. One per server
 * process, shared through globalThis (Next.js loads this module more than
 * once: for the start-up hook and for the routes that queue mail).
 */
export class EmailWorker {
  private running = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = 0;
  private lastTidy = 0;

  static get shared(): EmailWorker {
    const g = globalThis as { __canvasEmailWorker?: EmailWorker };
    return (g.__canvasEmailWorker ??= new EmailWorker());
  }

  /** Something was queued: look now rather than at the next poll. */
  static wake() {
    const worker = EmailWorker.shared;
    if (worker.started) void worker.run();
  }

  start() {
    if (this.started || process.env.EMAIL_WORKER === "off") return;
    this.started = true;
    void this.run();
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
    this.timer.unref?.();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.tidy();
      for (;;) {
        const job = await claimNext();
        if (!job) break;
        await this.pace();
        await this.send(job);
      }
    } catch (err) {
      console.error("[email] queue worker:", err);
    } finally {
      this.running = false;
      this.schedule(POLL_MS);
    }
  }

  /** Keep under EMAIL_PER_MINUTE. */
  private async pace() {
    const perMinute = Number(process.env.EMAIL_PER_MINUTE);
    if (!(perMinute > 0)) return;
    const gap = 60_000 / perMinute - (Date.now() - this.lastSentAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  }

  private async send(job: Job) {
    const body = open(job);
    if (!body) {
      await finish(job.id, { status: "failed", lastError: "The message couldn't be read (was ENCRYPTION_KEY changed?)." });
      return;
    }
    try {
      await deliver({ to: job.toAddress, ...body });
      this.lastSentAt = Date.now();
      await finish(job.id, { status: "sent", sentAt: new Date(), lastError: null });
    } catch (err) {
      this.lastSentAt = Date.now();
      const code = (err as { responseCode?: number }).responseCode ?? 0;
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const permanent = code >= 500 && code < 600;
      if (permanent || job.attempts >= MAX_ATTEMPTS) {
        console.error(`[email] gave up on "${job.kind}" to ${job.toAddress}: ${message}`);
        await finish(job.id, { status: "failed", lastError: message });
      } else {
        const wait = RETRY_AFTER_SECONDS[job.attempts - 1] ?? RETRY_AFTER_SECONDS.at(-1)!;
        console.warn(`[email] "${job.kind}" to ${job.toAddress} failed (try ${job.attempts}); again in ${wait}s: ${message}`);
        await db
          .update(emailJobs)
          .set({ status: "queued", lockedAt: null, lastError: message, runAfter: sql`now() + make_interval(secs => ${wait})` })
          .where(and(eq(emailJobs.id, job.id), eq(emailJobs.status, "sending")));
      }
    }
  }

  /** Free stuck jobs, and forget old ones (once a minute). */
  private async tidy() {
    if (Date.now() - this.lastTidy < 60_000) return;
    this.lastTidy = Date.now();
    await db
      .update(emailJobs)
      .set({ status: "queued", lockedAt: null })
      .where(and(eq(emailJobs.status, "sending"), lt(emailJobs.lockedAt, new Date(Date.now() - STUCK_AFTER_MS))));
    await db
      .delete(emailJobs)
      .where(
        sql`(${emailJobs.status} in ('sent', 'cancelled') and ${emailJobs.createdAt} < now() - make_interval(days => ${KEEP_SENT_DAYS}))
          or (${emailJobs.status} = 'failed' and ${emailJobs.createdAt} < now() - make_interval(days => ${KEEP_FAILED_DAYS}))`,
      );
  }
}

/** The most urgent job that's due, marked as being sent (null when none is). */
async function claimNext(): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: emailJobs.id })
      .from(emailJobs)
      .where(and(eq(emailJobs.status, "queued"), lte(emailJobs.runAfter, sql`now()`)))
      .orderBy(asc(emailJobs.priority), asc(emailJobs.runAfter), asc(emailJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [job] = await tx
      .update(emailJobs)
      .set({ status: "sending", lockedAt: sql`now()`, attempts: sql`${emailJobs.attempts} + 1` })
      .where(eq(emailJobs.id, next.id))
      .returning();
    return job ?? null;
  });
}

async function finish(id: number, set: Partial<typeof emailJobs.$inferInsert>) {
  await db
    .update(emailJobs)
    .set({ ...set, lockedAt: null, ...(set.status === "sent" || set.status === "failed" ? { body: null } : {}) })
    .where(eq(emailJobs.id, id));
}

/** How the queue stands, for the admin page. */
export async function queueStats() {
  const rows = await db
    .select({ status: emailJobs.status, n: sql<number>`count(*)::int` })
    .from(emailJobs)
    .where(sql`${emailJobs.createdAt} > now() - interval '1 day' or ${emailJobs.status} in ('queued', 'sending')`)
    .groupBy(emailJobs.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const [oldest] = await db
    .select({ at: sql<Date | null>`min(${emailJobs.runAfter})` })
    .from(emailJobs)
    .where(eq(emailJobs.status, "queued"));
  return {
    queued: (by.queued ?? 0) + (by.sending ?? 0),
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    oldestQueued: oldest?.at ? new Date(oldest.at) : null,
  };
}
