"use server";

import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { drawingMembers, drawings, users, workspaces, type MemberRole } from "@/db/schema";
import { getCurrentSession, requireUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { avatarUrl } from "@/lib/profile/avatar";
import { getRole, type Role } from "@/lib/collab/access";
import { notify } from "@/lib/collab/notify";

/*
 * Sharing a drawing. Only members can open shared drawings ("members only"):
 * the owner turns on an invite link, anyone with a membership who opens it
 * joins with the link's role, and the owner can change roles or remove
 * people. Every change tells open editors to re-check access, so a removed
 * person's live view closes and a demoted editor becomes view-only at once.
 */

export type ShareMember = {
  userId: string;
  name: string;
  email: string | null;
  role: MemberRole;
  avatarUrl: string | null;
};

export type SharingState = (
  | {
      role: "owner";
      link: { token: string | null; role: MemberRole };
      members: ShareMember[];
    }
  | {
      role: Exclude<Role, "owner">;
      ownerId: string | null;
      ownerName: string | null;
      ownerAvatarUrl: string | null;
      members: ShareMember[];
    }
) & {
  /** The team workspace it's in: everyone there can open it too. */
  workspace: { id: string; name: string } | null;
};

export type SharingResult = { ok: true; state: SharingState } | { ok: false; error: string };

const idSchema = z.uuid();
const roleSchema = z.enum(["editor", "viewer"]);

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64urlNoPadding(bytes);
}

async function currentMember() {
  const { user } = await getCurrentSession();
  if (!user) return null;
  if (!(await getMembership(user.id)).isMember) return null;
  return user;
}

async function loadState(drawingId: string, userId: string): Promise<SharingState | null> {
  const role = await getRole(drawingId, userId);
  if (!role) return null;
  const [drawing] = await db
    .select({
      shareToken: drawings.shareToken,
      shareRole: drawings.shareRole,
      ownerId: drawings.userId,
      ownerName: users.name,
      ownerAvatarUpdatedAt: users.avatarUpdatedAt,
      workspaceId: drawings.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(drawings)
    .leftJoin(users, eq(users.id, drawings.userId))
    .leftJoin(workspaces, eq(workspaces.id, drawings.workspaceId))
    .where(eq(drawings.id, drawingId));
  if (!drawing) return null;
  const rows = await db
    .select({
      userId: drawingMembers.userId,
      name: users.name,
      email: users.email,
      role: drawingMembers.role,
      avatarUpdatedAt: users.avatarUpdatedAt,
    })
    .from(drawingMembers)
    .innerJoin(users, eq(users.id, drawingMembers.userId))
    .where(eq(drawingMembers.drawingId, drawingId))
    .orderBy(asc(drawingMembers.createdAt))
    .then((list) =>
      list.map(({ avatarUpdatedAt, ...m }) => ({ ...m, avatarUrl: avatarUrl(m.userId, avatarUpdatedAt) })),
    );
  const workspace = drawing.workspaceId ? { id: drawing.workspaceId, name: drawing.workspaceName ?? "a workspace" } : null;
  if (role === "owner") {
    return { role, link: { token: drawing.shareToken, role: drawing.shareRole }, members: rows, workspace };
  }
  // Collaborators see who else is there, but not their email addresses.
  return {
    role,
    ownerId: drawing.ownerId,
    ownerName: drawing.ownerName,
    ownerAvatarUrl: drawing.ownerId ? avatarUrl(drawing.ownerId, drawing.ownerAvatarUpdatedAt) : null,
    members: rows.map((m) => ({ ...m, email: null })),
    workspace,
  };
}

/** Sharing details for the dialog. */
export async function getSharing(drawingId: string): Promise<SharingResult> {
  const user = await currentMember();
  if (!user) return { ok: false, error: "Sign in with a membership to share drawings." };
  if (!idSchema.safeParse(drawingId).success) return { ok: false, error: "Drawing not found." };
  const state = await loadState(drawingId, user.id);
  return state ? { ok: true, state } : { ok: false, error: "Drawing not found." };
}

async function asOwner(drawingId: string, change: (userId: string) => Promise<void>): Promise<SharingResult> {
  const user = await currentMember();
  if (!user) return { ok: false, error: "Sign in with a membership to share drawings." };
  if (!idSchema.safeParse(drawingId).success) return { ok: false, error: "Drawing not found." };
  const role = await getRole(drawingId, user.id);
  if (!role) return { ok: false, error: "Drawing not found." };
  if (role !== "owner") return { ok: false, error: "Only the owner can change sharing." };
  await change(user.id);
  await notify({ t: "access", d: drawingId });
  const state = await loadState(drawingId, user.id);
  return state ? { ok: true, state } : { ok: false, error: "Drawing not found." };
}

/** Turn the invite link on (with a role) or off. Turning it off keeps who already joined. */
export async function setLinkSharing(drawingId: string, enabled: boolean, role: MemberRole): Promise<SharingResult> {
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { ok: false, error: "Unknown role." };
  return asOwner(drawingId, async () => {
    const [current] = await db.select({ token: drawings.shareToken }).from(drawings).where(eq(drawings.id, drawingId));
    await db
      .update(drawings)
      .set({ shareToken: enabled ? (current?.token ?? newToken()) : null, shareRole: parsedRole.data })
      .where(eq(drawings.id, drawingId));
  });
}

/** A new link; the old one stops working. */
export async function resetShareLink(drawingId: string): Promise<SharingResult> {
  return asOwner(drawingId, async () => {
    await db.update(drawings).set({ shareToken: newToken() }).where(eq(drawings.id, drawingId));
  });
}

export async function setMemberRole(drawingId: string, userId: string, role: MemberRole): Promise<SharingResult> {
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success || !idSchema.safeParse(userId).success) return { ok: false, error: "Unknown person or role." };
  return asOwner(drawingId, async () => {
    await db
      .update(drawingMembers)
      .set({ role: parsedRole.data })
      .where(and(eq(drawingMembers.drawingId, drawingId), eq(drawingMembers.userId, userId)));
  });
}

export async function removeMember(drawingId: string, userId: string): Promise<SharingResult> {
  if (!idSchema.safeParse(userId).success) return { ok: false, error: "Unknown person." };
  return asOwner(drawingId, async () => {
    await db
      .delete(drawingMembers)
      .where(and(eq(drawingMembers.drawingId, drawingId), eq(drawingMembers.userId, userId)));
  });
}

/** Leave a drawing someone shared with you. */
export async function leaveDrawing(drawingId: string) {
  const user = await requireUser();
  if (!idSchema.safeParse(drawingId).success) redirect("/");
  await db
    .delete(drawingMembers)
    .where(and(eq(drawingMembers.drawingId, drawingId), eq(drawingMembers.userId, user.id)));
  await notify({ t: "access", d: drawingId });
  redirect("/");
}

/** Join with an invite link (the form on /join/[token]). */
export async function joinDrawing(token: string) {
  const user = await requireUser();
  if (!(await getMembership(user.id)).isMember) redirect(`/join/${encodeURIComponent(token)}`);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) redirect(`/join/${encodeURIComponent(token)}`);
  const [drawing] = await db
    .select({ id: drawings.id, ownerId: drawings.userId, shareRole: drawings.shareRole })
    .from(drawings)
    .where(eq(drawings.shareToken, token));
  // The page explains a link that stopped working.
  if (!drawing) redirect(`/join/${encodeURIComponent(token)}`);
  if (drawing.ownerId !== user.id) {
    await db
      .insert(drawingMembers)
      .values({ drawingId: drawing.id, userId: user.id, role: drawing.shareRole })
      .onConflictDoNothing();
  }
  redirect(`/drawings/${drawing.id}`);
}
