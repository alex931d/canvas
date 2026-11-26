import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { drawingMembers, drawings, workspaceMembers } from "@/db/schema";
import { drawingRoleFrom } from "@/lib/workspaces/roles";
import type { Role } from "./access-types";

export type { Role };

// Anyone without a role gets "not found", the same answer as for a drawing
// that doesn't exist.

export const canEdit = (role: Role | null | undefined): boolean => role === "owner" || role === "editor";

/**
 * The user's role on a drawing, or null. `id` must already be a valid UUID.
 * Owners own it; otherwise the better of being invited to the drawing and
 * being in its team workspace.
 */
export async function getRole(drawingId: string, userId: string): Promise<Role | null> {
  const [row] = await db
    .select({ ownerId: drawings.userId, memberRole: drawingMembers.role, workspaceRole: workspaceMembers.role })
    .from(drawings)
    .leftJoin(drawingMembers, and(eq(drawingMembers.drawingId, drawings.id), eq(drawingMembers.userId, userId)))
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, drawings.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(drawings.id, drawingId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId === userId) return "owner";
  const fromWorkspace = drawingRoleFrom(row.workspaceRole);
  if (row.memberRole === "editor" || fromWorkspace === "editor") return "editor";
  return row.memberRole ?? fromWorkspace;
}
