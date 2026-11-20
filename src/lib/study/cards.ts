import "server-only";

import { and, asc, count, desc, eq, lte, sql } from "drizzle-orm";
import { io } from "next/cache";
import { db } from "@/db";
import { flashcards } from "@/db/schema";
import { requireMember } from "@/lib/billing/membership";

/**
 * Flashcards, read side. Every function resolves the signed-in member and
 * only returns their own cards.
 */

export type StudyCard = {
  id: string;
  deck: string;
  drawingId: string | null;
  front: string;
  back: string;
  imageSide: "front" | "back" | null;
  imageWidth: number | null;
  imageHeight: number | null;
  box: number;
  dueAt: Date;
};

const cardColumns = {
  id: flashcards.id,
  deck: flashcards.deck,
  drawingId: flashcards.drawingId,
  front: flashcards.front,
  back: flashcards.back,
  imageSide: flashcards.imageSide,
  imageWidth: flashcards.imageWidth,
  imageHeight: flashcards.imageHeight,
  box: flashcards.box,
  dueAt: flashcards.dueAt,
};

/** Counts for the gallery and the sidebar. */
export async function studySummary(): Promise<{ due: number; total: number }> {
  await io();
  const user = await requireMember();
  const [row] = await db
    .select({
      total: count(),
      due: sql<number>`count(*) filter (where ${flashcards.dueAt} <= now())::int`,
    })
    .from(flashcards)
    .where(eq(flashcards.userId, user.id));
  return { due: row?.due ?? 0, total: row?.total ?? 0 };
}

/** Cards due now, oldest due first (optionally one deck = one drawing's cards). */
export async function dueCards(limit = 100, deck?: string): Promise<StudyCard[]> {
  await io();
  const user = await requireMember();
  return db
    .select(cardColumns)
    .from(flashcards)
    .where(
      and(
        eq(flashcards.userId, user.id),
        lte(flashcards.dueAt, sql`now()`),
        deck ? eq(flashcards.deck, deck) : undefined,
      ),
    )
    .orderBy(asc(flashcards.dueAt))
    .limit(limit);
}

export type Deck = { deck: string; total: number; due: number; nextDue: Date | null };

export async function listDecks(): Promise<Deck[]> {
  await io();
  const user = await requireMember();
  return db
    .select({
      deck: flashcards.deck,
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${flashcards.dueAt} <= now())::int`,
      nextDue: sql<Date | null>`min(${flashcards.dueAt}) filter (where ${flashcards.dueAt} > now())`,
    })
    .from(flashcards)
    .where(eq(flashcards.userId, user.id))
    .groupBy(flashcards.deck)
    .orderBy(asc(flashcards.deck));
}

/** Every card, newest first, for managing them. */
export async function allCards(limit = 500): Promise<StudyCard[]> {
  await io();
  const user = await requireMember();
  return db
    .select(cardColumns)
    .from(flashcards)
    .where(eq(flashcards.userId, user.id))
    .orderBy(desc(flashcards.createdAt))
    .limit(limit);
}
