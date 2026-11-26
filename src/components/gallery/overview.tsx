import { Eye, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Skeleton } from "@/components/kit";
import { listDrawings, listSharedWithMe } from "@/lib/drawings";
import { studySummary } from "@/lib/study/cards";
import { cn } from "@/lib/utils";
import { listWorkspaces } from "@/lib/workspaces/data";
import { canEditInWorkspace } from "@/lib/workspaces/roles";
import { DrawingCard } from "./drawing-card";
import { DrawingMenu } from "./drawing-menu";
import { NewDrawingButton } from "./new-drawing-button";

const STAT = "flex min-h-[88px] flex-col justify-between gap-2 rounded-xl p-3 sm:min-h-0 sm:justify-start sm:gap-3 sm:p-6";
const STAT_NUMBER = "text-2xl leading-none font-bold sm:text-[32px]";

/** Summary cards, your drawings, and drawings shared with you. */
export async function Overview() {
  const [drawings, shared, study, teams] = await Promise.all([
    listDrawings(),
    listSharedWithMe(),
    studySummary(),
    listWorkspaces(),
  ]);
  // Where your drawings can go: workspaces you can add to.
  const targets = teams.filter((w) => canEditInWorkspace(w.role)).map(({ id, name }) => ({ id, name }));

  return (
    <>
      {/* Phones: three small tiles in a row, so the drawings start near the top. */}
      <section aria-label="Summary" className="mb-6 grid grid-cols-3 gap-2 sm:mb-8 sm:gap-3 md:gap-6">
        <div className={cn(STAT, "bg-grey-900 text-white")}>
          <p className="text-xs sm:text-sm">Drawings</p>
          <p className={STAT_NUMBER} data-testid="drawing-count">
            {drawings.length}
          </p>
        </div>
        <div className={cn(STAT, "bg-card")}>
          <p className="text-xs text-muted-foreground sm:text-sm">Shared with you</p>
          <p className={STAT_NUMBER} data-testid="shared-count">
            {shared.length}
          </p>
        </div>
        <Link
          href="/study"
          className={cn(
            STAT,
            "group bg-card outline-none transition-shadow hover:ring-2 hover:ring-green/40 focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <p className="text-xs text-muted-foreground sm:text-sm">Flashcards due</p>
          <p className="flex items-baseline justify-between gap-2">
            <span className={STAT_NUMBER} data-testid="due-count">
              {study.due}
            </span>
            <span className="text-sm font-bold text-green group-hover:underline max-sm:hidden">
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
                  d.workspace ? (
                    <>
                      <UsersRound className="size-3.5" />
                      <span className="max-w-40 truncate">{d.workspace.name}</span>
                    </>
                  ) : d.members > 0 || d.linkShared ? (
                    <>
                      <Users className="size-3.5" />
                      {d.members > 0 ? `${d.members} ${d.members === 1 ? "person" : "people"}` : "Link on"}
                    </>
                  ) : null
                }
                menu={
                  <DrawingMenu
                    id={d.id}
                    title={d.title}
                    kind="own"
                    move={{ current: d.workspace, to: targets, canTakeOut: true }}
                  />
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
                menu={<DrawingMenu id={d.id} title={d.title} kind="shared" />}
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

      <section aria-label="Team workspaces" className="mt-8 rounded-xl bg-card p-5 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Team workspaces</h2>
          <Link href="/workspaces" className="text-sm font-bold text-green underline-offset-4 hover:underline">
            {teams.length ? "All workspaces" : "Start one"}
          </Link>
        </div>
        {teams.length ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="gallery-workspaces">
            {teams.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="flex items-center gap-3 rounded-lg border border-beige-500/30 bg-white px-4 py-3 outline-none hover:border-green/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-beige-100 font-bold" aria-hidden>
                    {w.name.trim().charAt(0).toUpperCase() || "W"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{w.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {w.drawings} {w.drawings === 1 ? "drawing" : "drawings"}, {w.members} {w.members === 1 ? "person" : "people"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-prose text-sm text-muted-foreground">
            A workspace is a place for a class, a study group or a team: invite people once, and everyone in it can
            open its drawings.
          </p>
        )}
      </section>
    </>
  );
}

export function OverviewSkeleton() {
  return (
    <>
      {/* The same sizes as the tiles, so nothing moves when they arrive. */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:mb-8 sm:gap-3 md:gap-6">
        <Skeleton className="h-[88px] rounded-xl bg-grey-900/80 sm:h-28" />
        <Skeleton className="h-[88px] rounded-xl bg-card sm:h-28" />
        <Skeleton className="h-[88px] rounded-xl bg-card sm:h-28" />
      </div>
      <Skeleton className="h-80 rounded-xl bg-card" />
    </>
  );
}
