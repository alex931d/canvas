import { GalleryVerticalEnd, LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { Skeleton } from "@/components/kit";
import { Reveal } from "@/components/motion/reveal";
import { EffectsSection } from "@/components/settings/effects-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { requireUser } from "@/lib/auth/session";
import { getPreferences } from "@/lib/profile/server";

export const metadata: Metadata = { title: "Settings" };

async function SidebarUser() {
  const user = await requireUser();
  return <SidebarUserMenu user={user} />;
}

async function HeaderUser() {
  const user = await requireUser();
  return <HeaderUserMenu user={user} className="md:hidden" />;
}

/** Your name and picture, and how drawings and to-do boards animate. */
export default function SettingsPage() {
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
        <Suspense fallback={null}>
          <StaffSidebarLink />
        </Suspense>
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1080px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Settings</h1>
            <Suspense fallback={null}>
              <HeaderUser />
            </Suspense>
          </header>
          <Suspense fallback={<SettingsSkeleton />}>
            <SettingsContent />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const preferences = await getPreferences(user.id);
  return (
    <div className="grid gap-6">
      <Reveal as="section" aria-labelledby="profile-title" className="rounded-xl bg-card p-5 md:p-8">
        <h2 id="profile-title" className="mb-6 text-xl font-bold">
          Profile
        </h2>
        <ProfileSection user={{ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl }} />
      </Reveal>
      <Reveal as="section" aria-labelledby="effects-title" className="rounded-xl bg-card p-5 md:p-8">
        <h2 id="effects-title" className="mb-6 text-xl font-bold">
          Effects
        </h2>
        <EffectsSection initial={preferences} />
      </Reveal>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid gap-6" aria-label="Loading">
      <Skeleton className="h-72 w-full rounded-xl bg-card" />
      <Skeleton className="h-[30rem] w-full rounded-xl bg-card" />
    </div>
  );
}
