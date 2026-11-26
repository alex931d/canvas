"use client";

import { Ellipsis, ExternalLink, FolderInput, FolderOutput, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteDrawing } from "@/app/actions";
import { leaveDrawing } from "@/app/sharing-actions";
import { moveDrawing } from "@/app/workspace-actions";
import {
  Button,
  ConfirmDialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  toast,
} from "@/components/kit";

type WorkspaceRef = { id: string; name: string };

/** Where a drawing can go: the workspace it's in, others it can move to, and whether you may take it out. */
export type MoveOptions = { current: WorkspaceRef | null; to: WorkspaceRef[]; canTakeOut: boolean };

/**
 * The ⋯ menu on a drawing card. `own`: open, move between workspaces,
 * delete. `shared` (invited to it): open, leave. `workspace` (someone
 * else's, in a team workspace): open, and take it out if you run the workspace.
 */
export function DrawingMenu({
  id,
  title,
  kind,
  move,
}: {
  id: string;
  title: string;
  kind: "own" | "shared" | "workspace";
  move?: MoveOptions;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const moveTo = (target: WorkspaceRef | null) =>
    startTransition(async () => {
      try {
        const res = await moveDrawing(id, target?.id ?? null);
        if (!res.ok) toast.error(res.error);
        else if (target) toast.success(`Moved “${title}” to ${target.name}.`);
        else toast.success(kind === "own" ? `“${title}” is back in your own drawings.` : `Took “${title}” out of the workspace.`);
      } catch {
        toast.error("Couldn't move it. Check your connection and try again.");
      }
    });

  const targets = (move?.to ?? []).filter((w) => w.id !== move?.current?.id);
  const canMove = kind === "own" && targets.length > 0;
  const canTakeOut = !!move?.current && move.canTakeOut;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`More actions for “${title}”`}
            className="absolute right-0 bottom-1.5 text-grey-500"
            disabled={pending}
          >
            <Ellipsis />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-56">
          <MenuItem asChild>
            <Link href={`/drawings/${id}`}>
              <ExternalLink /> Open
            </Link>
          </MenuItem>
          {canMove || canTakeOut ? (
            <>
              <MenuSeparator />
              <MenuLabel>Workspace</MenuLabel>
              {targets.map((w) => (
                <MenuItem key={w.id} onSelect={() => moveTo(w)}>
                  <FolderInput /> <span className="truncate">Move to {w.name}</span>
                </MenuItem>
              ))}
              {canTakeOut ? (
                <MenuItem onSelect={() => moveTo(null)}>
                  <FolderOutput /> <span className="truncate">Take out of {move!.current!.name}</span>
                </MenuItem>
              ) : null}
            </>
          ) : null}
          {kind === "workspace" ? null : <MenuSeparator />}
          {kind === "shared" ? (
            <MenuItem tone="danger" onSelect={() => startTransition(() => leaveDrawing(id))}>
              <LogOut /> Leave drawing
            </MenuItem>
          ) : kind === "own" ? (
            <MenuItem tone="danger" onSelect={() => setConfirming(true)}>
              <Trash2 /> Delete drawing
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ‘${title}’?`}
        description="This removes the drawing and its images from the server, for everyone it’s shared with. It can’t be undone."
        confirmLabel={pending ? "Deleting…" : "Yes, delete"}
        cancelLabel="No, go back"
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            await deleteDrawing(id);
            setConfirming(false);
          })
        }
      />
    </>
  );
}
