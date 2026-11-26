"use client";

import { useTransition } from "react";
import { acceptWorkspaceInvite, declineWorkspaceInvite } from "@/app/workspace-actions";
import { Button, toast } from "@/components/kit";
import type { InvitationForMe } from "@/lib/workspaces/data";

/** Invitations emailed to you, to accept here without the link. */
export function InvitationList({ invitations }: { invitations: InvitationForMe[] }) {
  const [pending, start] = useTransition();
  return (
    <ul className="flex flex-col gap-2" data-testid="invitations">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-bold">{inv.workspaceName}</span>
            <span className="block text-muted-foreground">
              {inv.invitedBy ?? "Someone"} invited you {inv.role === "editor" ? "to draw with them" : "to view its drawings"}
            </span>
          </p>
          <form action={acceptWorkspaceInvite.bind(null, inv.id)}>
            <Button type="submit" size="sm" disabled={pending}>
              Join
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await declineWorkspaceInvite(inv.id);
                if (!res.ok) toast.error(res.error);
              })
            }
          >
            Decline
          </Button>
        </li>
      ))}
    </ul>
  );
}
