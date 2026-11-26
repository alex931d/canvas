"use client";

import { CreditCard, LogIn, LogOut, PawPrint, Settings, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from "@/components/kit";
import { signOut } from "@/app/(auth)/actions";
import { setDecorationsHidden, useSeasonState } from "@/components/seasonal/season-context";
import { can, type Role } from "@/lib/auth/roles";
import { emitBuddy } from "@/lib/buddy/events";
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
  const router = useRouter();
  return (
    <MenuContent side={side} align={side === "top" ? "start" : "end"} className="w-64">
      <MenuLabel>
        <span className="block truncate font-bold">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </MenuLabel>
      <MenuSeparator />
      {/* Buddy settings where the pandas are out; elsewhere, the buddies page. */}
      <MenuItem onSelect={() => (emitBuddy({ kind: "open-settings" }) ? undefined : router.push("/buddies"))}>
        <PawPrint /> Study buddies
      </MenuItem>
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
  const { pending, run } = useSignOut(user);
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account: ${user.name}`}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-green rail:mx-auto rail:w-auto rail:px-2"
      >
        <Avatar name={user.name} src={user.avatarUrl} />
        <span className="min-w-0 rail:hidden">
          <span className="block truncate text-sm font-bold">{user.name}</span>
          <span className="block truncate text-xs text-grey-300">{user.email}</span>
        </span>
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

/** For people drawing without an account: the way to log in, or to the membership. */
export function GuestMenu({ next, className }: { next: string; className?: string }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Account"
        className={cn(
          "grid size-10 place-items-center rounded-full bg-grey-900 text-white outline-none focus-visible:ring-2 focus-visible:ring-green",
          className,
        )}
      >
        <UserRound className="size-5" />
      </MenuTrigger>
      <MenuContent side="bottom" align="end" className="w-64">
        <MenuLabel>
          <span className="block font-bold">Drawing without an account</span>
          <span className="block text-xs text-muted-foreground">Your drawings are saved in this browser.</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={`/login?next=${encodeURIComponent(next)}`}>
            <LogIn /> Log in
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/pricing">
            <CreditCard /> Get the membership
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
