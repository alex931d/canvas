import type { MemberRole, WorkspaceRole } from "@/db/schema";

export type { WorkspaceRole };

/*
 * What each role in a team workspace may do (checked on the server in
 * src/app/workspace-actions.ts and src/lib/collab/access.ts):
 *
 *   owner   everything, including making admins and deleting the workspace
 *   admin   invite people, change editors and viewers, remove them, rename it
 *   editor  make drawings in it and edit all of its drawings
 *   viewer  open its drawings and follow along
 */

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Can edit",
  viewer: "Can view",
};

const RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const canManageWorkspace = (role: WorkspaceRole | null | undefined) => role === "owner" || role === "admin";

export const canEditInWorkspace = (role: WorkspaceRole | null | undefined) => !!role && role !== "viewer";

/** What a workspace role allows on the workspace's drawings: owners and admins edit like editors. */
export function drawingRoleFrom(role: WorkspaceRole | null | undefined): MemberRole | null {
  if (!role) return null;
  return role === "viewer" ? "viewer" : "editor";
}

/** Roles `actor` may give someone (never "owner": there's one, who made the workspace). */
export function assignableRoles(actor: WorkspaceRole | null | undefined): WorkspaceRole[] {
  if (actor === "owner") return ["admin", "editor", "viewer"];
  if (actor === "admin") return ["editor", "viewer"];
  return [];
}

/** May `actor` change or remove someone who is `target`? Owners manage everyone else; admins, editors and viewers. */
export function canManageMember(actor: WorkspaceRole | null | undefined, target: WorkspaceRole) {
  if (!canManageWorkspace(actor) || target === "owner") return false;
  return RANK[actor!] > RANK[target];
}
