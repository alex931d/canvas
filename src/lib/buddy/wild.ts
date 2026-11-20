import "server-only";

import { and, desc, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { buddyCollection, buddyEncounters, buddyStats, studyEvents } from "@/db/schema";
import { act, BattleError, startBattle, viewOf, type Action, type BattleState } from "./battle";
import { kindOf, partyIdFor, type BattleReply, type CaughtBuddy, type WildEncounter } from "./game";
import { bambooFor, rollWild } from "./kinds";
import { getWildRules } from "@/lib/site/settings";
import { getSettings, levelOf, saveSettings } from "./progress";
import { BUDDY_COLORS, MAX_BUDDIES, POINTS, type BuddySettings } from "./shared";

/**
 * The buddy game on the server: wild pandas turning up, battles (every turn
 * is played here, so the outcome can't be made up in the browser), and the
 * pandas you catch, kept for good. How often they turn up, how long they
 * stay, which kinds and how they battle follow the rules admins set
 * (src/lib/buddy/rules.ts, read with getWildRules).
 */

/** A battle left alone this long is over. */
const BATTLE_IDLE_MS = 30 * 60_000;

export class GameError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------ what you have

export async function getCollection(userId: string): Promise<CaughtBuddy[]> {
  const rows = await db
    .select()
    .from(buddyCollection)
    .where(eq(buddyCollection.userId, userId))
    .orderBy(desc(buddyCollection.caughtAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    rarity: r.rarity,
    ability: r.ability,
    level: r.level,
    caughtAt: r.caughtAt.toISOString(),
  }));
}

export async function getStats(userId: string) {
  const [row] = await db.select().from(buddyStats).where(eq(buddyStats.userId, userId));
  return row ?? { userId, bambooSpent: 0, caught: 0, won: 0, lastWildAt: null };
}

/** Study points (the same count as progress, without the day-by-day parts). */
export async function pointsOf(userId: string) {
  const [row] = await db
    .select({
      reviews: sql<number>`count(*) filter (where ${studyEvents.kind} = 'review')`.mapWith(Number),
      tasks: sql<number>`count(*) filter (where ${studyEvents.kind} = 'task')`.mapWith(Number),
    })
    .from(studyEvents)
    .where(eq(studyEvents.userId, userId));
  return row.reviews * POINTS.review + row.tasks * POINTS.task;
}

export async function bambooLeft(userId: string, points?: number) {
  const [p, stats] = await Promise.all([points ?? pointsOf(userId), getStats(userId)]);
  return bambooFor(p, stats.bambooSpent);
}

/**
 * Settings from the browser may bring caught pandas along: each must be one
 * of yours, and only once. Their names follow what's typed in the settings.
 */
export async function checkParty(userId: string, settings: BuddySettings): Promise<string | null> {
  const ids = settings.buddies.flatMap((b) => (b.catchId ? [b.catchId] : []));
  if (new Set(ids).size !== ids.length) return "The same panda can only come along once.";
  if (ids.length === 0) return null;
  const owned = await db
    .select({ id: buddyCollection.id, name: buddyCollection.name })
    .from(buddyCollection)
    .where(and(eq(buddyCollection.userId, userId), inArray(buddyCollection.id, ids)));
  if (owned.length !== ids.length) return "That panda isn't one of yours.";
  const renamed = settings.buddies.filter((b) => b.catchId && owned.find((o) => o.id === b.catchId)?.name !== b.name);
  for (const b of renamed) {
    await db
      .update(buddyCollection)
      .set({ name: b.name })
      .where(and(eq(buddyCollection.id, b.catchId!), eq(buddyCollection.userId, userId)));
  }
  return null;
}

// ------------------------------------------------------------ wild pandas

type EncounterRow = typeof buddyEncounters.$inferSelect;

const toWild = (r: EncounterRow): WildEncounter => ({
  id: r.id,
  name: r.name,
  rarity: r.rarity,
  ability: r.ability,
  level: r.level,
  status: r.status === "battle" ? "battle" : "wild",
  expiresAt: r.expiresAt.toISOString(),
  battle: r.status === "battle" && r.state ? viewOf(r.state as BattleState) : null,
});

/** The wild panda around right now (wandering, or in a battle), tidying away ones that left. */
async function current(userId: string): Promise<EncounterRow | null> {
  const [row] = await db
    .select()
    .from(buddyEncounters)
    .where(and(eq(buddyEncounters.userId, userId), inArray(buddyEncounters.status, ["wild", "battle"])))
    .orderBy(desc(buddyEncounters.createdAt))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  const stale =
    (row.status === "wild" && row.expiresAt.getTime() <= now) ||
    (row.status === "battle" && row.createdAt.getTime() < now - BATTLE_IDLE_MS);
  if (!stale) return row;
  await db
    .update(buddyEncounters)
    .set({ status: "gone", endedAt: new Date() })
    .where(and(eq(buddyEncounters.id, row.id), inArray(buddyEncounters.status, ["wild", "battle"])));
  // The next one waits a full gap from when this one left.
  await db.update(buddyStats).set({ lastWildAt: new Date() }).where(eq(buddyStats.userId, userId));
  return null;
}

/**
 * Is a wild panda around? Called by the browser every minute or so while a
 * drawing is open. With wild pandas turned off (by you, or for everyone),
 * no new ones. Otherwise at most one chance every `gapMinutes` (the very
 * first only after a full wait), each a `chance` coin flip, with the level
 * on your record picking which kinds can turn up.
 */
export async function lookForWild(userId: string, rng: () => number = Math.random): Promise<WildEncounter | null> {
  const [settings, rules] = await Promise.all([getSettings(userId), getWildRules()]);
  if (!settings.visible || !settings.wild) return null;
  const here = await current(userId);
  if (here) return toWild(here);
  if (!rules.on) return null;

  // Claim this chance (one tab only), or start the clock the first time.
  await db.insert(buddyStats).values({ userId, lastWildAt: new Date() }).onConflictDoNothing();
  const claimed = await db
    .update(buddyStats)
    .set({ lastWildAt: new Date() })
    .where(
      and(
        eq(buddyStats.userId, userId),
        or(isNull(buddyStats.lastWildAt), lt(buddyStats.lastWildAt, new Date(Date.now() - rules.gapMinutes * 60_000))),
      ),
    )
    .returning({ userId: buddyStats.userId });
  if (claimed.length === 0 || rng() >= rules.chance) return null;

  const wild = rollWild(await levelOf(userId), rng, rules.kinds);
  if (!wild) return null;
  const [row] = await db
    .insert(buddyEncounters)
    .values({ userId, ...wild, expiresAt: new Date(Date.now() + rules.stayMinutes * 60_000) })
    .returning();
  return toWild(row);
}

// ------------------------------------------------------------ battles

async function encounterFor(userId: string, id: string): Promise<EncounterRow> {
  const [row] = await db
    .select()
    .from(buddyEncounters)
    .where(and(eq(buddyEncounters.id, id), eq(buddyEncounters.userId, userId)));
  if (!row) throw new GameError("That panda isn't here.", 404);
  return row;
}

/** Start a battle with a wild panda, sending out your buddy number `first`. */
export async function beginBattle(userId: string, id: string, first = 0): Promise<BattleReply> {
  const row = await encounterFor(userId, id);
  if (row.status === "battle") throw new GameError("You're already battling this panda.", 409);
  if (row.status !== "wild" || row.expiresAt.getTime() <= Date.now()) {
    throw new GameError(`${row.name} has wandered off.`, 410);
  }
  const [settings, collection, points, stats, yourLevel, rules] = await Promise.all([
    getSettings(userId),
    getCollection(userId),
    pointsOf(userId),
    getStats(userId),
    levelOf(userId),
    getWildRules(),
  ]);
  const { catchRate, flee } = rules.kinds[row.rarity];
  const team = settings.buddies.map((b) => ({ id: b.id, name: b.name, color: b.color, ...kindOf(b, collection) }));
  const bamboo = bambooFor(points, stats.bambooSpent);
  const { state, steps } = startBattle({
    team,
    first,
    wild: { id: "wild", name: row.name, rarity: row.rarity, ability: row.ability, level: row.level, color: "" },
    yourLevel,
    bamboo,
    rates: { catchRate, flee },
  });
  const started = await db
    .update(buddyEncounters)
    .set({ status: "battle", state, createdAt: new Date() })
    .where(and(eq(buddyEncounters.id, id), eq(buddyEncounters.status, "wild")))
    .returning({ id: buddyEncounters.id });
  if (started.length === 0) throw new GameError("You're already battling this panda.", 409);
  return { battle: viewOf(state), steps, bamboo, caught: null };
}

/**
 * Play your turn. `turn` is the turn you saw, so two tabs can't both play the
 * same one. Bamboo comes off what you have when it's offered; a panda that
 * takes it joins your collection, and walks with you if there's room.
 */
export async function playTurn(
  userId: string,
  id: string,
  turn: number,
  action: Action,
  rng: () => number = Math.random,
): Promise<BattleReply> {
  const row = await encounterFor(userId, id);
  if (row.status !== "battle" || !row.state) {
    throw new GameError(row.status === "wild" ? "Start the battle first." : "This battle is over.", 410);
  }
  const before = row.state as BattleState;
  if (before.turn !== turn) throw new GameError("This battle moved on in another tab. Reload to catch up.", 409);

  const points = await pointsOf(userId);
  const stats = await getStats(userId);
  const bamboo = bambooFor(points, stats.bambooSpent);

  let result: ReturnType<typeof act>;
  try {
    result = act({ ...before, bamboo }, action, rng);
  } catch (e) {
    if (e instanceof BattleError) throw new GameError(e.message, 422);
    throw e;
  }
  const { state, steps } = result;
  const spent = state.bambooUsed - before.bambooUsed;

  let caught: BattleReply["caught"] = null;
  await db.transaction(async (tx) => {
    const saved = await tx
      .update(buddyEncounters)
      .set({ state, status: state.over ?? "battle", endedAt: state.over ? new Date() : null })
      .where(
        and(
          eq(buddyEncounters.id, id),
          eq(buddyEncounters.status, "battle"),
          sql`(${buddyEncounters.state}->>'turn')::int = ${turn}`,
        ),
      )
      .returning({ id: buddyEncounters.id });
    if (saved.length === 0) throw new GameError("This battle moved on in another tab. Reload to catch up.", 409);

    await tx.insert(buddyStats).values({ userId }).onConflictDoNothing();
    await tx
      .update(buddyStats)
      .set({
        bambooSpent: sql`${buddyStats.bambooSpent} + ${spent}`,
        caught: sql`${buddyStats.caught} + ${state.over === "caught" ? 1 : 0}`,
        won: sql`${buddyStats.won} + ${state.over === "won" ? 1 : 0}`,
        // Once it's over, the next wild panda waits a full gap from now (not straight after the battle).
        ...(state.over ? { lastWildAt: new Date() } : {}),
      })
      .where(eq(buddyStats.userId, userId));

    if (state.over === "caught") {
      const [kept] = await tx
        .insert(buddyCollection)
        .values({ userId, name: row.name, rarity: row.rarity, ability: row.ability, level: row.level })
        .returning();
      caught = {
        id: kept.id,
        name: kept.name,
        rarity: kept.rarity,
        ability: kept.ability,
        level: kept.level,
        caughtAt: kept.caughtAt.toISOString(),
        walking: false,
      };
    }
  });

  // Room to walk with you? Then it comes along straight away.
  if (caught) {
    const c = caught as NonNullable<BattleReply["caught"]>;
    const settings = await getSettings(userId);
    if (settings.buddies.length < MAX_BUDDIES) {
      const color = BUDDY_COLORS.find((col) => !settings.buddies.some((b) => b.color === col)) ?? BUDDY_COLORS[0];
      await saveSettings(userId, {
        ...settings,
        buddies: [
          ...settings.buddies,
          { id: partyIdFor(c.id), name: c.name.slice(0, 24), color, x: null, y: null, catchId: c.id },
        ],
      });
      c.walking = true;
    }
  }

  return { battle: viewOf(state), steps, bamboo: bamboo - spent, caught };
}
