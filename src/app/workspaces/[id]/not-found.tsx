import Link from "next/link";
import { Button } from "@/components/kit";

/** A workspace that doesn't exist, or one you're not in: the same answer, so neither gives anything away. */
export default function WorkspaceNotFound() {
  return (
    <main className="grid min-h-dvh flex-1 place-items-center px-6">
      <div className="max-w-sm rounded-xl bg-card p-8">
        <h1 className="text-2xl font-bold">This workspace isn&rsquo;t open to you</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted, or you&rsquo;re not in it. Ask someone in it for an invitation.
        </p>
        <Button asChild size="xl" full className="mt-6">
          <Link href="/workspaces">Your workspaces</Link>
        </Button>
      </div>
    </main>
  );
}
