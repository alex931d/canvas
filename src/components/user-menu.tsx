"use client";

import { CreditCard, LogOut, Settings, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from "@/components/kit";
import { signOut } from "@/app/(auth)/actions";
import { useSidebarCollapsed } from "@/components/app-sidebar";
import { setDecorationsHidden, useSeasonState } from "@/components/seasonal/season-context";
import { can, type Role } from "@/lib/auth/roles";
import { THEME_INFO } from "@/lib/seasons";
import { clearLocalDataOnSignOut } from "@/lib/local-store/sign-out";
import { cn } from "@/lib/utils";

export type MenuUser = { id: string; name: string; email: string; role?: Role; avatarUrl?: string | null };

/** Clears this person's synced local copies, then signs out. */
export function useSignOut(user: MenuUser) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const { keptUnsynced } = await clearLocalDataOnSignOut(user.id);
      if (keptUnsynced > 0) {
        toast.info(
          `${keptUnsynced} drawing${keptUnsynced === 1 ? " has" : "s have"} changes that haven't synced yet. They stay in this browser and sync when you sign in again.`,
          { duration: 8000 },
        );
      }
      await signOut();
    });
  return { pending, run };
}

function AccountMenuContent({
  user,
  onSignOut,
  pending,
  side,
}: {
  user: MenuUser;
  onSignOut: () => void;
  pending: boolean;
  side: "top" | "bottom";
}) {
  const season = useSeasonState();
  return (
    <MenuContent side={side} align={side === "top" ? "start" : "end"} className="w-64">
      <MenuLabel>
        <span className="block truncate font-bold">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </MenuLabel>
      <MenuSeparator />
      {season.theme ? (
        <MenuItem onSelect={() => setDecorationsHidden(!season.hidden)}>
          <Sparkles /> {season.hidden ? "Show" : "Hide"} {THEME_INFO[season.theme].label} decorations
        </MenuItem>
      ) : null}
      <MenuItem asChild>
        <Link href="/settings">
          <Settings /> Settings
        </Link>
      </MenuItem>
      <MenuItem asChild>
        <Link href="/membership">
          <CreditCard /> Membership
        </Link>
      </MenuItem>
      {user.role && can(user.role, "admin:open") ? (
        <MenuItem asChild>
          <Link href="/admin">
            <ShieldCheck /> Admin dashboard
          </Link>
        </MenuItem>
      ) : null}
      <MenuItem onSelect={onSignOut} disabled={pending}>
        <LogOut /> {pending ? "Signing out…" : "Sign out"}
      </MenuItem>
    </MenuContent>
  );
}

/** Account button at the bottom of the dark sidebar. */
export function SidebarUserMenu({ user }: { user: MenuUser }) {
  const collapsed = useSidebarCollapsed();
  const { pending, run } = useSignOut(user);
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account: ${user.name}`}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-green group-data-[collapsed=true]/sidebar:mx-auto group-data-[collapsed=true]/sidebar:w-auto group-data-[collapsed=true]/sidebar:px-2"
      >
        <Avatar name={user.name} src={user.avatarUrl} />
        {collapsed ? null : (
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{user.name}</span>
            <span className="block truncate text-xs text-grey-300">{user.email}</span>
          </span>
        )}
      </MenuTrigger>
      <AccountMenuContent user={user} onSignOut={run} pending={pending} side="top" />
    </Menu>
  );
}

/** Compact account button for page headers (phones). */
export function HeaderUserMenu({ user, className }: { user: MenuUser; className?: string }) {
  const { pending, run } = useSignOut(user);
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account: ${user.name}`}
        className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-green", className)}
      >
        <Avatar name={user.name} src={user.avatarUrl} className="size-10" />
      </MenuTrigger>
      <AccountMenuContent user={user} onSignOut={run} pending={pending} side="bottom" />
    </Menu>
  );
}
