import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { Skeleton } from "@/components/kit";
import { InvitationList } from "@/components/workspaces/invitation-list";
import { NewWorkspaceForm } from "@/components/workspaces/new-workspace-form";
import { HeaderUser, WorkspacesSidebar } from "@/components/workspaces/workspace-nav";
import { invitationsForMe, listWorkspaces } from "@/lib/workspaces/data";
import { WORKSPACE_ROLE_LABELS } from "@/lib/workspaces/roles";

export const metadata: Metadata = { title: "Workspaces" };

/** Your team workspaces, invitations to others, and making a new one. */
export default function WorkspacesPage() {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <WorkspacesSidebar />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1140px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <h1 className="text-[32px] leading-tight font-bold">Workspaces</h1>
            <Suspense fallback={<HeaderUserSlot />}>
              <HeaderUser />
            </Suspense>
          </header>
          <Suspense
            fallback={
              <div className="grid gap-6">
                <Skeleton className="h-36 rounded-xl bg-card" />
                <Skeleton className="h-64 rounded-xl bg-card" />
              </div>
            }
          >
            <WorkspacesContent />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function WorkspacesContent() {
  const [list, invitations] = await Promise.all([listWorkspaces(), invitationsForMe()]);
  return (
    <div className="grid gap-6">
      {invitations.length ? (
        <section aria-labelledby="invitations-title" className="rounded-xl bg-green/10 p-5 md:p-8">
          <h2 id="invitations-title" className="mb-4 text-xl font-bold">
            {invitations.length === 1 ? "You're invited to a workspace" : `You're invited to ${invitations.length} workspaces`}
          </h2>
          <InvitationList invitations={invitations} />
        </section>
      ) : null}

      <section className="rounded-xl bg-card p-5 md:p-8">
        <NewWorkspaceForm />
      </section>

      {list.length ? (
        <section aria-labelledby="workspaces-title" className="rounded-xl bg-card p-5 md:p-8">
          <h2 id="workspaces-title" className="mb-5 text-xl font-bold">
            Your workspaces
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="workspace-list">
            {list.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="flex h-full flex-col gap-3 rounded-xl border border-beige-500/30 bg-white p-4 outline-none hover:border-green/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-beige-100 text-lg font-bold" aria-hidden>
                      {w.name.trim().charAt(0).toUpperCase() || "W"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{w.name}</span>
                      <span className="block text-xs text-muted-foreground">{WORKSPACE_ROLE_LABELS[w.role]}</span>
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {w.drawings} {w.drawings === 1 ? "drawing" : "drawings"}, {w.members}{" "}
                    {w.members === 1 ? "person" : "people"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-xl bg-card px-6 py-12 text-center">
          <h2 className="text-xl font-bold">No workspaces yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Make one for a class, a study group or a team. Invite people once, and everyone in it can open its drawings
            and work on them together, live.
          </p>
        </section>
      )}
    </div>
  );
}
