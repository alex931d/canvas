"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EditorSkeleton } from "@/components/editor/browser-editor";
import { Button } from "@/components/kit";
import { BrowserLibrary } from "@/lib/local-store/library";

/** "Start drawing": a new drawing in this browser, opened straight away. */
export default function NewBrowserDrawingPage() {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return; // React runs effects twice in development
    started.current = true;
    BrowserLibrary.shared
      .create()
      .then((drawing) => router.replace(`/local/${drawing.id}`))
      .catch(() => setFailed(true));
  }, [router]);

  if (!failed) return <EditorSkeleton />;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-xl bg-card p-8 text-center">
        <h1 className="text-2xl font-bold">This browser can&rsquo;t save drawings</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Its storage may be turned off (private windows in some browsers do that) or full. Try another window, or
          get the membership to keep drawings in an account.
        </p>
        <Button asChild className="mt-6">
          <Link href="/pricing">See the membership</Link>
        </Button>
      </div>
    </main>
  );
}
