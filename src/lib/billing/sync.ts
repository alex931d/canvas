import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { stripe } from "./stripe";

/*
 * Glue between Stripe and the database. Stripe is the source of truth for
 * memberships; the subscriptions table is a copy that pages can read without
 * calling Stripe.
 *
 * Rather than applying each webhook's payload (events can arrive late, twice
 * or out of order), every relevant event just triggers `syncStripeCustomer`,
 * which fetches the customer's subscriptions from Stripe and stores them.
 */

/** The user's Stripe customer, created the first time they start a membership. */
export async function getOrCreateCustomerId(user: SessionUser): Promise<string> {
  const [row] = await db
    .select({ customerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (row?.customerId) return row.customerId;

  // The idempotency key makes a double-click or a retry return the same customer.
  const customer = await stripe().customers.create(
    { email: user.email, name: user.name, metadata: { userId: user.id } },
    { idempotencyKey: `canvas-customer-${user.id}` },
  );
  await linkCustomer(user.id, customer.id);
  const [linked] = await db
    .select({ customerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  return linked?.customerId ?? customer.id;
}

/** Records the customer on the user, unless they already have one. */
async function linkCustomer(userId: string, customerId: string) {
  await db
    .update(users)
    .set({ stripeCustomerId: customerId })
    .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)));
}

function toRow(userId: string, customerId: string, sub: Stripe.Subscription) {
  // Since API version 2025-03-31.basil the billing period lives on the items.
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000) : sub.cancel_at_period_end ? periodEnd : null;
  return {
    id: sub.id,
    userId,
    customerId,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: periodEnd,
    cancelAt,
    endedAt: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
  };
}

/**
 * Copies a customer's subscriptions from Stripe into the database. Safe to
 * call any number of times. `hintUserId` links a customer the database doesn't
 * know yet (from Checkout's client_reference_id or the subscription metadata).
 */
export async function syncStripeCustomer(customerId: string, hintUserId?: string | null): Promise<void> {
  const list = await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });

  let [owner] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);

  if (!owner) {
    const candidate = [hintUserId, ...list.data.map((s) => s.metadata?.userId)].find(
      (id): id is string => z.uuid().safeParse(id).success,
    );
    if (candidate) {
      await linkCustomer(candidate, customerId);
      [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, candidate), eq(users.stripeCustomerId, customerId)))
        .limit(1);
    }
  }
  if (!owner) {
    console.warn(`[billing] Stripe customer ${customerId} doesn't belong to any account; ignoring.`);
    return;
  }

  for (const sub of list.data) {
    const row = toRow(owner.id, customerId, sub);
    await db
      .insert(subscriptions)
      .values(row)
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: {
          status: row.status,
          priceId: row.priceId,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAt: row.cancelAt,
          endedAt: row.endedAt,
          updatedAt: new Date(),
        },
      });
  }
}
