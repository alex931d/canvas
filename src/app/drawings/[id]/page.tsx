import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CanvasEditor } from "@/components/editor/canvas-editor";
import { Skeleton } from "@/components/kit";
import { getDrawing } from "@/lib/drawings";
import { getPreferences } from "@/lib/profile/server";

export default function DrawingPage({ params }: PageProps<"/drawings/[id]">) {
  return (
    <Suspense fallback={<EditorFallback />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: PageProps<"/drawings/[id]">["params"] }) {
  const { id } = await params;
  // Signed out -> /login; a drawing you have no access to -> 404, same as a missing one.
  const drawing = await getDrawing(id);
  if (!drawing) notFound();
  const preferences = await getPreferences(drawing.user.id);

  return (
    <CanvasEditor
      // Remount when switching drawings so all editor state resets.
      key={drawing.id}
      id={drawing.id}
      user={{
        id: drawing.user.id,
        name: drawing.user.name,
        email: drawing.user.email,
        role: drawing.user.role,
        avatarUrl: drawing.user.avatarUrl,
      }}
      preferences={preferences}
      role={drawing.role}
      ownerName={drawing.ownerName}
      initialTitle={drawing.title}
      initialData={drawing.data}
      initialVersion={drawing.version}
      serverUpdatedAt={drawing.updatedAt.toISOString()}
    />
  );
}

function EditorFallback() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-[260px] rounded-r-2xl bg-grey-900 md:block" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-8">
        <Skeleton className="h-10 w-64 bg-card" />
        <Skeleton className="flex-1 rounded-xl bg-card" />
      </div>
    </div>
  );
}
