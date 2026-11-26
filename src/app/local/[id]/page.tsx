import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowserEditor, EditorSkeleton } from "@/components/editor/browser-editor";
import { getViewerPlan } from "@/lib/billing/membership";
import { getPreferences } from "@/lib/profile/server";

/**
 * A drawing kept in this browser (the free plan). Anyone can open this page:
 * the drawing itself is read from the browser, and the server only says who
 * is looking, if anyone, and whether they're a member.
 */

export const metadata: Metadata = { title: "Drawing" };

export default function BrowserDrawingPage({ params }: PageProps<"/local/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: PageProps<"/local/[id]">["params"] }) {
  const { id } = await params;
  const { user, plan } = await getViewerPlan();
  const preferences = user ? await getPreferences(user.id) : undefined;
  return (
    <BrowserEditor
      key={id}
      id={id}
      plan={plan}
      preferences={preferences}
      user={
        user ? { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl } : null
      }
    />
  );
}
