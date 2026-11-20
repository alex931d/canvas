import "server-only";

import { z } from "zod";
import { getCurrentSession, type SessionUser } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { canEdit, getRole, type Role } from "./access";

/**
 * For the drawing API routes: the signed-in member and their role, or the
 * response to send instead (401 signed out, 402 no membership, 404 no
 * access, 403 view-only when editing is needed).
 */
export async function authorizeDrawing(
  drawingId: string,
  need: "view" | "edit",
): Promise<{ user: SessionUser; role: Role } | Response> {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const notMember = await membershipRequiredResponse(user.id, "Drawings");
  if (notMember) return notMember;
  if (!z.uuid().safeParse(drawingId).success) return Response.json({ error: "Drawing not found." }, { status: 404 });
  const role = await getRole(drawingId, user.id);
  if (!role) return Response.json({ error: "Drawing not found." }, { status: 404 });
  if (need === "edit" && !canEdit(role)) {
    return Response.json({ error: "You can view this drawing but not change it.", role }, { status: 403 });
  }
  return { user, role };
}

/** Browser tab ids: short random strings made by the client. */
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
