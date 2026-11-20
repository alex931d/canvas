import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { joinDrawing } from "@/app/sharing-actions";
import { SplitLayout } from "@/components/auth/split-layout";
import { Button, Skeleton } from "@/components/kit";
import { db } from "@/db";
import { drawingMembers, drawings, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { MEMBERSHIP } from "@/lib/billing/plan";

export const metadata: Metadata = { title: "Join a drawing", robots: { index: false } };

/**
 * Where invite links lead. Signed-out visitors are sent to log in first
 * (src/proxy.ts) and come back here; joining takes a membership.
 */
export default function JoinPage({ params }: PageProps<"/join/[token]">) {
  return (
    <SplitLayout>
      <section className="w-full max-w-[560px] rounded-xl bg-card px-5 py-6 sm:p-8">
        <Suspense
          fallback={
            <div className="space-y-5" aria-label="Loading">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-[53px] w-full" />
            </div>
          }
        >
          <JoinCard params={params} />
        </Suspense>
      </section>
    </SplitLayout>
  );
}

async function JoinCard({ params }: { params: PageProps<"/join/[token]">["params"] }) {
  const { token } = await params;
  const user = await requireUser();

  const [drawing] = /^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? await db
        .select({ id: drawings.id, title: drawings.title, ownerId: drawings.userId, role: drawings.shareRole, ownerName: users.name })
        .from(drawings)
        .leftJoin(users, eq(users.id, drawings.userId))
        .where(eq(drawings.shareToken, token))
        .limit(1)
    : [];

  if (!drawing) {
    return (
      <div className="space-y-4">
        <h1 className="text-[32px] leading-tight font-bold">This invite link doesn&apos;t work</h1>
        <p className="text-muted-foreground">
          The owner may have turned off link sharing or made a new link. Ask them to send it again.
        </p>
        <Button asChild size="xl" full className="text-base">
          <Link href="/">Go to your drawings</Link>
        </Button>
      </div>
    );
  }

  if (drawing.ownerId === user.id) redirect(`/drawings/${drawing.id}`);
  const [already] = await db
    .select({ role: drawingMembers.role })
    .from(drawingMembers)
    .where(and(eq(drawingMembers.drawingId, drawing.id), eq(drawingMembers.userId, user.id)));
  if (already) redirect(`/drawings/${drawing.id}`);

  const owner = drawing.ownerName ?? "Someone";
  const what =
    drawing.role === "editor" ? "draw and write on it together, live" : "view it and follow along as it changes";

  if (!(await getMembership(user.id)).isMember) {
    return (
      <div className="space-y-4">
        <h1 className="text-[32px] leading-tight font-bold">{owner} shared a drawing with you</h1>
        <p className="text-muted-foreground">
          Shared drawings are part of the membership, {MEMBERSHIP.price} {MEMBERSHIP.per}. Once you&apos;re a member,
          open this link again to {what}.
        </p>
        <Button asChild size="xl" full className="text-base">
          <Link href="/pricing">Become a member</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-green">{owner} shared a drawing with you</p>
        <h1 className="text-[32px] leading-tight font-bold break-words">{drawing.title}</h1>
        <p className="text-muted-foreground">You&apos;ll be able to {what}.</p>
      </div>
      <form action={joinDrawing.bind(null, token)}>
        <Button type="submit" size="xl" full className="text-base">
          Open drawing
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link href="/" className="font-semibold text-muted-foreground underline-offset-4 hover:underline">
          Not now
        </Link>
      </p>
    </div>
  );
}
