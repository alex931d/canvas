import { GalleryVerticalEnd, LayoutGrid, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { requireUser } from "@/lib/auth/session";

async function SidebarUser() {
  const user = await requireUser();
  return <SidebarUserMenu user={user} />;
}

/** The phones' account button, at the end of a page header. */
export async function HeaderUser() {
  const user = await requireUser();
  return <HeaderUserMenu user={user} className="md:hidden" />;
}

/** The app's sidebar on the workspace pages, with Workspaces current. */
export function WorkspacesSidebar() {
  return (
    <AppSidebar
      footer={
        <Suspense fallback={<div className="mx-4 h-14" />}>
          <SidebarUser />
        </Suspense>
      }
    >
      <SidebarLink href="/" icon={<LayoutGrid />} label="Drawings" />
      <SidebarLink href="/workspaces" icon={<UsersRound />} label="Workspaces" active />
      <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" />
      <Suspense fallback={null}>
        <StaffSidebarLink />
      </Suspense>
    </AppSidebar>
  );
}
