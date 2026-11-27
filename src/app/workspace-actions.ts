"use server";

import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { and, eq, gt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { drawings, users, workspaceInvites, workspaceMembers, workspaces, type MemberRole } from "@/db/schema";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession, requireUser, type SessionUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { notify } from "@/lib/collab/notify";
import { sendEmailLater } from "@/lib/email/send";
import { workspaceInviteEmail } from "@/lib/email/templates";
import { emailLinkOrigin } from "@/lib/site-url";
import {
  assignableRoles,
  canEditInWorkspace,
  canManageMember,
  canManageWorkspace,
  type WorkspaceRole,
} from "@/lib/workspaces/roles";

/*
 * Team workspaces. Server Actions are public endpoints, so each one checks
 * the session, the membership and the person's role in the workspace itself.
 * Anything that changes who may see a workspace's drawings tells their open
 * editors to re-check access (a removed person's view closes at once).
 */

export type WorkspaceResult = { ok: true } | { ok: false; error: string };

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1, "Give the workspace a name.").max(60, "Names can be up to 60 characters.");
const memberRoleSchema = z.enum(["editor", "viewer"]);
const workspaceRoleSchema = z.enum(["admin", "editor", "viewer"]);
const emailSchema = z.email("That doesn't look like an email address.").max(254);

const INVITE_DAYS = 14;
const SIGNED_OUT: WorkspaceResult = { ok: false, error: "Sign in with a membership to use workspaces." };
const NOT_FOUND: WorkspaceResult = { ok: false, error: "Workspace not found." };
const TOO_FAST_MESSAGE = "That's a lot of changes at once. Wait a moment and try again.";
const TOO_FAST: WorkspaceResult = { ok: false, error: TOO_FAST_MESSAGE };

function newToken(bytes = 24) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return encodeBase64urlNoPadding(b);
}
const hashToken = (token: string) => Buffer.from(sha256(new TextEncoder().encode(token)));

async function signedInMember() {
  const { user } = await getCurrentSession();
  if (!user) return null;
  return (await getMembership(user.id)).isMember ? user : null;
}

async function roleIn(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

/** Open editors of the workspace's drawings re-check who may see them. */
async function recheckDrawings(workspaceId: string, ids?: string[]) {
  const list =
    ids ?? (await db.select({ id: drawings.id }).from(drawings).where(eq(drawings.workspaceId, workspaceId))).map((d) => d.id);
  await Promise.all(list.map((d) => notify({ t: "access", d })));
}

/** Run a change as one of the workspace's owner or admins. A string from `change` is an error to show. */
async function asManager(
  workspaceId: string,
  change: (user: SessionUser, role: WorkspaceRole) => Promise<string | void>,
): Promise<WorkspaceResult> {
  const user = await signedInMember();
  if (!user) return SIGNED_OUT;
  if (!idSchema.safeParse(workspaceId).success) return NOT_FOUND;
  const role = await roleIn(workspaceId, user.id);
  if (!role) return NOT_FOUND;
  if (!canManageWorkspace(role)) return { ok: false, error: "Only the workspace's owner and admins can do that." };
  if (!(await limiters.workspacesByUser.consume(user.id)).ok) return TOO_FAST;
  const error = await change(user, role);
  if (error) return { ok: false, error };
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ the workspace

export type CreateWorkspaceState = { error?: string; name?: string };

/** The New workspace form: you're its owner, and it opens. */
export async function createWorkspace(_prev: CreateWorkspaceState, form: FormData): Promise<CreateWorkspaceState> {
  const user = await signedInMember();
  if (!user) return { error: "Sign in with a membership to use workspaces." };
  const parsed = nameSchema.safeParse(form.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, name: String(form.get("name") ?? "") };
  if (!(await limiters.workspacesByUser.consume(user.id)).ok) return { error: TOO_FAST_MESSAGE, name: parsed.data };
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(workspaces).values({ name: parsed.data }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: row.id, userId: user.id, role: "owner" });
    return row.id;
  });
  redirect(`/workspaces/${id}`);
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceResult> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return asManager(workspaceId, async () => {
    await db.update(workspaces).set({ name: parsed.data }).where(eq(workspaces.id, workspaceId));
  });
}

/** Only the owner, and its drawings go back to the people who made them. */
export async function deleteWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const user = await signedInMember();
  if (!user) return SIGNED_OUT;
  if (!idSchema.safeParse(workspaceId).success) return NOT_FOUND;
  const role = await roleIn(workspaceId, user.id);
  if (!role) return NOT_FOUND;
  if (role !== "owner") return { ok: false, error: "Only the owner can delete the workspace." };
  const ids = (await db.select({ id: drawings.id }).from(drawings).where(eq(drawings.workspaceId, workspaceId))).map((d) => d.id);
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId)); // drawings.workspace_id is set to null
  await recheckDrawings(workspaceId, ids);
  redirect("/workspaces");
}

/** Anyone but the owner can leave (the owner deletes it instead). */
export async function leaveWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const user = await signedInMember();
  if (!user) return SIGNED_OUT;
  if (!idSchema.safeParse(workspaceId).success) return NOT_FOUND;
  const role = await roleIn(workspaceId, user.id);
  if (!role) return NOT_FOUND;
  if (role === "owner") return { ok: false, error: "The owner can't leave; delete the workspace instead." };
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)));
  await recheckDrawings(workspaceId);
  redirect("/workspaces");
}

// ------------------------------------------------------------ people

export async function setWorkspaceMemberRole(workspaceId: string, userId: string, role: string): Promise<WorkspaceResult> {
  const parsed = workspaceRoleSchema.safeParse(role);
  if (!parsed.success || !idSchema.safeParse(userId).success) return { ok: false, error: "Unknown person or role." };
  return asManager(workspaceId, async (me, myRole) => {
    const target = await roleIn(workspaceId, userId);
    if (!target) return "They're not in this workspace any more.";
    if (userId === me.id || !canManageMember(myRole, target) || !assignableRoles(myRole).includes(parsed.data)) {
      return myRole === "admin" ? "Admins can change editors and viewers; the owner decides who's an admin." : "You can't change that.";
    }
    await db
      .update(workspaceMembers)
      .set({ role: parsed.data })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    await recheckDrawings(workspaceId);
  });
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceResult> {
  if (!idSchema.safeParse(userId).success) return { ok: false, error: "Unknown person." };
  return asManager(workspaceId, async (me, myRole) => {
    const target = await roleIn(workspaceId, userId);
    if (!target) return;
    if (userId === me.id || !canManageMember(myRole, target)) return "You can't remove them.";
    await db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    await recheckDrawings(workspaceId);
  });
}

// ------------------------------------------------------------ inviting

/** Turn the invite link on (with the role it gives) or off. Turning it off keeps who already joined. */
export async function setWorkspaceLink(workspaceId: string, enabled: boolean, role: MemberRole): Promise<WorkspaceResult> {
  const parsed = memberRoleSchema.safeParse(role);
  if (!parsed.success) return { ok: false, error: "Unknown role." };
  return asManager(workspaceId, async () => {
    const [current] = await db.select({ token: workspaces.inviteToken }).from(workspaces).where(eq(workspaces.id, workspaceId));
    await db
      .update(workspaces)
      .set({ inviteToken: enabled ? (current?.token ?? newToken()) : null, inviteRole: parsed.data })
      .where(eq(workspaces.id, workspaceId));
  });
}

/** A new link; the old one stops working. */
export async function resetWorkspaceLink(workspaceId: string): Promise<WorkspaceResult> {
  return asManager(workspaceId, async () => {
    await db.update(workspaces).set({ inviteToken: newToken() }).where(eq(workspaces.id, workspaceId));
  });
}

/** Email someone a link to join, for 14 days, with a role. Inviting the same address again sends a fresh link. */
export async function inviteToWorkspace(workspaceId: string, email: string, role: MemberRole): Promise<WorkspaceResult> {
  const parsedEmail = emailSchema.safeParse(email.trim());
  const parsedRole = memberRoleSchema.safeParse(role);
  if (!parsedEmail.success) return { ok: false, error: parsedEmail.error.issues[0].message };
  if (!parsedRole.success) return { ok: false, error: "Unknown role." };
  const address = parsedEmail.data.toLowerCase();
  return asManager(workspaceId, async (me) => {
    if (!(await limiters.invitesByUser.consume(me.id)).ok) return "You've sent a lot of invitations. Wait a minute and try again.";
    const origin = await emailLinkOrigin();
    if (!origin) {
      console.error("[email] Set APP_URL to this site's address so invitations can link to it. No invitation was sent.");
      return "Invitations can't be emailed until the site's address (APP_URL) is set. Use the invite link instead.";
    }
    const [already] = await db
      .select({ name: users.name })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${users.email}) = ${address}`));
    if (already) return `${already.name} is already in this workspace.`;

    const token = newToken(32);
    const expiresAt = sql`now() + make_interval(days => ${INVITE_DAYS})`;
    await db
      .insert(workspaceInvites)
      .values({ workspaceId, email: address, role: parsedRole.data, tokenHash: hashToken(token), invitedBy: me.id, expiresAt })
      .onConflictDoUpdate({
        target: [workspaceInvites.workspaceId, workspaceInvites.email],
        set: { role: parsedRole.data, tokenHash: hashToken(token), invitedBy: me.id, createdAt: sql`now()`, expiresAt },
      });
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
    sendEmailLater({
      to: address,
      ...workspaceInviteEmail({
        inviter: me.name,
        workspace: ws?.name ?? "a workspace",
        role: parsedRole.data,
        link: `${origin}/join/workspace/${token}`,
      }),
    }, { priority: "normal", kind: "workspace invite" });
  });
}

export async function revokeWorkspaceInvite(workspaceId: string, inviteId: string): Promise<WorkspaceResult> {
  if (!idSchema.safeParse(inviteId).success) return { ok: false, error: "Unknown invitation." };
  return asManager(workspaceId, async () => {
    await db
      .delete(workspaceInvites)
      .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, workspaceId)));
  });
}

// ------------------------------------------------------------ joining

async function addMember(workspaceId: string, userId: string, role: MemberRole) {
  await db.insert(workspaceMembers).values({ workspaceId, userId, role }).onConflictDoNothing();
  await db.update(workspaces).set({ updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
}

/**
 * Join with a link (the form on /join/workspace/[token]): the workspace's
 * invite link, or an emailed invitation for this account's confirmed address.
 * Anything that doesn't work goes back to the page, which says why.
 */
export async function joinWorkspace(token: string) {
  const user = await requireUser();
  const back = `/join/workspace/${encodeURIComponent(token)}`;
  if (!(await getMembership(user.id)).isMember) redirect(back);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) redirect(back);

  const [byLink] = await db
    .select({ id: workspaces.id, role: workspaces.inviteRole })
    .from(workspaces)
    .where(eq(workspaces.inviteToken, token));
  if (byLink) {
    await addMember(byLink.id, user.id, byLink.role);
    redirect(`/workspaces/${byLink.id}`);
  }

  const [invite] = await db
    .select({ id: workspaceInvites.id, workspaceId: workspaceInvites.workspaceId, email: workspaceInvites.email, role: workspaceInvites.role })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.tokenHash, hashToken(token)), gt(workspaceInvites.expiresAt, sql`now()`)));
  if (!invite || !user.emailVerified || invite.email !== user.email.toLowerCase()) redirect(back);
  await addMember(invite.workspaceId, user.id, invite.role);
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
  redirect(`/workspaces/${invite.workspaceId}`);
}

/** Accept an invitation to your address from the Workspaces page (no link needed). */
export async function acceptWorkspaceInvite(inviteId: string) {
  const user = await requireUser();
  if (!idSchema.safeParse(inviteId).success || !(await getMembership(user.id)).isMember || !user.emailVerified) redirect("/workspaces");
  const [invite] = await db
    .select({ workspaceId: workspaceInvites.workspaceId, role: workspaceInvites.role })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.email, user.email.toLowerCase()),
        gt(workspaceInvites.expiresAt, sql`now()`),
      ),
    );
  if (!invite) redirect("/workspaces");
  await addMember(invite.workspaceId, user.id, invite.role);
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, inviteId));
  redirect(`/workspaces/${invite.workspaceId}`);
}

export async function declineWorkspaceInvite(inviteId: string): Promise<WorkspaceResult> {
  const user = await signedInMember();
  if (!user) return SIGNED_OUT;
  if (!idSchema.safeParse(inviteId).success) return { ok: false, error: "Unknown invitation." };
  await db
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.email, user.email.toLowerCase())));
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ drawings

/**
 * Put one of your drawings in a workspace you can edit in, or take it out
 * (null): its owner can, and so can the workspace's owner and admins, which
 * gives it back to the person who made it.
 */
export async function moveDrawing(drawingId: string, workspaceId: string | null): Promise<WorkspaceResult> {
  const user = await signedInMember();
  if (!user) return SIGNED_OUT;
  if (!idSchema.safeParse(drawingId).success) return { ok: false, error: "Drawing not found." };
  if (workspaceId !== null && !idSchema.safeParse(workspaceId).success) return NOT_FOUND;
  const [drawing] = await db
    .select({ ownerId: drawings.userId, workspaceId: drawings.workspaceId })
    .from(drawings)
    .where(eq(drawings.id, drawingId));
  if (!drawing) return { ok: false, error: "Drawing not found." };
  const owns = drawing.ownerId === user.id;
  const from = drawing.workspaceId ? await roleIn(drawing.workspaceId, user.id) : null;
  if (!owns && !(workspaceId === null && canManageWorkspace(from))) {
    return { ok: false, error: from || owns ? "Only the drawing's owner can move it." : "Drawing not found." };
  }
  if (workspaceId !== null) {
    const to = await roleIn(workspaceId, user.id);
    if (!to) return NOT_FOUND;
    if (!canEditInWorkspace(to)) return { ok: false, error: "You can view that workspace's drawings but not add to it." };
  }
  if (drawing.workspaceId === workspaceId) return { ok: true };
  await db.update(drawings).set({ workspaceId }).where(eq(drawings.id, drawingId));
  await notify({ t: "access", d: drawingId });
  refresh();
  return { ok: true };
}
