import Link from "next/link";
import { Button } from "@/components/kit";

/** What anyone without a staff role sees at /admin: the same as any other missing page. */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh flex-1 place-items-center px-6">
      <div className="max-w-sm rounded-xl bg-card p-8">
        <h1 className="text-2xl font-bold">This page doesn&rsquo;t exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be wrong.</p>
        <Button asChild size="xl" full className="mt-6">
          <Link href="/">Back to drawings</Link>
        </Button>
      </div>
    </main>
  );
}
