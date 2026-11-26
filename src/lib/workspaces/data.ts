import "server-only";

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { io } from "next/cache";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/db";
import { drawings, users, workspaceInvites, workspaceMembers, workspaces, type MemberRole } from "@/db/schema";
import { requireMember } from "@/lib/billing/membership";
import { avatarUrl } from "@/lib/profile/avatar";
import { canManageWorkspace, type WorkspaceRole } from "./roles";

/*
 * Reading team workspaces. Like src/lib/drawings.ts, every function resolves
 * the signed-in member itself and only returns workspaces they're in.
 * Changes live in src/app/workspace-actions.ts.
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  members: number;
  drawings: number;
};

/** The workspaces the signed-in member is in, most recently active first. */
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  await io();
  const user = await requireMember();
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      members: sql<number>`(select count(*)::int from ${workspaceMembers} m where m.workspace_id = ${workspaces.id})`,
      drawings: sql<number>`(select count(*)::int from ${drawings} d where d.workspace_id = ${workspaces.id})`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .orderBy(desc(workspaces.updatedAt), asc(workspaces.name));
}

export type WorkspaceMember = {
  userId: string;
  name: string;
  /** Only for owners and admins. */
  email: string | null;
  role: WorkspaceRole;
  avatarUrl: string | null;
};

export type WorkspaceInvite = { id: string; email: string; role: MemberRole; invitedBy: string | null; expiresAt: Date };

export type WorkspaceDrawing = {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: Date;
  ownerId: string | null;
  ownerName: string | null;
};

export type WorkspaceView = {
  id: string;
  name: string;
  role: WorkspaceRole;
  /** The invite link (owners and admins only): its token while it's on, and the role it gives. */
  link: { token: string | null; role: MemberRole } | null;
  members: WorkspaceMember[];
  /** Emailed invitations not yet accepted (owners and admins only). */
  invites: WorkspaceInvite[];
  drawings: WorkspaceDrawing[];
};

/** One workspace with its people and drawings, or null if the member isn't in it (or it doesn't exist). */
export const getWorkspace = cache(async (id: string): Promise<WorkspaceView | null> => {
  await io();
  const user = await requireMember();
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      inviteToken: workspaces.inviteToken,
      inviteRole: workspaces.inviteRole,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, user.id)))
    .where(eq(workspaces.id, id))
    .limit(1);
  if (!row) return null;
  const manager = canManageWorkspace(row.role);

  const [members, invites, list] = await Promise.all([
    db
      .select({
        userId: workspaceMembers.userId,
        name: users.name,
        email: users.email,
        role: workspaceMembers.role,
        avatarUpdatedAt: users.avatarUpdatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, id))
      .orderBy(
        sql`case ${workspaceMembers.role} when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end`,
        asc(workspaceMembers.createdAt),
      ),
    manager
      ? db
          .select({
            id: workspaceInvites.id,
            email: workspaceInvites.email,
            role: workspaceInvites.role,
            invitedBy: users.name,
            expiresAt: workspaceInvites.expiresAt,
          })
          .from(workspaceInvites)
          .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
          .where(and(eq(workspaceInvites.workspaceId, id), gt(workspaceInvites.expiresAt, sql`now()`)))
          .orderBy(desc(workspaceInvites.createdAt))
      : Promise.resolve([]),
    db
      .select({
        id: drawings.id,
        title: drawings.title,
        thumbnail: drawings.thumbnail,
        updatedAt: drawings.updatedAt,
        ownerId: drawings.userId,
        ownerName: users.name,
      })
      .from(drawings)
      .leftJoin(users, eq(users.id, drawings.userId))
      .where(eq(drawings.workspaceId, id))
      .orderBy(desc(drawings.updatedAt)),
  ]);

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    link: manager ? { token: row.inviteToken, role: row.inviteRole } : null,
    // Only owners and admins see email addresses.
    members: members.map(({ avatarUpdatedAt, ...m }) => ({
      ...m,
      email: manager ? m.email : null,
      avatarUrl: avatarUrl(m.userId, avatarUpdatedAt),
    })),
    invites,
    drawings: list,
  };
});

export type InvitationForMe = { id: string; workspaceName: string; role: MemberRole; invitedBy: string | null };

/** Emailed invitations to the signed-in member's (confirmed) address, still open. */
export async function invitationsForMe(): Promise<InvitationForMe[]> {
  await io();
  const user = await requireMember();
  if (!user.emailVerified) return [];
  const rows = await db
    .select({
      id: workspaceInvites.id,
      workspaceId: workspaceInvites.workspaceId,
      workspaceName: workspaces.name,
      role: workspaceInvites.role,
      invitedBy: users.name,
      already: sql<boolean>`exists (select 1 from ${workspaceMembers} m where m.workspace_id = ${workspaceInvites.workspaceId} and m.user_id = ${user.id})`,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(and(eq(workspaceInvites.email, user.email.toLowerCase()), gt(workspaceInvites.expiresAt, sql`now()`)))
    .orderBy(desc(workspaceInvites.createdAt));
  return rows.filter((r) => !r.already).map(({ id, workspaceName, role, invitedBy }) => ({ id, workspaceName, role, invitedBy }));
}
