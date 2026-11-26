"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Kbd,
  Textarea,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/kit";
import type { FlashcardCapture } from "./board";

type Side = "front" | "back" | "none";

/**
 * Turn a selection into a flashcard: the captured picture goes on one side
 * (the back, by default: draw the answer, type the question), with text on
 * either side. Cards land in a deck named after the drawing.
 */
export function FlashcardDialog({
  capture,
  drawingId,
  deck,
  onClose,
}: {
  capture: FlashcardCapture | null;
  /** The drawing on the server, if it's there (a drawing kept in this browser isn't). */
  drawingId: string | null;
  deck: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!capture} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="xl"
        title="New flashcard"
        description={<>Goes in the “{deck}” deck. Review it on the Study page; cards you know come back less often.</>}
      >
        {capture ? (
          <Form
            key={capture.blob.size + capture.text}
            capture={capture}
            drawingId={drawingId}
            deck={deck}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  capture,
  drawingId,
  deck,
  onClose,
}: {
  capture: FlashcardCapture;
  drawingId: string | null;
  deck: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const onlyText = capture.text.length > 0 && capture.text.length < 200 && !capture.text.includes("\\");
  const [side, setSide] = useState<Side>("back");
  const [front, setFront] = useState("");
  const [back, setBack] = useState(onlyText ? capture.text : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = useMemo(() => URL.createObjectURL(capture.blob), [capture.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const frontOk = !!front.trim() || side === "front";
  const backOk = !!back.trim() || side === "back";

  const save = async () => {
    if (!frontOk || !backOk) {
      setError("Put something on both sides of the card.");
      return;
    }
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set("front", front.trim());
    form.set("back", back.trim());
    if (drawingId) form.set("drawingId", drawingId);
    else form.set("deck", deck);
    if (side !== "none") {
      form.set("imageSide", side);
      form.set("width", String(capture.width));
      form.set("height", String(capture.height));
      form.set("image", capture.blob, capture.blob.type === "image/webp" ? "card.webp" : "card.png");
    }
    try {
      const res = await fetch("/api/flashcards", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Couldn't save the card.");
        return;
      }
      toast.success(`Card added to “${json.deck ?? deck}”.`, {
        action: { label: "Study", onClick: () => router.push("/study") },
      });
      onClose();
    } catch {
      setError("Couldn't reach the server. Cards need a connection.");
    } finally {
      setSaving(false);
    }
  };

  const picture = (
    // A blob URL of the captured selection; next/image can't optimise these.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="The selected part of the drawing" className="max-h-44 w-full rounded-md object-contain" />
  );

  return (
    <div
      className="contents"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold">Picture on</span>
        <ToggleGroup value={side} onValueChange={(v) => setSide(v as typeof side)} aria-label="Picture on">
          {(["front", "back", "none"] as const).map((s) => (
            <ToggleGroupItem key={s} value={s} className="capitalize">
              {s === "none" ? "Neither" : s}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["front", "back"] as const).map((s) => (
          <section key={s} className="flex flex-col gap-2 rounded-xl border bg-beige-100 p-3" aria-label={s === "front" ? "Front" : "Back"}>
            <p className="text-xs font-bold tracking-wide text-muted-foreground">{s === "front" ? "Front: the question" : "Back: the answer"}</p>
            {side === s ? picture : null}
            <Textarea
              autoFocus={s === "front"}
              value={s === "front" ? front : back}
              onChange={(e) => (s === "front" ? setFront(e.target.value) : setBack(e.target.value))}
              maxLength={2000}
              rows={side === s ? 2 : 5}
              placeholder={
                s === "front"
                  ? side === "front"
                    ? "Optional question, e.g. Name this structure"
                    : "e.g. What's the derivative of sin x?"
                  : side === "back"
                    ? "Optional note"
                    : "The answer"
              }
              aria-label={s === "front" ? "Front text" : "Back text"}
              className="min-h-0 resize-none px-3 py-2"
            />
          </section>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">
          <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> to save
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!frontOk || !backOk}>
          Save card
        </Button>
      </DialogFooter>
    </div>
  );
}
