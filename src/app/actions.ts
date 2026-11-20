"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { drawings } from "@/db/schema";
import { getCurrentSession, requireUser } from "@/lib/auth/session";
import { getMembership, requireMember } from "@/lib/billing/membership";
import { emptyDrawing, titleSchema } from "@/lib/canvas/schema";
import { canEdit, getRole } from "@/lib/collab/access";
import { notify } from "@/lib/collab/notify";

/*
 * Server Actions are public HTTP endpoints: each one checks the session and
 * the user's role on the drawing itself (src/lib/collab/access.ts). Inputs
 * are validated, never trusted. Drawing content is saved through
 * /api/drawings/[id]/changes, not here.
 */

const idSchema = z.uuid();

export type SaveResult =
  { ok: true; updatedAt: string } | { ok: false; error: string; signedOut?: boolean; membershipEnded?: boolean };

const SIGNED_OUT: SaveResult = {
  ok: false,
  signedOut: true,
  error: "You've been signed out. Your changes are kept in this browser; sign in again to sync them.",
};

const MEMBERSHIP_ENDED: SaveResult = {
  ok: false,
  membershipEnded: true,
  error: "Your membership has ended. Your changes are kept in this browser; renew to sync them.",
};

export async function createDrawing() {
  const user = await requireMember();
  const [row] = await db
    .insert(drawings)
    .values({ title: "Untitled", data: emptyDrawing(), userId: user.id })
    .returning({ id: drawings.id });

  redirect(`/drawings/${row.id}`);
}

/** Owners and editors can rename; everyone looking at it sees the new title. */
export async function renameDrawing(id: string, title: string): Promise<SaveResult> {
  const { user } = await getCurrentSession();
  if (!user) return SIGNED_OUT;
  if (!(await getMembership(user.id)).isMember) return MEMBERSHIP_ENDED;

  const parsedId = idSchema.safeParse(id);
  const parsedTitle = titleSchema.safeParse(title);
  if (!parsedId.success) return { ok: false, error: "Invalid drawing id" };
  if (!parsedTitle.success) return { ok: false, error: "Title must be 1–120 characters" };

  const role = await getRole(parsedId.data, user.id);
  if (!role) return { ok: false, error: "Drawing not found" };
  if (!canEdit(role)) return { ok: false, error: "You can view this drawing but not rename it." };

  const [row] = await db
    .update(drawings)
    .set({ title: parsedTitle.data })
    .where(eq(drawings.id, parsedId.data))
    .returning({ updatedAt: drawings.updatedAt });

  if (!row) return { ok: false, error: "Drawing not found" };
  await notify({ t: "meta", d: parsedId.data, title: parsedTitle.data });
  return { ok: true, updatedAt: row.updatedAt.toISOString() };
}

export async function deleteDrawing(id: string) {
  const user = await requireUser();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return;

  // Images, members and history go with it (their drawing_id cascades).
  const deleted = await db
    .delete(drawings)
    .where(and(eq(drawings.id, parsedId.data), eq(drawings.userId, user.id)))
    .returning({ id: drawings.id });
  if (deleted.length) await notify({ t: "deleted", d: parsedId.data });
  refresh();
}
