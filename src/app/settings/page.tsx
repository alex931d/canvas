import { GalleryVerticalEnd, LayoutGrid, PawPrint, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StaffSidebarLink } from "@/components/admin/staff-sidebar-link";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { Skeleton } from "@/components/kit";
import { Reveal } from "@/components/motion/reveal";
import { BuddiesSection } from "@/components/settings/buddies-section";
import { EffectsSection } from "@/components/settings/effects-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { SigningInSection } from "@/components/settings/signing-in-section";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { googleEnabled, googleLinkFor, hasPassword } from "@/lib/auth/google";
import { requireUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { getSettings } from "@/lib/buddy/progress";
import { getWildRules } from "@/lib/site/settings";
import { pendingSetup, twoFactorAvailable, twoFactorStatus } from "@/lib/auth/two-factor";
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

/** Your name and picture, how you log in, how drawings and to-do boards animate, and what the study buddies get up to. */
export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
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
        <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" />
        <SidebarLink href="/buddies" icon={<PawPrint />} label="Buddies" />
        <Suspense fallback={null}>
          <StaffSidebarLink />
        </Suspense>
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1080px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Settings</h1>
            <Suspense fallback={<HeaderUserSlot />}>
              <HeaderUser />
            </Suspense>
          </header>
          <Suspense fallback={<SettingsSkeleton />}>
            <SettingsContent searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const user = await requireUser();
  const [preferences, { isMember }, twoFactor, google, password, { google: googleResult }] = await Promise.all([
    getPreferences(user.id),
    getMembership(user.id),
    twoFactorStatus(user.id),
    googleEnabled() ? googleLinkFor(user.id) : null,
    hasPassword(user.id),
    searchParams,
  ]);
  const [buddies, rules, setup] = await Promise.all([
    isMember ? getSettings(user.id) : null,
    isMember ? getWildRules() : null,
    !twoFactor.enabled && twoFactor.settingUp ? pendingSetup(user) : null,
  ]);
  return (
    <div className="grid gap-6">
      <Reveal as="section" aria-labelledby="profile-title" className="@container rounded-xl bg-card p-5 md:p-8">
        <h2 id="profile-title" className="mb-6 text-xl font-bold">
          Profile
        </h2>
        <ProfileSection user={{ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl }} />
      </Reveal>
      <Reveal
        as="section"
        id="signing-in"
        aria-labelledby="signing-in-title"
        className="@container scroll-mt-6 rounded-xl bg-card p-5 md:p-8"
      >
        <h2 id="signing-in-title" className="mb-6 text-xl font-bold">
          Signing in
        </h2>
        <SigningInSection
          email={user.email}
          hasPassword={password}
          twoFactor={{
            available: twoFactorAvailable(),
            enabled: twoFactor.enabled,
            since: twoFactor.enabled ? twoFactor.since.toISOString() : null,
            recoveryCodesLeft: twoFactor.enabled ? twoFactor.recoveryCodesLeft : 0,
            setup,
          }}
          google={{
            enabled: googleEnabled(),
            linkedEmail: google?.email ?? null,
            result: typeof googleResult === "string" ? googleResult : null,
          }}
        />
      </Reveal>
      <Reveal as="section" aria-labelledby="effects-title" className="@container rounded-xl bg-card p-5 md:p-8">
        <h2 id="effects-title" className="mb-6 text-xl font-bold">
          Effects
        </h2>
        <EffectsSection initial={preferences} />
      </Reveal>
      <Reveal as="section" aria-labelledby="buddies-title" className="@container rounded-xl bg-card p-5 md:p-8">
        <h2 id="buddies-title" className="mb-6 text-xl font-bold">
          Study buddies
        </h2>
        {buddies ? (
          <BuddiesSection initial={buddies} wildOn={rules?.on ?? true} />
        ) : (
          <p className="text-sm text-grey-500">
            Study buddies come with membership.{" "}
            <Link href="/pricing" className="font-semibold text-green underline-offset-4 hover:underline">
              See membership
            </Link>
          </p>
        )}
      </Reveal>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    // Sized like the Profile, Signing in (with Google set up) and Effects cards at each width (they
    // follow the column's width too).
    <div className="@container grid gap-6" aria-label="Loading">
      <Skeleton className="h-[544px] w-full rounded-xl bg-card @[500px]:h-[474px] @[736px]:h-[346px]" />
      <Skeleton className="h-[716px] w-full rounded-xl bg-card @[500px]:h-[664px] @[736px]:h-[449px]" />
      <Skeleton className="h-[1165px] w-full rounded-xl bg-card @[500px]:h-[1190px] @[832px]:h-[731px]" />
    </div>
  );
}
