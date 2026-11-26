import { Eye, Lock, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Button, Skeleton } from "@/components/kit";
import { requireUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { MEMBERSHIP } from "@/lib/billing/plan";
import { countOwnDrawings, listDrawings, listSharedWithMe } from "@/lib/drawings";
import { studySummary } from "@/lib/study/cards";
import { cn } from "@/lib/utils";
import { listWorkspaces } from "@/lib/workspaces/data";
import { canEditInWorkspace } from "@/lib/workspaces/roles";
import { MoveBrowserProfile } from "@/components/settings/move-browser-profile";
import { BrowserGallery, PendingBrowserDrawings } from "./browser-gallery";
import { DrawingCard } from "./drawing-card";
import { DrawingMenu } from "./drawing-menu";
import { NewDrawingButton } from "./new-drawing-button";

const STAT = "flex min-h-[88px] flex-col justify-between gap-2 rounded-xl p-3 sm:min-h-0 sm:justify-start sm:gap-3 sm:p-6";
const STAT_NUMBER = "text-2xl leading-none font-bold sm:text-[32px]";

/** Summary cards, your drawings, and drawings shared with you; without a membership, the free plan's home. */
export async function Overview() {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  if (!membership.isMember) return <FreeOverview ended={membership.subscription !== null} />;

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
      <PendingBrowserDrawings />
      <MoveBrowserProfile userId={user.id} />
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

/**
 * Signed in without a membership: the drawings in this browser, and what the
 * membership adds. After a membership ends, the drawings in the account are
 * kept; this says how many, and renewing opens them again.
 */
async function FreeOverview({ ended }: { ended: boolean }) {
  const kept = ended ? await countOwnDrawings() : 0;
  return (
    <>
      <section
        aria-label="Your plan"
        data-testid="free-plan"
        className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl bg-grey-900 px-6 py-5 text-white sm:mb-8"
      >
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {ended ? "Your membership has ended" : "You're on the free plan"}
          </p>
          <p className="mt-1 max-w-[40rem] text-sm leading-relaxed text-grey-300">
            {ended && kept > 0
              ? `The ${kept === 1 ? "drawing" : `${kept} drawings`} in your account ${kept === 1 ? "is" : "are"} kept safe. Renew to open ${kept === 1 ? "it" : "them"} again; until then, drawings you start are saved in this browser.`
              : "New drawings are saved in this browser. The membership keeps them in your account and adds math checks, chemistry tools, flashcards, drawing together and team workspaces."}
          </p>
        </div>
        <Button asChild variant="light" size="lg">
          <Link href="/pricing">
            {ended ? "Renew membership" : `Get the membership, ${MEMBERSHIP.price} ${MEMBERSHIP.per}`}
          </Link>
        </Button>
      </section>

      <BrowserGallery member={false} />

      <section aria-label="Member features" className="mt-8 grid gap-3 sm:grid-cols-2">
        {[
          { href: "/study", title: "Flashcards and study", text: "Turn parts of a drawing into cards and review them." },
          { href: "/workspaces", title: "Team workspaces", text: "Share drawings with a class or a study group." },
        ].map((f) => (
          <Link
            key={f.href}
            href="/pricing"
            className="flex items-start gap-3 rounded-xl bg-card px-5 py-4 outline-none hover:ring-2 hover:ring-green/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Lock className="mt-0.5 size-4 shrink-0 text-grey-500" aria-hidden />
            <span>
              <span className="block font-bold">{f.title}</span>
              <span className="block text-sm text-muted-foreground">{f.text} Part of the membership.</span>
            </span>
          </Link>
        ))}
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
