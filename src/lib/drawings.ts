import "server-only";

import { count, desc, eq, sql } from "drizzle-orm";
import { io } from "next/cache";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/db";
import { assets, drawingMembers, drawings, users, workspaces, type MemberRole } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { requireMember } from "@/lib/billing/membership";
import { getRole } from "@/lib/collab/access";
import { normalizeDrawing, normalizePresentation } from "@/lib/canvas/schema";

/**
 * Read-side data access layer. Every function resolves the signed-in user
 * itself and only returns drawings that user owns or was invited to, so
 * callers can't ask for anyone else's. Drawings are part of the membership:
 * non-members are sent to /membership. Mutations live in src/app/actions.ts,
 * src/app/sharing-actions.ts and src/app/api.
 *
 * Reading the session cookie makes these per-request: they run inside
 * <Suspense> boundaries (Cache Components).
 */

export type DrawingSummary = {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: Date;
  /** Number of people it's shared with. */
  members: number;
  /** An invite link is active. */
  linkShared: boolean;
  /** The team workspace it's in, if any. */
  workspace: { id: string; name: string } | null;
};

export async function listDrawings(): Promise<DrawingSummary[]> {
  await io();
  const user = await requireMember();
  return db
    .select({
      id: drawings.id,
      title: drawings.title,
      thumbnail: drawings.thumbnail,
      updatedAt: drawings.updatedAt,
      members: sql<number>`(select count(*)::int from ${drawingMembers} where ${drawingMembers.drawingId} = ${drawings.id})`,
      linkShared: sql<boolean>`${drawings.shareToken} is not null`,
      workspaceId: drawings.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(drawings)
    .leftJoin(workspaces, eq(workspaces.id, drawings.workspaceId))
    .where(eq(drawings.userId, user.id))
    .orderBy(desc(drawings.updatedAt))
    .then((rows) =>
      rows.map(({ workspaceId, workspaceName, ...d }) => ({
        ...d,
        workspace: workspaceId ? { id: workspaceId, name: workspaceName ?? "Workspace" } : null,
      })),
    );
}

export type SharedDrawingSummary = {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: Date;
  role: MemberRole;
  ownerName: string | null;
};

/** Drawings other people shared with the signed-in user. */
export async function listSharedWithMe(): Promise<SharedDrawingSummary[]> {
  await io();
  const user = await requireMember();
  return db
    .select({
      id: drawings.id,
      title: drawings.title,
      thumbnail: drawings.thumbnail,
      updatedAt: drawings.updatedAt,
      role: drawingMembers.role,
      ownerName: users.name,
    })
    .from(drawingMembers)
    .innerJoin(drawings, eq(drawings.id, drawingMembers.drawingId))
    .leftJoin(users, eq(users.id, drawings.userId))
    .where(eq(drawingMembers.userId, user.id))
    .orderBy(desc(drawings.updatedAt));
}

/**
 * The drawings still in the signed-in user's account, for after a membership
 * ends (they can move them into their browser before they're deleted).
 */
export async function listKeptDrawings(): Promise<{ id: string; title: string; thumbnail: string | null; updatedAt: Date }[]> {
  await io();
  const user = await requireUser();
  return db
    .select({ id: drawings.id, title: drawings.title, thumbnail: drawings.thumbnail, updatedAt: drawings.updatedAt })
    .from(drawings)
    .where(eq(drawings.userId, user.id))
    .orderBy(desc(drawings.updatedAt));
}

export async function countImages(): Promise<number> {
  await io();
  const user = await requireMember();
  const [row] = await db
    .select({ n: count() })
    .from(assets)
    .innerJoin(drawings, eq(drawings.id, assets.drawingId))
    .where(eq(drawings.userId, user.id));
  return row?.n ?? 0;
}

/**
 * A drawing the signed-in user owns or was invited to, with their role, or
 * null (also for drawings they have no access to).
 */
export const getDrawing = cache(async (id: string) => {
  await io();
  const user = await requireMember();
  // Postgres rejects malformed UUIDs with an error; treat them as "not found".
  if (!z.uuid().safeParse(id).success) return null;
  const role = await getRole(id, user.id);
  if (!role) return null;
  const [row] = await db
    .select({
      id: drawings.id,
      title: drawings.title,
      data: drawings.data,
      presentation: drawings.presentation,
      version: drawings.version,
      updatedAt: drawings.updatedAt,
      ownerName: users.name,
    })
    .from(drawings)
    .leftJoin(users, eq(users.id, drawings.userId))
    .where(eq(drawings.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, data: normalizeDrawing(row.data), presentation: normalizePresentation(row.presentation), user, role };
});
