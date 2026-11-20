import { Eye, Users } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Skeleton } from "@/components/kit";
import { Reveal } from "@/components/motion/reveal";
import { listDrawings, listSharedWithMe } from "@/lib/drawings";
import { studySummary } from "@/lib/study/cards";
import { DrawingMenu } from "./drawing-menu";
import { NewDrawingButton } from "./new-drawing-button";

/** Summary cards, your drawings, and drawings shared with you. */
export async function Overview() {
  const [drawings, shared, study] = await Promise.all([listDrawings(), listSharedWithMe(), studySummary()]);

  return (
    <>
      <section aria-label="Summary" className="mb-8 grid gap-3 sm:grid-cols-3 md:gap-6">
        <div className="rounded-xl bg-grey-900 p-6 text-white">
          <p className="text-sm">Drawings</p>
          <p className="mt-3 text-[32px] leading-none font-bold" data-testid="drawing-count">
            {drawings.length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6">
          <p className="text-sm text-muted-foreground">Shared with you</p>
          <p className="mt-3 text-[32px] leading-none font-bold" data-testid="shared-count">
            {shared.length}
          </p>
        </div>
        <Link
          href="/study"
          className="group rounded-xl bg-card p-6 outline-none transition-shadow hover:ring-2 hover:ring-green/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-sm text-muted-foreground">Flashcards due</p>
          <p className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-[32px] leading-none font-bold" data-testid="due-count">
              {study.due}
            </span>
            <span className="text-sm font-bold text-green group-hover:underline">
              {study.total === 0 ? "How it works" : study.due > 0 ? "Study now" : "All done"}
            </span>
          </p>
        </Link>
      </section>

      {drawings.length === 0 ? (
        <section className="rounded-xl bg-card px-6 py-14 text-center">
          <h2 className="text-xl font-bold">No drawings yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Start a drawing to sketch, paste screenshots and check your math. Everything saves as you go.
          </p>
          <div className="mt-6 flex justify-center">
            <NewDrawingButton label="Start a drawing" />
          </div>
        </section>
      ) : (
        <section aria-label="All drawings" className="rounded-xl bg-card p-5 md:p-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-bold">All drawings</h2>
            <p className="text-sm text-muted-foreground">Most recent first</p>
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {drawings.map((d, i) => (
              <DrawingCard
                key={d.id}
                index={i}
                id={d.id}
                title={d.title}
                thumbnail={d.thumbnail}
                detail={
                  <>
                    Edited <LocalTime iso={d.updatedAt.toISOString()} />
                  </>
                }
                chip={
                  d.members > 0 || d.linkShared ? (
                    <>
                      <Users className="size-3.5" />
                      {d.members > 0 ? `${d.members} ${d.members === 1 ? "person" : "people"}` : "Link on"}
                    </>
                  ) : null
                }
              />
            ))}
          </ul>
        </section>
      )}

      {shared.length > 0 ? (
        <section aria-label="Shared with you" className="mt-8 rounded-xl bg-card p-5 md:p-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-bold">Shared with you</h2>
            <p className="text-sm text-muted-foreground">Edits show up live for everyone</p>
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {shared.map((d, i) => (
              <DrawingCard
                key={d.id}
                index={i}
                id={d.id}
                title={d.title}
                thumbnail={d.thumbnail}
                accent="bg-cyan"
                shared
                detail={<>Shared by {d.ownerName ?? "someone"}</>}
                chip={
                  d.role === "viewer" ? (
                    <>
                      <Eye className="size-3.5" /> View only
                    </>
                  ) : null
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function DrawingCard({
  index,
  id,
  title,
  thumbnail,
  detail,
  chip,
  accent = "bg-green",
  shared = false,
}: {
  /** Place in the grid: cards in a row come in one after another. */
  index: number;
  id: string;
  title: string;
  thumbnail: string | null;
  detail: React.ReactNode;
  chip: React.ReactNode;
  accent?: string;
  shared?: boolean;
}) {
  return (
    <Reveal as="li" delay={(index % 3) * 0.05} className="group relative">
      <Link href={`/drawings/${id}`} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="relative block aspect-[16/10] overflow-hidden rounded-lg bg-beige-100 ring-1 ring-black/5 transition-shadow group-hover:ring-2 group-hover:ring-green/50">
          {thumbnail ? (
            // Small data URLs stored in Postgres; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
          ) : null}
          {chip ? (
            <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-grey-900/85 px-2.5 py-1 text-xs font-semibold text-white">
              {chip}
            </span>
          ) : null}
        </span>
        <span className="mt-3 flex items-center gap-3 pr-10">
          <span className={`h-9 w-1 shrink-0 rounded-full ${accent}`} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-bold">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          </span>
        </span>
      </Link>
      <DrawingMenu id={id} title={title} shared={shared} />
    </Reveal>
  );
}

export function OverviewSkeleton() {
  return (
    <>
      <div className="mb-8 grid gap-3 sm:grid-cols-3 md:gap-6">
        <Skeleton className="h-[118px] rounded-xl bg-grey-900/80" />
        <Skeleton className="h-[118px] rounded-xl bg-card" />
        <Skeleton className="h-[118px] rounded-xl bg-card" />
      </div>
      <Skeleton className="h-80 rounded-xl bg-card" />
    </>
  );
}
