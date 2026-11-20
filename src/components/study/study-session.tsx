"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { Button, Kbd, toast } from "@/components/kit";
import { reviewCard } from "@/app/study/actions";
import { emitBuddy } from "@/lib/buddy/events";
import { gapLabel, type Grade } from "@/lib/study/schedule";
import { cn } from "@/lib/utils";

export type SessionCard = {
  id: string;
  deck: string;
  front: string;
  back: string;
  imageSide: "front" | "back" | null;
  imageWidth: number | null;
  imageHeight: number | null;
  box: number;
};

const GRADES: { grade: Grade; label: string; key: string; className: string }[] = [
  { grade: "again", label: "Again", key: "1", className: "bg-red hover:bg-[#b13e2f]" },
  { grade: "good", label: "Good", key: "2", className: "" },
  { grade: "easy", label: "Easy", key: "3", className: "bg-green hover:bg-[#1f6965]" },
];

/**
 * One study session over the cards that are due: show the front, reveal
 * the back, say how well you knew it. "Again" brings the card back later in
 * the same session.
 */
export function StudySession({ cards }: { cards: SessionCard[] }) {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState({ reviewed: 0, remembered: 0 });
  const [, start] = useTransition();
  const total = cards.length;
  const card = queue[0];

  const grade = (g: Grade) => {
    if (!card || !revealed) return;
    const reviewed = card;
    // The last card answered (not one to try again): the round is over.
    const finishing = g !== "again" && queue.length === 1;
    const count = done.reviewed + 1;
    setRevealed(false);
    setDone((d) => ({ reviewed: d.reviewed + 1, remembered: d.remembered + (g === "again" ? 0 : 1) }));
    setQueue((q) => {
      const rest = q.slice(1);
      if (g !== "again") return rest;
      // Try it again after a few other cards.
      const at = Math.min(rest.length, 3);
      return [...rest.slice(0, at), { ...reviewed, box: 1 }, ...rest.slice(at)];
    });
    start(async () => {
      const res = await reviewCard(reviewed.id, g).catch(() => null);
      if (!res?.ok) {
        toast.error(res?.error ?? "Couldn't save that answer. Check your connection.", { id: "review" });
        return;
      }
      emitBuddy(finishing ? { kind: "session-done", reviewed: count } : { kind: "review", grade: g });
    });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest("input, textarea, [role=dialog]")) return;
    if (!card) return;
    if (!revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      setRevealed(true);
      return;
    }
    const g = GRADES.find((x) => x.key === e.key);
    if (revealed && g) {
      e.preventDefault();
      grade(g.grade);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (total === 0) return null;

  if (!card) {
    return (
      <section className="rounded-xl bg-card px-6 py-12 text-center" aria-live="polite">
        <h2 className="text-2xl font-bold">Done for now</h2>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          You went through {done.reviewed} {done.reviewed === 1 ? "card" : "cards"} and knew {done.remembered} of them.
          The ones you knew come back in a few days; the rest come back sooner.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/">Back to drawings</Link>
          </Button>
        </div>
      </section>
    );
  }

  const progress = done.reviewed / (done.reviewed + queue.length);

  return (
    <section aria-label="Study session" className="flex flex-col gap-4">
      <div className="flex items-center gap-4 text-sm">
        <span className="font-semibold tabular-nums" data-testid="study-progress">
          {queue.length} left
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-card" aria-hidden>
          <div className="h-full rounded-full bg-green transition-[width]" style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
        <span className="text-muted-foreground tabular-nums">{done.reviewed} done</span>
      </div>

      <article
        key={`${card.id}:${done.reviewed}`}
        className="flex min-h-[320px] flex-col rounded-xl bg-card p-6 md:p-10"
        aria-live="polite"
        data-testid="study-card"
      >
        <p className="text-sm text-muted-foreground">{card.deck}</p>
        <Face card={card} side="front" />
        {revealed ? (
          <>
            <hr className="my-6 border-dashed border-grey-300" />
            <Face card={card} side="back" />
          </>
        ) : null}
      </article>

      {/* On wider screens the answer buttons stay in view while a tall card scrolls. */}
      <div className="md:sticky md:bottom-0 md:z-10 md:-mt-2 md:bg-background md:pt-2 md:pb-6">
        {revealed ? (
          <div className="grid grid-cols-3 gap-3" role="group" aria-label="How well did you know it?">
            {GRADES.map((g) => (
              <Button
                key={g.grade}
                onClick={() => grade(g.grade)}
                className={cn("h-auto flex-col gap-0.5 py-3 text-white", g.className)}
              >
                <span className="text-base font-bold">{g.label}</span>
                <span className="text-xs opacity-80">
                  {gapLabel(card.box, g.grade)}{" "}
                  <Kbd tone="dark" className="ml-1">
                    {g.key}
                  </Kbd>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <Button size="xl" full className="text-base" onClick={() => setRevealed(true)}>
            Show answer <Kbd tone="dark">Space</Kbd>
          </Button>
        )}
      </div>
      {done.reviewed > 0 ? (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <RotateCcw className="size-3" /> Cards you mark Again come back in this session.
        </p>
      ) : null}
    </section>
  );
}

function Face({ card, side }: { card: SessionCard; side: "front" | "back" }) {
  const text = side === "front" ? card.front : card.back;
  const hasImage = card.imageSide === side;
  return (
    <div className={cn("flex flex-col gap-4", side === "front" && "mt-4")}>
      {text ? (
        <p
          className={cn(
            "whitespace-pre-wrap break-words",
            side === "front" ? "text-2xl leading-snug font-bold md:text-[28px]" : "text-lg leading-relaxed",
          )}
        >
          {text}
        </p>
      ) : null}
      {hasImage ? (
        // Served from /api/flashcards, private to this person; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/flashcards/${card.id}/image`}
          alt={side === "front" ? "Question picture" : "Answer picture"}
          width={card.imageWidth ?? undefined}
          height={card.imageHeight ?? undefined}
          className="max-h-[min(420px,40vh)] w-auto max-w-full self-start rounded-lg object-contain ring-1 ring-black/5"
        />
      ) : null}
    </div>
  );
}
