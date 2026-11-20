"use client";

import { Ellipsis, ImageIcon, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Textarea,
  toast,
} from "@/components/kit";
import { deleteCard, resetCard, updateCard } from "@/app/study/actions";

export type ListCard = {
  id: string;
  deck: string;
  front: string;
  back: string;
  imageSide: "front" | "back" | null;
  dueAt: string;
  box: number;
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function dueText(iso: string) {
  const due = new Date(iso);
  if (due.getTime() <= Date.now()) return "Due now";
  return `Due ${dateFormat.format(due)}`;
}

/** Every card, with edit, start over and delete. */
export function CardList({ cards }: { cards: ListCard[] }) {
  const [editing, setEditing] = useState<ListCard | null>(null);
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await action().catch(() => ({ ok: false, error: "Couldn't reach the server." }));
      if (!res.ok) toast.error(res.error ?? "That didn't work.");
      else if (done) toast.success(done);
    });

  return (
    <>
      <ul className="divide-y divide-grey-100">
        {cards.map((c) => (
          <li key={c.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-semibold">
                {c.imageSide === "front" ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-label="Picture" /> : null}
                <span className="truncate">{c.front || "Picture"}</span>
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {c.back || (c.imageSide === "back" ? "Picture" : "")}
              </p>
            </div>
            <span className="hidden max-w-40 truncate rounded-full bg-beige-100 px-3 py-1 text-xs font-semibold sm:inline">{c.deck}</span>
            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground" suppressHydrationWarning>
              {dueText(c.dueAt)}
            </span>
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for “${c.front || "picture card"}”`}
                  disabled={pending}
                >
                  <Ellipsis />
                </Button>
              </MenuTrigger>
              <MenuContent align="end" className="w-44">
                <MenuItem onSelect={() => setEditing(c)}>
                  <Pencil /> Edit
                </MenuItem>
                <MenuItem onSelect={() => run(() => resetCard(c.id), "It's due again now, like a new card.")}>
                  <RotateCcw /> Start over
                </MenuItem>
                <MenuSeparator />
                <MenuItem tone="danger" onSelect={() => run(() => deleteCard(c.id), "Card deleted.")}>
                  <Trash2 /> Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </li>
        ))}
      </ul>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          title="Edit card"
          description={
            editing?.imageSide ? `The picture stays on the ${editing.imageSide}.` : "Change the text on either side."
          }
        >
          {editing ? (
            <EditForm
              key={editing.id}
              card={editing}
              pending={pending}
              onSave={(front, back) =>
                start(async () => {
                  const res = await updateCard(editing.id, front, back).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
                  if (res.ok) setEditing(null);
                  else toast.error(res.error);
                })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditForm({ card, pending, onSave }: { card: ListCard; pending: boolean; onSave: (front: string, back: string) => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const field = "resize-none px-3 py-2";
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Front
        <Textarea
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={3}
          maxLength={2000}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Back
        <Textarea value={back} onChange={(e) => setBack(e.target.value)} rows={4} maxLength={2000} className={field} />
      </label>
      <DialogFooter>
        <Button onClick={() => onSave(front, back)} loading={pending}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
