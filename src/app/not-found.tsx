import Link from "next/link";
import { Button } from "@/components/kit";

export default function NotFound() {
  return (
    <main className="grid flex-1 place-items-center px-6">
      <div className="max-w-sm rounded-xl bg-card p-8">
        <h1 className="text-2xl font-bold">This drawing doesn&rsquo;t exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
        <Button asChild size="xl" full className="mt-6">
          <Link href="/">Back to drawings</Link>
        </Button>
      </div>
    </main>
  );
}
