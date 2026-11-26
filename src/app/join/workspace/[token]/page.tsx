import { sha256 } from "@oslojs/crypto/sha2";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { joinWorkspace } from "@/app/workspace-actions";
import { SplitLayout } from "@/components/auth/split-layout";
import { Button, Skeleton } from "@/components/kit";
import { db } from "@/db";
import { users, workspaceInvites, workspaceMembers, workspaces, type MemberRole } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/billing/membership";
import { MEMBERSHIP } from "@/lib/billing/plan";

export const metadata: Metadata = { title: "Join a workspace", robots: { index: false } };

/**
 * Where workspace invitations lead: a workspace's invite link, or an emailed
 * invitation (which needs an account with that address). Signed-out visitors
 * log in first (src/proxy.ts) and come back here; joining takes a membership.
 */
export default function JoinWorkspacePage({ params }: PageProps<"/join/workspace/[token]">) {
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

type Found = { workspaceId: string; name: string; role: MemberRole; inviter: string | null; email: string | null };

async function find(token: string): Promise<Found | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [byLink] = await db
    .select({ workspaceId: workspaces.id, name: workspaces.name, role: workspaces.inviteRole })
    .from(workspaces)
    .where(eq(workspaces.inviteToken, token))
    .limit(1);
  if (byLink) return { ...byLink, inviter: null, email: null };
  const hash = Buffer.from(sha256(new TextEncoder().encode(token)));
  const [invite] = await db
    .select({
      workspaceId: workspaceInvites.workspaceId,
      name: workspaces.name,
      role: workspaceInvites.role,
      inviter: users.name,
      email: workspaceInvites.email,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(and(eq(workspaceInvites.tokenHash, hash), gt(workspaceInvites.expiresAt, sql`now()`)))
    .limit(1);
  return invite ?? null;
}

async function JoinCard({ params }: { params: PageProps<"/join/workspace/[token]">["params"] }) {
  const { token } = await params;
  const user = await requireUser();
  const found = await find(token);

  if (!found) {
    return (
      <div className="space-y-4">
        <h1 className="text-[32px] leading-tight font-bold">This invitation doesn&apos;t work</h1>
        <p className="text-muted-foreground">
          It may have expired (emailed invitations last 14 days), been cancelled, or the workspace&apos;s link was
          turned off or replaced. Ask whoever sent it for a new one.
        </p>
        <Button asChild size="xl" full className="text-base">
          <Link href="/workspaces">Go to your workspaces</Link>
        </Button>
      </div>
    );
  }

  const [already] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, found.workspaceId), eq(workspaceMembers.userId, user.id)));
  if (already) redirect(`/workspaces/${found.workspaceId}`);

  const who = found.inviter ? `${found.inviter} invited you to a workspace` : "You're invited to a workspace";
  const what = found.role === "editor" ? "open its drawings and draw on them together, live" : "open its drawings and follow along as they change";

  // An emailed invitation is for one address: the account has to have it, confirmed.
  if (found.email && (found.email !== user.email.toLowerCase() || !user.emailVerified)) {
    return (
      <div className="space-y-4">
        <h1 className="text-[32px] leading-tight font-bold">This invitation is for another email address</h1>
        <p className="text-muted-foreground">
          You&apos;re signed in as {user.email}
          {found.email === user.email.toLowerCase() ? ", which isn't confirmed yet" : ""}. Sign in with the account for the
          address the invitation was sent to, or ask for an invitation to this one.
        </p>
        <Button asChild size="xl" full className="text-base">
          <Link href="/workspaces">Go to your workspaces</Link>
        </Button>
      </div>
    );
  }

  if (!(await getMembership(user.id)).isMember) {
    return (
      <div className="space-y-4">
        <h1 className="text-[32px] leading-tight font-bold">{who}</h1>
        <p className="text-muted-foreground">
          Workspaces are part of the membership, {MEMBERSHIP.price} {MEMBERSHIP.per}. Once you&apos;re a member, open this
          link again to {what}.
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
        <p className="text-sm font-semibold text-green">{who}</p>
        <h1 className="text-[32px] leading-tight font-bold break-words">{found.name}</h1>
        <p className="text-muted-foreground">You&apos;ll be able to {what}.</p>
      </div>
      <form action={joinWorkspace.bind(null, token)}>
        <Button type="submit" size="xl" full className="text-base">
          Join workspace
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
