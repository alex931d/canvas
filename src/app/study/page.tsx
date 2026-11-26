import { GalleryVerticalEnd, LayoutGrid, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { CardList } from "@/components/study/card-list";
import { StudySession } from "@/components/study/study-session";
import { Skeleton } from "@/components/kit";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { requireMember } from "@/lib/billing/membership";
import { allCards, dueCards, listDecks } from "@/lib/study/cards";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Study" };

async function SidebarUser() {
  const user = await requireMember();
  return <SidebarUserMenu user={user} />;
}

async function HeaderUser() {
  const user = await requireMember();
  return <HeaderUserMenu user={user} className="md:hidden" />;
}

/** Review flashcards that are due, by deck, and manage them. */
export default function StudyPage({ searchParams }: PageProps<"/study">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar
        footer={
          <Suspense fallback={<div className="mx-4 h-14" />}>
            <SidebarUser />
          </Suspense>
        }
      >
        <SidebarLink href="/" icon={<LayoutGrid />} label="Drawings" />
        <SidebarLink href="/workspaces" icon={<UsersRound />} label="Workspaces" />
        <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" active />
        <Suspense fallback={null}>
          <StaffSidebarLink />
        </Suspense>
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[880px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Study</h1>
            <Suspense fallback={<HeaderUserSlot />}>
              <HeaderUser />
            </Suspense>
          </header>
          <Suspense
            fallback={
              <div className="space-y-4" aria-label="Loading">
                <Skeleton className="h-10 w-full rounded-xl bg-card" />
                <Skeleton className="h-80 w-full rounded-xl bg-card" />
              </div>
            }
          >
            <StudyContent searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function StudyContent({ searchParams }: { searchParams: PageProps<"/study">["searchParams"] }) {
  const params = await searchParams;
  const deck = typeof params.deck === "string" && params.deck.length <= 120 ? params.deck : undefined;
  const [decks, due, cards] = await Promise.all([listDecks(), dueCards(100, deck), allCards()]);
  const dueTotal = decks.reduce((n, d) => n + d.due, 0);

  if (decks.length === 0) {
    return (
      <section className="rounded-xl bg-card px-6 py-14 text-center">
        <h2 className="text-xl font-bold">No flashcards yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Open a drawing, select what you want to remember (or loop around it with the lasso) and choose Flashcard.
          Type the question; your drawing becomes the answer.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          Go to your drawings
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Decks" className="flex flex-wrap gap-2">
        <DeckLink href="/study" active={!deck} label="All decks" due={dueTotal} />
        {decks.map((d) => (
          <DeckLink
            key={d.deck}
            href={`/study?deck=${encodeURIComponent(d.deck)}`}
            active={deck === d.deck}
            label={d.deck}
            due={d.due}
          />
        ))}
      </nav>

      {due.length > 0 ? (
        <StudySession
          key={deck ?? "all"}
          cards={due.map((c) => ({
            id: c.id,
            deck: c.deck,
            front: c.front,
            back: c.back,
            imageSide: c.imageSide,
            imageWidth: c.imageWidth,
            imageHeight: c.imageHeight,
            box: c.box,
          }))}
        />
      ) : (
        <section className="rounded-xl bg-grey-900 px-6 py-10 text-white">
          <h2 className="text-2xl font-bold">Nothing due{deck ? ` in “${deck}”` : ""}</h2>
          <p className="mt-2 max-w-lg text-sm text-grey-300">
            Cards come back just before you&apos;re likely to forget them. Check again later, or add cards from any
            drawing.
          </p>
        </section>
      )}

      <Reveal as="section" aria-label="All cards" className="rounded-xl bg-card p-5 md:p-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">All cards</h2>
          <p className="text-sm text-muted-foreground">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </p>
        </div>
        <CardList
          cards={cards.map((c) => ({
            id: c.id,
            deck: c.deck,
            front: c.front,
            back: c.back,
            imageSide: c.imageSide,
            dueAt: c.dueAt.toISOString(),
            box: c.box,
          }))}
        />
      </Reveal>
    </div>
  );
}

function DeckLink({ href, active, label, due }: { href: string; active: boolean; label: string; due: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-grey-900 text-white" : "bg-card text-foreground hover:bg-card/70",
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs tabular-nums",
          active ? "bg-white/15" : due > 0 ? "bg-green text-white" : "bg-beige-100 text-muted-foreground",
        )}
      >
        {due}
      </span>
    </Link>
  );
}
