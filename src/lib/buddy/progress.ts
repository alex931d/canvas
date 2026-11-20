import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { buddySettings, studyEvents, users } from "@/db/schema";
import {
  DEFAULT_SETTINGS,
  LEVELS,
  levelFor,
  POINTS,
  settingsSchema,
  streakFrom,
  type BuddySettings,
  type Progress,
} from "./shared";

/**
 * Server side of the study buddies: settings, study events and progress.
 *
 * Your level lives on your record (users.level). It's worked out from your
 * study events' points: again in the same transaction whenever something new
 * is noted, and checked whenever your progress is read, so it catches up with
 * events added any other way.
 */

type Executor = Pick<typeof db, "insert" | "update">;

export type StudyEvent = { kind: "review" | "task"; ref?: string };

/** The points `userId`'s study events add up to, in SQL. */
const pointsSql = (userId: string) =>
  sql`(select coalesce(sum(case ${studyEvents.kind} when 'review' then ${sql.raw(String(POINTS.review))} when 'task' then ${sql.raw(String(POINTS.task))} else 0 end), 0) from ${studyEvents} where ${studyEvents.userId} = ${userId})`;

/** levelFor(points).level, in SQL: how many level floors the points reach. */
const levelSql = (points: ReturnType<typeof sql>) =>
  sql`(select count(*)::int from unnest(${sql.raw(`array[${LEVELS.join(", ")}]`)}) as l(floor) where l.floor <= ${points})`;

/** Note things studied. Events with a ref that was already noted are skipped. */
export async function recordEvents(executor: Executor, userId: string, events: StudyEvent[]) {
  if (events.length === 0) return;
  const added = await executor
    .insert(studyEvents)
    .values(events.map((e) => ({ userId, kind: e.kind, ref: e.ref ?? null })))
    .onConflictDoNothing()
    .returning({ id: studyEvents.id });
  if (added.length > 0) await syncLevel(executor, userId);
}

/** Work the level on `userId`'s record out again from their study events. */
export async function syncLevel(executor: Pick<typeof db, "update">, userId: string) {
  await executor
    .update(users)
    .set({ level: levelSql(pointsSql(userId)) })
    .where(eq(users.id, userId));
}

/** The level on `userId`'s record. */
export async function levelOf(userId: string): Promise<number> {
  const [row] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  return row?.level ?? 1;
}

export async function getSettings(userId: string): Promise<BuddySettings> {
  const [row] = await db.select({ settings: buddySettings.settings }).from(buddySettings).where(eq(buddySettings.userId, userId));
  const parsed = settingsSchema.safeParse(row?.settings);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(userId: string, settings: BuddySettings) {
  await db
    .insert(buddySettings)
    .values({ userId, settings })
    .onConflictDoUpdate({ target: buddySettings.userId, set: { settings, updatedAt: new Date() } });
}

/** A time zone Postgres and the browser agree on, or UTC. */
export function safeZone(tz: string | null | undefined): string {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

async function progressIn(userId: string, zone: string): Promise<Progress> {
  const localDay = (col: unknown) => sql`(${col} at time zone ${zone})::date`;
  const [totals] = await db
    .select({
      today: sql<string>`${localDay(sql`now()`)}::text`,
      reviews: sql<number>`count(*) filter (where ${studyEvents.kind} = 'review')`.mapWith(Number),
      tasks: sql<number>`count(*) filter (where ${studyEvents.kind} = 'task')`.mapWith(Number),
      todayReviews: sql<number>`count(*) filter (where ${studyEvents.kind} = 'review' and ${localDay(studyEvents.at)} = ${localDay(sql`now()`)})`.mapWith(Number),
      todayTasks: sql<number>`count(*) filter (where ${studyEvents.kind} = 'task' and ${localDay(studyEvents.at)} = ${localDay(sql`now()`)})`.mapWith(Number),
    })
    .from(studyEvents)
    .where(eq(studyEvents.userId, userId));
  const days = await db
    .selectDistinct({ day: sql<string>`${localDay(studyEvents.at)}::text` })
    .from(studyEvents)
    .where(sql`${studyEvents.userId} = ${userId} and ${studyEvents.at} > now() - interval '400 days'`);
  const points = totals.reviews * POINTS.review + totals.tasks * POINTS.task;
  const { level, floor, next } = levelFor(points);
  // Behind (or ahead of) the points? Then put it right on their record.
  await db
    .update(users)
    .set({ level })
    .where(and(eq(users.id, userId), ne(users.level, level)));
  return {
    today: { reviews: totals.todayReviews, tasks: totals.todayTasks },
    streak: streakFrom(
      days.map((d) => d.day).sort().reverse(),
      totals.today,
    ),
    points,
    level,
    levelFloor: floor,
    nextLevel: next,
  };
}

/** Today's numbers, the streak and the level, with days counted in `tz`. */
export async function getProgress(userId: string, tz: string | null | undefined): Promise<Progress> {
  const zone = safeZone(tz);
  try {
    return await progressIn(userId, zone);
  } catch (err) {
    // A zone the browser knows but this Postgres doesn't.
    if (zone === "UTC") throw err;
    return progressIn(userId, "UTC");
  }
}
