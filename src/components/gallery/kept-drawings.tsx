"use client";

import { HardDriveDownload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, toast } from "@/components/kit";
import { LocalTime } from "@/components/local-time";
import { BrowserDrawingMover, type MoveProgress } from "@/lib/local-store/mover";

export type KeptDrawing = { id: string; title: string; thumbnail: string | null; updatedAt: string };

/**
 * After a membership ends: the drawings still in the account, which are
 * deleted on a date unless they renew. Each can move into this browser (the
 * free plan), which frees the server's copy straight away.
 */
export function KeptDrawings({ drawings }: { drawings: KeptDrawing[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<MoveProgress | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const move = async (ids: string[]) => {
    setMoving(ids.length === 1 ? ids[0] : "all");
    setProgress({ done: 0, total: ids.length, title: null });
    const result = await BrowserDrawingMover.shared.intoBrowser(ids, setProgress);
    setProgress(null);
    setMoving(null);
    if (result.moved.length) {
      toast.success(
        `Moved ${result.moved.length === 1 ? "1 drawing" : `${result.moved.length} drawings`} into this browser.`,
        { id: "into-browser" },
      );
    }
    if (result.failed.length) toast.error(result.failed[0].reason, { id: "into-browser-failed" });
    router.refresh();
  };

  if (drawings.length === 0) return null;
  return (
    <section aria-label="Drawings in your account" className="mb-8 rounded-xl bg-card p-5 md:p-8" data-testid="kept-drawings">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">In your account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Move them into this browser to keep them on the free plan.
          </p>
        </div>
        {drawings.length > 1 ? (
          <Button onClick={() => void move(drawings.map((d) => d.id))} loading={moving === "all"} disabled={!!moving}>
            {moving === "all" && progress
              ? `Moving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : "Move all into this browser"}
          </Button>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {drawings.map((d) => (
          <li key={d.id} className="flex flex-col gap-3" data-drawing={d.id}>
            <span className="relative block aspect-[16/10] overflow-hidden rounded-lg bg-beige-100 ring-1 ring-black/5">
              {d.thumbnail ? (
                // Small data URLs stored in Postgres; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  Edited <LocalTime iso={d.updatedAt} />
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void move([d.id])}
                loading={moving === d.id}
                disabled={!!moving}
                aria-label={`Move “${d.title}” into this browser`}
              >
                {moving === d.id ? null : <HardDriveDownload />} Move here
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
