import { ArrowLeft, ArrowRight, GalleryVerticalEnd, LayoutGrid, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SeasonalThemeForm } from "@/components/admin/seasonal-theme-form";
import { AdminToolbar } from "@/components/admin/toolbar";
import {
  ComplimentaryButton,
  DetailsForm,
  RemoveAvatarButton,
  SendResetButton,
  SignOutEverywhereButton,
  type EditorPermissions,
} from "@/components/admin/user-editor";
import { UserSheet } from "@/components/admin/user-sheet";
import { AppSidebar, SidebarLink } from "@/components/app-sidebar";
import { LocalDate, LocalTime } from "@/components/local-time";
import { Avatar, Badge, SidePanelTitle, Skeleton } from "@/components/kit";
import { HeaderUserMenu, SidebarUserMenu } from "@/components/user-menu";
import { adminHref, pageWindow, parseAdminQuery, type AdminQuery, type Status } from "@/lib/admin/query";
import { PAGE_SIZE, searchUsers, userDetail, userStats, type MembershipLabel, type UserDetail } from "@/lib/admin/users";
import { can, canManage, roleChangeBlocked, ROLE_INFO, type Role } from "@/lib/auth/roles";
import { requirePermission, type SessionUser } from "@/lib/auth/session";
import { THEME_INFO } from "@/lib/seasons";
import { readSeasonalSetting } from "@/lib/site/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

/**
 * The admin dashboard: find accounts and edit them. Support and admin roles
 * only (src/lib/auth/roles.ts); everyone else gets the 404 page. All of its
 * state is in the address (src/lib/admin/query.ts).
 */
export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  // Nothing renders before the role check, not even the frame.
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

/** The dashboard's frame (menu, header, totals, the accounts card) at its real sizes, so nothing jumps when it arrives. */
function DashboardSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row" aria-label="Loading">
      <div className="fixed inset-x-0 bottom-0 z-40 h-16 rounded-t-lg bg-grey-900 md:sticky md:top-0 md:h-dvh md:w-[260px] md:shrink-0 md:rounded-t-none md:rounded-r-2xl rail:w-[88px]" />
      <div className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1140px]">
          <div className="mb-8 flex h-[84px] items-start justify-between gap-4 md:h-16">
            <div className="grid w-full max-w-md gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
            <Skeleton className="size-10 shrink-0 rounded-full md:hidden" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[100px] rounded-xl bg-white" />
            ))}
          </div>
          <Skeleton className="mt-8 h-[982px] rounded-xl bg-white md:h-[906px]" />
        </div>
      </div>
    </div>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  const actor = await requirePermission("admin:open");
  const query = parseAdminQuery(await searchParams);
  const [stats, results, detail, seasonal] = await Promise.all([
    userStats(),
    searchUsers(query),
    query.user ? userDetail(query.user) : null,
    can(actor.role, "site:settings") ? readSeasonalSetting() : null,
  ]);
  // Past the last page (say, after a search narrowed things): show the last one, and say so in the address.
  if (query.page > results.pageCount) redirect(adminHref(query, { page: results.pageCount }));

  const from = results.total === 0 ? 0 : (results.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(results.page * PAGE_SIZE, results.total);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar footer={<SidebarUserMenu user={actor} />}>
        <SidebarLink href="/" icon={<LayoutGrid />} label="Drawings" />
        <SidebarLink href="/study" icon={<GalleryVerticalEnd />} label="Study" />
        <SidebarLink href="/admin" icon={<ShieldCheck />} label="Admin" active />
      </AppSidebar>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-[1140px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-[32px] leading-tight font-bold">Admin</h1>
              <p className="mt-1 text-sm text-grey-500">
                Signed in as {ROLE_INFO[actor.role].label.toLowerCase()}. {roleSummary(actor.role)}
              </p>
            </div>
            <HeaderUserMenu user={actor} className="md:hidden" />
          </header>

          <StatusCards stats={stats} query={query} />

          <section aria-labelledby="accounts-title" className="mt-8 rounded-xl bg-white p-4 sm:p-6">
            <h2 id="accounts-title" className="sr-only">
              Accounts
            </h2>
            <AdminToolbar query={query} />
            <UsersTable rows={results.rows} query={query} />
            <div className="mt-5 flex flex-col items-center justify-between gap-4 sm:flex-row">
              <p className="text-sm text-grey-500 tabular-nums" aria-live="polite">
                {results.total === 0 ? "No accounts match." : `Showing ${from}–${to} of ${results.total}`}
              </p>
              <Pager query={query} page={results.page} pageCount={results.pageCount} />
            </div>
          </section>

          {seasonal ? (
            <section aria-labelledby="season-title" className="mt-8 rounded-xl bg-white p-4 sm:p-6">
              <h2 id="season-title" className="text-xl font-bold">
                Seasonal theme
              </h2>
              <p className="mt-2 mb-5 max-w-[46rem] text-sm leading-relaxed text-grey-500">
                Decorations on the landing and pricing pages and in the app&apos;s menu. Automatic follows the calendar
                in each visitor&apos;s time zone: Easter ({THEME_INFO.easter.when}), Halloween ({THEME_INFO.halloween.when})
                and Christmas ({THEME_INFO.christmas.when}). Anyone can hide them for themselves, and nothing moves for
                people who&apos;ve asked their system for reduced motion.
              </p>
              <SeasonalThemeForm
                mode={seasonal.mode}
                changed={
                  seasonal.updatedAt ? (
                    <>
                      Last changed by {seasonal.updatedByName ?? "a deleted account"} on{" "}
                      <LocalDate iso={seasonal.updatedAt.toISOString()} />.
                    </>
                  ) : (
                    "Never changed: following the calendar."
                  )
                }
              />
            </section>
          ) : null}
        </div>
      </main>

      <UserSheet open={!!query.user} closeHref={adminHref(query, { user: null })}>
        {detail ? (
          <UserPanel actor={actor} user={detail} />
        ) : (
          <div className="p-6">
            <SidePanelTitle>Account not found</SidePanelTitle>
            <p className="mt-2 text-sm text-grey-500">It may have been deleted. Close this panel to go back to the list.</p>
          </div>
        )}
      </UserSheet>
    </div>
  );
}

function roleSummary(role: Role) {
  return can(role, "users:roles")
    ? "You can edit any account, including emails and roles."
    : "You can help people with their accounts; only admins change emails and roles.";
}

// ------------------------------------------------------------------ status cards

const CARDS: { status: Status | null; label: string; key: "accounts" | "members" | "unconfirmed" | "staff" }[] = [
  { status: null, label: "Accounts", key: "accounts" },
  { status: "members", label: "Members", key: "members" },
  { status: "unconfirmed", label: "Unconfirmed emails", key: "unconfirmed" },
  { status: "staff", label: "Staff", key: "staff" },
];

/** The totals, which double as filters. */
function StatusCards({ stats, query }: { stats: Awaited<ReturnType<typeof userStats>>; query: AdminQuery }) {
  return (
    <nav aria-label="Filter by status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((card) => {
        const active = query.status === card.status;
        return (
          <Link
            key={card.key}
            href={adminHref(query, { status: card.status })}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={cn(
              "rounded-xl bg-white p-5 outline-none transition-shadow hover:ring-2 hover:ring-beige-500/40 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active && "bg-grey-900 text-white hover:ring-0",
            )}
          >
            <span className={cn("block text-sm", active ? "text-grey-300" : "text-grey-500")}>{card.label}</span>
            <span className="mt-2 block text-[32px] leading-none font-bold tabular-nums">{stats[card.key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ------------------------------------------------------------------ table

const MEMBERSHIP_LABEL: Record<MembershipLabel, string> = {
  paid: "Paid",
  complimentary: "Complimentary",
  ended: "Ended",
  none: "None",
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={role === "admin" ? "dark" : role === "support" ? "green" : "neutral"}>{ROLE_INFO[role].label}</Badge>
  );
}

function UsersTable({ rows, query }: { rows: Awaited<ReturnType<typeof searchUsers>>["rows"]; query: AdminQuery }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-beige-500/50 px-6 py-12 text-center">
        <p className="font-bold">No accounts match</p>
        <p className="mt-1 text-sm text-grey-500">
          {query.q || query.role || query.status ? (
            <>
              Try another search, or{" "}
              <Link href="/admin" className="font-bold text-grey-900 underline underline-offset-4">
                show everyone
              </Link>
              .
            </>
          ) : (
            "Nobody has signed up yet."
          )}
        </p>
      </div>
    );
  }
  const th = "px-3 py-3 text-left text-xs font-normal text-grey-500 first:pl-0";
  const td = "px-3 py-3.5 align-middle first:pl-0";
  return (
    <div className="relative mt-6 overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm" data-testid="users-table">
        <thead className="border-b border-grey-100">
          <tr>
            <th scope="col" className={th}>
              Account
            </th>
            <th scope="col" className={th}>
              Role
            </th>
            <th scope="col" className={th}>
              Email
            </th>
            <th scope="col" className={th}>
              Membership
            </th>
            <th scope="col" className={th}>
              Joined
            </th>
            <th scope="col" className={th}>
              Last active
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-grey-100">
          {rows.map((row) => {
            const href = adminHref(query, { user: row.id });
            const open = query.user === row.id;
            return (
              <tr key={row.id} data-user-id={row.id} className={cn(open && "bg-beige-100")}>
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <Avatar name={row.name} src={row.avatarUrl} className="size-8 text-xs" />
                    <div className="min-w-0">
                      <Link href={href} scroll={false} className="block truncate font-bold hover:underline">
                        {row.name}
                      </Link>
                      <span className="block truncate text-grey-500">{row.email}</span>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <RoleBadge role={row.role} />
                </td>
                <td className={cn(td, row.emailVerified ? "text-grey-500" : "font-bold text-warning")}>
                  {row.emailVerified ? "Confirmed" : "Unconfirmed"}
                </td>
                <td className={cn(td, row.membership === "none" ? "text-grey-500" : "")}>
                  {MEMBERSHIP_LABEL[row.membership]}
                </td>
                <td className={cn(td, "whitespace-nowrap text-grey-500")}>
                  <LocalDate iso={row.createdAt.toISOString()} />
                </td>
                <td className={cn(td, "whitespace-nowrap text-grey-500")}>
                  {row.lastActiveAt ? <LocalDate iso={row.lastActiveAt.toISOString()} /> : "Never"}
                </td>
                <td className={cn(td, "text-right")}>
                  <Link
                    href={href}
                    scroll={false}
                    aria-label={`Edit ${row.name}`}
                    className="rounded-md px-2 py-1 font-bold text-grey-900 underline underline-offset-4 outline-none hover:text-green focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ pager: ← 1 2 3 4 5 →

const pagerItem =
  "grid size-10 place-items-center rounded-lg text-sm font-bold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Pager({ query, page, pageCount }: { query: AdminQuery; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const arrow = (to: number, label: string, icon: React.ReactNode) =>
    to < 1 || to > pageCount ? (
      <span aria-disabled="true" aria-label={label} className={cn(pagerItem, "text-grey-300")}>
        {icon}
      </span>
    ) : (
      <Link href={adminHref(query, { page: to })} aria-label={label} className={cn(pagerItem, "hover:bg-beige-100")}>
        {icon}
      </Link>
    );
  return (
    <nav aria-label="Pages">
      <ul className="flex items-center gap-1">
        <li>{arrow(page - 1, "Previous page", <ArrowLeft className="size-4" />)}</li>
        {pageWindow(page, pageCount).map((n) => (
          <li key={n}>
            <Link
              href={adminHref(query, { page: n })}
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              className={cn(pagerItem, n === page ? "bg-grey-900 text-white" : "hover:bg-beige-100")}
            >
              {n}
            </Link>
          </li>
        ))}
        <li>{arrow(page + 1, "Next page", <ArrowRight className="size-4" />)}</li>
      </ul>
    </nav>
  );
}

// ------------------------------------------------------------------ edit panel

function membershipLine(user: UserDetail) {
  const m = user.membership;
  if (m.isMember && m.complimentary) return "Complimentary membership: no payment involved.";
  if (m.isMember) {
    const status = m.subscription?.status === "past_due" ? " Their last payment failed; Stripe is retrying." : "";
    return `Paid through Stripe.${status} Refunds and cancelling are done in the Stripe Dashboard.`;
  }
  if (m.subscription) return "Their membership has ended.";
  return "No membership.";
}

const ACTION_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  "user.updated": (d) =>
    d.field === "emailVerified"
      ? d.to
        ? "marked the email as confirmed"
        : "marked the email as unconfirmed"
      : `changed the ${String(d.field)} from “${String(d.from)}” to “${String(d.to)}”`,
  "role.changed": (d) =>
    `changed the role from ${ROLE_INFO[d.from as Role]?.label ?? String(d.from)} to ${ROLE_INFO[d.to as Role]?.label ?? String(d.to)}`,
  "membership.granted": () => "gave a complimentary membership",
  "membership.ended": () => "ended the complimentary membership",
  "sessions.revoked": (d) => `signed them out everywhere (${Number(d.count ?? 0)} ${d.count === 1 ? "session" : "sessions"})`,
  "password_reset.sent": () => "emailed a password reset link",
  "avatar.removed": () => "removed their profile picture",
};

function UserPanel({ actor, user }: { actor: SessionUser; user: UserDetail }) {
  const manage = canManage(actor, user);
  const perms: EditorPermissions = {
    manage,
    email: manage && can(actor.role, "users:email"),
    roleBlocked: manage ? roleChangeBlocked(actor, user) : "Only admins can edit staff accounts.",
    comp: manage && can(actor.role, "memberships:comp"),
    self: actor.id === user.id,
  };
  const comp = user.membership.isMember && user.membership.complimentary;
  const section = "rounded-xl bg-white p-5";
  const sectionTitle = "mb-4 text-base font-bold";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 pt-14 sm:p-6 sm:pt-14">
      <div className="flex items-center gap-4 px-1">
        <Avatar name={user.name} src={user.avatarUrl} className="size-12 text-base" />
        <div className="min-w-0">
          <SidePanelTitle className="truncate">{user.name}</SidePanelTitle>
          <p className="truncate text-sm text-grey-500">{user.email}</p>
        </div>
        <span className="ml-auto">
          <RoleBadge role={user.role} />
        </span>
      </div>
      <p className="px-1 text-sm text-grey-500">
        Joined <LocalDate iso={user.createdAt.toISOString()} />.{" "}
        {user.lastActiveAt ? (
          <>
            Last active <LocalTime iso={user.lastActiveAt.toISOString()} />.
          </>
        ) : (
          "Not signed in anywhere."
        )}
      </p>
      {!manage ? (
        <p role="status" className="rounded-lg border-l-4 border-warning bg-white px-4 py-3 text-sm">
          This is a staff account. Only admins can edit it.
        </p>
      ) : null}

      <section aria-labelledby="details-title" className={section}>
        <h3 id="details-title" className={sectionTitle}>
          Details
        </h3>
        <DetailsForm
          user={{ id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified }}
          perms={perms}
        />
      </section>

      <section aria-labelledby="membership-title" className={section}>
        <h3 id="membership-title" className={sectionTitle}>
          Membership
        </h3>
        <p className="mb-4 text-sm leading-relaxed text-grey-500">{membershipLine(user)}</p>
        {comp || !user.membership.isMember ? (
          <ComplimentaryButton userId={user.id} give={!comp} disabled={!perms.comp} />
        ) : null}
      </section>

      <section aria-labelledby="access-title" className={section}>
        <h3 id="access-title" className={sectionTitle}>
          Signing in
        </h3>
        <p className="mb-4 text-sm text-grey-500">
          Signed in on {user.sessionCount} {user.sessionCount === 1 ? "device" : "devices"}.
        </p>
        <div className="grid gap-3">
          <SignOutEverywhereButton userId={user.id} disabled={!manage || perms.self} />
          <SendResetButton userId={user.id} disabled={!manage} />
          {user.avatarUrl ? <RemoveAvatarButton userId={user.id} disabled={!manage} /> : null}
        </div>
      </section>

      <section aria-labelledby="history-title" className={section}>
        <h3 id="history-title" className={sectionTitle}>
          History
        </h3>
        {user.history.length === 0 ? (
          <p className="text-sm text-grey-500">No staff changes yet.</p>
        ) : (
          <ol className="grid gap-3 text-sm" data-testid="history">
            {user.history.map((e) => (
              <li key={e.id} className="grid gap-0.5">
                <span>
                  <strong>{e.actorId ? (e.actorName ?? "A deleted account") : "The command line"}</strong>{" "}
                  {(ACTION_TEXT[e.action] ?? (() => e.action))(e.details)}
                </span>
                <span className="text-xs text-grey-500">
                  <LocalTime iso={e.createdAt.toISOString()} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
