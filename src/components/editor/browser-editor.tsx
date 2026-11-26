"use client";

import { HardDrive } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/kit";
import type { MenuUser } from "@/components/user-menu";
import type { Plan } from "@/lib/billing/plan";
import { BrowserLibrary, type BrowserDrawing } from "@/lib/local-store/library";
import type { Preferences } from "@/lib/preferences";
import { CanvasEditor } from "./canvas-editor";

type Loaded = { status: "loading" } | { status: "missing" } | { status: "ready"; drawing: BrowserDrawing };

/**
 * A drawing kept in this browser (the free plan): read from the browser's
 * library, then edited like any other, saving back to the library.
 */
export function BrowserEditor({
  id,
  user,
  plan,
  preferences,
}: {
  id: string;
  user: MenuUser | null;
  plan: Plan;
  preferences?: Preferences;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    BrowserLibrary.shared
      .get(id)
      .then((drawing) => !cancelled && setLoaded(drawing ? { status: "ready", drawing } : { status: "missing" }))
      .catch(() => !cancelled && setLoaded({ status: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loaded.status === "loading") return <EditorSkeleton />;
  if (loaded.status === "missing") return <NotInThisBrowser id={id} member={plan === "member" && !!user} />;
  const { drawing } = loaded;
  return (
    <CanvasEditor
      key={drawing.id}
      id={drawing.id}
      storage="browser"
      plan={plan}
      user={user}
      preferences={preferences}
      role="owner"
      ownerName={null}
      initialTitle={drawing.title}
      initialData={drawing.data}
      initialPresentation={drawing.presentation}
      initialVersion={0}
      serverUpdatedAt={new Date(drawing.updatedAt).toISOString()}
    />
  );
}

export function EditorSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col gap-4 p-3 md:px-6 md:pt-5 md:pb-5">
      <Skeleton className="h-10 w-64 bg-card" />
      <Skeleton className="flex-1 rounded-xl bg-card" />
    </div>
  );
}

/** Not here: deleted, made in another browser, or (for members) moved into the account. */
function NotInThisBrowser({ id, member }: { id: string; member: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-xl bg-card p-8 text-center" data-testid="not-in-browser">
        <HardDrive className="mx-auto size-8 text-grey-500" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">This drawing isn&rsquo;t in this browser</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Drawings on the free plan are kept in the browser they were made in. It may have been deleted, made in a
          different browser{member ? ", or moved into your account" : ""}.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {member ? (
            <Button asChild>
              <Link href={`/drawings/${id}`}>Look in your account</Link>
            </Button>
          ) : null}
          <Button asChild variant={member ? "secondary" : "primary"}>
            <Link href={member ? "/" : "/local"}>Your drawings</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
