import "server-only";

import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { subscriptions, type Subscription } from "@/db/schema";
import { getCurrentSession, requireUser, type SessionUser } from "@/lib/auth/session";
import type { Plan } from "./plan";

/**
 * Subscription statuses that keep someone a member. `past_due` means Stripe
 * is still retrying a failed renewal; access continues until it gives up and
 * the status becomes `canceled` or `unpaid`.
 */
export const MEMBER_STATUS_LIST = ["active", "trialing", "past_due"];
const MEMBER_STATUSES = new Set(MEMBER_STATUS_LIST);

export type Membership = {
  isMember: boolean;
  /** The subscription that makes them a member, or else their most recent one. */
  subscription: Subscription | null;
  complimentary: boolean;
};

async function loadMembership(userId: string): Promise<Membership> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
  const current = rows.find((r) => MEMBER_STATUSES.has(r.status)) ?? null;
  const subscription = current ?? rows[0] ?? null;
  return {
    isMember: current !== null,
    subscription,
    complimentary: subscription?.id.startsWith("comp_") ?? false,
  };
}

/** Once per request. Use `readMembership` after changing it in the same request. */
export const getMembership = cache(loadMembership);
export const readMembership = loadMembership;

/**
 * For pages and Server Actions that are part of the membership: the signed-in
 * member, or a redirect (to /login, or to /pricing to join or renew).
 */
export async function requireMember(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await getMembership(user.id)).isMember) redirect("/pricing");
  return user;
}

/** For API routes: a JSON 402 when the user isn't a member, else null. */
export async function membershipRequiredResponse(userId: string, what: string): Promise<Response | null> {
  if ((await getMembership(userId)).isMember) return null;
  return Response.json({ error: `${what} are part of the membership.` }, { status: 402 });
}

/**
 * Who's looking and what they can use, for pages anyone can open (the free
 * plan's pages need no account): null and "free" when signed out.
 */
export async function getViewerPlan(): Promise<{ user: SessionUser | null; plan: Plan }> {
  const { user } = await getCurrentSession();
  if (!user) return { user: null, plan: "free" };
  return { user, plan: (await getMembership(user.id)).isMember ? "member" : "free" };
}
