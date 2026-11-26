"use client";

import { Check, Copy, Link2, Mail, RefreshCw, X } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import {
  inviteToWorkspace,
  removeWorkspaceMember,
  resetWorkspaceLink,
  revokeWorkspaceInvite,
  setWorkspaceLink,
  setWorkspaceMemberRole,
  type WorkspaceResult,
} from "@/app/workspace-actions";
import { Avatar, Button, Input, Select, Switch, toast } from "@/components/kit";
import type { MemberRole } from "@/db/schema";
import type { WorkspaceInvite, WorkspaceMember } from "@/lib/workspaces/data";
import {
  WORKSPACE_ROLE_LABELS,
  assignableRoles,
  canManageMember,
  canManageWorkspace,
  type WorkspaceRole,
} from "@/lib/workspaces/roles";

const noSubscribe = () => () => {};

/**
 * The people in a workspace. Owners and admins invite (by email, or with a
 * link), change roles and remove people; everyone sees who's there.
 */
export function WorkspacePeople({
  workspaceId,
  meId,
  role,
  members,
  invites,
  link,
}: {
  workspaceId: string;
  meId: string;
  role: WorkspaceRole;
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  link: { token: string | null; role: MemberRole } | null;
}) {
  const manager = canManageWorkspace(role);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("editor");
  const [copied, setCopied] = useState(false);

  const run = (action: () => Promise<WorkspaceResult>, done?: string, after?: () => void) =>
    start(async () => {
      try {
        const res = await action();
        if (res.ok) {
          setError(null);
          if (done) toast.success(done);
          after?.();
        } else setError(res.error);
      } catch {
        setError("Couldn't save that. Check your connection and try again.");
      }
    });

  // The site's address is only known in the browser; the server renders the path alone.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const url = link?.token ? `${origin}/join/workspace/${link.token}` : null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      ) : null}

      {manager ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim();
            if (!to) return;
            run(() => inviteToWorkspace(workspaceId, to, inviteRole), `Invitation sent to ${to}.`, () => setEmail(""));
          }}
        >
          <label htmlFor="invite-email" className="flex items-center gap-2 text-sm font-bold">
            <Mail className="size-4" /> Invite by email
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@school.edu"
              fieldSize="sm"
              className="h-10 basis-full"
            />
            <Select
              fieldSize="sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as MemberRole)}
              aria-label="They can"
              className="h-10 w-auto min-w-0 flex-1"
            >
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </Select>
            <Button type="submit" className="h-10" disabled={pending || !email.trim()}>
              Send invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            They get a link that works for 14 days, with a canvas membership for that address.
          </p>
        </form>
      ) : null}

      {manager && invites.length ? (
        <section className="flex flex-col gap-1" aria-labelledby="pending-title">
          <h3 id="pending-title" className="text-sm font-bold">
            Waiting to join
          </h3>
          <ul data-testid="pending-invites">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 border-b border-grey-100 py-2 last:border-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-beige-100 text-grey-500" aria-hidden>
                  <Mail className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{inv.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {WORKSPACE_ROLE_LABELS[inv.role]}, invited by {inv.invitedBy ?? "someone"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Cancel the invitation to ${inv.email}`}
                  title="Cancel invitation"
                  disabled={pending}
                  onClick={() => run(() => revokeWorkspaceInvite(workspaceId, inv.id))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {manager && link ? (
        <section className="flex flex-col gap-3 rounded-xl bg-beige-100 p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Link2 className="size-4" /> Invite with a link
            </span>
            <Switch
              checked={!!link.token}
              disabled={pending}
              onCheckedChange={(on) => run(() => setWorkspaceLink(workspaceId, on, link.role))}
              aria-label="Invite with a link"
            />
          </label>
          {url ? (
            <>
              <div className="flex gap-2">
                <Input
                  readOnly
                  fieldSize="sm"
                  value={url}
                  aria-label="Workspace invite link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 flex-1 font-mono text-xs"
                />
                <Button onClick={copy} className="h-10" aria-label="Copy link">
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2">
                  People who join
                  <Select
                    fieldSize="sm"
                    value={link.role}
                    disabled={pending}
                    onChange={(e) => run(() => setWorkspaceLink(workspaceId, true, e.target.value as MemberRole))}
                    aria-label="People who join with the link"
                    className="h-8 w-28"
                  >
                    <option value="editor">can edit</option>
                    <option value="viewer">can view</option>
                  </Select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => resetWorkspaceLink(workspaceId))}
                  title="The old link stops working"
                >
                  <RefreshCw /> New link
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Anyone with a membership who opens the link joins. People who joined keep their place when it&apos;s off.
            </p>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-1" aria-labelledby="people-title">
        <h3 id="people-title" className="text-sm font-bold">
          {members.length} {members.length === 1 ? "person" : "people"}
        </h3>
        <ul data-testid="workspace-members">
          {members.map((m) => {
            const editable = m.userId !== meId && canManageMember(role, m.role);
            const options = editable ? [...new Set([...assignableRoles(role), m.role])] : [];
            return (
              <li key={m.userId} className="flex items-center gap-3 border-b border-grey-100 py-2 last:border-0" data-member={m.name}>
                <Avatar name={m.name} src={m.avatarUrl} className="size-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {m.name}
                    {m.userId === meId ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </span>
                  {m.email ? <span className="block truncate text-xs text-muted-foreground">{m.email}</span> : null}
                </span>
                {editable ? (
                  <>
                    <Select
                      fieldSize="sm"
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => setWorkspaceMemberRole(workspaceId, m.userId, e.target.value))}
                      aria-label={`${m.name}'s role`}
                      className="h-8 w-28"
                    >
                      {options.map((r) => (
                        <option key={r} value={r}>
                          {WORKSPACE_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${m.name}`}
                      title="Remove from the workspace"
                      disabled={pending}
                      onClick={() => run(() => removeWorkspaceMember(workspaceId, m.userId), `${m.name} was removed.`)}
                    >
                      <X />
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">{WORKSPACE_ROLE_LABELS[m.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
