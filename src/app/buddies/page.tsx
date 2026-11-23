import { GalleryVerticalEnd, LayoutGrid, PawPrint } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { BuddyCollection } from "@/components/buddy/collection";
import { Skeleton } from "@/components/kit";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { requireMember } from "@/lib/billing/membership";
import { bambooFor } from "@/lib/buddy/kinds";
import { getSettings } from "@/lib/buddy/progress";
import { openingsOf } from "@/lib/buddy/rules";
import { getCollection, getStats, pointsOf } from "@/lib/buddy/wild";
import { getWildRules } from "@/lib/site/settings";

export const metadata: Metadata = { title: "Buddies" };

async function SidebarUser() {
  const user = await requireMember();
  return <SidebarUserMenu user={user} />;
}

async function HeaderUser() {
  const user = await requireMember();
  return <HeaderUserMenu user={user} className="md:hidden" />;
}

/** Your study buddies: who's out with you, the pandas you've caught, and how catching works. */
export default function BuddiesPage() {
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
        <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" />
        <SidebarLink href="/buddies" icon={<PawPrint />} label="Buddies" active />
        <Suspense fallback={null}>
          <StaffSidebarLink />
        </Suspense>
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1080px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Buddies</h1>
            <Suspense fallback={<HeaderUserSlot />}>
              <HeaderUser />
            </Suspense>
          </header>
          <Suspense
            fallback={
              <div className="grid gap-6" aria-label="Loading">
                <Skeleton className="h-48 w-full rounded-xl bg-card" />
                <Skeleton className="h-96 w-full rounded-xl bg-card" />
              </div>
            }
          >
            <BuddiesContent />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function BuddiesContent() {
  const user = await requireMember();
  const [settings, collection, stats, points, rules] = await Promise.all([
    getSettings(user.id),
    getCollection(user.id),
    getStats(user.id),
    pointsOf(user.id),
    getWildRules(),
  ]);
  return (
    <BuddyCollection
      settings={settings}
      collection={collection}
      level={user.level}
      bamboo={bambooFor(points, stats.bambooSpent)}
      stats={{ caught: stats.caught, won: stats.won }}
      wild={openingsOf(rules)}
    />
  );
}
