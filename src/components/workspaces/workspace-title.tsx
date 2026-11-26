"use client";

import { Ellipsis, LogOut, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteWorkspace, leaveWorkspace, renameWorkspace } from "@/app/workspace-actions";
import { Button, ConfirmDialog, Menu, MenuContent, MenuItem, MenuTrigger, toast } from "@/components/kit";
import type { WorkspaceRole } from "@/lib/workspaces/roles";

/** The workspace's name (renamed in place by its owner and admins), and leaving or deleting it. */
export function WorkspaceTitle({ id, name, role }: { id: string; name: string; role: WorkspaceRole }) {
  const canRename = role === "owner" || role === "admin";
  const [draft, setDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [pending, start] = useTransition();

  const commit = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (!next || next === name) return;
    start(async () => {
      try {
        const res = await renameWorkspace(id, next);
        if (!res.ok) toast.error(res.error);
      } catch {
        toast.error("Couldn't rename it. Check your connection and try again.");
      }
    });
  };

  // Leaving and deleting end by going to /workspaces; anything that stops them comes back as an error.
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string } | undefined>) =>
    start(async () => {
      try {
        const res = await action();
        if (res && !res.ok) {
          toast.error(res.error);
          setConfirm(null);
        }
      } catch {
        toast.error("Couldn't do that. Check your connection and try again.");
      }
    });

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        value={draft ?? name}
        readOnly={!canRename}
        onFocus={() => canRename && setDraft(name)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(name);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        maxLength={60}
        aria-label="Workspace name"
        data-testid="workspace-name"
        className="min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 py-1 text-[28px] leading-tight font-bold outline-none md:-ml-2 md:text-[32px] [&:not([readonly])]:hover:bg-card/60 [&:not([readonly])]:focus-visible:bg-card [&:not([readonly])]:focus-visible:ring-2 [&:not([readonly])]:focus-visible:ring-ring"
      />
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-md" aria-label="Workspace actions" disabled={pending}>
            <Ellipsis />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-52">
          {role === "owner" ? (
            <MenuItem tone="danger" onSelect={() => setConfirm("delete")}>
              <Trash2 /> Delete workspace
            </MenuItem>
          ) : (
            <MenuItem tone="danger" onSelect={() => setConfirm("leave")}>
              <LogOut /> Leave workspace
            </MenuItem>
          )}
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirm === "leave"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Leave ${name}?`}
        description="You won't be able to open its drawings any more, unless someone invites you again. Drawings you made in it stay in it."
        confirmLabel={pending ? "Leaving…" : "Leave"}
        cancelLabel="Stay"
        pending={pending}
        onConfirm={() => run(() => leaveWorkspace(id))}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${name}?`}
        description="Everyone loses access to it. Its drawings aren't deleted: each goes back to the person who made it."
        confirmLabel={pending ? "Deleting…" : "Delete workspace"}
        cancelLabel="Keep it"
        pending={pending}
        onConfirm={() => run(() => deleteWorkspace(id))}
      />
    </div>
  );
}
