"use server";

import { and, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { flashcards } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { schedule, type Grade } from "@/lib/study/schedule";

/*
 * Studying and managing flashcards. Each action checks the session and the
 * membership itself and only touches the signed-in person's cards.
 */

const idSchema = z.uuid();
const gradeSchema = z.enum(["again", "good", "easy"]);

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function member() {
  const { user } = await getCurrentSession();
  if (!user || !(await getMembership(user.id)).isMember) return null;
  return user;
}

/** Record an answer; returns when the card is due next. */
export async function reviewCard(id: string, grade: Grade): Promise<Result<{ box: number; dueAt: string }>> {
  const user = await member();
  if (!user) return { ok: false, error: "Sign in with a membership to study." };
  if (!idSchema.safeParse(id).success || !gradeSchema.safeParse(grade).success) return { ok: false, error: "Unknown card." };

  const [card] = await db
    .select({ box: flashcards.box })
    .from(flashcards)
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  if (!card) return { ok: false, error: "That card was deleted." };

  const next = schedule(card.box, grade);
  await db
    .update(flashcards)
    .set({
      box: next.box,
      dueAt: next.dueAt,
      reviews: sql`${flashcards.reviews} + 1`,
      lapses: next.lapse ? sql`${flashcards.lapses} + 1` : flashcards.lapses,
      lastReviewedAt: new Date(),
    })
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  return { ok: true, box: next.box, dueAt: next.dueAt.toISOString() };
}

const textSchema = z.string().trim().max(2000);

export async function updateCard(id: string, front: string, back: string): Promise<Result> {
  const user = await member();
  if (!user) return { ok: false, error: "Sign in with a membership to edit cards." };
  const f = textSchema.safeParse(front);
  const b = textSchema.safeParse(back);
  if (!idSchema.safeParse(id).success || !f.success || !b.success) return { ok: false, error: "Check the card's text." };
  const [card] = await db
    .select({ imageSide: flashcards.imageSide })
    .from(flashcards)
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  if (!card) return { ok: false, error: "That card was deleted." };
  if ((!f.data && card.imageSide !== "front") || (!b.data && card.imageSide !== "back")) {
    return { ok: false, error: "Put something on both sides of the card." };
  }
  await db
    .update(flashcards)
    .set({ front: f.data, back: b.data })
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  refresh();
  return { ok: true };
}

export async function deleteCard(id: string): Promise<Result> {
  const user = await member();
  if (!user) return { ok: false, error: "Sign in with a membership to manage cards." };
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Unknown card." };
  await db.delete(flashcards).where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  refresh();
  return { ok: true };
}

/** Start a card over as new (due now). */
export async function resetCard(id: string): Promise<Result> {
  const user = await member();
  if (!user) return { ok: false, error: "Sign in with a membership to manage cards." };
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Unknown card." };
  await db
    .update(flashcards)
    .set({ box: 0, dueAt: new Date() })
    .where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id)));
  refresh();
  return { ok: true };
}
