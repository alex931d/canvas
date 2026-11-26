import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DrawingCard } from "@/components/gallery/drawing-card";
import { DrawingMenu } from "@/components/gallery/drawing-menu";
import { NewDrawingButton } from "@/components/gallery/new-drawing-button";
import { HeaderUserSlot } from "@/components/header-user-slot";
import { Button, Skeleton } from "@/components/kit";
import { LocalTime } from "@/components/local-time";
import { HeaderUser, WorkspacesSidebar } from "@/components/workspaces/workspace-nav";
import { WorkspacePeople } from "@/components/workspaces/workspace-people";
import { WorkspaceTitle } from "@/components/workspaces/workspace-title";
import { requireUser } from "@/lib/auth/session";
import { getWorkspace, listWorkspaces } from "@/lib/workspaces/data";
import { canEditInWorkspace, canManageWorkspace } from "@/lib/workspaces/roles";

export const metadata: Metadata = { title: "Workspace" };

/** One team workspace: its drawings, and the people in it. */
export default function WorkspacePage({ params }: PageProps<"/workspaces/[id]">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <WorkspacesSidebar />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1240px]">
          <Suspense
            fallback={
              <div className="grid gap-6">
                <Skeleton className="h-10 w-72 bg-card" />
                <Skeleton className="h-96 rounded-xl bg-card" />
              </div>
            }
          >
            <Workspace params={params} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function Workspace({ params }: { params: PageProps<"/workspaces/[id]">["params"] }) {
  const { id } = await params;
  // Not in it (or it's gone): the same 404 as a workspace that never existed.
  const ws = await getWorkspace(id);
  if (!ws) notFound();
  const [me, mine] = await Promise.all([requireUser(), listWorkspaces()]);
  const canAdd = canEditInWorkspace(ws.role);
  const manager = canManageWorkspace(ws.role);
  const elsewhere = mine.filter((w) => w.id !== ws.id && canEditInWorkspace(w.role)).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <header className="mb-2 flex items-center gap-2 md:gap-3">
        <Button asChild variant="ghost" size="icon-md" aria-label="All workspaces">
          <Link href="/workspaces">
            <ArrowLeft />
          </Link>
        </Button>
        <WorkspaceTitle id={ws.id} name={ws.name} role={ws.role} />
        {canAdd ? <NewDrawingButton workspaceId={ws.id} /> : null}
        <Suspense fallback={<HeaderUserSlot />}>
          <HeaderUser />
        </Suspense>
      </header>
      <p className="mb-8 text-sm text-muted-foreground md:ml-12">
        {canAdd
          ? "Everyone here can open these drawings, and draw on them together live unless they can only view."
          : "You can open these drawings and follow along as they change."}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="ws-drawings" className="rounded-xl bg-card p-5 md:p-8">
          <h2 id="ws-drawings" className="mb-5 text-xl font-bold">
            Drawings
          </h2>
          {ws.drawings.length ? (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2" data-testid="workspace-drawings">
              {ws.drawings.map((d, i) => {
                const own = d.ownerId === me.id;
                return (
                  <DrawingCard
                    key={d.id}
                    index={i}
                    id={d.id}
                    title={d.title}
                    thumbnail={d.thumbnail}
                    chip={null}
                    accent={own ? "bg-green" : "bg-cyan"}
                    detail={
                      <>
                        Edited <LocalTime iso={d.updatedAt.toISOString()} />, by {own ? "you" : (d.ownerName ?? "someone")}
                      </>
                    }
                    menu={
                      <DrawingMenu
                        id={d.id}
                        title={d.title}
                        kind={own ? "own" : "workspace"}
                        move={{ current: { id: ws.id, name: ws.name }, to: own ? elsewhere : [], canTakeOut: own || manager }}
                      />
                    }
                  />
                );
              })}
            </ul>
          ) : (
            <div className="py-10 text-center">
              <p className="font-bold">No drawings here yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {canAdd
                  ? "Start one with New Drawing, or move one of yours in from its ⋯ menu on your drawings page."
                  : "When someone adds a drawing, it shows up here."}
              </p>
            </div>
          )}
        </section>

        <aside aria-labelledby="ws-people" className="rounded-xl bg-card p-5 md:p-6">
          <h2 id="ws-people" className="mb-4 text-xl font-bold">
            People
          </h2>
          <WorkspacePeople
            workspaceId={ws.id}
            meId={me.id}
            role={ws.role}
            members={ws.members}
            invites={ws.invites}
            link={ws.link}
          />
        </aside>
      </div>
    </>
  );
}
