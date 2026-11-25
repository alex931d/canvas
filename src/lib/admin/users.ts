import "server-only";

import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  auditEvents,
  oauthAccounts,
  sessions,
  subscriptions,
  userTwoFactor,
  users,
  type AuditAction,
} from "@/db/schema";
import { avatarUrl } from "@/lib/profile/avatar";
import type { Role } from "@/lib/auth/roles";
import type { AdminQuery } from "./query";
import { readMembership } from "@/lib/billing/membership";

/*
 * Reads for the admin dashboard (/admin). Everything here assumes the caller
 * has already checked the viewer's permission (src/lib/auth/session.ts
 * requirePermission).
 */

export const PAGE_SIZE = 10;

const MEMBER_STATUSES = sql`('active', 'trialing', 'past_due')`;
// Spelled out with its table: inside these subqueries a bare "id" would mean the subquery's own.
const USER_ID = sql.raw(`"users"."id"`);
const isMember = sql<boolean>`exists (select 1 from ${subscriptions} s where s.user_id = ${USER_ID} and s.status in ${MEMBER_STATUSES})`;
const hasComp = sql<boolean>`exists (select 1 from ${subscriptions} s where s.user_id = ${USER_ID} and s.status in ${MEMBER_STATUSES} and s.id like 'comp\\_%')`;
const hadOne = sql<boolean>`exists (select 1 from ${subscriptions} s where s.user_id = ${USER_ID})`;
const lastActive = sql<Date | null>`(select max(se.last_verified_at) from ${sessions} se where se.user_id = ${USER_ID})`;

function filters(query: AdminQuery): SQL | undefined {
  const where: SQL[] = [];
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
  }
  if (query.role) where.push(eq(users.role, query.role));
  if (query.status === "members") where.push(isMember);
  if (query.status === "unconfirmed") where.push(eq(users.emailVerified, false));
  if (query.status === "staff") where.push(ne(users.role, "user"));
  return where.length ? and(...where) : undefined;
}

export type MembershipLabel = "paid" | "complimentary" | "ended" | "none";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  avatarUrl: string | null;
  membership: MembershipLabel;
  createdAt: Date;
  lastActiveAt: Date | null;
};

/** One page of accounts, newest first, plus the totals the pager needs. */
export async function searchUsers(query: AdminQuery) {
  const where = filters(query);
  const [{ total }] = await db.select({ total: count() }).from(users).where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailVerified: users.emailVerified,
      avatarUpdatedAt: users.avatarUpdatedAt,
      createdAt: users.createdAt,
      isMember,
      hasComp,
      hadOne,
      lastActiveAt: lastActive,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    total,
    page,
    pageCount,
    rows: rows.map(
      (r): UserRow => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        emailVerified: r.emailVerified,
        avatarUrl: avatarUrl(r.id, r.avatarUpdatedAt),
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt) : null,
        membership: r.hasComp ? "complimentary" : r.isMember ? "paid" : r.hadOne ? "ended" : "none",
      }),
    ),
  };
}

/** Counts for the cards above the table. */
export async function userStats() {
  const [row] = await db
    .select({
      accounts: count(),
      members: sql<number>`count(*) filter (where ${isMember})`.mapWith(Number),
      unconfirmed: sql<number>`count(*) filter (where not ${users.emailVerified})`.mapWith(Number),
      staff: sql<number>`count(*) filter (where ${users.role} <> 'user')`.mapWith(Number),
    })
    .from(users);
  return row;
}

const actors = alias(users, "actors");

/** Everything the edit panel shows about one account, or null if it doesn't exist. */
export async function userDetail(id: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailVerified: users.emailVerified,
      stripeCustomerId: users.stripeCustomerId,
      avatarUpdatedAt: users.avatarUpdatedAt,
      level: users.level,
      createdAt: users.createdAt,
      lastActiveAt: lastActive,
      sessionCount: sql<number>`(select count(*) from ${sessions} se where se.user_id = ${USER_ID})`.mapWith(Number),
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      twoFactorOn: sql<boolean>`exists (select 1 from ${userTwoFactor} tf where tf.user_id = ${USER_ID} and tf.enabled_at is not null)`,
      googleEmail: sql<string | null>`(select oa.email from ${oauthAccounts} oa where oa.user_id = ${USER_ID} and oa.provider = 'google')`,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!user) return null;
  const [membership, history] = await Promise.all([
    readMembership(id),
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        details: auditEvents.details,
        createdAt: auditEvents.createdAt,
        actorName: actors.name,
        actorId: auditEvents.actorId,
      })
      .from(auditEvents)
      .leftJoin(actors, eq(actors.id, auditEvents.actorId))
      .where(eq(auditEvents.userId, id))
      .orderBy(desc(auditEvents.createdAt))
      .limit(20),
  ]);
  return {
    ...user,
    avatarUrl: avatarUrl(user.id, user.avatarUpdatedAt),
    lastActiveAt: user.lastActiveAt ? new Date(user.lastActiveAt) : null,
    membership,
    history,
  };
}

export type UserDetail = NonNullable<Awaited<ReturnType<typeof userDetail>>>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Records what staff did, inside the same transaction as the change. */
export async function audit(
  tx: typeof db | Tx,
  actorId: string | null,
  userId: string,
  action: AuditAction,
  details: Record<string, unknown> = {},
) {
  await tx.insert(auditEvents).values({ actorId, userId, action, details });
}
