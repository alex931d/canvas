import { GalleryVerticalEnd, LayoutGrid, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { NewDrawingButton } from "@/components/gallery/new-drawing-button";
import { Overview, OverviewSkeleton } from "@/components/gallery/overview";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { requireUser } from "@/lib/auth/session";

/** Reads the session, so each use sits in its own Suspense boundary. */
async function SidebarUser() {
  const user = await requireUser();
  return <SidebarUserMenu user={user} />;
}

async function HeaderUser() {
  const user = await requireUser();
  return <HeaderUserMenu user={user} className="md:hidden" />;
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar
        footer={
          <Suspense fallback={<div className="mx-4 h-14" />}>
            <SidebarUser />
          </Suspense>
        }
      >
        <SidebarLink href="/" icon={<LayoutGrid />} label="Drawings" active />
        <SidebarLink href="/workspaces" icon={<UsersRound />} label="Workspaces" />
        <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" />
        <Suspense fallback={null}>
          <StaffSidebarLink />
        </Suspense>
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1140px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Drawings</h1>
            <div className="flex items-center gap-3">
              {/* Members' new drawings go in their account; everyone else's in this browser (createDrawing). */}
              <NewDrawingButton />
              <Suspense fallback={<HeaderUserSlot />}>
                <HeaderUser />
              </Suspense>
            </div>
          </header>
          <Suspense fallback={<OverviewSkeleton />}>
            <Overview />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
