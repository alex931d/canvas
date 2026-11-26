"use client";

import { Ellipsis, ExternalLink, HardDrive, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { Button, ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, toast } from "@/components/kit";
import { LocalTime } from "@/components/local-time";
import { BrowserLibrary, type BrowserDrawingSummary } from "@/lib/local-store/library";
import { BrowserDrawingMover, type MoveProgress, type MoveResult } from "@/lib/local-store/mover";
import { cn } from "@/lib/utils";
import { DrawingCard } from "./drawing-card";

/** This browser's drawings, kept up to date as they change here or in another tab. Null while loading. */
export function useBrowserDrawings(): BrowserDrawingSummary[] | null {
  const [drawings, setDrawings] = useState<BrowserDrawingSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      BrowserLibrary.shared
        .list()
        .then((list) => !cancelled && setDrawings(list))
        .catch(() => !cancelled && setDrawings([]));
    void load();
    const unsubscribe = BrowserLibrary.shared.subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return drawings;
}

/** Makes a drawing in this browser and opens it. */
export function NewBrowserDrawingButton({ label, className }: { label?: React.ReactNode; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    try {
      const drawing = await BrowserLibrary.shared.create();
      router.push(`/local/${drawing.id}`);
    } catch {
      setPending(false);
      toast.error("This browser couldn't make a new drawing. Its storage may be full or turned off.");
    }
  };
  return (
    <Button size="xl" loading={pending} onClick={() => void create()} className={cn("shrink-0 px-5", className)}>
      {pending ? null : <Plus />}
      {pending
        ? "Opening…"
        : (label ?? (
            <span>
              New<span className="max-[399px]:sr-only"> Drawing</span>
            </span>
          ))}
    </Button>
  );
}

/**
 * The drawings in this browser (the free plan). Members see the way to move
 * them into their account; everyone else, what keeping them there takes.
 */
export function BrowserGallery({ member }: { member: boolean }) {
  const drawings = useBrowserDrawings();

  if (drawings === null) return <Skeleton className="h-80 rounded-xl bg-card" />;

  return (
    <>
      {member && drawings.length > 0 ? <MoveNotice count={drawings.length} /> : null}

      {drawings.length === 0 ? (
        <section className="rounded-xl bg-card px-6 py-14 text-center">
          <h2 className="text-xl font-bold">No drawings in this browser yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Sketch, write equations, paste screenshots and plan with to-do boards. Everything saves in this browser as
            you go, no account needed.
          </p>
          <div className="mt-6 flex justify-center">
            <NewBrowserDrawingButton label="Start a drawing" />
          </div>
        </section>
      ) : (
        <section aria-label="Drawings in this browser" className="rounded-xl bg-card p-5 md:p-8" data-testid="browser-drawings">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <HardDrive className="size-5 text-grey-500" aria-hidden /> In this browser
            </h2>
            <p className="text-sm text-muted-foreground">Kept on this device only</p>
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {drawings.map((d, i) => (
              <DrawingCard
                key={d.id}
                index={i}
                id={d.id}
                href={`/local/${d.id}`}
                title={d.title}
                thumbnail={d.thumbnail}
                accent="bg-beige-500"
                detail={
                  <>
                    Edited <LocalTime iso={new Date(d.updatedAt).toISOString()} />
                  </>
                }
                chip={null}
                menu={<BrowserDrawingMenu id={d.id} title={d.title} />}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function BrowserDrawingMenu({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const remove = async () => {
    setPending(true);
    try {
      await BrowserLibrary.shared.delete(id);
      setConfirming(false);
    } catch {
      toast.error("This browser couldn't delete it. Try again.");
    } finally {
      setPending(false);
    }
  };
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
        <MenuContent align="end" className="w-56">
          <MenuItem asChild>
            <Link href={`/local/${id}`}>
              <ExternalLink /> Open
            </Link>
          </MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger" onSelect={() => setConfirming(true)}>
            <Trash2 /> Delete drawing
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ‘${title}’?`}
        description="It's only in this browser, so once it's deleted there's no other copy. It can't be undone."
        confirmLabel={pending ? "Deleting…" : "Yes, delete"}
        cancelLabel="No, go back"
        pending={pending}
        onConfirm={() => void remove()}
      />
    </>
  );
}

/**
 * Moves this browser's drawings into the member's account. With `auto`, it
 * starts by itself (straight after joining); otherwise it waits for a click.
 */
export function MoveNotice({ count, auto = false, className }: { count: number; auto?: boolean; className?: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<MoveProgress | null>(auto ? { done: 0, total: count, title: null } : null);
  const [result, setResult] = useState<{ moved: number; failed: { title: string; reason: string }[] } | null>(null);

  const report = (outcome: MoveResult) => {
    setProgress(null);
    setResult({ moved: outcome.moved.length, failed: outcome.failed });
    if (outcome.moved.length) {
      toast.success(
        `Moved ${outcome.moved.length} ${outcome.moved.length === 1 ? "drawing" : "drawings"} from this browser to your account.`,
        { id: "moved" },
      );
      router.refresh();
    }
  };
  const finish = useEffectEvent(report);

  const move = async () => {
    setResult(null);
    setProgress({ done: 0, total: count, title: null });
    report(await BrowserDrawingMover.shared.moveAll(setProgress));
  };

  // Straight after joining: no click needed. (A second run joins the first.)
  useEffect(() => {
    if (auto) void BrowserDrawingMover.shared.moveAll(setProgress).then(finish);
  }, [auto]);

  const busy = progress !== null;
  return (
    <section
      aria-label="Drawings in this browser"
      role="status"
      data-testid="move-notice"
      className={cn(
        "mb-6 flex flex-wrap items-center gap-4 rounded-xl border-l-4 border-cyan bg-card px-5 py-4 sm:mb-8",
        className,
      )}
    >
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {busy ? (
          <>
            Moving {progress.title ? <strong>{progress.title}</strong> : "your drawings"} to your account…{" "}
            {Math.min(progress.done + 1, progress.total)} of {progress.total}
          </>
        ) : result && result.failed.length === 0 ? (
          <>
            Moved {result.moved === 1 ? "1 drawing" : `${result.moved} drawings`} from this browser to your account,
            pictures and all.
          </>
        ) : result && result.failed.length ? (
          <>
            {result.moved ? `Moved ${result.moved}. ` : null}
            {result.failed.length === 1 ? (
              <>
                <strong>{result.failed[0].title}</strong> stayed in this browser: {result.failed[0].reason}
              </>
            ) : (
              <>
                {result.failed.length} drawings stayed in this browser: {result.failed[0].reason}
              </>
            )}
          </>
        ) : (
          <>
            {count === 1 ? "1 drawing is" : `${count} drawings are`} saved only in this browser. Move{" "}
            {count === 1 ? "it" : "them"} to your account to have {count === 1 ? "it" : "them"} on every device and
            share {count === 1 ? "it" : "them"}.
          </>
        )}
      </p>
      {result && result.failed.length === 0 ? null : (
        <Button onClick={() => void move()} loading={busy} disabled={busy}>
          {busy
            ? "Moving…"
            : result?.failed.length
              ? "Try again"
              : count === 1
                ? "Move it to your account"
                : "Move them to your account"}
        </Button>
      )}
    </section>
  );
}

/** On a member's home: drawings left in this browser (made before joining, or signed out), one click from their account. */
export function PendingBrowserDrawings() {
  const drawings = useBrowserDrawings();
  if (!drawings?.length) return null;
  return <MoveNotice count={drawings.length} />;
}

/** Straight after joining: this browser's drawings start moving into the new member's account. */
export function WelcomeMove({ className }: { className?: string }) {
  const drawings = useBrowserDrawings();
  // How many there were to start with; the list empties as they move.
  const [count, setCount] = useState<number | null>(null);
  if (count === null && drawings && drawings.length > 0) setCount(drawings.length);
  if (!count) return null;
  return <MoveNotice count={count} auto className={className} />;
}
