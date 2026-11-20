"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { limiters } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { readMembership } from "@/lib/billing/membership";
import { BillingNotConfiguredError, priceId, stripe } from "@/lib/billing/stripe";
import { getOrCreateCustomerId } from "@/lib/billing/sync";
import { siteOrigin } from "@/lib/site-url";

export type BillingActionState = { error?: string };

function failure(err: unknown, what: string): BillingActionState {
  if (err instanceof BillingNotConfiguredError) {
    console.error("[billing]", err.message);
    return { error: "Memberships aren't available right now. Please try again later." };
  }
  console.error(`[billing] couldn't ${what}:`, err);
  return { error: `We couldn't reach our payment provider to ${what}. Please try again.` };
}

function tooMany(userId: string): BillingActionState | null {
  if (limiters.billingByUser.consume(userId)) return null;
  return { error: `Too many tries in a row. Wait ${limiters.billingByUser.retryAfter(userId)} seconds and try again.` };
}

/** Sends the signed-in user to Stripe Checkout to start (or restart) their membership. */
export async function startMembership(): Promise<BillingActionState> {
  const user = await requireUser();
  if ((await readMembership(user.id)).isMember) redirect("/");
  const limited = tooMany(user.id);
  if (limited) return limited;

  let url: string | null;
  try {
    const origin = await siteOrigin();
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: await getOrCreateCustomerId(user),
      client_reference_id: user.id,
      line_items: [{ price: priceId(), quantity: 1 }],
      subscription_data: { metadata: { userId: user.id } },
      allow_promotion_codes: true,
      success_url: `${origin}/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?checkout=canceled`,
    });
    url = session.url;
  } catch (err) {
    return failure(err, "start your membership");
  }
  if (!url) return { error: "Stripe didn't return a checkout page. Please try again." };
  redirect(url);
}

/** Opens Stripe's billing portal, where members update their card, see invoices or cancel. */
export async function manageBilling(): Promise<BillingActionState> {
  const user = await requireUser();
  const [row] = await db
    .select({ customerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.customerId) return { error: "There's no billing account for you yet." };
  const limited = tooMany(user.id);
  if (limited) return limited;

  let url: string;
  try {
    const origin = await siteOrigin();
    const portal = await stripe().billingPortal.sessions.create({
      customer: row.customerId,
      return_url: `${origin}/membership`,
    });
    url = portal.url;
  } catch (err) {
    return failure(err, "open billing");
  }
  redirect(url);
}
