"use client";

import { Ellipsis, ExternalLink, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteDrawing } from "@/app/actions";
import { leaveDrawing } from "@/app/sharing-actions";
import { Button, ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/kit";

/** Open / delete for your own drawings; open / leave for ones shared with you. */
export function DrawingMenu({ id, title, shared = false }: { id: string; title: string; shared?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`More actions for “${title}”`}
            className="absolute right-0 bottom-1.5 text-grey-500"
          >
            <Ellipsis />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-44">
          <MenuItem asChild>
            <Link href={`/drawings/${id}`}>
              <ExternalLink /> Open
            </Link>
          </MenuItem>
          <MenuSeparator />
          {shared ? (
            <MenuItem tone="danger" onSelect={() => startTransition(() => leaveDrawing(id))}>
              <LogOut /> Leave drawing
            </MenuItem>
          ) : (
            <MenuItem tone="danger" onSelect={() => setConfirming(true)}>
              <Trash2 /> Delete drawing
            </MenuItem>
          )}
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
