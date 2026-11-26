import "server-only";

import { and, count, eq, exists, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  drawings,
  flashcards,
  storageDeletions,
  subscriptions,
  userAvatars,
  userPreferences,
  users,
} from "@/db/schema";
import { notify } from "@/lib/collab/notify";
import { sendEmail } from "@/lib/email/send";
import { storageEndedEmail, storageReminderEmail } from "@/lib/email/templates";
import { MEMBER_STATUS_LIST } from "./membership";

/**
 * Space on the server is for members. When a membership ends, what the
 * account holds there (drawings with their files, flashcards, the profile
 * picture, settings) is kept for KEEP_DAYS, then deleted unless they renew.
 *
 * The sweep (every hour; src/instrumentation.ts) does it in four steps:
 *   1. renewed: forget the schedule of anyone who's a member again
 *   2. found:   anyone without a membership who still holds drawings,
 *               flashcards or a picture gets a date (now + KEEP_DAYS) and an
 *               email saying so; the home page shows the date too
 *   3. remind:  a week before the date, a second email
 *   4. delete:  on the date, all of it (people who were shown a shared
 *               drawing see that the owner deleted it)
 * Someone who moves everything into their browser (or deletes it) first is
 * simply forgotten. Only one server runs a sweep at a time (an advisory lock).
 */

export const KEEP_DAYS = 30;
export const REMIND_DAYS_BEFORE = 7;
const DAY_MS = 86_400_000;
/** pg_try_advisory_xact_lock key: "canvas storage sweep". */
const SWEEP_LOCK = 742_031_906;

const memberSubscription = (userId: typeof users.id | typeof storageDeletions.userId) =>
  db
    .select({ one: sql`1` })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, MEMBER_STATUS_LIST)));

const holds = (userId: typeof users.id | typeof storageDeletions.userId) =>
  or(
    exists(db.select({ one: sql`1` }).from(drawings).where(eq(drawings.userId, userId))),
    exists(db.select({ one: sql`1` }).from(flashcards).where(eq(flashcards.userId, userId))),
    exists(db.select({ one: sql`1` }).from(userAvatars).where(eq(userAvatars.userId, userId))),
  );

/** What an account holds on the server. */
export async function heldBy(userId: string) {
  const [[d], [f], [a]] = await Promise.all([
    db.select({ n: count() }).from(drawings).where(eq(drawings.userId, userId)),
    db.select({ n: count() }).from(flashcards).where(eq(flashcards.userId, userId)),
    db.select({ n: count() }).from(userAvatars).where(eq(userAvatars.userId, userId)),
  ]);
  return { drawings: d?.n ?? 0, flashcards: f?.n ?? 0, picture: (a?.n ?? 0) > 0 };
}

/**
 * When this account's server data will be deleted, starting the clock if it
 * hasn't started (the sweep's email follows). For someone without a
 * membership who holds something; null if they hold nothing.
 */
export async function deletionDate(userId: string, now = new Date()): Promise<Date | null> {
  const held = await heldBy(userId);
  if (!held.drawings && !held.flashcards && !held.picture) return null;
  await db
    .insert(storageDeletions)
    .values({ userId, endedAt: now, deleteAfter: new Date(now.getTime() + KEEP_DAYS * DAY_MS) })
    .onConflictDoNothing({ target: storageDeletions.userId });
  const [row] = await db
    .select({ deleteAfter: storageDeletions.deleteAfter })
    .from(storageDeletions)
    .where(eq(storageDeletions.userId, userId));
  return row?.deleteAfter ?? null;
}

const longDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** Where emails link to: APP_URL, or this machine while developing; null when unknown. */
function siteForEmails(): string | null {
  const url = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (url) return url;
  return process.env.NODE_ENV === "production" ? null : `http://localhost:${process.env.PORT ?? 3000}`;
}

async function emailAbout(kind: "ended" | "reminder", userId: string, deleteAfter: Date): Promise<boolean> {
  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) return false;
  const held = await heldBy(userId);
  const site = siteForEmails();
  const message = (kind === "ended" ? storageEndedEmail : storageReminderEmail)({
    name: user.name,
    drawings: held.drawings,
    flashcards: held.flashcards,
    deleteOn: longDate.format(deleteAfter),
    pricingLink: site ? `${site}/pricing` : null,
    homeLink: site ? `${site}/` : null,
  });
  try {
    await sendEmail({ to: user.email, ...message });
    return true;
  } catch (err) {
    console.error(`[storage] couldn't send the ${kind} email to ${user.email}:`, err);
    return false;
  }
}

/** Delete everything this account holds on the server. Returns the drawings that went. */
export async function deleteHeldStorage(userId: string): Promise<string[]> {
  const gone = await db.transaction(async (tx) => {
    // Files, sharing and history go with each drawing (they cascade).
    const removed = await tx.delete(drawings).where(eq(drawings.userId, userId)).returning({ id: drawings.id });
    await tx.delete(flashcards).where(eq(flashcards.userId, userId));
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(users).set({ avatarUpdatedAt: null }).where(eq(users.id, userId));
    await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await tx.delete(storageDeletions).where(eq(storageDeletions.userId, userId));
    return removed.map((r) => r.id);
  });
  for (const id of gone) await notify({ t: "deleted", d: id }).catch(() => undefined);
  return gone;
}

export type SweepResult = { renewed: number; scheduled: number; warned: number; reminded: number; deleted: number };

/** One pass of the sweep (see above). Null when another server is already sweeping. */
export async function sweepStorage(now = new Date()): Promise<SweepResult | null> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK}) as ok`);
    if (!lock.rows[0]?.ok) return null;
    const result: SweepResult = { renewed: 0, scheduled: 0, warned: 0, reminded: 0, deleted: 0 };

    // 1. Members again: nothing to delete.
    result.renewed = (
      await db
        .delete(storageDeletions)
        .where(exists(memberSubscription(storageDeletions.userId)))
        .returning({ userId: storageDeletions.userId })
    ).length;

    // 2. Without a membership, still holding something here: start the clock.
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          notExists(memberSubscription(users.id)),
          notExists(db.select({ one: sql`1` }).from(storageDeletions).where(eq(storageDeletions.userId, users.id))),
          holds(users.id),
        ),
      )
      .limit(500);
    if (found.length) {
      result.scheduled = (
        await db
          .insert(storageDeletions)
          .values(found.map((u) => ({ userId: u.id, endedAt: now, deleteAfter: new Date(now.getTime() + KEEP_DAYS * DAY_MS) })))
          .onConflictDoNothing({ target: storageDeletions.userId })
          .returning({ userId: storageDeletions.userId })
      ).length;
    }

    // Whoever holds nothing any more (moved it all to their browser, or deleted it) is forgotten.
    await db.delete(storageDeletions).where(sql`not ${holds(storageDeletions.userId)}`);

    // The first email, for everyone scheduled who hasn't had it (a failed send is tried again next time).
    for (const row of await db
      .select({ userId: storageDeletions.userId, deleteAfter: storageDeletions.deleteAfter })
      .from(storageDeletions)
      .where(and(isNull(storageDeletions.warnedAt), sql`${storageDeletions.deleteAfter} > ${now}`))) {
      if (await emailAbout("ended", row.userId, row.deleteAfter)) {
        await db.update(storageDeletions).set({ warnedAt: now }).where(eq(storageDeletions.userId, row.userId));
        result.warned++;
      }
    }

    // 3. A week to go.
    const remindFrom = new Date(now.getTime() + REMIND_DAYS_BEFORE * DAY_MS);
    for (const row of await db
      .select({ userId: storageDeletions.userId, deleteAfter: storageDeletions.deleteAfter })
      .from(storageDeletions)
      .where(
        and(
          isNull(storageDeletions.remindedAt),
          lte(storageDeletions.deleteAfter, remindFrom),
          sql`${storageDeletions.deleteAfter} > ${now}`,
        ),
      )) {
      if (await emailAbout("reminder", row.userId, row.deleteAfter)) {
        await db.update(storageDeletions).set({ remindedAt: now }).where(eq(storageDeletions.userId, row.userId));
        result.reminded++;
      }
    }

    // 4. The day has come.
    for (const row of await db
      .select({ userId: storageDeletions.userId })
      .from(storageDeletions)
      .where(lte(storageDeletions.deleteAfter, now))) {
      const gone = await deleteHeldStorage(row.userId);
      console.info(`[storage] deleted ${gone.length} drawings and the rest of user ${row.userId}'s server data`);
      result.deleted++;
    }
    return result;
  });
}
